// Der Scania Citywide LF als physisches Gesamtsystem:
// RigidBody + 4 Raycast-Räder + Antriebsstrang + Druckluft + Türen + Kneeling.
// Das 3D-Modell (BusModel) liest hier nur Zustand — keine Logik dort.

import * as THREE from 'three';
import { RigidBody } from '../physics/RigidBody.js';
import { RaycastVehicle, Wheel } from '../physics/RaycastVehicle.js';
import { Engine } from './Engine.js';
import { Gearbox } from './Gearbox.js';
import { AirSystem } from './AirSystem.js';
import { Doors } from './Doors.js';
import { Wipers } from './Wipers.js';
import { boxInertia, clamp, lerp, smoothstep } from '../utils/Math3D.js';
import { Events } from '../core/Events.js';

const DEG = Math.PI / 180;
const TRACK = 2.1;
const WHEELBASE = 5.95;
const EMPTY_MASS = 11800;

export class Bus {
  constructor(world) {
    this.world = world;

    const inertia = boxInertia(EMPTY_MASS, 2.55, 3.0, 12.0);
    inertia.x *= 0.8; // Masse sitzt unten (Motor, Achsen, Tank)
    inertia.z *= 0.8;
    this.body = new RigidBody(EMPTY_MASS, inertia);
    this.body.position.set(0, 1.4, 0);

    const wheelOpts = (x, z, steered, driven, k, cb, cr) => new Wheel({
      localPos: new THREE.Vector3(x, -0.45, z),
      radius: 0.48,
      restLength: 0.42,
      stiffness: k,
      dampBump: cb,
      dampRebound: cr,
      steered,
      driven,
      maxForce: 160000,
    });
    // 0 VL, 1 VR, 2 HL, 3 HR
    this.wheels = [
      wheelOpts(-TRACK / 2, -WHEELBASE / 2, true, false, 210000, 18000, 27000),
      wheelOpts(+TRACK / 2, -WHEELBASE / 2, true, false, 210000, 18000, 27000),
      wheelOpts(-TRACK / 2, +WHEELBASE / 2, false, true, 320000, 27000, 40000),
      wheelOpts(+TRACK / 2, +WHEELBASE / 2, false, true, 320000, 27000, 40000),
    ];

    this.vehicle = new RaycastVehicle(this.body, this.wheels, () => 0);
    this.vehicle.collisionSpheres = [
      { local: new THREE.Vector3(0, 0.4, -5.4), radius: 1.32 },
      { local: new THREE.Vector3(0, 0.4, -2.7), radius: 1.32 },
      { local: new THREE.Vector3(0, 0.4, 0), radius: 1.32 },
      { local: new THREE.Vector3(0, 0.4, 2.7), radius: 1.32 },
      { local: new THREE.Vector3(0, 0.4, 5.4), radius: 1.32 },
    ];
    world.addBody(this.body);
    world.addVehicle(this.vehicle);

    this.engine = new Engine();
    this.gearbox = new Gearbox();
    this.air = new AirSystem();
    this.doors = new Doors(this.air);
    this.wipers = new Wipers();

    // --- Fahrer-Bedienzustand
    this.parkingBrake = true;
    this.stopBrake = false;        // Haltestellenbremse
    this.kneelRequested = false;
    this.kneelProgress = 0;
    this.blinker = 0;              // -1 links, 0 aus, 1 rechts
    this.hazard = false;
    this.blinkPhase = 0;
    this.blinkOn = false;
    this.lightsOn = false;
    this.interiorLightsOn = true;
    this.stopRequested = false;    // „Wagen hält"

    this.steerInput = 0;           // geglättet -1..1
    this.steeringWheelAngle = 0;   // rad, fürs Lenkrad-Mesh
    this.passengerCount = 0;

    Events.on('stopRequested', () => {
      if (!this.stopRequested) {
        this.stopRequested = true;
        Events.emit('chime');
      }
    });
  }

  get speedKmh() {
    return this.body.velocity.length() * 3.6;
  }

  // Vorzeichenbehaftete Geschwindigkeit in Fahrtrichtung
  get speedSigned() {
    const v = this.body.velocity;
    const q = this.body.quaternion;
    // lokale -Z-Achse in Welt
    const fx = -(2 * (q.x * q.z + q.w * q.y));
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    return v.x * fx + v.z * fz;
  }

  setPassengerCount(n) {
    this.passengerCount = n;
    const mass = EMPTY_MASS + n * 75;
    this.body.mass = mass;
    this.body.invMass = 1 / mass;
  }

  toggleKneel() {
    if (this.speedKmh > 3) return;
    this.kneelRequested = !this.kneelRequested;
    this.air.consume(this.kneelRequested ? 0.1 : 0.3);
    Events.emit('kneelStart', this.kneelRequested);
  }

  fixedUpdate(dt, controls) {
    const speed = Math.abs(this.speedSigned);
    const speedKmh = speed * 3.6;

    // ---------- Lenkung: geschwindigkeitsabhängiger Maximalwinkel + Ackermann
    this.steerInput = controls.steer;
    const maxAngle = lerp(50, 14, smoothstep(0, 19.4, speed)) * DEG;
    // Lenkrad: 3,5 Umdrehungen lock-to-lock
    this.steeringWheelAngle = -controls.steer * 3.5 * Math.PI;

    const steerMag = Math.abs(controls.steer) * maxAngle;
    if (steerMag < 1e-4) {
      this.wheels[0].steerAngle = 0;
      this.wheels[1].steerAngle = 0;
    } else {
      // positiver steerAngle = links; Input > 0 = rechts
      const turningLeft = controls.steer < 0;
      const inner = steerMag;
      const outer = Math.atan(1 / (1 / Math.tan(inner) + TRACK / WHEELBASE));
      const left = turningLeft ? inner : outer;
      const right = turningLeft ? outer : inner;
      this.wheels[0].steerAngle = turningLeft ? left : -left;
      this.wheels[1].steerAngle = turningLeft ? right : -right;
    }

    // ---------- Pedale
    let throttle = controls.throttle;
    const brakePedal = controls.brake;
    // Anfahrsperre: Türen offen oder Haltestellenbremse → kein Vortrieb
    if (this.doors.anyOpen || this.stopBrake || this.air.springBrakeApplied) throttle = 0;

    // Bremspedal: erste 15 % nur Retarder, Rest Betriebsbremse
    const retarderInput = clamp(brakePedal / 0.15, 0, 1);
    const serviceInput = clamp((brakePedal - 0.15) / 0.85, 0, 1);
    this.gearbox.retarderStage = this.gearbox.selector === 'D' ? retarderInput : 0;

    // ---------- Antriebsstrang
    const wheelOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    this.gearbox.update(dt, this.engine, wheelOmega);
    this.engine.update(dt, throttle, Math.max(0, this.gearbox.pumpTorque));
    if (!this.engine.running) this.gearbox.retarderStage = 0;

    // Radmomente
    const axleTorque = this.gearbox.outputTorque * this.gearbox.finalDrive;
    const retarderWheel = (this.gearbox.retarderTorque * this.gearbox.finalDrive) / 2;
    const avail = this.air.brakeAvailability;
    const serviceFront = serviceInput * avail * 9000;
    const serviceRear = serviceInput * avail * 11000;
    const springBrake = (this.parkingBrake || this.air.springBrakeApplied) ? 14000 : 0;
    const stopBrakeT = this.stopBrake ? 7000 : 0;

    this.wheels[0].brakeTorque = serviceFront;
    this.wheels[1].brakeTorque = serviceFront;
    this.wheels[2].brakeTorque = serviceRear + retarderWheel + springBrake + stopBrakeT;
    this.wheels[3].brakeTorque = serviceRear + retarderWheel + springBrake + stopBrakeT;
    this.wheels[2].driveTorque = axleTorque / 2;
    this.wheels[3].driveTorque = axleTorque / 2;

    // ---------- Fahrwiderstände am Körper
    const v = this.body.velocity;
    const vLen = v.length();
    if (vLen > 0.1) {
      // Luftwiderstand: cw·A ≈ 5,6 m²
      const drag = 0.5 * 1.2 * 5.6 * vLen;
      this.body.force.addScaledVector(v, -drag);
      // Rollwiderstand
      const crr = 0.008 * this.body.mass * 9.81;
      this.body.force.addScaledVector(v, -crr / vLen);
    }

    // ---------- Parkklemme gegen Stillstands-Zittern
    if (speed < 0.3 && throttle < 0.05) {
      this.body.velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
      this.body.angularVelocity.y *= Math.max(0, 1 - dt * 6);
    }

    // ---------- Kneeling: Federweg rechts absenken
    const kneelTarget = this.kneelRequested ? 1 : 0;
    const before = this.kneelProgress;
    this.kneelProgress += clamp(kneelTarget - this.kneelProgress, -dt / 2.2, dt / 2.2);
    if (before !== this.kneelProgress && Math.abs(this.kneelProgress - kneelTarget) < 1e-3) {
      Events.emit('kneelDone', this.kneelRequested);
    }
    const drop = this.kneelProgress * 0.07;
    this.wheels[1].restLength = this.wheels[1].restLengthBase - drop;
    this.wheels[3].restLength = this.wheels[3].restLengthBase - drop * 0.85;
    this.wheels[0].restLength = this.wheels[0].restLengthBase - drop * 0.5;
    this.wheels[2].restLength = this.wheels[2].restLengthBase - drop * 0.4;

    // ---------- Nebenaggregate
    this.air.update(dt, this.engine.rpm, brakePedal);
    this.doors.update(dt);
    this.wipers.update(dt);

    // ---------- Blinkrelais
    const blinking = this.hazard || this.blinker !== 0;
    if (blinking) {
      this.blinkPhase += dt;
      const on = (this.blinkPhase % 0.85) < 0.45;
      if (on !== this.blinkOn) {
        this.blinkOn = on;
        Events.emit('blinkTick', on);
      }
    } else {
      this.blinkPhase = 0;
      this.blinkOn = false;
    }
  }
}
