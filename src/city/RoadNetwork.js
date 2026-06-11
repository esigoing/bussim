// Straßennetz v2: Nord-Süd-Straßen schlängeln sich als sanfte Kurven
// (centerX(i, z) = Grundlinie + Sinus-Auslenkung), Ost-West-Straßen bleiben
// gerade, folgen aber dem Hügel-Höhenfeld. Erzeugt
// (a) Render-Meshes — Kurven-Strips mit eingemalten Markierungen,
//     Kreuzungs-Patches, Gehweg-Strips — und
// (b) den Fahrspur-Graphen (Polyline-Kanten inkl. Höhe) mit Abbiegern/Ampeln.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { asphaltTextures, sidewalkTextures } from '../graphics/materials/TextureGen.js';
import { LaneGraph } from '../traffic/LaneGraph.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KMH = 1 / 3.6;
const CURB_H = 0.13;
const SIDEWALK_W = 2.5;

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

// Polyline seitlich versetzen (für Fahrspuren): offset > 0 = rechts der Laufrichtung
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

  // Mittellinien-Polyline eines NS-Segments (zA..zB), Schritt ~8 m, mit Höhe
  _nsCenterline(i, zA, zB, lift = 0.01) {
    const pts = [];
    const steps = Math.max(2, Math.ceil((zB - zA) / 8));
    for (let s = 0; s <= steps; s++) {
      const z = zA + ((zB - zA) * s) / steps;
      const x = this.centerX(i, z);
      pts.push(new THREE.Vector3(x, this.terrain.hExact(x, z) + lift, z));
    }
    return pts;
  }

  // Gerade EW-Polyline (xA..xB bei z), mit Höhenprofil
  _ewCenterline(xA, xB, z, lift = 0.01) {
    const pts = [];
    const steps = Math.max(2, Math.ceil((xB - xA) / 8));
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

  _buildRoadMeshes() {
    const sidewalkGeos = [];

    // ---- NS-Straßen: Kurven-Strips (zusammenhängende Läufe inkl. Kreuzungen)
    for (let i = 0; i < this.xs.length; i++) {
      for (const [j0, j1] of this._contiguousRuns(this.segNS[i])) {
        const z0 = this.zs[j0] - this.boundZ(j0);
        const z1 = this.zs[j1 + 1] + this.boundZ(j1 + 1);
        const center = this._nsCenterline(i, z0, z1, 0.012);
        const mesh = new THREE.Mesh(
          stripGeometry(center, this.halfX[i]),
          this.isAvenueX(i) ? this.avenueMat : this.streetMat
        );
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Gehwege beidseitig entlang der Kurve
        for (const side of [-1, 1]) {
          const off = side * (this.halfX[i] + SIDEWALK_W / 2);
          const walkway = offsetPolyline(center, off);
          sidewalkGeos.push(stripGeometry(walkway, SIDEWALK_W / 2, 1 / 2.5, CURB_H));
        }
      }
    }

    // ---- EW-Straßen: gerade Strips zwischen den (verschobenen) Kreuzungen
    for (let j = 0; j < this.zs.length; j++) {
      for (const [i0, i1] of this._contiguousRuns(this.segEW[j])) {
        const xA = this.centerX(i0, this.zs[j]) - this.boundX(i0);
        const xB = this.centerX(i1 + 1, this.zs[j]) + this.boundX(i1 + 1);
        if (xB <= xA) continue;
        const center = this._ewCenterline(xA, xB, this.zs[j], 0.008);
        const mesh = new THREE.Mesh(
          stripGeometry(center, this.halfZ[j]),
          this.isAvenueZ(j) ? this.avenueMat : this.streetMat
        );
        mesh.receiveShadow = true;
        this.group.add(mesh);

        for (const side of [-1, 1]) {
          const off = side * (this.halfZ[j] + SIDEWALK_W / 2);
          const walkway = offsetPolyline(center, off);
          sidewalkGeos.push(stripGeometry(walkway, SIDEWALK_W / 2, 1 / 2.5, CURB_H));
        }
      }
    }

    // ---- Kreuzungs-Patches (markierungsfrei, leicht erhöht gegen Z-Fighting)
    const patches = [];
    for (let i = 0; i < this.xs.length; i++) {
      for (let j = 0; j < this.zs.length; j++) {
        if (!this._intersectionExists(i, j)) continue;
        const cx = this.centerX(i, this.zs[j]);
        const cz = this.zs[j];
        const w = this.halfX[i] * 2 + 1.2, d = this.halfZ[j] * 2 + 1.2;
        const g = new THREE.PlaneGeometry(w, d, 2, 2);
        g.rotateX(-Math.PI / 2);
        const uvA = g.attributes.uv;
        for (let k = 0; k < uvA.count; k++) {
          uvA.setXY(k, uvA.getX(k) * (w / 12), uvA.getY(k) * (d / 12));
        }
        const posA = g.attributes.position;
        for (let k = 0; k < posA.count; k++) {
          const px = posA.getX(k) + cx, pz = posA.getZ(k) + cz;
          posA.setXYZ(k, px, this.terrain.hExact(px, pz) + 0.018, pz);
        }
        g.computeVertexNormals();
        patches.push(g);
      }
    }
    if (patches.length) {
      const patchMesh = new THREE.Mesh(mergeGeometries(patches), this.plainMat);
      patchMesh.receiveShadow = true;
      this.group.add(patchMesh);
    }

    const sidewalks = new THREE.Mesh(mergeGeometries(sidewalkGeos), this.sidewalkMat);
    sidewalks.receiveShadow = true;
    this.group.add(sidewalks);
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
          // Richtung +x: rechts = +z
          let pts = offsetPolyline(center, off);
          let e = addPolyLane(pts, speed);
          this.laneIndex.set(`EW,${j},${i},1,${laneIdx}`, e);
          push(outbound, i, j, { edge: e, axis: 'EW', laneIdx, dir: 1, p: pts[0], v: endDir(pts, false) });
          push(inbound, i + 1, j, { edge: e, axis: 'EW', laneIdx, dir: 1, p: pts[pts.length - 1], v: endDir(pts, true) });
          // Richtung -x
          pts = offsetPolyline(center, -off).reverse();
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
