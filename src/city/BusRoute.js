// Linie 73: geschlossener Rundkurs aus einer expliziten Lane-Key-Sequenz
// (Links- UND Rechtskurven, durch alle Viertel; bei Lücken in der Kantenfolge
// Fallback auf das alte Rechteck), 9 benannte Haltestellen mit Wartehäuschen,
// Schild und Bucht-Position. Dazu der Fahrplan (WP-C3): Soll-Ankünfte aus der
// Routendistanz (Ø ~19 km/h Fahrt + 20 s Standzeit je Halt), verankert an der
// Abfahrt an Stop 0 und rollierend je Runde neu verankert.
// Alle Fahrplan-Zeiten sind Sekunden auf der game.time-Uhr (reale Sekunden).
// WP-E3: Die Häuschen-Rückwände bekommen statische Kollisionsboxen für den
// Bus (addShelterCollision) — sie stehen gut 2 m neben der Busflanke und
// fangen nur echte Fehlfahrten ab.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { Events } from '../core/Events.js';
import { StaticAABB } from '../physics/Collision.js';

export const STOP_NAMES = [
  'Hauptbahnhof', 'Rathaus', 'Schillerplatz', 'Stadtpark', 'Klinikum',
  'Universität', 'Marktplatz', 'Goethestraße', 'Theater',
];

// Fahrplan-Parameter: Ø-Reisegeschwindigkeit (inkl. Ampeln/Kurven) und
// Sollstandzeit je bedientem Halt
const SCHED_SPEED = 19 / 3.6; // m/s ≈ 19 km/h
const SCHED_DWELL = 20;       // s

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
  // laneKeys:  explizite, geschlossene Lane-Key-Sequenz ("NS,i,j,dir,laneIdx" /
  //            "EW,j,i,dir,laneIdx") — die bevorzugte Routen-Definition.
  // rect:      {i0, j0, i1, j1} Rasterindizes — Fallback-Rechteck, falls die
  //            Sequenz Lücken hat (z. B. nach Topologie-Änderungen am Raster).
  // collision: optionales Kollisionssystem (physics/Collision) — registriert
  //            die Häuschen-Rückwände als StaticAABBs für den Bus. Kann auch
  //            später per addShelterCollision(collision) nachgereicht werden.
  constructor({ roadNet, laneKeys = null, rect = null, parent, collision = null }) {
    this.roadNet = roadNet;
    this.edges = [];        // Kantenfolge inkl. Verbindungs-/Abbiegekanten
    this.cumLength = [];    // kumulierte Länge am Kantenanfang
    this.totalLength = 0;
    this.stops = [];
    this.closed = true;     // Rundkurs — Minimap zieht closePath() nur dann
    this.shelterColliders = [];        // Welt-AABBs der Häuschen-Rückwände
    this._shelterCollisionAdded = false;
    this.group = new THREE.Group();
    parent.add(this.group);

    // Explizite Sequenz validieren (nach der Stadtgenerierung: alle Keys
    // müssen existieren, die Kantenfolge muss lückenlos schließen)
    let lanes = laneKeys && laneKeys.length ? this._resolveLaneKeys(laneKeys) : null;
    if (!lanes) {
      if (laneKeys && laneKeys.length) {
        console.warn('BusRoute: Fallback auf die Rechteck-Route', rect);
      }
      lanes = rect ? this._laneKeyEdges(rect).filter(Boolean) : [];
    }

    this._buildSequence(lanes);
    this._placeStops();
    this._buildSchedule();
    this._buildShelters();
    this._buildRoutePolyline();
    this.addShelterCollision(collision);
  }

  // WP-E3: Rückwand-Kollisionsboxen der Wartehäuschen beim Kollisionssystem
  // registrieren — nur der Bus kollidiert mit StaticAABBs, Fußgänger und
  // Verkehr bleiben unberührt. Idempotent; Game.init() ruft das nach der
  // Stadtgenerierung mit world.collision auf (alternativ Konstruktor-Option).
  addShelterCollision(collision) {
    if (!collision || this._shelterCollisionAdded) return;
    this._shelterCollisionAdded = true;
    for (const box of this.shelterColliders) collision.addAABB(box);
  }

  // Lane-Key-Sequenz auflösen und prüfen: existieren alle Keys, und ist jedes
  // aufeinanderfolgende Paar (inkl. Rundschluss) direkt oder über genau eine
  // Zwischenkante (Through-Link/Abbieger) verbunden? Bei Lücke → null.
  _resolveLaneKeys(keys) {
    const lanes = [];
    for (const key of keys) {
      const e = this.roadNet.laneIndex.get(key);
      if (!e) {
        console.warn(`BusRoute: Lücke in der Kantenfolge — Lane-Key fehlt: ${key}`);
        return null;
      }
      lanes.push(e);
    }
    for (let k = 0; k < lanes.length; k++) {
      const cur = lanes[k];
      const next = lanes[(k + 1) % lanes.length];
      const direct = cur.successors.some((s) => s.edge === next);
      const via = cur.successors.some((s) => s.edge.successors.some((t) => t.edge === next));
      if (!direct && !via) {
        console.warn('BusRoute: Lücke in der Kantenfolge bei Index', k,
          `(${keys[k]} → ${keys[(k + 1) % keys.length]})`);
        return null;
      }
    }
    return lanes;
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

  _buildSequence(lanes) {
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

  // ------------------------------------------------------------- Fahrplan
  // Soll-Zeiten aus der Routendistanz: SCHED_SPEED Fahrt + SCHED_DWELL
  // Standzeit je bereits bedientem Halt. Anker = Abfahrt an Stop 0.
  _buildSchedule() {
    this.dwellTime = SCHED_DWELL;
    const d0 = this.stops.length ? this.stops[0].routeDist : 0;
    this.stops.forEach((stop, k) => {
      const dd = this.totalLength > 0
        ? (stop.routeDist - d0 + this.totalLength) % this.totalLength : 0;
      // Soll-ANKUNFT k Sekunden nach Abfahrt an Stop 0 (Standzeiten 1..k-1)
      stop.schedOffset = k === 0 ? 0 : dd / SCHED_SPEED + (k - 1) * SCHED_DWELL;
      stop.actualArrival = null; // Ist-Ankunft der laufenden Runde
    });
    // Soll-Rundenzeit: einmal herum + Standzeiten an den Stops 1..n-1
    this.roundTime = this.totalLength / SCHED_SPEED
      + Math.max(0, this.stops.length - 1) * SCHED_DWELL;
    this._anchor = null; // Spielzeit (s) der Soll-Abfahrt an Stop 0
    this._lastDd = 0;    // letzter Streckenfortschritt (Rundenwechsel-Erkennung)
  }

  // Fahrplan an der (tatsächlichen) Abfahrt an Stop 0 verankern — zu
  // Rundenbeginn und bei jeder erneuten Abfahrt aufrufen. Ohne Aufruf
  // verankert updateSchedule() lazy (aktuelle Position gilt als pünktlich).
  anchorSchedule(gameTime) {
    this._anchor = gameTime;
    for (const s of this.stops) s.actualArrival = null;
  }

  // Streckenfortschritt seit Stop 0 (m) aus einer Routen-Distanz
  _progress(routeDist) {
    if (!this.stops.length || this.totalLength <= 0) return 0;
    return (routeDist - this.stops[0].routeDist + this.totalLength) % this.totalLength;
  }

  // Soll-Zeitbedarf (s) ab Abfahrt Stop 0 bis Fortschritt dd —
  // Fahrzeit plus Standzeiten aller bereits passierten Halte
  _plannedOffset(dd) {
    let t = dd / SCHED_SPEED;
    for (let k = 1; k < this.stops.length; k++) {
      if (dd >= this._progress(this.stops[k].routeDist)) t += SCHED_DWELL;
    }
    return t;
  }

  // Soll-Ankunft an Stop k als absolute Spielzeit (s); Stop 0 liefert die
  // Ankunft am RUNDENENDE. null, solange der Fahrplan nicht verankert ist.
  plannedArrival(stopIndex) {
    if (this._anchor === null) return null;
    const s = this.stops[stopIndex];
    if (!s) return null;
    return this._anchor + (stopIndex === 0 ? this.roundTime : s.schedOffset);
  }

  // Soll-Abfahrt an Stop k (Ankunft + Standzeit); Stop 0 = der Anker selbst
  plannedDeparture(stopIndex) {
    if (this._anchor === null || !this.stops[stopIndex]) return null;
    if (stopIndex === 0) return this._anchor;
    return this.plannedArrival(stopIndex) + SCHED_DWELL;
  }

  // Live-Abweichung (s) an einer Routenposition: + = verspätet, − = verfrüht.
  // null, solange kein Anker existiert.
  delaySeconds(routeDist, gameTime) {
    if (this._anchor === null || !this.stops.length || this.totalLength <= 0) return null;
    return gameTime - (this._anchor + this._plannedOffset(this._progress(routeDist)));
  }

  // Abweichung an einem konkreten Halt (z. B. bei Ankunft/Abfahrt prüfen)
  delayAtStop(stopIndex, gameTime) {
    const planned = this.plannedArrival(stopIndex);
    return planned === null ? null : gameTime - planned;
  }

  // Nächster Halt mit Sollzeit + Live-Abweichung (fürs HUD/scheduleBox)
  nextStopInfo(routeDist, gameTime) {
    const stop = this.nextStopAfter(routeDist);
    if (!stop) return null;
    return {
      stop,
      plannedArrival: this.plannedArrival(stop.index),
      delay: this.delaySeconds(routeDist, gameTime),
    };
  }

  // Alle Halte fürs Fahrplan-Overlay: Soll-Ankunft/-Abfahrt (absolute
  // Spielzeit in s oder null) + Ist-Ankunft der laufenden Runde
  scheduleList() {
    return this.stops.map((s) => ({
      index: s.index,
      name: s.name,
      plannedArrival: this.plannedArrival(s.index),
      plannedDeparture: this.plannedDeparture(s.index),
      actualArrival: s.actualArrival,
    }));
  }

  // Pro Frame aufrufen (Game, mit der Routen-Distanz des Busses und
  // game.time): verankert lazy, erkennt den Rundenwechsel an Stop 0
  // (rollierende Neu-Verankerung: Soll-Abfahrt = Ankunft + Standzeit),
  // protokolliert Ist-Ankünfte und liefert die aktuelle Abweichung (s).
  updateSchedule(routeDist, gameTime) {
    if (!this.stops.length || this.totalLength <= 0) return null;
    const dd = this._progress(routeDist);
    if (this._anchor === null) {
      this._anchor = gameTime - this._plannedOffset(dd);
    }
    if (this._lastDd - dd > this.totalLength * 0.5) {
      // Runde geschlossen: neu verankern (Phase F darf den Anker bei der
      // tatsächlichen Abfahrt mit anchorSchedule(gameTime) präzisieren)
      this.anchorSchedule(gameTime + SCHED_DWELL);
      this.stops[0].actualArrival = gameTime;
    } else {
      for (let k = 1; k < this.stops.length; k++) {
        const sd = this._progress(this.stops[k].routeDist);
        if (sd > this._lastDd && sd <= dd && this.stops[k].actualArrival === null) {
          this.stops[k].actualArrival = gameTime;
        }
      }
    }
    this._lastDd = dd;
    return this.delaySeconds(routeDist, gameTime);
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

      // Statische Kollisionsbox der Rückwand (WP-E3, nur für den Bus):
      // Welt-AABB der gedrehten Wand (Häuschen-lokal x≈0.72, 3,6 m lang,
      // hier 0,2 m dick gefasst — deckt auch die Pfosten bei z=±1.6).
      // Häuschen-lokal zeigt +x zur Fahrbahn (= −right), +z in Fahrtrichtung.
      const il = 1 / (Math.hypot(stop.dir.x, stop.dir.z) || 1);
      const fx = stop.dir.x * il, fz = stop.dir.z * il; // Fahrtrichtung (XZ, normiert)
      const cx = stop.shelterPos.x + fz * 0.72;         // Wandmitte in Weltkoordinaten
      const cz = stop.shelterPos.z - fx * 0.72;
      const hx = Math.abs(fz) * 0.10 + Math.abs(fx) * 1.80;
      const hz = Math.abs(fx) * 0.10 + Math.abs(fz) * 1.80;
      const baseY = stop.pos.y + 0.13;
      this.shelterColliders.push(
        new StaticAABB(cx - hx, cz - hz, cx + hx, cz + hz, baseY + 2.2)
      );
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
