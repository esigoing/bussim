// AudioContext-Lebenszyklus, Master-Bus, Kabinen-Reverb, One-Shot-Pool.
// Wird erst nach der User-Geste (Start-Button) erzeugt — Autoplay-Policy.

import { impulseResponse } from './PCM.js';

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // Kabinen-Reverb als Send-Bus
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = impulseResponse(this.ctx, 0.18, 6);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    // Innen-/Außenfilter: alles „draußen" läuft hier durch
    this.exteriorFilter = this.ctx.createBiquadFilter();
    this.exteriorFilter.type = 'lowpass';
    this.exteriorFilter.frequency.value = 1100; // Kamera startet im Cockpit
    this.exteriorFilter.connect(this.master);
    this.exteriorFilter.connect(this.reverb);

    this._oneShots = 0;
    this._interior = true;
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx.state === 'running') this.ctx.suspend();
  }

  get now() {
    return this.ctx.currentTime;
  }

  // Kamera innen/außen: Außenquellen werden gedumpft
  setInterior(interior) {
    if (interior === this._interior) return;
    this._interior = interior;
    this.exteriorFilter.frequency.setTargetAtTime(interior ? 1100 : 18000, this.now, 0.08);
  }

  // dest: 'master' (Cockpit-Quellen) oder 'exterior' (Welt-Quellen)
  playBuffer(buffer, { gain = 1, rate = 1, dest = 'master', when = 0 } = {}) {
    if (this._oneShots >= 16) return null; // Pool-Deckel
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(dest === 'exterior' ? this.exteriorFilter : this.master);
    this._oneShots++;
    src.onended = () => {
      this._oneShots--;
      src.disconnect();
      g.disconnect();
    };
    src.start(this.now + when);
    return src;
  }

  // Dauerquelle: Loop-Buffer → Filter → Gain. Rückgabe zum Live-Steuern.
  makeLoop(buffer, { gain = 0, filterType = null, filterFreq = 1000, q = 1, dest = 'master' } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    let node = src;
    let filter = null;
    if (filterType) {
      filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      filter.Q.value = q;
      node.connect(filter);
      node = filter;
    }
    const g = this.ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    g.connect(dest === 'exterior' ? this.exteriorFilter : this.master);
    src.start();
    return { src, filter, gain: g };
  }
}
