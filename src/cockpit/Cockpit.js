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

export const DRIVER_EYE = new THREE.Vector3(-0.62, 0.66, -4.92);

export class Cockpit {
  constructor(bus, busModel) {
    this.bus = bus;
    this.group = new THREE.Group();
    this.buttons = new CockpitButtons();

    const dashMat = busModel.dashMat;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.55 });

    // ---------- Podest & Konsole
    const podest = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, 1.6), darkMat);
    podest.position.set(-0.6, FLOOR_Y + 0.12, -4.95);
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
    this.binnacle = new THREE.Group();
    this.binnacle.position.set(-0.6, CAB_FLOOR + 0.98, -5.32);
    this.binnacle.rotation.x = -0.32;
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.26, 0.05, 2, 0.02), darkMat);
    this.binnacle.add(panel);
    this.group.add(this.binnacle);

    this.gSpeed = new Gauge({ radius: 0.085, min: 0, max: 125, step: 25, label: 'km/h', lambda: 10 });
    this.gSpeed.group.position.set(0, 0.01, 0.028);
    this.binnacle.add(this.gSpeed.group);

    this.gFuel = new Gauge({ radius: 0.042, min: 0, max: 1, step: 1, label: 'Tank', redFrom: 0, redTo: 0.1, lambda: 2 });
    this.gFuel.group.position.set(-0.21, 0.03, 0.028);
    this.binnacle.add(this.gFuel.group);

    this.gTemp = new Gauge({ radius: 0.042, min: 40, max: 120, step: 40, label: '°C', redFrom: 105, redTo: 120, lambda: 2 });
    this.gTemp.group.position.set(-0.115, -0.045, 0.028);
    this.binnacle.add(this.gTemp.group);

    this.gAir1 = new Gauge({ radius: 0.042, min: 0, max: 12, step: 4, label: 'bar 1', redFrom: 0, redTo: 5.5, lambda: 4 });
    this.gAir1.group.position.set(0.21, 0.03, 0.028);
    this.binnacle.add(this.gAir1.group);

    this.gAir2 = new Gauge({ radius: 0.042, min: 0, max: 12, step: 4, label: 'bar 2', redFrom: 0, redTo: 5.5, lambda: 4 });
    this.gAir2.group.position.set(0.115, -0.045, 0.028);
    this.binnacle.add(this.gAir2.group);

    this.gauges = [this.gSpeed, this.gFuel, this.gTemp, this.gAir1, this.gAir2];

    // ICU-Display unter dem Tacho
    this.icu = new ICUDisplay();
    this.icu.mesh.position.set(0, -0.09, 0.028);
    this.binnacle.add(this.icu.mesh);

    // ---------- Lenksäule
    this.column = new SteeringColumn(dashMat);
    this.column.group.position.set(-0.6, CAB_FLOOR + 0.78, -5.05);
    this.group.add(this.column.group);

    // Blinkerhebel-Klickzonen (über/unter dem Hebel)
    this.buttons.createZone({
      size: new THREE.Vector3(0.1, 0.07, 0.16),
      position: new THREE.Vector3(-0.78, CAB_FLOOR + 0.86, -5.1),
      parent: this.group,
      name: 'stalkUp',
      action: () => this._stalk(1),
    });
    this.buttons.createZone({
      size: new THREE.Vector3(0.1, 0.07, 0.16),
      position: new THREE.Vector3(-0.78, CAB_FLOOR + 0.7, -5.1),
      parent: this.group,
      name: 'stalkDown',
      action: () => this._stalk(-1),
    });

    // ---------- Tasterfelder
    this._buildButtonPanels(darkMat);

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

  _buildButtonPanels(darkMat) {
    const bus = this.bus;

    // Linkes Feld: Türen + Kneeling + Haltestellenbremse
    const panelL = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.13, 0.03, 2, 0.01), darkMat);
    panelL.position.set(-1.06, CAB_FLOOR + 0.92, -5.32);
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
    panelR.position.set(-0.18, CAB_FLOOR + 0.92, -5.36);
    panelR.rotation.x = -0.45;
    this.group.add(panelR);

    addBtn(panelR, -0.085, 0.032, {
      symbol: 'hazard', label: '',
      action: () => { bus.hazard = !bus.hazard; },
      getLit: () => (bus.hazard && bus.blinkOn) ? 1 : 0,
    });
    addBtn(panelR, -0.028, 0.032, {
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
    seat.position.set(-0.62, CAB_FLOOR, -4.78);
    this.group.add(seat);
  }

  handleClick(camera, ndc) {
    return this.buttons.handleClick(camera, ndc);
  }

  update(dt, bus, env, timeOfDay) {
    this.gSpeed.setValue(bus.speedKmh);
    this.gFuel.setValue(bus.engine.fuelLevel);
    this.gTemp.setValue(bus.engine.coolantTemp);
    this.gAir1.setValue(bus.air.circuit1);
    this.gAir2.setValue(bus.air.circuit2);
    for (const g of this.gauges) g.update(dt);

    const backlight = bus.lightsOn ? 0.8 : (env ? env.night * 0.4 : 0);
    for (const g of this.gauges) g.setBacklight(backlight);

    this.icu.update(dt, bus, timeOfDay);
    this.column.update(dt, bus);
    this.buttons.update(dt);
    this.printer.update(dt);

    // Feststellbremshebel-Stellung
    const target = bus.parkingBrake ? -0.7 : 0;
    this.leverArm.rotation.x += (target - this.leverArm.rotation.x) * Math.min(1, dt * 10);
  }
}
