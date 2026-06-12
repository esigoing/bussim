// Gebäude: pro Block 1–4 Baukörper, Fassaden als prozedurale Texturen
// (Albedo/Normal/Roughness/Emissive — zufällig erleuchtete Fenster nachts).
// Viertel-Charakter: Altstadt (niedrig, Satteldächer, Ladenzeilen mit
// Markisen + Auslegerschildern), Geschäftsviertel (hoch, Glas-Raster),
// Wohnviertel (Balkone), Gewerbe (Hallen + Schornstein). Landmarken:
// Kirche, Bahnhof mit Uhr, Glasturm. Geometrie wird pro Material gemerged
// bzw. instanziert → wenige Draw Calls.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { StaticAABB } from '../physics/Collision.js';
import { lerp } from '../utils/Math3D.js';
import {
  STYLES, TILE, SHOP_TILE_W, SHOP_TILE_H,
  facadeTextures, shopfrontTextures, awningTexture, clockTexture,
} from './TextureGen.js';

// Eine Wandfläche eines Quaders. side: 'zlo' (Blick -z), 'zhi', 'xlo', 'xhi'.
// UVs welt-skaliert (uTile × vTile Meter pro Kachel), v=0 an der Unterkante.
function wallSide(side, x0, z0, x1, z1, y0, h, uTile = TILE, vTile = TILE) {
  const w = (side === 'zlo' || side === 'zhi') ? x1 - x0 : z1 - z0;
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) {
    uv.setXY(k, uv.getX(k) * (w / uTile), uv.getY(k) * (h / vTile));
  }
  if (side === 'zlo') { g.rotateY(Math.PI); g.translate((x0 + x1) / 2, y0 + h / 2, z0); }
  else if (side === 'zhi') { g.translate((x0 + x1) / 2, y0 + h / 2, z1); }
  else if (side === 'xlo') { g.rotateY(-Math.PI / 2); g.translate(x0, y0 + h / 2, (z0 + z1) / 2); }
  else { g.rotateY(Math.PI / 2); g.translate(x1, y0 + h / 2, (z0 + z1) / 2); }
  return g;
}

function buildingWalls(x0, z0, x1, z1, y0, h, uTile = TILE, vTile = TILE) {
  return ['zlo', 'zhi', 'xlo', 'xhi'].map((s) => wallSide(s, x0, z0, x1, z1, y0, h, uTile, vTile));
}

// Einzelnes Dreieck/Viereck mit simplen UVs (für Dächer/Giebel)
function quadGeo(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    ...a, ...b, ...c, ...a, ...c, ...d,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
  ]), 2));
  g.computeVertexNormals();
  return g;
}
function triGeo(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
  g.computeVertexNormals();
  return g;
}

// Satteldach über Grundriss x0..x1 × z0..z1, First entlang der längeren
// Achse, mit 0.45 m Überstand. Materialien sind DoubleSide → Winding egal.
function gableRoofGeos(x0, z0, x1, z1, yEave, ridgeH) {
  const o = 0.45;
  const yR = yEave + ridgeH;
  const slopes = [];
  const ends = [];
  if (x1 - x0 >= z1 - z0) {
    const zm = (z0 + z1) / 2;
    slopes.push(quadGeo(
      [x0 - o, yEave - 0.12, z0 - o], [x1 + o, yEave - 0.12, z0 - o],
      [x1 + o, yR, zm], [x0 - o, yR, zm]
    ));
    slopes.push(quadGeo(
      [x1 + o, yEave - 0.12, z1 + o], [x0 - o, yEave - 0.12, z1 + o],
      [x0 - o, yR, zm], [x1 + o, yR, zm]
    ));
    ends.push(triGeo([x0, yEave, z0], [x0, yEave, z1], [x0, yR, zm]));
    ends.push(triGeo([x1, yEave, z1], [x1, yEave, z0], [x1, yR, zm]));
  } else {
    const xm = (x0 + x1) / 2;
    slopes.push(quadGeo(
      [x0 - o, yEave - 0.12, z1 + o], [x0 - o, yEave - 0.12, z0 - o],
      [xm, yR, z0 - o], [xm, yR, z1 + o]
    ));
    slopes.push(quadGeo(
      [x1 + o, yEave - 0.12, z0 - o], [x1 + o, yEave - 0.12, z1 + o],
      [xm, yR, z1 + o], [xm, yR, z0 - o]
    ));
    ends.push(triGeo([x0, yEave, z0], [x1, yEave, z0], [xm, yR, z0]));
    ends.push(triGeo([x1, yEave, z1], [x0, yEave, z1], [xm, yR, z1]));
  }
  return { slopes, ends };
}

// Lokale Wandpunkte → Yaw je Gebäudeseite (lokales +z zeigt nach außen)
const SIDE_YAW = { zhi: 0, zlo: Math.PI, xhi: Math.PI / 2, xlo: -Math.PI / 2 };

export class Buildings {
  // blocks tragen district/landmark/plaza/bays (von CityGen gesetzt).
  // cityDetail 0–3 staffelt Extras (Balkone, Markisen, Schilder, Antennen).
  constructor({ blocks, rand, collision, terrain, cityDetail = 2 }) {
    this.group = new THREE.Group();
    this.materials = [];
    this.signMats = [];
    this._styleMats = new Array(STYLES.length).fill(null);
    this._chimneyDone = false;

    const styleBuckets = STYLES.map(() => []);
    const roofGeos = [];      // Flachdächer + Dachtechnik (dunkel)
    const roofRedGeos = [];   // Satteldächer (Ziegel)
    const gableGeos = [];     // Giebeldreiecke (heller Putz)
    const sockelGeos = [];    // Steinsockel unter Ladenzeilen
    const darkGeos = [];      // Türen, Tore, Lamellen (fast schwarz)
    const shopGeos = [];      // EG-Ladenzeile (Altstadt)
    const balconies = [];     // {x, y, z, yaw}
    const awnings = [[], [], []]; // je Stoff-Variante: {x, y, z, yaw}
    const signs = [[], [], []];   // Auslegerschilder je Leuchtfarbe

    this._buckets = { styleBuckets, roofGeos, roofRedGeos, gableGeos, sockelGeos, darkGeos, shopGeos };

    for (const block of blocks) {
      if (block.park) continue;

      // ---- Landmarken & Sonderblöcke
      if (block.landmark === 'bahnhof') {
        this._buildStation(block, collision, terrain, cityDetail);
        continue;
      }
      if (block.landmark === 'glasturm') {
        this._buildGlassTower(block, collision, terrain, cityDetail);
        continue;
      }
      if (block.landmark === 'kirche') {
        this._buildChurch(block, collision, terrain, rand);
        continue;
      }
      if (block.plaza) continue; // Marktplatz: Stände/Brunnen kommen aus CityGen
      if (block.district === 'gewerbe') {
        this._buildHalls(block, collision, terrain, rand, cityDetail);
        continue;
      }

      const { x0, z0, x1, z1 } = block;
      const district = block.district || 'wohnen';
      const inset = 3.2; // hinter dem Gehweg
      // Parkbuchten drücken die Bebauung auf dieser Seite zurück
      const insZ0 = block.bays && block.bays.some((b) => b.side === 'z0') ? 6.6 : inset;
      const insZ1 = block.bays && block.bays.some((b) => b.side === 'z1') ? 6.6 : inset;
      const bx0 = x0 + inset, bz0 = z0 + insZ0, bx1 = x1 - inset, bz1 = z1 - insZ1;
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

        // Höhe + Stil nach Viertel
        let floors, styleIdx;
        if (district === 'altstadt') {
          floors = rand.int(2, 4);
          styleIdx = rand.pick([0, 2, 3, 6, 6, 6]);
        } else if (district === 'geschaeft') {
          floors = rand.int(7, 14);
          styleIdx = rand.pick([5, 5, 8, 8, 4]);
        } else { // wohnen
          floors = rand.int(2, 5);
          styleIdx = rand.pick([1, 2, 3, 4, 7, 7]);
        }
        const height = floors * 3;

        // Gebäude steht auf der Terrainhöhe seiner Mitte; die Wände reichen
        // 3 m tiefer (Sockel), damit am Hang keine Lücken entstehen.
        const baseY = terrain.hExact((qx0 + qx1) / 2, (qz0 + qz1) / 2) + 0.13;

        // Straßenseiten: Plot-Kante liegt nah an der Blockkante
        const streetSides = [];
        if (pz0 - z0 < 6.8) streetSides.push('zlo');
        if (z1 - pz1 < 6.8) streetSides.push('zhi');
        if (px0 - x0 < 6.8) streetSides.push('xlo');
        if (x1 - px1 < 6.8) streetSides.push('xhi');

        const shopHere = district === 'altstadt' && streetSides.length > 0;
        for (const side of ['zlo', 'zhi', 'xlo', 'xhi']) {
          if (shopHere && streetSides.includes(side)) {
            // Erdgeschoss-Ladenzeile + Steinsockel + Obergeschosse
            shopGeos.push(wallSide(side, qx0, qz0, qx1, qz1, baseY, SHOP_TILE_H, SHOP_TILE_W, SHOP_TILE_H));
            sockelGeos.push(wallSide(side, qx0, qz0, qx1, qz1, baseY - 3, 3, 4, 4));
            if (height - SHOP_TILE_H > 0.5) {
              styleBuckets[styleIdx].push(
                wallSide(side, qx0, qz0, qx1, qz1, baseY + SHOP_TILE_H, height - SHOP_TILE_H)
              );
            }
          } else {
            styleBuckets[styleIdx].push(wallSide(side, qx0, qz0, qx1, qz1, baseY - 3, height + 3));
          }
        }

        // ---- Dach
        const gable = district === 'altstadt' ||
          (district === 'wohnen' && rand.chance(0.45));
        if (gable) {
          const span = Math.min(qx1 - qx0, qz1 - qz0);
          const ridgeH = Math.max(1.6, Math.min(4.2, span * (district === 'altstadt' ? 0.32 : 0.24)));
          const { slopes, ends } = gableRoofGeos(qx0, qz0, qx1, qz1, baseY + height, ridgeH);
          roofRedGeos.push(...slopes);
          gableGeos.push(...ends);
        } else {
          const roof = new THREE.PlaneGeometry(qx1 - qx0, qz1 - qz0);
          roof.rotateX(-Math.PI / 2);
          roof.translate((qx0 + qx1) / 2, baseY + height, (qz0 + qz1) / 2);
          roofGeos.push(roof);
          // Dachaufbau (Technik) bei höheren Gebäuden
          if (floors > 5 && cityDetail >= 1 && rand.chance(0.7)) {
            const hw = rand.float(2, 4);
            const box = new THREE.BoxGeometry(hw, 2.2, hw);
            box.translate(
              rand.float(qx0 + hw, qx1 - hw), baseY + height + 1.1, rand.float(qz0 + hw, qz1 - hw)
            );
            roofGeos.push(box);
          }
          // Kleine Dachantennen als Extra der höchsten Detailstufe
          if (cityDetail >= 3 && rand.chance(0.35)) {
            const ant = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5);
            ant.translate(rand.float(qx0 + 2, qx1 - 2), baseY + height + 1.3, rand.float(qz0 + 2, qz1 - 2));
            roofGeos.push(ant);
          }
        }

        // ---- Balkone (Wohnviertel), an den 3-m-Fensterachsen
        if (district === 'wohnen' && cityDetail >= 1 && floors >= 2) {
          for (const side of streetSides) {
            const alongX = side === 'zlo' || side === 'zhi';
            const a0 = alongX ? qx0 : qz0;
            const a1 = alongX ? qx1 : qz1;
            for (let a = a0 + 1.5; a < a1 - 1.2; a += 3) {
              if (!rand.chance(0.55)) continue;
              for (let f = 1; f < floors; f++) {
                const y = baseY + f * 3;
                balconies.push({
                  x: alongX ? a : (side === 'xlo' ? qx0 : qx1),
                  y,
                  z: alongX ? (side === 'zlo' ? qz0 : qz1) : a,
                  yaw: SIDE_YAW[side],
                });
              }
            }
          }
        }

        // ---- Markisen + Auslegerschilder an der Ladenzeile (Altstadt)
        if (shopHere) {
          for (const side of streetSides) {
            const alongX = side === 'zlo' || side === 'zhi';
            const a0 = alongX ? qx0 : qz0;
            const a1 = alongX ? qx1 : qz1;
            for (let a = a0 + 1.5; a < a1 - 1.2; a += 3) {
              const wallPt = {
                x: alongX ? a : (side === 'xlo' ? qx0 : qx1),
                z: alongX ? (side === 'zlo' ? qz0 : qz1) : a,
                yaw: SIDE_YAW[side],
              };
              if (cityDetail >= 1 && rand.chance(0.6)) {
                awnings[rand.int(0, 2)].push({ ...wallPt, y: baseY + 2.72 });
              } else if (cityDetail >= 2 && rand.chance(0.45)) {
                signs[rand.int(0, 2)].push({ ...wallPt, y: baseY + 3.0 });
              }
            }
          }
        }

        collision.addAABB(new StaticAABB(qx0, qz0, qx1, qz1, baseY + height));
      }
    }

    this._finalizeBuckets();
    this._buildBalconies(balconies);
    this._buildAwnings(awnings, cityDetail);
    this._buildSigns(signs, cityDetail);
  }

  // Material eines Fassadenstils (lazy, genau einmal erzeugt)
  _styleMat(idx) {
    if (this._styleMats[idx]) return this._styleMats[idx];
    const style = STYLES[idx];
    const tex = facadeTextures(style, 1000 + idx * 17);
    const glassy = !!style.glassy || !!style.curtain;
    const mat = Mat.std({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      emissiveMap: tex.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 1,
      metalness: glassy ? 0.4 : 0,
      envMapIntensity: glassy ? 1.0 : 0.3,
    });
    this.materials.push(mat);
    this._styleMats[idx] = mat;
    return mat;
  }

  _addMerged(geos, mat, { cast = true } = {}) {
    if (!geos.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  _finalizeBuckets() {
    const { styleBuckets, roofGeos, roofRedGeos, gableGeos, sockelGeos, darkGeos, shopGeos } = this._buckets;

    styleBuckets.forEach((bucket, idx) => {
      if (bucket.length === 0) return;
      this._addMerged(bucket, this._styleMat(idx));
    });

    if (shopGeos.length) {
      const tex = shopfrontTextures(4711);
      const shopMat = Mat.std({
        map: tex.map,
        normalMap: tex.normalMap,
        roughnessMap: tex.roughnessMap,
        emissiveMap: tex.emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughness: 1,
      });
      this.materials.push(shopMat);
      this._addMerged(shopGeos, shopMat);
    }

    this._addMerged(roofGeos, Mat.std({ color: 0x3b3d3f, roughness: 0.95 }));
    this._addMerged(roofRedGeos, Mat.std({ color: 0x8e4632, roughness: 0.92, side: THREE.DoubleSide }));
    this._addMerged(gableGeos, Mat.std({ color: 0xcfc6b2, roughness: 0.95, side: THREE.DoubleSide }));
    this._addMerged(sockelGeos, Mat.std({ color: 0x6f6a62, roughness: 0.95 }));
    this._addMerged(darkGeos, Mat.std({ color: 0x232529, roughness: 0.7 }), { cast: false });
  }

  // ---- Balkone als InstancedMesh (Platte + 3 Geländerleisten)
  _buildBalconies(list) {
    if (!list.length) return;
    const slab = new THREE.BoxGeometry(1.9, 0.12, 0.95);
    slab.translate(0, -0.06, 0.475);
    const railF = new THREE.BoxGeometry(1.9, 0.55, 0.05);
    railF.translate(0, 0.34, 0.93);
    const railL = new THREE.BoxGeometry(0.05, 0.55, 0.9);
    railL.translate(-0.925, 0.34, 0.47);
    const railR = railL.clone();
    railR.translate(1.85, 0, 0);
    const geo = mergeGeometries([slab, railF, railL, railR]);
    const mat = Mat.std({ color: 0xb6b2a8, roughness: 0.9 });
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const ONE = new THREE.Vector3(1, 1, 1);
    list.forEach((b, k) => {
      q.setFromAxisAngle(Y, b.yaw);
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, ONE);
      inst.setMatrixAt(k, m);
    });
    inst.castShadow = true;
    inst.computeBoundingSphere();
    this.group.add(inst);
  }

  // ---- Markisen: gekippte Stoffkeile über den Schaufenstern
  _buildAwnings(perMat, cityDetail) {
    if (cityDetail < 1) return;
    const fabrics = [
      awningTexture('#b8473a', '#e8e2d4'),
      awningTexture('#3e6e52', '#e8e2d4'),
      awningTexture('#39618e', '#e8e2d4'),
    ];
    const geo = new THREE.BoxGeometry(2.7, 0.06, 1.15);
    geo.translate(0, 0, 0.575); // Drehachse = Hinterkante an der Wand
    const m = new THREE.Matrix4();
    const qYaw = new THREE.Quaternion();
    const qTilt = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const X = new THREE.Vector3(1, 0, 0);
    const ONE = new THREE.Vector3(1, 1, 1);
    qTilt.setFromAxisAngle(X, 0.55);
    perMat.forEach((list, mi) => {
      if (!list.length) return;
      const mat = Mat.std({ map: fabrics[mi], roughness: 0.85, side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((a, k) => {
        qYaw.setFromAxisAngle(Y, a.yaw);
        const q = qYaw.clone().multiply(qTilt); // erst kippen, dann zur Wand drehen
        m.compose(new THREE.Vector3(a.x, a.y, a.z), q, ONE);
        inst.setMatrixAt(k, m);
      });
      inst.castShadow = false; // flache Kleinteile, Schattenkosten sparen
      inst.computeBoundingSphere();
      this.group.add(inst);
    });
  }

  // ---- Auslegerschilder (quer zur Fassade, nachts leuchtend)
  _buildSigns(perMat, cityDetail) {
    if (cityDetail < 2) return;
    const colors = [0xffd27a, 0xff6e5e, 0x7ac4ff];
    const geo = new THREE.BoxGeometry(0.06, 0.5, 0.72);
    geo.translate(0, 0, 0.44);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const ONE = new THREE.Vector3(1, 1, 1);
    perMat.forEach((list, mi) => {
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({
        color: colors[mi], emissive: colors[mi], emissiveIntensity: 0, roughness: 0.5,
      });
      this.signMats.push(mat);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((s, k) => {
        q.setFromAxisAngle(Y, s.yaw);
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q, ONE);
        inst.setMatrixAt(k, m);
      });
      inst.castShadow = false;
      inst.computeBoundingSphere();
      this.group.add(inst);
    });
  }

  // ---- Bahnhof mit Uhr am „Hauptbahnhof"-Stop: Halle + Mittelrisalit
  _buildStation(block, collision, terrain, cityDetail) {
    const stop = block.landmarkStop;
    const { x0, z0, x1, z1 } = block;
    // Welche Blockseite zeigt zum Stop?
    const cands = [
      { side: 'zlo', d: Math.abs(stop.pos.z - z0) },
      { side: 'zhi', d: Math.abs(stop.pos.z - z1) },
      { side: 'xlo', d: Math.abs(stop.pos.x - x0) },
      { side: 'xhi', d: Math.abs(stop.pos.x - x1) },
    ].sort((a, b) => a.d - b.d);
    const side = cands[0].side;
    const alongX = side === 'zlo' || side === 'zhi';
    const along = alongX ? stop.pos.x : stop.pos.z;
    const lo = alongX ? x0 : z0, hi = alongX ? x1 : z1;
    const HW = Math.min(19, (hi - lo) / 2 - 6); // halbe Hallenbreite
    const c = Math.min(hi - HW - 6, Math.max(lo + HW + 6, along));

    // Frontmitte in Weltkoordinaten; lokales +z zeigt zur Straße
    let fx, fz, yaw;
    if (side === 'zlo') { fx = c; fz = z0 + 4.6; yaw = Math.PI; }
    else if (side === 'zhi') { fx = c; fz = z1 - 4.6; yaw = 0; }
    else if (side === 'xlo') { fx = x0 + 4.6; fz = c; yaw = -Math.PI / 2; }
    else { fx = x1 - 4.6; fz = c; yaw = Math.PI / 2; }

    const baseY = terrain.hExact(fx, fz) + 0.13;
    const g = new THREE.Group();
    g.position.set(fx, baseY, fz);
    g.rotation.y = yaw;

    const W = HW; // lokal: Halle x∈[-W,W], Front z=0, Tiefe 16 nach -z
    const altbauMat = this._styleMat(6);
    const hall = buildingWalls(-W, -16, W, 0, -2, 14); // bis 12 m Höhe
    g.add(new THREE.Mesh(mergeGeometries(hall), altbauMat));
    const { slopes, ends } = gableRoofGeos(-W, -16, W, 0, 12, 4.2);
    g.add(new THREE.Mesh(mergeGeometries(slopes),
      Mat.std({ color: 0x4c5258, roughness: 0.85, side: THREE.DoubleSide })));
    g.add(new THREE.Mesh(mergeGeometries(ends),
      Mat.std({ color: 0xcfc6b2, roughness: 0.95, side: THREE.DoubleSide })));

    // Mittelrisalit mit Uhrengiebel
    const ris = buildingWalls(-5, -1, 5, 0.9, -2, 16.4); // bis 14.4 m
    ris.push((() => {
      const top = new THREE.PlaneGeometry(10, 1.9);
      top.rotateX(-Math.PI / 2);
      top.translate(0, 14.4, -0.05);
      return top;
    })());
    g.add(new THREE.Mesh(mergeGeometries(ris), this._styleMat(2)));
    const pediment = new THREE.Mesh(
      triGeo([-5, 14.4, 0.9], [5, 14.4, 0.9], [0, 16.6, 0.9]),
      Mat.std({ color: 0xd8d0bc, roughness: 0.95, side: THREE.DoubleSide })
    );
    g.add(pediment);

    // Bahnhofsuhr
    const clock = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 24),
      Mat.std({ map: clockTexture(), roughness: 0.4 })
    );
    clock.position.set(0, 12.4, 0.96);
    g.add(clock);

    // Eingangstüren + Vordach
    const doorMat = Mat.std({ color: 0x2b2d31, roughness: 0.6 });
    for (const dx of [-3.2, 0, 3.2]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.0, 3.4, 0.22), doorMat);
      door.position.set(dx, 1.7, 0.86);
      g.add(door);
    }
    if (cityDetail >= 1) {
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(12, 0.14, 2.6),
        Mat.std({ color: 0x3a3f45, roughness: 0.6, metalness: 0.4 })
      );
      canopy.position.set(0, 4.7, 2.1);
      g.add(canopy);
    }

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(g);

    // Kollision + Freihaltezone (Welt-AABB der Halle): die Halle erstreckt
    // sich von der Front 16 m ins Blockinnere, ±W entlang der Front.
    let cx0, cz0, cx1, cz1;
    if (side === 'zlo') { cx0 = fx - W; cx1 = fx + W; cz0 = fz; cz1 = fz + 16; }
    else if (side === 'zhi') { cx0 = fx - W; cx1 = fx + W; cz0 = fz - 16; cz1 = fz; }
    else if (side === 'xlo') { cz0 = fz - W; cz1 = fz + W; cx0 = fx; cx1 = fx + 16; }
    else { cz0 = fz - W; cz1 = fz + W; cx0 = fx - 16; cx1 = fx; }
    collision.addAABB(new StaticAABB(cx0, cz0, cx1, cz1, baseY + 14));
    block.keepClear = block.keepClear || [];
    block.keepClear.push({ x0: cx0 - 2, z0: cz0 - 2, x1: cx1 + 2, z1: cz1 + 2 });
  }

  // ---- Glasturm im Geschäftsviertel: Sockel + Turm + Antenne
  _buildGlassTower(block, collision, terrain, cityDetail) {
    const cx = (block.x0 + block.x1) / 2, cz = (block.z0 + block.z1) / 2;
    const baseY = terrain.hExact(cx, cz) + 0.13;
    const curtain = this._styleMat(8);
    const geos = [];
    geos.push(...buildingWalls(cx - 13, cz - 13, cx + 13, cz + 13, baseY - 3, 13)); // Sockel 10 m
    geos.push(...buildingWalls(cx - 9, cz - 9, cx + 9, cz + 9, baseY + 10, 58));    // Turm bis 68 m
    const mesh = new THREE.Mesh(mergeGeometries(geos), curtain);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const roofMat = Mat.std({ color: 0x33363a, roughness: 0.9 });
    const roofs = [];
    const r1 = new THREE.PlaneGeometry(26, 26);
    r1.rotateX(-Math.PI / 2);
    r1.translate(cx, baseY + 10, cz);
    const r2 = new THREE.PlaneGeometry(18, 18);
    r2.rotateX(-Math.PI / 2);
    r2.translate(cx, baseY + 68, cz);
    roofs.push(r1, r2);
    const tech = new THREE.BoxGeometry(5, 2.4, 5);
    tech.translate(cx, baseY + 69.2, cz);
    roofs.push(tech);
    if (cityDetail >= 1) {
      const ant = new THREE.CylinderGeometry(0.1, 0.16, 8, 6);
      ant.translate(cx + 4, baseY + 74, cz - 4);
      roofs.push(ant);
    }
    const roofMesh = new THREE.Mesh(mergeGeometries(roofs), roofMat);
    roofMesh.castShadow = true;
    this.group.add(roofMesh);

    collision.addAABB(new StaticAABB(cx - 13, cz - 13, cx + 13, cz + 13, baseY + 68));
  }

  // ---- Kirche mit Turm auf dem Altstadt-Platz (Nordhälfte des Blocks)
  _buildChurch(block, collision, terrain, rand) {
    const { x0, z0, x1, z1 } = block;
    const cx = (x0 + x1) / 2;
    const cz = z0 + (z1 - z0) * 0.3; // Nordhälfte, Brunnen liegt südlich
    const baseY = terrain.hExact(cx, cz) + 0.13;

    // Kirchenschiff (Ost-West) mit steilem Satteldach
    const nx0 = cx - 11, nx1 = cx + 11, nz0 = cz - 5.5, nz1 = cz + 5.5;
    const nave = buildingWalls(nx0, nz0, nx1, nz1, baseY - 3, 11.5); // 8.5 m Wand
    const naveMesh = new THREE.Mesh(mergeGeometries(nave), this._styleMat(6));
    naveMesh.castShadow = true;
    naveMesh.receiveShadow = true;
    this.group.add(naveMesh);
    const { slopes, ends } = gableRoofGeos(nx0, nz0, nx1, nz1, baseY + 8.5, 5);
    const roofMesh = new THREE.Mesh(mergeGeometries(slopes),
      Mat.std({ color: 0x5a4538, roughness: 0.9, side: THREE.DoubleSide }));
    roofMesh.castShadow = true;
    this.group.add(roofMesh);
    const endMesh = new THREE.Mesh(mergeGeometries(ends),
      Mat.std({ color: 0xd8d0bc, roughness: 0.95, side: THREE.DoubleSide }));
    this.group.add(endMesh);

    // Turm am Westende, schlicht verputzt (ohne Fensterraster)
    const towerMat = Mat.std({ color: 0xd6d0c2, roughness: 0.95 });
    const tx = nx0 - 3.4;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(6.4, 23, 6.4), towerMat);
    tower.position.set(tx, baseY + 11.5 - 3, cz); // 3 m Sockel einbegraben
    tower.castShadow = true;
    tower.receiveShadow = true;
    this.group.add(tower);
    // Schallluken
    const louverMat = Mat.std({ color: 0x2e3033, roughness: 0.8 });
    for (const [lx, lz, ry] of [[3.21, 0, Math.PI / 2], [-3.21, 0, -Math.PI / 2], [0, 3.21, 0], [0, -3.21, Math.PI]]) {
      const louver = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 0.1), louverMat);
      louver.position.set(tx + lx, baseY + 17, cz + lz);
      louver.rotation.y = ry;
      this.group.add(louver);
    }
    // Pyramidenhelm + Kreuz
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(4.5, 7.5, 4),
      Mat.std({ color: 0x4a5a48, roughness: 0.7, metalness: 0.3 })
    );
    spire.rotation.y = Math.PI / 4;
    spire.position.set(tx, baseY + 20 + 3.75, cz);
    spire.castShadow = true;
    this.group.add(spire);
    const crossMat = Mat.std({ color: 0xc8a84a, roughness: 0.35, metalness: 0.8 });
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), crossMat);
    crossV.position.set(tx, baseY + 28.4, cz);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), crossMat);
    crossH.position.set(tx, baseY + 28.6, cz);
    this.group.add(crossV, crossH);
    // Portal zur Platzmitte (Süden)
    const portal = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.8, 0.3), louverMat);
    portal.position.set(cx, baseY + 1.9, nz1 + 0.06);
    this.group.add(portal);

    collision.addAABB(new StaticAABB(nx0, nz0, nx1, nz1, baseY + 13.5));
    collision.addAABB(new StaticAABB(tx - 3.2, cz - 3.2, tx + 3.2, cz + 3.2, baseY + 28));
    block.keepClear = block.keepClear || [];
    block.keepClear.push({ x0: tx - 6, z0: nz0 - 3, x1: nx1 + 3, z1: nz1 + 3 });
  }

  // ---- Gewerbehallen + (einmalig) Schornstein
  _buildHalls(block, collision, terrain, rand, cityDetail) {
    const { x0, z0, x1, z1 } = block;
    const inset = 4;
    const hx0 = x0 + inset, hz0 = z0 + inset, hx1 = x1 - inset, hz1 = z1 - inset;
    if (hx1 - hx0 < 18 || hz1 - hz0 < 18) return;
    const { styleBuckets, roofGeos, darkGeos } = this._buckets;

    const splitAlongX = hx1 - hx0 >= hz1 - hz0;
    const two = rand.chance(0.65);
    const halls = [];
    if (two && splitAlongX) {
      const m = lerp(hx0, hx1, rand.float(0.4, 0.6));
      halls.push([hx0, hz0, m - 3, hz1], [m + 3, hz0, hx1, hz1]);
    } else if (two) {
      const m = lerp(hz0, hz1, rand.float(0.4, 0.6));
      halls.push([hx0, hz0, hx1, m - 3], [hx0, m + 3, hx1, hz1]);
    } else {
      halls.push([hx0, hz0, hx1, hz1]);
    }

    for (const [a0, b0, a1, b1] of halls) {
      const hH = rand.float(7, 9);
      const baseY = terrain.hExact((a0 + a1) / 2, (b0 + b1) / 2) + 0.13;
      styleBuckets[9].push(...buildingWalls(a0, b0, a1, b1, baseY - 3, hH + 3));
      const roof = new THREE.PlaneGeometry(a1 - a0, b1 - b0);
      roof.rotateX(-Math.PI / 2);
      roof.translate((a0 + a1) / 2, baseY + hH, (b0 + b1) / 2);
      roofGeos.push(roof);
      if (cityDetail >= 1) {
        for (let k = 0; k < 3; k++) {
          const vent = new THREE.BoxGeometry(1.6, 1.0, 1.6);
          vent.translate(rand.float(a0 + 3, a1 - 3), baseY + hH + 0.5, rand.float(b0 + 3, b1 - 3));
          roofGeos.push(vent);
        }
      }
      if (cityDetail >= 2) {
        // Rolltore auf der Südseite (zur z1-Kante)
        for (let x = a0 + 6; x < a1 - 5; x += 9) {
          const gate = new THREE.BoxGeometry(4.2, 4.4, 0.2);
          gate.translate(x, baseY + 2.2, b1 + 0.06);
          darkGeos.push(gate);
        }
      }
      collision.addAABB(new StaticAABB(a0, b0, a1, b1, baseY + hH));
    }

    // Ein Schornstein für das ganze Gewerbeviertel
    if (!this._chimneyDone) {
      this._chimneyDone = true;
      const sx = hx0 + 5, sz = hz0 + 5;
      const baseY = terrain.hExact(sx, sz) + 0.13;
      const chimney = new THREE.Mesh(
        new THREE.CylinderGeometry(1.15, 1.75, 30, 12),
        Mat.std({ color: 0x7c5044, roughness: 0.9 })
      );
      chimney.position.set(sx, baseY + 15, sz);
      chimney.castShadow = true;
      this.group.add(chimney);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(1.25, 1.25, 1.6, 12),
        Mat.std({ color: 0x2e3033, roughness: 0.85 })
      );
      band.position.set(sx, baseY + 29.2, sz);
      this.group.add(band);
      collision.addAABB(new StaticAABB(sx - 2, sz - 2, sx + 2, sz + 2, baseY + 30));
    }
  }

  update(env) {
    const glow = env.night * 1.6;
    for (const m of this.materials) m.emissiveIntensity = glow;
    for (const m of this.signMats) m.emissiveIntensity = env.night * 2.4;
  }
}
