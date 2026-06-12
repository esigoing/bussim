// Verkehrssystem: konfigurierbare Anzahl KI-Autos, fünf prozedurale
// Karosserietypen als InstancedMesh (Lack mit per-Instanz-Farbe + dunkle
// Teile + helle Detailteile + Räder + Lichter). Der Bus wird als
// virtuelles Hindernis in den Graphen injiziert.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as Mat from '../graphics/materials/MatLib.js';
import { CarAI } from './CarAI.js';

const PAINT_COLORS = [
  0xc8cacc, 0x1a1c20, 0x7a8088, 0x8f1f24, 0x274a73, 0x3e5e34,
  0xd9d4c8, 0x52555a, 0x96642e, 0xe8e8e8,
];

// Fahrzeugtypen: Auswahlgewicht, Länge sowie Rad-/Licht-Offsets pro Typ
// (vorher für alle Typen identisch — beim kurzen Hatch schwebten die
// Lichter, beim langen Van saßen sie zu weit innen).
const CAR_TYPES = [
  { kind: 'sedan', len: 4.4, weight: 0.30, wheelX: 0.78, wheelZ: [-1.45, 1.40], wheelR: 0.32, lightX: 0.55, lightZF: -2.18, lightZR: 2.18, lightYF: 0.62, lightYR: 0.70 },
  { kind: 'hatch', len: 3.9, weight: 0.25, wheelX: 0.74, wheelZ: [-1.25, 1.25], wheelR: 0.30, lightX: 0.52, lightZF: -1.93, lightZR: 1.93, lightYF: 0.60, lightYR: 0.72 },
  { kind: 'van', len: 4.9, weight: 0.15, wheelX: 0.82, wheelZ: [-1.55, 1.55], wheelR: 0.34, lightX: 0.60, lightZF: -2.43, lightZR: 2.43, lightYF: 0.66, lightYR: 0.80 },
  { kind: 'suv', len: 4.6, weight: 0.20, wheelX: 0.80, wheelZ: [-1.42, 1.42], wheelR: 0.37, lightX: 0.57, lightZF: -2.28, lightZR: 2.28, lightYF: 0.74, lightYR: 0.82 },
  { kind: 'boxtruck', len: 5.6, weight: 0.10, wheelX: 0.84, wheelZ: [-1.90, 1.60], wheelR: 0.37, lightX: 0.62, lightZF: -2.78, lightZR: 2.78, lightYF: 0.70, lightYR: 0.90 },
];

// Gewichtete Typauswahl (weights summieren sich zu 1)
function pickTypeIdx(rand) {
  let r = rand.next();
  for (let i = 0; i < CAR_TYPES.length; i++) {
    r -= CAR_TYPES[i].weight;
    if (r <= 0) return i;
  }
  return CAR_TYPES.length - 1;
}

// Gemeinsame Anbauteile aller Typen: Stoßfänger vorn+hinten, Kühlergrill,
// Kennzeichen. Positionen aus der Typ-Konfiguration abgeleitet.
function addCommonParts(t, bodyW, dark, detail) {
  for (const sign of [-1, 1]) {
    // Stoßfänger (Rundung 0.07, damit das Kennzeichen oben herausschaut)
    const b = new RoundedBoxGeometry(bodyW + 0.04, 0.18, 0.28, 2, 0.07);
    b.translate(0, 0.35, sign * (t.len / 2 - 0.10));
    dark.push(b);
    // Kennzeichen
    const p = new THREE.BoxGeometry(0.36, 0.11, 0.015);
    p.translate(0, 0.42, sign * (t.len / 2 + 0.02));
    detail.push(p);
  }
  // Kühlergrill zwischen den Scheinwerfern, ragt leicht aus der Front
  const grill = new THREE.BoxGeometry(t.lightX * 2 - 0.44, 0.16, 0.06);
  grill.translate(0, t.lightYF, t.lightZF);
  dark.push(grill);
}

// Karosserietypen: [Lack, Dunkel (Fenster/Stoßfänger), Detail (Kennzeichen,
// Reling, Kofferaufbau)]. Glashaus-Säulen entstehen wie bisher durch ein
// leicht größeres dunkles Geo, das seitlich aus dem Lack ragt.
function makeBodyType(t) {
  const paint = [];
  const dark = [];
  const detail = [];
  if (t.kind === 'sedan') {
    let g = new RoundedBoxGeometry(1.8, 0.55, 4.4, 2, 0.12);
    g.translate(0, 0.55, 0);
    paint.push(g);
    g = new RoundedBoxGeometry(1.65, 0.5, 2.2, 2, 0.15);
    g.translate(0, 1.05, 0.25);
    paint.push(g);
    const w = new RoundedBoxGeometry(1.68, 0.4, 2.0, 2, 0.1);
    w.translate(0, 1.08, 0.25);
    dark.push(w);
    addCommonParts(t, 1.8, dark, detail);
  } else if (t.kind === 'hatch') {
    let g = new RoundedBoxGeometry(1.75, 0.55, 3.9, 2, 0.12);
    g.translate(0, 0.53, 0);
    paint.push(g);
    g = new RoundedBoxGeometry(1.6, 0.52, 2.4, 2, 0.16);
    g.translate(0, 1.02, 0.45);
    paint.push(g);
    const w = new RoundedBoxGeometry(1.63, 0.42, 2.25, 2, 0.1);
    w.translate(0, 1.05, 0.45);
    dark.push(w);
    addCommonParts(t, 1.75, dark, detail);
  } else if (t.kind === 'van') {
    const g = new RoundedBoxGeometry(1.95, 1.5, 4.9, 2, 0.18);
    g.translate(0, 1.05, 0);
    paint.push(g);
    const w = new RoundedBoxGeometry(1.98, 0.45, 3.2, 2, 0.1);
    w.translate(0, 1.45, -0.3);
    dark.push(w);
    addCommonParts(t, 1.95, dark, detail);
  } else if (t.kind === 'suv') {
    // höherer Aufbau mit größerer Bodenfreiheit
    let g = new RoundedBoxGeometry(1.85, 0.75, 4.6, 2, 0.14);
    g.translate(0, 0.72, 0);
    paint.push(g);
    g = new RoundedBoxGeometry(1.7, 0.55, 2.6, 2, 0.15);
    g.translate(0, 1.32, 0.15);
    paint.push(g);
    const w = new RoundedBoxGeometry(1.73, 0.45, 2.45, 2, 0.1);
    w.translate(0, 1.35, 0.15);
    dark.push(w);
    // Dachreling (Detail-Material wirkt wie Alu)
    for (const sx of [-1, 1]) {
      const rail = new THREE.BoxGeometry(0.05, 0.06, 2.1);
      rail.translate(sx * 0.66, 1.63, 0.15);
      detail.push(rail);
    }
    addCommonParts(t, 1.85, dark, detail);
  } else { // boxtruck
    // Fahrerkabine (Lack)
    const g = new RoundedBoxGeometry(1.95, 1.35, 2.0, 2, 0.12);
    g.translate(0, 1.05, -1.78);
    paint.push(g);
    // Chassis-Rahmen unter Kabine und Koffer
    const fr = new THREE.BoxGeometry(1.8, 0.32, 5.2);
    fr.translate(0, 0.42, 0.05);
    dark.push(fr);
    // Heckportal als Träger für Rückleuchten und Kennzeichen
    const rear = new THREE.BoxGeometry(1.9, 0.85, 0.14);
    rear.translate(0, 0.6, 2.7);
    dark.push(rear);
    // Windschutz + Seitenscheiben: leicht breiter/länger als die Kabine
    const w = new RoundedBoxGeometry(1.98, 0.55, 1.4, 2, 0.1);
    w.translate(0, 1.38, -2.13);
    dark.push(w);
    // heller Kofferaufbau
    const box = new THREE.BoxGeometry(2.0, 1.85, 3.3);
    box.translate(0, 1.3, 0.75);
    detail.push(box);
    addCommonParts(t, 1.95, dark, detail);
  }
  // RoundedBox ist nicht indiziert, Box schon — vor dem Merge vereinheitlichen
  const norm = (arr) => arr.map((g) => (g.index ? g.toNonIndexed() : g));
  return {
    paint: mergeGeometries(norm(paint)),
    dark: mergeGeometries(norm(dark)),
    detail: mergeGeometries(norm(detail)),
  };
}

export class TrafficSystem {
  constructor({ graph, rand, parent, count = 60 }) {
    this.graph = graph;
    this.rand = rand;
    this.count = count;
    this.cars = [];
    this.occupancy = new Map();
    this.group = new THREE.Group();
    parent.add(this.group);

    // KI-Autos auf zufälligen Lane-Kanten verteilen
    const lanes = graph.edges.filter((e) => e.type === 'lane' && e.length > 30);
    for (let k = 0; k < count; k++) {
      const edge = rand.pick(lanes);
      const typeIdx = pickTypeIdx(rand);
      const car = new CarAI(
        edge, rand.float(5, edge.length - 5), rand.fork(k), CAR_TYPES[typeIdx].len
      );
      car.typeIdx = typeIdx;
      car.colorIdx = rand.int(0, PAINT_COLORS.length - 1);
      car.v = rand.float(3, 9);
      this.cars.push(car);
    }

    // --- Instanz-Meshes (geteilte Materialien über alle Typen)
    const paintMat = Mat.phys({
      color: 0xffffff, roughness: 0.35, metalness: 0.2,
      clearcoat: 0.6, clearcoatRoughness: 0.2,
    }, { wet: true });
    const darkMat = Mat.std({ color: 0x14181c, roughness: 0.15, metalness: 0.2 });
    const detailMat = Mat.std({ color: 0xd6d6d2, roughness: 0.4, metalness: 0.5 });
    this.types = CAR_TYPES.map((cfg, idx) => {
      const { paint, dark, detail } = makeBodyType(cfg);
      const n = this.cars.filter((c) => c.typeIdx === idx).length || 1;
      const paintInst = new THREE.InstancedMesh(paint, paintMat, n);
      const darkInst = new THREE.InstancedMesh(dark, darkMat, n);
      const detailInst = new THREE.InstancedMesh(detail, detailMat, n);
      paintInst.castShadow = true;
      detailInst.castShadow = false; // Kleinteile
      this.group.add(paintInst, darkInst, detailInst);
      return { cfg, paintInst, darkInst, detailInst, cursor: 0 };
    });

    // Räder: ein InstancedMesh für alle; Typgrößen via Instanz-Scale
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    this.wheelInst = new THREE.InstancedMesh(
      wheelGeo, Mat.std({ color: 0x18181a, roughness: 0.9 }), count * 4
    );
    this.group.add(this.wheelInst);

    // Lichter: vorne weiß, hinten rot (0.06 tief → ragen 0.01 aus der
    // Karosserie und verhindern Z-Fighting mit der Frontfläche)
    const lightGeo = new THREE.BoxGeometry(0.32, 0.12, 0.06);
    this.frontLightMat = new THREE.MeshStandardMaterial({
      color: 0x888888, emissive: 0xfff6d8, emissiveIntensity: 0,
    });
    this.rearLightMat = new THREE.MeshStandardMaterial({
      color: 0x440000, emissive: 0xff2515, emissiveIntensity: 0.4,
    });
    this.frontLights = new THREE.InstancedMesh(lightGeo, this.frontLightMat, count * 2);
    this.rearLights = new THREE.InstancedMesh(lightGeo, this.rearLightMat, count * 2);
    this.frontLights.castShadow = false;
    this.rearLights.castShadow = false;
    this.group.add(this.frontLights, this.rearLights);

    // Farben einmalig setzen
    const col = new THREE.Color();
    const typeCursors = new Array(this.types.length).fill(0);
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
    this._euler = new THREE.Euler();
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
    for (let carIdx = 0; carIdx < this.cars.length; carIdx++) {
      const car = this.cars[carIdx];
      const alive = car.update(dt, this.occupancy, wetness);
      if (!alive || car.stuckTimer > 45) {
        this._respawn(car, busInfo);
      }

      car.edge.curve.sample(car.s, this._pos, this._tan);
      const yaw = Math.atan2(this._tan.x, this._tan.z);
      // Steigung: Nase folgt der Fahrbahn (sanfte Hügel)
      const horiz = Math.hypot(this._tan.x, this._tan.z);
      const pitch = Math.atan2(this._tan.y, Math.max(horiz, 1e-4));
      this._euler.set(pitch, yaw + Math.PI, 0, 'YXZ');
      this._q.setFromEuler(this._euler);

      this._m.compose(this._pos, this._q, this._scale);
      const t = this.types[car.typeIdx];
      const cfg = t.cfg;
      t.paintInst.setMatrixAt(car.instanceIdx, this._m);
      t.darkInst.setMatrixAt(car.instanceIdx, this._m);
      t.detailInst.setMatrixAt(car.instanceIdx, this._m);

      // Räder: Position und Radius aus der Typ-Konfig, Radius via Scale
      const rScale = cfg.wheelR / 0.32;
      for (let w = 0; w < 4; w++) {
        const lx = w % 2 === 0 ? -cfg.wheelX : cfg.wheelX;
        const lz = w < 2 ? cfg.wheelZ[0] : cfg.wheelZ[1];
        const off = new THREE.Vector3(lx, cfg.wheelR, lz).applyQuaternion(this._q);
        this._scale.set(1, rScale, rScale);
        this._m.compose(
          this._pos.clone().add(off), this._q, this._scale
        );
        this.wheelInst.setMatrixAt(carIdx * 4 + w, this._m);
      }
      this._scale.set(1, 1, 1); // für Karosserie/Lichter zurücksetzen

      // Lichter: Offsets aus der Typ-Konfig
      for (let l = 0; l < 2; l++) {
        const lx = l === 0 ? -cfg.lightX : cfg.lightX;
        const offF = new THREE.Vector3(lx, cfg.lightYF, cfg.lightZF).applyQuaternion(this._q);
        this._m.compose(this._pos.clone().add(offF), this._q, this._scale);
        this.frontLights.setMatrixAt(carIdx * 2 + l, this._m);
        const offR = new THREE.Vector3(lx, cfg.lightYR, cfg.lightZR).applyQuaternion(this._q);
        this._m.compose(this._pos.clone().add(offR), this._q, this._scale);
        this.rearLights.setMatrixAt(carIdx * 2 + l, this._m);
      }
    }

    for (const t of this.types) {
      t.paintInst.instanceMatrix.needsUpdate = true;
      t.darkInst.instanceMatrix.needsUpdate = true;
      t.detailInst.instanceMatrix.needsUpdate = true;
      t.paintInst.computeBoundingSphere();
      t.darkInst.computeBoundingSphere();
      t.detailInst.computeBoundingSphere();
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
