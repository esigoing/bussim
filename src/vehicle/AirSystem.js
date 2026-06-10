// Druckluftanlage: Kompressor mit Governor (8,5 → 10,0 bar), zwei Kreise,
// Verbrauch durch Bremse/Türen/Kneeling. Unter 5,5 bar Warnung, unter
// 4,0 bar fällt die Federspeicher-Feststellbremse ein.

import { clamp } from '../utils/Math3D.js';
import { Events } from '../core/Events.js';

export class AirSystem {
  constructor() {
    this.circuit1 = 9.2;   // bar — Betriebsbremse vorn
    this.circuit2 = 9.0;   // bar — Betriebsbremse hinten + Nebenverbraucher
    this.governorOpen = true;
    this.lowAirWarning = false;
    this.springBrakeApplied = false;
    this._lastBrake = 0;
  }

  get minPressure() {
    return Math.min(this.circuit1, this.circuit2);
  }

  consume(amount) {
    this.circuit2 = Math.max(0, this.circuit2 - amount);
    this.circuit1 = Math.max(0, this.circuit1 - amount * 0.4);
  }

  update(dt, engineRpm, brakePedal) {
    // Governor: Abschaltdruck 10,0, Einschaltdruck 8,5
    if (this.minPressure >= 10.0) this.governorOpen = false;
    if (this.minPressure <= 8.5) this.governorOpen = true;

    if (this.governorOpen && engineRpm > 100) {
      const rate = 0.06 * (engineRpm / 1200); // bar/s
      this.circuit1 = Math.min(10.2, this.circuit1 + rate * dt);
      this.circuit2 = Math.min(10.2, this.circuit2 + rate * dt * 0.9);
    }

    // Bremsen verbraucht beim ANLEGEN (Druckanstieg im Zylinder), nicht beim Halten
    const brakeApply = Math.max(0, brakePedal - this._lastBrake);
    if (brakeApply > 0) this.consume(brakeApply * 0.12);
    // leichte Dauerleckage / Niveauregulierung
    this.consume(dt * 0.0015);
    this._lastBrake = brakePedal;

    const wasWarning = this.lowAirWarning;
    this.lowAirWarning = this.minPressure < 5.5;
    if (this.lowAirWarning && !wasWarning) Events.emit('lowAir', true);

    this.springBrakeApplied = this.minPressure < 4.0;
  }

  // Wieviel Bremsleistung steht zur Verfügung? (0..1)
  get brakeAvailability() {
    return clamp(this.minPressure / 6.0, 0, 1);
  }
}
