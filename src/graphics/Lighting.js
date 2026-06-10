// Sonnenlicht über CSM (Kaskaden-Schatten) + Hemisphären-Fülllicht.
// Nachts fällt die Sonne aus; ein schwacher Mond-Floor bleibt über die
// Hemisphäre erhalten. Straßenlampen-Pools verwaltet die Stadt (M8).

import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { lerp } from '../utils/Math3D.js';
import { setCSM } from './materials/MatLib.js';

export class Lighting {
  constructor(scene, camera, quality) {
    this.csm = new CSM({
      maxFar: quality.shadowMaxFar,
      cascades: quality.cascades,
      mode: 'practical',
      parent: scene,
      shadowMapSize: quality.shadowMapSize,
      lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(),
      camera,
      lightIntensity: 3.6,
      shadowBias: -0.0002,
    });
    this.csm.fade = true;
    setCSM(this.csm); // ab jetzt werden alle MatLib-Materialien CSM-fähig

    // PMREM-Environment liefert bereits das Himmels-Ambient — die Hemisphäre
    // ist nur noch ein schwacher Boden-Bounce + Mond-Floor.
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4438, 0.2);
    scene.add(this.hemi);

    this._sunColorDay = new THREE.Color(0xfff3e0);
    this._sunColorLow = new THREE.Color(0xff8c3a);
    this._tmpColor = new THREE.Color();
  }

  update(env) {
    // Richtung: CSM erwartet die Licht-RICHTUNG (von der Sonne weg)
    this.csm.lightDirection.copy(env.sunDir).negate().normalize();

    // Farbe über Elevation: weiß → warm bei tiefer Sonne
    const elev = Math.asin(Math.max(-1, Math.min(1, env.sunDir.y)));
    const lowness = 1 - Math.min(1, Math.max(0, elev / 0.35));
    this._tmpColor.copy(this._sunColorDay).lerp(this._sunColorLow, lowness * lowness);

    const intensity = env.sunFactor * 3.6;
    for (const light of this.csm.lights) {
      light.intensity = intensity;
      light.color.copy(this._tmpColor);
    }

    this.hemi.intensity = 0.04 + env.skyBrightness * lerp(0.18, 0.1, env.cloud);
    this.hemi.color.setHSL(0.6, lerp(0.35, 0.05, env.cloud), lerp(0.75, 0.5, env.night));

    this.csm.update();
  }

  onResize() {
    this.csm.updateFrustums();
  }
}
