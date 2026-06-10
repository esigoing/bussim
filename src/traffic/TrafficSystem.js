// Verkehrssystem: ~60 KI-Autos, drei prozedurale Karosserietypen als
// InstancedMesh (Lack mit per-Instanz-Farbe + dunkle Teile + Räder +
// Lichter). Der Bus wird als virtuelles Hindernis in den Graphen injiziert.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as Mat from '../graphics/materials/MatLib.js';
import { CarAI } from './CarAI.js';

const CAR_COUNT = 60;

const PAINT_COLORS = [
  0xc8cacc, 0x1a1c20, 0x7a8088, 0x8f1f24, 0x274a73, 0x3e5e34,
  0xd9d4c8, 0x52555a, 0x96642e, 0xe8e8e8,
];

// Karosserietypen: [Lack-Geometrie, Dunkel-Geometrie (Fenster etc.)]
function makeBodyType(kind) {
  const paint = [];
  const dark = [];
  if (kind === 'sedan') {
    let g = new RoundedBoxGeometry(1.8, 0.55, 4.4, 2, 0.12);
    g.translate(0, 0.55, 0);
    paint.push(g);
    g = new RoundedBoxGeometry(1.65, 0.5, 2.2, 2, 0.15);
    g.translate(0, 1.05, 0.25);
    paint.push(g);
    const w = new RoundedBoxGeometry(1.68, 0.4, 2.0, 2, 0.1);
    w.translate(0, 1.08, 0.25);
    dark.push(w);
  } else if (kind === 'hatch') {
    let g = new RoundedBoxGeometry(1.75, 0.55, 3.9, 2, 0.12);
    g.translate(0, 0.53, 0);
    paint.push(g);
    g = new RoundedBoxGeometry(1.6, 0.52, 2.4, 2, 0.16);
    g.translate(0, 1.02, 0.45);
    paint.push(g);
    const w = new RoundedBoxGeometry(1.63, 0.42, 2.25, 2, 0.1);
    w.translate(0, 1.05, 0.45);
    dark.push(w);
  } else { // van
    const g = new RoundedBoxGeometry(1.95, 1.5, 4.9, 2, 0.18);
    g.translate(0, 1.05, 0);
    paint.push(g);
    const w = new RoundedBoxGeometry(1.98, 0.45, 3.2, 2, 0.1);
    w.translate(0, 1.45, -0.3);
    dark.push(w);
  }
  return { paint: mergeGeometries(paint), dark: mergeGeometries(dark) };
}

export class TrafficSystem {
  constructor({ graph, rand, parent }) {
    this.graph = graph;
    this.rand = rand;
    this.cars = [];
    this.occupancy = new Map();
    this.group = new THREE.Group();
    parent.add(this.group);

    // KI-Autos auf zufälligen Lane-Kanten verteilen
    const lanes = graph.edges.filter((e) => e.type === 'lane' && e.length > 30);
    for (let k = 0; k < CAR_COUNT; k++) {
      const edge = rand.pick(lanes);
      const car = new CarAI(edge, rand.float(5, edge.length - 5), rand.fork(k));
      car.typeIdx = rand.int(0, 2);
      car.colorIdx = rand.int(0, PAINT_COLORS.length - 1);
      car.v = rand.float(3, 9);
      this.cars.push(car);
    }

    // --- Instanz-Meshes
    this.types = ['sedan', 'hatch', 'van'].map((kind, idx) => {
      const { paint, dark } = makeBodyType(kind);
      const count = this.cars.filter((c) => c.typeIdx === idx).length || 1;
      const paintMat = Mat.phys({
        color: 0xffffff, roughness: 0.35, metalness: 0.2,
        clearcoat: 0.6, clearcoatRoughness: 0.2,
      }, { wet: true });
      const darkMat = Mat.std({ color: 0x14181c, roughness: 0.15, metalness: 0.2 });
      const paintInst = new THREE.InstancedMesh(paint, paintMat, count);
      const darkInst = new THREE.InstancedMesh(dark, darkMat, count);
      paintInst.castShadow = true;
      this.group.add(paintInst, darkInst);
      return { paintInst, darkInst, cursor: 0 };
    });

    // Räder: ein InstancedMesh für alle
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    this.wheelInst = new THREE.InstancedMesh(
      wheelGeo, Mat.std({ color: 0x18181a, roughness: 0.9 }), CAR_COUNT * 4
    );
    this.group.add(this.wheelInst);

    // Lichter: vorne weiß, hinten rot
    const lightGeo = new THREE.BoxGeometry(0.32, 0.12, 0.04);
    this.frontLightMat = new THREE.MeshStandardMaterial({
      color: 0x888888, emissive: 0xfff6d8, emissiveIntensity: 0,
    });
    this.rearLightMat = new THREE.MeshStandardMaterial({
      color: 0x440000, emissive: 0xff2515, emissiveIntensity: 0.4,
    });
    this.frontLights = new THREE.InstancedMesh(lightGeo, this.frontLightMat, CAR_COUNT * 2);
    this.rearLights = new THREE.InstancedMesh(lightGeo, this.rearLightMat, CAR_COUNT * 2);
    this.frontLights.castShadow = false;
    this.rearLights.castShadow = false;
    this.group.add(this.frontLights, this.rearLights);

    // Farben einmalig setzen
    const col = new THREE.Color();
    const typeCursors = [0, 0, 0];
    for (const car of this.cars) {
      const t = this.types[car.typeIdx];
      car.instanceIdx = typeCursors[car.typeIdx]++;
      col.setHex(PAINT_COLORS[car.colorIdx]);
      t.paintInst.setColorAt(car.instanceIdx, col);
    }
    for (const t of this.types) {
      if (t.paintInst.instanceColor) t.paintInst.instanceColor.needsUpdate = true;
    }

    // Scratch
    this._pos = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // busInfo: {edge, s, len, v} | null
  update(dt, busInfo, wetness, night) {
    // Belegungs-Map neu aufbauen
    this.occupancy.clear();
    for (const car of this.cars) {
      let arr = this.occupancy.get(car.edge.id);
      if (!arr) { arr = []; this.occupancy.set(car.edge.id, arr); }
      arr.push({ s: car.s, len: car.len, v: car.v, ref: car });
    }
    if (busInfo) {
      let arr = this.occupancy.get(busInfo.edge.id);
      if (!arr) { arr = []; this.occupancy.set(busInfo.edge.id, arr); }
      arr.push({ s: busInfo.s, len: busInfo.len, v: busInfo.v, ref: 'bus' });
    }

    // KI-Schritte + Matrizen
    for (const car of this.cars) {
      const alive = car.update(dt, this.occupancy, wetness);
      if (!alive || car.stuckTimer > 45) {
        this._respawn(car, busInfo);
      }

      car.edge.curve.sample(car.s, this._pos, this._tan);
      const yaw = Math.atan2(this._tan.x, this._tan.z);
      this._q.setFromAxisAngle(this._up, yaw + Math.PI);

      this._m.compose(this._pos, this._q, this._scale);
      const t = this.types[car.typeIdx];
      t.paintInst.setMatrixAt(car.instanceIdx, this._m);
      t.darkInst.setMatrixAt(car.instanceIdx, this._m);

      // Räder
      const carIdx = this.cars.indexOf(car); // stabil, kleine Anzahl
      for (let w = 0; w < 4; w++) {
        const lx = w % 2 === 0 ? -0.78 : 0.78;
        const lz = w < 2 ? -1.35 : 1.35;
        const off = new THREE.Vector3(lx, 0.32, lz).applyQuaternion(this._q);
        this._m.compose(
          this._pos.clone().add(off), this._q, this._scale
        );
        this.wheelInst.setMatrixAt(carIdx * 4 + w, this._m);
      }
      // Lichter
      for (let l = 0; l < 2; l++) {
        const lx = l === 0 ? -0.55 : 0.55;
        const offF = new THREE.Vector3(lx, 0.65, -2.1).applyQuaternion(this._q);
        this._m.compose(this._pos.clone().add(offF), this._q, this._scale);
        this.frontLights.setMatrixAt(carIdx * 2 + l, this._m);
        const offR = new THREE.Vector3(lx, 0.7, 2.1).applyQuaternion(this._q);
        this._m.compose(this._pos.clone().add(offR), this._q, this._scale);
        this.rearLights.setMatrixAt(carIdx * 2 + l, this._m);
      }
    }

    for (const t of this.types) {
      t.paintInst.instanceMatrix.needsUpdate = true;
      t.darkInst.instanceMatrix.needsUpdate = true;
      t.paintInst.computeBoundingSphere();
      t.darkInst.computeBoundingSphere();
    }
    this.wheelInst.instanceMatrix.needsUpdate = true;
    this.wheelInst.computeBoundingSphere();
    this.frontLights.instanceMatrix.needsUpdate = true;
    this.rearLights.instanceMatrix.needsUpdate = true;
    this.frontLights.computeBoundingSphere();
    this.rearLights.computeBoundingSphere();

    this.frontLightMat.emissiveIntensity = night > 0.2 ? 3.0 : 0;
    this.rearLightMat.emissiveIntensity = 0.3 + night * 1.2;
  }

  _respawn(car, busInfo) {
    const lanes = this.graph.edges.filter((e) => e.type === 'lane' && e.length > 30);
    for (let tries = 0; tries < 10; tries++) {
      const edge = this.rand.pick(lanes);
      const s = this.rand.float(5, edge.length - 5);
      // nicht direkt vor dem Bus spawnen
      if (busInfo && edge === busInfo.edge && Math.abs(s - busInfo.s) < 60) continue;
      const occ = this.occupancy.get(edge.id);
      if (occ && occ.some((o) => Math.abs(o.s - s) < 12)) continue;
      car.edge = edge;
      car.s = s;
      car.v = 5;
      car.nextEdge = car._pickNext();
      car.stuckTimer = 0;
      return;
    }
  }
}
