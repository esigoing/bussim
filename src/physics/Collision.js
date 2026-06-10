// Kollision Bus ↔ statische Welt: der Bus wird durch eine Kette von Kugeln
// angenähert (stabil und billig), die Welt durch achsenparallele Boxen
// (Gebäude, Laternen, Schilder). Auflösung als Impuls + Positionskorrektur.

import * as THREE from 'three';

const _sphereWorld = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _n = new THREE.Vector3();
const _vPoint = new THREE.Vector3();
const _impulse = new THREE.Vector3();

export class StaticAABB {
  constructor(minX, minZ, maxX, maxZ, height = 20) {
    this.minX = minX; this.minZ = minZ;
    this.maxX = maxX; this.maxZ = maxZ;
    this.height = height;
  }
}

export class Collision {
  constructor() {
    this.aabbs = [];
    // Grobgitter für schnelle Abfragen
    this.cellSize = 40;
    this.grid = new Map();
  }

  addAABB(aabb) {
    this.aabbs.push(aabb);
    const x0 = Math.floor(aabb.minX / this.cellSize), x1 = Math.floor(aabb.maxX / this.cellSize);
    const z0 = Math.floor(aabb.minZ / this.cellSize), z1 = Math.floor(aabb.maxZ / this.cellSize);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = gx * 10000 + gz;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(aabb);
      }
    }
  }

  _candidates(x, z) {
    const key = Math.floor(x / this.cellSize) * 10000 + Math.floor(z / this.cellSize);
    return this.grid.get(key);
  }

  // spheres: [{ local: Vector3, radius }] am Body
  resolve(body, spheres) {
    for (const s of spheres) {
      body.localPoint(s.local, _sphereWorld);
      const cands = this._candidates(_sphereWorld.x, _sphereWorld.z);
      if (!cands) continue;
      for (const box of cands) {
        if (_sphereWorld.y > box.height) continue;
        // Nächster Punkt der Box (2D in XZ, Y frei)
        _closest.set(
          Math.max(box.minX, Math.min(box.maxX, _sphereWorld.x)),
          _sphereWorld.y,
          Math.max(box.minZ, Math.min(box.maxZ, _sphereWorld.z))
        );
        const dx = _sphereWorld.x - _closest.x;
        const dz = _sphereWorld.z - _closest.z;
        const distSq = dx * dx + dz * dz;
        if (distSq >= s.radius * s.radius) continue;

        let dist = Math.sqrt(distSq);
        if (dist < 1e-6) {
          // Kugelzentrum in der Box: entlang kürzester Achse herausdrücken
          const pushXMin = _sphereWorld.x - box.minX, pushXMax = box.maxX - _sphereWorld.x;
          const pushZMin = _sphereWorld.z - box.minZ, pushZMax = box.maxZ - _sphereWorld.z;
          const minPush = Math.min(pushXMin, pushXMax, pushZMin, pushZMax);
          if (minPush === pushXMin) _n.set(-1, 0, 0);
          else if (minPush === pushXMax) _n.set(1, 0, 0);
          else if (minPush === pushZMin) _n.set(0, 0, -1);
          else _n.set(0, 0, 1);
          dist = -minPush;
        } else {
          _n.set(dx / dist, 0, dz / dist);
        }
        const penetration = s.radius - dist;

        // Positionskorrektur (sanft, gegen Tunneln)
        body.position.addScaledVector(_n, penetration * 0.4);

        // Impuls: Normalgeschwindigkeit am Kontaktpunkt killen
        body.velocityAt(_sphereWorld, _vPoint);
        const vn = _vPoint.dot(_n);
        if (vn < 0) {
          // effektive Masse am Punkt grob über Skalarfaktor (Rotation gedämpft)
          const j = -vn * body.mass * 0.6;
          _impulse.copy(_n).multiplyScalar(j);
          body.velocity.addScaledVector(_impulse, body.invMass);
          // leichtes Giermoment, damit Streifkollisionen den Bus drehen
          body.applyForce(_impulse.multiplyScalar(8), _sphereWorld);
        }
      }
    }
  }
}
