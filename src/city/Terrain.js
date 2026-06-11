// Sanftes Hügel-Höhenfeld über der Stadt. Wellenlänge ~350 m, Amplitude
// ±6 m, radialer Falloff zum Stadtrand (Anschluss an die flache Umgebung).
// WICHTIG: h(x,z) ist die einzige Quelle der Wahrheit — Physik-groundQuery,
// Straßen-Vertices, Lane-Kurven, Gebäude und Props nutzen alle diese Funktion.

import { fbm2 } from '../utils/Noise.js';
import { smoothstep } from '../utils/Math3D.js';

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this._cache = new Map(); // grobes Gitter-Caching für Hot-Path-Abfragen
  }

  h(x, z) {
    // 4-m-Raster cachen: Physik fragt 4 Räder × 240 Hz ab
    const key = (Math.round(x / 4) * 8192 + Math.round(z / 4)) | 0;
    const hit = this._cache.get(key);
    if (hit !== undefined) return hit;

    const n = fbm2(x / 350 + 3.7, z / 350 - 1.3, 3, this.seed);
    const ridge = fbm2(x / 700 - 8.1, z / 700 + 5.5, 2, this.seed + 50);
    let v = (n - 0.5) * 9 + (ridge - 0.5) * 5;

    const r = Math.hypot(x, z);
    v *= 1 - smoothstep(430, 560, r); // Falloff zum flachen Umland

    if (this._cache.size > 60000) this._cache.clear();
    this._cache.set(key, v);
    return v;
  }

  // Exakte (ungecachte) Variante für die Mesh-Generierung
  hExact(x, z) {
    const n = fbm2(x / 350 + 3.7, z / 350 - 1.3, 3, this.seed);
    const ridge = fbm2(x / 700 - 8.1, z / 700 + 5.5, 2, this.seed + 50);
    let v = (n - 0.5) * 9 + (ridge - 0.5) * 5;
    const r = Math.hypot(x, z);
    v *= 1 - smoothstep(430, 560, r);
    return v;
  }
}
