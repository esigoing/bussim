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
    trafficCount: 40,      // KI-Fahrzeuge gesamt
    pedestrianCount: 0,    // Fußgänger auf Gehwegen
    waitingMax: 4,         // max. Wartende je Haltestelle
    propsDensity: 0.6,     // Dichtefaktor für Stadtmöblierung/Props
    cityDetail: 0,         // Detailstufe der Stadtgeometrie (0–3)
    figureDetail: 'low',   // Geometriedetail der Figuren
    figureProps: false,    // Accessoires an Figuren (Taschen etc.)
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
    trafficCount: 70,      // KI-Fahrzeuge gesamt
    pedestrianCount: 15,   // Fußgänger auf Gehwegen
    waitingMax: 6,         // max. Wartende je Haltestelle
    propsDensity: 0.8,     // Dichtefaktor für Stadtmöblierung/Props
    cityDetail: 1,         // Detailstufe der Stadtgeometrie (0–3)
    figureDetail: 'med',   // Geometriedetail der Figuren
    figureProps: false,    // Accessoires an Figuren (Taschen etc.)
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
    trafficCount: 110,     // KI-Fahrzeuge gesamt
    pedestrianCount: 30,   // Fußgänger auf Gehwegen
    waitingMax: 8,         // max. Wartende je Haltestelle
    propsDensity: 1.0,     // Dichtefaktor für Stadtmöblierung/Props
    cityDetail: 2,         // Detailstufe der Stadtgeometrie (0–3)
    figureDetail: 'high',  // Geometriedetail der Figuren
    figureProps: true,     // Accessoires an Figuren (Taschen etc.)
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
    trafficCount: 150,     // KI-Fahrzeuge gesamt
    pedestrianCount: 50,   // Fußgänger auf Gehwegen
    waitingMax: 10,        // max. Wartende je Haltestelle
    propsDensity: 1.25,    // Dichtefaktor für Stadtmöblierung/Props
    cityDetail: 3,         // Detailstufe der Stadtgeometrie (0–3)
    figureDetail: 'high',  // Geometriedetail der Figuren
    figureProps: true,     // Accessoires an Figuren (Taschen etc.)
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
