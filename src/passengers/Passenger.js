// Fahrgast-Zustandsmaschine:
// WAIT → HAIL → WALK_TO_DOOR → BOARD → AT_DRIVER (→ BUY_TICKET) →
// FIND_SEAT → SEATED → WALK_TO_EXIT → WALK_AWAY → GONE
// Draußen lebt die Figur im Weltraum, an Bord in Bus-Lokalkoordinaten.

import * as THREE from 'three';
import { HumanFigure } from './HumanFigure.js';

const BUS_FLOOR = -0.86;
const DOOR1_LOCAL = new THREE.Vector3(1.05, BUS_FLOOR, -4.85);
const DRIVER_POINT = new THREE.Vector3(0.18, BUS_FLOOR, -4.95);
const AISLE_X = 0;
const EXIT_DOORS = [new THREE.Vector3(1.05, BUS_FLOOR, 0), new THREE.Vector3(1.05, BUS_FLOOR, 3.7)];

const _tmp = new THREE.Vector3();

export class Passenger {
  // figureOpts: {detail, props, rainy} aus dem Grafik-Preset (WP-A4/E1)
  constructor(rand, stopIndex, destIndex, figureOpts = {}) {
    this.rand = rand;
    this.figure = new HumanFigure(rand, figureOpts);
    this.group = this.figure.group;
    this.state = 'WAIT';
    this.stopIndex = stopIndex;
    this.destIndex = destIndex;
    this.aboard = false;
    this.seatSlot = null;
    this.wantsTicket = rand.chance(0.3);
    this.walkPhase = 0;
    this.timer = 0;
    this.requestedStop = false;
    this.target = new THREE.Vector3();
    this.waypoints = [];
    this.speed = rand.float(1.0, 1.5);
  }

  // Bewegung Richtung Ziel (in der aktuellen Parent-Koordinate), true = angekommen
  moveToward(target, dt, speedMul = 1) {
    _tmp.subVectors(target, this.group.position);
    _tmp.y = 0;
    const dist = _tmp.length();
    const step = this.speed * speedMul * dt;
    if (dist <= step) {
      this.group.position.x = target.x;
      this.group.position.z = target.z;
      return true;
    }
    _tmp.normalize();
    this.group.position.addScaledVector(_tmp, step);
    // Blickrichtung
    this.group.rotation.y = Math.atan2(_tmp.x, _tmp.z);
    this.walkPhase += step * 4.2;
    this.figure.setPose('walk');
    return false;
  }

  follow(dt, speedMul = 1) {
    if (this.waypoints.length === 0) return true;
    if (this.moveToward(this.waypoints[0], dt, speedMul)) {
      this.waypoints.shift();
      return this.waypoints.length === 0;
    }
    return false;
  }

  update(time) {
    this.figure.update(time, this.walkPhase);
  }
}
