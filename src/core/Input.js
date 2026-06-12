// Tastatur/Maus → benannte Fahr-Aktionen. Pedale/Lenkung sind geglättete
// Analogwerte, damit Tastatureingaben sich nicht digital anfühlen.

import { clamp } from '../utils/Math3D.js';

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();

    // Analoge Achsen 0..1 bzw. -1..1
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;          // -1 = links

    // Freier Blick (Rechtsklick-Drag). Kehrt NICHT automatisch zur Mitte
    // zurück (Spieltest-Wunsch) — Mittelklick zentriert Blick und Zoom.
    this.lookActive = false;
    this.lookYaw = 0;        // rad, relativ zur Sitz-Blickrichtung
    this.lookPitch = 0;
    this._returnLook = false;
    this.zoom = 1;           // Mausrad: 0.75 (weit) über 1 (normal) bis 3 (nah)

    // Maus für Cockpit-Raycasts
    this.mouseNDC = { x: 0, y: 0 };
    this.clicked = false;    // ein Frame lang true nach Linksklick

    this._pressedOnce = new Set(); // Tasten-Events, je einmal pro Frame konsumierbar

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._pressedOnce.add(e.code);
      if (['F1', 'F2', 'F3', 'F4', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.lookActive = true;
      if (e.button === 0) this.clicked = true;
      if (e.button === 1) { // Mittelklick: Blick + Zoom zurücksetzen
        e.preventDefault();
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.zoom = 1;
      }
    });
    // Mausrad: rein-/rauszoomen (FOV-Zoom, wirkt in den Innenansichten);
    // auch unter die Default-Perspektive hinaus (Weitwinkel bis 0.75)
    this.dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0011), 0.75, 3);
    }, { passive: false });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.lookActive = false;
    });
    window.addEventListener('mousemove', (e) => {
      const r = this.dom.getBoundingClientRect();
      this.mouseNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      if (this.lookActive) {
        this.lookYaw -= e.movementX * 0.0035;
        this.lookPitch -= e.movementY * 0.0035;
        this.lookYaw = clamp(this.lookYaw, -2.6, 2.6);
        this.lookPitch = clamp(this.lookPitch, -0.9, 0.9);
      }
    });
  }

  pressed(code) {
    return this.keys.has(code);
  }

  // true genau einmal pro Tastendruck
  justPressed(code) {
    if (this._pressedOnce.has(code)) {
      this._pressedOnce.delete(code);
      return true;
    }
    return false;
  }

  update(dt) {
    // Pedale: schnelles Ansprechen, etwas langsameres Lösen
    const thrTarget = this.pressed('KeyW') || this.pressed('ArrowUp') ? 1 : 0;
    const brkTarget = this.pressed('KeyS') || this.pressed('ArrowDown') ? 1 : 0;
    this.throttle += clamp(thrTarget - this.throttle, -dt * 2.5, dt * 1.8);
    this.brake += clamp(brkTarget - this.brake, -dt * 3.5, dt * 2.2);

    // Lenkung: Rate begrenzt, selbstzentrierend
    const left = this.pressed('KeyA') || this.pressed('ArrowLeft');
    const right = this.pressed('KeyD') || this.pressed('ArrowRight');
    const steerTarget = (left ? -1 : 0) + (right ? 1 : 0);
    const rate = steerTarget === 0 ? 1.6 : 1.1; // zurück schneller als rein
    this.steer += clamp(steerTarget - this.steer, -dt * rate, dt * rate);
    this.steer = clamp(this.steer, -1, 1);

    // Blick kehrt langsam zur Mitte zurück, wenn nicht aktiv gehalten
    if (!this.lookActive && this._returnLook) {
      this.lookYaw *= Math.exp(-dt * 3);
      this.lookPitch *= Math.exp(-dt * 3);
    }
  }

  // Am Frame-Ende aufrufen: konsumiert Einmal-Events
  postFrame() {
    this.clicked = false;
    this._pressedOnce.clear();
  }
}
