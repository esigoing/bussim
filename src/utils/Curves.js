import * as THREE from 'three';

// Polyline mit Arc-Length-LUT: O(1)-Sampling von Position/Tangente über s.
// Grundlage des Lane-Graphen — KI-Autos und Busroute laufen darüber.

export class ArcCurve {
  constructor(points) {
    this.points = points; // THREE.Vector3[]
    this.cum = new Float32Array(points.length);
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += points[i].distanceTo(points[i - 1]);
      this.cum[i] = len;
    }
    this.length = len;
  }

  // s in [0, length] → schreibt Position nach outPos, Tangente nach outTan
  sample(s, outPos, outTan) {
    const cum = this.cum, pts = this.points;
    if (s <= 0) {
      outPos.copy(pts[0]);
      if (outTan) outTan.subVectors(pts[1], pts[0]).normalize();
      return;
    }
    if (s >= this.length) {
      const n = pts.length;
      outPos.copy(pts[n - 1]);
      if (outTan) outTan.subVectors(pts[n - 1], pts[n - 2]).normalize();
      return;
    }
    // Binärsuche über die LUT
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const t = (s - cum[lo]) / (cum[hi] - cum[lo]);
    outPos.lerpVectors(pts[lo], pts[hi], t);
    if (outTan) outTan.subVectors(pts[hi], pts[lo]).normalize();
  }
}

// Kreisbogen-Verbinder für Abbieger in Kreuzungen: verbindet (p0, dir0) → (p1, dir1)
// über eine quadratische/kubische Bézier-Annäherung, tesseliert zu einer Polyline.
export function turnCurve(p0, dir0, p1, dir1, segments = 12) {
  const d = p0.distanceTo(p1);
  const c0 = p0.clone().addScaledVector(dir0, d * 0.4);
  const c1 = p1.clone().addScaledVector(dir1, -d * 0.4);
  const bez = new THREE.CubicBezierCurve3(p0.clone(), c0, c1, p1.clone());
  return new ArcCurve(bez.getPoints(segments));
}
