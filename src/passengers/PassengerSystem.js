// Fahrgast-Verwaltung: Warteschlangen an den Haltestellen, Einstieg über
// Tür 1 mit Ticketverkauf, Sitzplatzwahl, Haltewunsch, Ausstieg über
// Tür 2/3. Figuren werden beim Einstieg in Bus-Lokalkoordinaten umgehängt.
// Beim Halt stellen sich die Wartenden in einer Schlange vor Tür 1 an
// (Zustand QUEUE); bei aktiver Türfreigabe öffnen Aussteiger Tür 2/3 selbst.
// WP-E3: Wartende stehen in Häuschen-lokalen Zonen (unter dem Dach vor der
// Rückwand bzw. neben dem Mast), alle Fußwege führen um Rückwand/Pfosten
// herum (Bypass über die Häuschen-Kanten), Aussteiger laufen am Gehweg
// entlang davon — niemand clippt mehr durch das Glas.

import * as THREE from 'three';
import { Passenger } from './Passenger.js';
import { Events } from '../core/Events.js';
import { clamp } from '../utils/Math3D.js';

const BUS_FLOOR = -0.86;
const DOOR1_LOCAL = new THREE.Vector3(1.05, BUS_FLOOR, -4.85);
const DRIVER_POINT = new THREE.Vector3(0.3, BUS_FLOOR, -4.85);
const EXIT_DOORS = [new THREE.Vector3(1.05, BUS_FLOOR, 0), new THREE.Vector3(1.05, BUS_FLOOR, 3.7)];
const STAND_SLOTS = [
  new THREE.Vector3(-0.45, BUS_FLOOR, -1.4), new THREE.Vector3(0.45, BUS_FLOOR, -1.0),
  new THREE.Vector3(-0.45, BUS_FLOOR, 0.6), new THREE.Vector3(0.45, BUS_FLOOR, 1.6),
];

// Warteschlange vor Tür 1: Slots werden bei Service-Beginn einmal eingefroren
const QUEUE_OUT = 0.9;   // m vom Bordstein weg (quer zur Tür, auf den Gehweg)
const QUEUE_BASE = 1.1;  // m Abstand des ersten Slots von der Tür Richtung Heck
const QUEUE_GAP = 0.85;  // m Abstand zwischen den Slots
const QUEUE_MAX = 8;     // mehr stellen sich nicht sichtbar an

const _world = new THREE.Vector3();
const _door = new THREE.Vector3();
const _qDir = new THREE.Vector3();  // Schlangenrichtung (Richtung Heck)
const _qOut = new THREE.Vector3();  // quer vom Bus weg (Bordsteinseite)
const _qRef = new THREE.Vector3();  // Fahrbahn-Referenzpunkt für die Bodenprobe

export class PassengerSystem {
  constructor({ scene, bus, busModel, route, ticketFlow, rand, groundY,
    waitingMax = 6, figureOpts = null }) {
    this.scene = scene;
    this.bus = bus;
    this.busModel = busModel;
    this.route = route;
    this.ticketFlow = ticketFlow;
    this.rand = rand;
    this.groundY = groundY || (() => 0.13); // Welt-Bodenhöhe (Terrain + Bordstein)
    this.waitingMax = waitingMax;           // Preset-Limit Wartende je Haltestelle (WP-A4)
    this.figureOpts = figureOpts || {};     // HumanFigure-Optionen (detail/props/rainy)

    this.waiting = route.stops.map(() => []);   // Passenger[] je Haltestelle
    this.aboard = [];
    this.leaving = [];
    this.servingStop = null;
    this.boardingQueue = [];
    this.currentBoarder = null;
    this.queueSlots = [];        // eingefrorene Welt-Positionen der Schlange
    this.queueFaceYaw = 0;       // Blickrichtung in der Schlange (zur Tür)
    this.releaseDoors = [false, false, false]; // per Türfreigabe selbst geöffnete Türen
    this.releaseCloseTimer = 0;
    this.spawnTimers = route.stops.map(() => rand.float(5, 30));
    this.time = 0;
    this.nextStopIndex = 0;

    // Startbelegung der Haltestellen
    route.stops.forEach((stop, i) => {
      const n = rand.int(0, 4);
      for (let k = 0; k < n; k++) this._spawnAtStop(i);
    });

    // Türöffnung am aktiven Stop setzt den Haltewunsch zurück
    Events.on('doorPneumatic', ({ opening }) => {
      if (opening && this.bus.stopRequested) this.bus.stopRequested = false;
    });
  }

  _spawnAtStop(stopIdx) {
    if (this.waiting[stopIdx].length >= this.waitingMax) return;
    const stop = this.route.stops[stopIdx];
    const dest = (stopIdx + this.rand.int(2, 6)) % this.route.stops.length;
    const p = new Passenger(
      this.rand.fork(stopIdx * 100 + this.waiting[stopIdx].length),
      stopIdx, dest, this.figureOpts);
    // Position in den Häuschen-Zonen (WP-E3: unter dem Dach oder am Mast,
    // statt im ±2,5-m-Quadrat quer durch Glas und Bank), Blick grob zur
    // Fahrbahn — von dort kommt der Bus
    p.group.position.copy(this._shelterWaitPos(stop));
    p.group.rotation.y = Math.atan2(-stop.right.x, -stop.right.z) + this.rand.float(-0.7, 0.7);
    this.scene.add(p.group);
    this.waiting[stopIdx].push(p);
  }

  // ---------- Häuschen-Geometrie (WP-E3) -----------------------------------
  // Häuschen-lokales Koordinatensystem: +lx zeigt vom Häuschen zur Fahrbahn
  // (= −stop.right), +lz in Fahrtrichtung. Maße aus BusRoute._buildShelters:
  // Rückwand bei lx≈0.72 (|lz|≤1.8), Pfosten lz=±1.6, Bank lx 0.23–0.68,
  // Dach lx −0.65…1.05 / |lz|≤2.0, Schildmast bei (−0.4, −2.2).

  // Häuschen-lokalen Punkt (lx, lz) in Weltkoordinaten inkl. Gelände-Y
  _shelterPoint(stop, lx, lz) {
    const il = 1 / (Math.hypot(stop.dir.x, stop.dir.z) || 1);
    const fx = stop.dir.x * il, fz = stop.dir.z * il; // Fahrtrichtung (XZ, normiert)
    const p = new THREE.Vector3(
      stop.shelterPos.x + fz * lx + fx * lz, 0,
      stop.shelterPos.z - fx * lx + fz * lz);
    p.y = this.groundY(p.x, p.z);
    return p;
  }

  // Weltposition → Häuschen-lokale Koordinaten {lx, lz}
  _shelterLocal(stop, worldPos) {
    const il = 1 / (Math.hypot(stop.dir.x, stop.dir.z) || 1);
    const fx = stop.dir.x * il, fz = stop.dir.z * il;
    const dx = worldPos.x - stop.shelterPos.x;
    const dz = worldPos.z - stop.shelterPos.z;
    return { lx: dx * fz - dz * fx, lz: dx * fx + dz * fz };
  }

  // Zufällige Warteposition: unter dem Dach vor Bank und Rückwand (70 %)
  // oder neben dem Mast mit dem H-Schild (30 %) — nie in Bank, Glas, Pfosten
  _shelterWaitPos(stop) {
    if (this.rand.chance(0.7)) {
      return this._shelterPoint(stop, this.rand.float(-0.5, -0.05), this.rand.float(-1.55, 1.55));
    }
    return this._shelterPoint(stop, this.rand.float(0.1, 1.2), this.rand.float(-3.1, -2.1));
  }

  // Umgehungs-Wegpunkte um Rückwand und Pfosten: Wege zwischen dem Bereich
  // hinter der Wand (lx<0.85, |lz|<2.05) und der Fahrbahnseite laufen über
  // zwei Eckpunkte an einem Wandende — bei preferFront bevorzugt über die
  // Vorderkante des Häuschens (in Fahrtrichtung, dort wartet die Tür 1).
  // Liefert [] für Wege, die die Rückwand gar nicht kreuzen.
  _shelterBypass(stop, from, to, preferFront = false) {
    const a = this._shelterLocal(stop, from);
    const b = this._shelterLocal(stop, to);
    const inside = (l) => l.lx < 0.85 && Math.abs(l.lz) < 2.05;
    if (inside(a) === inside(b)) return [];
    let sgn = b.lz >= a.lz ? 1 : -1;
    if (preferFront && b.lz > a.lz - 1.5) sgn = 1;
    const cIn = this._shelterPoint(stop, 0.30, sgn * 2.30);  // hinter der Wand, am Wandende
    const cOut = this._shelterPoint(stop, 1.60, sgn * 2.50); // Häuschen-Kante auf dem Gehweg
    return inside(a) ? [cIn, cOut] : [cOut, cIn];
  }

  // Nächstgelegene Haltestelle, wenn der Bus dort steht — unabhängig vom
  // Türzustand (Türfreigabe/Ausstieg brauchen keine offene Tür 1).
  _nearestStopWhileStanding() {
    if (this.bus.speedKmh > 1) return null;
    this.busModel.group.localToWorld(_door.copy(DOOR1_LOCAL));
    let best = null, bd = Infinity;
    for (const stop of this.route.stops) {
      const d = (stop.pos.x - _door.x) ** 2 + (stop.pos.z - _door.z) ** 2;
      if (d < bd) { bd = d; best = stop; }
    }
    return bd < 20 * 20 ? best : null;
  }

  // Slots der Einstiegs-Schlange einmalig in Weltkoordinaten einfrieren:
  // von Tür 1 aus 0,9 m vom Bordstein auf den Gehweg, dann Richtung Heck
  // gestaffelt. Jeder Slot wird per groundY-Probe auf Gehwegniveau geprüft
  // und notfalls weiter vom Bordstein weggeschoben.
  _freezeQueueSlots() {
    const busGroup = this.busModel.group;
    busGroup.localToWorld(_door.copy(DOOR1_LOCAL));
    _qDir.set(0, 0, 1).transformDirection(busGroup.matrixWorld); // Bus-lokal +z = Heck
    _qDir.y = 0; _qDir.normalize();
    _qOut.set(1, 0, 0).transformDirection(busGroup.matrixWorld); // Türseite, vom Bus weg
    _qOut.y = 0; _qOut.normalize();
    this.queueFaceYaw = Math.atan2(-_qDir.x, -_qDir.z); // Blick entlang der Schlange zur Tür

    this.queueSlots.length = 0;
    for (let i = 0; i < QUEUE_MAX; i++) {
      const along = QUEUE_BASE + QUEUE_GAP * i;
      const slot = new THREE.Vector3().copy(_door)
        .addScaledVector(_qOut, QUEUE_OUT)
        .addScaledVector(_qDir, along);
      // Fahrbahn-Referenz auf gleicher Höhe entlang der Busflanke: liegt der
      // Slot noch auf Fahrbahnniveau (kein Bordstein-Sprung von ~0.13), wird
      // er schrittweise weiter vom Bordstein weggeschoben.
      _qRef.copy(_door).addScaledVector(_qDir, along);
      const refY = this.groundY(_qRef.x, _qRef.z);
      for (let t = 0; t < 6 && this.groundY(slot.x, slot.z) < refY + 0.06; t++) {
        slot.addScaledVector(_qOut, 0.35);
      }
      // Jitter ±0.1 m — niemand steht exakt in Reih und Glied
      slot.x += this.rand.float(-0.1, 0.1);
      slot.z += this.rand.float(-0.1, 0.1);
      slot.y = this.groundY(slot.x, slot.z);
      this.queueSlots.push(slot);
    }
  }

  // Abgebrochener Einstieg (Bus fährt ab): zurück in den Wartemodus,
  // mit Fußweg zu einer Häuschen-Zone — um Rückwand/Pfosten herum statt
  // quer durchs Glas, kein Teleport.
  _sendBackToShelter(p, stop) {
    p.state = 'WAIT';
    p.figure.setPose('walk');
    const back = this._shelterWaitPos(stop);
    p.waypoints = [...this._shelterBypass(stop, p.group.position, back), back];
  }

  // Türfreigabe-Hook (liest bus.doorReleased aus WP-B2): Aussteiger „drücken
  // den Taster" und öffnen Tür 2/3 selbst — der Fahrer muss nur noch Tür 1
  // bedienen. Selbst geöffnete Türen schließen automatisch wieder, sobald
  // niemand mehr aussteigt oder die Freigabe aufgehoben wird.
  _updateDoorRelease(dt, atStop) {
    const doors = this.bus.doors;
    // Vom Fahrer manuell geschlossene Türen aus dem Merker nehmen
    for (let di = 1; di <= 2; di++) {
      if (this.releaseDoors[di] && doors.doors[di].target === 0) this.releaseDoors[di] = false;
    }

    if (!this.bus.doorReleased || !atStop) {
      // Freigabe aufgehoben bzw. Halt beendet → selbst geöffnete Türen schließen
      for (let di = 1; di <= 2; di++) {
        if (this.releaseDoors[di]) {
          if (doors.doors[di].target === 1) doors.toggle(di, this.bus.speedKmh);
          this.releaseDoors[di] = false;
        }
      }
      this.releaseCloseTimer = 0;
      return;
    }

    // Aussteiger für diesen Halt öffnen die jeweils nähere Ausstiegstür
    let exiting = false;
    for (const p of this.aboard) {
      if (p.state === 'WALK_TO_EXIT') { exiting = true; continue; }
      if (p.state !== 'SEATED' || p.destIndex !== atStop.index) continue;
      exiting = true;
      // Tür 2 (z=0) oder Tür 3 (z=3.7) — je nachdem, was näher am Sitzplatz ist
      const di = Math.abs(p.group.position.z - EXIT_DOORS[0].z) <=
                 Math.abs(p.group.position.z - EXIT_DOORS[1].z) ? 1 : 2;
      if (doors.doors[di].target === 0 && doors.toggle(di, this.bus.speedKmh)) {
        this.releaseDoors[di] = true;
      }
    }

    // Automatisch schließen, wenn niemand mehr aussteigen will (kleine Karenz)
    if (!exiting && (this.releaseDoors[1] || this.releaseDoors[2])) {
      this.releaseCloseTimer += dt;
      if (this.releaseCloseTimer > 1.2) {
        for (let di = 1; di <= 2; di++) {
          if (this.releaseDoors[di] && doors.doors[di].target === 1) {
            doors.toggle(di, this.bus.speedKmh);
          }
          this.releaseDoors[di] = false;
        }
        this.releaseCloseTimer = 0;
      }
    } else {
      this.releaseCloseTimer = 0;
    }
  }

  update(dt, hud) {
    this.time += this.bus ? dt : 0;
    const busGroup = this.busModel.group;

    // Nachschub an den Haltestellen
    this.spawnTimers.forEach((t, i) => {
      this.spawnTimers[i] -= dt;
      if (this.spawnTimers[i] <= 0) {
        this.spawnTimers[i] = this.rand.float(20, 55);
        this._spawnAtStop(i);
      }
    });

    // ---------- Service-Erkennung
    const atStop = this._nearestStopWhileStanding();                    // Bus steht an einer Haltestelle
    const serving = atStop && this.bus.doors.isOpen(0) ? atStop : null; // Tür 1 offen → Einstieg läuft
    if (serving && this.servingStop !== serving) {
      this.servingStop = serving;
      // Schlangen-Slots einmalig einfrieren, Wartende stellen sich an
      this._freezeQueueSlots();
      this.boardingQueue = [...this.waiting[serving.index]];
    }
    if (!serving && this.servingStop) {
      // Bus fährt ab / Tür 1 zu: Schlange auflösen, alle zurück zum Häuschen
      const stop = this.servingStop;
      for (const p of this.boardingQueue) {
        if (p.state === 'QUEUE' || p.state === 'WALK_TO_DOOR') this._sendBackToShelter(p, stop);
      }
      this.boardingQueue = [];
      if (this.currentBoarder && !this.currentBoarder.aboard) {
        this._sendBackToShelter(this.currentBoarder, stop);
        this.currentBoarder = null;
      }
      this.servingStop = null;
    }

    // ---------- Türfreigabe: Aussteiger öffnen Tür 2/3 selbst
    this._updateDoorRelease(dt, atStop);

    // ---------- Einstieg: einer nach dem anderen (currentBoarder serialisiert)
    if (serving && !this.currentBoarder && this.boardingQueue.length > 0) {
      this.currentBoarder = this.boardingQueue.shift();
      this.currentBoarder.state = 'WALK_TO_DOOR';
      // Einstiegsweg über die Vorderkante des Häuschens (WP-E3): wer noch
      // hinter der Rückwand steht, läuft erst außen herum zur Tür
      busGroup.localToWorld(_door.copy(DOOR1_LOCAL));
      this.currentBoarder.waypoints =
        this._shelterBypass(serving, this.currentBoarder.group.position, _door, true);
    }

    // ---------- Schlange pflegen: aufrücken, Nachzügler anstellen
    if (serving) {
      for (let i = 0; i < this.boardingQueue.length; i++) {
        if (i >= QUEUE_MAX) break; // Rest wartet am Häuschen, bis vorne Platz wird
        const p = this.boardingQueue[i];
        if (p.state === 'WAIT') {
          p.state = 'QUEUE';
          // Erst um Rückwand/Pfosten herum (WP-E3), dann zum Schlangen-Slot
          p.waypoints = this._shelterBypass(serving, p.group.position, this.queueSlots[i]);
        }
        if (p.state !== 'QUEUE') continue;
        if (p.waypoints.length > 0) {
          p.follow(dt, 0.9);
        } else if (p.moveToward(this.queueSlots[i], dt, 0.9)) {
          p.figure.setPose('stand');
          p.group.rotation.y = this.queueFaceYaw; // Blick nach vorn zur Tür
        }
        p.group.position.y = this.groundY(p.group.position.x, p.group.position.z);
        p.update(this.time);
      }
    }

    // ---------- Wartende aktualisieren (winken bei Annäherung)
    const busPos = this.bus.body.position;
    this.route.stops.forEach((stop, i) => {
      const dBus = Math.hypot(busPos.x - stop.pos.x, busPos.z - stop.pos.z);
      for (const p of this.waiting[i]) {
        if (p.state !== 'WAIT') continue; // Schlange/Einsteiger werden separat aktualisiert
        if (p.waypoints.length > 0) {
          // Rückweg zum Häuschen nach abgebrochenem Einstieg
          if (p.follow(dt)) p.figure.setPose('stand');
          p.group.position.y = this.groundY(p.group.position.x, p.group.position.z);
        } else if (dBus < 60 && dBus > 14 && this.bus.speedKmh > 3) {
          p.figure.setPose('hail');
        } else {
          p.figure.setPose('stand');
        }
        p.update(this.time);
      }
    });

    // ---------- aktueller Einsteiger
    const cb = this.currentBoarder;
    if (cb) {
      if (cb.state === 'WALK_TO_DOOR') {
        busGroup.localToWorld(_door.copy(DOOR1_LOCAL));
        _door.y = cb.group.position.y;
        // Füße folgen dem Gelände
        cb.group.position.y = this.groundY(cb.group.position.x, cb.group.position.z);
        if (cb.waypoints.length > 0) {
          cb.follow(dt); // Bypass um das Häuschen (Vorderkante) vor dem Türziel
        } else if (cb.moveToward(_door, dt)) {
          // Umhängen in Bus-Koordinaten
          this.scene.remove(cb.group);
          busGroup.add(cb.group);
          cb.group.position.set(DOOR1_LOCAL.x, BUS_FLOOR, DOOR1_LOCAL.z);
          cb.group.rotation.y = -Math.PI / 2;
          cb.aboard = true;
          cb.state = 'AT_DRIVER';
          cb.timer = 0;
          // aus der Warteliste nehmen
          const list = this.waiting[cb.stopIndex];
          const idx = list.indexOf(cb);
          if (idx >= 0) list.splice(idx, 1);
        }
      } else if (cb.state === 'AT_DRIVER') {
        if (cb.moveToward(DRIVER_POINT, dt, 0.8)) {
          cb.figure.setPose('stand');
          if (cb.wantsTicket) {
            cb.state = 'BUY_TICKET';
            this.ticketFlow.request(cb, this.rand, () => {
              cb.state = 'FIND_SEAT';
              this._assignSeat(cb);
            });
          } else {
            cb.timer += dt;
            if (cb.timer > 1.4) {
              Events.emit('ticketBeep'); // Karte gescannt
              cb.state = 'FIND_SEAT';
              this._assignSeat(cb);
            }
          }
        }
      } else if (cb.state === 'BUY_TICKET') {
        cb.figure.setPose('stand');
        // TicketFlow ruft resolve() → FIND_SEAT
      } else if (cb.state === 'FIND_SEAT') {
        // Queue freigeben, sobald der Fahrgast den Fahrerbereich verlässt
        this.aboard.push(cb);
        this.bus.setPassengerCount(this.aboard.length);
        this.currentBoarder = null;
      }
      if (cb) cb.update(this.time);
    }

    // ---------- Fahrgäste an Bord
    for (let k = this.aboard.length - 1; k >= 0; k--) {
      const p = this.aboard[k];

      if (p.state === 'FIND_SEAT') {
        const target = p.seatSlot ? p.seatSlot.local : p.standSlot;
        // erst in den Gang, dann zum Platz
        if (p.waypoints.length === 0) {
          p.waypoints = [
            new THREE.Vector3(0.0, BUS_FLOOR, -3.6),
            new THREE.Vector3(target.x > 0 ? 0.1 : -0.1, BUS_FLOOR, target.z),
            new THREE.Vector3(target.x, BUS_FLOOR, target.z),
          ];
        }
        if (p.follow(dt, 0.9)) {
          p.state = 'SEATED';
          p.figure.setPose(p.seatSlot ? 'sit' : 'stand');
          p.group.rotation.y = 0; // Blick nach vorn (-z): Figur schaut +z → drehen
          p.group.rotation.y = Math.PI;
          if (p.seatSlot) {
            p.group.position.y = p.seatSlot.local.y - 0.99 + 0.37; // Sitzhöhe
          }
        }
      } else if (p.state === 'SEATED') {
        // Haltewunsch
        if (!p.requestedStop && this.nextStopIndex === p.destIndex && this.bus.speedKmh > 10) {
          p.requestedStop = true;
          Events.emit('stopRequested');
        }
        // Ausstieg — am Halt mit offener Tür 2/3 (Tür 1 muss dafür nicht offen sein)
        if (atStop && atStop.index === p.destIndex &&
            (this.bus.doors.isOpen(1) || this.bus.doors.isOpen(2))) {
          p.state = 'WALK_TO_EXIT';
          p.figure.setPose('walk');
          if (p.seatSlot) p.seatSlot.taken = false;
          const exit = this.bus.doors.isOpen(1) ? EXIT_DOORS[0] : EXIT_DOORS[1];
          p.waypoints = [
            new THREE.Vector3(p.group.position.x > 0 ? 0.1 : -0.1, BUS_FLOOR, p.group.position.z),
            new THREE.Vector3(0, BUS_FLOOR, exit.z),
            exit.clone(),
          ];
          p.group.position.y = BUS_FLOOR;
        }
      } else if (p.state === 'WALK_TO_EXIT') {
        if (p.follow(dt, 0.9)) {
          // zurück in die Welt
          busGroup.localToWorld(_world.copy(p.group.position));
          busGroup.remove(p.group);
          this.scene.add(p.group);
          p.group.position.set(_world.x, this.groundY(_world.x, _world.z), _world.z);
          p.aboard = false;
          p.state = 'WALK_AWAY';
          // Ziel (WP-E3): erst quer auf den Gehweg hinaus, dann am Bordstein
          // entlang davon — zwischen Schlange und Häuschen-Rückwand hindurch,
          // nie mehr quer durchs Häuschen oder über die Fahrbahn
          _qOut.set(1, 0, 0).transformDirection(busGroup.matrixWorld); // Türseite
          _qOut.y = 0; _qOut.normalize();
          _qDir.set(0, 0, 1).transformDirection(busGroup.matrixWorld); // Richtung Heck
          _qDir.y = 0; _qDir.normalize();
          const out = 1.1 + this.rand.float(0, 0.5);
          const along = this.rand.float(8, 18) * (this.rand.chance(0.5) ? 1 : -1);
          const w1 = new THREE.Vector3().copy(p.group.position).addScaledVector(_qOut, out);
          const w2 = w1.clone()
            .addScaledVector(_qDir, along)
            .addScaledVector(_qOut, this.rand.float(0, 0.4));
          w1.y = this.groundY(w1.x, w1.z);
          w2.y = this.groundY(w2.x, w2.z);
          p.waypoints = [w1, w2];
          this.aboard.splice(k, 1);
          this.leaving.push(p);
          this.bus.setPassengerCount(this.aboard.length);
        }
      }
      p.update(this.time);
    }

    // ---------- Aussteigende laufen den Gehweg entlang (Füße folgen dem Gelände)
    for (let k = this.leaving.length - 1; k >= 0; k--) {
      const p = this.leaving[k];
      if (p.follow(dt)) {
        this.scene.remove(p.group);
        this.leaving.splice(k, 1);
      } else {
        p.group.position.y = this.groundY(p.group.position.x, p.group.position.z);
        p.update(this.time);
      }
    }
  }

  _assignSeat(p) {
    const slots = this.busModel.seatWorldSlots;
    const free = slots.filter((s) => !s.taken);
    if (free.length > 0) {
      const slot = free[this.rand.int(0, free.length - 1)];
      slot.taken = true;
      p.seatSlot = slot;
    } else {
      p.standSlot = STAND_SLOTS[this.rand.int(0, STAND_SLOTS.length - 1)];
    }
  }

  setNextStop(index) {
    this.nextStopIndex = index;
  }

  get waitingCountAt() {
    return (idx) => this.waiting[idx].length;
  }
}
