// Fahrer-Informationsdisplay (ICU) im Kombiinstrument:
// Gang, Tacho digital, Kilometerstand, Uhrzeit, nächste Haltestelle,
// Warnhinweise. CanvasTexture, Update mit 10 Hz.

import * as THREE from 'three';

export class ICUDisplay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 200;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.155, 0.097),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false })
    );

    this.nextStop = '—';
    this.odometer = 48213.4; // km
    this.delay = null;       // Fahrplan-Abweichung in Sekunden (+ = zu spät)
    this._accum = 0;
    this._draw({ gearLabel: 'N', speed: 0, time: '10:30', warnings: [] });
  }

  // Platzhalter-API fürs Fahrplan-System: Sekunden (+verspätet/−verfrüht)
  // oder null = keine Anzeige.
  setDelay(seconds) {
    this.delay = seconds;
  }

  update(dt, bus, timeOfDay) {
    this.odometer += (bus.speedKmh / 3600) * dt;
    this._accum += dt;
    if (this._accum < 0.1) return;
    this._accum = 0;

    const gb = bus.gearbox;
    const gearLabel = gb.selector === 'D' ? `D${gb.gear}` : gb.selector;
    const h = Math.floor(timeOfDay) % 24;
    const m = Math.floor((timeOfDay % 1) * 60);
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    const warnings = [];
    if (bus.air.lowAirWarning) warnings.push('!! LUFTDRUCK !!');
    if (bus.doors.anyOpen) warnings.push('TÜREN OFFEN');
    if (bus.parkingBrake || bus.air.springBrakeApplied) warnings.push('FESTSTELLBREMSE');
    if (bus.stopBrake) warnings.push('HALTESTELLENBREMSE');
    if (bus.kneelProgress > 0.1) warnings.push('KNEELING');
    if (bus.engine.fuelLevel < 0.1) warnings.push('KRAFTSTOFF');

    this._draw({
      gearLabel,
      speed: Math.round(bus.speedKmh),
      rpm: Math.round(bus.engine.rpm / 10) * 10,
      time,
      warnings,
      retarder: bus.retarderLevel || 0,
      retarderActive: !!bus.retarderActive,
    });
  }

  _draw({ gearLabel, speed, rpm = 0, time, warnings, retarder = 0, retarderActive = false }) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, W, H);

    // Kopfzeile
    ctx.fillStyle = '#2a3138';
    ctx.fillRect(0, 0, W, 30);
    ctx.fillStyle = '#cfd6de';
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('SCANIA', 10, 21);
    ctx.textAlign = 'right';
    ctx.fillText(time, W - 10, 21);

    // Fahrplan-Abweichung mittig im Kopf: '+2:30' (zu spät) / '-0:45' (zu früh)
    if (this.delay !== null && this.delay !== undefined) {
      const s = Math.round(Math.abs(this.delay));
      const txt = `${this.delay < 0 ? '-' : '+'}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      ctx.fillStyle = this.delay > 0 ? '#ff8b7d' : '#8fe39b';
      ctx.textAlign = 'center';
      ctx.fillText(txt, W / 2, 21);
    }

    // Gang groß
    ctx.fillStyle = '#7fd4ff';
    ctx.font = 'bold 52px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(gearLabel, 14, 92);

    // Retarder-Stufe unter dem Gang (hell, wenn er gerade bremst)
    if (retarder > 0) {
      ctx.fillStyle = retarderActive ? '#ffae42' : '#8a7340';
      ctx.font = 'bold 16px Arial';
      ctx.fillText(`RET ${retarder}`, 14, 112);
    }

    // Geschwindigkeit digital + Drehzahl
    ctx.fillStyle = '#e8eef4';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(String(speed), W - 58, 88);
    ctx.font = '15px Arial';
    ctx.fillStyle = '#8b95a0';
    ctx.fillText('km/h', W - 12, 88);
    ctx.fillText(`${rpm} U/min`, W - 12, 112);

    // Nächste Haltestelle
    ctx.fillStyle = '#39424c';
    ctx.fillRect(0, 122, W, 26);
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`▶ ${this.nextStop}`, 10, 141);

    // Kilometerstand
    ctx.fillStyle = '#8b95a0';
    ctx.font = '13px Arial';
    ctx.fillText(`${this.odometer.toFixed(1)} km`, 10, 165);

    // Warnungen (rot blinkend wäre overkill — invertierte Pille reicht)
    ctx.textAlign = 'right';
    let y = 165;
    ctx.font = 'bold 13px Arial';
    for (const w of warnings.slice(0, 3)) {
      const tw = ctx.measureText(w).width;
      ctx.fillStyle = w.startsWith('!!') ? '#c22018' : '#8a6d1d';
      ctx.fillRect(W - tw - 18, y - 12, tw + 12, 17);
      ctx.fillStyle = '#fff';
      ctx.fillText(w, W - 12, y);
      y += 19;
    }

    this.texture.needsUpdate = true;
  }
}
