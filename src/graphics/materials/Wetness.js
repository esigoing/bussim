// Nasse-Straßen-Shading via onBeforeCompile-Patch auf MeshStandardMaterial.
// uWetness (global 0..1) senkt Roughness und dunkelt Albedo ab; Straßen
// bekommen zusätzlich FBM-Pfützen, in denen Roughness fast 0 wird —
// die Spiegelung kommt dann gratis aus dem PMREM-Environment.

import * as THREE from 'three';
import { fbm2 } from '../../utils/Noise.js';

const globalUniforms = {
  uWetness: { value: 0 },
};

let puddleTex = null;
function getPuddleTexture() {
  if (puddleTex) return puddleTex;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fbm2((x / size) * 6, (y / size) * 6, 4, 4242) * 255;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  puddleTex = new THREE.CanvasTexture(c);
  puddleTex.wrapS = puddleTex.wrapT = THREE.RepeatWrapping;
  return puddleTex;
}

export function setWetness(w) {
  globalUniforms.uWetness.value = w;
}

export function getWetness() {
  return globalUniforms.uWetness.value;
}

export function patchWetness(material, withPuddles) {
  const prev = material.onBeforeCompile; // CSM-Patch nicht verlieren
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uWetness = globalUniforms.uWetness;
    if (withPuddles) shader.uniforms.uPuddleTex = { value: getPuddleTexture() };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetWorldPos;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWetWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWetness;
        varying vec3 vWetWorldPos;
        ${withPuddles ? 'uniform sampler2D uPuddleTex;' : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float wet = uWetness;
          ${withPuddles ? `
          float puddleN = texture2D(uPuddleTex, vWetWorldPos.xz * 0.02).r;
          float puddle = smoothstep(0.55, 0.7, puddleN) * wet;
          roughnessFactor = mix(roughnessFactor,
                                mix(roughnessFactor * 0.35, 0.04, puddle), wet);
          ` : `
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, wet);
          `}
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float wetDarken = uWetness * 0.4;
          ${withPuddles ? `
          float puddleN2 = texture2D(uPuddleTex, vWetWorldPos.xz * 0.02).r;
          wetDarken += smoothstep(0.55, 0.7, puddleN2) * uWetness * 0.15;
          ` : ''}
          diffuseColor.rgb *= (1.0 - wetDarken);
        }`);
  };
  material.needsUpdate = true;
}
