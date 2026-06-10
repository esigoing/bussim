// Drei pneumatische Innenschwenktüren. Öffnen nur unter 3 km/h
// (Türverriegelung), jede Bewegung kostet Druckluft und macht Geräusch.

import { Events } from '../core/Events.js';

const DOOR_TIME = 1.9; // s für komplettes Öffnen/Schließen

export class Doors {
  constructor(airSystem) {
    this.air = airSystem;
    this.doors = [0, 1, 2].map((i) => ({
      index: i,
      target: 0,      // 0 zu, 1 offen
      progress: 0,
      moving: false,
    }));
  }

  toggle(i, speedKmh) {
    const d = this.doors[i];
    if (d.target === 0 && speedKmh > 3) {
      Events.emit('doorBlocked', i);
      return false;
    }
    d.target = d.target === 0 ? 1 : 0;
    this.air.consume(0.15);
    Events.emit('doorPneumatic', { index: i, opening: d.target === 1 });
    return true;
  }

  setAll(open, speedKmh) {
    for (let i = 0; i < 3; i++) {
      const d = this.doors[i];
      if (d.target !== (open ? 1 : 0)) this.toggle(i, speedKmh);
    }
  }

  update(dt) {
    for (const d of this.doors) {
      const before = d.progress;
      if (d.progress < d.target) {
        d.progress = Math.min(d.target, d.progress + dt / DOOR_TIME);
      } else if (d.progress > d.target) {
        d.progress = Math.max(d.target, d.progress - dt / DOOR_TIME);
      }
      const moving = d.progress !== before;
      if (d.moving && !moving) {
        Events.emit('doorSettled', { index: d.index, open: d.progress === 1 });
      }
      d.moving = moving;
    }
  }

  get anyOpen() {
    return this.doors.some((d) => d.progress > 0.05);
  }

  isOpen(i) {
    return this.doors[i].progress > 0.95;
  }
}
