// Geseedetes 2D-Value-Noise + FBM + Domain-Warp für die Texturgenerierung.
// Hash-basiert (kein Permutationsarray nötig), deterministisch pro Seed.

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const v00 = hash2(xi, yi, seed);
  const v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed);
  const v11 = hash2(xi + 1, yi + 1, seed);
  const sx = smooth(xf), sy = smooth(yf);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy; // 0..1
}

export function fbm2(x, y, octaves = 4, seed = 0, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // 0..1
}

export function warpedFbm2(x, y, octaves = 4, seed = 0, warp = 1.5) {
  const wx = fbm2(x + 13.7, y + 7.1, 3, seed + 500) * warp;
  const wy = fbm2(x - 5.3, y + 19.2, 3, seed + 900) * warp;
  return fbm2(x + wx, y + wy, octaves, seed);
}

// Voronoi-artige Zellabstände (für Aggregat-Sprenkel, Pflastersteine)
export function cellNoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let minD = 8;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 77);
      const dx = px - x, dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < minD) minD = d;
    }
  }
  return Math.sqrt(minD); // ~0..1.4
}
