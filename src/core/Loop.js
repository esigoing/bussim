// RAF-Loop mit festem 240-Hz-Physik-Akkumulator.
// Max. 5 Substeps pro Frame: bei heftigen Hitches lieber Zeitlupe als Explosion.

export const FIXED_DT = 1 / 240;
const MAX_SUBSTEPS = 5;

export class Loop {
  constructor(fixedUpdate, frameUpdate) {
    this.fixedUpdate = fixedUpdate;   // (FIXED_DT) — Physik
    this.frameUpdate = frameUpdate;   // (dt, alpha) — Render & alles andere
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25; // Tab war im Hintergrund

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0; // Rest verwerfen

    const alpha = this.accumulator / FIXED_DT;
    this.frameUpdate(dt, alpha);

    this._raf = requestAnimationFrame(this._tick);
  }
}
