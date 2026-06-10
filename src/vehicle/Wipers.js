// Scheibenwischer: Modi 0 aus, 1 Intervall, 2 langsam, 3 schnell.
// Liefert den aktuellen Wischwinkel (0..1 über den Bogen) für die
// 3D-Arme und die Tropfen-Lösch-Maske der Windschutzscheibe.

export class Wipers {
  constructor() {
    this.mode = 0;
    this.phase = 0;        // 0..1 hin, 1..2 zurück
    this.active = false;   // gerade in Bewegung (für Intervall)
    this.pauseTimer = 0;
  }

  cycleMode() {
    this.mode = (this.mode + 1) % 4;
  }

  update(dt) {
    if (this.mode === 0 && !this.active) {
      // Arm fährt in Parkposition zurück
      if (this.phase > 0 && this.phase < 2) {
        this.phase = Math.min(2, this.phase + dt * 1.2);
        if (this.phase >= 2) this.phase = 0;
      }
      return;
    }

    const speed = this.mode === 3 ? 1.9 : 1.1; // Zyklen-Geschwindigkeit

    if (this.mode === 1 && !this.active) {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) this.active = true;
      else return;
    } else {
      this.active = true;
    }

    this.phase += dt * speed;
    if (this.phase >= 2) {
      this.phase = 0;
      if (this.mode === 1) {
        this.active = false;
        this.pauseTimer = 3.5;
      }
      if (this.mode === 0) this.active = false;
    }
  }

  // 0..1 Position über den Wischbogen (0 = Parkstellung)
  get sweep() {
    const p = this.phase;
    const t = p < 1 ? p : 2 - p;
    // leichtes Easing an den Umkehrpunkten
    return t * t * (3 - 2 * t);
  }

  get isMoving() {
    return this.active || (this.phase > 0.01 && this.phase < 1.99);
  }
}
