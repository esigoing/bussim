// Bäume und Parkgrün: Stämme + unregelmäßige Kronen als InstancedMesh
// mit per-Instanz-Farbvariation. Straßenbäume folgen den Straßenkurven,
// Parks bekommen Wiese (Terrain-Vertices), Wege-Kreuz und ggf. einen Teich.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { grassTextures, dirtTextures } from '../graphics/materials/TextureGen.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function terrainPatch(x0, z0, x1, z1, terrain, lift, uvScale) {
  const w = x1 - x0, d = z1 - z0;
  const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 12)), Math.max(1, Math.round(d / 12)));
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let k = 0; k < pos.count; k++) {
    const px = pos.getX(k) + cx, pz = pos.getZ(k) + cz;
    pos.setXYZ(k, px, terrain.hExact(px, pz) + lift, pz);
    uv.setXY(k, px * uvScale, pz * uvScale);
  }
  g.computeVertexNormals();
  return g;
}

export class Nature {
  constructor({ roadNet, blocks, rand, terrain }) {
    this.group = new THREE.Group();

    const trunkMat = Mat.std({ color: 0x5a4634, roughness: 0.95 });
    const canopyMat = Mat.std({ color: 0xffffff, roughness: 0.95 });
    const grassTex = grassTextures(512, 6);
    this.grassMat = Mat.std({ ...grassTex, color: 0xffffff }, { wet: true });
    const dirtTex = dirtTextures();
    this.dirtMat = Mat.std({ ...dirtTex, color: 0xffffff });
    this.waterMat = Mat.phys({
      color: 0x2a4a52, roughness: 0.05, metalness: 0,
      transparent: true, opacity: 0.9, envMapIntensity: 1.2,
    });

    const trees = []; // {x, z, scale}
    const { xs, zs, halfX, halfZ, segNS, segEW } = roadNet;

    // Straßenbäume entlang der NS-Kurven (versetzt zu den Laternen)
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < segNS[i].length; j++) {
        if (!segNS[i][j]) continue;
        const z0 = zs[j] + roadNet.boundZ(j) + 17;
        const z1 = zs[j + 1] - roadNet.boundZ(j + 1) - 8;
        for (let z = z0, side = 1; z < z1; z += 27, side++) {
          if (!rand.chance(0.7)) continue;
          const sx = side % 2 === 0 ? 1 : -1;
          trees.push({ x: roadNet.centerX(i, z) + sx * (halfX[i] + 1.4), z, scale: rand.float(0.6, 0.85) });
        }
      }
    }
    for (let j = 0; j < zs.length; j++) {
      for (let i = 0; i < segEW[j].length; i++) {
        if (!segEW[j][i]) continue;
        const x0 = roadNet.centerX(i, zs[j]) + roadNet.boundX(i) + 17;
        const x1 = roadNet.centerX(i + 1, zs[j]) - roadNet.boundX(i + 1) - 8;
        for (let x = x0, side = 0; x < x1; x += 27, side++) {
          if (!rand.chance(0.7)) continue;
          const sz = side % 2 === 0 ? 1 : -1;
          trees.push({ x, z: zs[j] + sz * (halfZ[j] + 1.4), scale: rand.float(0.6, 0.85) });
        }
      }
    }

    // ---- Parks: Wiese + Wege-Kreuz + ggf. Teich + dichte Bäume
    const grassGeos = [];
    const pathGeos = [];
    for (const block of blocks) {
      if (!block.park) continue;
      const { x0, z0, x1, z1 } = block;
      if (x1 - x0 < 20 || z1 - z0 < 20) continue;
      grassGeos.push(terrainPatch(x0 + 1, z0 + 1, x1 - 1, z1 - 1, terrain, 0.135, 1 / 4));

      // Wege-Kreuz durch die Parkmitte
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      pathGeos.push(terrainPatch(x0 + 2, cz - 1.4, x1 - 2, cz + 1.4, terrain, 0.16, 1 / 3));
      pathGeos.push(terrainPatch(cx - 1.4, z0 + 2, cx + 1.4, z1 - 2, terrain, 0.16, 1 / 3));

      // Teich nur auf hinreichend flachem Park-Quadranten
      const qx = cx + (x1 - x0) / 4, qz = cz + (z1 - z0) / 4;
      const hC = terrain.hExact(qx, qz);
      const slope = Math.abs(terrain.hExact(qx + 12, qz) - hC) + Math.abs(terrain.hExact(qx, qz + 12) - hC);
      if (slope < 0.9 && rand.chance(0.8)) {
        const r = rand.float(7, 11);
        const pond = new THREE.Mesh(new THREE.CircleGeometry(r, 28), this.waterMat);
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(qx, hC + 0.1, qz);
        this.group.add(pond);
        const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 1.2, 28), this.dirtMat);
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(qx, hC + 0.145, qz);
        this.group.add(rim);
        block.pond = { x: qx, z: qz, r: r + 2 };
      }

      // Bäume im Raster mit Jitter (Teich + Wege freihalten)
      for (let x = x0 + 8; x < x1 - 8; x += rand.float(9, 15)) {
        for (let z = z0 + 8; z < z1 - 8; z += rand.float(9, 15)) {
          if (!rand.chance(0.75)) continue;
          const tx = x + rand.float(-3, 3), tz = z + rand.float(-3, 3);
          if (Math.abs(tz - cz) < 3.5 || Math.abs(tx - cx) < 3.5) continue;
          if (block.pond && Math.hypot(tx - block.pond.x, tz - block.pond.z) < block.pond.r + 2) continue;
          trees.push({ x: tx, z: tz, scale: rand.float(0.9, 1.6) });
        }
      }
    }
    if (grassGeos.length) {
      const grass = new THREE.Mesh(mergeGeometries(grassGeos), this.grassMat);
      grass.receiveShadow = true;
      this.group.add(grass);
    }
    if (pathGeos.length) {
      const paths = new THREE.Mesh(mergeGeometries(pathGeos), this.dirtMat);
      paths.receiveShadow = true;
      this.group.add(paths);
    }

    // ---- Baum-Instanzen
    if (trees.length) {
      const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 2.6, 7);
      trunkGeo.translate(0, 1.3, 0);
      const blobs = [];
      const mkBlob = (r, ox, oy, oz) => {
        const b = new THREE.IcosahedronGeometry(r, 1);
        b.translate(ox, oy, oz);
        return b;
      };
      blobs.push(mkBlob(1.5, 0, 3.7, 0));
      blobs.push(mkBlob(1.1, 0.9, 3.1, 0.4));
      blobs.push(mkBlob(1.0, -0.8, 3.2, -0.5));
      blobs.push(mkBlob(0.9, 0.1, 4.5, -0.2));
      const canopyGeo = mergeGeometries(blobs);

      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
      const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, trees.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const Y = new THREE.Vector3(0, 1, 0);
      const col = new THREE.Color();
      trees.forEach((t, k) => {
        q.setFromAxisAngle(Y, rand.float(0, Math.PI * 2));
        m.compose(
          new THREE.Vector3(t.x, terrain.hExact(t.x, t.z) + 0.13, t.z), q,
          new THREE.Vector3(t.scale, t.scale * rand.float(0.9, 1.15), t.scale)
        );
        trunkInst.setMatrixAt(k, m);
        canopyInst.setMatrixAt(k, m);
        col.setHSL(0.26 + rand.float(-0.04, 0.05), rand.float(0.4, 0.6), rand.float(0.22, 0.34));
        canopyInst.setColorAt(k, col);
      });
      trunkInst.castShadow = true;
      canopyInst.castShadow = true;
      canopyInst.receiveShadow = true;
      trunkInst.computeBoundingSphere();
      canopyInst.computeBoundingSphere();
      canopyInst.instanceColor.needsUpdate = true;
      this.group.add(trunkInst, canopyInst);
    }
  }
}
