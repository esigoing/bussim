// Analoge Rundinstrumente: Ziffernblatt als CanvasTexture (statisch),
// Nadel als 3D-Mesh auf Pivot. setValue() dreht nur die Nadel.

import * as THREE from 'three';
import { clamp, lerp, damp } from '../utils/Math3D.js';

const START_ANGLE = (225 * Math.PI) / 180;  // links unten
const END_ANGLE = (-45 * Math.PI) / 180;    // rechts unten

function dialTexture({ min, max, step, label, redFrom, redTo, unit, size = 256 }) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size * 0.46;

  ctx.fillStyle = '#0d0e10';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a3d42';
  ctx.lineWidth = size * 0.02;
  ctx.stroke();

  const valToAngle = (v) => lerp(START_ANGLE, END_ANGLE, (v - min) / (max - min));

  // Roter Bereich
  if (redFrom !== undefined) {
    ctx.beginPath();
    ctx.strokeStyle = '#c22018';
    ctx.lineWidth = size * 0.035;
    const a0 = valToAngle(redFrom), a1 = valToAngle(redTo);
    ctx.arc(cx, cy, r * 0.82, -a0, -a1, a0 > a1);
    ctx.stroke();
  }

  // Skala
  ctx.fillStyle = '#e8eaee';
  ctx.strokeStyle = '#e8eaee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const majorCount = Math.round((max - min) / step);
  for (let i = 0; i <= majorCount; i++) {
    const v = min + i * step;
    const a = valToAngle(v);
    const cos = Math.cos(a), sin = -Math.sin(a);
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.moveTo(cx + cos * r * 0.78, cy + sin * r * 0.78);
    ctx.lineTo(cx + cos * r * 0.9, cy + sin * r * 0.9);
    ctx.stroke();
    ctx.font = `bold ${size * 0.085}px Arial`;
    ctx.fillText(String(v), cx + cos * r * 0.62, cy + sin * r * 0.62);
    // Zwischenstriche
    if (i < majorCount) {
      for (let s = 1; s < 5; s++) {
        const a2 = valToAngle(v + (step * s) / 5);
        const c2 = Math.cos(a2), s2 = -Math.sin(a2);
        ctx.lineWidth = size * 0.006;
        ctx.beginPath();
        ctx.moveTo(cx + c2 * r * 0.84, cy + s2 * r * 0.84);
        ctx.lineTo(cx + c2 * r * 0.9, cy + s2 * r * 0.9);
        ctx.stroke();
      }
    }
  }

  ctx.font = `${size * 0.075}px Arial`;
  ctx.fillStyle = '#9aa0a8';
  ctx.fillText(label, cx, cy + r * 0.38);
  if (unit) ctx.fillText(unit, cx, cy - r * 0.32);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Gauge {
  constructor({ radius = 0.065, min = 0, max = 125, step = 20, label = '', unit = '', redFrom, redTo, lambda = 8 }) {
    this.min = min;
    this.max = max;
    this.lambda = lambda; // Nadel-Trägheit
    this.value = min;
    this.target = min;

    this.group = new THREE.Group();

    const dial = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 32),
      new THREE.MeshStandardMaterial({
        map: dialTexture({ min, max, step, label, unit, redFrom, redTo }),
        roughness: 0.6,
        emissive: 0xffffff,
        emissiveMap: null,
        emissiveIntensity: 0,
      })
    );
    this.dialMat = dial.material;
    this.group.add(dial);

    // Nadel
    this.needlePivot = new THREE.Group();
    this.needlePivot.position.z = 0.004;
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.06, radius * 0.85, 0.002),
      new THREE.MeshStandardMaterial({ color: 0xe04428, emissive: 0xe04428, emissiveIntensity: 0.4, roughness: 0.4 })
    );
    needle.position.y = radius * 0.36;
    this.needlePivot.add(needle);
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.1, radius * 0.1, 0.006, 12),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 })
    );
    hub.rotation.x = Math.PI / 2;
    this.needlePivot.add(hub);
    this.group.add(this.needlePivot);

    // Glas-Abdeckung
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 1.02, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.07, roughness: 0.05, side: THREE.DoubleSide,
      })
    );
    glass.position.z = 0.009;
    this.group.add(glass);

    this._applyAngle();
  }

  setValue(v) {
    this.target = clamp(v, this.min, this.max);
  }

  // Nachtbeleuchtung der Instrumente
  setBacklight(intensity) {
    this.dialMat.emissiveIntensity = intensity * 0.35;
    this.dialMat.emissiveMap = this.dialMat.map;
  }

  update(dt) {
    this.value = damp(this.value, this.target, this.lambda, dt);
    this._applyAngle();
  }

  _applyAngle() {
    const t = (this.value - this.min) / (this.max - this.min);
    // Nadel zeigt bei t=0 auf START (links unten); Pivot-Z-Rotation
    const angle = lerp(START_ANGLE, END_ANGLE, t);
    this.needlePivot.rotation.z = angle - Math.PI / 2;
  }
}
