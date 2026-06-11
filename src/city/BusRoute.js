// Linie 73: Rechteck-Rundkurs über vier Rasterstraßen (nur Rechtsabbiegen),
// 9 benannte Haltestellen mit Wartehäuschen, Schild und Bucht-Position.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { Events } from '../core/Events.js';

export const STOP_NAMES = [
  'Hauptbahnhof', 'Rathaus', 'Schillerplatz', 'Stadtpark', 'Klinikum',
  'Universität', 'Marktplatz', 'Goethestraße', 'Theater',
];

function stopSignTexture(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5f5f0';
  ctx.fillRect(0, 0, 256, 320);
  // H-Zeichen
  ctx.fillStyle = '#0a7a33';
  ctx.beginPath();
  ctx.arc(128, 92, 72, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd500';
  ctx.beginPath();
  ctx.arc(128, 92, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a7a33';
  ctx.font = 'bold 84px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', 128, 98);
  // Name + Linie
  ctx.fillStyle = '#16181c';
  ctx.font = 'bold 26px Arial';
  const label = name.length > 13 ? name.slice(0, 12) + '.' : name;
  ctx.fillText(label, 128, 205);
  ctx.font = '22px Arial';
  ctx.fillText('Linie 73', 128, 245);
  ctx.fillStyle = '#e8a33d';
  ctx.fillRect(40, 270, 176, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BusRoute {
  // rect: {i0, j0, i1, j1} Rasterindizes des Rundkurses
  constructor({ roadNet, rect, parent }) {
    this.roadNet = roadNet;
    this.edges = [];        // Kantenfolge inkl. Verbindungs-/Abbiegekanten
    this.cumLength = [];    // kumulierte Länge am Kantenanfang
    this.totalLength = 0;
    this.stops = [];
    this.group = new THREE.Group();
    parent.add(this.group);

    this._buildSequence(rect);
    this._placeStops();
    this._buildShelters();
    this._buildRoutePolyline();
  }

  _laneKeyEdges(rect) {
    // Im Uhrzeigersinn mit Rechtsabbiegen: +x auf Reihe j1, -z auf Spalte i1,
    // -x auf Reihe j0, +z auf Spalte i0. (NS: +z = steigender Index)
    const { i0, j0, i1, j1 } = rect;
    const li = this.roadNet.laneIndex;
    const seq = [];
    for (let i = i0; i < i1; i++) seq.push(li.get(`EW,${j1},${i},1,0`));
    for (let j = j1 - 1; j >= j0; j--) seq.push(li.get(`NS,${i1},${j},-1,0`));
    for (let i = i1 - 1; i >= i0; i--) seq.push(li.get(`EW,${j0},${i},-1,0`));
    for (let j = j0; j < j1; j++) seq.push(li.get(`NS,${i0},${j},1,0`));
    return seq;
  }

  _buildSequence(rect) {
    const lanes = this._laneKeyEdges(rect).filter(Boolean);
    if (lanes.length === 0) {
      console.error('BusRoute: keine Kanten gefunden');
      return;
    }
    // Verbindungs-/Abbiegekanten über Nachfolger auflösen
    for (let k = 0; k < lanes.length; k++) {
      const cur = lanes[k];
      const next = lanes[(k + 1) % lanes.length];
      this.edges.push(cur);
      // direkter Nachfolger?
      const direct = cur.successors.find((s) => s.edge === next);
      if (!direct) {
        // Zwischenkante suchen (Through-Link oder Abbieger)
        const via = cur.successors.find((s) => s.edge.successors.some((t) => t.edge === next));
        if (via) this.edges.push(via.edge);
        else console.warn('BusRoute: Lücke in der Kantenfolge bei Index', k);
      }
    }
    let acc = 0;
    for (const e of this.edges) {
      this.cumLength.push(acc);
      acc += e.length;
    }
    this.totalLength = acc;
  }

  _placeStops() {
    const count = STOP_NAMES.length;
    const _pos = new THREE.Vector3();
    const _tan = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const target = (k / count) * this.totalLength + 40;
      // Lane-Kante finden, die target enthält (Turns überspringen)
      let edgeIdx = -1, sLocal = 0;
      for (let e = 0; e < this.edges.length; e++) {
        const start = this.cumLength[e], end = start + this.edges[e].length;
        if (target >= start && target < end) { edgeIdx = e; sLocal = target - start; break; }
      }
      if (edgeIdx < 0) continue;
      // auf 'lane' schieben und Rand-Margin einhalten
      while (this.edges[edgeIdx].type !== 'lane' || this.edges[edgeIdx].length < 40) {
        edgeIdx = (edgeIdx + 1) % this.edges.length;
        sLocal = 25;
      }
      const edge = this.edges[edgeIdx];
      sLocal = Math.max(20, Math.min(edge.length - 20, sLocal));
      edge.curve.sample(sLocal, _pos, _tan);
      const right = new THREE.Vector3(-_tan.z, 0, _tan.x);

      this.stops.push({
        index: k,
        name: STOP_NAMES[k],
        edge,
        s: sLocal,
        routeDist: this.cumLength[edgeIdx] + sLocal,
        pos: _pos.clone(),
        dir: _tan.clone(),
        right: right.clone(),
        shelterPos: _pos.clone().addScaledVector(right, 4.2),
      });
    }
    // Nach Routen-Distanz sortieren
    this.stops.sort((a, b) => a.routeDist - b.routeDist);
    this.stops.forEach((s, i) => { s.index = i; });
  }

  _buildShelters() {
    const frameMat = Mat.std({ color: 0x4a4d52, roughness: 0.5, metalness: 0.6 });
    const glassMat = Mat.phys({
      color: 0xcfd8da, roughness: 0.06, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
    });
    const benchMat = Mat.std({ color: 0x7a5436, roughness: 0.85 });

    for (const stop of this.stops) {
      const g = new THREE.Group();
      const yaw = Math.atan2(stop.dir.x, stop.dir.z);

      // Rahmen: 2 Pfosten + Dach
      for (const dz of [-1.6, 1.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8), frameMat);
        post.position.set(0.7, 1.25, dz);
        g.add(post);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 4.0), glassMat);
      roof.position.set(0.2, 2.5, 0);
      roof.castShadow = true;
      g.add(roof);
      // Rückwand (Glas)
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.9, 3.6), glassMat);
      back.position.set(0.72, 1.18, 0);
      g.add(back);
      // Bank
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.07, 2.6), benchMat);
      bench.position.set(0.45, 0.52, 0);
      g.add(bench);

      // Haltestellenschild am Mast
      const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.0, 8), frameMat);
      signPost.position.set(-0.4, 1.5, -2.2);
      g.add(signPost);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.68),
        new THREE.MeshStandardMaterial({ map: stopSignTexture(stop.name), roughness: 0.5, side: THREE.DoubleSide })
      );
      sign.position.set(-0.4, 2.7, -2.2);
      sign.rotation.y = yaw + Math.PI / 2;
      g.add(sign);

      g.position.copy(stop.shelterPos);
      g.position.y = stop.pos.y + 0.13; // Gehwegniveau am Hang
      g.rotation.y = yaw;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(g);
    }
  }

  _buildRoutePolyline() {
    // Für Minimap: Punkte alle ~12 m
    this.polyline = [];
    const _p = new THREE.Vector3();
    for (const e of this.edges) {
      for (let s = 0; s < e.length; s += 12) {
        e.curve.sample(s, _p);
        this.polyline.push([_p.x, _p.z]);
      }
    }
  }

  // Routen-Distanz einer Position (grob): nächste Stop-Logik nutzt das
  nextStopAfter(routeDist) {
    for (const s of this.stops) {
      if (s.routeDist > routeDist + 8) return s;
    }
    return this.stops[0];
  }

  distanceOnRoute(edge, s) {
    const idx = this.edges.indexOf(edge);
    if (idx < 0) return null;
    return this.cumLength[idx] + s;
  }
}
