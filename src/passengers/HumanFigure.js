// Prozeduraler Mensch: Kapsel-Gliedmaßen an Gelenk-Pivots, weich schattiert.
// Zweigliedrige Beine (Oberschenkel→Schienbein→Schuh), Hals, Hände, Gesicht,
// Frisur-Varianten (kurz/lang/Kappe/Glatze), Rock-Variante und Props
// (Handtasche/Rucksack/Schirm). Kleidungsfarben aus geseedeten Paletten
// (Material-Pools, damit nicht jede Figur eigene Materialien anlegt).
// Posen: stehen, gehen, winken, sitzen.
//
// Detail-Stufen (Konstruktor-Option):
//   'low'  = Torso, Kopf, Haar, Arme, 2-teilige Beine, Hips (~9 Meshes)
//   'med'  = + Schuhe
//   'high' = + Hals, Hände, Gesicht, Props (Default)

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SKIN_TONES = [0xe8bf9a, 0xc89066, 0x9a6a42, 0x6e4a2e, 0xf0ccab];
const SHIRT_COLORS = [0x3a4a6b, 0x6b3a3a, 0x3a6b4a, 0x5a5a5e, 0x8a7340, 0x466278, 0x7d4a68, 0x2e2e34];
const JACKET_COLORS = [0x23303f, 0x402a2a, 0x2e4034, 0x37474f, 0x5a3a52, 0x8f2430, 0xc7a23a, 0x4a6fa5];
const PANTS_COLORS = [0x26282e, 0x3b3e46, 0x4a3b2e, 0x2e3b4a];
const HAIR_COLORS = [0x1c1813, 0x3b2c1a, 0x6e5635, 0x8a8a8c, 0x2a2a2e, 0xa56b32, 0xcdbf9a];
const SHOE_COLORS = [0x1a1a1c, 0x3a2c20, 0x5a5a5e, 0x8a8580];

const matPools = {
  skin: new Map(), shirt: new Map(), jacket: new Map(), pants: new Map(),
  hair: new Map(), shoes: new Map(), skirt: new Map(),
};
function pooledMat(pool, color, extra) {
  if (!matPools[pool].has(color)) {
    matPools[pool].set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...extra }));
  }
  return matPools[pool].get(color);
}

// EIN geteiltes Gesicht für alle Figuren: 64x32-Canvas (Augen + Brauen) auf
// transparentem Material; polygonOffset, damit die Plane nicht mit der
// Kopfkugel z-fightet. Lazy erzeugt (braucht DOM).
let faceMat = null;
function getFaceMat() {
  if (faceMat) return faceMat;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 32);
  ctx.fillStyle = 'rgba(26, 20, 15, 0.95)';
  ctx.fillRect(16, 9, 11, 3);  // Braue links
  ctx.fillRect(37, 9, 11, 3);  // Braue rechts
  ctx.beginPath(); ctx.arc(21.5, 18, 3.2, 0, Math.PI * 2); ctx.fill(); // Auge links
  ctx.beginPath(); ctx.arc(42.5, 18, 3.2, 0, Math.PI * 2); ctx.fill(); // Auge rechts
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  faceMat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, roughness: 0.85,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return faceMat;
}

// Geometrien geteilt (Modul-weit, eine Instanz für alle Figuren)
const headGeo = new THREE.SphereGeometry(0.105, 12, 10);
const hairGeo = new THREE.SphereGeometry(0.108, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
// Lange Haare: Kugelkappe + Strähnenbox am Hinterkopf
const hairLongGeo = mergeGeometries([
  hairGeo.clone(),
  new THREE.BoxGeometry(0.16, 0.22, 0.06).translate(0, -0.10, -0.085),
]);
// Kappe: Zylinder + Schirm nach vorn (+z = Blickrichtung)
const capGeo = mergeGeometries([
  new THREE.CylinderGeometry(0.105, 0.105, 0.07, 12),
  new THREE.BoxGeometry(0.10, 0.015, 0.10).translate(0, -0.03, 0.12),
]);
const torsoGeo = new THREE.CapsuleGeometry(0.16, 0.34, 4, 10);
const neckGeo = new THREE.CylinderGeometry(0.042, 0.048, 0.07, 8);
const armGeo = new THREE.CapsuleGeometry(0.045, 0.52, 3, 8).translate(0, -0.31, 0); // Pivot Schulter
const handGeo = new THREE.SphereGeometry(0.042, 8, 6);
const faceGeo = new THREE.PlaneGeometry(0.10, 0.05);
// Bein-Kette: Oberschenkel (Pivot Hüfte) → Schienbein (Pivot Knie) → Schuh.
// Hüfte liegt bei Welt-y 1.01 (pelvis 0.99 + Ansatz 0.02), Knie bei -0.44
// darunter (y 0.57); Schuh-Box (Höhe 0.08) zentriert bei -0.53 → Sohle
// bei 0.57 - 0.53 - 0.04 = 0.00, exakt am Boden.
const thighGeo = new THREE.CapsuleGeometry(0.066, 0.36, 3, 8).translate(0, -0.22, 0);
const shinGeo = new THREE.CapsuleGeometry(0.054, 0.40, 3, 8).translate(0, -0.24, 0);
const shoeGeo = new THREE.BoxGeometry(0.09, 0.08, 0.22).translate(0, -0.53, 0.045);
const hipsGeo = new THREE.CylinderGeometry(0.15, 0.165, 0.16, 10);
const skirtGeo = new THREE.CylinderGeometry(0.165, 0.27, 0.34, 10, 1, true).translate(0, -0.05, 0);
// Props
const bagGeo = new THREE.BoxGeometry(0.20, 0.26, 0.09);
const packGeo = new THREE.BoxGeometry(0.24, 0.32, 0.11);
const umbrellaGeo = new THREE.CylinderGeometry(0.018, 0.025, 0.72, 8).translate(0, -0.36, 0);

export class HumanFigure {
  // detail: 'low' | 'med' | 'high'; props/rainy steuern Accessoires (nur 'high').
  // Default-Objekt hält bestehende Aufrufer (new HumanFigure(rand)) kompatibel.
  constructor(rand, { detail = 'high', props = false, rainy = false } = {}) {
    this.group = new THREE.Group();
    const lvl = detail === 'low' ? 0 : detail === 'med' ? 1 : 2;

    const isChild = rand.chance(0.10);
    this.scale = isChild ? 0.62 : rand.float(0.92, 1.08);

    const skin = pooledMat('skin', rand.pick(SKIN_TONES));
    // Zweiteilung: Oberteil (Jacke oder Shirt) + Hose
    const top = rand.chance(0.6)
      ? pooledMat('jacket', rand.pick(JACKET_COLORS))
      : pooledMat('shirt', rand.pick(SHIRT_COLORS));
    const pants = pooledMat('pants', rand.pick(PANTS_COLORS));
    const hair = pooledMat('hair', rand.pick(HAIR_COLORS));
    const shoes = pooledMat('shoes', rand.pick(SHOE_COLORS));
    const hasSkirt = rand.chance(0.18);
    const hairRoll = rand.float(0, 1); // kurz 0.45 / lang 0.2 / Kappe 0.2 / Glatze 0.15
    this.bag = null; // Handtasche (für Sitz-Pose: auf den Schoß)

    // Wurzel am Boden; Körper hängt an der Hüfte
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 0.99;
    this.group.add(this.pelvis);

    this.torso = this._mesh(torsoGeo, top, this.pelvis, 0, 0.33, 0);
    this.torso.scale.set(rand.float(0.85, 1.15), 1, rand.float(0.85, 1.1)); // Statur-Varianz

    this.head = this._mesh(headGeo, skin, this.pelvis, 0, 0.71, 0);
    if (hairRoll < 0.45) {
      const h = this._mesh(hairGeo, hair, this.head, 0, 0.02, 0, true);
      h.rotation.x = -0.15;
    } else if (hairRoll < 0.65) {
      const h = this._mesh(hairLongGeo, hair, this.head, 0, 0.02, 0, true);
      h.rotation.x = -0.15;
    } else if (hairRoll < 0.85) {
      this._mesh(capGeo, pooledMat('jacket', rand.pick(JACKET_COLORS)), this.head, 0, 0.055, 0, true);
    } // sonst Glatze

    this.armL = this._mesh(armGeo, top, this.pelvis, -0.215, 0.52, 0);
    this.armR = this._mesh(armGeo, top, this.pelvis, 0.215, 0.52, 0);

    // Rock-Variante: nackte Beine, Rock statt Hüft-Zylinder
    const legMat = hasSkirt ? skin : pants;
    this.thighL = this._mesh(thighGeo, legMat, this.pelvis, -0.09, 0.02, 0);
    this.thighR = this._mesh(thighGeo, legMat, this.pelvis, 0.09, 0.02, 0);
    this.shinL = this._mesh(shinGeo, legMat, this.thighL, 0, -0.44, 0);
    this.shinR = this._mesh(shinGeo, legMat, this.thighR, 0, -0.44, 0);
    // Alias für Alt-Code, der noch legL/legR anfasst
    this.legL = this.thighL;
    this.legR = this.thighR;

    if (hasSkirt) {
      this._mesh(skirtGeo, pooledMat('skirt', rand.pick(PANTS_COLORS), { side: THREE.DoubleSide }), this.pelvis, 0, 0, 0);
    } else {
      this._mesh(hipsGeo, pants, this.pelvis, 0, 0, 0);
    }

    if (lvl >= 1) {
      this._mesh(shoeGeo, shoes, this.shinL, 0, 0, 0, true);
      this._mesh(shoeGeo, shoes, this.shinR, 0, 0, 0, true);
    }

    if (lvl >= 2) {
      this._mesh(neckGeo, skin, this.pelvis, 0, 0.63, 0, true);
      this._mesh(handGeo, skin, this.armL, 0, -0.65, 0, true);
      this._mesh(handGeo, skin, this.armR, 0, -0.65, 0, true);
      const face = this._mesh(faceGeo, getFaceMat(), this.head, 0, 0.005, 0.104, true); // Blick +z
      face.receiveShadow = false;

      // Props: Handtasche ODER Rucksack ODER (bei Regen) Schirm
      if (props && !isChild && rand.chance(0.35)) {
        const propMat = pooledMat('jacket', rand.pick(JACKET_COLORS));
        const r = rand.float(0, 1);
        if (rainy && r < 0.34) {
          this._mesh(umbrellaGeo, propMat, this.armR, 0, -0.65, 0, true); // in der Hand, Spitze ~Boden
        } else if (r < 0.67) {
          this.bag = this._mesh(bagGeo, propMat, this.armR, 0.04, -0.68, 0.03, true); // Handtasche rechts
        } else {
          this._mesh(packGeo, propMat, this.torso, 0, 0.02, -0.20, true); // Rucksack
        }
      }
    }

    this.group.scale.setScalar(this.scale);
    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = !o.userData.small; } // Kleinteile werfen keinen Schatten
    });

    this.idlePhase = rand.float(0, 10);
    this._pose = 'stand';
    this._hailAmount = 0;
  }

  // Mesh anlegen, positionieren, anhängen; small = Kleinteil (kein Schattenwurf)
  _mesh(geo, mat, parent, x = 0, y = 0, z = 0, small = false) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (small) m.userData.small = true;
    parent.add(m);
    return m;
  }

  setPose(pose) {
    this._pose = pose;
  }

  // time: globale Zeit, walkPhase: Distanz-getriebene Phase
  update(time, walkPhase = 0) {
    const p = this._pose;

    if (p === 'sit') {
      this.pelvis.position.y = 0.62; // Aufrufer verlassen sich auf diesen Wert
      this.thighL.rotation.x = -1.5; // Oberschenkel waagerecht nach vorn
      this.thighR.rotation.x = -1.5;
      this.shinL.rotation.x = 1.35;  // Unterschenkel senkrecht: echte Sitzhaltung
      this.shinR.rotation.x = 1.35;
      const armX = this.bag ? -1.05 : -0.5; // Tasche auf dem Schoß halten
      this.armL.rotation.x = armX;
      this.armR.rotation.x = armX;
      this.armR.rotation.z = 0;
      this.torso.rotation.x = 0;
      return;
    }

    this.pelvis.position.y = 0.99;

    if (p === 'walk') {
      const a = Math.sin(walkPhase);
      const b = Math.sin(walkPhase + Math.PI);
      this.thighL.rotation.x = a * 0.55;
      this.thighR.rotation.x = b * 0.55;
      // Knie beugt im Rückschwung
      this.shinL.rotation.x = Math.max(0, -a) * 0.9;
      this.shinR.rotation.x = Math.max(0, -b) * 0.9;
      this.armL.rotation.x = b * 0.4;
      this.armR.rotation.x = a * 0.4;
      this.pelvis.position.y = 0.99 + Math.abs(Math.cos(walkPhase)) * 0.025;
      this.torso.rotation.x = 0.06;
      this._hailAmount *= 0.9;
      this.armR.rotation.z = -0.3 * this._hailAmount;
    } else {
      // stehen: leichtes Schwanken (auf Oberschenkel übertragen)
      const sway = Math.sin(time * 0.9 + this.idlePhase) * 0.02;
      this.thighL.rotation.x = sway;
      this.thighR.rotation.x = -sway;
      this.shinL.rotation.x = 0;
      this.shinR.rotation.x = 0;
      this.armL.rotation.x = sway * 1.5;
      this.torso.rotation.x = 0.01 + sway * 0.3;

      if (p === 'hail') {
        this._hailAmount = Math.min(1, this._hailAmount + 0.08);
      } else {
        this._hailAmount *= 0.9;
      }
      // Arm heben + leicht winken
      this.armR.rotation.x = -2.6 * this._hailAmount + Math.sin(time * 6) * 0.15 * this._hailAmount;
      this.armR.rotation.z = -0.3 * this._hailAmount;
    }
  }
}
