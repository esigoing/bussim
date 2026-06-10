// Zentrale Material-Erzeugung. Jedes Material läuft hier durch, damit
// CSM-Setup (Schatten-Kaskaden) und Nässe-Patch genau einmal und in der
// richtigen Reihenfolge passieren: erst csm.setupMaterial (überschreibt
// onBeforeCompile), dann der Wetness-Wrap.

import * as THREE from 'three';
import { patchWetness } from './Wetness.js';

const materials = [];
let csmInstance = null;

export function setCSM(csm) {
  csmInstance = csm;
  for (const { mat } of materials) csm.setupMaterial(mat);
}

function register(mat, opts) {
  if (csmInstance) csmInstance.setupMaterial(mat);
  if (opts.wet) patchWetness(mat, opts.wet === 'puddles');
  materials.push({ mat, opts });
  return mat;
}

// opts.wet: true = Glanz bei Nässe | 'puddles' = zusätzlich Pfützen (Straßen)
// envMapIntensity wird gedeckelt, damit das Himmels-IBL die Sonnenschatten
// nicht auswäscht (Standard 0.45, explizite Werte gewinnen).
export function std(params, opts = {}) {
  if (params.envMapIntensity === undefined) params.envMapIntensity = 0.45;
  return register(new THREE.MeshStandardMaterial(params), opts);
}

export function phys(params, opts = {}) {
  if (params.envMapIntensity === undefined) params.envMapIntensity = 0.6;
  return register(new THREE.MeshPhysicalMaterial(params), opts);
}

export function forEachMaterial(fn) {
  for (const { mat } of materials) fn(mat);
}
