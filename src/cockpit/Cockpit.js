// Fahrerarbeitsplatz des Citywide: Konsole, Kombiinstrument (Tacho, Tank,
// Kühlmittel, 2× Luftdruck, ICU), Tasterfelder, Lenksäule, Wählhebel-Tasten,
// Feststellbremse, Fahrscheindrucker, Fahrersitz, Sonnenblende.
// Alles in Bus-Lokalkoordinaten (Gruppe hängt am BusModel).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Gauge } from './Gauges.js';
import { ICUDisplay } from './ICUDisplay.js';
import { CockpitButtons } from './Buttons.js';
import { SteeringColumn } from './SteeringColumn.js';
import { TicketPrinter } from './TicketPrinter.js';
import { Events } from '../core/Events.js';

const FLOOR_Y = -0.86;
const CAB_FLOOR = FLOOR_Y + 0.24;

// Augpunkt: ~2,0 m über Straße (Citywide-Fahrer sitzt hoch), gut 0,9 m
// hinter dem Armaturenbrett — sonst klebt man an der Scheibe.
export const DRIVER_EYE = new THREE.Vector3(-0.62, 0.82, -4.5);

// IBIS-Zielliste (Außenanzeige liest bus.destination)
const DESTINATIONS = ['Hauptbahnhof', 'Rathaus', 'Klinikum', 'Universität', 'Theater', 'Betriebshof'];

// Kontrollleuchten-Symbol auf dunklem Grund (kleine emissive Plane)
function telltaleTexture(kind, color) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, 96, 64);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cx = 48, cy = 32;
  switch (kind) {
    case 'arrowL':
      ctx.beginPath();
      ctx.moveTo(20, cy); ctx.lineTo(46, 10); ctx.lineTo(46, 54); ctx.closePath();
      ctx.fill();
      ctx.fillRect(48, cy - 9, 28, 18);
      break;
    case 'arrowR':
      ctx.beginPath();
      ctx.moveTo(76, cy); ctx.lineTo(50, 10); ctx.lineTo(50, 54); ctx.closePath();
      ctx.fill();
      ctx.fillRect(20, cy - 9, 28, 18);
      break;
    case 'beam': // Fernlicht: Lampe mit waagerechten Strahlen
      ctx.beginPath();
      ctx.arc(60, cy, 16, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(18, cy + i * 13); ctx.lineTo(40, cy + i * 13);
        ctx.stroke();
      }
      break;
    case 'door': // Tür offen
      ctx.strokeRect(26, 10, 18, 44);
      ctx.strokeRect(52, 10, 18, 44);
      break;
    case 'park':
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = 'bold 28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('P', cx, cy + 10);
      break;
    case 'ret1':
    case 'ret2':
    case 'ret3': // Retarder: Gefälle + Stufenziffer
      ctx.beginPath();
      ctx.moveTo(12, 18); ctx.lineTo(58, 50); ctx.lineTo(12, 50); ctx.closePath();
      ctx.stroke();
      ctx.font = 'bold 34px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(kind.slice(3), 76, 46);
      break;
    case 'asr':
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('ASR', cx, 28);
      ctx.font = 'bold 18px Arial';
      ctx.fillText('OFF', cx, 52);
      break;
    case 'stop': // Haltewunsch
      ctx.font = 'bold 26px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('STOP', cx, cy + 9);
      break;
    case 'release': // Türfreigabe: Tür + Pfeile nach außen
      ctx.strokeRect(38, 10, 20, 44);
      ctx.beginPath();
      ctx.moveTo(18, cy); ctx.lineTo(32, cy);
      ctx.moveTo(64, cy); ctx.lineTo(78, cy);
      ctx.stroke();
      break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Cockpit {
  constructor(bus, busModel) {
    this.bus = bus;
    this.group = new THREE.Group();
    this.buttons = new CockpitButtons();

    const dashMat = busModel.dashMat;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.55, envMapIntensity: 0.15 });

    // ---------- Podest & Konsole
    const podest = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, 1.9), darkMat);
    podest.position.set(-0.6, FLOOR_Y + 0.12, -4.8);
    this.group.add(podest);

    // Konsolenkörper (umgreift den Fahrer leicht)
    const dash = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.55, 0.45, 2, 0.06), dashMat);
    dash.position.set(-0.58, CAB_FLOOR + 0.62, -5.45);
    this.group.add(dash);
    // rechter Konsolenausläufer (zur Tür, trägt den Drucker)
    const dashR = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.45, 0.7, 2, 0.05), dashMat);
    dashR.position.set(0.1, CAB_FLOOR + 0.5, -5.25);
    this.group.add(dashR);

    // ---------- Kombiinstrument
    // Tief in den Armaturenträger integriert (Referenz: echtes Scania-/
    // The-Bus-Cockpit): der Blick geht DURCH die obere Lenkradöffnung auf
    // die Instrumente, die Oberkante bleibt weit unter der Frontscheibe —
    // freie Sicht auf die Straße ab ~4 m vor dem Bus.
    this.binnacle = new THREE.Group();
    this.binnacle.position.set(-0.64, CAB_FLOOR + 0.86, -5.19);
    this.binnacle.rotation.x = -0.3;
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.64, 0.32, 0.05, 2, 0.02), darkMat);
    this.binnacle.add(panel);
    this.group.add(this.binnacle);

    // Layout (Spieltest-Wunsch): ICU oben MITTIG — durch die obere
    // Radöffnung sichtbar, nicht hinter der Nabe —, Tacho links und
    // Drehzahlmesser rechts daneben, kleine Instrumente unten.
    // Tacho/DZM kleiner und dicht ans ICU gerückt — Innenkante 7,5 mm vor
    // der Display-Kante (±0.0775), damit nichts ins Display clippt
    this.gSpeed = new Gauge({ radius: 0.075, min: 0, max: 125, step: 25, label: 'km/h', lambda: 10 });
    this.gSpeed.group.position.set(-0.16, 0.045, 0.028);
    this.binnacle.add(this.gSpeed.group);

    // Drehzahlmesser mit ×100-Skala (0–25 = 0–2500 U/min, rot ab 2200)
    this.gRpm = new Gauge({ radius: 0.075, min: 0, max: 25, step: 5, label: 'U/min ×100', redFrom: 22, redTo: 25, lambda: 10 });
    this.gRpm.group.position.set(0.16, 0.045, 0.028);
    this.binnacle.add(this.gRpm.group);

    this.gFuel = new Gauge({ radius: 0.042, min: 0, max: 1, step: 1, label: 'Tank', redFrom: 0, redTo: 0.1, lambda: 2 });
    this.gFuel.group.position.set(-0.155, -0.105, 0.028);
    this.binnacle.add(this.gFuel.group);

    this.gTemp = new Gauge({ radius: 0.042, min: 40, max: 120, step: 40, label: '°C', redFrom: 105, redTo: 120, lambda: 2 });
    this.gTemp.group.position.set(-0.055, -0.105, 0.028);
    this.binnacle.add(this.gTemp.group);

    this.gAir1 = new Gauge({ radius: 0.042, min: 0, max: 12, step: 4, label: 'bar 1', redFrom: 0, redTo: 5.5, lambda: 4 });
    this.gAir1.group.position.set(0.055, -0.105, 0.028);
    this.binnacle.add(this.gAir1.group);

    this.gAir2 = new Gauge({ radius: 0.042, min: 0, max: 12, step: 4, label: 'bar 2', redFrom: 0, redTo: 5.5, lambda: 4 });
    this.gAir2.group.position.set(0.155, -0.105, 0.028);
    this.binnacle.add(this.gAir2.group);

    this.gauges = [this.gSpeed, this.gRpm, this.gFuel, this.gTemp, this.gAir1, this.gAir2];

    // ICU-Display oben mittig zwischen den großen Instrumenten
    this.icu = new ICUDisplay();
    this.icu.mesh.position.set(0, 0.075, 0.028);
    this.binnacle.add(this.icu.mesh);

    // Kontrollleuchten-Reihe zwischen Tacho und ICU
    this._buildTelltales();

    // ---------- Lenksäule (Kranz über dem tief liegenden Kombiinstrument:
    // Sichtlinie Auge → Panel-Oberkante läuft knapp über den Kranz)
    this.column = new SteeringColumn(dashMat);
    this.column.group.position.set(-0.63, CAB_FLOOR + 0.99, -4.82);
    this.group.add(this.column.group);

    // Klick aufs Lenkrad blendet es aus/ein (freie Sicht auf die
    // Instrumente); die unsichtbare Zone bleibt klickbar zum Wiedereinblenden.
    // Bewusst rechtslastig dimensioniert, damit die Blinkerhebel-Zonen
    // links daneben frei bleiben.
    this.buttons.createZone({
      size: new THREE.Vector3(0.36, 0.28, 0.2),
      position: new THREE.Vector3(-0.55, CAB_FLOOR + 0.99, -4.82),
      parent: this.group,
      name: 'wheelToggle',
      action: () => {
        this.column.wheelGroup.visible = !this.column.wheelGroup.visible;
      },
    });

    // Blinkerhebel-Klickzonen (über/unter dem Hebelknauf links der Säule)
    this.buttons.createZone({
      size: new THREE.Vector3(0.14, 0.08, 0.18),
      position: new THREE.Vector3(-0.87, CAB_FLOOR + 0.92, -4.84),
      parent: this.group,
      name: 'stalkUp',
      action: () => this._stalk(1),
    });
    this.buttons.createZone({
      size: new THREE.Vector3(0.14, 0.08, 0.18),
      position: new THREE.Vector3(-0.87, CAB_FLOOR + 0.76, -4.84),
      parent: this.group,
      name: 'stalkDown',
      action: () => this._stalk(-1),
    });
    // Hebelspitze drücken = Fernlicht (nur bei Abblendlicht wirksam)
    this.buttons.createZone({
      size: new THREE.Vector3(0.12, 0.08, 0.18),
      position: new THREE.Vector3(-0.97, CAB_FLOOR + 0.84, -4.84),
      parent: this.group,
      name: 'stalkPush',
      action: () => this._stalkPush(),
    });

    // Fahrerfenster: Klick auf die Schiebescheibe links öffnet/schließt
    // (BusModel animiert in 1,2 s; Event 'windowSlide' fürs Audio)
    this.buttons.createZone({
      size: new THREE.Vector3(0.10, 0.55, 0.75),
      position: new THREE.Vector3(-1.21, 0.72, -5.0),
      parent: this.group,
      name: 'driverWindow',
      action: () => busModel.toggleDriverWindow(),
    });

    // ---------- Tasterfelder
    this._buildButtonPanels(darkMat);
    this._buildSwitchBanks(darkMat);
    this._buildIBIS(darkMat);

    // ---------- Fahrerplatzleuchte (Leselampe überm Sitz)
    this.driverLamp = new THREE.PointLight(0xffe2b8, 0, 2.2, 2);
    this.driverLamp.position.set(-0.62, 1.35, -4.55);
    this.group.add(this.driverLamp);

    // ---------- Feststellbremshebel
    this._buildParkBrake(darkMat);

    // ---------- Fahrscheindrucker
    this.printer = new TicketPrinter(this.buttons);
    this.printer.group.position.set(0.12, CAB_FLOOR + 0.79, -5.18);
    this.printer.group.rotation.y = -0.5; // zum Einstiegsbereich gedreht
    this.printer.group.rotation.x = -0.25;
    this.group.add(this.printer.group);

    // ---------- Fahrersitz
    this._buildSeat(busModel);

    // ---------- Sonnenblende
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.02), darkMat);
    visor.position.set(-0.55, 1.45, -5.75);
    visor.rotation.x = 0.35;
    this.group.add(visor);
  }

  _stalk(dir) {
    const bus = this.bus;
    Events.emit('buttonPress');
    // hoch = rechts, runter = links; gleiche Richtung nochmal = aus
    if (dir === 1) bus.blinker = bus.blinker === 1 ? 0 : 1;
    else bus.blinker = bus.blinker === -1 ? 0 : -1;
  }

  _stalkPush() {
    const bus = this.bus;
    Events.emit('buttonPress');
    if (bus.lightsMode >= 2) bus.highBeam = !bus.highBeam;
  }

  // Kontrollleuchten-Reihe: 9 kleine Icon-Planes zwischen Tacho und ICU
  // (x ±0.0945 — bleibt frei von den kleinen Rundinstrumenten bei |x| ≥ 0.108)
  _buildTelltales() {
    const geo = new THREE.PlaneGeometry(0.022, 0.015);
    const defs = [
      ['arrowL',  '#36d24b', (b) => b.blinkOn && (b.hazard || b.blinker === -1)],
      ['beam',    '#3d86ff', (b) => b.highBeam && b.lightsMode >= 2],
      ['ret1',    '#ff9a2e', (b) => b.retarderLevel > 0],
      ['door',    '#e03333', (b) => b.doors.anyOpen],
      ['park',    '#e03333', (b) => b.parkingBrake || b.air.springBrakeApplied],
      ['asr',     '#ff9a2e', (b) => !b.asrOn],
      ['stop',    '#ffd23e', (b) => b.stopRequested],
      ['release', '#36d24b', (b) => b.doorReleased],
      ['arrowR',  '#36d24b', (b) => b.blinkOn && (b.hazard || b.blinker === 1)],
    ];
    this.telltales = defs.map(([kind, color, get], i) => {
      const mat = new THREE.MeshBasicMaterial({ map: telltaleTexture(kind, color), toneMapped: false });
      mat.color.setScalar(0.12); // aus: nur schwach erkennbar
      const mesh = new THREE.Mesh(geo, mat);
      // mittig zwischen ICU-Unterkante und unterer Instrumentenreihe
      mesh.position.set((i - 4) * 0.024, -0.04, 0.0285);
      this.binnacle.add(mesh);
      return { mat, get };
    });
    // Retarder-Leuchte zeigt die Stufe — Texturen zum Umschalten vorhalten
    this._retTex = [1, 2, 3].map((n) => telltaleTexture('ret' + n, '#ff9a2e'));
    this._retShown = 1;
  }

  // Linke + rechte Schalterbank: zweite „Terrasse" vor der Konsole,
  // flankiert die Lenksäule — verdeckt keine Instrumente.
  _buildSwitchBanks(darkMat) {
    const bus = this.bus;
    const addBtn = (parent, x, y, cfg) => this.buttons.createButton({
      ...cfg,
      parent,
      position: new THREE.Vector3(x, y, 0.018),
    });

    // Flacher Sockel ganz unter dem geneigten Panel — Tastenfronten bleiben
    // vor der Sockelfront, nichts taucht ins Kunststoff ein.
    const makeBank = (x, w) => {
      const sockel = new THREE.Mesh(new RoundedBoxGeometry(w + 0.03, 0.1, 0.16, 2, 0.02), darkMat);
      sockel.position.set(x, CAB_FLOOR + 0.72, -5.23);
      this.group.add(sockel);
      const panel = new THREE.Mesh(new RoundedBoxGeometry(w, 0.13, 0.03, 2, 0.01), darkMat);
      panel.position.set(x, CAB_FLOOR + 0.8, -5.19);
      panel.rotation.x = -0.5;
      this.group.add(panel);
      return panel;
    };

    // ----- links: Lichtstufen (exklusiv) + Fahrerlicht + Dimmer
    const bankL = makeBank(-1.08, 0.18);
    addBtn(bankL, -0.055, 0.032, {
      symbol: 'light-off', label: 'AUS',
      action: () => { bus.lightsMode = 0; },
      getLit: () => bus.lightsMode === 0 ? 1 : 0,
    });
    addBtn(bankL, 0, 0.032, {
      symbol: 'park-light', label: 'STAND',
      action: () => { bus.lightsMode = 1; },
      getLit: () => bus.lightsMode === 1 ? 1 : 0,
    });
    addBtn(bankL, 0.055, 0.032, {
      symbol: 'light', label: 'FAHR',
      action: () => { bus.lightsMode = 2; },
      getLit: () => bus.lightsMode === 2 ? 1 : 0,
    });
    addBtn(bankL, -0.055, -0.025, {
      symbol: 'driverlight', label: 'FAHRER',
      action: () => { bus.driverLight = !bus.driverLight; },
      getLit: () => bus.driverLight ? 1 : 0,
    });
    addBtn(bankL, 0, -0.025, {
      symbol: 'dim-', label: 'DIM',
      action: () => { bus.dashDim = Math.max(0.4, Math.round((bus.dashDim - 0.15) * 100) / 100); },
      getLit: () => 0,
    });
    addBtn(bankL, 0.055, -0.025, {
      symbol: 'dim+', label: 'DIM',
      action: () => { bus.dashDim = Math.min(1.0, Math.round((bus.dashDim + 0.15) * 100) / 100); },
      getLit: () => 0,
    });

    // ----- rechts: Retarder 0–3 (exklusiv) + ASR + Türfreigabe + Gebläse
    const bankR = makeBank(-0.17, 0.24);
    for (let n = 0; n <= 3; n++) {
      addBtn(bankR, -0.085 + n * 0.0567, 0.032, {
        symbol: 'retarder', label: String(n),
        action: () => { bus.retarderLevel = n; },
        getLit: () => bus.retarderLevel === n ? 1 : 0,
      });
    }
    addBtn(bankR, -0.057, -0.025, {
      symbol: 'asr', label: 'ASR',
      action: () => { bus.asrOn = !bus.asrOn; },
      getLit: () => bus.asrOn ? 1 : 0,
    });
    addBtn(bankR, 0, -0.025, {
      symbol: 'doorrel', label: 'FREIG',
      action: () => { bus.doorReleased = !bus.doorReleased; },
      getLit: () => bus.doorReleased ? 1 : 0,
    });
    addBtn(bankR, 0.057, -0.025, {
      symbol: 'fan', label: 'LÜFT.',
      action: () => { bus.fanLevel = (bus.fanLevel + 1) % 3; },
      getLit: () => bus.fanLevel / 2,
    });
  }

  // IBIS-Bedienteil rechts oben an der Konsole: 2-zeiliges Display
  // (Linie + Ziel) und zwei Tasten vor/zurück. Setzt bus.destIndex/destination.
  _buildIBIS(darkMat) {
    const bus = this.bus;
    bus.destIndex = 0;
    bus.destination = DESTINATIONS[0];

    this.ibis = new THREE.Group();
    this.ibis.position.set(0.34, CAB_FLOOR + 1.02, -5.28);
    this.ibis.rotation.y = -0.65; // zum Fahrer gedreht
    this.ibis.rotation.x = -0.18;
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.16, 0.05, 2, 0.01), darkMat);
    this.ibis.add(body);
    // Standfuß bis zur Konsolenoberkante
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.26, 8), darkMat);
    foot.position.set(0, -0.17, -0.02);
    this.ibis.add(foot);

    this._ibisCanvas = document.createElement('canvas');
    this._ibisCanvas.width = 256;
    this._ibisCanvas.height = 96;
    this._ibisTex = new THREE.CanvasTexture(this._ibisCanvas);
    this._ibisTex.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.075),
      new THREE.MeshBasicMaterial({ map: this._ibisTex, toneMapped: false })
    );
    disp.position.set(-0.035, 0, 0.027);
    this.ibis.add(disp);

    const step = (d) => {
      const n = DESTINATIONS.length;
      bus.destIndex = (bus.destIndex + d + n) % n;
      bus.destination = DESTINATIONS[bus.destIndex];
      this._drawIbis();
    };
    this.buttons.createButton({
      symbol: 'arrow-up', label: '', parent: this.ibis,
      position: new THREE.Vector3(0.105, 0.034, 0.028),
      action: () => step(1),
      getLit: () => 0,
    });
    this.buttons.createButton({
      symbol: 'arrow-down', label: '', parent: this.ibis,
      position: new THREE.Vector3(0.105, -0.034, 0.028),
      action: () => step(-1),
      getLit: () => 0,
    });

    this.group.add(this.ibis);
    this._drawIbis();
  }

  _drawIbis() {
    const c = this._ibisCanvas;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffb02e';
    ctx.textAlign = 'left';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('Linie 73', 12, 36);
    ctx.font = 'bold 24px monospace';
    ctx.fillText(this.bus.destination, 12, 76);
    this._ibisTex.needsUpdate = true;
  }

  _buildButtonPanels(darkMat) {
    const bus = this.bus;

    // Linkes Feld: Türen + Kneeling + Haltestellenbremse.
    // Unterkante über dem Konsolendeckel (+0.275) — Tasten tauchten sonst
    // in die Konsolenoberfläche ein (Spieltest-Feedback).
    const panelL = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.13, 0.03, 2, 0.01), darkMat);
    panelL.position.set(-1.06, CAB_FLOOR + 0.97, -5.32);
    panelL.rotation.x = -0.45;
    this.group.add(panelL);

    const addBtn = (parent, x, y, cfg) => this.buttons.createButton({
      ...cfg,
      parent,
      position: new THREE.Vector3(x, y, 0.018),
    });

    addBtn(panelL, -0.055, 0.032, {
      symbol: 'door', label: '1',
      action: () => bus.doors.toggle(0, bus.speedKmh),
      getLit: () => bus.doors.doors[0].progress > 0.05 ? 1 : 0,
    });
    addBtn(panelL, 0, 0.032, {
      symbol: 'door', label: '2',
      action: () => bus.doors.toggle(1, bus.speedKmh),
      getLit: () => bus.doors.doors[1].progress > 0.05 ? 1 : 0,
    });
    addBtn(panelL, 0.055, 0.032, {
      symbol: 'door', label: '3',
      action: () => bus.doors.toggle(2, bus.speedKmh),
      getLit: () => bus.doors.doors[2].progress > 0.05 ? 1 : 0,
    });
    addBtn(panelL, -0.055, -0.025, {
      symbol: 'kneel', label: 'KNEEL',
      action: () => bus.toggleKneel(),
      getLit: () => bus.kneelProgress > 0.05 ? 1 : 0,
    });
    addBtn(panelL, 0.028, -0.025, {
      symbol: 'stopbrake', label: 'HST-BR',
      action: () => { bus.stopBrake = !bus.stopBrake; },
      getLit: () => bus.stopBrake ? 1 : 0,
    });

    // Rechtes Feld: Warnblinker, Licht, Innenlicht, Wischer + Wählhebel
    const panelR = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.13, 0.03, 2, 0.01), darkMat);
    panelR.position.set(-0.18, CAB_FLOOR + 0.97, -5.36);
    panelR.rotation.x = -0.45;
    this.group.add(panelR);

    addBtn(panelR, -0.085, 0.032, {
      symbol: 'hazard', label: '',
      action: () => { bus.hazard = !bus.hazard; },
      getLit: () => (bus.hazard && bus.blinkOn) ? 1 : 0,
    });
    addBtn(panelR, -0.028, 0.032, {
      // Abblendlicht-Toggle (lightsOn-Setter springt zwischen Stufe 0 und 2)
      symbol: 'light', label: '',
      action: () => { bus.lightsOn = !bus.lightsOn; },
      getLit: () => bus.lightsOn ? 1 : 0,
    });
    addBtn(panelR, 0.028, 0.032, {
      symbol: 'cabin-light', label: '',
      action: () => { bus.interiorLightsOn = !bus.interiorLightsOn; },
      getLit: () => bus.interiorLightsOn ? 1 : 0,
    });
    addBtn(panelR, 0.085, 0.032, {
      symbol: 'wiper', label: '',
      action: () => bus.wipers.cycleMode(),
      getLit: () => bus.wipers.mode > 0 ? 1 : 0,
    });

    // Wählhebel-Tasten D/N/R
    addBtn(panelR, -0.057, -0.025, {
      symbol: 'D', label: '',
      action: () => bus.gearbox.setSelector('D'),
      getLit: () => bus.gearbox.selector === 'D' ? 1 : 0,
    });
    addBtn(panelR, 0, -0.025, {
      symbol: 'N', label: '',
      action: () => bus.gearbox.setSelector('N'),
      getLit: () => bus.gearbox.selector === 'N' ? 1 : 0,
    });
    addBtn(panelR, 0.057, -0.025, {
      symbol: 'R', label: '',
      action: () => bus.gearbox.setSelector('R'),
      getLit: () => bus.gearbox.selector === 'R' ? 1 : 0,
    });
  }

  _buildParkBrake(darkMat) {
    const bus = this.bus;
    this.parkLever = new THREE.Group();
    this.parkLever.position.set(-1.05, CAB_FLOOR + 0.55, -4.75);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.12), darkMat);
    this.parkLever.add(base);
    this.leverArm = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 8), darkMat);
    arm.position.y = 0.08;
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.4 })
    );
    knob.position.y = 0.17;
    this.leverArm.add(arm, knob);
    this.parkLever.add(this.leverArm);
    this.group.add(this.parkLever);

    this.buttons.createZone({
      size: new THREE.Vector3(0.12, 0.25, 0.16),
      position: new THREE.Vector3(-1.05, CAB_FLOOR + 0.66, -4.75),
      parent: this.group,
      name: 'parkBrake',
      action: () => {
        bus.parkingBrake = !bus.parkingBrake;
        Events.emit('buttonPress');
        Events.emit(bus.parkingBrake ? 'kneelDone' : 'kneelStart', false); // Zisch
      },
    });
  }

  _buildSeat(busModel) {
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2e3134, roughness: 0.9 });
    const seat = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 10), busModel.seatFrameMat);
    base.position.y = 0.15;
    const squab = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.1, 0.45, 2, 0.04), seatMat);
    squab.position.y = 0.34;
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.62, 0.12, 2, 0.04), seatMat);
    back.position.set(0, 0.68, 0.24);
    back.rotation.x = 0.12;
    const headrest = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.18, 0.1, 2, 0.03), seatMat);
    headrest.position.set(0, 1.06, 0.3);
    seat.add(base, squab, back, headrest);
    seat.position.set(-0.62, CAB_FLOOR, -4.6);
    this.group.add(seat);
  }

  handleClick(camera, ndc) {
    return this.buttons.handleClick(camera, ndc);
  }

  update(dt, bus, env, timeOfDay) {
    this.gSpeed.setValue(bus.speedKmh);
    this.gRpm.setValue(bus.engine.rpm / 100); // ×100-Skala
    this.gFuel.setValue(bus.engine.fuelLevel);
    this.gTemp.setValue(bus.engine.coolantTemp);
    this.gAir1.setValue(bus.air.circuit1);
    this.gAir2.setValue(bus.air.circuit2);
    for (const g of this.gauges) g.update(dt);

    // Instrumentenbeleuchtung: ab Standlicht an, gedimmt über bus.dashDim
    const backlight = bus.lightsMode >= 1 ? 0.8 : (env ? env.night * 0.4 : 0);
    for (const g of this.gauges) g.setBacklight(backlight, bus.dashDim);

    // Kontrollleuchten
    for (const l of this.telltales) {
      l.mat.color.setScalar(l.get(bus) ? 1 : 0.12);
    }
    if (bus.retarderLevel > 0 && bus.retarderLevel !== this._retShown) {
      this._retShown = bus.retarderLevel;
      this.telltales[2].mat.map = this._retTex[bus.retarderLevel - 1];
      this.telltales[2].mat.needsUpdate = true;
    }

    // Fahrerplatzleuchte weich ein-/ausblenden
    this.driverLamp.intensity += ((bus.driverLight ? 0.8 : 0) - this.driverLamp.intensity) * Math.min(1, dt * 10);

    this.icu.update(dt, bus, timeOfDay);
    this.column.update(dt, bus);
    this.buttons.update(dt);
    this.printer.update(dt);

    // Feststellbremshebel-Stellung
    const target = bus.parkingBrake ? -0.7 : 0;
    this.leverArm.rotation.x += (target - this.leverArm.rotation.x) * Math.min(1, dt * 10);
  }
}
