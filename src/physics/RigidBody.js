// 6-DOF-Starrkörper, semi-implizites Euler bei 240 Hz.
// Kein gyroskopischer Term (Stabilität > Präzession — beim Bus irrelevant).

import * as THREE from 'three';

const _rel = new THREE.Vector3();
const _f = new THREE.Vector3();
const _wLocal = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _invQ = new THREE.Quaternion();

export class RigidBody {
  constructor(mass, inertiaDiag) {
    this.mass = mass;
    this.invMass = 1 / mass;
    this.inertia = inertiaDiag.clone();          // lokal, diagonal
    this.invInertia = new THREE.Vector3(1 / inertiaDiag.x, 1 / inertiaDiag.y, 1 / inertiaDiag.z);

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();  // Welt-Raum

    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();           // Welt-Raum

    this.linearDamping = 0.02;
    this.angularDamping = 0.06;

    // Für Render-Interpolation
    this.prevPosition = new THREE.Vector3();
    this.prevQuaternion = new THREE.Quaternion();
  }

  applyForce(force, worldPoint) {
    this.force.add(force);
    if (worldPoint) {
      _rel.subVectors(worldPoint, this.position);
      _f.crossVectors(_rel, force);
      this.torque.add(_f);
    }
  }

  applyTorque(t) {
    this.torque.add(t);
  }

  velocityAt(worldPoint, out) {
    _rel.subVectors(worldPoint, this.position);
    return out.crossVectors(this.angularVelocity, _rel).add(this.velocity);
  }

  // Lokale Richtungen in Welt
  localDir(localVec, out) {
    return out.copy(localVec).applyQuaternion(this.quaternion);
  }

  localPoint(localVec, out) {
    return out.copy(localVec).applyQuaternion(this.quaternion).add(this.position);
  }

  integrate(dt) {
    this.prevPosition.copy(this.position);
    this.prevQuaternion.copy(this.quaternion);

    // Linear
    this.velocity.addScaledVector(this.force, this.invMass * dt);
    this.velocity.multiplyScalar(Math.max(0, 1 - this.linearDamping * dt));
    this.position.addScaledVector(this.velocity, dt);

    // Angular: Drehmoment in Lokalraum, dort mit diagonalem Trägheitstensor
    _invQ.copy(this.quaternion).invert();
    _wLocal.copy(this.torque).applyQuaternion(_invQ);
    _wLocal.x *= this.invInertia.x;
    _wLocal.y *= this.invInertia.y;
    _wLocal.z *= this.invInertia.z;
    _wLocal.applyQuaternion(this.quaternion); // zurück in Welt
    this.angularVelocity.addScaledVector(_wLocal, dt);
    this.angularVelocity.multiplyScalar(Math.max(0, 1 - this.angularDamping * dt));

    // Quaternion-Integration: dq = 0.5 * ω * q
    _q.set(this.angularVelocity.x, this.angularVelocity.y, this.angularVelocity.z, 0);
    _q.multiply(this.quaternion);
    this.quaternion.x += 0.5 * _q.x * dt;
    this.quaternion.y += 0.5 * _q.y * dt;
    this.quaternion.z += 0.5 * _q.z * dt;
    this.quaternion.w += 0.5 * _q.w * dt;
    this.quaternion.normalize();

    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}
