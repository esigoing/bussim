// Fahrzeuggeräusche jenseits des Motors: Druckluft, Türen, Blinker,
// Retarder, Gong, Drucker, Münzen. Event-getrieben + kontinuierliche Quellen.

import { Events } from '../core/Events.js';
import {
  whiteNoiseBuffer, clickBuffer, chimeBuffer, coinBuffer,
  printerBuffer, beepBuffer,
} from './PCM.js';

export class VehicleSounds {
  constructor(audio) {
    this.audio = audio;
    const ctx = audio.ctx;

    // Vorab generierte Buffers
    this.bufHiss = whiteNoiseBuffer(ctx, 1.2);
    this.bufClickOn = clickBuffer(ctx, 2200, 0.03, 500);
    this.bufClickOff = clickBuffer(ctx, 1700, 0.03, 550);
    this.bufBtn = clickBuffer(ctx, 1200, 0.02, 900);
    this.bufChime = chimeBuffer(ctx);
    this.bufCoin = coinBuffer(ctx);
    this.bufPrinter = printerBuffer(ctx);
    this.bufBeep = beepBuffer(ctx, 1750);
    this.bufBeepLow = beepBuffer(ctx, 950, 0.2);

    // Retarder: Dauerquelle (Sägezahn + Rauschen), Gain folgt Moment
    this.retOsc = ctx.createOscillator();
    this.retOsc.type = 'sawtooth';
    this.retOsc.frequency.value = 60;
    this.retFilter = ctx.createBiquadFilter();
    this.retFilter.type = 'lowpass';
    this.retFilter.frequency.value = 500;
    this.retGain = ctx.createGain();
    this.retGain.gain.value = 0;
    this.retOsc.connect(this.retFilter);
    this.retFilter.connect(this.retGain);
    this.retGain.connect(audio.master);
    this.retOsc.start();

    // Bremszischen-Zustand
    this._lastBrake = 0;
    this._lastGovernor = true;
    this._squealGate = 0;

    this._wire();
  }

  _hiss({ gain = 0.3, dur = 0.4, freq = 3500, dest = 'master' }) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bufHiss;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const t = this.audio.now;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g);
    g.connect(dest === 'exterior' ? this.audio.exteriorFilter : this.audio.master);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    src.start();
    src.stop(t + dur + 0.05);
  }

  _wire() {
    Events.on('blinkTick', (on) => {
      this.audio.playBuffer(on ? this.bufClickOn : this.bufClickOff, { gain: 0.5 });
    });
    Events.on('doorPneumatic', ({ opening }) => {
      this._hiss({ gain: 0.35, dur: 0.5, freq: opening ? 3800 : 3200 });
      // Türmotor-Surren über die Bewegungsdauer
      this._hiss({ gain: 0.06, dur: 1.8, freq: 700 });
    });
    Events.on('doorSettled', ({ open }) => {
      this.audio.playBuffer(this.bufBtn, { gain: open ? 0.4 : 0.65, rate: open ? 1 : 0.7 });
      if (!open) this._hiss({ gain: 0.15, dur: 0.25, freq: 3000 });
    });
    Events.on('doorBlocked', () => {
      this.audio.playBuffer(this.bufBeepLow, { gain: 0.4 });
    });
    Events.on('kneelStart', () => this._hiss({ gain: 0.3, dur: 1.6, freq: 2600 }));
    Events.on('kneelDone', () => this._hiss({ gain: 0.18, dur: 0.3, freq: 3400 }));
    Events.on('chime', () => this.audio.playBuffer(this.bufChime, { gain: 0.5 }));
    Events.on('buttonPress', () => this.audio.playBuffer(this.bufBtn, { gain: 0.5 }));
    Events.on('ticketPrint', () => this.audio.playBuffer(this.bufPrinter, { gain: 0.55 }));
    Events.on('ticketBeep', () => this.audio.playBuffer(this.bufBeep, { gain: 0.4 }));
    Events.on('coinPay', () => this.audio.playBuffer(this.bufCoin, { gain: 0.45 }));
    Events.on('lowAir', () => this.audio.playBuffer(this.bufBeepLow, { gain: 0.6 }));
  }

  update(dt, bus) {
    const t = this.audio.now;

    // Retarder-Sirren: Frequenz folgt Kardanwellendrehzahl
    const shaftRpm = Math.abs((bus.wheels[2].omega + bus.wheels[3].omega) / 2) * bus.gearbox.finalDrive * 9.55;
    const retLevel = Math.min(1, bus.gearbox.retarderTorque / 3000) * Math.min(1, shaftRpm / 600);
    this.retOsc.frequency.setTargetAtTime(40 + shaftRpm * 0.12, t, 0.05);
    this.retGain.gain.setTargetAtTime(retLevel * 0.07, t, 0.08);

    // Bremszischen beim Lösen
    const brake = bus.gearbox.retarderStage * 0.15 + (bus.wheels[0].brakeTorque > 0 ? 0.5 : 0);
    if (this._lastBrake - brake > 0.3) {
      this._hiss({ gain: 0.4, dur: 0.6, freq: 3300 });
    }
    this._lastBrake += (brake - this._lastBrake) * Math.min(1, dt * 8);

    // Lufttrockner-Abblasen, wenn der Governor abschaltet
    if (this._lastGovernor && !bus.air.governorOpen) {
      this._hiss({ gain: 0.35, dur: 1.2, freq: 2800 });
    }
    this._lastGovernor = bus.air.governorOpen;

    // Leises Bremsenquietschen kurz vor dem Stillstand
    const speed = bus.speedKmh;
    if (speed > 0.5 && speed < 7 && bus.wheels[0].brakeTorque > 1500) {
      if (this._squealGate <= 0) {
        this._hiss({ gain: 0.05 + Math.random() * 0.04, dur: 0.3, freq: 5200 + Math.random() * 800 });
        this._squealGate = 0.25;
      }
    }
    this._squealGate -= dt;
  }
}
