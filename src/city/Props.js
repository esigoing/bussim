// Straßenmobiliar: Laternen (instanziert, nachts emissiv + Lichtpool),
// Bänke, Mülleimer und Straßenrand-Leben — Fahrradständer, Hydranten,
// Litfaßsäulen, Blumenbeete, Poller. Die Dichte skaliert mit propsDensity,
// Extras sind über cityDetail (0–3) gestuft; die Defaults entsprechen dem
// mittleren Stadtbild. Geparkte Autos stehen AUSSCHLIESSLICH auf den
// Stellflächen der Block-Einbuchtungen (CityGen._assignBays), nie auf
// Fahrbahn oder Gehweg. Alle Positionen folgen den Straßenkurven und dem
// Terrain: Y = Terrain + 0.13 (Gehweg-/Block-Lift, Welt-Vertrag).

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { posterTexture } from './TextureGen.js';

export class Props {
  constructor({ roadNet, rand, terrain, blocks = [], stops = [], propsDensity = 1.0, cityDetail = 2 }) {
    this.group = new THREE.Group();
    this.lampPositions = []; // Vector3 der Leuchtköpfe (für den Lichtpool)

    const lampPoleMat = Mat.std({ color: 0x2e3134, roughness: 0.55, metalness: 0.6 });
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: 0xd8d4c8, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4,
    });
    const benchMat = Mat.std({ color: 0x6b4a2f, roughness: 0.85 });
    const binMat = Mat.std({ color: 0x2f4f38, roughness: 0.7, metalness: 0.3 });

    const { xs, zs, halfX, halfZ, segNS, segEW } = roadNet;
    // Wahrscheinlichkeiten skalieren mit der Preset-Dichte
    const p = (base) => Math.min(0.95, base * propsDensity);

    // Blockzelle → Viertel (steuert die Möblierungs-Auswahl)
    const blockMap = new Map();
    for (const b of blocks) blockMap.set(`${b.i},${b.j}`, b);
    const cellIndex = (arr, v) => {
      for (let k = 0; k < arr.length - 1; k++) {
        if (v >= arr[k] && v <= arr[k + 1]) return k;
      }
      return -1;
    };
    const districtAt = (x, z) => {
      const b = blockMap.get(`${cellIndex(xs, x)},${cellIndex(zs, z)}`);
      return (b && b.district) || 'wohnen';
    };
    // Haltestellen-Häuschen freihalten (9-m-Radius um die Häuschen-Position)
    const nearShelter = (x, z) =>
      stops.some((s) => (s.shelterPos.x - x) ** 2 + (s.shelterPos.z - z) ** 2 < 81);

    const lampPos = [];    // [x, z, rotY]
    const benchPos = [];
    const binPos = [];
    const rackPos = [];    // Fahrradständer
    const hydrantPos = [];
    const columnPos = [];  // Litfaßsäulen
    const planterPos = []; // Blumenbeete
    const bollardPos = [];

    // Würfelt an einem Straßenrand-Punkt höchstens EIN Möbelstück.
    // at(off, dl) → [x, z] im Querabstand off von der Fahrbahnkante
    // (Gehwegband 0…2.5 m) und Längsversatz dl entlang der Straße.
    // yawAlong = Straßenrichtung (Reihen-Objekte), yawFace = Blick zur Fahrbahn.
    const sampleLife = (at, yawAlong, yawFace) => {
      const [px, pz] = at(1.25, 0);
      if (nearShelter(px, pz)) return;
      const district = districtAt(px, pz);
      const old = district === 'altstadt';
      const busy = old || district === 'geschaeft';
      if (cityDetail >= 2 && busy && rand.chance(p(0.05))) {
        const [x, z] = at(1.95, 0);
        columnPos.push([x, z, rand.float(0, Math.PI * 2)]);
      } else if (cityDetail >= 1 && district !== 'gewerbe' && rand.chance(p(busy ? 0.09 : 0.05))) {
        const [x, z] = at(1.7, 0);
        rackPos.push([x, z, yawAlong]);
      } else if (cityDetail >= 1 && (old || district === 'wohnen') && rand.chance(p(0.07))) {
        const [x, z] = at(1.95, 0);
        planterPos.push([x, z, yawAlong]);
      } else if (rand.chance(p(0.1))) {
        const [x, z] = at(1.9, 0);
        binPos.push([x, z, rand.float(0, Math.PI * 2)]);
      } else if (rand.chance(p(0.07))) {
        const [x, z] = at(2.0, 0);
        benchPos.push([x, z, yawFace]);
      } else if (rand.chance(p(0.045))) {
        const [x, z] = at(0.7, 0);
        hydrantPos.push([x, z, rand.float(0, Math.PI * 2)]);
      } else if (cityDetail >= 3 && old && rand.chance(p(0.06))) {
        // Poller-Dreiergruppe nahe der Bordsteinkante (nur höchste Stufe)
        for (const dl of [-1.5, 0, 1.5]) {
          const [x, z] = at(0.5, dl);
          bollardPos.push([x, z, 0]);
        }
      }
    };

    // Entlang der NS-Kurven: Laternen alle 27 m, Straßenrand-Leben alle 9 m
    // (um 4.5 m versetzt → kollidiert nie mit den Lampenmasten)
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < segNS[i].length; j++) {
        if (!segNS[i][j]) continue;
        const z0 = zs[j] + roadNet.boundZ(j) + 4;
        const z1 = zs[j + 1] - roadNet.boundZ(j + 1) - 4;
        for (let z = z0, side = 0; z < z1; z += 27, side++) {
          const sx = side % 2 === 0 ? 1 : -1;
          lampPos.push([roadNet.centerX(i, z) + sx * (halfX[i] + 1.0), z, Math.PI / 2 * sx]);
        }
        for (let z = z0 + 4.5, n = 0; z < z1; z += 9, n++) {
          const sx = n % 2 === 0 ? -1 : 1;
          sampleLife(
            (off, dl) => {
              const zz = z + dl;
              return [roadNet.centerX(i, zz) + sx * (halfX[i] + off), zz];
            },
            Math.PI / 2, -sx * (Math.PI / 2)
          );
        }
      }
    }
    // Entlang der EW-Straßen
    for (let j = 0; j < zs.length; j++) {
      for (let i = 0; i < segEW[j].length; i++) {
        if (!segEW[j][i]) continue;
        const x0 = roadNet.centerX(i, zs[j]) + roadNet.boundX(i) + 4;
        const x1 = roadNet.centerX(i + 1, zs[j]) - roadNet.boundX(i + 1) - 4;
        for (let x = x0, side = 0; x < x1; x += 27, side++) {
          const sz = side % 2 === 0 ? 1 : -1;
          lampPos.push([x, zs[j] + sz * (halfZ[j] + 1.0), sz > 0 ? Math.PI : 0]);
        }
        for (let x = x0 + 4.5, n = 0; x < x1; x += 9, n++) {
          const sz = n % 2 === 0 ? -1 : 1;
          sampleLife(
            (off, dl) => [x + dl, zs[j] + sz * (halfZ[j] + off)],
            0, sz > 0 ? Math.PI : 0
          );
        }
      }
    }

    const groundAt = (x, z) => terrain.hExact(x, z) + 0.13;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const ONE = new THREE.Vector3(1, 1, 1);

    // Instanzen aus [x, z, rotY]-Listen bauen (Geometrien stehen auf y=0)
    const addInst = (geo, mat, list, { cast = true, lift = 0 } = {}) => {
      if (!list.length) return null;
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, rot], k) => {
        q.setFromAxisAngle(Y, rot || 0);
        m.compose(new THREE.Vector3(x, groundAt(x, z) + lift, z), q, ONE);
        inst.setMatrixAt(k, m);
      });
      inst.castShadow = cast;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
      return inst;
    };

    // --- Laternen: Mast + Ausleger + Kopf
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 6.4, 8);
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
    armGeo.rotateZ(Math.PI / 2);
    const headGeo = new THREE.BoxGeometry(0.55, 0.13, 0.24);

    const poleInst = new THREE.InstancedMesh(poleGeo, lampPoleMat, lampPos.length);
    const armInst = new THREE.InstancedMesh(armGeo, lampPoleMat, lampPos.length);
    this.headInst = new THREE.InstancedMesh(headGeo, this.lampHeadMat, lampPos.length);
    lampPos.forEach(([x, z, rot], k) => {
      const gy = groundAt(x, z);
      m.makeTranslation(x, gy + 3.2, z);
      poleInst.setMatrixAt(k, m);
      q.setFromAxisAngle(Y, rot);
      m.compose(new THREE.Vector3(x, gy + 6.25, z), q, ONE);
      armInst.setMatrixAt(k, m);
      const hx = x + Math.cos(rot) * 0.8;
      const hz = z - Math.sin(rot) * 0.8;
      m.compose(new THREE.Vector3(hx, gy + 6.3, hz), q, ONE);
      this.headInst.setMatrixAt(k, m);
      this.lampPositions.push(new THREE.Vector3(hx, gy + 5.9, hz));
    });
    for (const inst of [poleInst, armInst, this.headInst]) {
      inst.castShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }

    // --- Bänke: Sitzfläche + Lehne + Füße (Lehne zeigt von der Straße weg)
    const benchGeo = mergeGeometries([
      new THREE.BoxGeometry(1.7, 0.08, 0.5).translate(0, 0.46, 0),
      new THREE.BoxGeometry(1.7, 0.45, 0.07).translate(0, 0.72, -0.27),
      new THREE.BoxGeometry(0.07, 0.46, 0.46).translate(-0.74, 0.23, 0),
      new THREE.BoxGeometry(0.07, 0.46, 0.46).translate(0.74, 0.23, 0),
    ]);
    addInst(benchGeo, benchMat, benchPos);

    // --- Mülleimer
    const binGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.62, 10).translate(0, 0.31, 0);
    addInst(binGeo, binMat, binPos);

    // --- Fahrradständer: drei Anlehnbügel in Reihe (Reihe = lokale x-Achse)
    if (rackPos.length) {
      const rackParts = [];
      for (const dx of [-0.55, 0, 0.55]) {
        rackParts.push(new THREE.CylinderGeometry(0.028, 0.028, 0.78, 6).translate(dx, 0.39, -0.3));
        rackParts.push(new THREE.CylinderGeometry(0.028, 0.028, 0.78, 6).translate(dx, 0.39, 0.3));
        rackParts.push(new THREE.CylinderGeometry(0.028, 0.028, 0.66, 6).rotateX(Math.PI / 2).translate(dx, 0.76, 0));
      }
      addInst(mergeGeometries(rackParts), lampPoleMat, rackPos);
    }

    // --- Hydranten: Fuß + Körper + Haube + Anschlussstutzen
    if (hydrantPos.length) {
      const hydrantMat = Mat.std({ color: 0x9e2f28, roughness: 0.5, metalness: 0.35 });
      const hydrantGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.17, 0.19, 0.08, 10).translate(0, 0.04, 0),
        new THREE.CylinderGeometry(0.13, 0.15, 0.5, 10).translate(0, 0.33, 0),
        new THREE.SphereGeometry(0.13, 10, 8).translate(0, 0.58, 0),
        new THREE.CylinderGeometry(0.045, 0.045, 0.4, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0),
        new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6).rotateX(Math.PI / 2).translate(0, 0.42, 0.15),
        new THREE.CylinderGeometry(0.045, 0.045, 0.09, 6).translate(0, 0.7, 0),
      ]);
      addInst(hydrantGeo, hydrantMat, hydrantPos);
    }

    // --- Litfaßsäulen: Plakat-Zylinder + dunkelgrüner Sockel/Haube
    if (columnPos.length) {
      const posterMat = Mat.std({ map: posterTexture(rand.int(1, 9999)), roughness: 0.85 });
      const colGeo = new THREE.CylinderGeometry(0.62, 0.62, 2.45, 14, 1, true).translate(0, 1.42, 0);
      addInst(colGeo, posterMat, columnPos);
      const trimMat = Mat.std({ color: 0x37463c, roughness: 0.6, metalness: 0.2 });
      const trimGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.7, 0.74, 0.4, 14).translate(0, 0.2, 0),
        new THREE.CylinderGeometry(0.72, 0.66, 0.22, 14).translate(0, 2.74, 0),
        new THREE.ConeGeometry(0.68, 0.55, 14).translate(0, 3.1, 0),
      ]);
      addInst(trimGeo, trimMat, columnPos);
    }

    // --- Blumenbeete: Betontrog + Grünpolster + Blüten (Farbe je Trog)
    if (planterPos.length) {
      const planterMat = Mat.std({ color: 0xa8a49b, roughness: 0.95 });
      addInst(new THREE.BoxGeometry(1.8, 0.42, 0.66).translate(0, 0.21, 0), planterMat, planterPos);
      const greensMat = Mat.std({ color: 0x33502e, roughness: 0.95 });
      // toNonIndexed: Box ist indiziert, Ikosaeder nicht — Merge braucht einheitlich
      const greens = [new THREE.BoxGeometry(1.64, 0.1, 0.52).toNonIndexed().translate(0, 0.42, 0)];
      for (let k = 0; k < 5; k++) {
        greens.push(new THREE.IcosahedronGeometry(0.13, 0)
          .translate(-0.66 + k * 0.33, 0.52, k % 2 === 0 ? 0.1 : -0.12));
      }
      addInst(mergeGeometries(greens), greensMat, planterPos, { cast: false });
      const bloomMat = Mat.std({ color: 0xffffff, roughness: 0.7 });
      const blooms = [];
      for (let k = 0; k < 6; k++) {
        blooms.push(new THREE.IcosahedronGeometry(0.07, 0)
          .translate(-0.7 + k * 0.28, 0.61, k % 2 === 0 ? -0.08 : 0.12));
      }
      const bloomInst = addInst(mergeGeometries(blooms), bloomMat, planterPos, { cast: false });
      const bloomCols = [0xc94f43, 0xd9b53e, 0x9e5bb5, 0xd887a8];
      const col = new THREE.Color();
      planterPos.forEach((_, k) => {
        bloomInst.setColorAt(k, col.setHex(bloomCols[rand.int(0, bloomCols.length - 1)]));
      });
      bloomInst.instanceColor.needsUpdate = true;
    }

    // --- Poller (Altstadt, nur cityDetail 3)
    if (bollardPos.length) {
      const bollardGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.05, 0.065, 0.8, 8).translate(0, 0.4, 0),
        new THREE.SphereGeometry(0.065, 8, 6).translate(0, 0.8, 0),
      ]);
      addInst(bollardGeo, lampPoleMat, bollardPos, { cast: false });
    }

    // --- Geparkte Autos: NUR auf den Bay-Stellflächen (Längsparker entlang
    // x, Bay-Mittellinie liegt 4.55 m hinter der Blockkante → weder Fahrbahn
    // noch Gehweg werden berührt). Lift 0.02 = Stellflächen-Belag.
    const carSpots = [];
    for (const b of blocks) {
      if (!b.bays) continue;
      for (const bay of b.bays) {
        for (let x = bay.x0 + 2.4; x <= bay.x1 - 2.4; x += 5.7) {
          if (!rand.chance(p(0.6))) continue;
          carSpots.push([
            x + rand.float(-0.2, 0.2),
            bay.z + rand.float(-0.1, 0.1),
            (rand.chance(0.5) ? 1 : -1) * Math.PI / 2 + rand.float(-0.03, 0.03),
          ]);
        }
      }
    }
    if (carSpots.length) {
      const paintGeo = mergeGeometries([
        new THREE.BoxGeometry(1.74, 0.6, 4.35).translate(0, 0.62, 0),
        new THREE.BoxGeometry(1.6, 0.52, 2.3).translate(0, 1.16, 0.15),
      ]);
      const darkParts = [
        new THREE.BoxGeometry(1.64, 0.34, 2.36).translate(0, 1.14, 0.15), // Glasband
        new THREE.BoxGeometry(1.78, 0.18, 0.24).translate(0, 0.46, -2.2), // Stoßfänger
        new THREE.BoxGeometry(1.78, 0.18, 0.24).translate(0, 0.46, 2.2),
      ];
      for (const [wx, wz] of [[-0.78, -1.38], [0.78, -1.38], [-0.78, 1.38], [0.78, 1.38]]) {
        darkParts.push(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10)
          .rotateZ(Math.PI / 2).translate(wx, 0.32, wz));
      }
      const paintMat = Mat.std({ color: 0xffffff, roughness: 0.35, metalness: 0.55, envMapIntensity: 0.8 });
      const darkMat = Mat.std({ color: 0x1d1f23, roughness: 0.55, metalness: 0.2 });
      const paintInst = addInst(paintGeo, paintMat, carSpots, { lift: 0.02 });
      addInst(mergeGeometries(darkParts), darkMat, carSpots, { cast: false, lift: 0.02 });
      const palette = [0xc8cdd2, 0x23262b, 0x7e2620, 0x1d3a63, 0xd8d5cc, 0x39473b, 0x8c7c5a];
      const col = new THREE.Color();
      carSpots.forEach((_, k) => {
        paintInst.setColorAt(k, col.setHex(palette[rand.int(0, palette.length - 1)]));
      });
      paintInst.instanceColor.needsUpdate = true;
    }
  }

  update(env) {
    this.lampHeadMat.emissiveIntensity = env.night * 4.0;
  }
}
