// Prozeduraler DC09-Dieselsound. Reihen-5-Zylinder, 4-Takt:
// Zündgrundfrequenz f0 = rpm/24 Hz (Leerlauf 600 → 25 Hz).
// Halbordnungen (0.5, 1.5, 2.5 × f0) machen den unrunden Fünfzylinder-
// Charakter; ein tanh-WaveShaper liefert lastabhängige Härte.

import { pinkNoiseBuffer, brownNoiseBuffer, whiteNoiseBuffer } from './PCM.js';

// [Ordnung, Grundpegel, Leerlauf-Bonus]
const ORDERS = [
  [0.5, 0.50, 0.7],
  [1.0, 0.85, 0.3],
  [1.5, 0.60, 0.6],
  [2.0, 0.55, 0.1],
  [2.5, 0.38, 0.4],
  [3.0, 0.30, 0.0],
  [4.0, 0.16, 0.0],
];

export class EngineSound {
  constructor(audio) {
    this.audio = audio;
    const ctx = audio.ctx;

    // Motor-Bus → (dry + Reverb-Send über exteriorFilter ist falsch — Motor
    // ist eine Außenquelle, dröhnt aber stark in die Kabine: eigener Weg)
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;

    // Innenfilter speziell für den Motor (Körperschall: dumpf aber präsent)
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 900;
    this.bus.connect(this.cabinFilter);
    this.cabinFilter.connect(audio.master);
    this.cabinFilter.connect(audio.reverb);

    // --- Oszillatorbank → WaveShaper
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this._tanhCurve(2.2);
    this.shaperGain = ctx.createGain();
    this.shaperGain.gain.value = 0.5;
    this.shaper.connect(this.shaperGain);
    this.shaperGain.connect(this.bus);

    this.oscs = ORDERS.map(([order, base, idleBonus]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 25 * order;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.shaper);
      osc.start();
      return { osc, g, order, base, idleBonus };
    });

    // --- Verbrennungsrauschen (Dieselnageln)
    this.combNoise = ctx.createBufferSource();
    this.combNoise.buffer = pinkNoiseBuffer(ctx, 3);
    this.combNoise.loop = true;
    this.combFilter = ctx.createBiquadFilter();
    this.combFilter.type = 'bandpass';
    this.combFilter.frequency.value = 100;
    this.combFilter.Q.value = 0.7;
    this.combGain = ctx.createGain();
    this.combGain.gain.value = 0;
    this.combNoise.connect(this.combFilter);
    this.combFilter.connect(this.shaper);
    this.combNoise.start();

    // Klappern hochfrequent (Ventiltrieb/Injektoren) — direkt auf den Bus
    this.clatterFilter = ctx.createBiquadFilter();
    this.clatterFilter.type = 'bandpass';
    this.clatterFilter.frequency.value = 2600;
    this.clatterFilter.Q.value = 1.4;
    this.clatterGain = ctx.createGain();
    this.clatterGain.gain.value = 0;
    this.combNoise.connect(this.clatterFilter);
    this.clatterFilter.connect(this.clatterGain);
    this.clatterGain.connect(this.bus);

    // --- Turbo: Sirren + Hiss
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 1200;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.bus);
    this.turboOsc.start();

    this.turboHiss = ctx.createBufferSource();
    this.turboHiss.buffer = whiteNoiseBuffer(ctx, 2);
    this.turboHiss.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'highpass';
    this.hissFilter.frequency.value = 6000;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.turboHiss.connect(this.hissFilter);
    this.hissFilter.connect(this.hissGain);
    this.hissGain.connect(this.bus);
    this.turboHiss.start();

    // --- Auspuffgrummeln
    this.exhaust = ctx.createBufferSource();
    this.exhaust.buffer = brownNoiseBuffer(ctx, 3);
    this.exhaust.loop = true;
    this.exhaustFilter = ctx.createBiquadFilter();
    this.exhaustFilter.type = 'lowpass';
    this.exhaustFilter.frequency.value = 120;
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.exhaust.connect(this.exhaustFilter);
    this.exhaustFilter.connect(this.exhaustGain);
    this.exhaustGain.connect(this.bus);
    this.exhaust.start();

    this._jitter = 0;
    this._lastBoost = 0;
  }

  _tanhCurve(drive) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }

  setInterior(interior) {
    this.cabinFilter.frequency.setTargetAtTime(interior ? 900 : 9000, this.audio.now, 0.08);
  }

  update(dt, engine) {
    const t = this.audio.now;
    const rpm = engine.rpm;
    const load = engine.load;
    const rpmNorm = Math.min(1, (rpm - 600) / 1600);

    // Pitch-Jitter im Leerlauf (unrunder Diesellauf)
    this._jitter += (Math.random() - 0.5) * 0.02;
    this._jitter *= 0.97;
    const jitterAmount = 1 + this._jitter * (1 - rpmNorm) * 0.4;

    const f0 = (rpm / 24) * jitterAmount;

    for (const o of this.oscs) {
      o.osc.frequency.setTargetAtTime(Math.max(8, f0 * o.order), t, 0.03);
      // Rolloff hoher Ordnungen bei hoher Drehzahl, Halbordnungen stark im Leerlauf
      const idleEmph = 1 + o.idleBonus * (1 - rpmNorm);
      const g = o.base * idleEmph * (0.3 + 0.7 * load) * 0.16;
      o.g.gain.setTargetAtTime(g, t, 0.04);
    }

    // Gesamtpegel
    const level = (0.4 + 0.45 * load + 0.15 * rpmNorm) * (engine.running ? 1 : 0);
    this.bus.gain.setTargetAtTime(level * 0.9, t, 0.05);

    // Verbrennungsband folgt 4·f0
    this.combFilter.frequency.setTargetAtTime(Math.min(900, 4 * f0), t, 0.03);
    this.combGain.gain.setTargetAtTime(0.25 + 0.5 * load, t, 0.05);
    this.clatterGain.gain.setTargetAtTime(0.05 + 0.05 * (1 - rpmNorm) + 0.04 * load, t, 0.05);

    // Turbo
    const boost = engine.boost;
    this.turboOsc.frequency.setTargetAtTime(1200 + 9000 * boost, t, 0.06);
    this.turboGain.gain.setTargetAtTime(boost * boost * 0.06, t, 0.06);
    this.hissGain.gain.setTargetAtTime(boost * boost * 0.05, t, 0.06);

    // Wastegate-Chuff bei plötzlichem Boost-Abfall
    if (this._lastBoost - boost > 0.25) {
      this._wastegate();
      this._lastBoost = boost;
    }
    this._lastBoost += (boost - this._lastBoost) * Math.min(1, dt * 4);

    // Auspuff
    this.exhaustGain.gain.setTargetAtTime(0.3 + load * 0.45, t, 0.07);
    this.exhaustFilter.frequency.setTargetAtTime(90 + rpmNorm * 80, t, 0.07);

    // Shaper-Drive härter unter Last
    this.shaperGain.gain.setTargetAtTime(0.4 + load * 0.25, t, 0.08);
  }

  _wastegate() {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = whiteNoiseBuffer(ctx, 0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3500;
    f.Q.value = 1.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, this.audio.now);
    g.gain.exponentialRampToValueAtTime(0.001, this.audio.now + 0.35);
    src.connect(f); f.connect(g); g.connect(this.bus);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.start();
  }
}
