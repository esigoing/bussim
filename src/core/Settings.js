// Qualitätspresets. Werte werden von Renderer/PostFX/Mirrors/WeatherFX gelesen.

export const PRESETS = {
  low: {
    shadowMapSize: 1024,
    shadowMaxFar: 120,
    cascades: 2,
    ao: false,
    bloom: false,
    antialiasPass: false,
    mirrorRes: 256,
    mirrorEvery: 3,       // Spiegel-Update alle n Frames (round-robin sowieso)
    rainCount: 800,
    pixelRatioCap: 1,
    anisotropy: 2,
    drawDistance: 450,
  },
  medium: {
    shadowMapSize: 1024,
    shadowMaxFar: 160,
    cascades: 3,
    ao: false,
    bloom: true,
    antialiasPass: true,
    mirrorRes: 320,
    mirrorEvery: 2,
    rainCount: 1500,
    pixelRatioCap: 1.5,
    anisotropy: 4,
    drawDistance: 650,
  },
  high: {
    shadowMapSize: 2048,
    shadowMaxFar: 220,
    cascades: 3,
    ao: true,
    bloom: true,
    antialiasPass: true,
    mirrorRes: 384,
    mirrorEvery: 1,
    rainCount: 2500,
    pixelRatioCap: 2,
    anisotropy: 8,
    drawDistance: 900,
  },
  ultra: {
    shadowMapSize: 4096,
    shadowMaxFar: 260,
    cascades: 4,
    ao: true,
    bloom: true,
    antialiasPass: true,
    mirrorRes: 512,
    mirrorEvery: 1,
    rainCount: 4000,
    pixelRatioCap: 2,
    anisotropy: 16,
    drawDistance: 1200,
  },
};

export class Settings {
  constructor() {
    const stored = localStorage.getItem('bussim.quality');
    this.qualityName = stored && PRESETS[stored] ? stored : 'high';
  }
  get quality() {
    return PRESETS[this.qualityName];
  }
  setQuality(name) {
    if (PRESETS[name]) {
      this.qualityName = name;
      localStorage.setItem('bussim.quality', name);
    }
  }
}

export function getDebugFlags() {
  const d = new URLSearchParams(window.location.search).get('debug') || '';
  const parts = d.split(',');
  return {
    physics: parts.includes('physics'),
    lanes: parts.includes('lanes'),
    audio: parts.includes('audio'),
    perf: parts.includes('perf'),
  };
}
