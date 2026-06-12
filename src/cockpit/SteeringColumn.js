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

    // Säule: steil vom Radnaben-Punkt (lokaler Ursprung) hinunter aufs
    // Podest zwischen den Knien — wie beim echten Stadtbus steht das flache
    // Rad auf einer deutlich steileren Säule. Rad darf nicht frei schweben.
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.0, 12), columnMat);
    column.rotation.x = 0.28;
    column.position.set(0, -0.48, -0.135);
    this.group.add(column);
    // Manschette am Säulenfuß kaschiert den Übergang ins Podest
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.16, 12), columnMat);
    boot.rotation.x = 0.28;
    boot.position.set(0, -0.92, -0.25);
    this.group.add(boot);

    // Radgruppe: lokale +z-Normale zeigt zum Fahrer (oben-hinten)
    this.wheelGroup = new THREE.Group();
    this.wheelGroup.rotation.x = this.tilt - Math.PI / 2;

    // Kranz r=0.27: der Blick geht DURCH die freie obere Radöffnung aufs
    // tief liegende Kombiinstrument — Scania-typisch.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.024, 14, 40), rimMat);
    this.wheelGroup.add(rim);
    // Speichen: 3 und 9 Uhr + unten — die größte Lücke liegt OBEN,
    // damit die Armaturen hinter dem Rad erkennbar bleiben
    for (const a of [0, Math.PI, Math.PI * 1.5]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.22, 0.018), rimMat);
      spoke.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0);
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

    // Blinkerhebel: sitzt an der Säule UNTER dem Kranz (lokal -z = zur
    // Konsole, nicht zum Fahrer — sonst schwebt er vor dem Rad) und ragt
    // nach links über den Kranz hinaus.
    this.stalk = new THREE.Group();
    this.stalk.position.set(-0.02, -0.19, -0.07);
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
