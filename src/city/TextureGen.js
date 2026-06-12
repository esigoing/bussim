// Stadt-Texturen: Fassadenstile (inkl. Altbau, Reihenhaus, Glas-Raster,
// Industrie), Erdgeschoss-Ladenzeile mit Schaufenstern/Schildern, Markisen-
// Streifen, Litfaßsäulen-Plakate, Bahnhofsuhr und Pflaster für Plätze.
// Alles prozedural (Canvas), Heightfield → Sobel-Normal-Map wie im
// graphics-TextureGen.

import * as THREE from 'three';
import { fbm2, valueNoise2, warpedFbm2, cellNoise2 } from '../utils/Noise.js';
import { clamp, lerp } from '../utils/Math3D.js';
import { makeSurface } from '../graphics/materials/TextureGen.js';

// Eine Fassaden-Kachel deckt 9 m × 9 m ab (3 Fensterachsen × 3 Geschosse)
export const TILE = 9;
// Ladenzeilen-Kachel: 6 m breit (2 Läden à 3 m) × 3.6 m hoch (Erdgeschoss)
export const SHOP_TILE_W = 6;
export const SHOP_TILE_H = 3.6;

// Fassadenstile. Indizes sind API für Buildings.js:
// 0-5 wie bisher, 6 Altbau (Gesimse), 7 Reihenhaus (Backstein + Faschen),
// 8 Glas-Rasterfassade (Geschäftsviertel), 9 Industrie (Trapezblech).
export const STYLES = [
  { name: 'brick', wall: [142, 84, 62], mortar: [180, 172, 160] },
  { name: 'brick2', wall: [108, 70, 58], mortar: [165, 158, 148] },
  { name: 'plaster', wall: [212, 200, 178] },
  { name: 'plaster2', wall: [188, 174, 150] },
  { name: 'panel', wall: [168, 170, 172] },
  { name: 'office', wall: [70, 78, 88], glassy: true },
  { name: 'altbau', wall: [224, 206, 176], cornice: true, fascia: true },
  { name: 'townhouse', wall: [126, 78, 60], mortar: [172, 164, 152], fascia: true, rowTint: true },
  { name: 'curtain', wall: [52, 60, 66], curtain: true },
  { name: 'industrial', wall: [150, 152, 154], industrial: true },
];

export function hashCell(cx, cy, seed) {
  let h = (cx * 374761393 + cy * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Gemeinsamer Backofen: texel(mx, my) → [height, r, g, b, rough, er, eg, eb]
// (mx/my in Metern innerhalb der Kachel). Erzeugt Albedo/Normal/Rough/Emissive.
function bakeMaps(size, tileW, tileH, texel) {
  const cA = document.createElement('canvas'); cA.width = cA.height = size;
  const cN = document.createElement('canvas'); cN.width = cN.height = size;
  const cR = document.createElement('canvas'); cR.width = cR.height = size;
  const cE = document.createElement('canvas'); cE.width = cE.height = size;
  const ctxA = cA.getContext('2d'), ctxN = cN.getContext('2d');
  const ctxR = cR.getContext('2d'), ctxE = cE.getContext('2d');
  const imA = ctxA.createImageData(size, size);
  const imR = ctxR.createImageData(size, size);
  const imE = ctxE.createImageData(size, size);
  const h = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const mx = (x / size) * tileW;
      const my = ((size - 1 - y) / size) * tileH;
      const t = texel(mx, my);
      h[i] = t[0];
      const ai = i * 4;
      imA.data[ai] = clamp(t[1], 0, 255);
      imA.data[ai + 1] = clamp(t[2], 0, 255);
      imA.data[ai + 2] = clamp(t[3], 0, 255);
      imA.data[ai + 3] = 255;
      const rv = clamp(t[4], 0, 1) * 255;
      imR.data[ai] = rv; imR.data[ai + 1] = rv; imR.data[ai + 2] = rv; imR.data[ai + 3] = 255;
      imE.data[ai] = clamp(t[5] || 0, 0, 255);
      imE.data[ai + 1] = clamp(t[6] || 0, 0, 255);
      imE.data[ai + 2] = clamp(t[7] || 0, 0, 255);
      imE.data[ai + 3] = 255;
    }
  }

  // Normal-Map aus dem Heightfield (wrap-around → kachelbar)
  const imN = ctxN.createImageData(size, size);
  const wrap = (v) => (v + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hl = h[y * size + wrap(x - 1)], hr = h[y * size + wrap(x + 1)];
      const hu = h[wrap(y - 1) * size + x], hd = h[wrap(y + 1) * size + x];
      const nx = (hl - hr) * 2.5, ny = (hd - hu) * 2.5;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const ai = i * 4;
      imN.data[ai] = (nx * inv * 0.5 + 0.5) * 255;
      imN.data[ai + 1] = (ny * inv * 0.5 + 0.5) * 255;
      imN.data[ai + 2] = (inv * 0.5 + 0.5) * 255;
      imN.data[ai + 3] = 255;
    }
  }

  ctxA.putImageData(imA, 0, 0);
  ctxN.putImageData(imN, 0, 0);
  ctxR.putImageData(imR, 0, 0);
  ctxE.putImageData(imE, 0, 0);

  const map = new THREE.CanvasTexture(cA);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(cN);
  const roughnessMap = new THREE.CanvasTexture(cR);
  const emissiveMap = new THREE.CanvasTexture(cE);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap, roughnessMap, emissiveMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { map, normalMap, roughnessMap, emissiveMap };
}

// ------------------------------------------------------------- Fassaden
export function facadeTextures(style, seed, size = 512) {
  const glassy = !!style.glassy;

  return bakeMaps(size, TILE, TILE, (mx, my) => {
    // ---- Ganzglas-Rasterfassade: Pfosten-Riegel-Grid, alles Glas
    if (style.curtain) {
      const mull = (mx % 1.5) < 0.07 || (my % 3) < 0.1;
      if (mull) return [0.9, 58, 62, 66, 0.5, 0, 0, 0];
      const cellX = Math.floor(mx / 1.5), cellY = Math.floor(my / 3);
      const tint = hashCell(cellX, cellY, seed + 9) * 26;
      let er = 0, eg = 0, eb = 0;
      if (hashCell(cellX, cellY * 31, seed + 77) < 0.26) {
        const w = 0.7 + hashCell(cellX, cellY, seed + 5) * 0.3;
        er = 255 * w; eg = 226 * w; eb = 168 * w;
      }
      return [0.25, 40 + tint * 0.5, 58 + tint * 0.8, 68 + tint, 0.06, er, eg, eb];
    }

    // ---- Industriefassade: Trapezblech + hohes Fensterband + Rost
    if (style.industrial) {
      const inBand = my > 6.0 && my < 7.6 && (mx % 3) > 0.25;
      if (inBand) {
        const cellX = Math.floor(mx / 3);
        let er = 0, eg = 0, eb = 0;
        if (hashCell(cellX, 7, seed + 77) < 0.18) { er = 200; eg = 215; eb = 235; }
        return [0.3, 46, 54, 62, 0.15, er, eg, eb];
      }
      const ridge = (mx % 0.5) < 0.25 ? 0.18 : 0;
      let [r, g, b] = style.wall;
      const v = fbm2(mx * 0.9, my * 0.9, 3, seed) * 26 - 13;
      r += v; g += v; b += v;
      // Roststreifen, unten kräftiger
      const rust = warpedFbm2(mx * 0.7, my * 0.35, 3, seed + 41, 1.6);
      const rustAmt = clamp(rust - 0.58, 0, 1) * (my < 4 ? 1.6 : 0.7);
      r = lerp(r, 142, rustAmt); g = lerp(g, 84, rustAmt); b = lerp(b, 52, rustAmt);
      return [0.55 + ridge, r, g, b, 0.7, 0, 0, 0];
    }

    const cellX = Math.floor(mx / 3), cellY = Math.floor(my / 3);
    const wx = mx % 3, wy = my % 3;

    let inWindow;
    if (glassy) {
      inWindow = (wy > 0.25 && wy < 2.75) && (wx % 1.5) > 0.12; // Bandfassade
    } else if (style.fascia) {
      inWindow = wx > 0.85 && wx < 2.15 && wy > 0.55 && wy < 2.45; // hohe Fenster
    } else {
      inWindow = wx > 0.9 && wx < 2.1 && wy > 0.8 && wy < 2.3;
    }

    if (inWindow) {
      const tint = hashCell(cellX * 3 + Math.floor(wx), cellY, seed + 9) * 30;
      let er = 0, eg = 0, eb = 0;
      const litKey = hashCell(cellX + (glassy ? Math.floor(mx / 1.5) * 7 : 0), cellY * 31, seed + 77);
      if (litKey < 0.32) {
        const warm = 0.7 + hashCell(cellX, cellY, seed + 5) * 0.3;
        er = 255 * warm; eg = 190 * warm; eb = 110 * warm;
      }
      return [0.25, 38 + tint * 0.6, 46 + tint * 0.7, 56 + tint, 0.1, er, eg, eb];
    }

    // Helle Fensterfasche (Umrandung) bei Altbau/Reihenhaus
    if (style.fascia &&
        wx > 0.71 && wx < 2.29 && wy > 0.41 && wy < 2.59) {
      const n = fbm2(mx * 2, my * 2, 2, seed + 3);
      const f = 226 + n * 14;
      return [0.78, f, f - 6, f - 18, 0.85, 0, 0, 0];
    }

    const n = fbm2(mx * 1.2, my * 1.2, 3, seed);
    let height = 0.6 + n * 0.3;
    let wallR = style.wall[0], wallG = style.wall[1], wallB = style.wall[2];

    if (style.mortar) {
      // Ziegelraster: Versatz pro Reihe
      const row = Math.floor(my / 0.075);
      const bx = (mx + (row % 2) * 0.11) % 0.22;
      const by = my % 0.075;
      if (bx < 0.012 || by < 0.009) {
        [wallR, wallG, wallB] = style.mortar;
        height -= 0.25;
      } else {
        const v = hashCell(Math.floor((mx + (row % 2) * 0.11) / 0.22), row, seed) * 36 - 18;
        wallR += v; wallG += v * 0.8; wallB += v * 0.7;
      }
    } else {
      const v = n * 40 - 20;
      wallR += v; wallG += v; wallB += v;
    }

    // Reihenhaus-Optik: Farbton wechselt alle 6 m (Haus an Haus)
    if (style.rowTint) {
      const t = hashCell(Math.floor(mx / 6), 3, seed + 21) * 44 - 22;
      wallR += t; wallG += t * 0.7; wallB += t * 0.55;
    }

    // Gesimsbänder (Altbau): heller Putzvorsprung am Geschossende
    if (style.cornice && wy > 2.72) {
      height = 0.92;
      wallR = 232; wallG = 224; wallB = 206;
    }
    // Steinsockel (Altbau, nur ganz unten der Kachel sichtbar)
    if (style.cornice && my < 0.6) {
      wallR = 150; wallG = 142; wallB = 130;
      height = 0.7;
    }

    // Grime: unten + großflächig
    const grime = 0.85 + fbm2(mx * 0.5, my * 0.5, 3, seed + 33) * 0.25 - (my < 1 ? 0.12 : 0);
    let r = wallR * grime, g = wallG * grime, b = wallB * grime;
    // Fensterbank-Schatten
    if (!glassy && !style.fascia && wx > 0.85 && wx < 2.15 && wy > 0.7 && wy < 0.82) {
      r *= 0.6; g *= 0.6; b *= 0.6;
    }
    return [height, r, g, b, 0.92, 0, 0, 0];
  });
}

// ------------------------------------------------------- Ladenzeile (EG)
// Schaufenster, Türen, Pilaster, farbige Schilderbänder. Kachel 6 m × 3.6 m
// (2 Läden à 3 m). Emissive: warm erleuchtete Schaufenster.
export function shopfrontTextures(seed, size = 512) {
  const PALETTE = [
    [168, 52, 44], [42, 96, 70], [40, 70, 120], [180, 130, 40],
    [96, 56, 110], [30, 30, 34],
  ];
  return bakeMaps(size, SHOP_TILE_W, SHOP_TILE_H, (mx, my) => {
    const unit = Math.floor(mx / 3);
    const ux = mx % 3;
    const hue = PALETTE[Math.floor(hashCell(unit, 5, seed) * PALETTE.length)];
    const lit = hashCell(unit, 11, seed + 3) < 0.55;

    // Steinsockel
    if (my < 0.32) {
      const n = fbm2(mx * 4, my * 6, 2, seed + 7) * 18;
      return [0.6, 72 + n, 70 + n, 66 + n, 0.9, 0, 0, 0];
    }
    // Pilaster zwischen den Läden
    if (ux < 0.18 || ux > 2.82) {
      const n = fbm2(mx * 2.4, my * 2.4, 2, seed + 1) * 16;
      return [0.85, 204 + n, 192 + n, 168 + n, 0.9, 0, 0, 0];
    }
    // Abschlussleiste oben
    if (my > 3.42) {
      return [0.8, 168, 158, 140, 0.9, 0, 0, 0];
    }
    // Schilderband mit "Schriftblöcken"
    if (my > 2.7) {
      const txt = my > 2.92 && my < 3.2 &&
        ((ux > 0.55 && ux < 2.45) && hashCell(Math.floor(mx * 9), 2, seed + 9) < 0.62);
      if (txt) {
        const e = lit ? 1 : 0;
        return [0.72, 238, 234, 222, 0.6, 220 * e, 210 * e, 180 * e];
      }
      return [0.7, hue[0], hue[1], hue[2], 0.65, 0, 0, 0];
    }
    // Tür im rechten Drittel jedes zweiten Ladens
    const hasDoor = hashCell(unit, 17, seed + 5) < 0.6;
    if (hasDoor && ux > 2.2 && ux < 2.78 && my < 2.5) {
      const n = fbm2(mx * 6, my * 3, 2, seed + 13) * 12;
      return [0.45, 60 + n, 48 + n, 38 + n, 0.7, 0, 0, 0];
    }
    // Schaufensterglas mit warmer Auslagen-Beleuchtung
    const inGlass = ux > 0.32 && ux < (hasDoor ? 2.1 : 2.68) && my > 0.42 && my < 2.62;
    if (inGlass) {
      const v = valueNoise2(mx * 3, my * 2, seed + 21) * 22;
      let er = 0, eg = 0, eb = 0;
      if (lit) {
        // Auslage: unten heller, mit unregelmäßigen "Waren"-Silhouetten
        const glow = clamp(1.25 - my * 0.35, 0.2, 1) *
          (0.55 + valueNoise2(mx * 5, my * 4, seed + 31) * 0.55);
        er = 255 * glow; eg = 205 * glow; eb = 130 * glow;
      }
      return [0.25, 34 + v, 42 + v, 50 + v, 0.08, er, eg, eb];
    }
    // Rahmen/Brüstung rund ums Glas
    return [0.55, 92, 84, 74, 0.75, 0, 0, 0];
  });
}

// -------------------------------------------------------- Markisenstoff
// Gestreifter Stoff (Markisen, Marktstand-Dächer). Nur Albedo nötig.
export function awningTexture(colA, colB) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  for (let x = 0; x < size; x += 32) {
    ctx.fillStyle = colA;
    ctx.fillRect(x, 0, 16, size);
    ctx.fillStyle = colB;
    ctx.fillRect(x + 16, 0, 16, size);
  }
  // leichte Stoffschattierung
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < size; y += 8) ctx.fillRect(0, y, size, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ------------------------------------------------------------ Bahnhofsuhr
export function clockTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  ctx.fillStyle = '#2c2e33';
  ctx.beginPath(); ctx.arc(cx, cx, 124, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2f0e8';
  ctx.beginPath(); ctx.arc(cx, cx, 112, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1c1d20';
  ctx.lineWidth = 7;
  for (let k = 0; k < 12; k++) { // Minutensteine wie bei der DB-Uhr
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 88, cx + Math.sin(a) * 88);
    ctx.lineTo(cx + Math.cos(a) * 106, cx + Math.sin(a) * 106);
    ctx.stroke();
  }
  // Zeiger auf 10:10
  ctx.lineWidth = 10;
  const hand = (angleDeg, len) => {
    const a = ((angleDeg - 90) / 180) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cx);
    ctx.lineTo(cx + Math.cos(a) * len, cx + Math.sin(a) * len);
    ctx.stroke();
  };
  hand(305, 62);  // Stundenzeiger
  ctx.lineWidth = 7;
  hand(60, 95);   // Minutenzeiger
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// -------------------------------------------------- Litfaßsäulen-Plakate
export function posterTexture(seed = 1) {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a4038';
  ctx.fillRect(0, 0, W, H);
  const cols = ['#d8d2c2', '#c2543e', '#3e6e92', '#d8b13e', '#5e8a52', '#e0e0da'];
  let x = 4;
  let k = 0;
  while (x < W - 30) {
    const w = 44 + Math.floor(hashCell(k, 1, seed) * 36);
    const y = 12 + Math.floor(hashCell(k, 2, seed) * 26);
    const h = 150 + Math.floor(hashCell(k, 3, seed) * 70);
    ctx.fillStyle = cols[Math.floor(hashCell(k, 4, seed) * cols.length)];
    ctx.fillRect(x, y, w, Math.min(h, H - y - 10));
    // Text-Andeutung
    ctx.fillStyle = 'rgba(20,20,24,0.75)';
    for (let ty = y + 14; ty < Math.min(y + h, H - 24); ty += 16) {
      ctx.fillRect(x + 6, ty, w - 12 - hashCell(k, ty, seed) * 18, 6);
    }
    x += w + 6;
    k++;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// -------------------------------------------------- Platz-Pflaster (Kopfstein)
export function cobbleTextures(size = 512, seed = 31) {
  return makeSurface(size, {
    normalScale: 3.5,
    heightFn: (u, v) => {
      const f = cellNoise2(u * 22, v * 22, seed); // Steinkuppen, Fugen tief
      return clamp(1 - f * 2.0, 0, 1) * 0.8 + fbm2(u * 60, v * 60, 2, seed + 2) * 0.15;
    },
    albedoFn: (u, v, h) => {
      const stoneTint = valueNoise2(Math.floor(u * 22) * 3.1, Math.floor(v * 22) * 5.7, seed + 8) * 36;
      let g = 96 + h * 55 + stoneTint;
      const grime = warpedFbm2(u * 4, v * 4, 3, seed + 30, 1.4);
      g *= 0.82 + grime * 0.28;
      return [g * 1.02, g, g * 0.92];
    },
    roughFn: (u, v, h) => 0.94 - h * 0.18,
  });
}
