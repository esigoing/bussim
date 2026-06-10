// Prozedurale PBR-Texturen: Heightfield aus geseedetem FBM → Sobel-Normal-Map,
// Albedo/Roughness aus Rezepten. Keine externen Bilddateien.

import * as THREE from 'three';
import { fbm2, valueNoise2, cellNoise2, warpedFbm2 } from '../../utils/Noise.js';
import { clamp, lerp } from '../../utils/Math3D.js';

let ANISO = 8;
export function setAnisotropy(a) { ANISO = a; }

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Kern: Height-/Albedo-/Roughness-Funktionen pro Texel auswerten.
// heightFn(u,v) -> 0..1 | albedoFn(u,v,h) -> [r,g,b] 0..255 | roughFn(u,v,h) -> 0..1
export function makeSurface(size, { heightFn, albedoFn, roughFn, normalScale = 2.0, repeat = [1, 1] }) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      h[y * size + x] = heightFn(x / size, v);
    }
  }

  // Albedo
  const ac = makeCanvas(size);
  const actx = ac.getContext('2d');
  const aimg = actx.createImageData(size, size);
  // Roughness
  const rc = makeCanvas(size);
  const rctx = rc.getContext('2d');
  const rimg = rctx.createImageData(size, size);
  // Normal (Sobel auf Heightfield, wrap-around für Kachelbarkeit)
  const nc = makeCanvas(size);
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(size, size);

  const wrap = (i) => (i + size) % size;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const hv = h[i];

      const [r, g, b] = albedoFn(u, v, hv);
      const ai = i * 4;
      aimg.data[ai] = r; aimg.data[ai + 1] = g; aimg.data[ai + 2] = b; aimg.data[ai + 3] = 255;

      const rough = clamp(roughFn(u, v, hv), 0, 1) * 255;
      rimg.data[ai] = rough; rimg.data[ai + 1] = rough; rimg.data[ai + 2] = rough; rimg.data[ai + 3] = 255;

      // Sobel
      const hl = h[y * size + wrap(x - 1)], hr = h[y * size + wrap(x + 1)];
      const hu = h[wrap(y - 1) * size + x], hd = h[wrap(y + 1) * size + x];
      let nx = (hl - hr) * normalScale;
      let ny = (hd - hu) * normalScale; // +Y der Normal-Map zeigt nach „oben" in UV
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nimg.data[ai] = (nx * inv * 0.5 + 0.5) * 255;
      nimg.data[ai + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nimg.data[ai + 2] = (nz * inv * 0.5 + 0.5) * 255;
      nimg.data[ai + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);

  const map = new THREE.CanvasTexture(ac);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nc);
  const roughnessMap = new THREE.CanvasTexture(rc);
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = ANISO;
    t.needsUpdate = true;
  }
  return { map, normalMap, roughnessMap };
}

// ------------------------------------------------------------------ Asphalt
// FBM-Basis + Aggregat-Sprenkel + dunklere Reparaturflecken + polierte
// Fahrspuren entlang V (niedrigere Roughness → liest sich nass großartig).
export function asphaltTextures(size = 1024, seed = 1) {
  return makeSurface(size, {
    normalScale: 3.0,
    heightFn: (u, v) => {
      const base = fbm2(u * 24, v * 24, 4, seed) * 0.5;
      const agg = cellNoise2(u * 140, v * 140, seed + 3) < 0.32 ? 0.5 : 0;
      const crack = fbm2(u * 90, v * 90, 2, seed + 9);
      return base + agg * 0.35 + (crack > 0.78 ? -0.3 : 0);
    },
    albedoFn: (u, v, h) => {
      let g = 38 + h * 42;
      // Reparaturflecken (dunkler, großflächig)
      const patch = warpedFbm2(u * 3, v * 3, 3, seed + 20, 1.2);
      if (patch > 0.62) g *= 0.72;
      // helle abgeriebene Mitte zwischen Fahrspuren
      const speck = valueNoise2(u * 300, v * 300, seed + 5);
      if (speck > 0.93) g += 50;
      return [g, g, g * 1.04];
    },
    roughFn: (u, v, h) => {
      let r = 0.88 + h * 0.1;
      // Reifen-polierte Spuren bei u≈0.3 / 0.7 (Lane-UV überspannt eine Fahrbahn)
      const track = Math.exp(-((u - 0.3) ** 2) / 0.004) + Math.exp(-((u - 0.7) ** 2) / 0.004);
      r -= track * 0.18;
      return r;
    },
  });
}

// ------------------------------------------------------------------ Gehweg
// Betonplatten mit Fugenraster und Schmutzverlauf.
export function sidewalkTextures(size = 512, seed = 2) {
  const tiles = 6;
  return makeSurface(size, {
    normalScale: 4.0,
    heightFn: (u, v) => {
      const fx = (u * tiles) % 1, fy = (v * tiles) % 1;
      const groove = (fx < 0.04 || fx > 0.96 || fy < 0.04 || fy > 0.96) ? -0.9 : 0;
      return 0.5 + fbm2(u * 40, v * 40, 3, seed) * 0.25 + groove;
    },
    albedoFn: (u, v, h) => {
      const tileShade = valueNoise2(Math.floor(u * tiles) * 13.7, Math.floor(v * tiles) * 7.3, seed + 8);
      let g = 120 + tileShade * 35 + fbm2(u * 60, v * 60, 3, seed + 2) * 22;
      if (h < 0) g *= 0.55; // Fugen dunkler
      const grime = fbm2(u * 5, v * 5, 3, seed + 30);
      g *= 0.85 + grime * 0.25;
      return [g, g * 0.985, g * 0.95];
    },
    roughFn: (u, v, h) => 0.92 - (h > 0.6 ? 0.06 : 0),
  });
}

// ------------------------------------------------------------------ Beton (Gebäudesockel, Bordstein)
export function concreteTextures(size = 512, seed = 4) {
  return makeSurface(size, {
    normalScale: 2.0,
    heightFn: (u, v) => fbm2(u * 30, v * 30, 4, seed) * 0.4 + valueNoise2(u * 200, v * 200, seed + 1) * 0.1,
    albedoFn: (u, v, h) => {
      let g = 132 + h * 60;
      const stain = warpedFbm2(u * 4, v * 8, 3, seed + 11, 1.8);
      g *= 0.8 + stain * 0.3;
      g *= 1 - (1 - v) * 0.15; // unten dunkler (Spritzwasser)
      return [g, g * 0.98, g * 0.94];
    },
    roughFn: () => 0.95,
  });
}

// ------------------------------------------------------------------ Gras / Parkboden
export function grassTextures(size = 512, seed = 6) {
  return makeSurface(size, {
    normalScale: 2.5,
    heightFn: (u, v) => fbm2(u * 50, v * 50, 4, seed) * 0.6,
    albedoFn: (u, v, h) => {
      const patch = warpedFbm2(u * 6, v * 6, 3, seed + 4, 1.5);
      const dryness = clamp(patch * 1.4 - 0.3, 0, 1);
      const r = lerp(48, 96, dryness) + h * 28;
      const g = lerp(86, 104, dryness) + h * 34;
      const b = lerp(30, 42, dryness) + h * 12;
      return [r, g, b];
    },
    roughFn: () => 0.98,
  });
}

// ------------------------------------------------------------------ Erde / Baumscheibe
export function dirtTextures(size = 256, seed = 7) {
  return makeSurface(size, {
    normalScale: 3.0,
    heightFn: (u, v) => fbm2(u * 30, v * 30, 4, seed) * 0.7,
    albedoFn: (u, v, h) => {
      const g = 52 + h * 40;
      return [g * 1.15, g * 0.85, g * 0.6];
    },
    roughFn: () => 1.0,
  });
}

// ------------------------------------------------------------------ Buslack
// Fast flach, Orange-Peel in der Normal-Map, Clearcoat kommt vom Material.
export function busPaintTextures(size = 256, seed = 12) {
  return makeSurface(size, {
    normalScale: 0.35,
    heightFn: (u, v) => fbm2(u * 90, v * 90, 3, seed) * 0.5,
    albedoFn: () => [232, 233, 235], // Weißlack reflektiert real ~80 %
    roughFn: (u, v, h) => 0.34 + h * 0.05,
  });
}

// ------------------------------------------------------------------ Gebürstetes Metall (Haltestangen)
export function metalTextures(size = 128, seed = 14) {
  return makeSurface(size, {
    normalScale: 0.6,
    heightFn: (u, v) => valueNoise2(u * 4, v * 300, seed) * 0.5,
    albedoFn: () => [210, 212, 216],
    roughFn: (u, v, h) => 0.3 + h * 0.15,
  });
}

// ------------------------------------------------------------------ Sitzpolster (Stadtbus-Muster)
export function seatFabricTextures(size = 256, seed = 16) {
  return makeSurface(size, {
    normalScale: 1.6,
    heightFn: (u, v) => fbm2(u * 80, v * 80, 3, seed) * 0.4,
    albedoFn: (u, v) => {
      // dunkles Blau mit feinem Rautenmuster — typisch ÖPNV
      const dia = (Math.abs(((u * 14 + v * 14) % 1) - 0.5) < 0.06 ||
                   Math.abs(((u * 14 - v * 14) % 1 + 1) % 1 - 0.5) < 0.06);
      const speck = valueNoise2(u * 250, v * 250, seed + 2) > 0.9;
      let r = 26, g = 34, b = 64;
      if (dia) { r = 160; g = 40; b = 44; }
      if (speck) { r += 60; g += 60; b += 60; }
      return [r, g, b];
    },
    roughFn: () => 0.95,
  });
}

// ------------------------------------------------------------------ Armaturen-Kunststoff
export function dashPlasticTextures(size = 256, seed = 18) {
  return makeSurface(size, {
    normalScale: 1.0,
    heightFn: (u, v) => valueNoise2(u * 220, v * 220, seed) * 0.35,
    albedoFn: (u, v, h) => {
      const g = 32 + h * 10;
      return [g, g, g + 2];
    },
    roughFn: (u, v, h) => 0.62 + h * 0.1,
  });
}

// ------------------------------------------------------------------ Gummi (Reifen, Faltenbalg)
export function rubberTextures(size = 128, seed = 20) {
  return makeSurface(size, {
    normalScale: 1.5,
    heightFn: (u, v) => fbm2(u * 40, v * 40, 3, seed) * 0.3,
    albedoFn: (u, v, h) => {
      const g = 16 + h * 12;
      return [g, g, g];
    },
    roughFn: () => 0.92,
  });
}

// ------------------------------------------------------------------ Boden im Bus (Riffel-Gummi)
export function busFloorTextures(size = 256, seed = 22) {
  return makeSurface(size, {
    normalScale: 2.0,
    heightFn: (u, v) => {
      const dots = cellNoise2(u * 40, v * 40, seed) < 0.22 ? 0.8 : 0.2;
      return dots + fbm2(u * 100, v * 100, 2, seed + 1) * 0.15;
    },
    albedoFn: (u, v, h) => {
      const g = 42 + h * 16;
      return [g, g * 0.98, g * 0.93];
    },
    roughFn: () => 0.85,
  });
}
