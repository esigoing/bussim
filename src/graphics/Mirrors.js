// Drei Echtzeit-Spiegel (links außen, rechts außen, Innenspiegel auf den
// Fahrgastraum). Rückwärts gerichtete Kameras auf RenderTargets, horizontal
// gespiegelt. Round-robin: pro Frame wird höchstens ein Spiegel erneuert.
// Spiegelflächen liegen auf Layer 1 — Spiegelkameras rendern nur Layer 0,
// dadurch keine Spiegel-in-Spiegel-Rekursion. Regen liegt auf Layer 2.

import * as THREE from 'three';
import { DRIVER_EYE } from '../cockpit/Cockpit.js';

const CONFIGS = {
  left: {
    size: [0.2, 0.42],
    rtAspect: 0.55,
    fov: 22,
    // weniger nach außen gedreht: mehr eigene Fahrbahn/Busflanke im Bild,
    // weniger Gehweg der Gegenseite (Spieltest-Feedback)
    rotY: Math.PI - 0.14,
    rotX: -0.03,
    planeRotY: -0.28,
  },
  right: {
    size: [0.2, 0.42],
    rtAspect: 0.55,
    fov: 22,
    // etwas weniger nach außen gedreht (Spieltest-Feedback)
    rotY: Math.PI + 0.22,
    rotX: -0.03,
    planeRotY: 0.28,
  },
  interior: {
    size: [0.42, 0.24],
    rtAspect: 1.7,
    fov: 65,
    rotY: Math.PI + 0.0,
    rotX: -0.42,
    planeRotY: 0.25,
  },
};

export class Mirrors {
  constructor(busGroup, anchors, quality) {
    this.mirrors = [];
    this._cursor = 0;
    this._frame = 0;
    this.every = quality.mirrorEvery;

    for (const key of ['left', 'right', 'interior']) {
      const cfg = CONFIGS[key];
      const anchor = anchors[key];
      const res = quality.mirrorRes;
      const rt = new THREE.WebGLRenderTarget(
        Math.round(res * cfg.rtAspect), res,
        { generateMipmaps: false }
      );
      rt.texture.colorSpace = THREE.SRGBColorSpace;

      const cam = new THREE.PerspectiveCamera(cfg.fov, cfg.rtAspect, 0.4, 250);
      cam.rotation.order = 'YXZ';
      cam.position.copy(anchor.pos);
      cam.rotation.y = cfg.rotY;
      cam.rotation.x = cfg.rotX;
      cam.layers.set(0);
      busGroup.add(cam);

      const mat = new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: true });
      // Horizontal spiegeln
      rt.texture.wrapS = THREE.ClampToEdgeWrapping;
      rt.texture.repeat.x = -1;
      rt.texture.offset.x = 1;

      // Spiegelfläche exakt aufs Fahrerauge ausrichten (Bus-Lokalraum) —
      // damit ist sie aus Fahrersicht garantiert sichtbar.
      const toEye = DRIVER_EYE.clone().sub(anchor.pos).normalize();
      const faceQuat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), toEye
      );

      const plane = new THREE.Mesh(new THREE.PlaneGeometry(cfg.size[0], cfg.size[1]), mat);
      plane.position.copy(anchor.pos);
      plane.quaternion.copy(faceQuat);
      plane.layers.set(1);
      busGroup.add(plane);

      // Rahmen als Rückwand: 4 mm hinter der Fläche (vom Fahrer weg)
      const frame = new THREE.Mesh(
        new THREE.PlaneGeometry(cfg.size[0] + 0.03, cfg.size[1] + 0.03),
        new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.5, side: THREE.DoubleSide })
      );
      frame.position.copy(anchor.pos).addScaledVector(toEye, -0.004);
      frame.quaternion.copy(faceQuat);
      busGroup.add(frame);

      this.mirrors.push({ rt, cam, plane });
    }
  }

  update(renderer, scene) {
    this._frame++;
    if (this._frame % this.every !== 0) return;
    const m = this.mirrors[this._cursor];
    this._cursor = (this._cursor + 1) % this.mirrors.length;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(m.rt);
    renderer.render(scene, m.cam);
    renderer.setRenderTarget(prevTarget);
  }
}
