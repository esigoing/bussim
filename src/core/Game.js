// Orchestrierung aller Systeme. Reihenfolge pro Frame:
// Input → (240-Hz-Physik) → Bus-Interpolation → Kamera → Umwelt/Licht →
// Stadt/Verkehr/Fahrgäste → Cockpit/Audio/HUD → Spiegel → PostFX-Render.

import * as THREE from 'three';
import { Loop } from './Loop.js';
import { Input } from './Input.js';
import { Events } from './Events.js';
import { CameraRig } from './CameraRig.js';
import { getDebugFlags } from './Settings.js';
import { createRenderer } from '../graphics/Renderer.js';
import { SceneEnv } from '../graphics/SceneEnv.js';
import { Lighting } from '../graphics/Lighting.js';
import { setAnisotropy } from '../graphics/materials/TextureGen.js';
import { Rand, getSeedFromURL } from '../utils/Rand.js';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

// Pünktlichkeits-Bonus (WP-C3): Abfahrt innerhalb ±30 s der Soll-Abfahrt
const PUNCTUAL_WINDOW = 30; // s Toleranz um die Soll-Abfahrt
const PUNCTUAL_BONUS = 2.0; // € je pünktlicher Abfahrt

export class Game {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.quality = settings.quality;
    this.debug = getDebugFlags();
    this.seed = getSeedFromURL();
    this.rand = new Rand(this.seed);
    this.paused = true;
    this.time = 0;

    // Fahrplan/Pünktlichkeit (WP-C3)
    this._offRouteTime = 0;   // s ohne Routen-Position (Anzeige erst dann leeren)
    this._dwellStop = null;   // Halt, an dem der Bus gerade mit offener Tür steht
    this._lastBonusStop = -1; // Doppel-Bonus am selben Halt verhindern
    this._lastBonusTime = -1e9;
    this._ttAccum = 0;        // Drossel für das Fahrplan-Overlay (2 Hz)

    setAnisotropy(this.quality.anisotropy);

    this.renderer = createRenderer(container, this.quality);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70, window.innerWidth / window.innerHeight, 0.08, this.quality.drawDistance + 800
    );
    this.camera.layers.enable(1); // Spiegelflächen
    this.camera.layers.enable(2); // Regen

    this.input = new Input(this.renderer.domElement);
    this.env = new SceneEnv(this.scene, this.renderer, this.quality);
    this.lighting = new Lighting(this.scene, this.camera, this.quality);

    this.loop = new Loop(
      (dt) => this._fixedUpdate(dt),
      (dt, alpha) => this._frameUpdate(dt, alpha)
    );

    window.addEventListener('resize', () => this._onResize());
  }

  async init() {
    const [{ World }, { CityGen }, { Bus }, { BusModel }, { Cockpit },
      { Mirrors }, { AudioEngine }, { EngineSound }, { VehicleSounds },
      { AmbienceSounds }, { TicketFlow }, { PassengerSystem }, { TrafficSystem },
      { PedestrianSystem }, { PostFX }, { WeatherFX }, { HUD }, { Minimap }] = await Promise.all([
      import('../physics/World.js'),
      import('../city/CityGen.js'),
      import('../vehicle/Bus.js'),
      import('../vehicle/BusModel.js'),
      import('../cockpit/Cockpit.js'),
      import('../graphics/Mirrors.js'),
      import('../audio/AudioEngine.js'),
      import('../audio/EngineSound.js'),
      import('../audio/VehicleSounds.js'),
      import('../audio/AmbienceSounds.js'),
      import('../passengers/TicketFlow.js'),
      import('../passengers/PassengerSystem.js'),
      import('../traffic/TrafficSystem.js'),
      import('../passengers/PedestrianSystem.js'),
      import('../graphics/PostFX.js'),
      import('../graphics/WeatherFX.js'),
      import('../ui/HUD.js'),
      import('../ui/Minimap.js'),
    ]);

    // ---------- Physik + Stadt (Detail/Dichte aus dem Grafik-Preset, WP-A4)
    this.world = new World();
    this.city = new CityGen({
      rand: this.rand, collision: this.world.collision,
      propsDensity: this.quality.propsDensity, cityDetail: this.quality.cityDetail,
    });
    this.scene.add(this.city.group);
    this.world.groundQuery = (x, z) => this.city.groundHeight(x, z);
    // Häuschen-Rückwände als statische Bus-Kollision (WP-E3, idempotent)
    this.city.route.addShelterCollision(this.world.collision);

    // ---------- Bus
    this.bus = new Bus(this.world);
    const stop0 = this.city.route.stops[0];
    const yaw = Math.atan2(-stop0.dir.x, -stop0.dir.z);
    this.bus.body.position.set(
      stop0.pos.x - stop0.dir.x * 14,
      stop0.pos.y + 1.4,
      stop0.pos.z - stop0.dir.z * 14
    );
    this.bus.body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.bus.body.prevPosition.copy(this.bus.body.position);
    this.bus.body.prevQuaternion.copy(this.bus.body.quaternion);

    this.busModel = new BusModel(this.bus);
    this.scene.add(this.busModel.group);
    this.cockpit = new Cockpit(this.bus, this.busModel);
    this.busModel.group.add(this.cockpit.group);
    this.mirrors = new Mirrors(this.busModel.group, this.busModel.mirrorAnchors, this.quality);

    // ---------- Audio (Game wird nach User-Geste erzeugt → Kontext erlaubt)
    this.audio = new AudioEngine();
    this.engineSound = new EngineSound(this.audio);
    this.vehicleSounds = new VehicleSounds(this.audio);
    this.ambience = new AmbienceSounds(this.audio);

    // ---------- Fahrgäste + Verkehr + Fußgänger (Mengen/Detail aus dem Preset)
    const rainy = this.env.weatherName === 'rain'; // Wetter steht vor init() fest
    this.ticketFlow = new TicketFlow(this.cockpit.printer);
    this.passengers = new PassengerSystem({
      scene: this.scene, bus: this.bus, busModel: this.busModel,
      route: this.city.route, ticketFlow: this.ticketFlow, rand: this.rand.fork(123),
      groundY: (x, z) => this.city.groundHeight(x, z),
      waitingMax: this.quality.waitingMax,
      figureOpts: { detail: this.quality.figureDetail, props: this.quality.figureProps, rainy },
    });
    this.traffic = new TrafficSystem({
      graph: this.city.roadNet.graph, rand: this.rand.fork(321), parent: this.scene,
      count: this.quality.trafficCount,
    });
    // Preset low (pedestrianCount 0) erzeugt gar kein Fußgänger-System
    this.pedestrians = this.quality.pedestrianCount > 0
      ? new PedestrianSystem(this.scene, this.city.roadNet, this.bus, {
        count: this.quality.pedestrianCount,
        figureDetail: this.quality.figureDetail,
        figureProps: this.quality.figureProps,
        rainy,
        rand: this.rand.fork(456),
      })
      : null;

    // ---------- Effekte + UI
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.quality);
    this.weatherfx = new WeatherFX(this.scene, this.quality);
    // Tropfen-Ebene knapp hinter der Windschutzscheibe
    this.weatherfx.attachWindshield(
      this.busModel.group, 2.34, 1.62,
      new THREE.Vector3(0, -1.23 + 1.95, -5.94), -0.1
    );
    this.weatherfx.setWiperGeometry([
      { u: (-0.62 + 1.17) / 2.34, v: 0.05, len: 0.58 },
      { u: (0.55 + 1.17) / 2.34, v: 0.05, len: 0.58 },
    ]);

    this.hud = new HUD();
    this.minimap = new Minimap(this.city.roadNet, this.city.route);
    this.cameraRig = new CameraRig(this.camera);
    this.nextStop = this.city.route.stops[0];

    // ---------- Debug
    if (this.debug.lanes) this._buildLaneDebug();
    if (this.debug.perf) {
      const { default: Stats } = await import('three/addons/libs/stats.module.js');
      this.stats = new Stats();
      document.body.appendChild(this.stats.dom);
    }

    this._wireMessages();
  }

  _wireMessages() {
    Events.on('kneelStart', (down) => {
      if (down !== false) this.hud.message(down ? 'Kneeling — Bus senkt sich' : 'Bus hebt sich');
    });
  }

  _buildLaneDebug() {
    const pts = [];
    for (const e of this.city.roadNet.graph.edges) {
      const p = e.curve.points;
      for (let i = 0; i < p.length - 1; i++) {
        pts.push(p[i].x, 0.3, p[i].z, p[i + 1].x, 0.3, p[i + 1].z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00ff88 })));
  }

  setTimeOfDay(t) { this.env.setTimeOfDay(t); }
  setWeather(w) { this.env.setWeather(w); }

  resume() {
    this.paused = false;
    if (this.audio) this.audio.resume();
    this.loop.start();
  }

  pause() {
    this.paused = true;
    if (this.audio) this.audio.suspend();
    this.loop.stop();
  }

  // ------------------------------------------------------------ 240 Hz
  _fixedUpdate(dt) {
    this.bus.fixedUpdate(dt, {
      steer: this.input.steer,
      throttle: this.input.throttle,
      brake: this.input.brake,
    });
    this.world.step(dt);
  }

  // ------------------------------------------------------------ Frame
  _frameUpdate(dt, alpha) {
    this.time += dt;
    this.input.update(dt);
    this._handleKeys();

    // Tageszeit läuft langsam weiter (1 Spielstunde ≈ 10 min real)
    this.env.setTimeOfDay(this.env.timeOfDay + dt / 600);

    // ---------- Bus-Transform interpolieren
    const body = this.bus.body;
    const g = this.busModel.group;
    g.position.lerpVectors(body.prevPosition, body.position, alpha);
    g.quaternion.slerpQuaternions(body.prevQuaternion, body.quaternion, alpha);

    // ---------- Kamera (vor Licht/CSM!)
    this.cameraRig.update(dt, g, this.input);
    const interior = this.cameraRig.isInterior;
    this.audio.setInterior(interior);
    this.engineSound.setInterior(interior);

    // ---------- Umwelt + Licht
    this.env.update(dt);
    this.lighting.update(this.env);
    this.vehicleMu();

    // ---------- Routen-Logik: Position auf der Linie, nächste Haltestelle
    body.localDir(_fwd.set(0, 0, -1), _v);
    const laneInfo = this.city.roadNet.graph.nearestLane(body.position, _v, 10);
    let busInfo = null;
    let rd = null;
    if (laneInfo) {
      busInfo = { edge: laneInfo.edge, s: laneInfo.s, len: 12, v: Math.abs(this.bus.speedSigned) };
      rd = this.city.route.distanceOnRoute(laneInfo.edge, laneInfo.s);
      if (rd !== null) {
        const next = this.city.route.nextStopAfter(rd);
        if (next !== this.nextStop) {
          this.nextStop = next;
        }
      }
    }
    this.cockpit.icu.nextStop = this.nextStop ? this.nextStop.name : '—';
    this.hud.setNextStop(this.nextStop ? this.nextStop.name : '—');
    this.passengers.setNextStop(this.nextStop ? this.nextStop.index : 0);

    // ---------- Fahrplan (WP-C3): Abweichung live an ICU + HUD-scheduleBox
    if (rd !== null) {
      this._offRouteTime = 0;
      const delay = this.city.route.updateSchedule(rd, this.time);
      this.cockpit.icu.setDelay(delay); // ICU invertiert RBL-konform selbst
      const info = this.city.route.nextStopInfo(rd, this.time);
      if (info && info.plannedArrival !== null) {
        this.hud.setSchedule(this._clockHours(info.plannedArrival), (info.delay || 0) / 60);
      } else {
        this.hud.setSchedule(null);
      }
    } else {
      // abseits der Linie: Anzeige erst nach kurzer Karenz leeren (kein Flackern)
      this._offRouteTime += dt;
      if (this._offRouteTime > 2) {
        this.cockpit.icu.setDelay(null);
        this.hud.setSchedule(null);
      }
    }
    this._updatePunctuality();

    // ---------- Welt-Systeme
    this.city.update(dt, this.env, body.position);
    this.traffic.update(dt, busInfo, this.env.wetness, this.env.night);
    this.passengers.update(dt, this.hud);
    if (this.pedestrians) this.pedestrians.update(dt);
    this.ticketFlow.update(dt);

    // ---------- Bus-Optik + Cockpit
    this.busModel.update(dt, this.env);
    this.cockpit.update(dt, this.bus, this.env, this.env.timeOfDay);

    // Cockpit-Klicks
    if (this.input.clicked) {
      this.cockpit.handleClick(this.camera, this.input.mouseNDC);
    }
    this.renderer.domElement.style.cursor =
      interior && this.cockpit.buttons.hovering(this.camera, this.input.mouseNDC) ? 'pointer' : 'default';

    // ---------- Audio
    this.engineSound.update(dt, this.bus.engine);
    this.vehicleSounds.update(dt, this.bus);
    this.ambience.update(dt, {
      env: this.env, bus: this.bus,
      passengerCount: this.bus.passengerCount, time: this.time,
    });

    // ---------- Wetter-Effekte
    this.weatherfx.update(dt, this.env, this.camera, body.velocity, this.bus.wipers, this.time);

    // ---------- HUD + Minimap
    this.hud.update(dt, this.bus);
    // Offenes Fahrplan-Overlay gedrosselt aktualisieren (2 Hz)
    this._ttAccum += dt;
    if (this._ttAccum >= 0.5) {
      this._ttAccum = 0;
      if (this.hud.timetableVisible) this.hud.renderTimetable(this._timetableRows());
    }
    // Pfeil zeigt in Fahrtrichtung: -Z ist vorn, Canvas-Dreieck zeigt nach
    // oben (-y) → Yaw direkt übergeben (Minimap negiert beim Zeichnen).
    const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'YXZ');
    this.minimap.update(body.position, e.y, this.nextStop);

    // ---------- Render: erst Spiegel, dann Hauptbild
    this.renderer.info.reset();
    this.mirrors.update(this.renderer, this.scene);
    if (this.postfx.enabled) this.postfx.render(dt);
    else this.renderer.render(this.scene, this.camera);

    if (this.stats) this.stats.update();
    this.input.postFrame();
  }

  // Reifen-Grip an die Nässe koppeln
  vehicleMu() {
    this.bus.vehicle.muSurface = 0.85 * (1 - 0.35 * this.env.wetness);
  }

  // Fahrplan-Zeit (Sekunden auf der game.time-Uhr) → Spieluhr-Stunden 0–24.
  // 1 reale Sekunde = 1/600 Spielstunde (env.timeOfDay += dt/600).
  _clockHours(schedTime) {
    const h = this.env.timeOfDay + (schedTime - this.time) / 600;
    return ((h % 24) + 24) % 24;
  }

  // Zeilen fürs Fahrplan-Overlay: Soll-Ankunft als Spieluhr-Zeit plus
  // Ist-Abweichung der laufenden Runde. Stop 0 (Hauptbahnhof) zeigt die
  // Ankunft am RUNDENENDE — dort entfällt die Abweichungs-Spalte.
  _timetableRows() {
    const nextIdx = this.nextStop ? this.nextStop.index : -1;
    return this.city.route.scheduleList().map((r) => ({
      name: r.name,
      plannedHours: r.plannedArrival === null ? null : this._clockHours(r.plannedArrival),
      state: r.index === nextIdx ? 'next'
        : (r.index !== 0 && r.actualArrival !== null ? 'passed' : ''),
      delaySec: (r.index !== 0 && r.actualArrival !== null && r.plannedArrival !== null)
        ? r.actualArrival - r.plannedArrival : null,
    }));
  }

  // Pünktlichkeits-Bonus (WP-C3): Halt mit offener Tür erkennen; bei der
  // Abfahrt gegen die Soll-Abfahrt prüfen (±30 s → Bonus in die Kasse).
  // An Stop 0 wird der Fahrplan-Anker zusätzlich auf die tatsächliche
  // Abfahrt präzisiert (anchorSchedule).
  _updatePunctuality() {
    const bus = this.bus;
    const route = this.city.route;
    const pos = bus.body.position;

    if (!this._dwellStop) {
      if (bus.speedKmh < 1 && bus.doors.anyOpen) {
        for (const s of route.stops) {
          if (Math.hypot(pos.x - s.pos.x, pos.z - s.pos.z) < 15) {
            this._dwellStop = s;
            break;
          }
        }
      }
      return;
    }

    const s = this._dwellStop;
    const dist = Math.hypot(pos.x - s.pos.x, pos.z - s.pos.z);
    if (!bus.doors.anyOpen && (bus.speedKmh > 8 || dist > 20)) {
      // Abfahrt vom Halt
      const pd = route.plannedDeparture(s.index);
      const fresh = s.index !== this._lastBonusStop || this.time - this._lastBonusTime > 120;
      if (pd !== null && fresh && Math.abs(this.time - pd) <= PUNCTUAL_WINDOW) {
        this._lastBonusStop = s.index;
        this._lastBonusTime = this.time;
        this.ticketFlow.earnings += PUNCTUAL_BONUS;
        Events.emit('punctualBonus', {
          bonus: PUNCTUAL_BONUS, earnings: this.ticketFlow.earnings,
        });
      }
      if (s.index === 0) route.anchorSchedule(this.time);
      this._dwellStop = null;
    }
  }

  _handleKeys() {
    const input = this.input;
    const bus = this.bus;

    if (input.justPressed('KeyT') || input.justPressed('Digit1')) bus.doors.toggle(0, bus.speedKmh);
    if (input.justPressed('Digit2')) bus.doors.toggle(1, bus.speedKmh);
    if (input.justPressed('Digit3')) bus.doors.toggle(2, bus.speedKmh);
    if (input.justPressed('KeyK')) bus.toggleKneel();
    if (input.justPressed('KeyU')) bus.wipers.cycleMode();
    if (input.justPressed('KeyL')) {
      // 3-stufiger Lichtdrehschalter (WP-B2): aus → Stand → Abblend → aus
      bus.lightsMode = (bus.lightsMode + 1) % 3;
      this.hud.message(['Licht aus', 'Standlicht', 'Abblendlicht'][bus.lightsMode]);
    }
    if (input.justPressed('KeyB')) {
      // Fernlicht (Pendant zum Blinkerhebel-Druck)
      if (bus.lightsMode >= 2) {
        bus.highBeam = !bus.highBeam;
        Events.emit('buttonPress');
      } else {
        this.hud.message('Fernlicht nur bei Abblendlicht (L)', true);
      }
    }
    if (input.justPressed('KeyV')) {
      // Retarder-Stufenschalter 0–3 durchschalten
      bus.retarderLevel = (bus.retarderLevel + 1) % 4;
      this.hud.message(bus.retarderLevel > 0
        ? `Retarder Stufe ${bus.retarderLevel}` : 'Retarder aus');
    }
    if (input.justPressed('KeyE')) {
      // Türfreigabe: Fahrgäste öffnen Tür 2/3 am Halt selbst
      bus.doorReleased = !bus.doorReleased;
      this.hud.message(bus.doorReleased ? 'Türfreigabe aktiv' : 'Türfreigabe aufgehoben');
    }
    if (input.justPressed('KeyG')) this.busModel.toggleDriverWindow();
    if (input.justPressed('KeyO')) this.hud.toggleTimetable(this._timetableRows());
    if (input.justPressed('KeyP')) {
      bus.parkingBrake = !bus.parkingBrake;
      Events.emit('kneelDone', false); // Zisch
      this.hud.message(bus.parkingBrake ? 'Feststellbremse angelegt' : 'Feststellbremse gelöst');
    }
    if (input.justPressed('KeyR')) bus.blinker = bus.blinker === 1 ? 0 : 1;
    if (input.justPressed('KeyF')) bus.blinker = bus.blinker === -1 ? 0 : -1;
    if (input.justPressed('KeyH')) bus.hazard = !bus.hazard;
    if (input.justPressed('Space')) bus.stopBrake = !bus.stopBrake;
    if (input.justPressed('KeyM')) {
      const order = ['D', 'N', 'R'];
      const next = order[(order.indexOf(bus.gearbox.selector) + 1) % 3];
      bus.gearbox.setSelector(next);
      Events.emit('buttonPress');
    }
    if (input.justPressed('KeyW') && bus.gearbox.selector === 'N') {
      // Komfort: bei N und Gas → D einlegen
      bus.gearbox.setSelector('D');
    }
    if (input.justPressed('F1')) this.cameraRig.setMode('cockpit');
    if (input.justPressed('F2')) this.cameraRig.setMode('chase');
    if (input.justPressed('F3')) this.cameraRig.setMode('front');
    if (input.justPressed('F4')) this.cameraRig.setMode('cabin');

    // Haltestellenbremse löst beim Anfahren automatisch
    if (bus.stopBrake && input.throttle > 0.3 && !bus.doors.anyOpen) {
      bus.stopBrake = false;
    }
    // Hinweis bei Anfahrversuch mit Feststellbremse
    if (input.throttle > 0.5 && (bus.parkingBrake || bus.air.springBrakeApplied) && bus.speedKmh < 1) {
      this.hud.message(bus.air.springBrakeApplied ?
        '⚠ Federspeicher: zu wenig Luftdruck' : 'Feststellbremse lösen (P oder Hebel links)', true);
    }
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.lighting.onResize();
    if (this.postfx) this.postfx.onResize(window.innerWidth, window.innerHeight);
  }
}
