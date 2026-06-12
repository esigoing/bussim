// Stadt-Orchestrierung: perturbiertes 9×9-Raster über ~1,1×1,1 km mit
// geschwungenen NS-Straßen und Hügel-Höhenfeld. Seeded Viertel-Karte
// (Altstadt im Zentrum, Geschäftsviertel entlang der Avenuen, Wohnviertel
// am Rand, Gewerbe in einer Ecke), Landmarken auf festen Blöcken (Kirche
// mit Platz, Bahnhof am „Hauptbahnhof"-Stop, Glasturm, Marktplatz mit
// Brunnen + Ständen am „Marktplatz"-Stop), gepflasterte Plätze, Parkbuchten
// mit Stellflächen, 8 Parks, gelöschte Nebenstraßen, Straßennetz + Gebäude
// + Props + Natur + Ampeln + Buslinie (Linie 73 als explizite Lane-Key-
// Sequenz durch alle Viertel, siehe ROUTE_KEYS).
// Optionen: propsDensity skaliert die Stadtmöblierung, cityDetail (0–3)
// staffelt Extras — die Defaults entsprechen dem bisherigen Verhalten.
// Die Grid-Topologie und Lane-Keys bleiben unangetastet (Routen-Vertrag).

import * as THREE from 'three';
import * as Mat from '../graphics/materials/MatLib.js';
import { Terrain } from './Terrain.js';
import { RoadNetwork } from './RoadNetwork.js';
import { Buildings } from './Buildings.js';
import { Props } from './Props.js';
import { Nature } from './Nature.js';
import { BusRoute } from './BusRoute.js';
import { TrafficLights } from './TrafficLights.js';
import { StaticAABB } from '../physics/Collision.js';
import { concreteTextures, grassTextures } from '../graphics/materials/TextureGen.js';
import { cobbleTextures, awningTexture } from './TextureGen.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const N_LINES = 9;
const AVENUE = 4;
const HALF_STREET = 3.5;
const HALF_AVENUE = 6.75;
// Fallback-Route (altes Rechteck) — greift nur, wenn die explizite Sequenz
// unten eine Lücke hat (BusRoute validiert nach der Stadtgenerierung).
const ROUTE_RECT = { i0: 2, j0: 2, i1: 6, j1: 6 };
// Linie 73 als explizite Lane-Key-Sequenz (WP-C2): geschlossener Rundkurs mit
// 10 Abbiegungen (7× rechts, 3× links) durch alle Viertel — Wohnviertel im
// Norden/Osten/Süden/Westen, Geschäftsviertel an beiden Alleen, mitten durch
// die Altstadt (Spalte i=3). Nur Einzelspur-Straßen (laneIdx 0), die Alleen
// werden an signalisierten Kreuzungen gequert. Knotenfolge:
// (1,1)→(5,1)→(5,3)→(7,3)→(7,7)→(5,7)→(5,6)→(3,6)→(3,3)→(1,3)→(1,1)
const ROUTE_KEYS = [
  // ostwärts auf Reihe j=1 (Wohnviertel Nord, quert die NS-Allee)
  'EW,1,1,1,0', 'EW,1,2,1,0', 'EW,1,3,1,0', 'EW,1,4,1,0',
  // rechts ab: südwärts auf Spalte i=5 (Geschäftsviertel an der Allee)
  'NS,5,1,1,0', 'NS,5,2,1,0',
  // links ab: ostwärts auf Reihe j=3
  'EW,3,5,1,0', 'EW,3,6,1,0',
  // rechts ab: südwärts auf Spalte i=7 (Wohnviertel Ost, quert die EW-Allee)
  'NS,7,3,1,0', 'NS,7,4,1,0', 'NS,7,5,1,0', 'NS,7,6,1,0',
  // rechts ab: westwärts auf Reihe j=7 (Südrand)
  'EW,7,6,-1,0', 'EW,7,5,-1,0',
  // rechts ab: nordwärts auf Spalte i=5, dann links auf Reihe j=6
  'NS,5,6,-1,0',
  'EW,6,4,-1,0', 'EW,6,3,-1,0',
  // rechts ab: nordwärts auf Spalte i=3 — mitten durch die Altstadt
  'NS,3,5,-1,0', 'NS,3,4,-1,0', 'NS,3,3,-1,0',
  // links ab: westwärts auf Reihe j=3, rechts auf Spalte i=1 (Wohnviertel
  // West) und rechts zurück auf die Nordkante
  'EW,3,2,-1,0', 'EW,3,1,-1,0',
  'NS,1,2,-1,0', 'NS,1,1,-1,0',
];
// Abbiege-Knoten der Linie 73 (für Ampeln an den Kurvenpunkten)
const ROUTE_TURNS = [
  [5, 1], [5, 3], [7, 3], [7, 7], [5, 7],
  [5, 6], [3, 6], [3, 3], [1, 3], [1, 1],
];
const CURB_H = 0.13; // Gehweg-/Block-Lift über der Fahrbahn (Welt-Vertrag)

// Plane mit Vertex-Höhen aus dem Terrain (für Blockflächen am Hang)
function terrainPlane(x0, z0, x1, z1, terrain, lift, uvScale) {
  const w = x1 - x0, d = z1 - z0;
  const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 14)), Math.max(1, Math.round(d / 14)));
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let k = 0; k < pos.count; k++) {
    const px = pos.getX(k) + cx, pz = pos.getZ(k) + cz;
    pos.setXYZ(k, px, terrain.hExact(px, pz) + lift, pz);
    uv.setXY(k, px * uvScale, pz * uvScale);
  }
  g.computeVertexNormals();
  return g;
}

export class CityGen {
  constructor({ rand, collision, propsDensity = 1.0, cityDetail = 2 }) {
    this.group = new THREE.Group();
    this.rand = rand;
    this.terrain = new Terrain(rand.int(0, 99999));

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

    // --- Schlängelung der NS-Straßen: Ränder gerade, innen kurvig,
    //     die Allee am stärksten. Wellenlänge 350–550 m.
    const curveRand = rand.fork(99);
    const amps = xs.map((_, i) => {
      if (i === 0 || i === N_LINES - 1) return 0;
      return i === AVENUE ? 20 : curveRand.float(7, 15);
    });
    const phases = xs.map(() => curveRand.float(0, Math.PI * 2));
    const freqs = xs.map(() => (Math.PI * 2) / curveRand.float(350, 550));

    // --- Segment-Existenz: einige innere Nebenstraßen löschen.
    // Alle Segmente der Linie 73 (und des Fallback-Rechtecks) sind tabu —
    // sonst reißt die Kantenfolge der Route.
    const segNS = xs.map(() => new Array(N_LINES - 1).fill(true));
    const segEW = zs.map(() => new Array(N_LINES - 1).fill(true));
    const routeSegs = new Set();
    for (const key of ROUTE_KEYS) {
      const [axis, line, seg] = key.split(','); // NS: line=i, seg=j / EW: line=j, seg=i
      routeSegs.add(`${axis},${line},${seg}`);
    }
    const onRoute = (axis, line, seg) => {
      if (routeSegs.has(`${axis},${line},${seg}`)) return true;
      const { i0, j0, i1, j1 } = ROUTE_RECT; // Fallback-Route ebenfalls schützen
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

    // --- Signalisierte Kreuzungen: alle Allee-Knoten + die Abbiege-Knoten
    // der Linie 73 (Ampeln und Zebrastreifen an jedem Kurvenpunkt der Route)
    const signalized = new Set();
    for (let k = 0; k < N_LINES; k++) {
      signalized.add(`${AVENUE},${k}`);
      signalized.add(`${k},${AVENUE}`);
    }
    for (const [i, j] of ROUTE_TURNS) signalized.add(`${i},${j}`);

    // --- Ampeln + Straßennetz
    this.trafficLights = new TrafficLights(this.group, Mat);
    this.roadNet = new RoadNetwork({
      xs, zs, halfX, halfZ, amps, phases, freqs, segNS, segEW, signalized,
      seed: rand.int(0, 99999), trafficLights: this.trafficLights, terrain: this.terrain,
    });
    this.group.add(this.roadNet.group);
    this.trafficLights.build();

    // --- Blöcke + Parks
    // Blockgrenzen konservativ: maximale Kurven-Auslenkung der Nachbarstraßen
    this.blocks = [];
    const parkRand = rand.fork(44);
    const parkSet = new Set();
    while (parkSet.size < 8) {
      const i = parkRand.int(0, N_LINES - 2), j = parkRand.int(0, N_LINES - 2);
      if (i === AVENUE || j === AVENUE) continue;
      parkSet.add(`${i},${j}`);
    }
    for (let i = 0; i < N_LINES - 1; i++) {
      for (let j = 0; j < N_LINES - 1; j++) {
        const x0 = xs[i] + amps[i] + halfX[i];
        const x1 = xs[i + 1] - amps[i + 1] - halfX[i + 1];
        const z0 = zs[j] + halfZ[j];
        const z1 = zs[j + 1] - halfZ[j + 1];
        this.blocks.push({ i, j, x0, z0, x1, z1, park: parkSet.has(`${i},${j}`) });
      }
    }

    // --- Buslinie VOR den Gebäuden: Landmarken (Bahnhof, Marktplatz) werden
    //     an den Haltestellen der Route verankert. Explizite Sequenz mit
    //     Rechteck-Fallback (BusRoute validiert die Kantenfolge selbst).
    this.route = new BusRoute({
      roadNet: this.roadNet, laneKeys: ROUTE_KEYS, rect: ROUTE_RECT, parent: this.group,
    });

    // --- Viertel-Karte, Landmarken/Plätze, Parkbuchten (seeded, blockweise)
    this._assignDistricts(rand.fork(88));
    this._assignLandmarks(rand.fork(101));
    this._assignBays(rand.fork(112), cityDetail);

    // --- Blockflächen: Hof-Pflaster, Plätze in Kopfstein, Buchten in Asphalt
    const paveGeos = [];
    const plazaGeos = [];
    const bayGeos = [];
    for (const b of this.blocks) {
      if (b.park) continue;
      if (b.x1 - b.x0 < 8 || b.z1 - b.z0 < 8) continue;
      if (b.plaza) {
        plazaGeos.push(terrainPlane(b.x0 - 1, b.z0 - 1, b.x1 + 1, b.z1 + 1, this.terrain, 0.132, 1 / 3));
      } else {
        paveGeos.push(terrainPlane(b.x0 - 1, b.z0 - 1, b.x1 + 1, b.z1 + 1, this.terrain, 0.132, 1 / 2.5));
      }
      if (b.bays) {
        for (const bay of b.bays) {
          const zr0 = bay.side === 'z0' ? b.z0 + 2.6 : b.z1 - 6.5;
          const zr1 = bay.side === 'z0' ? b.z0 + 6.5 : b.z1 - 2.6;
          bayGeos.push(terrainPlane(bay.x0 - 0.8, zr0, bay.x1 + 0.8, zr1, this.terrain, 0.138, 1 / 4));
        }
      }
    }
    const paveTex = concreteTextures(512, 99);
    const paveMat = Mat.std({ ...paveTex, color: 0xb9b6ae }, { wet: true });
    if (paveGeos.length) {
      const pave = new THREE.Mesh(mergeGeometries(paveGeos), paveMat);
      pave.receiveShadow = true;
      this.group.add(pave);
    }
    if (plazaGeos.length) {
      const cobTex = cobbleTextures(512, 31);
      const plaza = new THREE.Mesh(mergeGeometries(plazaGeos), Mat.std({ ...cobTex, color: 0xc6c2b8 }, { wet: true }));
      plaza.receiveShadow = true;
      this.group.add(plaza);
    }
    if (bayGeos.length) {
      // Stellflächen dunkler abgesetzt, knapp über dem Hof-Pflaster
      const bays = new THREE.Mesh(mergeGeometries(bayGeos), Mat.std({ ...paveTex, color: 0x83817b }, { wet: true }));
      bays.receiveShadow = true;
      this.group.add(bays);
    }

    // --- Außenring: Wiese, dem Terrain folgend. WICHTIG: fein genug
    // auflösen (20-m-Zellen) und absenken, sonst ragt die linear
    // interpolierte Fläche an Hügeln über die exakt gesampelten Straßen.
    const outerTex = grassTextures(512, 7);
    const outerGeo = new THREE.PlaneGeometry(4000, 4000, 200, 200);
    outerGeo.rotateX(-Math.PI / 2);
    {
      const pos = outerGeo.attributes.position;
      const uv = outerGeo.attributes.uv;
      for (let k = 0; k < pos.count; k++) {
        const px = pos.getX(k), pz = pos.getZ(k);
        pos.setY(k, this.terrain.hExact(px, pz) - 0.18);
        uv.setXY(k, px / 6, pz / 6);
      }
      outerGeo.computeVertexNormals();
    }
    const outer = new THREE.Mesh(outerGeo, Mat.std({ ...outerTex, color: 0xffffff }, { wet: true }));
    outer.receiveShadow = true;
    this.group.add(outer);

    // --- Gebäude (lesen district/landmark/plaza/bays von den Blöcken)
    this.buildings = new Buildings({
      blocks: this.blocks, rand: rand.fork(55), collision, terrain: this.terrain, cityDetail,
    });
    this.group.add(this.buildings.group);

    // --- Plätze möblieren (NACH Buildings: keepClear der Landmarken liegt vor)
    this._furnishPlazas(rand.fork(123), collision, cityDetail);

    // --- Props / Natur (alle Terrain-bewusst)
    this.props = new Props({
      roadNet: this.roadNet, rand: rand.fork(66), terrain: this.terrain,
      blocks: this.blocks, stops: this.route.stops, propsDensity, cityDetail,
    });
    this.group.add(this.props.group);
    this.nature = new Nature({
      roadNet: this.roadNet, blocks: this.blocks, rand: rand.fork(77), terrain: this.terrain,
      stops: this.route.stops, propsDensity, cityDetail,
    });
    this.group.add(this.nature.group);

    // --- Weltgrenzen
    const B = span / 2 + 60;
    collision.addAABB(new StaticAABB(-B - 50, -B - 2000, -B, B + 2000, 60));
    collision.addAABB(new StaticAABB(B, -B - 2000, B + 50, B + 2000, 60));
    collision.addAABB(new StaticAABB(-B - 2000, -B - 50, B + 2000, -B, 60));
    collision.addAABB(new StaticAABB(-B - 2000, B, B + 2000, B + 50, 60));

    // --- Nachtlicht-Pool
    this.lightPool = [];
    for (let k = 0; k < 6; k++) {
      const pl = new THREE.PointLight(0xffd9a0, 0, 26, 1.8);
      this.group.add(pl);
      this.lightPool.push(pl);
    }
    this._poolTimer = 0;
  }

  // ---- Viertel blockweise: Gewerbe in einer geseedeten 2×2-Ecke, Altstadt
  // im Zentrum, Geschäftsviertel entlang der Avenuen, Wohnviertel am Rand.
  _assignDistricts(r) {
    const corners = [[0, 0], [N_LINES - 3, 0], [0, N_LINES - 3], [N_LINES - 3, N_LINES - 3]];
    const [ci, cj] = corners[r.int(0, corners.length - 1)];
    for (const b of this.blocks) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const d = Math.max(Math.abs(cx), Math.abs(cz));
      if (b.i >= ci && b.i <= ci + 1 && b.j >= cj && b.j <= cj + 1) {
        b.district = 'gewerbe';
        b.park = false; // Industriehöfe statt Parks in der Gewerbe-Ecke
      } else if (d < 215) {
        b.district = 'altstadt';
      } else if ((b.i === AVENUE - 1 || b.i === AVENUE || b.j === AVENUE - 1 || b.j === AVENUE) && d < 440) {
        b.district = 'geschaeft';
      } else {
        b.district = 'wohnen';
      }
    }
  }

  // Block, vor dem die Haltestelle liegt (auf der Gehweg-/Häuschen-Seite).
  // Über die Rasterlinien aufgelöst, weil die konservativen Blockgrenzen an
  // kurvigen NS-Straßen schmaler sind als die logische Rasterzelle.
  _blockNearStop(stop) {
    const p = stop.pos.clone().addScaledVector(stop.right, 12);
    const grid = (arr, v) => {
      for (let k = 0; k < arr.length - 1; k++) {
        if (v >= arr[k] && v <= arr[k + 1]) return k;
      }
      return -1;
    };
    const bi = grid(this.roadNet.xs, p.x);
    const bj = grid(this.roadNet.zs, p.z);
    let block = this.blocks.find((b) => b.i === bi && b.j === bj) || null;
    if (!block) {
      let best = Infinity;
      for (const b of this.blocks) {
        const d = ((b.x0 + b.x1) / 2 - p.x) ** 2 + ((b.z0 + b.z1) / 2 - p.z) ** 2;
        if (d < best) { best = d; block = b; }
      }
    }
    return block;
  }

  // ---- Landmarken auf festen Blöcken + Park-Auffüllung
  _assignLandmarks(r) {
    const stops = this.route.stops;
    const byName = (n) => stops.find((s) => s.name === n);
    const central = (b) => Math.max(Math.abs((b.x0 + b.x1) / 2), Math.abs((b.z0 + b.z1) / 2));
    const free = (b) => !b.park && !b.plaza && !b.landmark;

    // Bahnhof mit Uhr am „Hauptbahnhof"-Stop
    const hbf = byName('Hauptbahnhof');
    if (hbf) {
      const b = this._blockNearStop(hbf);
      if (b) {
        b.landmark = 'bahnhof';
        b.landmarkStop = hbf;
        b.park = false;
        b.district = 'geschaeft';
      }
    }
    // Marktplatz (gepflastert, Brunnen + Stände) am „Marktplatz"-Stop
    const markt = byName('Marktplatz');
    if (markt) {
      const b = this._blockNearStop(markt);
      if (b && !b.landmark) {
        b.plaza = true;
        b.market = true;
        b.park = false;
      }
    }
    // Kirche mit Turm: zentralster Altstadt-Block ohne Sonderrolle wird
    // zum Altstadt-Platz (Kirche im Norden, Brunnen/Bäume im Süden)
    const kirche = this.blocks
      .filter((b) => b.district === 'altstadt' && free(b) && b.x1 - b.x0 > 52 && b.z1 - b.z0 > 44)
      .sort((a, b) => central(a) - central(b))[0];
    if (kirche) {
      kirche.landmark = 'kirche';
      kirche.plaza = true;
    }
    // Glasturm: innerster Geschäftsviertel-Block
    const turm = this.blocks
      .filter((b) => b.district === 'geschaeft' && free(b) && b.x1 - b.x0 > 34 && b.z1 - b.z0 > 34)
      .sort((a, b) => central(a) - central(b))[0];
    if (turm) turm.landmark = 'glasturm';

    // Parks wieder auf 8 auffüllen (Sonderblöcke haben ggf. welche verdrängt)
    let parks = this.blocks.filter((b) => b.park).length;
    let guard = 0;
    while (parks < 8 && guard++ < 300) {
      const b = this.blocks[r.int(0, this.blocks.length - 1)];
      if (b.park || b.plaza || b.landmark || b.district === 'gewerbe') continue;
      if (b.i === AVENUE || b.j === AVENUE) continue;
      b.park = true;
      parks++;
    }
  }

  // ---- Parkbuchten: Stellflächen als Block-Einbuchtungen an EW-Straßen
  // (gerade Kanten — die geschwungenen NS-Seiten bleiben frei). Buildings
  // rückt die Bebauung auf Buchtseiten zurück, Props parkt dort Autos.
  // Geparkte Autos stehen damit NIE auf der Fahrbahn oder dem Gehweg.
  _assignBays(r, cityDetail) {
    if (cityDetail < 1) return;
    const stops = this.route.stops;
    for (const b of this.blocks) {
      if (b.park || b.plaza || b.landmark) continue;
      if (b.x1 - b.x0 < 46) continue;
      for (const side of ['z0', 'z1']) {
        const j = side === 'z0' ? b.j : b.j + 1;
        if (!this.roadNet.segEW[j][b.i]) continue; // keine Straße an dieser Kante
        if (!r.chance(0.42)) continue;
        const edgeZ = side === 'z0' ? b.z0 : b.z1;
        // Haltestellen-Kanten freihalten (Häuschen steht am Blockrand)
        if (stops.some((s) => Math.abs(s.shelterPos.z - edgeZ) < 8 &&
            s.shelterPos.x > b.x0 - 10 && s.shelterPos.x < b.x1 + 10)) continue;
        const half = Math.min(19, (b.x1 - b.x0) / 2 - 9);
        const cx = (b.x0 + b.x1) / 2 + r.float(-6, 6);
        const bay = {
          side,
          x0: cx - half,
          x1: cx + half,
          z: side === 'z0' ? b.z0 + 4.55 : b.z1 - 4.55, // Mittellinie der Stellplatzreihe
        };
        (b.bays || (b.bays = [])).push(bay);
      }
    }
  }

  // ---- Plätze: Brunnen mit Wasserbecken + Bänke im Rund; am Marktplatz
  // zusätzlich Marktstände mit gestreiften Dächern. Y stets Terrain + CURB_H.
  _furnishPlazas(r, collision, cityDetail) {
    const stoneMat = Mat.std({ color: 0x97928a, roughness: 0.9 });
    const benchMat = Mat.std({ color: 0x6b4a2f, roughness: 0.85 });
    const woodMat = Mat.std({ color: 0x7a5a38, roughness: 0.9 });
    const waterMat = Mat.phys({
      color: 0x2a4a52, roughness: 0.05, metalness: 0,
      transparent: true, opacity: 0.9, envMapIntensity: 1.2,
    });
    const fabricMats = [
      awningTexture('#b8473a', '#e8e2d4'),
      awningTexture('#3e6e52', '#e8e2d4'),
      awningTexture('#39618e', '#e8e2d4'),
    ].map((tex) => Mat.std({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));

    const benchGeos = [];
    const _m = new THREE.Matrix4();

    for (const b of this.blocks) {
      if (!b.plaza) continue;
      const fx = (b.x0 + b.x1) / 2;
      // Kirche steht in der Nordhälfte des Blocks → Brunnen nach Süden
      const fz = b.landmark === 'kirche' ? b.z0 + (b.z1 - b.z0) * 0.68 : (b.z0 + b.z1) / 2;
      const baseY = this.terrain.hExact(fx, fz) + CURB_H;

      // --- Brunnen: Becken + Säule + Schale (ein Mesh) + Wasserfläche
      const stoneGeo = mergeGeometries([
        new THREE.CylinderGeometry(2.7, 2.85, 0.62, 20).translate(0, 0.31, 0),
        new THREE.CylinderGeometry(0.26, 0.4, 1.5, 10).translate(0, 0.95, 0),
        new THREE.CylinderGeometry(1.0, 0.62, 0.32, 14).translate(0, 1.75, 0),
      ]);
      const fountain = new THREE.Mesh(stoneGeo, stoneMat);
      fountain.position.set(fx, baseY, fz);
      fountain.castShadow = true;
      fountain.receiveShadow = true;
      this.group.add(fountain);
      const water = new THREE.Mesh(new THREE.CircleGeometry(2.45, 20), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(fx, baseY + 0.52, fz);
      this.group.add(water);
      collision.addAABB(new StaticAABB(fx - 2.9, fz - 2.9, fx + 2.9, fz + 2.9, baseY + 2));
      b.fountain = { x: fx, z: fz, r: 3 };

      // --- Bänke im Rund um den Brunnen (tangential ausgerichtet)
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const bx = fx + Math.cos(a) * 5.6, bz = fz + Math.sin(a) * 5.6;
        const g = new THREE.BoxGeometry(1.7, 0.08, 0.5);
        _m.makeRotationY(a + Math.PI / 2);
        _m.setPosition(bx, this.terrain.hExact(bx, bz) + CURB_H + 0.42, bz);
        g.applyMatrix4(_m);
        benchGeos.push(g);
      }

      // --- Marktstände (nur am Marktplatz): zwei Reihen beidseits des
      // Brunnens, Front zur Platzmitte. Gemergte Geos → wenige Draw Calls.
      if (b.market) {
        const woodGeos = [];
        const roofGeos = [[], [], []];
        const positions = [];
        for (const sx of [-9.5, 9.5]) {
          for (const dz of [-6.2, 0, 6.2]) {
            positions.push([fx + sx, fz + dz, sx > 0 ? -Math.PI / 2 : Math.PI / 2]);
          }
        }
        positions.forEach(([px, pz, yaw], k) => {
          const sy = this.terrain.hExact(px, pz) + CURB_H;
          _m.makeRotationY(yaw);
          _m.setPosition(px, sy, pz);
          for (const [qx, qz] of [[-1.25, -1], [-1.25, 1], [1.25, -1], [1.25, 1]]) {
            woodGeos.push(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6)
              .translate(qx, 1.1, qz).applyMatrix4(_m));
          }
          woodGeos.push(new THREE.BoxGeometry(2.6, 0.85, 0.9)
            .translate(0, 0.43, 0.55).applyMatrix4(_m));
          if (cityDetail >= 2) {
            for (const dx of [-0.7, 0.2]) {
              woodGeos.push(new THREE.BoxGeometry(0.5, 0.3, 0.38)
                .rotateY(r.float(-0.3, 0.3))
                .translate(dx + r.float(-0.08, 0.08), 1.0, 0.5).applyMatrix4(_m));
            }
          }
          const roof = new THREE.BoxGeometry(3.0, 0.06, 2.7);
          roof.rotateX(0.08); // leicht zur Front geneigt
          roof.translate(0, 2.3, 0);
          roof.applyMatrix4(_m);
          roofGeos[k % 3].push(roof);
          collision.addAABB(new StaticAABB(px - 1.5, pz - 1.5, px + 1.5, pz + 1.5, sy + 2.4));
        });
        const wood = new THREE.Mesh(mergeGeometries(woodGeos), woodMat);
        wood.castShadow = true;
        wood.receiveShadow = true;
        this.group.add(wood);
        roofGeos.forEach((list, mi) => {
          if (!list.length) return;
          const roof = new THREE.Mesh(mergeGeometries(list), fabricMats[mi]);
          roof.castShadow = true;
          this.group.add(roof);
        });
        // Standzone für die Baum-/Möblierungs-Logik freihalten
        b.keepClear = b.keepClear || [];
        b.keepClear.push({ x0: fx - 12.5, z0: fz - 9, x1: fx + 12.5, z1: fz + 9 });
      }
    }

    if (benchGeos.length) {
      const benches = new THREE.Mesh(mergeGeometries(benchGeos), benchMat);
      benches.castShadow = true;
      benches.receiveShadow = true;
      this.group.add(benches);
    }
  }

  groundHeight(x, z) {
    return this.roadNet.groundHeight(x, z);
  }

  update(dt, env, busPos) {
    this.trafficLights.update(dt);
    this.buildings.update(env);
    this.props.update(env);

    this._poolTimer -= dt;
    if (this._poolTimer <= 0) {
      this._poolTimer = 0.5;
      if (env.night > 0.05) {
        const lamps = this.props.lampPositions;
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
