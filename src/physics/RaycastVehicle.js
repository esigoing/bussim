// Raycast-Vehicle: Federung als Ray pro Rad, Reifenkräfte aus Pacejka.
// Läuft im 240-Hz-Substep. Alle Scratch-Vektoren auf Modulebene (kein GC).

import * as THREE from 'three';
import { tireForces } from './Tire.js';
import { clamp } from '../utils/Math3D.js';

const _mount = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _fwdLocal = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _force = new THREE.Vector3();
const _liftPoint = new THREE.Vector3();
const _tire = { fx: 0, fy: 0 };
const LOCAL_DOWN = new THREE.Vector3(0, -1, 0);

export class Wheel {
  constructor({ localPos, radius, restLength, stiffness, dampBump, dampRebound, steered, driven, maxForce }) {
    this.localPos = localPos;
    this.radius = radius;
    this.restLength = restLength;
    this.restLengthBase = restLength;   // Kneeling verschiebt restLength
    this.stiffness = stiffness;
    this.dampBump = dampBump;
    this.dampRebound = dampRebound;
    this.steered = steered;
    this.driven = driven;
    this.maxForce = maxForce;

    this.steerAngle = 0;       // rad, >0 = links (Rotation um +Y)
    this.driveTorque = 0;      // Nm
    this.brakeTorque = 0;      // Nm, >= 0
    this.inertia = 14;         // kg·m² (Zwillingsbereifung hinten eingerechnet)

    // Zustand
    this.omega = 0;            // rad/s
    this.spinAngle = 0;
    this.compression = 0;
    this.onGround = false;
    this.Fz = 0;
    this.slipRatio = 0;
    this.slipAngle = 0;
    this.worldCenter = new THREE.Vector3();
    this.worldFwd = new THREE.Vector3(0, 0, -1);
  }
}

export class RaycastVehicle {
  constructor(body, wheels, groundQuery) {
    this.body = body;
    this.wheels = wheels;
    this.groundQuery = groundQuery; // (x, z) => Bodenhöhe; Stadt ist eben, Normal = +Y
    this.muSurface = 0.85;
  }

  step(dt) {
    const body = this.body;
    body.localDir(LOCAL_DOWN, _rayDir);

    // Bus fast auf dem Dach → keine Radkräfte (verhindert Explosion)
    if (_rayDir.y > -0.3) return;
    _up.copy(_rayDir).negate();

    for (const w of this.wheels) {
      body.localPoint(w.localPos, _mount);
      const groundH = this.groundQuery(_mount.x, _mount.z);
      const t = (_mount.y - groundH) / -_rayDir.y; // Distanz Mount→Boden entlang Ray
      const maxLen = w.restLength + w.radius;

      let fxRoad = 0;
      if (t >= maxLen || t < 0) {
        w.onGround = false;
        w.compression = 0;
        w.Fz = 0;
        w.slipRatio = 0;
        w.slipAngle = 0;
        w.worldCenter.copy(_mount).addScaledVector(_rayDir, w.restLength);
      } else {
        w.onGround = true;
        const x = clamp(maxLen - t, 0, w.restLength);
        _contact.copy(_mount).addScaledVector(_rayDir, t);

        // Einfederungsgeschwindigkeit: Kontaktpunkt bewegt sich Richtung Boden → Bump
        body.velocityAt(_contact, _vC);
        const compVel = _vC.dot(_rayDir);
        const c = compVel > 0 ? w.dampBump : w.dampRebound;
        const Fsusp = clamp(w.stiffness * x + c * compVel, 0, w.maxForce);
        w.compression = x;
        w.Fz = Fsusp;

        // Federkraft (vertikal — Angriffshöhe ist für Rollmoment irrelevant)
        _force.copy(_up).multiplyScalar(Fsusp);
        body.applyForce(_force, _mount);

        // Rad-Vorwärtsrichtung mit Lenkwinkel (Rotation um lokale +Y)
        const a = w.steerAngle;
        _fwdLocal.set(-Math.sin(a), 0, -Math.cos(a));
        body.localDir(_fwdLocal, _fwd);
        _fwd.y = 0;
        if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
        _fwd.normalize();
        _side.set(-_fwd.z, 0, _fwd.x); // cross(+Y, fwd)

        const vLong = _vC.x * _fwd.x + _vC.z * _fwd.z;
        const vLat = _vC.x * _side.x + _vC.z * _side.z;
        const denom = Math.max(Math.abs(vLong), 0.5);

        w.slipRatio = clamp((w.omega * w.radius - vLong) / denom, -3, 3);
        w.slipAngle = clamp(Math.atan2(vLat, denom), -1.2, 1.2);

        tireForces(Fsusp, w.slipRatio, w.slipAngle, this.muSurface, _tire);
        fxRoad = _tire.fx;

        // Querkraft etwas über dem Kontakt ansetzen → gedämpfter, glaubhafter Roll
        _liftPoint.copy(_contact).addScaledVector(_up, 0.35);
        _force.set(
          _fwd.x * _tire.fx + _side.x * _tire.fy,
          0,
          _fwd.z * _tire.fx + _side.z * _tire.fy
        );
        body.applyForce(_force, _liftPoint);

        w.worldCenter.copy(_mount).addScaledVector(_rayDir, Math.max(0, t - w.radius));
        w.worldFwd.copy(_fwd);
      }

      // --- Raddrehung
      // Antrieb + Fahrbahn-Rückwirkung
      w.omega += ((w.driveTorque - fxRoad * w.radius) / w.inertia) * dt;
      // Bremse als Reibmoment: zieht ω Richtung 0, kann das Rad komplett festhalten
      const brakeDeltaOmega = (w.brakeTorque / w.inertia) * dt;
      if (Math.abs(w.omega) <= brakeDeltaOmega) {
        w.omega = 0;
      } else {
        w.omega -= Math.sign(w.omega) * brakeDeltaOmega;
      }

      w.spinAngle += w.omega * dt;
      if (Math.abs(w.spinAngle) > 1e4) w.spinAngle %= (2 * Math.PI);
    }
  }
}
