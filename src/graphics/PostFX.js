// Post-Processing-Kette: Render → GTAO (optional) → Bloom → SMAA → Output.
// Bloom-Threshold liegt über 1.0 — nur HDR-Emissives (Ampeln, Scheinwerfer,
// erleuchtete Fenster) blühen, nicht die Szene.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.enabled = quality.bloom || quality.ao || quality.antialiasPass;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    if (quality.ao) {
      const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
      gtao.output = GTAOPass.OUTPUT.Default;
      this.composer.addPass(gtao);
      this.gtao = gtao;
    }

    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
        0.3,    // strength
        0.4,    // radius
        1.35    // threshold: nur echte HDR-Quellen (Ampeln, Lampen) blühen
      );
      this.composer.addPass(this.bloom);
    }

    this.composer.addPass(new OutputPass());

    if (quality.antialiasPass) {
      const smaa = new SMAAPass(
        window.innerWidth * renderer.getPixelRatio(),
        window.innerHeight * renderer.getPixelRatio()
      );
      this.composer.addPass(smaa);
    }
  }

  render(dt) {
    this.composer.render(dt);
  }

  onResize(w, h) {
    this.composer.setSize(w, h);
  }
}
