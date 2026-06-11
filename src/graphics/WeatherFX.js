// Regen-Effekte: (1) instanzierte Regenstreifen in einer Box um die Kamera,
// per Shader fallend und mit der Fahrgeschwindigkeit verschert;
// (2) Scheibentropfen-Simulation auf einem 512er-Canvas, von den
// Wischerblättern real weggewischt. Regen liegt auf Layer 2 (nicht in
// Spiegeln).

import * as THREE from 'three';

const RAIN_VERT = /* glsl */`
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform vec2 uShear;     // horizontale Drift (Wind + Fahrtwind)
  attribute vec3 aOffset;  // 0..1 Zufallsposition in der Box
  attribute float aSpeed;
  varying float vAlpha;
  void main() {
    float fall = uTime * (9.0 + aSpeed * 5.0);
    vec3 cell = aOffset;
    cell.y = fract(aOffset.y - fall / uBox.y);
    vec3 base = uCenter + (cell - 0.5) * uBox;
    // Streifen entlang der Fallrichtung verscheren
    vec3 p = position;
    vec2 shear = uShear * (0.5 + aSpeed * 0.5);
    base.xz += shear * (p.y / max(uBox.y, 0.001)) * 14.0;
    // zylindrisches Billboard zur Kamera
    vec3 toCam = normalize(cameraPosition - base);
    vec3 sideDir = normalize(vec3(-toCam.z, 0.0, toCam.x));
    vec3 world = base + sideDir * p.x + vec3(0.0, p.y, 0.0);
    vAlpha = 0.38 + aSpeed * 0.35;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const RAIN_FRAG = /* glsl */`
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(0.65, 0.7, 0.8, vAlpha * uIntensity);
  }
`;

export class WeatherFX {
  constructor(scene, quality) {
    this.scene = scene;

    // ---------- Regenstreifen
    const count = quality.rainCount;
    const base = new THREE.PlaneGeometry(0.022, 0.6);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const offsets = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      offsets[i * 3] = Math.random();
      offsets[i * 3 + 1] = Math.random();
      offsets[i * 3 + 2] = Math.random();
      speeds[i] = Math.random();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
    geo.instanceCount = count;

    this.rainUniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(34, 18, 34) },
      uShear: { value: new THREE.Vector2(0, 0) },
      uIntensity: { value: 0 },
    };
    this.rainMesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: this.rainUniforms,
      transparent: true,
      depthWrite: false,
    }));
    this.rainMesh.frustumCulled = false;
    this.rainMesh.layers.set(2);
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);

    // ---------- Scheibentropfen
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d');
    this.dropTex = new THREE.CanvasTexture(this.canvas);
    this.dropMat = new THREE.MeshBasicMaterial({
      map: this.dropTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
      toneMapped: false,
    });
    this.dropMesh = null; // wird via attachWindshield gesetzt
    this.drops = [];      // aktive Läufer-Tropfen
    this._hasDrops = false;
  }

  // Plane knapp innen vor der Windschutzscheibe
  attachWindshield(busGroup, width, height, position, rotX) {
    this.dropMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.dropMat);
    this.dropMesh.position.copy(position);
    this.dropMesh.rotation.y = Math.PI;
    this.dropMesh.rotateX(rotX);
    this.dropMesh.renderOrder = 5;
    this.dropMesh.layers.set(2);
    busGroup.add(this.dropMesh);
    this.wsWidth = width;
    this.wsHeight = height;
  }

  // Wischer-Pivots in Scheiben-UV (x-Anteil 0..1, y = 0 unten), Armlänge in UV
  setWiperGeometry(pivots) {
    this.wiperPivots = pivots; // [{u, v, len}]
  }

  _spawnDrop(rain) {
    const r = 1.5 + Math.random() * 3.5;
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const ctx = this.ctx;
    // Tropfen: radialer Verlauf, unten heller (fake Brechung)
    const grd = ctx.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
    grd.addColorStop(0, 'rgba(190,205,225,0.22)');
    grd.addColorStop(0.7, 'rgba(190,205,225,0.38)');
    grd.addColorStop(1, 'rgba(190,205,225,0.0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // Glanzpunkt
    ctx.fillStyle = 'rgba(235,242,255,0.5)';
    ctx.beginPath();
    ctx.arc(x + r * 0.25, y + r * 0.3, r * 0.22, 0, Math.PI * 2);
    ctx.fill();

    if (r > 3.2 && this.drops.length < 24) {
      this.drops.push({ x, y, r: r * 0.6, life: 2 + Math.random() * 3 });
    }
    this._hasDrops = true;
  }

  update(dt, env, camera, busVelocity, wipers, time) {
    const rain = env.rain;

    // --- Streifen
    this.rainMesh.visible = rain > 0.02;
    if (this.rainMesh.visible) {
      this.rainUniforms.uTime.value = time;
      this.rainUniforms.uCenter.value.copy(camera.position);
      this.rainUniforms.uIntensity.value = rain;
      // Drift: Fahrtwind (invertierte Busgeschwindigkeit) + leichter Wind
      this.rainUniforms.uShear.value.set(
        -busVelocity.x * 0.04 + 0.05,
        -busVelocity.z * 0.04
      );
    }

    // --- Scheibe
    if (!this.dropMesh) return;
    const ctx = this.ctx;
    let dirty = false;

    if (rain > 0.03) {
      // Spawnrate ∝ Regen, reduziert durch Fahrtwind (Tropfen ziehen ab)
      const speed = busVelocity.length();
      const rate = rain * 26 * Math.max(0.25, 1 - speed / 35);
      this._spawnAcc = (this._spawnAcc || 0) + rate * dt;
      while (this._spawnAcc >= 1) {
        this._spawnDrop(rain);
        this._spawnAcc -= 1;
        dirty = true;
      }
    }

    // Läufer-Tropfen rinnen nach unten
    if (this.drops.length) {
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.life -= dt;
        const vy = 26 * dt * (0.5 + d.r * 0.15);
        d.y += vy;
        d.x += Math.sin(d.y * 0.05 + i) * 0.4;
        ctx.fillStyle = 'rgba(190,205,225,0.16)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
        if (d.life <= 0 || d.y > 520) this.drops.splice(i, 1);
      }
      dirty = true;
    }

    // langsames Abtrocknen
    if (this._hasDrops) {
      this._fadeAcc = (this._fadeAcc || 0) + dt;
      const fadeInterval = rain > 0.03 ? 0.5 : 0.12;
      if (this._fadeAcc > fadeInterval) {
        this._fadeAcc = 0;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(0, 0, 512, 512);
        ctx.globalCompositeOperation = 'source-over';
        dirty = true;
      }
    }

    // Wischer löschen
    if (wipers && this.wiperPivots && wipers.isMoving) {
      const sweep = wipers.sweep;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      for (const p of this.wiperPivots) {
        const angle = -1.2 + sweep * 1.75; // wie BusModel
        const px = p.u * 512, py = 512 - p.v * 512;
        const len = p.len * 512;
        // Blattsegment außen am Arm
        const dirX = Math.sin(angle), dirY = -Math.cos(angle);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 26;
        ctx.beginPath();
        ctx.moveTo(px + dirX * len * 0.25, py + dirY * len * 0.25);
        ctx.lineTo(px + dirX * len, py + dirY * len);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      dirty = true;
    }

    if (dirty) this.dropTex.needsUpdate = true;
  }
}
