// Himmel, Sonnenstand, Nebel und PMREM-Environment.
// Ein Skalar timeOfDay ∈ [0,24) steuert alles; Wetterwerte sind Targets,
// die weich nachgeführt werden (Menüwechsel blendet in ~5 s über).

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { damp, clamp, smoothstep, lerp } from '../utils/Math3D.js';
import { setWetness } from './materials/Wetness.js';
import { Events } from '../core/Events.js';

const WEATHER_TARGETS = {
  clear:    { cloud: 0.05, rain: 0, fog: 0.03 },
  overcast: { cloud: 0.85, rain: 0, fog: 0.12 },
  rain:     { cloud: 0.95, rain: 1, fog: 0.22 },
  fog:      { cloud: 0.55, rain: 0, fog: 0.85 },
};

export class SceneEnv {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;

    this.timeOfDay = 10.5;
    this.weatherName = 'clear';
    // Geglättete Ist-Werte
    this.cloud = 0.05;
    this.rain = 0;
    this.fogAmount = 0.03;
    this.wetness = 0;

    // Abgeleitete Werte für andere Systeme
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunFactor = 1;     // 0..1 Intensität der Sonne (Elevation × Bewölkung)
    this.night = 0;         // 0 = Tag, 1 = Nacht
    this.skyBrightness = 1;

    // Sichtbarer Himmel
    this.sky = new Sky();
    this.sky.scale.setScalar(8000);
    scene.add(this.sky);

    // Environment-Szene: Gradient-Kuppel OHNE Sonnenscheibe.
    // (Der Sky-Shader hat eine extrem helle Sonnen-Region — im PMREM würde
    // sie schattenfreies „Sonnenlicht" einspeisen und alle Schatten auswaschen.)
    this._envScene = new THREE.Scene();
    this._envUniforms = {
      uZenith: { value: new THREE.Color(0x3565a8) },
      uHorizon: { value: new THREE.Color(0xbfd3e6) },
      uGround: { value: new THREE.Color(0x4a443c) },
    };
    const envDome = new THREE.Mesh(
      new THREE.SphereGeometry(100, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: this._envUniforms,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
            vec3 col = h >= 0.0 ? sky : mix(uHorizon, uGround, clamp(-h * 3.0, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    this._envScene.add(envDome);

    this._pmrem = new THREE.PMREMGenerator(renderer);
    this._envRT = null;
    this._lastEnvElev = Infinity;
    this._lastEnvCloud = Infinity;

    scene.fog = new THREE.Fog(0xb8c4d4, 60, quality.drawDistance);

    this._sunPos = new THREE.Vector3();
  }

  setTimeOfDay(t) {
    this.timeOfDay = ((t % 24) + 24) % 24;
  }

  setWeather(name) {
    if (WEATHER_TARGETS[name]) {
      this.weatherName = name;
      Events.emit('weatherChanged', name);
    }
  }

  update(dt) {
    const tgt = WEATHER_TARGETS[this.weatherName];
    this.cloud = damp(this.cloud, tgt.cloud, 0.6, dt);
    this.rain = damp(this.rain, tgt.rain, 0.5, dt);
    this.fogAmount = damp(this.fogAmount, tgt.fog, 0.5, dt);
    // Nässe: baut sich in ~30 s auf, trocknet deutlich langsamer ab
    const wetLambda = this.rain > this.wetness ? 0.12 : 0.02;
    this.wetness = damp(this.wetness, this.rain, wetLambda, dt);
    setWetness(this.wetness);

    // --- Sonnenstand: einfacher Kreisbogen, Maximum 58° um 12 Uhr
    const t = this.timeOfDay;
    const dayPhase = (t - 6) / 12; // 0 bei 6:00, 1 bei 18:00
    const elevDeg = Math.sin(dayPhase * Math.PI) * 58;
    const azimuthDeg = 90 + (t / 24) * 360;
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    this._sunPos.setFromSphericalCoords(1, phi, theta);
    this.sunDir.copy(this._sunPos);

    // --- Sky-Uniforms (sichtbarer Himmel + Env-Himmel synchron)
    const turbidity = 2.2 + this.cloud * 13 + this.fogAmount * 6;
    const rayleigh = lerp(1.3, 0.6, this.cloud);
    const mieCoefficient = 0.004 + this.cloud * 0.025;
    const mieG = lerp(0.75, 0.92, smoothstep(20, 2, elevDeg));
    {
      const u = this.sky.material.uniforms;
      u.turbidity.value = turbidity;
      u.rayleigh.value = rayleigh;
      u.mieCoefficient.value = mieCoefficient;
      u.mieDirectionalG.value = mieG;
      u.sunPosition.value.copy(this._sunPos);
    }

    // Gradient-Kuppel der Env-Szene nachführen
    {
      const day = smoothstep(-4, 10, elevDeg);
      const dusk = smoothstep(14, 2, elevDeg) * day;
      const zen = this._envUniforms.uZenith.value;
      const hor = this._envUniforms.uHorizon.value;
      zen.setHSL(0.6, lerp(0.55, 0.06, this.cloud), lerp(0.012, lerp(0.32, 0.42, this.cloud), day));
      hor.setHSL(lerp(0.6, 0.07, dusk), lerp(0.4, 0.1, this.cloud), lerp(0.02, lerp(0.68, 0.55, this.cloud), day));
      this._envUniforms.uGround.value.setHSL(0.08, 0.12, lerp(0.005, 0.16, day));
    }

    // --- Abgeleitete Faktoren
    const elevFactor = smoothstep(-4, 8, elevDeg);
    const cloudDim = lerp(1, 0.35, this.cloud);
    this.sunFactor = elevFactor * cloudDim;
    this.night = smoothstep(2, -7, elevDeg);
    this.skyBrightness = lerp(0.04, 1, elevFactor);

    // --- Nebel
    const fogNear = lerp(70, 12, this.fogAmount);
    const fogFar = lerp(this.quality.drawDistance, 90, this.fogAmount);
    this.scene.fog.near = fogNear;
    this.scene.fog.far = fogFar;
    const dayFog = new THREE.Color().setHSL(0.58, lerp(0.25, 0.02, this.cloud), lerp(0.75, 0.55, this.cloud));
    const nightFog = new THREE.Color(0x0a0e18);
    this.scene.fog.color.copy(dayFog).lerp(nightFog, this.night);
    this.scene.background = null; // Sky-Mesh füllt den Hintergrund

    // --- Belichtung: nachts etwas auf
    this.renderer.toneMappingExposure = lerp(0.85, 1.25, this.night);

    // --- PMREM nur bei nennenswerter Änderung neu erzeugen (~3 ms)
    if (Math.abs(elevDeg - this._lastEnvElev) > 1.5 || Math.abs(this.cloud - this._lastEnvCloud) > 0.06) {
      this._regenEnv();
      this._lastEnvElev = elevDeg;
      this._lastEnvCloud = this.cloud;
    }
  }

  _regenEnv() {
    const old = this._envRT;
    this._envRT = this._pmrem.fromScene(this._envScene, 0, 0.5, 4000);
    this.scene.environment = this._envRT.texture;
    if (old) old.dispose();
  }
}
