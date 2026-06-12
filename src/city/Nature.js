// Bäume und Stadtgrün: drei Wuchsformen (Laub-, Kugel-, Nadelbaum) als
// InstancedMeshes mit per-Instanz-Farbvariation. Straßenbäume folgen den
// Straßenkurven (Haltestellen-Häuschen bleiben frei), Parks bekommen Wiese
// (Terrain-Vertices), Wege-Kreuz, ggf. Teich sowie Büsche und Blumeninseln;
// Wohnblöcke erhalten Vorgärten mit Hecken, Plätze einen Baumkranz um den
// Brunnen. Dichte skaliert mit propsDensity, Extras über cityDetail (0–3).
// Y stets Terrain + 0.13 (Gehweg-/Block-Lift, Welt-Vertrag).

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
  constructor({ roadNet, blocks, rand, terrain, stops = [], propsDensity = 1.0, cityDetail = 2 }) {
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

    const trees = []; // {x, z, scale, type} — 0 Laub, 1 Kugel, 2 Nadel
    const { xs, zs, halfX, halfZ, segNS, segEW } = roadNet;
    const streetChance = Math.min(0.92, 0.7 * propsDensity);
    const parkChance = Math.min(0.95, 0.75 * propsDensity);
    // Haltestellen-Häuschen freihalten (9-m-Radius)
    const nearShelter = (x, z) =>
      stops.some((s) => (s.shelterPos.x - x) ** 2 + (s.shelterPos.z - z) ** 2 < 81);

    // Straßenbäume entlang der NS-Kurven (versetzt zu den Laternen)
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < segNS[i].length; j++) {
        if (!segNS[i][j]) continue;
        const z0 = zs[j] + roadNet.boundZ(j) + 17;
        const z1 = zs[j + 1] - roadNet.boundZ(j + 1) - 8;
        for (let z = z0, side = 1; z < z1; z += 27, side++) {
          if (!rand.chance(streetChance)) continue;
          const sx = side % 2 === 0 ? 1 : -1;
          const tx = roadNet.centerX(i, z) + sx * (halfX[i] + 1.4);
          if (nearShelter(tx, z)) continue;
          trees.push({ x: tx, z, scale: rand.float(0.6, 0.85), type: rand.chance(0.7) ? 0 : 1 });
        }
      }
    }
    for (let j = 0; j < zs.length; j++) {
      for (let i = 0; i < segEW[j].length; i++) {
        if (!segEW[j][i]) continue;
        const x0 = roadNet.centerX(i, zs[j]) + roadNet.boundX(i) + 17;
        const x1 = roadNet.centerX(i + 1, zs[j]) - roadNet.boundX(i + 1) - 8;
        for (let x = x0, side = 0; x < x1; x += 27, side++) {
          if (!rand.chance(streetChance)) continue;
          const sz = side % 2 === 0 ? 1 : -1;
          const tz = zs[j] + sz * (halfZ[j] + 1.4);
          if (nearShelter(x, tz)) continue;
          trees.push({ x, z: tz, scale: rand.float(0.6, 0.85), type: rand.chance(0.7) ? 0 : 1 });
        }
      }
    }

    // ---- Parks: Wiese + Wege-Kreuz + ggf. Teich + dichte Bäume, dazu
    // Büsche (cityDetail >= 1) und bunte Blumeninseln (cityDetail >= 2)
    const grassGeos = [];
    const pathGeos = [];
    const bushSpots = [];  // [x, z, scale]
    const bloomSpots = []; // {x, z, hex}
    const flowerCols = [0xc94f43, 0xd9b53e, 0x9e5bb5, 0xd887a8, 0xdde3e8];
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

      // Bäume im Raster mit Jitter (Teich + Wege freihalten), gemischte
      // Wuchsformen für mehr Formvarianz
      for (let x = x0 + 8; x < x1 - 8; x += rand.float(9, 15)) {
        for (let z = z0 + 8; z < z1 - 8; z += rand.float(9, 15)) {
          if (!rand.chance(parkChance)) continue;
          const tx = x + rand.float(-3, 3), tz = z + rand.float(-3, 3);
          if (Math.abs(tz - cz) < 3.5 || Math.abs(tx - cx) < 3.5) continue;
          if (block.pond && Math.hypot(tx - block.pond.x, tz - block.pond.z) < block.pond.r + 2) continue;
          const type = rand.chance(0.55) ? 0 : (rand.chance(0.45) ? 2 : 1);
          trees.push({ x: tx, z: tz, scale: rand.float(0.9, 1.6), type });
        }
      }

      // Büsche verstreut (Wege/Teich frei)
      if (cityDetail >= 1) {
        const count = Math.round(((x1 - x0) * (z1 - z0)) / 320 * propsDensity);
        for (let k = 0; k < count; k++) {
          const bx = rand.float(x0 + 5, x1 - 5), bz = rand.float(z0 + 5, z1 - 5);
          if (Math.abs(bx - cx) < 2.4 || Math.abs(bz - cz) < 2.4) continue;
          if (block.pond && Math.hypot(bx - block.pond.x, bz - block.pond.z) < block.pond.r + 1) continue;
          bushSpots.push([bx, bz, rand.float(0.7, 1.5)]);
        }
      }
      // Blumeninseln: zwei Farb-Tupfengruppen je Park
      if (cityDetail >= 2) {
        for (let c = 0; c < 2; c++) {
          const fx = rand.float(x0 + 9, x1 - 9), fz = rand.float(z0 + 9, z1 - 9);
          if (Math.abs(fx - cx) < 4 || Math.abs(fz - cz) < 4) continue;
          if (block.pond && Math.hypot(fx - block.pond.x, fz - block.pond.z) < block.pond.r + 2.5) continue;
          const hex = flowerCols[rand.int(0, flowerCols.length - 1)];
          for (let k = 0; k < 14; k++) {
            const a = rand.float(0, Math.PI * 2), rr = rand.float(0.3, 2.1);
            bloomSpots.push({ x: fx + Math.cos(a) * rr, z: fz + Math.sin(a) * rr, hex });
          }
        }
      }
    }

    // ---- Plätze: Baumkranz um den Brunnen (Marktstände/Kirche per
    // keepClear ausgespart, am Marktplatz größerer Radius um die Stände)
    const inKeepClear = (b, x, z) =>
      (b.keepClear || []).some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
    for (const b of blocks) {
      if (!b.plaza || !b.fountain) continue;
      const ringR = b.market ? 11.6 : 8.6;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + rand.float(-0.12, 0.12);
        const tx = b.fountain.x + Math.cos(a) * ringR;
        const tz = b.fountain.z + Math.sin(a) * ringR;
        if (tx < b.x0 + 3.5 || tx > b.x1 - 3.5 || tz < b.z0 + 3.5 || tz > b.z1 - 3.5) continue;
        if (inKeepClear(b, tx, tz)) continue;
        trees.push({ x: tx, z: tz, scale: rand.float(0.62, 0.8), type: 1 });
      }
    }

    // ---- Wohnviertel: Vorgärten (Grasstreifen hinter dem Gehweg) mit
    // Heckenreihen und vereinzelten Bäumchen. Bay-Seiten bleiben frei,
    // Einbuchtungen/Gehweg werden nie berührt (Versatz >= 2.6 m hinter der
    // konservativen Blockkante, NS-Kurvenauslenkung steckt bereits in x0/x1).
    const hedgeSpots = []; // [x, z, yaw]
    if (cityDetail >= 1) {
      for (const b of blocks) {
        if (b.district !== 'wohnen' || b.park || b.plaza || b.landmark) continue;
        const hasBay = (side) => b.bays && b.bays.some((bay) => bay.side === side);
        const sides = [];
        if (segEW[b.j][b.i] && !hasBay('z0')) sides.push('z0');
        if (segEW[b.j + 1][b.i] && !hasBay('z1')) sides.push('z1');
        if (segNS[b.i][b.j]) sides.push('x0');
        if (segNS[b.i + 1][b.j]) sides.push('x1');
        for (const side of sides) {
          if (!rand.chance(0.6)) continue;
          if (side === 'z0' || side === 'z1') {
            const gx0 = b.x0 + 2.6, gx1 = b.x1 - 2.6;
            if (gx1 - gx0 < 8) continue;
            const zEdge = side === 'z0' ? b.z0 : b.z1;
            const zIn = side === 'z0' ? 1 : -1;
            const sz0 = Math.min(zEdge + zIn * 2.6, zEdge + zIn * 4.0);
            const sz1 = Math.max(zEdge + zIn * 2.6, zEdge + zIn * 4.0);
            grassGeos.push(terrainPatch(gx0, sz0, gx1, sz1, terrain, 0.137, 1 / 4));
            const hz = zEdge + zIn * 3.0;
            for (let x = gx0 + 1.6; x < gx1 - 1.4; x += 3.1) {
              if (!rand.chance(0.82)) continue; // Lücken = Eingänge/Einfahrten
              hedgeSpots.push([x, hz, 0]);
            }
            if (rand.chance(0.5)) {
              trees.push({
                x: rand.float(gx0 + 3, gx1 - 3), z: zEdge + zIn * 3.3,
                scale: rand.float(0.4, 0.55), type: 1,
              });
            }
          } else {
            const gz0 = b.z0 + 4.2, gz1 = b.z1 - 4.2;
            if (gz1 - gz0 < 8) continue;
            const xEdge = side === 'x0' ? b.x0 : b.x1;
            const xIn = side === 'x0' ? 1 : -1;
            const sx0 = Math.min(xEdge + xIn * 2.6, xEdge + xIn * 4.0);
            const sx1 = Math.max(xEdge + xIn * 2.6, xEdge + xIn * 4.0);
            grassGeos.push(terrainPatch(sx0, gz0, sx1, gz1, terrain, 0.137, 1 / 4));
            const hx = xEdge + xIn * 3.0;
            for (let z = gz0 + 1.6; z < gz1 - 1.4; z += 3.1) {
              if (!rand.chance(0.82)) continue;
              hedgeSpots.push([hx, z, Math.PI / 2]);
            }
            if (rand.chance(0.5)) {
              trees.push({
                x: xEdge + xIn * 3.3, z: rand.float(gz0 + 3, gz1 - 3),
                scale: rand.float(0.4, 0.55), type: 1,
              });
            }
          }
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

    // ---- Baum-Instanzen: je Wuchsform ein Stamm- + Kronen-InstancedMesh
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const mkBlob = (r, ox, oy, oz) => new THREE.IcosahedronGeometry(r, 1).translate(ox, oy, oz);
    const trunkGeos = [
      new THREE.CylinderGeometry(0.12, 0.2, 2.6, 7).translate(0, 1.3, 0),
      new THREE.CylinderGeometry(0.1, 0.17, 2.4, 7).translate(0, 1.2, 0),
      new THREE.CylinderGeometry(0.09, 0.16, 1.6, 7).translate(0, 0.8, 0),
    ];
    const canopyGeos = [
      // Laubbaum: unregelmäßige Blob-Krone (wie bisher)
      mergeGeometries([
        mkBlob(1.5, 0, 3.7, 0), mkBlob(1.1, 0.9, 3.1, 0.4),
        mkBlob(1.0, -0.8, 3.2, -0.5), mkBlob(0.9, 0.1, 4.5, -0.2),
      ]),
      // Kugelbaum: kompakte runde Krone (Stadtbaum)
      mergeGeometries([mkBlob(1.4, 0, 3.3, 0), mkBlob(0.9, 0.55, 3.85, 0.25)]),
      // Nadelbaum: drei gestaffelte Kegel
      mergeGeometries([
        new THREE.ConeGeometry(1.6, 2.6, 8).translate(0, 2.5, 0),
        new THREE.ConeGeometry(1.2, 2.2, 8).translate(0, 3.9, 0),
        new THREE.ConeGeometry(0.75, 1.9, 8).translate(0, 5.2, 0),
      ]),
    ];
    const byType = [[], [], []];
    for (const t of trees) byType[t.type].push(t);
    byType.forEach((list, type) => {
      if (!list.length) return;
      const trunkInst = new THREE.InstancedMesh(trunkGeos[type], trunkMat, list.length);
      const canopyInst = new THREE.InstancedMesh(canopyGeos[type], canopyMat, list.length);
      list.forEach((t, k) => {
        q.setFromAxisAngle(Y, rand.float(0, Math.PI * 2));
        m.compose(
          new THREE.Vector3(t.x, terrain.hExact(t.x, t.z) + 0.13, t.z), q,
          new THREE.Vector3(t.scale, t.scale * rand.float(0.9, 1.15), t.scale)
        );
        trunkInst.setMatrixAt(k, m);
        canopyInst.setMatrixAt(k, m);
        if (type === 2) {
          col.setHSL(0.34 + rand.float(0, 0.07), rand.float(0.3, 0.45), rand.float(0.15, 0.24));
        } else {
          col.setHSL(0.26 + rand.float(-0.04, 0.05), rand.float(0.4, 0.6), rand.float(0.22, 0.34));
        }
        canopyInst.setColorAt(k, col);
      });
      trunkInst.castShadow = true;
      canopyInst.castShadow = true;
      canopyInst.receiveShadow = true;
      trunkInst.computeBoundingSphere();
      canopyInst.computeBoundingSphere();
      canopyInst.instanceColor.needsUpdate = true;
      this.group.add(trunkInst, canopyInst);
    });

    // ---- Hecken (Vorgärten): Boxen mit Grünton-/Größenvariation
    if (hedgeSpots.length) {
      const hedgeGeo = new THREE.BoxGeometry(2.5, 0.78, 0.72).translate(0, 0.39, 0);
      const inst = new THREE.InstancedMesh(hedgeGeo, canopyMat, hedgeSpots.length);
      const s = new THREE.Vector3();
      hedgeSpots.forEach(([x, z, yaw], k) => {
        q.setFromAxisAngle(Y, yaw);
        s.set(rand.float(0.85, 1.05), rand.float(0.8, 1.15), rand.float(0.85, 1.1));
        m.compose(new THREE.Vector3(x, terrain.hExact(x, z) + 0.13, z), q, s);
        inst.setMatrixAt(k, m);
        col.setHSL(0.3 + rand.float(-0.03, 0.04), rand.float(0.35, 0.5), rand.float(0.18, 0.28));
        inst.setColorAt(k, col);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }

    // ---- Park-Büsche: Doppel-Blob mit Farb-/Größenvariation
    if (bushSpots.length) {
      const bushGeo = mergeGeometries([
        new THREE.IcosahedronGeometry(0.62, 1).translate(0, 0.42, 0),
        new THREE.IcosahedronGeometry(0.42, 1).translate(0.45, 0.3, 0.2),
      ]);
      const inst = new THREE.InstancedMesh(bushGeo, canopyMat, bushSpots.length);
      const s = new THREE.Vector3();
      bushSpots.forEach(([x, z, sc], k) => {
        q.setFromAxisAngle(Y, rand.float(0, Math.PI * 2));
        s.set(sc, sc * rand.float(0.8, 1.05), sc);
        m.compose(new THREE.Vector3(x, terrain.hExact(x, z) + 0.13, z), q, s);
        inst.setMatrixAt(k, m);
        col.setHSL(0.28 + rand.float(-0.04, 0.05), rand.float(0.38, 0.55), rand.float(0.2, 0.3));
        inst.setColorAt(k, col);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }

    // ---- Blumeninseln: kleine Blüten-Tupfer über der Parkwiese
    if (bloomSpots.length) {
      const bloomGeo = new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.16, 0);
      const bloomMat = Mat.std({ color: 0xffffff, roughness: 0.7 });
      const inst = new THREE.InstancedMesh(bloomGeo, bloomMat, bloomSpots.length);
      bloomSpots.forEach((f, k) => {
        m.makeTranslation(f.x, terrain.hExact(f.x, f.z) + 0.13, f.z);
        inst.setMatrixAt(k, m);
        inst.setColorAt(k, col.setHex(f.hex));
      });
      inst.castShadow = false;
      inst.computeBoundingSphere();
      inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }
  }
}
