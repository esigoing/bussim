// Straßenmobiliar: Laternen (instanziert, nachts emissiv + Lichtpool),
// Bänke, Mülleimer. Positionen folgen den Straßenkurven und dem Terrain.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';

export class Props {
  constructor({ roadNet, rand, terrain }) {
    this.group = new THREE.Group();
    this.lampPositions = []; // Vector3 der Leuchtköpfe (für den Lichtpool)

    const lampPoleMat = Mat.std({ color: 0x2e3134, roughness: 0.55, metalness: 0.6 });
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: 0xd8d4c8, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4,
    });
    const benchMat = Mat.std({ color: 0x6b4a2f, roughness: 0.85 });
    const binMat = Mat.std({ color: 0x2f4f38, roughness: 0.7, metalness: 0.3 });

    const lampPos = [];   // [x, z, rotY]
    const benchPos = [];
    const binPos = [];
    const { xs, zs, halfX, halfZ, segNS, segEW } = roadNet;

    // Entlang der NS-Kurven
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < segNS[i].length; j++) {
        if (!segNS[i][j]) continue;
        const z0 = zs[j] + roadNet.boundZ(j) + 4;
        const z1 = zs[j + 1] - roadNet.boundZ(j + 1) - 4;
        for (let z = z0, side = 0; z < z1; z += 27, side++) {
          const sx = side % 2 === 0 ? 1 : -1;
          const cx = roadNet.centerX(i, z);
          lampPos.push([cx + sx * (halfX[i] + 1.0), z, Math.PI / 2 * sx]);
          if (rand.chance(0.12)) binPos.push([cx + sx * (halfX[i] + 1.9), z + 4, 0]);
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
          if (rand.chance(0.1)) benchPos.push([x + 5, zs[j] + sz * (halfZ[j] + 2.0), sz > 0 ? Math.PI : 0]);
        }
      }
    }

    const groundAt = (x, z) => terrain.hExact(x, z) + 0.13;

    // --- Laternen: Mast + Ausleger + Kopf
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 6.4, 8);
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
    armGeo.rotateZ(Math.PI / 2);
    const headGeo = new THREE.BoxGeometry(0.55, 0.13, 0.24);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);

    const poleInst = new THREE.InstancedMesh(poleGeo, lampPoleMat, lampPos.length);
    const armInst = new THREE.InstancedMesh(armGeo, lampPoleMat, lampPos.length);
    this.headInst = new THREE.InstancedMesh(headGeo, this.lampHeadMat, lampPos.length);
    lampPos.forEach(([x, z, rot], k) => {
      const gy = groundAt(x, z);
      m.makeTranslation(x, gy + 3.2, z);
      poleInst.setMatrixAt(k, m);
      q.setFromAxisAngle(Y, rot);
      m.compose(new THREE.Vector3(x, gy + 6.25, z), q, new THREE.Vector3(1, 1, 1));
      armInst.setMatrixAt(k, m);
      const hx = x + Math.cos(rot) * 0.8;
      const hz = z - Math.sin(rot) * 0.8;
      m.compose(new THREE.Vector3(hx, gy + 6.3, hz), q, new THREE.Vector3(1, 1, 1));
      this.headInst.setMatrixAt(k, m);
      this.lampPositions.push(new THREE.Vector3(hx, gy + 5.9, hz));
    });
    for (const inst of [poleInst, armInst, this.headInst]) {
      inst.castShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }

    // --- Bänke
    if (benchPos.length) {
      const benchGeo = new THREE.BoxGeometry(1.7, 0.08, 0.5);
      const benchInst = new THREE.InstancedMesh(benchGeo, benchMat, benchPos.length);
      benchPos.forEach(([x, z, rot], k) => {
        q.setFromAxisAngle(Y, rot);
        m.compose(new THREE.Vector3(x, groundAt(x, z) + 0.42, z), q, new THREE.Vector3(1, 1, 1));
        benchInst.setMatrixAt(k, m);
      });
      benchInst.castShadow = true;
      benchInst.computeBoundingSphere();
      this.group.add(benchInst);
    }

    // --- Mülleimer
    if (binPos.length) {
      const binGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.62, 10);
      const binInst = new THREE.InstancedMesh(binGeo, binMat, binPos.length);
      binPos.forEach(([x, z], k) => {
        m.makeTranslation(x, groundAt(x, z) + 0.31, z);
        binInst.setMatrixAt(k, m);
      });
      binInst.castShadow = true;
      binInst.computeBoundingSphere();
      this.group.add(binInst);
    }
  }

  update(env) {
    this.lampHeadMat.emissiveIntensity = env.night * 4.0;
  }
}
