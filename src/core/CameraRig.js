// Kameraführung: F1 Cockpit (frei umsehen per Rechtsklick-Drag),
// F2 Verfolger, F3 Außenansicht vorn, F4 Fahrgastraum.

import * as THREE from 'three';
import { DRIVER_EYE } from '../cockpit/Cockpit.js';
import { damp } from '../utils/Math3D.js';

const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const CABIN_EYE = new THREE.Vector3(0.45, 0.75, 2.8);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'cockpit';
    this._chasePos = new THREE.Vector3(0, 5, 20);
  }

  get isInterior() {
    return this.mode === 'cockpit' || this.mode === 'cabin';
  }

  setMode(m) {
    this.mode = m;
  }

  update(dt, busGroup, input) {
    const cam = this.camera;

    if (this.mode === 'cockpit' || this.mode === 'cabin') {
      // Beide Innenkameras blicken nach vorn (-z); die Fahrgastkamera
      // sitzt hinten im Bus und schaut durch den Gang zum Fahrer.
      const eye = this.mode === 'cockpit' ? DRIVER_EYE : CABIN_EYE;
      busGroup.localToWorld(_pos.copy(eye));
      cam.position.copy(_pos);
      _qYaw.setFromAxisAngle(Y_AXIS, input.lookYaw);
      _qPitch.setFromAxisAngle(X_AXIS, input.lookPitch);
      cam.quaternion.copy(busGroup.quaternion).multiply(_qYaw).multiply(_qPitch);
      return;
    }

    if (this.mode === 'chase') {
      busGroup.localToWorld(_pos.set(0, 4.6, 17));
      this._chasePos.x = damp(this._chasePos.x, _pos.x, 5, dt);
      this._chasePos.y = damp(this._chasePos.y, Math.max(_pos.y, 2), 5, dt);
      this._chasePos.z = damp(this._chasePos.z, _pos.z, 5, dt);
      cam.position.copy(this._chasePos);
      busGroup.localToWorld(_target.set(0, 1.5, 0));
      cam.lookAt(_target);
      return;
    }

    // 'front': Außenansicht schräg vorn rechts
    busGroup.localToWorld(_pos.set(7.5, 3.0, -11));
    cam.position.copy(_pos);
    busGroup.localToWorld(_target.set(0, 1.2, -2));
    cam.lookAt(_target);
  }
}
