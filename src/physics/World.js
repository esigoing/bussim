// Physik-Welt: Schwerkraft, Fahrzeug-Steps, Integration, statische Kollision.
// groundQuery liefert die Bodenhöhe (Straße/Bordstein) — Default: Ebene y=0.

import * as THREE from 'three';
import { Collision } from './Collision.js';

const GRAVITY = -9.81;
const _g = new THREE.Vector3();

export class World {
  constructor() {
    this.bodies = [];
    this.vehicles = [];
    this.collision = new Collision();
    this.groundQuery = () => 0;
  }

  addBody(body) {
    this.bodies.push(body);
  }

  addVehicle(vehicle) {
    this.vehicles.push(vehicle);
    vehicle.groundQuery = (x, z) => this.groundQuery(x, z);
  }

  step(dt) {
    for (const b of this.bodies) {
      _g.set(0, GRAVITY * b.mass, 0);
      b.applyForce(_g);
    }
    for (const v of this.vehicles) {
      v.step(dt);
    }
    for (const b of this.bodies) {
      b.integrate(dt);
      // NaN-Wächter: lieber Reset als eingefrorenes Spiel
      if (!Number.isFinite(b.position.x + b.position.y + b.position.z)) {
        console.error('Physik-NaN — Body wird zurückgesetzt');
        b.position.set(0, 2, 0);
        b.quaternion.identity();
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
      }
    }
    for (const v of this.vehicles) {
      if (v.collisionSpheres) this.collision.resolve(v.body, v.collisionSpheres);
    }
  }
}
