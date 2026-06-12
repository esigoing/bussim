// Atmosphäre: Stadtbett, Regen aufs Dach, Wischergummi, Fahrgastgemurmel,
// Wind-/Rollgeräusch. Alles Dauerquellen, Pegel folgen dem Spielzustand.

import { Events } from '../core/Events.js';
import { pinkNoiseBuffer, whiteNoiseBuffer } from './PCM.js';

export class AmbienceSounds {
  constructor(audio) {
    this.audio = audio;
    const ctx = audio.ctx;

    const pink = pinkNoiseBuffer(ctx, 4);
    const white = whiteNoiseBuffer(ctx, 3);

    // Stadtbett (Außenquelle)
    this.city = audio.makeLoop(pink, { filterType: 'lowpass', filterFreq: 700, dest: 'exterior' });
    // zweites Band: fernes Rauschen heller
    this.cityHigh = audio.makeLoop(white, { filterType: 'bandpass', filterFreq: 1800, q: 0.4, dest: 'exterior' });

    // Regen aufs Dach (Innenquelle — Körperschall)
    this.rain = audio.makeLoop(white, { filterType: 'lowpass', filterFreq: 2800 });
    // Regen draußen heller
    this.rainExt = audio.makeLoop(white, { filterType: 'highpass', filterFreq: 2000, dest: 'exterior' });

    // Roll-/Windgeräusch
    this.roll = audio.makeLoop(pink, { filterType: 'lowpass', filterFreq: 350 });
    this.wind = audio.makeLoop(white, { filterType: 'bandpass', filterFreq: 900, q: 0.5 });

    // Klimagebläse: leises, tief gefiltertes Rauschen, Pegel folgt bus.fanLevel
    this.fan = audio.makeLoop(pink, { filterType: 'lowpass', filterFreq: 420 });

    // Gemurmel: drei verstimmte Formant-Bänder
    this.murmur = [300, 800, 1750].map((f, i) =>
      audio.makeLoop(pink, { filterType: 'bandpass', filterFreq: f, q: 3.5 })
    );
    this._murmurLFO = [0, 2, 4];

    // Wischer: kurzes Gummi-Reiben an Umkehrpunkten
    this._lastSweepDir = 0;
    this._wiperBuf = white;

    // dicke Regentropfen-Ticks
    this._dropTimer = 0;
  }

  _wiperSqueak() {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._wiperBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100 + Math.random() * 300;
    f.Q.value = 6;
    const g = ctx.createGain();
    const t = this.audio.now;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(f); f.connect(g); g.connect(this.audio.master);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.start();
    src.stop(t + 0.3);
  }

  update(dt, { env, bus, passengerCount, time }) {
    const t = this.audio.now;
    const speed = bus.speedKmh;

    // Stadtbett: tagsüber lauter, nachts leiser
    const dayLevel = 0.05 * (1 - env.night * 0.75);
    this.city.gain.gain.setTargetAtTime(dayLevel, t, 0.3);
    this.cityHigh.gain.gain.setTargetAtTime(dayLevel * 0.25, t, 0.3);

    // Regen
    this.rain.gain.gain.setTargetAtTime(env.rain * 0.13, t, 0.4);
    this.rainExt.gain.gain.setTargetAtTime(env.rain * 0.1, t, 0.4);

    // dicke Tropfen einzeln
    if (env.rain > 0.2) {
      this._dropTimer -= dt;
      if (this._dropTimer <= 0) {
        this._dropTimer = 0.04 + Math.random() * 0.3 / env.rain;
        const src = this.audio.ctx.createBufferSource();
        src.buffer = this._wiperBuf;
        const g = this.audio.ctx.createGain();
        g.gain.setValueAtTime(0.02 + Math.random() * 0.03, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        const f = this.audio.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 2500 + Math.random() * 3000;
        f.Q.value = 4;
        src.connect(f); f.connect(g); g.connect(this.audio.master);
        src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
        src.start();
        src.stop(t + 0.05);
      }
    }

    // Klimagebläse: Stufe 0..2 → Pegel und Rauschfarbe
    const fan = bus.fanLevel || 0;
    this.fan.gain.gain.setTargetAtTime([0, 0.045, 0.1][fan] || 0, t, 0.3);
    this.fan.filter.frequency.setTargetAtTime(380 + fan * 180, t, 0.3);

    // Roll-/Windgeräusch ∝ v²
    const vNorm = Math.min(1, speed / 70);
    this.roll.gain.gain.setTargetAtTime(vNorm * vNorm * 0.3, t, 0.15);
    this.wind.gain.gain.setTargetAtTime(vNorm * vNorm * 0.12, t, 0.15);
    this.roll.filter.frequency.setTargetAtTime(250 + vNorm * 300, t, 0.2);

    // Gemurmel ∝ Fahrgastzahl, mit langsamen LFOs lebendig gehalten
    const mBase = Math.min(1, passengerCount / 20) * 0.05;
    this.murmur.forEach((m, i) => {
      const lfo = 0.6 + 0.4 * Math.sin(time * (0.31 + i * 0.17) + this._murmurLFO[i]);
      m.gain.gain.setTargetAtTime(mBase * lfo, t, 0.4);
    });

    // Wischer: an Umkehrpunkten quietschen (nur bei wenig Wasser stärker)
    const w = bus.wipers;
    if (w.isMoving) {
      const dir = w.phase < 1 ? 1 : -1;
      if (dir !== this._lastSweepDir) {
        this._wiperSqueak();
        this._lastSweepDir = dir;
      }
    } else {
      this._lastSweepDir = 0;
    }
  }
}
