// ZF EcoLife 6 AP: Drehmomentwandler mit Lockup, 6 Gänge, integrierter
// Retarder. Wählhebel D/N/R. Schaltlogik mit Anti-Pendel-Timer.

import { clamp, lerp } from '../utils/Math3D.js';

const RATIOS = [3.36, 1.91, 1.42, 1.0, 0.72, 0.62];
const REVERSE_RATIO = -3.34;
const FINAL_DRIVE = 5.13;
const EFFICIENCY = 0.93;
const RAD_TO_RPM = 30 / Math.PI;

export class Gearbox {
  constructor() {
    this.selector = 'N';        // 'D' | 'N' | 'R'
    this.gear = 1;              // aktueller Gang in D (1-basiert)
    this.shiftTimer = 0;        // >0 = Schaltvorgang läuft (Momentreduktion)
    this.antiHunt = 0;
    this.locked = false;        // Wandlerüberbrückung
    this.retarderStage = 0;     // 0..1 (vom Bremspedal, 1. Stufe)

    this.pumpTorque = 0;        // Rückwirkung auf den Motor
    this.outputTorque = 0;      // an der Kardanwelle (vor Achse)
    this.retarderTorque = 0;    // Bremsmoment an der Kardanwelle
    this.speedRatio = 0;
  }

  get currentRatio() {
    if (this.selector === 'R') return REVERSE_RATIO;
    if (this.selector === 'N') return 0;
    return RATIOS[this.gear - 1];
  }

  setSelector(s) {
    if (s === this.selector) return;
    this.selector = s;
    this.gear = 1;
    this.locked = false;
  }

  // wheelOmega: mittlere Drehzahl der Antriebsräder (rad/s)
  update(dt, engine, wheelOmega) {
    this.antiHunt = Math.max(0, this.antiHunt - dt);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    const ratio = this.currentRatio;
    if (ratio === 0) {
      this.pumpTorque = 0;
      this.outputTorque = 0;
      this.retarderTorque = 0;
      this.locked = false;
      return;
    }

    const shaftOmega = wheelOmega * FINAL_DRIVE;          // Kardanwelle
    const turbineOmega = shaftOmega * ratio;              // Getriebeeingang
    const engOmega = Math.max(engine.omega, 1);

    // --- Wandler / Lockup
    const sr = clamp(turbineOmega / engOmega, 0, 0.999);
    this.speedRatio = sr;

    const wantLock = this.selector === 'D' && this.gear >= 3 && sr > 0.92 && this.shiftTimer === 0;
    if (wantLock) this.locked = true;
    if (sr < 0.82 || this.shiftTimer > 0 || this.selector !== 'D' || this.gear < 3) this.locked = false;

    let turbineTorque;
    if (this.locked) {
      // Überbrückung: steife viskose Kupplung
      const slip = engOmega - turbineOmega;
      this.pumpTorque = clamp(slip * 90, -1600, 1600);
      turbineTorque = this.pumpTorque;
    } else {
      // Pumpmoment ∝ ωe², Kapazität sinkt mit Speed-Ratio
      const cp = 0.055 * (1 - 0.88 * sr ** 3);
      this.pumpTorque = cp * engOmega * engOmega * Math.sign(1);
      const torqueRatio = lerp(1.9, 1.0, clamp(sr / 0.9, 0, 1));
      turbineTorque = this.pumpTorque * torqueRatio;
    }

    // Schaltvorgang: Momentlücke
    const shiftFactor = this.shiftTimer > 0 ? 0.15 : 1;

    this.outputTorque = turbineTorque * ratio * EFFICIENCY * shiftFactor;

    // --- Retarder (am Getriebeausgang, wirkt nur in Fahrtrichtung vorwärts)
    const shaftRpm = Math.abs(shaftOmega) * RAD_TO_RPM;
    this.retarderTorque = this.retarderStage * 3000 * clamp(shaftRpm / 900, 0, 1);

    // --- Schaltlogik (nur D)
    if (this.selector === 'D' && this.antiHunt === 0 && this.shiftTimer === 0) {
      const rpm = engine.rpm;
      const throttle = engine.throttle;
      const upRpm = lerp(1450, 1900, throttle);
      const downRpm = lerp(950, 1280, throttle);

      if (rpm > upRpm && this.gear < 6) {
        this.gear++;
        this._startShift();
      } else if (rpm < downRpm && this.gear > 1 && sr > 0.1) {
        this.gear--;
        this._startShift();
      }
    }
  }

  _startShift() {
    this.shiftTimer = 0.5;
    this.antiHunt = 1.5;
    this.locked = false;
  }

  get finalDrive() {
    return FINAL_DRIVE;
  }
}
