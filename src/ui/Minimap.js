// Minimap: statische Stadtkarte (einmal gerendert) + Route, Haltestellen
// und Bus-Pfeil pro Frame darüber.

export class Minimap {
  constructor(roadNet, route) {
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.size = this.canvas.width;
    this.worldSpan = 1240;
    this.route = route;

    // Statische Ebene
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = this.staticLayer.height = this.size;
    this._renderStatic(roadNet, route);
  }

  _w2m(x, z) {
    const s = this.size / this.worldSpan;
    return [this.size / 2 + x * s, this.size / 2 + z * s];
  }

  _renderStatic(roadNet, route) {
    const ctx = this.staticLayer.getContext('2d');
    ctx.fillStyle = '#11151c';
    ctx.fillRect(0, 0, this.size, this.size);

    // Straßen
    ctx.strokeStyle = '#3b4250';
    const { xs, zs, halfX, halfZ, segNS, segEW } = roadNet;
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < segNS[i].length; j++) {
        if (!segNS[i][j]) continue;
        ctx.lineWidth = halfX[i] > 5 ? 4 : 2;
        const [x0, y0] = this._w2m(xs[i], zs[j]);
        const [x1, y1] = this._w2m(xs[i], zs[j + 1]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    for (let j = 0; j < zs.length; j++) {
      for (let i = 0; i < segEW[j].length; i++) {
        if (!segEW[j][i]) continue;
        ctx.lineWidth = halfZ[j] > 5 ? 4 : 2;
        const [x0, y0] = this._w2m(xs[i], zs[j]);
        const [x1, y1] = this._w2m(xs[i + 1], zs[j]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }

    // Route
    ctx.strokeStyle = '#e8a33d';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    route.polyline.forEach(([x, z], i) => {
      const [mx, my] = this._w2m(x, z);
      if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
    });
    ctx.closePath();
    ctx.stroke();

    // Haltestellen
    for (const s of route.stops) {
      const [mx, my] = this._w2m(s.pos.x, s.pos.z);
      ctx.fillStyle = '#e8a33d';
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#11151c';
      ctx.beginPath();
      ctx.arc(mx, my, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  update(busPos, busYaw, nextStop) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.staticLayer, 0, 0);

    // nächste Haltestelle hervorheben
    if (nextStop) {
      const [mx, my] = this._w2m(nextStop.pos.x, nextStop.pos.z);
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Bus-Pfeil
    const [bx, by] = this._w2m(busPos.x, busPos.z);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(-busYaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
