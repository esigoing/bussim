import * as THREE from 'three';

export function createRenderer(container, quality) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // AA macht der SMAA-Pass; Spiegel-Targets bleiben billig
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  container.appendChild(renderer.domElement);
  return renderer;
}
