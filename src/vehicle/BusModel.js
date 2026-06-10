// Prozedurales 3D-Modell des Scania Citywide LF 12 m.
// Lokales System: -Z = vorn, +Y = oben, Ursprung im Schwerpunkt (~1,2 m über
// Boden). Keine Logik hier — update() liest nur Zustand aus Bus.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as Mat from '../graphics/materials/MatLib.js';
import {
  busPaintTextures, rubberTextures, metalTextures, seatFabricTextures,
  busFloorTextures, dashPlasticTextures,
} from '../graphics/materials/TextureGen.js';

const GROUND_Y = -1.23;            // Boden bei statischer Einfederung
const FLOOR_Y = GROUND_Y + 0.37;   // Niederflur
const ROOF_Y = GROUND_Y + 3.0;
const HALF_W = 1.275;
const FRONT_Z = -6.0, BACK_Z = 6.0;
const TRACK = 2.1, WHEELBASE = 5.95, WHEEL_R = 0.48;

// Türen (rechte Seite): [zMin, zMax]
export const DOOR_RANGES = [[-5.45, -4.25], [-0.6, 0.6], [3.1, 4.3]];

// Punktmatrix-Zielanzeige als CanvasTexture
export function makeMatrixDisplay(text, w = 512, h = 96, color = '#ffb02e') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0a08';
  ctx.fillRect(0, 0, w, h);
  // Text klein rendern, dann als Punktraster abtasten
  const off = document.createElement('canvas');
  const dotsX = 96, dotsY = 16;
  off.width = dotsX; off.height = dotsY;
  const octx = off.getContext('2d');
  octx.fillStyle = '#000';
  octx.fillRect(0, 0, dotsX, dotsY);
  octx.fillStyle = '#fff';
  octx.font = 'bold 13px Arial';
  octx.textBaseline = 'middle';
  octx.fillText(text, 2, dotsY / 2 + 1);
  const data = octx.getImageData(0, 0, dotsX, dotsY).data;
  const cellW = w / dotsX, cellH = h / dotsY;
  ctx.fillStyle = color;
  for (let y = 0; y < dotsY; y++) {
    for (let x = 0; x < dotsX; x++) {
      if (data[(y * dotsX + x) * 4] > 100) {
        ctx.beginPath();
        ctx.arc((x + 0.5) * cellW, (y + 0.5) * cellH, cellW * 0.34, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BusModel {
  constructor(bus) {
    this.bus = bus;
    this.group = new THREE.Group();

    this._buildMaterials();
    this._buildHull();
    this._buildWindows();
    this._buildDoors();
    this._buildWheels();
    this._buildLights();
    this._buildInterior();
    this._buildMirrorMounts();

    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  _buildMaterials() {
    const paint = busPaintTextures();
    this.paintMat = Mat.phys({
      ...paint, color: 0xd9dcdf, clearcoat: 0.6, clearcoatRoughness: 0.18,
      metalness: 0.05, roughness: 0.42, envMapIntensity: 0.7,
    }, { wet: true });
    this.accentMat = Mat.phys({
      color: 0xb01e28, clearcoat: 0.7, clearcoatRoughness: 0.15,
      metalness: 0.1, roughness: 0.4,
    }, { wet: true });
    this.skirtMat = Mat.std({ color: 0x2c2e30, roughness: 0.7, metalness: 0.2 }, { wet: true });
    this.trimMat = Mat.std({ color: 0x131416, roughness: 0.5, metalness: 0.3 });
    this.glassMat = Mat.phys({
      color: 0x1a2226, roughness: 0.05, metalness: 0,
      transparent: true, opacity: 0.62, envMapIntensity: 1.4,
    });
    this.windshieldMat = Mat.phys({
      color: 0x222a30, roughness: 0.03, metalness: 0,
      transparent: true, opacity: 0.18, envMapIntensity: 1.2, side: THREE.DoubleSide,
    });
    const rubber = rubberTextures();
    this.rubberMat = Mat.std({ ...rubber, color: 0xffffff });
    this.rimMat = Mat.std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.9 });
    const metal = metalTextures();
    this.poleMat = Mat.std({ ...metal, color: 0xffd900, roughness: 0.4, metalness: 0.6 });
    const fabric = seatFabricTextures();
    this.seatMat = Mat.std({ ...fabric, color: 0xffffff });
    this.seatFrameMat = Mat.std({ color: 0x333539, roughness: 0.6, metalness: 0.4 });
    const floor = busFloorTextures();
    floor.map.repeat.set(3, 14);
    floor.normalMap.repeat.set(3, 14);
    floor.roughnessMap.repeat.set(3, 14);
    this.floorMat = Mat.std({ ...floor, color: 0x9b9489 });
    this.innerWallMat = Mat.std({ color: 0xd8dadc, roughness: 0.85 });
    this.ceilingMat = Mat.std({ color: 0xe8eaec, roughness: 0.9 });
    const dash = dashPlasticTextures();
    this.dashMat = Mat.std({ ...dash, color: 0xffffff });
  }

  _buildHull() {
    const hullH = ROOF_Y - (GROUND_Y + 0.32);
    const hullCY = (ROOF_Y + GROUND_Y + 0.32) / 2;

    // Drei Rumpf-Segmente: unter den Fenstern, Fensterholme macht _buildWindows
    const lower = new THREE.Mesh(
      new RoundedBoxGeometry(HALF_W * 2, 1.05, 12, 3, 0.08),
      this.paintMat
    );
    lower.position.set(0, GROUND_Y + 0.32 + 1.05 / 2 - 0.02, 0);
    this.group.add(lower);

    // Akzentstreifen
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.015, 0.16, 11.98), this.accentMat);
    stripe.position.set(0, GROUND_Y + 1.18, 0);
    this.group.add(stripe);

    // Dachsegment
    const roofBand = new THREE.Mesh(
      new RoundedBoxGeometry(HALF_W * 2, 0.5, 12, 3, 0.1),
      this.paintMat
    );
    roofBand.position.set(0, ROOF_Y - 0.25, 0);
    this.group.add(roofBand);

    // Frontkappe mit Scheibenöffnung: Untergurt + Dachgurt + A-Säulen
    const wsBottom = GROUND_Y + 1.12, wsTop = GROUND_Y + 2.78;
    const frontLower = new THREE.Mesh(
      new RoundedBoxGeometry(HALF_W * 2, wsBottom - (GROUND_Y + 0.32), 0.4, 3, 0.1),
      this.paintMat
    );
    frontLower.position.set(0, (wsBottom + GROUND_Y + 0.32) / 2, FRONT_Z + 0.19);
    this.group.add(frontLower);
    const frontUpper = new THREE.Mesh(
      new RoundedBoxGeometry(HALF_W * 2, ROOF_Y - wsTop + 0.1, 0.4, 3, 0.1),
      this.paintMat
    );
    frontUpper.position.set(0, (ROOF_Y + wsTop) / 2, FRONT_Z + 0.19);
    this.group.add(frontUpper);
    for (const px of [-1, 1]) {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, wsTop - wsBottom, 0.3),
        this.trimMat
      );
      pillar.position.set(px * (HALF_W - 0.065), (wsTop + wsBottom) / 2, FRONT_Z + 0.14);
      this.group.add(pillar);
    }

    const backCap = new THREE.Mesh(
      new RoundedBoxGeometry(HALF_W * 2, hullH, 0.7, 3, 0.14),
      this.paintMat
    );
    backCap.position.set(0, hullCY, BACK_Z - 0.34);
    this.group.add(backCap);

    // Schürze
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 - 0.04, 0.3, 11.7), this.skirtMat);
    skirt.position.set(0, GROUND_Y + 0.3, 0);
    this.group.add(skirt);

    // Stoßfänger vorn/hinten
    const bumperF = new THREE.Mesh(new RoundedBoxGeometry(HALF_W * 2 + 0.04, 0.34, 0.3, 2, 0.06), this.trimMat);
    bumperF.position.set(0, GROUND_Y + 0.38, FRONT_Z + 0.12);
    this.group.add(bumperF);
    const bumperB = bumperF.clone();
    bumperB.position.z = BACK_Z - 0.12;
    this.group.add(bumperB);

    // Windschutzscheibe: groß, leicht geneigt
    const wsW = 2.34, wsH = 1.62;
    this.windshield = new THREE.Mesh(new THREE.PlaneGeometry(wsW, wsH), this.windshieldMat);
    this.windshield.position.set(0, GROUND_Y + 1.95, FRONT_Z - 0.005);
    this.windshield.rotation.x = Math.PI; // zeigt nach -Z
    this.windshield.rotation.y = Math.PI;
    this.windshield.rotateX(-0.1); // oben leicht nach hinten
    this.windshield.castShadow = false;
    this.group.add(this.windshield);

    // Scheibenrahmen (schwarzer Trim um die Frontscheibe)
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 0.08), this.trimMat);
    frameTop.position.set(0, GROUND_Y + 2.82, FRONT_Z + 0.03);
    this.group.add(frameTop);

    // Zielanzeige
    const destTex = makeMatrixDisplay('73  Hauptbahnhof');
    this.destDisplay = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 0.3),
      new THREE.MeshBasicMaterial({ map: destTex, toneMapped: false })
    );
    this.destDisplay.position.set(0, GROUND_Y + 2.62, FRONT_Z - 0.06);
    this.destDisplay.rotation.y = Math.PI;
    this.destDisplay.castShadow = false;
    this.group.add(this.destDisplay);
    const destHousing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.38, 0.1), this.trimMat);
    destHousing.position.set(0, GROUND_Y + 2.62, FRONT_Z + 0.0);
    this.group.add(destHousing);

    // Seitliche & hintere Liniennummer
    const sideNumTex = makeMatrixDisplay('73', 128, 64);
    const sideNum = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.15),
      new THREE.MeshBasicMaterial({ map: sideNumTex, toneMapped: false })
    );
    sideNum.position.set(HALF_W + 0.002, GROUND_Y + 2.3, -3.4);
    sideNum.rotation.y = Math.PI / 2;
    this.group.add(sideNum);
    const backNum = sideNum.clone();
    backNum.position.set(0.6, GROUND_Y + 2.45, BACK_Z + 0.002);
    backNum.rotation.y = 0;
    this.group.add(backNum);

    // Kühlergrill / Scania-Front (schwarzes Panel unten an der Front)
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.32, 0.06), this.trimMat);
    grille.position.set(0, GROUND_Y + 0.85, FRONT_Z - 0.01);
    this.group.add(grille);

    // Dach-Klimaanlage
    const ac = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.3, 3.6, 2, 0.08), this.skirtMat);
    ac.position.set(0, ROOF_Y + 0.15, 1.0);
    this.group.add(ac);

    // Wischerarme (2) — rotieren in update()
    this.wiperPivots = [];
    for (const wx of [-0.62, 0.55]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, GROUND_Y + 1.18, FRONT_Z - 0.04);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.95, 0.02), this.trimMat);
      arm.position.y = 0.47;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.78, 0.015), this.rubberMat);
      blade.position.set(0.04, 0.62, 0);
      pivot.add(arm, blade);
      pivot.rotation.z = -0.25;
      this.group.add(pivot);
      this.wiperPivots.push(pivot);
    }
  }

  _buildWindows() {
    // Durchgehendes Fensterband beidseitig + Heckscheibe.
    const bandY = GROUND_Y + 1.95;
    const bandH = 1.05;
    const winL = new THREE.Mesh(new THREE.BoxGeometry(0.04, bandH, 11.2), this.glassMat);
    winL.position.set(-HALF_W + 0.01, bandY, 0.15);
    winL.castShadow = false;
    this.group.add(winL);
    // rechts: Band ausgespart an den Türen → drei Segmente
    const segs = [[-4.2, -0.65], [0.65, 3.05], [4.35, 5.8]];
    for (const [z0, z1] of segs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, bandH, z1 - z0), this.glassMat);
      m.position.set(HALF_W - 0.01, bandY, (z0 + z1) / 2);
      m.castShadow = false;
      this.group.add(m);
    }
    // Fensterband vorn links neben der Windschutzscheibe bis Tür 1 hinten
    const backWin = new THREE.Mesh(new THREE.BoxGeometry(1.9, bandH * 0.8, 0.04), this.glassMat);
    backWin.position.set(0, bandY, BACK_Z - 0.015);
    backWin.castShadow = false;
    this.group.add(backWin);

    // Fensterholme (Pfosten zwischen den Scheiben) — dunkle dünne Boxen
    for (const z of [-3.2, -1.9, 1.5, 2.5, 4.9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, bandH, 0.07), this.trimMat);
      post.position.set(-HALF_W + 0.02, bandY, z);
      this.group.add(post);
    }
  }

  _buildDoors() {
    // Innenschwenktüren: je zwei Flügel, Drehpunkt an den Außenkanten.
    this.doorPivots = []; // [ [pivotA, pivotB], ... ]
    const doorH = 2.15;
    const doorY = GROUND_Y + 0.35 + doorH / 2;

    DOOR_RANGES.forEach(([z0, z1]) => {
      const mid = (z0 + z1) / 2;
      const leafW = (z1 - z0) / 2 - 0.015;
      const pair = [];
      for (const sideFlag of [0, 1]) { // 0 = vordere Hälfte, 1 = hintere
        const hingeZ = sideFlag === 0 ? z0 : z1;
        const pivot = new THREE.Group();
        pivot.position.set(HALF_W - 0.05, doorY, hingeZ);
        const dir = sideFlag === 0 ? 1 : -1;
        // Flügel: unten Paneel, oben Glas
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, doorH * 0.45, leafW), this.paintMat);
        panel.position.set(0, -doorH * 0.275, dir * leafW / 2);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, doorH * 0.52, leafW - 0.06), this.glassMat);
        glass.position.set(0, doorH * 0.24, dir * leafW / 2);
        glass.castShadow = false;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, doorH, 0.04), this.rubberMat);
        edge.position.set(0, 0, dir * (leafW - 0.02));
        pivot.add(panel, glass, edge);
        pivot.userData.dir = dir;
        this.group.add(pivot);
        pair.push(pivot);
      }
      this.doorPivots.push(pair);
    });
  }

  _buildWheels() {
    // Reifen als abgeflachter Torus + Felge; hinten optisch verbreitert (Zwilling)
    this.wheelMeshes = [];
    const tireGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 28);
    tireGeo.rotateZ(Math.PI / 2);
    const twinGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.55, 28);
    twinGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.31, 20);
    rimGeo.rotateZ(Math.PI / 2);

    const positions = [
      [-TRACK / 2, -WHEELBASE / 2, false], [TRACK / 2, -WHEELBASE / 2, false],
      [-TRACK / 2, WHEELBASE / 2, true], [TRACK / 2, WHEELBASE / 2, true],
    ];
    positions.forEach(([x, z, twin]) => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(twin ? twinGeo : tireGeo, this.rubberMat);
      const rim = new THREE.Mesh(rimGeo, this.rimMat);
      rim.position.x = (x < 0 ? -1 : 1) * 0.01;
      // Radbolzen
      for (let b = 0; b < 8; b++) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 6), this.trimMat);
        bolt.geometry.rotateZ(Math.PI / 2);
        const a = (b / 8) * Math.PI * 2;
        bolt.position.set(0, Math.cos(a) * 0.17, Math.sin(a) * 0.17);
        g.add(bolt);
      }
      g.add(tire, rim);
      g.position.set(x, -0.85, z);
      this.group.add(g);
      this.wheelMeshes.push(g);

      // Radkasten (dunkle Wanne)
      const arch = new THREE.Mesh(
        new THREE.CylinderGeometry(WHEEL_R + 0.14, WHEEL_R + 0.14, 0.36, 16, 1, false, 0, Math.PI),
        this.trimMat
      );
      arch.geometry.rotateZ(Math.PI / 2);
      arch.position.set(x, -0.85, z);
      this.group.add(arch);
    });
  }

  _buildLights() {
    // Scheinwerfer
    this.headlightMat = new THREE.MeshStandardMaterial({
      color: 0xdddddd, emissive: 0xffffee, emissiveIntensity: 0, roughness: 0.2,
    });
    this.headlights = [];
    for (const x of [-0.85, 0.85]) {
      const hl = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.2, 0.06, 2, 0.04), this.headlightMat);
      hl.position.set(x, GROUND_Y + 0.66, FRONT_Z - 0.015);
      hl.castShadow = false;
      this.group.add(hl);
      this.headlights.push(hl);
    }
    // Spots (schattenlos, nur nachts an)
    this.spotLights = [];
    for (const x of [-0.85, 0.85]) {
      const spot = new THREE.SpotLight(0xfff4d8, 0, 60, 0.55, 0.5, 1.2);
      spot.position.set(x, GROUND_Y + 0.7, FRONT_Z);
      const target = new THREE.Object3D();
      target.position.set(x, GROUND_Y - 0.4, FRONT_Z - 18);
      this.group.add(spot, target);
      spot.target = target;
      this.spotLights.push(spot);
    }

    // Rücklichter / Bremslichter
    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0x550000, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.3,
    });
    for (const x of [-0.95, 0.95]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.05), this.tailMat);
      tl.position.set(x, GROUND_Y + 0.85, BACK_Z + 0.01);
      tl.castShadow = false;
      this.group.add(tl);
    }

    // Blinker: vorn, hinten, seitlich
    this.blinkerMatL = new THREE.MeshStandardMaterial({
      color: 0x694208, emissive: 0xffa008, emissiveIntensity: 0, roughness: 0.3,
    });
    this.blinkerMatR = this.blinkerMatL.clone();
    const blinkerGeo = new THREE.BoxGeometry(0.16, 0.12, 0.05);
    const sideBlinkGeo = new THREE.BoxGeometry(0.05, 0.1, 0.18);
    const positionsL = [
      [-1.05, GROUND_Y + 0.66, FRONT_Z - 0.015, blinkerGeo],
      [-0.95, GROUND_Y + 1.15, BACK_Z + 0.01, blinkerGeo],
      [-HALF_W - 0.005, GROUND_Y + 1.0, -4.8, sideBlinkGeo],
    ];
    const positionsR = positionsL.map(([x, y, z, g]) => [-x, y, z, g]);
    for (const [x, y, z, g] of positionsL) {
      const m = new THREE.Mesh(g, this.blinkerMatL);
      m.position.set(x, y, z);
      m.castShadow = false;
      this.group.add(m);
    }
    for (const [x, y, z, g] of positionsR) {
      const m = new THREE.Mesh(g, this.blinkerMatR);
      m.position.set(x, y, z);
      m.castShadow = false;
      this.group.add(m);
    }
  }

  _buildInterior() {
    // Boden
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 11.6), this.floorMat);
    floor.position.set(0, FLOOR_Y - 0.03, 0);
    this.group.add(floor);

    // Innenwände (leicht nach innen versetzte Schalen)
    const wallGeo = new THREE.BoxGeometry(0.03, 1.0, 11.5);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wallGeo, this.innerWallMat);
      w.position.set(sx * (HALF_W - 0.07), FLOOR_Y + 0.5, 0.1);
      w.castShadow = false;
      this.group.add(w);
    }
    // Decke
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 11.6), this.ceilingMat);
    ceiling.position.set(0, ROOF_Y - 0.55, 0);
    ceiling.castShadow = false;
    this.group.add(ceiling);

    // Deckenlicht-Streifen
    this.cabinLightMat = new THREE.MeshStandardMaterial({
      color: 0xf4f2ea, emissive: 0xfff4dd, emissiveIntensity: 0.9, roughness: 0.4,
    });
    for (const sx of [-0.55, 0.55]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 10.8), this.cabinLightMat);
      strip.position.set(sx, ROOF_Y - 0.56, 0);
      strip.castShadow = false;
      this.group.add(strip);
    }
    // Echte Innenlichter (2 PointLights, schattenlos, gedimmt)
    this.cabinLights = [];
    for (const z of [-3, 2.5]) {
      const pl = new THREE.PointLight(0xfff0d8, 0.5, 8, 1.6);
      pl.position.set(0, ROOF_Y - 0.7, z);
      this.group.add(pl);
      this.cabinLights.push(pl);
    }

    // Radkasten-Boxen innen
    for (const [x, z] of [[-0.78, -WHEELBASE / 2], [0.78, -WHEELBASE / 2], [-0.78, WHEELBASE / 2], [0.78, WHEELBASE / 2]]) {
      const box = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.46, 1.45, 2, 0.05), this.innerWallMat);
      box.position.set(x, FLOOR_Y + 0.2, z);
      this.group.add(box);
    }

    // --- Sitze (instanziert)
    this._buildSeats();
    // --- Haltestangen
    this._buildPoles();

    // „Wagen hält"-Schild + Innenanzeige vorn an der Decke
    this.stopSignTex = makeMatrixDisplay('Wagen hält', 384, 80, '#ff3322');
    this.nextStopTex = { tex: null, canvas: null };
    this.stopSign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.16),
      new THREE.MeshBasicMaterial({ map: this.stopSignTex, transparent: false, toneMapped: false })
    );
    this.stopSign.position.set(0, ROOF_Y - 0.72, -3.6);
    this.stopSign.visible = false;
    this.group.add(this.stopSign);
    const signHousing = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.24, 0.06), this.trimMat);
    signHousing.position.set(0, ROOF_Y - 0.72, -3.63);
    this.group.add(signHousing);

    // Fahrerabtrennung hinter dem Fahrerplatz
    const partition = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, 1.0), this.glassMat);
    partition.position.set(-0.62, FLOOR_Y + 1.05, -4.0);
    partition.castShadow = false;
    this.group.add(partition);
  }

  _buildSeats() {
    // Ein Sitz = Schale (Sitzfläche + Lehne) + Fußbügel. Per InstancedMesh.
    const seatPositions = [];
    this.seatWorldSlots = []; // für das Fahrgastsystem: {pos: Vector3 lokal, taken}

    // Sitzreihen: 2+2 ab Mitteltür nach hinten (Hochflur-Heck), Einzelreihen vorn links
    const rows = [
      // [z, links2er, rechts2er]
      [-3.3, true, false], [-2.4, true, false],
      [1.2, true, true], [2.0, true, true], [2.8, true, true],
      [3.7, true, false], [4.6, true, true], [5.4, true, true],
    ];
    for (const [z, left, right] of rows) {
      if (left) {
        seatPositions.push([-0.88, z, 1], [-0.42, z, 1]);
      }
      if (right) {
        seatPositions.push([0.88, z, 1], [0.42, z, 1]);
      }
    }
    // (keine Sitze vor dem Fahrerbereich — freie Sicht auf die Frontscheibe)

    const shellGeo = this._seatGeometry();
    this.seatInst = new THREE.InstancedMesh(shellGeo, this.seatMat, seatPositions.length);
    const m = new THREE.Matrix4();
    seatPositions.forEach(([x, z], i) => {
      const seatY = FLOOR_Y + (Math.abs(z) > 3 || z > 0.9 ? 0.35 : 0.12); // Podest hinten
      m.makeTranslation(x, seatY, z);
      this.seatInst.setMatrixAt(i, m);
      this.seatWorldSlots.push({
        local: new THREE.Vector3(x, seatY + 0.55, z),
        taken: false,
      });
    });
    this.seatInst.instanceMatrix.needsUpdate = true;
    this.seatInst.castShadow = true;
    this.group.add(this.seatInst);
  }

  _seatGeometry() {
    // Sitzfläche + leicht geneigte Lehne, gerundet
    const geos = [];
    const seat = new RoundedBoxGeometry(0.42, 0.08, 0.42, 2, 0.03);
    seat.translate(0, 0.42, 0);
    geos.push(seat);
    const back = new RoundedBoxGeometry(0.42, 0.62, 0.07, 2, 0.03);
    back.rotateX(0.12);
    back.translate(0, 0.78, 0.2);
    geos.push(back);
    // BoxGeometry ist indexed, RoundedBox nicht → vor dem Merge angleichen
    const legs = new THREE.BoxGeometry(0.36, 0.4, 0.05).toNonIndexed();
    legs.translate(0, 0.2, 0.05);
    geos.push(legs);
    // mergen
    return mergeGeometriesCompat(geos);
  }

  _buildPoles() {
    const poleGeo = new THREE.CylinderGeometry(0.018, 0.018, ROOF_Y - 0.6 - FLOOR_Y, 10);
    const positions = [
      [-0.6, -1.4], [0.6, -1.4], [-0.6, 0.9], [0.6, 0.9],
      [0.95, -0.7], [0.95, 0.7], // an Tür 2
      [-0.6, 3.4], [0.6, 3.4],
    ];
    this.poleInst = new THREE.InstancedMesh(poleGeo, this.poleMat, positions.length);
    const m = new THREE.Matrix4();
    positions.forEach(([x, z], i) => {
      m.makeTranslation(x, (FLOOR_Y + ROOF_Y - 0.6) / 2, z);
      this.poleInst.setMatrixAt(i, m);
    });
    this.poleInst.instanceMatrix.needsUpdate = true;
    this.group.add(this.poleInst);

    // Horizontale Deckenstangen
    for (const sx of [-0.6, 0.6]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 9.5, 8), this.poleMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(sx, ROOF_Y - 0.62, 0.3);
      this.group.add(rail);
    }

    // Haltewunsch-Knöpfe an den Stangen
    this.stopButtons = [];
    const btnGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.015, 12);
    const btnMat = new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.4 });
    for (const [x, z] of [[-0.6, -1.4], [0.6, 0.9], [0.6, 3.4]]) {
      const b = new THREE.Mesh(btnGeo, btnMat);
      b.rotation.z = Math.PI / 2;
      b.position.set(x + (x > 0 ? -0.02 : 0.02), FLOOR_Y + 1.25, z);
      this.group.add(b);
      this.stopButtons.push(b);
    }
  }

  _buildMirrorMounts() {
    // Außenspiegel-Gehäuse; die Spiegelflächen kommen von Mirrors.js
    this.mirrorAnchors = {};
    const housingGeo = new RoundedBoxGeometry(0.06, 0.4, 0.25, 2, 0.03);

    // links: klassischer Auslegerspiegel
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), this.trimMat);
    armL.rotation.z = Math.PI / 2.4;
    armL.position.set(-HALF_W - 0.2, GROUND_Y + 2.45, FRONT_Z + 0.15);
    this.group.add(armL);
    const houseL = new THREE.Mesh(housingGeo, this.trimMat);
    houseL.position.set(-HALF_W - 0.4, GROUND_Y + 2.2, FRONT_Z + 0.12);
    this.group.add(houseL);
    this.mirrorAnchors.left = { pos: new THREE.Vector3(-HALF_W - 0.37, GROUND_Y + 2.2, FRONT_Z + 0.12), yaw: 0.32, pitch: -0.04 };

    // rechts
    const armR = armL.clone();
    armR.rotation.z = -Math.PI / 2.4;
    armR.position.x = HALF_W + 0.2;
    this.group.add(armR);
    const houseR = houseL.clone();
    houseR.position.x = HALF_W + 0.4;
    this.group.add(houseR);
    this.mirrorAnchors.right = { pos: new THREE.Vector3(HALF_W + 0.37, GROUND_Y + 2.2, FRONT_Z + 0.12), yaw: -0.32, pitch: -0.04 };

    // Innenspiegel über Tür 1 (Fahrgastraum-Blick)
    this.mirrorAnchors.interior = { pos: new THREE.Vector3(0.55, ROOF_Y - 0.75, -4.6), yaw: Math.PI - 0.35, pitch: -0.35 };
  }

  // ------------------------------------------------------------------ Update
  update(dt, env) {
    const bus = this.bus;

    // Türen
    bus.doors.doors.forEach((d, i) => {
      const angle = d.progress * 1.5; // ~86° nach innen
      const pair = this.doorPivots[i];
      pair[0].rotation.y = -angle * pair[0].userData.dir;
      pair[1].rotation.y = -angle * pair[1].userData.dir;
    });

    // Räder: Einfederung + Lenkung + Drehung
    bus.wheels.forEach((w, i) => {
      const g = this.wheelMeshes[i];
      const len = w.onGround ? (w.restLength - w.compression) : w.restLength;
      g.position.y = w.localPos.y - len;
      g.rotation.set(0, w.steerAngle, 0);
      g.rotateX(-w.spinAngle);
    });

    // Wischer
    const sweep = bus.wipers.sweep;
    for (const p of this.wiperPivots) {
      p.rotation.z = -0.25 + sweep * 1.75;
    }

    // Lichter
    const night = env ? env.night : 0;
    this.headlightMat.emissiveIntensity = bus.lightsOn ? 3.0 : 0;
    for (const s of this.spotLights) {
      s.intensity = bus.lightsOn ? 25 * (0.3 + night * 0.7) : 0;
    }
    const braking = bus.wheels[0].brakeTorque > 500 || bus.stopBrake;
    this.tailMat.emissiveIntensity = (bus.lightsOn ? 0.8 : 0.15) + (braking ? 2.6 : 0);

    const blinkL = bus.blinkOn && (bus.hazard || bus.blinker === -1);
    const blinkR = bus.blinkOn && (bus.hazard || bus.blinker === 1);
    this.blinkerMatL.emissiveIntensity = blinkL ? 3.4 : 0;
    this.blinkerMatR.emissiveIntensity = blinkR ? 3.4 : 0;

    // Innenlicht
    const cabinOn = bus.interiorLightsOn;
    this.cabinLightMat.emissiveIntensity = cabinOn ? 0.45 + night * 0.6 : 0.02;
    for (const pl of this.cabinLights) pl.intensity = cabinOn ? 0.25 + night * 0.55 : 0;

    // Wagen hält
    this.stopSign.visible = bus.stopRequested;
  }
}

// Kompatibler Geometrie-Merge ohne Extra-Import an mehreren Stellen
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeGeometriesCompat(geos) {
  return mergeGeometries(geos);
}
