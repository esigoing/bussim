// Prozeduraler Mensch: Kapsel-Gliedmaßen an Gelenk-Pivots, weich schattiert.
// Kleidungsfarben aus geseedeten Paletten (Material-Pools, damit nicht jede
// Figur eigene Materialien anlegt). Posen: stehen, gehen, winken, sitzen.

import * as THREE from 'three';

const SKIN_TONES = [0xe8bf9a, 0xc89066, 0x9a6a42, 0x6e4a2e, 0xf0ccab];
const SHIRT_COLORS = [0x3a4a6b, 0x6b3a3a, 0x3a6b4a, 0x5a5a5e, 0x8a7340, 0x466278, 0x7d4a68, 0x2e2e34];
const PANTS_COLORS = [0x26282e, 0x3b3e46, 0x4a3b2e, 0x2e3b4a];
const HAIR_COLORS = [0x1c1813, 0x3b2c1a, 0x6e5635, 0x8a8a8c, 0x2a2a2e];

const matPools = { skin: new Map(), shirt: new Map(), pants: new Map(), hair: new Map() };
function pooledMat(pool, color) {
  if (!matPools[pool].has(color)) {
    matPools[pool].set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.88 }));
  }
  return matPools[pool].get(color);
}

// Geometrien geteilt
const headGeo = new THREE.SphereGeometry(0.105, 12, 10);
const hairGeo = new THREE.SphereGeometry(0.108, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
const torsoGeo = new THREE.CapsuleGeometry(0.16, 0.34, 4, 10);
const armGeo = new THREE.CapsuleGeometry(0.045, 0.52, 3, 8);
armGeo.translate(0, -0.31, 0); // Pivot an der Schulter
const legGeo = new THREE.CapsuleGeometry(0.065, 0.62, 3, 8);
legGeo.translate(0, -0.37, 0); // Pivot an der Hüfte

export class HumanFigure {
  constructor(rand) {
    this.group = new THREE.Group();
    this.scale = rand.float(0.92, 1.08);

    const skin = pooledMat('skin', rand.pick(SKIN_TONES));
    const shirt = pooledMat('shirt', rand.pick(SHIRT_COLORS));
    const pants = pooledMat('pants', rand.pick(PANTS_COLORS));
    const hair = pooledMat('hair', rand.pick(HAIR_COLORS));

    // Wurzel am Boden; Körper hängt an der Hüfte
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 0.99;
    this.group.add(this.pelvis);

    this.torso = new THREE.Mesh(torsoGeo, shirt);
    this.torso.position.y = 0.33;
    this.pelvis.add(this.torso);

    this.head = new THREE.Mesh(headGeo, skin);
    this.head.position.y = 0.68;
    this.pelvis.add(this.head);
    const hairMesh = new THREE.Mesh(hairGeo, hair);
    hairMesh.position.y = 0.02;
    hairMesh.rotation.x = -0.15;
    this.head.add(hairMesh);

    this.armL = new THREE.Mesh(armGeo, shirt);
    this.armL.position.set(-0.215, 0.52, 0);
    this.pelvis.add(this.armL);
    this.armR = new THREE.Mesh(armGeo, shirt);
    this.armR.position.set(0.215, 0.52, 0);
    this.pelvis.add(this.armR);

    this.legL = new THREE.Mesh(legGeo, pants);
    this.legL.position.set(-0.09, 0.02, 0);
    this.pelvis.add(this.legL);
    this.legR = new THREE.Mesh(legGeo, pants);
    this.legR.position.set(0.09, 0.02, 0);
    this.pelvis.add(this.legR);

    this.group.scale.setScalar(this.scale);
    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; }
    });

    this.idlePhase = rand.float(0, 10);
    this._pose = 'stand';
    this._hailAmount = 0;
  }

  setPose(pose) {
    this._pose = pose;
  }

  // time: globale Zeit, walkPhase: Distanz-getriebene Phase
  update(time, walkPhase = 0) {
    const p = this._pose;

    if (p === 'sit') {
      this.pelvis.position.y = 0.62;
      this.legL.rotation.x = -1.45;
      this.legR.rotation.x = -1.45;
      this.armL.rotation.x = -0.5;
      this.armR.rotation.x = -0.5;
      this.torso.rotation.x = 0;
      return;
    }

    this.pelvis.position.y = 0.99;

    if (p === 'walk') {
      const a = Math.sin(walkPhase);
      const b = Math.sin(walkPhase + Math.PI);
      this.legL.rotation.x = a * 0.55;
      this.legR.rotation.x = b * 0.55;
      this.armL.rotation.x = b * 0.4;
      this.armR.rotation.x = a * 0.4;
      this.pelvis.position.y = 0.99 + Math.abs(Math.cos(walkPhase)) * 0.025;
      this.torso.rotation.x = 0.06;
      this._hailAmount *= 0.9;
    } else {
      // stehen: leichtes Schwanken
      const sway = Math.sin(time * 0.9 + this.idlePhase) * 0.02;
      this.legL.rotation.x = sway;
      this.legR.rotation.x = -sway;
      this.armL.rotation.x = sway * 1.5;
      this.torso.rotation.x = 0.01 + sway * 0.3;

      if (p === 'hail') {
        this._hailAmount = Math.min(1, this._hailAmount + 0.08);
      } else {
        this._hailAmount *= 0.9;
      }
      // Arm heben + leicht winken
      this.armR.rotation.x = -2.6 * this._hailAmount + Math.sin(time * 6) * 0.15 * this._hailAmount;
      this.armR.rotation.z = -0.3 * this._hailAmount;
    }
  }
}
