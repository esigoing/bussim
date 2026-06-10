// Ampelsteuerung pro Kreuzung: 2 Phasen (NS/EW) + Gelb + Allrot.
// Die Lampen sind InstancedMesh-Kugeln, deren Farben hier umgeschaltet
// werden. CarAI fragt controller.isGreen(axis) ab.

import * as THREE from 'three';

const GREEN_TIME = 14, YELLOW_TIME = 3, ALL_RED = 1.5;
const CYCLE = (GREEN_TIME + YELLOW_TIME + ALL_RED) * 2;

export class SignalController {
  constructor(offset = 0) {
    this.t = offset % CYCLE;
  }

  update(dt) {
    this.t = (this.t + dt) % CYCLE;
  }

  // 'NS' | 'EW' → 'green' | 'yellow' | 'red'
  state(axis) {
    const half = CYCLE / 2;
    const local = axis === 'NS' ? this.t : (this.t + half) % CYCLE;
    if (local < GREEN_TIME) return 'green';
    if (local < GREEN_TIME + YELLOW_TIME) return 'yellow';
    return 'red';
  }

  isGreen(axis) {
    return this.state(axis) === 'green';
  }
}

export class TrafficLights {
  constructor(parent, Mat) {
    this.controllers = [];
    this.heads = []; // {controller, axis, lampIndex(3er-Basis)}
    this.parent = parent;

    this.poleMat = Mat.std({ color: 0x3a3d40, roughness: 0.6, metalness: 0.5 });
    this.boxMat = Mat.std({ color: 0x1c1e20, roughness: 0.55 });
    this.poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8);
    this.boxGeo = new THREE.BoxGeometry(0.3, 0.78, 0.2);

    this._poles = [];
    this._boxes = [];
    this._lampData = []; // {x,y,z}

    this.lampMesh = null;
    this._colorOff = new THREE.Color(0x141414);
    this._colors = {
      red: new THREE.Color(8, 0.4, 0.3),       // HDR für Bloom
      yellow: new THREE.Color(6, 4.2, 0.4),
      green: new THREE.Color(0.4, 7, 1.2),
    };
  }

  // Kreuzung mit Ampeln ausstatten. center: Vector3, halfNS/halfEW: Fahrbahn-Halbbreiten
  addIntersection(center, halfX, halfZ, offset) {
    const ctrl = new SignalController(offset);
    this.controllers.push(ctrl);

    // Vier Masten an den Ecken, Ampelkopf zeigt dem ankommenden Verkehr entgegen.
    // Verkehr Richtung +z (NS) hält an der Süd-Seite → Kopf an z = center.z - halfZ...
    // Einfach: pro Achse zwei Köpfe an gegenüberliegenden Ecken.
    const corners = [
      { x: center.x - halfX - 1.2, z: center.z - halfZ - 1.2, axis: 'NS', rotY: 0 },
      { x: center.x + halfX + 1.2, z: center.z + halfZ + 1.2, axis: 'NS', rotY: Math.PI },
      { x: center.x + halfX + 1.2, z: center.z - halfZ - 1.2, axis: 'EW', rotY: Math.PI / 2 },
      { x: center.x - halfX - 1.2, z: center.z + halfZ + 1.2, axis: 'EW', rotY: -Math.PI / 2 },
    ];
    for (const c of corners) {
      this._poles.push({ x: c.x, z: c.z });
      this._boxes.push({ x: c.x, z: c.z, rotY: c.rotY });
      const lampBase = this._lampData.length;
      for (let i = 0; i < 3; i++) {
        this._lampData.push({ x: c.x, y: 3.32 - i * 0.24, z: c.z, rotY: c.rotY });
      }
      this.heads.push({ controller: ctrl, axis: c.axis, lampBase });
    }
    return ctrl;
  }

  // Nach allen addIntersection-Aufrufen: Meshes bauen
  build() {
    const poleInst = new THREE.InstancedMesh(this.poleGeo, this.poleMat, this._poles.length);
    const m = new THREE.Matrix4();
    this._poles.forEach((p, i) => {
      m.makeTranslation(p.x, 1.8 + 0.12, p.z);
      poleInst.setMatrixAt(i, m);
    });
    poleInst.castShadow = true;
    poleInst.computeBoundingSphere();
    this.parent.add(poleInst);

    const boxInst = new THREE.InstancedMesh(this.boxGeo, this.boxMat, this._boxes.length);
    this._boxes.forEach((b, i) => {
      m.makeRotationY(b.rotY);
      m.setPosition(b.x, 3.1 + 0.12, b.z);
      boxInst.setMatrixAt(i, m);
    });
    boxInst.castShadow = true;
    boxInst.computeBoundingSphere();
    this.parent.add(boxInst);

    const lampGeo = new THREE.SphereGeometry(0.075, 10, 8);
    const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, this._lampData.length);
    this._lampData.forEach((l, i) => {
      // Lampe leicht vor den Kasten versetzt
      const ox = Math.sin(l.rotY) * 0.11, oz = Math.cos(l.rotY) * 0.11;
      m.makeTranslation(l.x + ox, l.y + 0.12, l.z + oz);
      this.lampMesh.setMatrixAt(i, m);
      this.lampMesh.setColorAt(i, this._colorOff);
    });
    this.lampMesh.instanceColor.needsUpdate = true;
    this.lampMesh.computeBoundingSphere();
    this.parent.add(this.lampMesh);
  }

  update(dt) {
    for (const c of this.controllers) c.update(dt);
    if (!this.lampMesh) return;
    for (const h of this.heads) {
      const state = h.controller.state(h.axis);
      // Lampen: 0 rot, 1 gelb, 2 grün
      this.lampMesh.setColorAt(h.lampBase, state === 'red' ? this._colors.red : this._colorOff);
      this.lampMesh.setColorAt(h.lampBase + 1, state === 'yellow' ? this._colors.yellow : this._colorOff);
      this.lampMesh.setColorAt(h.lampBase + 2, state === 'green' ? this._colors.green : this._colorOff);
    }
    this.lampMesh.instanceColor.needsUpdate = true;
  }
}
