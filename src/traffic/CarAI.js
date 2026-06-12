// Einzelnes KI-Auto: IDM-Folgemodell (Intelligent Driver Model) auf dem
// Lane-Graphen. Hält an roten Ampeln, folgt Vorderleuten und dem Bus.

import { clamp } from '../utils/Math3D.js';

const A_MAX = 1.8;       // m/s² Beschleunigung
const B_COMF = 2.2;      // m/s² komfortable Verzögerung
const T_HEAD = 1.4;      // s Zeitlücke
const S0 = 2.6;          // m Mindestabstand
const LOOKAHEAD = 70;    // m Sichtweite über Kanten hinweg

export class CarAI {
  // len: Fahrzeuglänge in m (aus der Typ-Konfig, für IDM-Abstände)
  constructor(edge, s, rand, len = 4.5) {
    this.edge = edge;
    this.s = s;
    this.v = 0;
    this.len = len;
    this.rand = rand;
    this.nextEdge = this._pickNext();
    this.stuckTimer = 0;
  }

  _pickNext() {
    const succ = this.edge.successors;
    if (succ.length === 0) return null;
    let total = 0;
    for (const s of succ) total += s.weight;
    let r = this.rand.next() * total;
    for (const s of succ) {
      r -= s.weight;
      if (r <= 0) return s.edge;
    }
    return succ[succ.length - 1].edge;
  }

  // occupancy: Map<edgeId, [{s, len, v}] sortiert aufsteigend nach s>
  update(dt, occupancy, wetness) {
    const edge = this.edge;
    const v0 = Math.max(3, edge.speedLimit * (1 - 0.18 * wetness));

    // ---- Lücke zum nächsten Hindernis bestimmen
    let gap = Infinity;
    let leadV = 0;

    // 1) Vorderleute auf der eigenen Kante
    const own = occupancy.get(edge.id);
    if (own) {
      for (const o of own) {
        if (o.ref === this) continue;
        const ds = o.s - this.s;
        if (ds > 0.01 && ds - o.len / 2 - this.len / 2 < gap) {
          gap = ds - o.len / 2 - this.len / 2;
          leadV = o.v;
        }
      }
    }

    // 2) Ampel am Kantenende
    const distEnd = edge.length - this.s;
    if (edge.signal && distEnd < LOOKAHEAD) {
      const st = edge.signal.controller.state(edge.signal.axis);
      const mustStop = st === 'red' || (st === 'yellow' && distEnd > this.v * 2.2);
      if (mustStop) {
        const stopGap = distEnd - 2.5;
        if (stopGap < gap) {
          gap = stopGap;
          leadV = 0;
        }
      }
    }

    // 3) Über Kanten hinweg schauen (nur wenn frei bis Kantenende)
    if (gap > distEnd && this.nextEdge) {
      let acc = distEnd;
      let e = this.nextEdge;
      let guard = 0;
      while (acc < LOOKAHEAD && e && guard++ < 4) {
        const occ = occupancy.get(e.id);
        if (occ && occ.length) {
          // erstes Fahrzeug auf der Kante
          let first = null;
          for (const o of occ) {
            if (o.ref !== this && (first === null || o.s < first.s)) first = o;
          }
          if (first) {
            const ds = acc + first.s - first.len / 2 - this.len / 2;
            if (ds < gap) { gap = ds; leadV = first.v; }
            break;
          }
        }
        // Ampel der Folgekante prüfen (Turn-Kanten haben keine)
        if (e.signal) {
          const st2 = e.signal.controller.state(e.signal.axis);
          if (st2 !== 'green') {
            const ds = acc + e.length - 2.5;
            if (ds < gap) { gap = ds; leadV = 0; }
            break;
          }
        }
        acc += e.length;
        e = e.successors.length ? e.successors[0].edge : null;
      }
    }

    // Kurven langsam anfahren: Turn-Kante voraus begrenzt die Zielgeschwindigkeit
    let vTarget = v0;
    if (this.nextEdge && this.nextEdge.type === 'turn' && distEnd < 25) {
      vTarget = Math.min(v0, this.nextEdge.speedLimit + (distEnd / 25) * (v0 - this.nextEdge.speedLimit));
    }

    // ---- IDM
    let a;
    if (gap < 0.3) {
      a = -8; // Notbremsung / steckt fest
    } else if (gap === Infinity) {
      a = A_MAX * (1 - (this.v / vTarget) ** 4);
    } else {
      const dv = this.v - leadV;
      const sStar = S0 + this.v * T_HEAD + (this.v * dv) / (2 * Math.sqrt(A_MAX * B_COMF));
      a = A_MAX * (1 - (this.v / vTarget) ** 4 - (sStar / Math.max(gap, 0.5)) ** 2);
    }
    this.v = Math.max(0, this.v + clamp(a, -9, A_MAX) * dt);
    this.s += this.v * dt;

    // Watchdog gegen Verklemmen abseits von Ampeln
    if (this.v < 0.1) this.stuckTimer += dt;
    else this.stuckTimer = 0;

    // ---- Kantenwechsel
    if (this.s >= edge.length) {
      if (!this.nextEdge) {
        // Sackgasse: zurück an den Anfang der Kante (Respawn macht das System)
        this.s = edge.length;
        this.v = 0;
        return false;
      }
      this.s -= edge.length;
      this.edge = this.nextEdge;
      this.nextEdge = this._pickNext();
    }
    return true;
  }
}
