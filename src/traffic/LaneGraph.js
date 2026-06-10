// Fahrspur-Graph: gerichtete Kanten mit Arc-Length-Kurven.
// 'lane' = gerades Stück zwischen Kreuzungen (kann Ampel am Ende haben),
// 'turn' = Verbindung durch eine Kreuzung. KI-Autos & Busroute laufen darauf.

import * as THREE from 'three';
import { ArcCurve, turnCurve } from '../utils/Curves.js';

let nextEdgeId = 1;

export class LaneEdge {
  constructor(curve, type, speedLimit) {
    this.id = nextEdgeId++;
    this.curve = curve;             // ArcCurve
    this.type = type;               // 'lane' | 'turn'
    this.length = curve.length;
    this.speedLimit = speedLimit;   // m/s
    this.successors = [];           // [{edge, weight}]
    this.signal = null;             // {controller, axis} — Ampel am Kantenende
    this.occupants = [];            // CarAI-Instanzen, sortiert nach s (absteigend)
    // Bounding-Box für nearestEdge-Abfragen
    const pts = curve.points;
    this.minX = Infinity; this.maxX = -Infinity;
    this.minZ = Infinity; this.maxZ = -Infinity;
    for (const p of pts) {
      this.minX = Math.min(this.minX, p.x); this.maxX = Math.max(this.maxX, p.x);
      this.minZ = Math.min(this.minZ, p.z); this.maxZ = Math.max(this.maxZ, p.z);
    }
  }

  addSuccessor(edge, weight) {
    this.successors.push({ edge, weight });
  }
}

const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();

export class LaneGraph {
  constructor() {
    this.edges = [];
  }

  addLane(p0, p1, speedLimit = 13.9) {
    const e = new LaneEdge(new ArcCurve([p0.clone(), p1.clone()]), 'lane', speedLimit);
    this.edges.push(e);
    return e;
  }

  addTurn(p0, dir0, p1, dir1, speedLimit = 5.5) {
    const e = new LaneEdge(turnCurve(p0, dir0, p1, dir1, 10), 'turn', speedLimit);
    this.edges.push(e);
    return e;
  }

  // Nächste 'lane'-Kante zu einer Weltposition mit Richtungspräferenz
  nearestLane(pos, fwd, maxDist = 8) {
    let best = null, bestScore = Infinity;
    for (const e of this.edges) {
      if (e.type !== 'lane') continue;
      if (pos.x < e.minX - maxDist || pos.x > e.maxX + maxDist) continue;
      if (pos.z < e.minZ - maxDist || pos.z > e.maxZ + maxDist) continue;
      // Projektion auf die (gerade) Kante
      const a = e.curve.points[0], b = e.curve.points[e.curve.points.length - 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      let t = ((pos.x - a.x) * abx + (pos.z - a.z) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + abx * t, pz = a.z + abz * t;
      const dx = pos.x - px, dz = pos.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > maxDist) continue;
      // Richtungsbonus: Kante soll in Fahrtrichtung zeigen
      const il = 1 / Math.sqrt(len2);
      const dot = fwd ? (fwd.x * abx * il + fwd.z * abz * il) : 1;
      const score = dist - dot * 3;
      if (score < bestScore) {
        bestScore = score;
        best = { edge: e, s: t * e.length, dist };
      }
    }
    return best;
  }

  sample(edge, s, outPos, outTan) {
    edge.curve.sample(s, outPos ?? _pos, outTan ?? _tan);
  }

  // Validierung: jede Kante braucht Nachfolger (sonst Sackgassen-Despawn)
  validate() {
    let dead = 0;
    for (const e of this.edges) {
      if (e.successors.length === 0) dead++;
    }
    if (dead > 0) console.warn(`LaneGraph: ${dead}/${this.edges.length} Kanten ohne Nachfolger`);
    return dead;
  }
}
