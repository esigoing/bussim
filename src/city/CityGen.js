// Stadt-Orchestrierung: perturbiertes 9×9-Raster über ~1,1×1,1 km,
// Zonierung (Zentrum/Mittel/Rand), Parks, gelöschte Nebenstraßen,
// Straßennetz + Gebäude + Props + Natur + Ampeln + Buslinie.

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { RoadNetwork } from './RoadNetwork.js';
import { Buildings } from './Buildings.js';
import { Props } from './Props.js';
import { Nature } from './Nature.js';
import { BusRoute } from './BusRoute.js';
import { TrafficLights } from './TrafficLights.js';
import { StaticAABB } from '../physics/Collision.js';
import { concreteTextures, grassTextures } from '../graphics/materials/TextureGen.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const N_LINES = 9;
const AVENUE = 4;            // mittlere Linie = Allee
const HALF_STREET = 3.5;
const HALF_AVENUE = 6.75;
const ROUTE_RECT = { i0: 2, j0: 2, i1: 6, j1: 6 };

export class CityGen {
  constructor({ rand, collision }) {
    this.group = new THREE.Group();
    this.rand = rand;

    // --- Rasterlinien mit Jitter
    const span = 1100;
    const makeLines = (r) => {
      const lines = [];
      for (let k = 0; k < N_LINES; k++) {
        const base = -span / 2 + (k / (N_LINES - 1)) * span;
        lines.push(base + (k === 0 || k === N_LINES - 1 ? 0 : r.float(-14, 14)));
      }
      return lines;
    };
    const xs = makeLines(rand.fork(11));
    const zs = makeLines(rand.fork(22));
    const halfX = xs.map((_, i) => (i === AVENUE ? HALF_AVENUE : HALF_STREET));
    const halfZ = zs.map((_, j) => (j === AVENUE ? HALF_AVENUE : HALF_STREET));

    // --- Segment-Existenz: ~10 % innere Nebenstraßen löschen
    const segNS = xs.map(() => new Array(N_LINES - 1).fill(true));
    const segEW = zs.map(() => new Array(N_LINES - 1).fill(true));
    const onRoute = (axis, line, seg) => {
      const { i0, j0, i1, j1 } = ROUTE_RECT;
      if (axis === 'NS') return (line === i0 || line === i1) && seg >= j0 && seg < j1;
      return (line === j0 || line === j1) && seg >= i0 && seg < i1;
    };
    const delRand = rand.fork(33);
    for (let n = 0; n < 9; n++) {
      const axis = delRand.chance(0.5) ? 'NS' : 'EW';
      const line = delRand.int(1, N_LINES - 2);
      const seg = delRand.int(1, N_LINES - 3);
      if (line === AVENUE) continue;
      if (onRoute(axis, line, seg)) continue;
      if (axis === 'NS') segNS[line][seg] = false;
      else segEW[line][seg] = false;
    }

    // --- Signalisierte Kreuzungen: alles, was die Allee kreuzt + Routen-Ecken
    const signalized = new Set();
    for (let k = 0; k < N_LINES; k++) {
      signalized.add(`${AVENUE},${k}`);
      signalized.add(`${k},${AVENUE}`);
    }
    for (const [i, j] of [[2, 2], [2, 6], [6, 2], [6, 6]]) signalized.add(`${i},${j}`);

    // --- Ampeln + Straßennetz
    this.trafficLights = new TrafficLights(this.group, Mat);
    this.roadNet = new RoadNetwork({
      xs, zs, halfX, halfZ, segNS, segEW, signalized,
      seed: rand.int(0, 99999), trafficLights: this.trafficLights,
    });
    this.group.add(this.roadNet.group);
    this.trafficLights.build();

    // --- Blöcke + Zonen + Parks
    this.blocks = [];
    const parkRand = rand.fork(44);
    const parkSet = new Set();
    while (parkSet.size < 5) {
      const i = parkRand.int(0, N_LINES - 2), j = parkRand.int(0, N_LINES - 2);
      // Zentrum nicht zuparken
      if (Math.abs(i - AVENUE) <= 0 && Math.abs(j - AVENUE) <= 0) continue;
      parkSet.add(`${i},${j}`);
    }
    for (let i = 0; i < N_LINES - 1; i++) {
      for (let j = 0; j < N_LINES - 1; j++) {
        const x0 = xs[i] + halfX[i], x1 = xs[i + 1] - halfX[i + 1];
        const z0 = zs[j] + halfZ[j], z1 = zs[j + 1] - halfZ[j + 1];
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const d = Math.max(Math.abs(cx), Math.abs(cz));
        const zone = d < 200 ? 'center' : d < 380 ? 'mid' : 'outer';
        this.blocks.push({ i, j, x0, z0, x1, z1, zone, park: parkSet.has(`${i},${j}`) });
      }
    }

    // --- Grundflächen: Hof-Pflaster in Baublöcken
    const paveGeos = [];
    for (const b of this.blocks) {
      if (b.park) continue;
      const g = new THREE.PlaneGeometry(b.x1 - b.x0 - 4.6, b.z1 - b.z0 - 4.6);
      g.rotateX(-Math.PI / 2);
      g.translate((b.x0 + b.x1) / 2, 0.132, (b.z0 + b.z1) / 2);
      paveGeos.push(g);
    }
    const paveTex = concreteTextures(512, 99);
    paveTex.map.repeat.set(30, 30);
    paveTex.normalMap.repeat.set(30, 30);
    paveTex.roughnessMap.repeat.set(30, 30);
    const paveMat = Mat.std({ ...paveTex, color: 0xb9b6ae }, { wet: true });
    const pave = new THREE.Mesh(mergeGeometries(paveGeos), paveMat);
    pave.receiveShadow = true;
    this.group.add(pave);

    // Außenring: Wiese bis zum Horizont
    const outerTex = grassTextures(512, 7);
    outerTex.map.repeat.set(160, 160);
    outerTex.normalMap.repeat.set(160, 160);
    outerTex.roughnessMap.repeat.set(160, 160);
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      Mat.std({ ...outerTex, color: 0xffffff }, { wet: true })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    this.group.add(outer);

    // --- Gebäude / Props / Natur
    this.buildings = new Buildings({ blocks: this.blocks, rand: rand.fork(55), collision, citySize: span });
    this.group.add(this.buildings.group);
    this.props = new Props({ roadNet: this.roadNet, rand: rand.fork(66) });
    this.group.add(this.props.group);
    this.nature = new Nature({ roadNet: this.roadNet, blocks: this.blocks, rand: rand.fork(77) });
    this.group.add(this.nature.group);

    // --- Buslinie
    this.route = new BusRoute({ roadNet: this.roadNet, rect: ROUTE_RECT, parent: this.group });

    // --- Weltgrenzen
    const B = span / 2 + 60;
    collision.addAABB(new StaticAABB(-B - 50, -B - 2000, -B, B + 2000));
    collision.addAABB(new StaticAABB(B, -B - 2000, B + 50, B + 2000));
    collision.addAABB(new StaticAABB(-B - 2000, -B - 50, B + 2000, -B));
    collision.addAABB(new StaticAABB(-B - 2000, B, B + 2000, B + 50));

    // --- Nachtlicht-Pool: 6 PointLights wandern zu den nächsten Laternen
    this.lightPool = [];
    for (let k = 0; k < 6; k++) {
      const pl = new THREE.PointLight(0xffd9a0, 0, 26, 1.8);
      pl.position.y = 6.0;
      this.group.add(pl);
      this.lightPool.push(pl);
    }
    this._poolTimer = 0;
  }

  groundHeight(x, z) {
    return this.roadNet.groundHeight(x, z);
  }

  update(dt, env, busPos) {
    this.trafficLights.update(dt);
    this.buildings.update(env);
    this.props.update(env);

    // Lichtpool nur nachts und nur alle 0,5 s neu sortieren
    this._poolTimer -= dt;
    if (this._poolTimer <= 0) {
      this._poolTimer = 0.5;
      if (env.night > 0.05) {
        const lamps = this.props.lampPositions;
        // die 6 nächsten Laternen zum Bus
        const sorted = lamps
          .map((p) => ({ p, d: (p.x - busPos.x) ** 2 + (p.z - busPos.z) ** 2 }))
          .sort((a, b) => a.d - b.d)
          .slice(0, this.lightPool.length);
        this.lightPool.forEach((pl, k) => {
          if (sorted[k]) {
            pl.position.copy(sorted[k].p);
            pl.intensity = 40 * env.night;
          } else {
            pl.intensity = 0;
          }
        });
      } else {
        for (const pl of this.lightPool) pl.intensity = 0;
      }
    }
  }
}
