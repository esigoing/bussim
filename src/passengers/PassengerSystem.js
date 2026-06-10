// Fahrgast-Verwaltung: Warteschlangen an den Haltestellen, Einstieg über
// Tür 1 mit Ticketverkauf, Sitzplatzwahl, Haltewunsch, Ausstieg über
// Tür 2/3. Figuren werden beim Einstieg in Bus-Lokalkoordinaten umgehängt.

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

const _world = new THREE.Vector3();
const _door = new THREE.Vector3();

export class PassengerSystem {
  constructor({ scene, bus, busModel, route, ticketFlow, rand }) {
    this.scene = scene;
    this.bus = bus;
    this.busModel = busModel;
    this.route = route;
    this.ticketFlow = ticketFlow;
    this.rand = rand;

    this.waiting = route.stops.map(() => []);   // Passenger[] je Haltestelle
    this.aboard = [];
    this.leaving = [];
    this.servingStop = null;
    this.boardingQueue = [];
    this.currentBoarder = null;
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
    if (this.waiting[stopIdx].length >= 6) return;
    const stop = this.route.stops[stopIdx];
    const dest = (stopIdx + this.rand.int(2, 6)) % this.route.stops.length;
    const p = new Passenger(this.rand.fork(stopIdx * 100 + this.waiting[stopIdx].length), stopIdx, dest);
    // Position um das Wartehäuschen verteilt
    p.group.position.copy(stop.shelterPos);
    p.group.position.x += this.rand.float(-2.5, 2.5);
    p.group.position.z += this.rand.float(-2.5, 2.5);
    p.group.position.y = 0.13;
    p.group.rotation.y = this.rand.float(0, Math.PI * 2);
    this.scene.add(p.group);
    this.waiting[stopIdx].push(p);
  }

  // Welche Haltestelle bedient der Bus gerade? (Tür 1 nahe Stop-Punkt, steht)
  _detectService() {
    if (this.bus.speedKmh > 1 || !this.bus.doors.isOpen(0)) return null;
    this.busModel.group.localToWorld(_door.copy(DOOR1_LOCAL));
    let best = null, bd = Infinity;
    for (const stop of this.route.stops) {
      const d = (stop.pos.x - _door.x) ** 2 + (stop.pos.z - _door.z) ** 2;
      if (d < bd) { bd = d; best = stop; }
    }
    return bd < 20 * 20 ? best : null;
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
    const serving = this._detectService();
    if (serving && this.servingStop !== serving) {
      this.servingStop = serving;
      // Warteschlange aufstellen
      this.boardingQueue = [...this.waiting[serving.index]];
    }
    if (!serving) {
      this.servingStop = null;
      // übrige Anwärter zurück in den Wartemodus
      for (const p of this.boardingQueue) {
        if (p.state === 'WALK_TO_DOOR') {
          p.state = 'WAIT';
          p.figure.setPose('stand');
        }
      }
      this.boardingQueue = [];
      if (this.currentBoarder && !this.currentBoarder.aboard) {
        this.currentBoarder.state = 'WAIT';
        this.currentBoarder = null;
      }
    }

    // ---------- Einstieg: einer nach dem anderen
    if (serving && !this.currentBoarder && this.boardingQueue.length > 0) {
      this.currentBoarder = this.boardingQueue.shift();
      this.currentBoarder.state = 'WALK_TO_DOOR';
    }

    // ---------- Wartende aktualisieren (winken bei Annäherung)
    const busPos = this.bus.body.position;
    this.route.stops.forEach((stop, i) => {
      const dBus = Math.hypot(busPos.x - stop.pos.x, busPos.z - stop.pos.z);
      for (const p of this.waiting[i]) {
        if (p.state === 'WAIT' && dBus < 60 && dBus > 14 && this.bus.speedKmh > 3) {
          p.figure.setPose('hail');
        } else if (p.state === 'WAIT') {
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
        _door.y = 0.13;
        if (cb.moveToward(_door, dt)) {
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
        // Ausstieg
        if (this.servingStop && this.servingStop.index === p.destIndex &&
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
          p.group.position.set(_world.x, 0.13, _world.z);
          p.aboard = false;
          p.state = 'WALK_AWAY';
          // Ziel: quer weg vom Bus
          const dir = new THREE.Vector3(this.rand.float(0.5, 1), 0, this.rand.float(-0.6, 0.6)).normalize();
          busGroup.localToWorld(dir.set(dir.x * 40 + 3, 0, p.group.position.z));
          p.target.set(_world.x + this.rand.float(10, 25), 0.13, _world.z + this.rand.float(-20, 20));
          this.aboard.splice(k, 1);
          this.leaving.push(p);
          this.bus.setPassengerCount(this.aboard.length);
        }
      }
      p.update(this.time);
    }

    // ---------- Aussteigende entfernen sich
    for (let k = this.leaving.length - 1; k >= 0; k--) {
      const p = this.leaving[k];
      if (p.moveToward(p.target, dt)) {
        this.scene.remove(p.group);
        this.leaving.splice(k, 1);
      } else {
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
