// Gebäude: pro Block 1–4 Baukörper, Fassaden als prozedurale Texturen
// (Albedo/Normal/Roughness/Emissive — zufällig erleuchtete Fenster nachts).
// Geometrie wird pro Fassadenstil zu einem Mesh gemerged → wenige Draw Calls.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { fbm2, valueNoise2 } from '../utils/Noise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { StaticAABB } from '../physics/Collision.js';
import { clamp, lerp } from '../utils/Math3D.js';

// Eine Textur-Kachel deckt 9 m × 9 m ab (3 Fensterachsen × 3 Geschosse)
const TILE = 9;

const STYLES = [
  { name: 'brick', wall: [142, 84, 62], mortar: [180, 172, 160], winFrame: true },
  { name: 'brick2', wall: [108, 70, 58], mortar: [165, 158, 148], winFrame: true },
  { name: 'plaster', wall: [212, 200, 178], winFrame: true },
  { name: 'plaster2', wall: [188, 174, 150], winFrame: true },
  { name: 'panel', wall: [168, 170, 172], winFrame: false },
  { name: 'office', wall: [70, 78, 88], glassy: true },
];

function hashCell(cx, cy, seed) {
  let h = (cx * 374761393 + cy * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function facadeTextures(style, seed, size = 512) {
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

  const glassy = !!style.glassy;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const mx = (x / size) * TILE;            // Meter in der Kachel
      const my = ((size - 1 - y) / size) * TILE;
      const cellX = Math.floor(mx / 3), cellY = Math.floor(my / 3);
      const wx = mx % 3, wy = my % 3;

      let inWindow;
      if (glassy) {
        inWindow = (wy > 0.25 && wy < 2.75) && (wx % 1.5) > 0.12; // Bandfassade
      } else {
        inWindow = wx > 0.9 && wx < 2.1 && wy > 0.8 && wy < 2.3;
      }

      let height, r, g, b, rough;
      if (inWindow) {
        height = 0.25; // zurückgesetzt
        const tint = hashCell(cellX * 3 + Math.floor(wx), cellY, seed + 9) * 30;
        r = 38 + tint * 0.6; g = 46 + tint * 0.7; b = 56 + tint;
        rough = 0.1;
      } else {
        const n = fbm2(mx * 1.2, my * 1.2, 3, seed);
        height = 0.6 + n * 0.3;
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
        // Grime: unten + unter den Fenstern dunkler
        const grime = 0.85 + fbm2(mx * 0.5, my * 0.5, 3, seed + 33) * 0.25 - (my < 1 ? 0.12 : 0);
        r = wallR * grime; g = wallG * grime; b = wallB * grime;
        rough = 0.92;
        // Fensterbank-Schatten
        if (!glassy && wx > 0.85 && wx < 2.15 && wy > 0.7 && wy < 0.82) {
          r *= 0.6; g *= 0.6; b *= 0.6;
        }
      }
      h[i] = height;
      const ai = i * 4;
      imA.data[ai] = clamp(r, 0, 255); imA.data[ai + 1] = clamp(g, 0, 255);
      imA.data[ai + 2] = clamp(b, 0, 255); imA.data[ai + 3] = 255;
      const rv = rough * 255;
      imR.data[ai] = rv; imR.data[ai + 1] = rv; imR.data[ai + 2] = rv; imR.data[ai + 3] = 255;

      // Emissive: erleuchtete Fenster (warm, pro Fenster zufällig)
      if (inWindow) {
        const litKey = hashCell(cellX + (glassy ? Math.floor(mx / 1.5) * 7 : 0), cellY * 31, seed + 77);
        if (litKey < 0.32) {
          const warm = 0.7 + hashCell(cellX, cellY, seed + 5) * 0.3;
          imE.data[ai] = 255 * warm;
          imE.data[ai + 1] = 190 * warm;
          imE.data[ai + 2] = 110 * warm;
        }
      }
      imE.data[ai + 3] = 255;
    }
  }

  // Normal-Map aus dem Heightfield
  const imN = ctxN.createImageData(size, size);
  const wrap = (v) => (v + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hl = h[y * size + wrap(x - 1)], hr = h[y * size + wrap(x + 1)];
      const hu = h[wrap(y - 1) * size + x], hd = h[wrap(y + 1) * size + x];
      let nx = (hl - hr) * 2.5, ny = (hd - hu) * 2.5;
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

// Vier Wandflächen eines Quaders mit Welt-skalierten UVs (Kachel = 9 m)
function buildingWalls(x0, z0, x1, z1, height) {
  const w = x1 - x0, d = z1 - z0;
  const geos = [];
  const make = (width, hgt) => {
    const g = new THREE.PlaneGeometry(width, hgt);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, uv.getX(k) * (width / TILE), uv.getY(k) * (hgt / TILE));
    }
    return g;
  };
  let g = make(w, height); // Süd (+z-Normale? PlaneGeometry zeigt +z)
  g.translate(0, 0, 0);
  g.rotateY(Math.PI);
  g.translate((x0 + x1) / 2, height / 2, z0);
  geos.push(g);
  g = make(w, height);
  g.translate((x0 + x1) / 2, height / 2, z1);
  geos.push(g);
  g = make(d, height);
  g.rotateY(-Math.PI / 2);
  g.translate(x0, height / 2, (z0 + z1) / 2);
  geos.push(g);
  g = make(d, height);
  g.rotateY(Math.PI / 2);
  g.translate(x1, height / 2, (z0 + z1) / 2);
  geos.push(g);
  return geos;
}

export class Buildings {
  constructor({ blocks, rand, collision, citySize }) {
    this.group = new THREE.Group();
    this.materials = [];

    const styleBuckets = STYLES.map(() => []);
    const roofGeos = [];
    const baseY = 0.13;

    for (const block of blocks) {
      if (block.park) continue;
      const { x0, z0, x1, z1, zone } = block;
      const inset = 3.2; // hinter dem Gehweg
      const bx0 = x0 + inset, bz0 = z0 + inset, bx1 = x1 - inset, bz1 = z1 - inset;
      if (bx1 - bx0 < 12 || bz1 - bz0 < 12) continue;

      // 1–4 Baukörper: 2×2-Teilung mit zufälligem Zusammenlegen
      const splitX = rand.float(0.35, 0.65);
      const splitZ = rand.float(0.35, 0.65);
      const mx = lerp(bx0, bx1, splitX);
      const mz = lerp(bz0, bz1, splitZ);
      const mergeX = rand.chance(0.4);
      const mergeZ = rand.chance(0.4);

      let plots;
      if (mergeX && mergeZ) {
        plots = [[bx0, bz0, bx1, bz1]];
      } else if (mergeX) {
        plots = [[bx0, bz0, bx1, mz], [bx0, mz, bx1, bz1]];
      } else if (mergeZ) {
        plots = [[bx0, bz0, mx, bz1], [mx, bz0, bx1, bz1]];
      } else {
        plots = [[bx0, bz0, mx, mz], [mx, bz0, bx1, mz], [bx0, mz, mx, bz1], [mx, mz, bx1, bz1]];
      }

      for (const [px0, pz0, px1, pz1] of plots) {
        const gap = rand.float(0.5, 2.5);
        const qx0 = px0 + gap, qz0 = pz0 + gap, qx1 = px1 - gap, qz1 = pz1 - gap;
        if (qx1 - qx0 < 9 || qz1 - qz0 < 9) continue;

        // Höhe nach Zone: Zentrum hoch, Rand niedrig
        let floors;
        if (zone === 'center') floors = rand.int(5, 13);
        else if (zone === 'mid') floors = rand.int(3, 7);
        else floors = rand.int(2, 4);
        const height = floors * 3;

        let styleIdx;
        if (zone === 'center') styleIdx = rand.chance(0.45) ? 5 : rand.int(2, 4);
        else styleIdx = rand.int(0, 4);

        const walls = buildingWalls(qx0, qz0, qx1, qz1, height);
        for (const w of walls) {
          w.translate(0, baseY, 0);
          styleBuckets[styleIdx].push(w);
        }
        const roof = new THREE.PlaneGeometry(qx1 - qx0, qz1 - qz0);
        roof.rotateX(-Math.PI / 2);
        roof.translate((qx0 + qx1) / 2, baseY + height, (qz0 + qz1) / 2);
        roofGeos.push(roof);

        // Dachaufbau (Technik) bei höheren Gebäuden
        if (floors > 5 && rand.chance(0.7)) {
          const hw = rand.float(2, 4);
          const box = new THREE.BoxGeometry(hw, 2.2, hw);
          box.translate(
            rand.float(qx0 + hw, qx1 - hw), baseY + height + 1.1, rand.float(qz0 + hw, qz1 - hw)
          );
          roofGeos.push(box);
        }

        collision.addAABB(new StaticAABB(qx0, qz0, qx1, qz1, height));
      }
    }

    // Stil-Buckets → Meshes
    STYLES.forEach((style, idx) => {
      if (styleBuckets[idx].length === 0) return;
      const tex = facadeTextures(style, 1000 + idx * 17);
      const mat = Mat.std({
        map: tex.map,
        normalMap: tex.normalMap,
        roughnessMap: tex.roughnessMap,
        emissiveMap: tex.emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughness: 1,
        metalness: style.glassy ? 0.4 : 0,
        envMapIntensity: style.glassy ? 1.0 : 0.3,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(mergeGeometries(styleBuckets[idx]), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });

    // Dächer
    const roofMat = Mat.std({ color: 0x3b3d3f, roughness: 0.95 });
    const roofMesh = new THREE.Mesh(mergeGeometries(roofGeos), roofMat);
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    this.group.add(roofMesh);
  }

  update(env) {
    const glow = env.night * 1.6;
    for (const m of this.materials) m.emissiveIntensity = glow;
  }
}
