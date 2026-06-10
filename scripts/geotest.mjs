import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function test(name, geos) {
  const r = mergeGeometries(geos);
  console.log(name, r ? 'OK' : 'NULL', geos.map(g => `${g.type}:${g.index ? 'idx' : 'noidx'}`).join(' '));
}

// Sitz
const seat = new RoundedBoxGeometry(0.42, 0.08, 0.42, 2, 0.03);
const back = new RoundedBoxGeometry(0.42, 0.62, 0.07, 2, 0.03);
const legs = new THREE.BoxGeometry(0.36, 0.4, 0.05);
test('seat', [seat, back, legs]);

// Auto
test('car', [new RoundedBoxGeometry(1.8,0.55,4.4,2,0.12), new RoundedBoxGeometry(1.65,0.5,2.2,2,0.15)]);

// Krone
test('canopy', [new THREE.IcosahedronGeometry(1.5,1), new THREE.IcosahedronGeometry(1.1,1)]);

// Dach: Plane + Box
test('roof', [new THREE.PlaneGeometry(2,2), new THREE.BoxGeometry(1,1,1)]);

// groups?
console.log('rounded groups', new RoundedBoxGeometry(1,1,1,2,0.1).groups.length, 'box groups', new THREE.BoxGeometry(1,1,1).groups.length);
