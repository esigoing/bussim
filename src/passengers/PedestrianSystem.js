// Fußgänger-System: ambiente Passanten auf den Gehwegen (WP-E4). Läuft
// unabhängig vom PassengerSystem — keine Bus-Interaktion. Die Figuren
// wandern die Gehweg-Polylines aus RoadNetwork.sidewalkPaths entlang
// (Mittellinie ± Quer-Versatz, Strip ist ±1.25 m begehbar), biegen an
// Kreuzungs-Ecken auf den Quer-Gehweg ab oder kehren an Strip-Enden um.
// Fahrbahnen werden nie gequert (v1): Strip-Enden gegenüberliegender
// Seiten/Mündungen liegen ≥9 m auseinander, Ecken-Nachbarn nur ~3 m —
// der LINK_RADIUS verbindet daher ausschließlich Gehweg-Ecken.
//
// Höhenvertrag: einzige Y-Quelle ist roadNet.groundHeight(x, z) — auf dem
// Gehweg liefert sie bereits Terrain + CURB_H (0.13). Genau eine Abfrage
// je Figur und Frame (Terrain-Cache-Druck, siehe PassengerSystem).
//
// Render-Budget (Spiegel rendern die Szene mehrfach): Despawn/Respawn in
// einem Ring um den Bus begrenzt die Streuung, zusätzlich LOD-Culling alle
// 0.5 s (group.visible = Distanz < 130 m) wie in WP-E1 gefordert.
//
// Verdrahtung (Phase F, Game.js):
//   this.pedestrians = new PedestrianSystem(this.scene, this.city.roadNet, this.bus, {
//     count: this.quality.pedestrianCount,
//     figureDetail: this.quality.figureDetail,
//     figureProps: this.quality.figureProps,
//     rainy: <Regen-Flag des Wetters>,
//     rand: this.rand.fork(456),
//   });
//   // im Frame-Update: this.pedestrians.update(dt);

import * as THREE from 'three';
import { HumanFigure } from './HumanFigure.js';
import { Rand } from '../utils/Rand.js';
import { clamp } from '../utils/Math3D.js';

const WALK_FACTOR = 4.2;   // Schrittfrequenz pro Meter — wie Passenger.moveToward
const LOD_DIST = 130;      // Sichtbarkeitsradius (WP-E1-Vorgabe)
const LOD_INTERVAL = 0.5;  // s zwischen LOD-/Despawn-Prüfungen
const SPAWN_NEAR = 30;     // nicht direkt neben dem Bus aufpoppen
const SPAWN_FAR = 200;     // Spawn-Ring außen
const DESPAWN_DIST = 240;  // > SPAWN_FAR: Hysterese gegen Respawn-Flackern
const LINK_RADIUS = 6;     // Strip-Enden bis 6 m gelten als Ecke (real ~2.9 m)
const LAT_MAX = 0.85;      // max. Quer-Versatz von der Strip-Mitte (Strip ±1.25)
const TURN_RATE = 3.5;     // rad/s — Blickrichtung weich nachführen
const MIN_PATH_LEN = 6;    // zu kurze Gehweg-Stücke ignorieren
const TURN_CHANCE = 0.7;   // Wahrscheinlichkeit abzubiegen, wenn eine Ecke da ist

const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();

export class PedestrianSystem {
  constructor(scene, roadNet, bus, {
    count = 0, figureDetail = 'med', figureProps = false, rainy = false,
    rand = new Rand(4711),
  } = {}) {
    this.scene = scene;
    this.roadNet = roadNet;
    this.bus = bus;
    this.rand = rand;
    this.figureOpts = { detail: figureDetail, props: figureProps, rainy };

    this.time = 0;
    this.lodTimer = 0;
    this.group = new THREE.Group();
    scene.add(this.group);

    // ---------- Gehweg-Pfade aufbereiten: kumulierte Bogenlängen +
    // Mittelpunkt/Halblänge für den Spawn-Ring-Filter
    this.paths = [];
    for (const src of roadNet.sidewalkPaths || []) {
      const pts = src.pts;
      if (!pts || pts.length < 2) continue;
      const cum = [0];
      for (let k = 1; k < pts.length; k++) {
        cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
      }
      const total = cum[cum.length - 1];
      if (total < MIN_PATH_LEN) continue;
      this.paths.push({
        pts, cum, total,
        mid: pts[Math.floor(pts.length / 2)],
        half: total / 2,
        links: [[], []], // [0] = Anschlüsse am Anfang, [1] = am Ende
      });
    }
    this._buildLinks();

    // ---------- Figuren anlegen
    this.candidates = []; // Pfade im Spawn-Ring (alle 0.5 s aufgefrischt)
    this.peds = [];
    if (this.paths.length > 0) {
      this._refreshCandidates(this.bus.body.position);
      for (let k = 0; k < count; k++) this._spawn();
    }
  }

  // Ecken-Verknüpfung: Strip-Enden, die nah beieinander liegen, gehören zu
  // einer Gehweg-Ecke (NS-Ende ↔ EW-Ende im selben Kreuzungs-Quadranten).
  _buildLinks() {
    const ends = [];
    this.paths.forEach((path) => {
      ends.push({ path, end: 0, p: path.pts[0] });
      ends.push({ path, end: 1, p: path.pts[path.pts.length - 1] });
    });
    for (let a = 0; a < ends.length; a++) {
      for (let b = a + 1; b < ends.length; b++) {
        if (ends[a].path === ends[b].path) continue;
        const d = Math.hypot(ends[a].p.x - ends[b].p.x, ends[a].p.z - ends[b].p.z);
        if (d < LINK_RADIUS) {
          ends[a].path.links[ends[a].end].push({ path: ends[b].path, end: ends[b].end });
          ends[b].path.links[ends[b].end].push({ path: ends[a].path, end: ends[a].end });
        }
      }
    }
  }

  // Pfade, deren Spannweite den Spawn-Ring um den Bus schneidet
  _refreshCandidates(busPos) {
    this.candidates.length = 0;
    for (const p of this.paths) {
      const d = Math.hypot(busPos.x - p.mid.x, busPos.z - p.mid.z);
      if (d - p.half < SPAWN_FAR) this.candidates.push(p);
    }
  }

  _spawn() {
    const figure = new HumanFigure(this.rand, this.figureOpts);
    figure.setPose('walk');
    const ped = {
      figure,
      grp: figure.group,
      path: null, s: 0, seg: 0, dir: 1,        // Position entlang der Polyline
      lat: 0,                                   // Quer-Versatz von der Strip-Mitte
      speed: this.rand.float(1.0, 1.5),
      walkPhase: this.rand.float(0, 10),
      yaw: 0,
      mode: 'path',                             // 'path' | 'corner'
      cFrom: new THREE.Vector3(),               // Ecken-Übergang: Start/Ziel/Fortschritt
      cTo: new THREE.Vector3(),
      cLen: 1, cS: 0,
      next: null,                               // Ziel-Link beim Abbiegen
    };
    this.group.add(ped.grp);
    this._place(ped);
    this.peds.push(ped);
  }

  // Figur (neu) auf einen Gehweg im Spawn-Ring setzen — auch fürs Respawn.
  _place(ped) {
    const busPos = this.bus.body.position;
    const list = this.candidates.length > 0 ? this.candidates : this.paths;
    ped.dir = this.rand.chance(0.5) ? 1 : -1;
    ped.lat = this.rand.float(-LAT_MAX, LAT_MAX);
    ped.mode = 'path';
    ped.next = null;
    let d = 0;
    for (let tries = 0; tries < 12; tries++) {
      ped.path = this.rand.pick(list);
      ped.s = this.rand.float(0.5, ped.path.total - 0.5);
      ped.seg = 0;
      this._posOnPath(ped, _pos, _tan);
      d = Math.hypot(busPos.x - _pos.x, busPos.z - _pos.z);
      if (d > SPAWN_NEAR && d < SPAWN_FAR) break; // sonst letzten Versuch behalten
    }
    ped.grp.position.set(_pos.x, this.roadNet.groundHeight(_pos.x, _pos.z), _pos.z);
    ped.yaw = Math.atan2(_tan.x * ped.dir, _tan.z * ped.dir);
    ped.grp.rotation.y = ped.yaw;
    ped.grp.visible = d < LOD_DIST;
  }

  // Punkt + Tangente auf der Polyline bei Bogenlänge ped.s (inkl. ped.lat).
  // ped.seg dient als Segment-Hint und wird mitgeführt (O(1) pro Frame).
  _posOnPath(ped, outPos, outTan) {
    const { pts, cum } = ped.path;
    const last = pts.length - 2;
    let seg = clamp(ped.seg, 0, last);
    while (seg < last && ped.s > cum[seg + 1]) seg++;
    while (seg > 0 && ped.s < cum[seg]) seg--;
    ped.seg = seg;
    const a = pts[seg], b = pts[seg + 1];
    const t = clamp((ped.s - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-6), 0, 1);
    outTan.subVectors(b, a);
    outTan.y = 0;
    outTan.normalize();
    outPos.lerpVectors(a, b, t);
    outPos.x += outTan.z * ped.lat;  // quer zur Laufrichtung versetzen
    outPos.z += -outTan.x * ped.lat;
  }

  // Bogenlänge fortschreiben; am Strip-Ende abbiegen (Ecken-Link) oder umkehren
  _advanceOnPath(ped, step) {
    ped.s += step * ped.dir;
    if (ped.s > 0 && ped.s < ped.path.total) return;

    const end = ped.s <= 0 ? 0 : 1;
    ped.s = clamp(ped.s, 0, ped.path.total);
    const links = ped.path.links[end];
    if (links.length > 0 && this.rand.chance(TURN_CHANCE)) {
      // Abbiegen: kurzer gerader Übergang über die Gehweg-Ecke (~3 m,
      // bleibt auf Gehweg-/Eckenniveau — keine Fahrbahn dazwischen)
      const link = this.rand.pick(links);
      this._posOnPath(ped, ped.cFrom, _tan);
      const tp = link.path.pts;
      const ta = tp[link.end === 0 ? 0 : tp.length - 2];
      const tb = tp[link.end === 0 ? 1 : tp.length - 1];
      _tan.subVectors(tb, ta);
      _tan.y = 0;
      _tan.normalize();
      ped.cTo.copy(tp[link.end === 0 ? 0 : tp.length - 1]);
      ped.cTo.x += _tan.z * ped.lat;
      ped.cTo.z += -_tan.x * ped.lat;
      ped.cLen = Math.max(Math.hypot(ped.cTo.x - ped.cFrom.x, ped.cTo.z - ped.cFrom.z), 1e-3);
      ped.cS = 0;
      ped.next = link;
      ped.mode = 'corner';
    } else {
      ped.dir = -ped.dir; // umdrehen
    }
  }

  update(dt) {
    if (this.peds.length === 0) return;
    this.time += dt;
    const busPos = this.bus.body.position;

    // LOD-/Despawn-Takt: alle 0.5 s Distanzen prüfen (WP-E1-Mitigation)
    this.lodTimer -= dt;
    const lodPass = this.lodTimer <= 0;
    if (lodPass) {
      this.lodTimer = LOD_INTERVAL;
      this._refreshCandidates(busPos);
    }

    for (const ped of this.peds) {
      const step = ped.speed * dt;

      // ---------- Bewegung
      if (ped.mode === 'corner') {
        ped.cS += step;
        if (ped.cS >= ped.cLen) {
          // angekommen: auf den Quer-Gehweg einfädeln
          const link = ped.next;
          ped.path = link.path;
          if (link.end === 0) {
            ped.s = 0.001;
            ped.dir = 1;
            ped.seg = 0;
          } else {
            ped.s = link.path.total - 0.001;
            ped.dir = -1;
            ped.seg = link.path.pts.length - 2;
          }
          ped.mode = 'path';
          ped.next = null;
        }
      } else {
        this._advanceOnPath(ped, step);
      }

      // ---------- Position + Blickrichtung
      let moveYaw;
      if (ped.mode === 'corner') {
        _pos.lerpVectors(ped.cFrom, ped.cTo, clamp(ped.cS / ped.cLen, 0, 1));
        _tan.subVectors(ped.cTo, ped.cFrom);
        _tan.y = 0;
        _tan.normalize();
        moveYaw = Math.atan2(_tan.x, _tan.z);
      } else {
        this._posOnPath(ped, _pos, _tan);
        moveYaw = Math.atan2(_tan.x * ped.dir, _tan.z * ped.dir);
      }
      // EINZIGE Y-Quelle: groundHeight (liefert auf dem Gehweg Terrain + 0.13)
      ped.grp.position.set(_pos.x, this.roadNet.groundHeight(_pos.x, _pos.z), _pos.z);

      // Blickrichtung weich nachführen (kein hartes Umschnappen am U-Turn)
      let dy = moveYaw - ped.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      ped.yaw += clamp(dy, -TURN_RATE * dt, TURN_RATE * dt);
      ped.grp.rotation.y = ped.yaw;
      ped.walkPhase += step * WALK_FACTOR;

      // ---------- LOD-Culling + Despawn/Respawn um den Bus
      if (lodPass) {
        const d = Math.hypot(busPos.x - _pos.x, busPos.z - _pos.z);
        ped.grp.visible = d < LOD_DIST;
        if (d > DESPAWN_DIST) this._place(ped);
      }

      // Pose nur für sichtbare Figuren animieren
      if (ped.grp.visible) ped.figure.update(this.time, ped.walkPhase);
    }
  }
}
