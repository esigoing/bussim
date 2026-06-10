import * as THREE from 'three';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Framerate-unabhängiges exponentielles Glätten (Freya Holmér damp)
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampAngle(current, target, lambda, dt) {
  let d = target - current;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return current + d * (1 - Math.exp(-lambda * dt));
}

// Trägheitstensor eines Quaders (lokal, diagonal)
export function boxInertia(mass, sx, sy, sz) {
  const k = mass / 12;
  return new THREE.Vector3(
    k * (sy * sy + sz * sz),
    k * (sx * sx + sz * sz),
    k * (sx * sx + sy * sy)
  );
}

// Lineare Interpolation in einer [x, y]-Stützpunkttabelle (x aufsteigend)
export function lookupCurve(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}
