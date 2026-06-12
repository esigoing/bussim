// Straßennetz v2: Nord-Süd-Straßen schlängeln sich als sanfte Kurven
// (centerX(i, z) = Grundlinie + Sinus-Auslenkung), Ost-West-Straßen bleiben
// gerade, folgen aber dem Hügel-Höhenfeld. Erzeugt
// (a) Render-Meshes — Kurven-Strips mit eingemalten Markierungen,
//     Kreuzungs-Patches, an den Kreuzungen beschnittene Gehweg-Strips mit
//     Eck-Patches, Zebrastreifen an signalisierten Kreuzungen —
// (b) den Fahrspur-Graphen (Polyline-Kanten inkl. Höhe) mit Abbiegern/Ampeln,
// (c) den Gehweg-Export this.sidewalkPaths für Fußgängersysteme.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { asphaltTextures, sidewalkTextures } from '../graphics/materials/TextureGen.js';
import { LaneGraph } from '../traffic/LaneGraph.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KMH = 1 / 3.6;
const CURB_H = 0.13;
const SIDEWALK_W = 2.5;
// Einheitliche Y-Lifts gegen Z-Fighting — EINE Quelle der Wahrheit:
const ROAD_LIFT = 0.012;                                // alle Fahrbahn-Strips über Terrain
const PATCH_LIFT = 0.022;                               // Kreuzungs-Patches über den Strips
const CORNER_LIFT = CURB_H + (PATCH_LIFT - ROAD_LIFT);  // Gehweg-Ecken knapp über den Gehweg-Strips
const ZEBRA_RAISE = 0.004;                              // Zebrastreifen über Patch/Fahrbahn

// Markierungen in eine Kopie der Asphalt-Albedo malen.
// Textur deckt die volle Straßenbreite (u) und 12 m Länge (v) ab.
function roadTexture(seed, lanesPerDir) {
  const texSet = asphaltTextures(512, seed);
  const canvas = texSet.map.image;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = 'rgba(225, 225, 218, 0.82)';
  const lineW = W * 0.012;

  if (lanesPerDir === 1) {
    ctx.fillRect(W / 2 - lineW / 2, 0, lineW, H / 2);   // Mittellinie gestrichelt
    ctx.fillRect(W * 0.045, 0, lineW, H);               // Randlinien
    ctx.fillRect(W * 0.955 - lineW, 0, lineW, H);
  } else {
    ctx.fillRect(W / 2 - lineW * 1.6, 0, lineW, H);     // Doppellinie
    ctx.fillRect(W / 2 + lineW * 0.6, 0, lineW, H);
    ctx.fillRect(W * 0.25 - lineW / 2, 0, lineW, H / 2);
    ctx.fillRect(W * 0.75 - lineW / 2, 0, lineW, H / 2);
    ctx.fillRect(W * 0.03, 0, lineW, H);
    ctx.fillRect(W * 0.97 - lineW, 0, lineW, H);
  }
  texSet.map.needsUpdate = true;
  return texSet;
}

const _tan = new THREE.Vector3();

// Quad-Strip entlang einer Mittellinien-Polyline (Punkte inkl. Höhe).
function stripGeometry(points, halfWidth, vScale = 1 / 12, yLift = 0) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  let cum = 0;
  for (let k = 0; k < n; k++) {
    const p = points[k];
    const pPrev = points[Math.max(0, k - 1)];
    const pNext = points[Math.min(n - 1, k + 1)];
    _tan.subVectors(pNext, pPrev);
    _tan.y = 0;
    _tan.normalize();
    const latX = _tan.z, latZ = -_tan.x; // rechts der Laufrichtung
    if (k > 0) cum += p.distanceTo(points[k - 1]);
    const o = k * 6;
    pos[o] = p.x - latX * halfWidth; pos[o + 1] = p.y + yLift; pos[o + 2] = p.z - latZ * halfWidth;
    pos[o + 3] = p.x + latX * halfWidth; pos[o + 4] = p.y + yLift; pos[o + 5] = p.z + latZ * halfWidth;
    const uo = k * 4;
    uv[uo] = 0; uv[uo + 1] = cum * vScale;
    uv[uo + 2] = 1; uv[uo + 3] = cum * vScale;
    if (k > 0) {
      const a = (k - 1) * 2, b = k * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Polyline seitlich versetzen (für Fahrspuren).
// KONVENTION: offset > 0 = LINKS der Laufrichtung (lat = (tan.z, -tan.x)).
function offsetPolyline(points, offset) {
  const out = [];
  const n = points.length;
  for (let k = 0; k < n; k++) {
    const pPrev = points[Math.max(0, k - 1)];
    const pNext = points[Math.min(n - 1, k + 1)];
    _tan.subVectors(pNext, pPrev);
    _tan.y = 0;
    _tan.normalize();
    out.push(new THREE.Vector3(
      points[k].x + _tan.z * offset,
      points[k].y,
      points[k].z - _tan.x * offset
    ));
  }
  return out;
}

export class RoadNetwork {
  constructor({ xs, zs, halfX, halfZ, amps, phases, freqs, segNS, segEW, signalized, seed, trafficLights, terrain }) {
    this.xs = xs;
    this.zs = zs;
    this.halfX = halfX;
    this.halfZ = halfZ;
    this.amps = amps;       // Schlängel-Amplitude je NS-Straße
    this.phases = phases;
    this.freqs = freqs;
    this.segNS = segNS;     // segNS[i][j] = Segment existiert (zs[j]..zs[j+1])
    this.segEW = segEW;
    this.signalized = signalized;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.graph = new LaneGraph();
    this.trafficLights = trafficLights;

    this.streetTex = roadTexture(seed + 1, 1);
    this.avenueTex = roadTexture(seed + 2, 2);
    this.streetMat = Mat.std({ ...this.streetTex, color: 0xffffff }, { wet: 'puddles' });
    this.avenueMat = Mat.std({ ...this.avenueTex, color: 0xffffff }, { wet: 'puddles' });
    const plainTex = asphaltTextures(512, seed + 3);
    this.plainMat = Mat.std({ ...plainTex, color: 0xffffff }, { wet: 'puddles' });
    const sideTex = sidewalkTextures(512, seed + 4);
    this.sidewalkMat = Mat.std({ ...sideTex, color: 0xffffff }, { wet: true });
    this.zebraMat = Mat.std({ color: 0xdedbd2, roughness: 0.85 }, { wet: true });

    this._buildRoadMeshes();
    this._buildLaneGraph();
  }

  // Mittellinien-X der NS-Straße i auf Höhe z (die Kurve!)
  centerX(i, z) {
    return this.xs[i] + this.amps[i] * Math.sin(z * this.freqs[i] + this.phases[i]);
  }

  isAvenueX(i) { return this.halfX[i] > 5; }
  isAvenueZ(j) { return this.halfZ[j] > 5; }
  boundX(i) { return this.halfX[i] + 0.8; }
  boundZ(j) { return this.halfZ[j] + 0.8; }

  // Schrittzahl ~8 m, an Steigungen verdichtet (Faktor 1 + |dy/dx|·8) —
  // sonst schneidet die Sehne an Hügeln in das Terrain bzw. schwebt darüber.
  _gradSteps(len, hA, hM, hB) {
    const grad = Math.max(Math.abs(hM - hA), Math.abs(hB - hM)) / Math.max(1, len / 2);
    return Math.max(2, Math.ceil((len / 8) * (1 + grad * 8)));
  }

  // Mittellinien-Polyline eines NS-Segments (zA..zB), Schritt ~8 m, mit Höhe
  _nsCenterline(i, zA, zB, lift = ROAD_LIFT) {
    const pts = [];
    const zM = (zA + zB) / 2;
    const steps = this._gradSteps(
      zB - zA,
      this.terrain.hExact(this.centerX(i, zA), zA),
      this.terrain.hExact(this.centerX(i, zM), zM),
      this.terrain.hExact(this.centerX(i, zB), zB)
    );
    for (let s = 0; s <= steps; s++) {
      const z = zA + ((zB - zA) * s) / steps;
      const x = this.centerX(i, z);
      pts.push(new THREE.Vector3(x, this.terrain.hExact(x, z) + lift, z));
    }
    return pts;
  }

  // Gerade EW-Polyline (xA..xB bei z), mit Höhenprofil
  _ewCenterline(xA, xB, z, lift = ROAD_LIFT) {
    const pts = [];
    const xM = (xA + xB) / 2;
    const steps = this._gradSteps(
      xB - xA,
      this.terrain.hExact(xA, z),
      this.terrain.hExact(xM, z),
      this.terrain.hExact(xB, z)
    );
    for (let s = 0; s <= steps; s++) {
      const x = xA + ((xB - xA) * s) / steps;
      pts.push(new THREE.Vector3(x, this.terrain.hExact(x, z) + lift, z));
    }
    return pts;
  }

  _contiguousRuns(segArr) {
    const runs = [];
    let start = -1;
    for (let k = 0; k <= segArr.length; k++) {
      const ex = k < segArr.length && segArr[k];
      if (ex && start === -1) start = k;
      if (!ex && start !== -1) {
        runs.push([start, k - 1]);
        start = -1;
      }
    }
    return runs;
  }

  _intersectionExists(i, j) {
    const ns = (j > 0 && this.segNS[i][j - 1]) || (j < this.segNS[i].length && this.segNS[i][j]);
    const ew = (i > 0 && this.segEW[j][i - 1]) || (i < this.segEW[j].length && this.segEW[j][i]);
    return ns && ew;
  }

  // Existiert am Knoten (i,j) der EW-Arm auf Seite sx (+1 = +x)?
  _ewArm(i, j, sx) {
    const row = this.segEW[j];
    return sx > 0 ? i < row.length && !!row[i] : i > 0 && !!row[i - 1];
  }

  // Existiert am Knoten (i,j) der NS-Arm auf Seite sz (+1 = +z)?
  _nsArm(i, j, sz) {
    const col = this.segNS[i];
    return sz > 0 ? j < col.length && !!col[j] : j > 0 && !!col[j - 1];
  }

  _buildRoadMeshes() {
    const sidewalkGeos = [];
    const zebraGeos = [];

    // EXPORT für Fußgängersysteme:
    //   this.sidewalkPaths = [ { pts: THREE.Vector3[] }, ... ]
    // Jeder Eintrag ist die Mittellinie EINES Gehweg-Strips (Breite SIDEWALK_W,
    // d.h. begehbar ±SIDEWALK_W/2 quer zur Polyline), an den Kreuzungen
    // beschnitten (Grenze: bound + SIDEWALK_W vom Kreuzungsknoten). Beide
    // Straßenseiten aller Segmente sind enthalten, Punktabstand ≤8 m,
    // Punkt-y = Terrain + CURB_H (== groundHeight() auf dem Gehweg).
    this.sidewalkPaths = [];

    // Gehweg-Stück bauen: Strip-Geometrie + Mittellinie exportieren
    const addWalk = (center, off) => {
      const walkway = offsetPolyline(center, off);
      sidewalkGeos.push(stripGeometry(walkway, SIDEWALK_W / 2, 1 / 2.5, CURB_H));
      this.sidewalkPaths.push({
        pts: walkway.map((p) => new THREE.Vector3(p.x, this.terrain.hExact(p.x, p.z) + CURB_H, p.z)),
      });
    };

    // ---- NS-Straßen: Kurven-Strips (zusammenhängende Läufe inkl. Kreuzungen)
    for (let i = 0; i < this.xs.length; i++) {
      for (const [j0, j1] of this._contiguousRuns(this.segNS[i])) {
        const z0 = this.zs[j0] - this.boundZ(j0);
        const z1 = this.zs[j1 + 1] + this.boundZ(j1 + 1);
        const center = this._nsCenterline(i, z0, z1, ROAD_LIFT);
        const mesh = new THREE.Mesh(
          stripGeometry(center, this.halfX[i]),
          this.isAvenueX(i) ? this.avenueMat : this.streetMat
        );
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Gehwege beidseitig — pro Stück ZWISCHEN den Kreuzungen, an den
        // Kreuzungsrändern beschnitten (sonst überlagern sie die Mündungen
        // und Gehwege der Querstraße → Z-Fighting/Schweben). Fehlt der
        // Quer-Arm auf dieser Seite (T-Kreuzung), läuft der Gehweg durch.
        for (const sx of [-1, 1]) {
          const off = sx * (this.halfX[i] + SIDEWALK_W / 2);
          let zA = this._ewArm(i, j0, sx) ? this.zs[j0] + this.boundZ(j0) + SIDEWALK_W : z0;
          for (let j = j0 + 1; j <= j1 + 1; j++) {
            const clip = this._ewArm(i, j, sx);
            if (!clip && j <= j1) continue; // keine Querstraße → durchlaufen
            const zB = clip ? this.zs[j] - this.boundZ(j) - SIDEWALK_W : z1;
            if (zB - zA > 1.2) addWalk(this._nsCenterline(i, zA, zB, ROAD_LIFT), off);
            zA = this.zs[j] + this.boundZ(j) + SIDEWALK_W;
          }
        }
      }
    }

    // ---- EW-Straßen: gerade Strips zwischen den (verschobenen) Kreuzungen
    for (let j = 0; j < this.zs.length; j++) {
      for (const [i0, i1] of this._contiguousRuns(this.segEW[j])) {
        const xA0 = this.centerX(i0, this.zs[j]) - this.boundX(i0);
        const xB0 = this.centerX(i1 + 1, this.zs[j]) + this.boundX(i1 + 1);
        if (xB0 <= xA0) continue;
        const center = this._ewCenterline(xA0, xB0, this.zs[j], ROAD_LIFT);
        const mesh = new THREE.Mesh(
          stripGeometry(center, this.halfZ[j]),
          this.isAvenueZ(j) ? this.avenueMat : this.streetMat
        );
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Gehwege je Seite: Clip-X an der NS-KURVE auf Gehweg-Höhe (zSide)
        // messen, nicht auf zs[j] — sonst klafft an stark geschwungenen
        // Querstraßen ein Spalt zur Ecke. offsetPolyline: offset>0 = -z.
        for (const sz of [-1, 1]) {
          const off = -sz * (this.halfZ[j] + SIDEWALK_W / 2);
          const zSide = this.zs[j] + sz * (this.halfZ[j] + SIDEWALK_W / 2);
          let xA = this._nsArm(i0, j, sz) ? this.centerX(i0, zSide) + this.boundX(i0) + SIDEWALK_W : xA0;
          for (let i = i0 + 1; i <= i1 + 1; i++) {
            const clip = this._nsArm(i, j, sz);
            if (!clip && i <= i1) continue; // keine Querstraße → durchlaufen
            const xB = clip ? this.centerX(i, zSide) - this.boundX(i) - SIDEWALK_W : xB0;
            if (xB - xA > 1.2) addWalk(this._ewCenterline(xA, xB, this.zs[j], ROAD_LIFT), off);
            xA = this.centerX(i, zSide) + this.boundX(i) + SIDEWALK_W;
          }
        }
      }
    }

    // ---- Kreuzungen: Fahrbahn-Patch + vier Gehweg-Ecken + Zebrastreifen
    const patches = [];
    for (let i = 0; i < this.xs.length; i++) {
      for (let j = 0; j < this.zs.length; j++) {
        if (!this._intersectionExists(i, j)) continue;
        const cx = this.centerX(i, this.zs[j]);
        const cz = this.zs[j];
        // Patch deckt die Mündungs-Lücken: bound (+0.8) + 0.2 Reserve
        const w = this.halfX[i] * 2 + 2 * (0.8 + 0.2);
        const d = this.halfZ[j] * 2 + 2 * (0.8 + 0.2);
        const g = new THREE.PlaneGeometry(w, d, 3, 3);
        g.rotateX(-Math.PI / 2);
        const uvA = g.attributes.uv;
        for (let k = 0; k < uvA.count; k++) {
          uvA.setXY(k, uvA.getX(k) * (w / 12), uvA.getY(k) * (d / 12));
        }
        const posA = g.attributes.position;
        for (let k = 0; k < posA.count; k++) {
          const px = posA.getX(k) + cx, pz = posA.getZ(k) + cz;
          posA.setXYZ(k, px, this.terrain.hExact(px, pz) + PATCH_LIFT, pz);
        }
        g.computeVertexNormals();
        patches.push(g);

        // Gehweg-Ecken: nur in Quadranten, in denen BEIDE Arme existieren
        // (an T-Kreuzungen deckt der durchlaufende Gehweg die offene Seite ab)
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            if (this._nsArm(i, j, sz) && this._ewArm(i, j, sx)) {
              sidewalkGeos.push(this._cornerPatchGeo(i, j, sx, sz));
            }
          }
        }

        // Zebrastreifen an signalisierten Kreuzungen: je vorhandener Mündung
        // ein Streifenfeld auf der Zufahrt (Balken längs der Fahrtrichtung,
        // 0.45 m breit, 2.6 m lang, 0.45 m Lücke)
        if (this.signalized.has(`${i},${j}`)) {
          for (const sz of [-1, 1]) { // Querung der NS-Straße
            if (!this._nsArm(i, j, sz)) continue;
            const zMid = cz + sz * (this.halfZ[j] + 1.6);
            const cxB = this.centerX(i, zMid); // Feld an der Kurve ausrichten
            const n = Math.max(2, Math.floor((2 * (this.halfX[i] - 0.35)) / 0.9));
            const start = cxB - (n * 0.9 - 0.45) / 2;
            const roadY = (px, pz) => this.terrain.hExact(this.centerX(i, pz), pz) + ROAD_LIFT;
            for (let k = 0; k < n; k++) {
              const x0 = start + k * 0.9;
              zebraGeos.push(this._zebraQuad(x0, zMid - 1.3, x0 + 0.45, zMid + 1.3, roadY));
            }
          }
          for (const sx of [-1, 1]) { // Querung der EW-Straße
            if (!this._ewArm(i, j, sx)) continue;
            // Dem Kurven-Bauch der NS-Straße ausweichen
            let bulge = 0;
            for (const zq of [cz - this.halfZ[j], cz + this.halfZ[j]]) {
              bulge = Math.max(bulge, sx * (this.centerX(i, zq) - cx));
            }
            const xMid = cx + sx * (this.halfX[i] + 1.6 + bulge);
            const n = Math.max(2, Math.floor((2 * (this.halfZ[j] - 0.35)) / 0.9));
            const start = cz - (n * 0.9 - 0.45) / 2;
            const roadY = (px) => this.terrain.hExact(px, cz) + ROAD_LIFT;
            for (let k = 0; k < n; k++) {
              const zq0 = start + k * 0.9;
              zebraGeos.push(this._zebraQuad(xMid - 1.3, zq0, xMid + 1.3, zq0 + 0.45, roadY));
            }
          }
        }
      }
    }
    if (patches.length) {
      const patchMesh = new THREE.Mesh(mergeGeometries(patches), this.plainMat);
      patchMesh.receiveShadow = true;
      this.group.add(patchMesh);
    }
    if (zebraGeos.length) {
      const zebra = new THREE.Mesh(mergeGeometries(zebraGeos), this.zebraMat);
      zebra.receiveShadow = true;
      this.group.add(zebra); // castShadow bewusst aus (flache Kleinteile)
    }

    const sidewalks = new THREE.Mesh(mergeGeometries(sidewalkGeos), this.sidewalkMat);
    sidewalks.receiveShadow = true;
    this.group.add(sidewalks);
  }

  // Gehweg-Ecke an Kreuzung (i,j), Quadrant (sx,sz): kleines terrain-konformes
  // Grid zwischen den Straßenmündungen, folgt der NS-Kurve via centerX. Liegt
  // CORNER_LIFT über Terrain (= knapp über den Gehweg-Strips, die wie die
  // Fahrbahn die Mittellinien-Höhe tragen) und überlappt die Strip-Enden
  // bewusst leicht — gleiches Material, kein Z-Fighting dank Höhenabstand.
  _cornerPatchGeo(i, j, sx, sz) {
    const cz = this.zs[j];
    const xIn = this.halfX[i] - 0.2;                              // bis an die Fahrbahnkante
    const xOut = this.boundX(i) + SIDEWALK_W + 0.55;              // über das EW-Gehweg-Ende hinaus
    const zIn = cz + sz * (this.halfZ[j] - 0.2);
    const zOut = cz + sz * (this.boundZ(j) + SIDEWALK_W + 0.25);  // über das NS-Gehweg-Ende hinaus
    const zLo = Math.min(zIn, zOut), zHi = Math.max(zIn, zOut);
    const g = new THREE.PlaneGeometry(1, 1, 3, 3);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uvA = g.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const tz = pos.getZ(k) + 0.5, tx = pos.getX(k) + 0.5;
      const pz = zLo + (zHi - zLo) * tz;
      const xl = xIn + (xOut - xIn) * (sx > 0 ? tx : 1 - tx); // Welt-x bleibt aufsteigend → Winding ok
      const px = this.centerX(i, pz) + sx * xl;
      pos.setXYZ(k, px, this.terrain.hExact(px, pz) + CORNER_LIFT, pz);
      uvA.setXY(k, px / 2.5, pz / 2.5); // gleiche Kachelgröße wie die Gehweg-Strips
    }
    g.computeVertexNormals();
    return g;
  }

  // Einzelner Zebra-Balken als terrain-/fahrbahnkonformes Quad. roadY(px,pz)
  // liefert die Fahrbahnhöhe der gequerten Straße — der Balken liegt
  // ZEBRA_RAISE über dem höheren von Patch- und Fahrbahnfläche.
  _zebraQuad(x0, z0, x1, z1, roadY) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    g.rotateX(-Math.PI / 2);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k) + cx, pz = pos.getZ(k) + cz;
      const y = Math.max(this.terrain.hExact(px, pz) + PATCH_LIFT, roadY(px, pz)) + ZEBRA_RAISE;
      pos.setXYZ(k, px, y, pz);
    }
    g.computeVertexNormals();
    return g;
  }

  _laneOffsets(isAvenue) {
    return isAvenue ? [2.0, 5.0] : [1.85];
  }

  _buildLaneGraph() {
    const g = this.graph;
    const inbound = {}, outbound = {};
    const key = (i, j) => `${i},${j}`;
    const push = (map, i, j, entry) => {
      const k = key(i, j);
      if (!map[k]) map[k] = [];
      map[k].push(entry);
    };
    // Registry für BusRoute: "NS,i,segJ,dir,laneIdx" → Kante
    this.laneIndex = new Map();

    const speed = 50 * KMH;
    const addPolyLane = (pts, sp) => {
      const e = g.addLane(pts[0], pts[pts.length - 1], sp);
      // addLane erzeugt 2-Punkt-Kurve — ersetze durch volle Polyline
      e.curve = new (e.curve.constructor)(pts);
      e.length = e.curve.length;
      // Bounding-Box neu
      e.minX = Infinity; e.maxX = -Infinity; e.minZ = Infinity; e.maxZ = -Infinity;
      for (const p of pts) {
        e.minX = Math.min(e.minX, p.x); e.maxX = Math.max(e.maxX, p.x);
        e.minZ = Math.min(e.minZ, p.z); e.maxZ = Math.max(e.maxZ, p.z);
      }
      return e;
    };
    const endDir = (pts, atEnd) => {
      const a = atEnd ? pts[pts.length - 2] : pts[0];
      const b = atEnd ? pts[pts.length - 1] : pts[1];
      const v = new THREE.Vector3().subVectors(b, a);
      v.y = 0;
      return v.normalize();
    };

    // ---- NS-Spuren (entlang der Kurve)
    for (let i = 0; i < this.xs.length; i++) {
      const offsets = this._laneOffsets(this.isAvenueX(i));
      for (let j = 0; j < this.segNS[i].length; j++) {
        if (!this.segNS[i][j]) continue;
        const zA = this.zs[j] + this.boundZ(j);
        const zB = this.zs[j + 1] - this.boundZ(j + 1);
        if (zB <= zA + 4) continue;
        const center = this._nsCenterline(i, zA, zB, 0.05);
        offsets.forEach((off, laneIdx) => {
          // Richtung +z: rechts = -x ⇒ Offset -off relativ zur Laufrichtung +z
          let pts = offsetPolyline(center, -off);
          let e = addPolyLane(pts, speed);
          this.laneIndex.set(`NS,${i},${j},1,${laneIdx}`, e);
          push(outbound, i, j, { edge: e, axis: 'NS', laneIdx, dir: 1, p: pts[0], v: endDir(pts, false) });
          push(inbound, i, j + 1, { edge: e, axis: 'NS', laneIdx, dir: 1, p: pts[pts.length - 1], v: endDir(pts, true) });
          // Richtung -z: gleiche Mittellinie, Offset +off, Punkte reversed
          pts = offsetPolyline(center, off).reverse();
          e = addPolyLane(pts, speed);
          this.laneIndex.set(`NS,${i},${j},-1,${laneIdx}`, e);
          push(outbound, i, j + 1, { edge: e, axis: 'NS', laneIdx, dir: -1, p: pts[0], v: endDir(pts, false) });
          push(inbound, i, j, { edge: e, axis: 'NS', laneIdx, dir: -1, p: pts[pts.length - 1], v: endDir(pts, true) });
        });
      }
    }

    // ---- EW-Spuren (gerade, mit Höhenprofil)
    for (let j = 0; j < this.zs.length; j++) {
      const offsets = this._laneOffsets(this.isAvenueZ(j));
      for (let i = 0; i < this.segEW[j].length; i++) {
        if (!this.segEW[j][i]) continue;
        const xA = this.centerX(i, this.zs[j]) + this.boundX(i);
        const xB = this.centerX(i + 1, this.zs[j]) - this.boundX(i + 1);
        if (xB <= xA + 4) continue;
        const center = this._ewCenterline(xA, xB, this.zs[j], 0.05);
        offsets.forEach((off, laneIdx) => {
          // Richtung +x: rechts der Laufrichtung = -offset (Konvention oben)
          let pts = offsetPolyline(center, -off);
          let e = addPolyLane(pts, speed);
          this.laneIndex.set(`EW,${j},${i},1,${laneIdx}`, e);
          push(outbound, i, j, { edge: e, axis: 'EW', laneIdx, dir: 1, p: pts[0], v: endDir(pts, false) });
          push(inbound, i + 1, j, { edge: e, axis: 'EW', laneIdx, dir: 1, p: pts[pts.length - 1], v: endDir(pts, true) });
          // Richtung -x: nach dem Reversen liegt +offset rechts
          pts = offsetPolyline(center, off).reverse();
          e = addPolyLane(pts, speed);
          this.laneIndex.set(`EW,${j},${i},-1,${laneIdx}`, e);
          push(outbound, i + 1, j, { edge: e, axis: 'EW', laneIdx, dir: -1, p: pts[0], v: endDir(pts, false) });
          push(inbound, i, j, { edge: e, axis: 'EW', laneIdx, dir: -1, p: pts[pts.length - 1], v: endDir(pts, true) });
        });
      }
    }

    // ---- Kreuzungen: Verbinder + Abbieger + Ampeln
    this.intersections = [];
    for (let i = 0; i < this.xs.length; i++) {
      for (let j = 0; j < this.zs.length; j++) {
        const inn = inbound[key(i, j)] || [];
        const out = outbound[key(i, j)] || [];
        if (inn.length === 0 || out.length === 0) continue;

        let ctrl = null;
        if (this.signalized.has(key(i, j)) && this.trafficLights) {
          ctrl = this.trafficLights.addIntersection(
            new THREE.Vector3(this.centerX(i, this.zs[j]), this.terrain.hExact(this.centerX(i, this.zs[j]), this.zs[j]), this.zs[j]),
            this.halfX[i], this.halfZ[j],
            (i * 7 + j * 13) % 20
          );
        }

        for (const ie of inn) {
          if (ctrl) ie.edge.signal = { controller: ctrl, axis: ie.axis };
          for (const oe of out) {
            const sameRoadSameDir = ie.axis === oe.axis && ie.dir === oe.dir;
            const opposite = ie.axis === oe.axis && ie.dir !== oe.dir;
            if (opposite) continue;
            let weight;
            if (sameRoadSameDir) {
              if (ie.laneIdx !== oe.laneIdx) continue;
              weight = 3.0;
            } else {
              const cross = ie.v.x * oe.v.z - ie.v.z * oe.v.x;
              const isRight = cross < 0;
              const inLanes = this._laneOffsets(ie.axis === 'NS' ? this.isAvenueX(i) : this.isAvenueZ(j)).length;
              const outLanes = this._laneOffsets(oe.axis === 'NS' ? this.isAvenueX(i) : this.isAvenueZ(j)).length;
              if (isRight && (ie.laneIdx !== 0 || oe.laneIdx !== 0)) continue;
              if (!isRight && (ie.laneIdx !== inLanes - 1 || oe.laneIdx !== outLanes - 1)) continue;
              weight = isRight ? 1.0 : 0.8;
            }
            const link = this.graph.addTurn(ie.p, ie.v, oe.p, oe.v, sameRoadSameDir ? 11 : 5.5);
            ie.edge.addSuccessor(link, weight);
            link.addSuccessor(oe.edge, 1);
          }
        }
        this.intersections.push({ i, j, x: this.centerX(i, this.zs[j]), z: this.zs[j], signal: ctrl });
      }
    }

    g.validate();
  }

  // Bodenhöhe: Fahrbahn = Terrain, Gehweg/Block = Terrain + Bordstein
  groundHeight(x, z) {
    const h = this.terrain.h(x, z);
    for (let i = 0; i < this.xs.length; i++) {
      if (Math.abs(x - this.centerX(i, z)) <= this.halfX[i]) {
        const j = this._segIndex(this.zs, z);
        if (j >= 0 && this.segNS[i][j]) return h;
      }
    }
    for (let j = 0; j < this.zs.length; j++) {
      if (Math.abs(z - this.zs[j]) <= this.halfZ[j]) {
        const i = this._segIndex(this.xs, x);
        if (i >= 0 && this.segEW[j][i]) return h;
      }
    }
    if (this._nearIntersection(x, z)) return h;
    return h + CURB_H;
  }

  _segIndex(arr, v) {
    for (let k = 0; k < arr.length - 1; k++) {
      if (v >= arr[k] && v <= arr[k + 1]) return k;
    }
    return -1;
  }

  _nearIntersection(x, z) {
    const j = this._closestIndex(this.zs, z);
    for (let i = 0; i < this.xs.length; i++) {
      if (Math.abs(x - this.centerX(i, this.zs[j])) <= this.boundX(i) + 1 &&
          Math.abs(z - this.zs[j]) <= this.boundZ(j) + 1 &&
          this._intersectionExists(i, j)) return true;
    }
    return false;
  }

  _closestIndex(arr, v) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < arr.length; k++) {
      const d = Math.abs(arr[k] - v);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
}
