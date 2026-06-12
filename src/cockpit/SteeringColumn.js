// Lenksäule: großes, flach stehendes Stadtbus-Lenkrad + Blinkerhebel.
// Das Rad dreht mit bus.steeringWheelAngle (3,5 Umdrehungen lock-to-lock).

import * as THREE from 'three';
import { damp } from '../utils/Math3D.js';

export class SteeringColumn {
  constructor(dashMat) {
    this.group = new THREE.Group();
    // Neigung: Busräder stehen flacher als PKW (~35° aus der Horizontalen).
    // Positiv = Säulenkopf neigt sich zum Fahrer (+z), Radfläche zeigt
    // nach oben-hinten zum Fahrer.
    this.tilt = 0.95;

    const rimMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.45 });
    const columnMat = dashMat || new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.6 });

    // Säule: Fuß vorn unten, Kopf hinten oben beim Fahrer
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.45, 12), columnMat);
    column.rotation.x = this.tilt;
    column.position.set(0, -0.18, 0.14);
    this.group.add(column);

    // Radgruppe: lokale +z-Normale zeigt zum Fahrer (oben-hinten)
    this.wheelGroup = new THREE.Group();
    this.wheelGroup.rotation.x = this.tilt - Math.PI / 2;

    // Kranz r=0.21: klein genug, dass der Blick vom Fahrerauge ÜBER den
    // Kranz aufs (höher gesetzte) Kombiinstrument geht — Scania-typisch.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.022, 14, 40), rimMat);
    this.wheelGroup.add(rim);
    // Speichen (mit dem Kranz skaliert)
    for (const a of [Math.PI / 2, Math.PI + 0.6, Math.PI * 2 - 0.6]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.19, 0.018), rimMat);
      spoke.position.set(Math.cos(a) * 0.105, Math.sin(a) * 0.105, 0);
      spoke.rotation.z = a - Math.PI / 2;
      this.wheelGroup.add(spoke);
    }
    // Nabe mit Scania-Emblem
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 20), rimMat);
    hub.rotation.x = Math.PI / 2;
    this.wheelGroup.add(hub);
    const emblem = new THREE.Mesh(
      new THREE.CircleGeometry(0.032, 20),
      new THREE.MeshStandardMaterial({ map: this._emblemTexture(), roughness: 0.3, metalness: 0.4 })
    );
    emblem.position.z = 0.019;
    this.wheelGroup.add(emblem);

    this.group.add(this.wheelGroup);

    // Blinkerhebel: an der Säule UNTER dem Kranz, ragt nach links-unten
    // deutlich über den Kranz (r = 0.21) hinaus — kein Kontakt zum Rad.
    this.stalk = new THREE.Group();
    this.stalk.position.set(-0.04, -0.14, 0.16);
    this.stalk.rotation.x = this.tilt;
    this.stalk.rotation.z = -0.25; // leicht nach unten geneigt
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.22, 8), rimMat);
    lever.rotation.z = Math.PI / 2;
    lever.position.x = -0.13;
    this.stalk.add(lever);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), rimMat);
    knob.position.x = -0.25;
    this.stalk.add(knob);
    this.group.add(this.stalk);

    this._stalkAngle = 0;
  }

  _emblemTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a2c5a';
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e8ec';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCANIA', 32, 37);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(dt, bus) {
    // Lenkrad dreht um seine lokale Z-Achse (rechts lenken = im Uhrzeigersinn)
    this.wheelGroup.rotation.y = 0;
    this.wheelGroup.rotation.order = 'XYZ';
    this.wheelGroup.rotation.z = bus.steeringWheelAngle;

    // Blinkerhebel: hoch = rechts, runter = links (um die Grundneigung)
    const target = bus.hazard ? 0 : bus.blinker * -0.28;
    this._stalkAngle = damp(this._stalkAngle, target, 14, dt);
    this.stalk.rotation.z = -0.25 + this._stalkAngle;
  }
}
