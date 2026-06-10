// Straßennetz: achsenparalleles, perturbiertes Raster. Erzeugt
// (a) Render-Meshes — Fahrbahnen mit eingemalten Markierungen, Kreuzungs-
//     Patches, Gehweg-Ringe pro Block — und
// (b) den Fahrspur-Graphen inkl. Abbiegekanten und Ampel-Referenzen.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { asphaltTextures, sidewalkTextures } from '../graphics/materials/TextureGen.js';
import { LaneGraph } from '../traffic/LaneGraph.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KMH = 1 / 3.6;

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
    // Mittellinie gestrichelt (6 m Strich, 6 m Lücke auf 12 m Kachel)
    ctx.fillRect(W / 2 - lineW / 2, 0, lineW, H / 2);
    // Randlinien durchgezogen
    ctx.fillRect(W * 0.045, 0, lineW, H);
    ctx.fillRect(W * 0.955 - lineW, 0, lineW, H);
  } else {
    // Doppelte Mittellinie
    ctx.fillRect(W / 2 - lineW * 1.6, 0, lineW, H);
    ctx.fillRect(W / 2 + lineW * 0.6, 0, lineW, H);
    // Fahrstreifen-Trenner gestrichelt bei 1/4 und 3/4
    ctx.fillRect(W * 0.25 - lineW / 2, 0, lineW, H / 2);
    ctx.fillRect(W * 0.75 - lineW / 2, 0, lineW, H / 2);
    ctx.fillRect(W * 0.03, 0, lineW, H);
    ctx.fillRect(W * 0.97 - lineW, 0, lineW, H);
  }
  texSet.map.needsUpdate = true;
  return texSet;
}

export class RoadNetwork {
  constructor({ xs, zs, halfX, halfZ, segNS, segEW, signalized, seed, trafficLights }) {
    this.xs = xs;
    this.zs = zs;
    this.halfX = halfX;   // Halbbreite je NS-Straße (Index i)
    this.halfZ = halfZ;   // Halbbreite je EW-Straße (Index j)
    this.segNS = segNS;   // segNS[i][j] = Segment existiert (zwischen zs[j] und zs[j+1])
    this.segEW = segEW;
    this.signalized = signalized; // Set "i,j"
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
    this._buildSidewalks();
    this._buildLaneGraph();
  }

  isAvenueX(i) { return this.halfX[i] > 5; }
  isAvenueZ(j) { return this.halfZ[j] > 5; }

  // Fahrbahn-Halbbreite + Bordsteinkante → Kreuzungs-Halbausdehnung
  boundX(i) { return this.halfX[i] + 0.8; }
  boundZ(j) { return this.halfZ[j] + 0.8; }

  _roadStrip(width, length, texSet, mat) {
    const geo = new THREE.PlaneGeometry(width, length, 1, Math.max(1, Math.round(length / 50)));
    geo.rotateX(-Math.PI / 2);
    // v entlang der Länge: 12-m-Kacheln
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setY(k, uv.getY(k) * (length / 12));
    }
    return new THREE.Mesh(geo, mat);
  }

  _buildRoadMeshes() {
    // NS-Straßen (entlang z)
    for (let i = 0; i < this.xs.length; i++) {
      const runs = this._contiguousRuns(this.segNS[i]);
      for (const [j0, j1] of runs) {
        const z0 = this.zs[j0] - this.boundZ(j0);
        const z1 = this.zs[j1 + 1] + this.boundZ(j1 + 1);
        const mesh = this._roadStrip(this.halfX[i] * 2, z1 - z0,
          this.isAvenueX(i) ? this.avenueTex : this.streetTex,
          this.isAvenueX(i) ? this.avenueMat : this.streetMat);
        mesh.position.set(this.xs[i], 0.005, (z0 + z1) / 2);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
    // EW-Straßen (entlang x) — Textur ist längs orientiert → um 90° drehen
    for (let j = 0; j < this.zs.length; j++) {
      const runs = this._contiguousRuns(this.segEW[j]);
      for (const [i0, i1] of runs) {
        const x0 = this.xs[i0] - this.boundX(i0);
        const x1 = this.xs[i1 + 1] + this.boundX(i1 + 1);
        const mesh = this._roadStrip(this.halfZ[j] * 2, x1 - x0,
          this.isAvenueZ(j) ? this.avenueTex : this.streetTex,
          this.isAvenueZ(j) ? this.avenueMat : this.streetMat);
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set((x0 + x1) / 2, 0.003, this.zs[j]);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }

    // Kreuzungs-Patches (markierungsfrei, überdecken die Überlappung)
    const patches = [];
    for (let i = 0; i < this.xs.length; i++) {
      for (let j = 0; j < this.zs.length; j++) {
        if (!this._intersectionExists(i, j)) continue;
        const g = new THREE.PlaneGeometry(this.halfX[i] * 2 + 0.4, this.halfZ[j] * 2 + 0.4);
        g.rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) {
          uv.setX(k, uv.getX(k) * (this.halfX[i] / 6));
          uv.setY(k, uv.getY(k) * (this.halfZ[j] / 6));
        }
        g.translate(this.xs[i], 0.012, this.zs[j]);
        patches.push(g);
      }
    }
    if (patches.length) {
      const patchMesh = new THREE.Mesh(mergeGeometries(patches), this.plainMat);
      patchMesh.receiveShadow = true;
      this.group.add(patchMesh);
    }
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

  _buildSidewalks() {
    // Pro Block ein Gehweg-Ring (4 Boxen) + Eck-Quadrate an den Kreuzungen
    const geos = [];
    const SW = 2.5, CURB_H = 0.13;
    const addBox = (x0, z0, x1, z1) => {
      if (x1 - x0 < 0.1 || z1 - z0 < 0.1) return;
      const g = new THREE.BoxGeometry(x1 - x0, CURB_H, z1 - z0);
      // UV grob nach Weltgröße
      g.translate((x0 + x1) / 2, CURB_H / 2, (z0 + z1) / 2);
      geos.push(g);
    };

    for (let i = 0; i < this.xs.length - 1; i++) {
      for (let j = 0; j < this.zs.length - 1; j++) {
        // Blockgrenzen (Fahrbahnkanten)
        const x0 = this.xs[i] + this.halfX[i];
        const x1 = this.xs[i + 1] - this.halfX[i + 1];
        const z0 = this.zs[j] + this.halfZ[j];
        const z1 = this.zs[j + 1] - this.halfZ[j + 1];
        // Ring
        addBox(x0, z0, x1, z0 + SW);            // Süd
        addBox(x0, z1 - SW, x1, z1);            // Nord
        addBox(x0, z0 + SW, x0 + SW, z1 - SW);  // West
        addBox(x1 - SW, z0 + SW, x1, z1 - SW);  // Ost
      }
    }
    const merged = mergeGeometries(geos);
    // Welt-UVs: nutze Positions-XZ als UV (Kacheln à 2,5 m)
    const pos = merged.attributes.position;
    const uv = merged.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      uv.setXY(k, pos.getX(k) / 2.5, pos.getZ(k) / 2.5);
    }
    const mesh = new THREE.Mesh(merged, this.sidewalkMat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
  }

  _laneOffsets(isAvenue) {
    return isAvenue ? [2.0, 5.0] : [1.85];
  }

  _buildLaneGraph() {
    const g = this.graph;
    // Kanten-Verzeichnis zum Verknüpfen:
    // inbound[i][j] / outbound[i][j] = Listen {edge, axis, dir, laneIdx, end/startPoint, dirVec}
    const inbound = {}, outbound = {};
    const key = (i, j) => `${i},${j}`;
    const push = (map, i, j, entry) => {
      const k = key(i, j);
      if (!map[k]) map[k] = [];
      map[k].push(entry);
    };
    // Registry für BusRoute: "NS,i,segJ,dir,laneIdx" → Kante
    this.laneIndex = new Map();

    const speedStreet = 50 * KMH, speedAvenue = 50 * KMH;

    // NS-Straßen
    for (let i = 0; i < this.xs.length; i++) {
      const offsets = this._laneOffsets(this.isAvenueX(i));
      const speed = this.isAvenueX(i) ? speedAvenue : speedStreet;
      for (let j = 0; j < this.segNS[i].length; j++) {
        if (!this.segNS[i][j]) continue;
        const zA = this.zs[j] + this.boundZ(j);
        const zB = this.zs[j + 1] - this.boundZ(j + 1);
        if (zB <= zA) continue;
        offsets.forEach((off, laneIdx) => {
          // Richtung +z: rechts = -x
          let e = g.addLane(
            new THREE.Vector3(this.xs[i] - off, 0, zA),
            new THREE.Vector3(this.xs[i] - off, 0, zB), speed);
          this.laneIndex.set(`NS,${i},${j},1,${laneIdx}`, e);
          push(outbound, i, j, { edge: e, axis: 'NS', dir: +1, laneIdx, p: e.curve.points[0], v: new THREE.Vector3(0, 0, 1) });
          push(inbound, i, j + 1, { edge: e, axis: 'NS', dir: +1, laneIdx, p: e.curve.points[1], v: new THREE.Vector3(0, 0, 1) });
          // Richtung -z: rechts = +x
          e = g.addLane(
            new THREE.Vector3(this.xs[i] + off, 0, zB),
            new THREE.Vector3(this.xs[i] + off, 0, zA), speed);
          this.laneIndex.set(`NS,${i},${j},-1,${laneIdx}`, e);
          push(outbound, i, j + 1, { edge: e, axis: 'NS', dir: -1, laneIdx, p: e.curve.points[0], v: new THREE.Vector3(0, 0, -1) });
          push(inbound, i, j, { edge: e, axis: 'NS', dir: -1, laneIdx, p: e.curve.points[1], v: new THREE.Vector3(0, 0, -1) });
        });
      }
    }
    // EW-Straßen
    for (let j = 0; j < this.zs.length; j++) {
      const offsets = this._laneOffsets(this.isAvenueZ(j));
      const speed = this.isAvenueZ(j) ? speedAvenue : speedStreet;
      for (let i = 0; i < this.segEW[j].length; i++) {
        if (!this.segEW[j][i]) continue;
        const xA = this.xs[i] + this.boundX(i);
        const xB = this.xs[i + 1] - this.boundX(i + 1);
        if (xB <= xA) continue;
        offsets.forEach((off, laneIdx) => {
          // Richtung +x: rechts = +z
          let e = g.addLane(
            new THREE.Vector3(xA, 0, this.zs[j] + off),
            new THREE.Vector3(xB, 0, this.zs[j] + off), speed);
          this.laneIndex.set(`EW,${j},${i},1,${laneIdx}`, e);
          push(outbound, i, j, { edge: e, axis: 'EW', dir: +1, laneIdx, p: e.curve.points[0], v: new THREE.Vector3(1, 0, 0) });
          push(inbound, i + 1, j, { edge: e, axis: 'EW', dir: +1, laneIdx, p: e.curve.points[1], v: new THREE.Vector3(1, 0, 0) });
          // Richtung -x: rechts = -z
          e = g.addLane(
            new THREE.Vector3(xB, 0, this.zs[j] - off),
            new THREE.Vector3(xA, 0, this.zs[j] - off), speed);
          this.laneIndex.set(`EW,${j},${i},-1,${laneIdx}`, e);
          push(outbound, i + 1, j, { edge: e, axis: 'EW', dir: -1, laneIdx, p: e.curve.points[0], v: new THREE.Vector3(-1, 0, 0) });
          push(inbound, i, j, { edge: e, axis: 'EW', dir: -1, laneIdx, p: e.curve.points[1], v: new THREE.Vector3(-1, 0, 0) });
        });
      }
    }

    // Abbiegekanten + Ampeln pro Kreuzung
    this.intersections = [];
    for (let i = 0; i < this.xs.length; i++) {
      for (let j = 0; j < this.zs.length; j++) {
        const inn = inbound[key(i, j)] || [];
        const out = outbound[key(i, j)] || [];
        if (inn.length === 0 || out.length === 0) continue;

        let ctrl = null;
        if (this.signalized.has(key(i, j)) && this.trafficLights) {
          ctrl = this.trafficLights.addIntersection(
            new THREE.Vector3(this.xs[i], 0, this.zs[j]),
            this.halfX[i], this.halfZ[j],
            (i * 7 + j * 13) % 20
          );
        }

        for (const ie of inn) {
          if (ctrl) ie.edge.signal = { controller: ctrl, axis: ie.axis };
          for (const oe of out) {
            const sameRoadSameDir = ie.axis === oe.axis && ie.dir === oe.dir;
            const opposite = ie.axis === oe.axis && ie.dir !== oe.dir;
            if (opposite) continue; // kein U-Turn
            let weight;
            if (sameRoadSameDir) {
              if (ie.laneIdx !== oe.laneIdx) continue; // Spur halten
              weight = 3.0;
            } else {
              // Abbiegen: Kreuzungsprodukt bestimmt links/rechts
              const cross = ie.v.x * oe.v.z - ie.v.z * oe.v.x;
              const isRight = cross < 0;
              // Rechts nur von der rechten Spur, links nur von der linken
              const inLanes = this._laneOffsets(ie.axis === 'NS' ? this.isAvenueX(i) : this.isAvenueZ(j)).length;
              const outLanes = this._laneOffsets(oe.axis === 'NS' ? this.isAvenueX(i) : this.isAvenueZ(j)).length;
              if (isRight && (ie.laneIdx !== 0 || oe.laneIdx !== 0)) continue;
              if (!isRight && (ie.laneIdx !== inLanes - 1 || oe.laneIdx !== outLanes - 1)) continue;
              weight = isRight ? 1.0 : 0.8;
            }
            if (sameRoadSameDir) {
              // Durchfahrt: gerade Verbindungskante über die Kreuzung
              const link = g.addTurn(ie.p, ie.v, oe.p, oe.v, 11);
              ie.edge.addSuccessor(link, weight);
              link.addSuccessor(oe.edge, 1);
            } else {
              const turn = g.addTurn(ie.p, ie.v, oe.p, oe.v, 5.5);
              ie.edge.addSuccessor(turn, weight);
              turn.addSuccessor(oe.edge, 1);
            }
          }
        }
        this.intersections.push({ i, j, x: this.xs[i], z: this.zs[j], signal: ctrl });
      }
    }

    g.validate();
  }

  // Bodenhöhe: Fahrbahn 0, sonst Gehweg-/Blockniveau
  groundHeight(x, z) {
    for (let i = 0; i < this.xs.length; i++) {
      if (Math.abs(x - this.xs[i]) <= this.halfX[i]) {
        // existiert hier ein Segment?
        const j = this._segIndex(this.zs, z);
        if (j >= 0 && this.segNS[i][j]) return 0;
        // Im Kreuzungsbereich?
        if (this._nearIntersection(x, z)) return 0;
      }
    }
    for (let j = 0; j < this.zs.length; j++) {
      if (Math.abs(z - this.zs[j]) <= this.halfZ[j]) {
        const i = this._segIndex(this.xs, x);
        if (i >= 0 && this.segEW[j][i]) return 0;
        if (this._nearIntersection(x, z)) return 0;
      }
    }
    return 0.13;
  }

  _segIndex(arr, v) {
    for (let k = 0; k < arr.length - 1; k++) {
      if (v >= arr[k] && v <= arr[k + 1]) return k;
    }
    return -1;
  }

  _nearIntersection(x, z) {
    const i = this._closestIndex(this.xs, x);
    const j = this._closestIndex(this.zs, z);
    return Math.abs(x - this.xs[i]) <= this.boundX(i) && Math.abs(z - this.zs[j]) <= this.boundZ(j);
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
