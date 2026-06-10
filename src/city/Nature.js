// Bäume und Parkgrün: Stämme + unregelmäßige Kronen als InstancedMesh
// mit per-Instanz-Farbvariation. Straßenbäume entlang der Gehwege,
// dichte Bepflanzung in Parkblöcken.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { grassTextures, dirtTextures } from '../graphics/materials/TextureGen.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class Nature {
  constructor({ roadNet, blocks, rand }) {
    this.group = new THREE.Group();

    const trunkMat = Mat.std({ color: 0x5a4634, roughness: 0.95 });
    const canopyMat = Mat.std({ color: 0xffffff, roughness: 0.95 });
    const grassTex = grassTextures(512, 6);
    grassTex.map.repeat.set(8, 8);
    grassTex.normalMap.repeat.set(8, 8);
    grassTex.roughnessMap.repeat.set(8, 8);
    this.grassMat = Mat.std({ ...grassTex, color: 0xffffff }, { wet: true });
    const dirtTex = dirtTextures();
    this.dirtMat = Mat.std({ ...dirtTex, color: 0xffffff });

    const trees = []; // {x, z, scale, hue}
    const { xs, zs, halfX, halfZ, segNS, segEW } = roadNet;

    // Straßenbäume (versetzt zu den Laternen)
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < segNS[i].length; j++) {
        if (!segNS[i][j]) continue;
        const z0 = zs[j] + roadNet.boundZ(j) + 17;
        const z1 = zs[j + 1] - roadNet.boundZ(j + 1) - 8;
        for (let z = z0, side = 1; z < z1; z += 27, side++) {
          if (!rand.chance(0.7)) continue;
          const sx = side % 2 === 0 ? 1 : -1;
          // Straßenbäume kleiner, damit die Krone nicht in Fassaden wächst
          trees.push({ x: xs[i] + sx * (halfX[i] + 1.4), z, scale: rand.float(0.6, 0.85) });
        }
      }
    }
    for (let j = 0; j < zs.length; j++) {
      for (let i = 0; i < segEW[j].length; i++) {
        if (!segEW[j][i]) continue;
        const x0 = xs[i] + roadNet.boundX(i) + 17;
        const x1 = xs[i + 1] - roadNet.boundX(i + 1) - 8;
        for (let x = x0, side = 0; x < x1; x += 27, side++) {
          if (!rand.chance(0.7)) continue;
          const sz = side % 2 === 0 ? 1 : -1;
          trees.push({ x, z: zs[j] + sz * (halfZ[j] + 1.6), scale: rand.float(0.8, 1.2) });
        }
      }
    }

    // Parks: Wiese + dichte Bäume + Wege (Dirt)
    const grassGeos = [];
    for (const block of blocks) {
      if (!block.park) continue;
      const { x0, z0, x1, z1 } = block;
      const g = new THREE.PlaneGeometry(x1 - x0 - 5, z1 - z0 - 5);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0.135, (z0 + z1) / 2);
      grassGeos.push(g);
      // Bäume im Raster mit Jitter
      for (let x = x0 + 8; x < x1 - 8; x += rand.float(9, 15)) {
        for (let z = z0 + 8; z < z1 - 8; z += rand.float(9, 15)) {
          if (rand.chance(0.75)) {
            trees.push({
              x: x + rand.float(-3, 3), z: z + rand.float(-3, 3),
              scale: rand.float(0.9, 1.6),
            });
          }
        }
      }
    }
    if (grassGeos.length) {
      const grass = new THREE.Mesh(mergeGeometries(grassGeos), this.grassMat);
      grass.receiveShadow = true;
      this.group.add(grass);
    }

    // --- Baum-Instanzen
    if (trees.length) {
      const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 2.6, 7);
      trunkGeo.translate(0, 1.3, 0);
      // Krone: drei verschobene Ikosaeder zu einer Geometrie gemerged
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
          new THREE.Vector3(t.x, 0.13, t.z), q,
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
