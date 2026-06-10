// Klickbare Cockpit-Taster im Scania-Stil: dunkle Wippschalter mit
// Symbol-Aufdruck und gelber Kontroll-LED. Raycast-Interaktion über
// einen zentralen Manager (Hover-Cursor, Press-Animation, Sound-Event).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Events } from '../core/Events.js';

// Symbol-Zeichnung auf die Tasterfläche
function buttonFaceTexture(symbol, label) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1d20';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#caccd0';
  ctx.fillStyle = '#caccd0';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cx = 64, cy = 54;
  switch (symbol) {
    case 'door': {
      // Türflügel mit Pfeilen
      ctx.strokeRect(34, 26, 26, 56);
      ctx.strokeRect(68, 26, 26, 56);
      ctx.beginPath();
      ctx.moveTo(50, 96); ctx.lineTo(40, 106); ctx.moveTo(78, 96); ctx.lineTo(88, 106);
      ctx.stroke();
      break;
    }
    case 'kneel': {
      // geneigter Bus
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.12);
      ctx.strokeRect(-36, -16, 72, 30);
      ctx.beginPath();
      ctx.arc(-20, 16, 8, 0, Math.PI * 2);
      ctx.arc(22, 16, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(96, 30); ctx.lineTo(96, 50); ctx.lineTo(88, 42);
      ctx.stroke();
      break;
    }
    case 'hazard': {
      ctx.beginPath();
      ctx.moveTo(cx, 20); ctx.lineTo(cx + 34, 80); ctx.lineTo(cx - 34, 80); ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, 38); ctx.lineTo(cx, 60); ctx.moveTo(cx, 68); ctx.lineTo(cx, 72);
      ctx.stroke();
      break;
    }
    case 'light': {
      ctx.beginPath();
      ctx.arc(cx - 12, cy, 18, Math.PI * 0.4, Math.PI * 1.6);
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + 4, cy + i * 14);
        ctx.lineTo(cx + 34, cy + i * 14 + i * 4);
        ctx.stroke();
      }
      break;
    }
    case 'cabin-light': {
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 16, 0, Math.PI * 2);
      ctx.moveTo(cx - 22, cy + 26); ctx.lineTo(cx + 22, cy + 26);
      ctx.stroke();
      break;
    }
    case 'stopbrake': {
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = 'bold 26px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('H', cx, cy + 9);
      break;
    }
    case 'wiper': {
      ctx.beginPath();
      ctx.arc(cx, 86, 50, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, 86); ctx.lineTo(cx - 30, 42);
      ctx.stroke();
      break;
    }
    case 'park': {
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = 'bold 30px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('P', cx, cy + 10);
      break;
    }
    default: {
      ctx.font = 'bold 40px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(symbol, cx, cy + 14);
    }
  }

  if (label) {
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9a9da2';
    ctx.fillText(label, 64, 119);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const _baseGeo = new RoundedBoxGeometry(0.042, 0.042, 0.014, 2, 0.004);
const _ledGeo = new THREE.PlaneGeometry(0.026, 0.005);

export class CockpitButtons {
  constructor() {
    this.buttons = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 3;
    this._pressed = null;
    this._pressT = 0;
  }

  // getLit(): 0..1 LED-Helligkeit | action(): Klick-Wirkung
  createButton({ symbol, label, action, getLit, parent, position, rotation }) {
    const group = new THREE.Group();
    const faceMat = new THREE.MeshStandardMaterial({
      map: buttonFaceTexture(symbol, label),
      roughness: 0.55,
    });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x131418, roughness: 0.6 });
    const mesh = new THREE.Mesh(_baseGeo, [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat]);
    group.add(mesh);

    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x342a08, emissive: 0xffb020, emissiveIntensity: 0,
    });
    const led = new THREE.Mesh(_ledGeo, ledMat);
    led.position.set(0, 0.0145, 0.0075);
    group.add(led);

    group.position.copy(position);
    if (rotation) group.rotation.copy(rotation);
    parent.add(group);

    const entry = { group, mesh, ledMat, action, getLit, baseZ: mesh.position.z };
    this.buttons.push(entry);
    return entry;
  }

  // Unsichtbare Klickfläche (z. B. Blinkerhebel-Zonen, Drucker-Slot)
  createZone({ size, action, parent, position, name }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.copy(position);
    parent.add(mesh);
    const entry = { group: mesh, mesh, action, getLit: null, zone: true, name };
    this.buttons.push(entry);
    return entry;
  }

  handleClick(camera, ndc) {
    this.raycaster.setFromCamera(ndc, camera);
    const meshes = this.buttons.map((b) => b.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return false;
    const entry = this.buttons.find((b) => b.mesh === hits[0].object);
    if (!entry) return false;
    if (!entry.zone) {
      Events.emit('buttonPress');
      this._pressed = entry;
      this._pressT = 0.12;
    }
    entry.action();
    return true;
  }

  hovering(camera, ndc) {
    this.raycaster.setFromCamera(ndc, camera);
    const meshes = this.buttons.filter((b) => !b.zone).map((b) => b.mesh);
    return this.raycaster.intersectObjects(meshes, false).length > 0;
  }

  update(dt) {
    for (const b of this.buttons) {
      if (b.getLit) b.ledMat.emissiveIntensity = b.getLit() * 2.2;
    }
    if (this._pressed) {
      this._pressT -= dt;
      const depth = this._pressT > 0 ? 0.005 : 0;
      this._pressed.mesh.position.z = this._pressed.baseZ - depth;
      if (this._pressT <= 0) this._pressed = null;
    }
  }
}
