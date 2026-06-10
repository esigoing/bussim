// Scania DC09: 9,3-l-Reihenfünfzylinder, ~280 PS, ~1400 Nm bei 1100–1400/min.
// Der Motor ist ein eigener Rotationszustand; das Getriebe zieht über den
// Wandler Pumpmoment ab. Leerlaufregler hält 600/min.

import { lookupCurve, clamp } from '../utils/Math3D.js';

const RPM_TO_RAD = Math.PI / 30;
const RAD_TO_RPM = 30 / Math.PI;

// Volllast-Drehmomentkurve [rpm, Nm]
const TORQUE_CURVE = [
  [500, 700], [700, 950], [900, 1250], [1100, 1400], [1400, 1400],
  [1600, 1320], [1800, 1180], [2000, 1010], [2200, 820], [2400, 0],
];

export class Engine {
  constructor() {
    this.idleRpm = 600;
    this.maxRpm = 2350;
    this.inertia = 3.5;           // kg·m² inkl. Schwungrad
    this.omega = this.idleRpm * RPM_TO_RAD;
    this.running = true;

    this.throttle = 0;            // effektiv (inkl. Leerlaufregler)
    this.load = 0;                // 0..1 für Sound/Verbrauch
    this.boost = 0;               // Turbo-Ladedruck 0..1, träge

    this.coolantTemp = 72;        // °C
    this.fuelLevel = 0.82;        // 0..1 (Tank ~300 l)
  }

  get rpm() {
    return this.omega * RAD_TO_RPM;
  }

  // pumpTorque: Lastmoment vom Wandler/Lockup (Nm, >0 bremst den Motor)
  update(dt, throttleInput, pumpTorque) {
    if (!this.running) {
      this.omega = Math.max(0, this.omega - 80 * dt);
      this.load = 0;
      this.boost = Math.max(0, this.boost - dt * 2);
      return;
    }

    // Leerlaufregler: unterhalb idle+50 sanft Gas zugeben
    const idleErr = (this.idleRpm + 30 - this.rpm) / 200;
    const governor = clamp(idleErr, 0, 1) * 0.45;
    this.throttle = clamp(Math.max(throttleInput, governor), 0, 1);

    // Drehzahlbegrenzer
    const limiter = this.rpm > this.maxRpm ? 0 : (this.rpm > this.maxRpm - 100 ? (this.maxRpm - this.rpm) / 100 : 1);

    const fullTorque = lookupCurve(TORQUE_CURVE, this.rpm);
    const indicated = fullTorque * this.throttle * limiter;
    // Schlepp-/Reibmoment steigt mit Drehzahl
    const friction = 60 + 90 * (this.rpm / 2000) ** 2 + (this.throttle === 0 ? 110 : 0);

    const net = indicated - friction - pumpTorque;
    this.omega += (net / this.inertia) * dt;
    this.omega = Math.max(0, this.omega);

    // Last für Sound: Anteil des verfügbaren Moments, der abgerufen wird
    this.load = clamp(indicated / Math.max(1, fullTorque), 0, 1);

    // Turbo: träge Annäherung an Last × Drehzahl
    const boostTarget = this.load * clamp((this.rpm - 900) / 900, 0, 1);
    this.boost += (boostTarget - this.boost) * Math.min(1, dt * 1.8);

    // Kühlmittel: erwärmt sich unter Last Richtung 88–96 °C
    const tempTarget = 86 + this.load * 9;
    this.coolantTemp += (tempTarget - this.coolantTemp) * dt * 0.01;

    // Verbrauch: ~35 l/100km Stadtprofil, hier lastbasiert
    this.fuelLevel = Math.max(0, this.fuelLevel - this.load * dt * 0.0000035);
  }
}
