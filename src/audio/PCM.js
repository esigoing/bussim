// AudioBuffer-Synthese: Rauschsorten, Klicks, Impulsantworten.
// Alles deterministisch genug — Audio braucht keinen Seed.

export function whiteNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function pinkNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

export function brownNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}

// Kabinen-Impulsantwort: exponentiell abklingendes, tiefpass-gefärbtes Rauschen
export function impulseResponse(ctx, seconds = 0.18, decay = 6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-decay * (i / len) * seconds * 10);
      const w = (Math.random() * 2 - 1) * env;
      lp += (w - lp) * 0.25; // einfacher Tiefpass
      d[i] = lp;
    }
  }
  return buf;
}

// Kurzer Klick (Blinkrelais, Tastendruck): Impuls durch Resonanz gefärbt
export function clickBuffer(ctx, freq = 2200, seconds = 0.03, sharp = 600) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    d[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * sharp);
  }
  return buf;
}

// Münzklimpern: mehrere metallische Pings mit zufälligen Abständen
export function coinBuffer(ctx) {
  const seconds = 0.5;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const pings = [
    { t: 0, f: 5200 }, { t: 0.06, f: 4400 }, { t: 0.13, f: 5800 },
    { t: 0.2, f: 4900 }, { t: 0.26, f: 5500 },
  ];
  for (const p of pings) {
    const start = Math.floor(p.t * ctx.sampleRate);
    for (let i = start; i < len; i++) {
      const t = (i - start) / ctx.sampleRate;
      d[i] += Math.sin(2 * Math.PI * p.f * t) * Math.exp(-t * 90) * 0.4
            + Math.sin(2 * Math.PI * p.f * 1.48 * t) * Math.exp(-t * 130) * 0.2;
    }
  }
  return buf;
}

// Nadeldrucker: Tick-Zug über die Druckdauer
export function printerBuffer(ctx, seconds = 0.9) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const tickEvery = 0.018;
  for (let tick = 0; tick * tickEvery < seconds; tick++) {
    const start = Math.floor(tick * tickEvery * ctx.sampleRate);
    for (let i = 0; i < 90 && start + i < len; i++) {
      const t = i / ctx.sampleRate;
      d[start + i] += (Math.random() * 2 - 1) * Math.exp(-t * 2500) * 0.5
                    + Math.sin(2 * Math.PI * 3100 * t) * Math.exp(-t * 1800) * 0.3;
    }
  }
  // Motor-Surren darunter
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.min(1, t * 30) * Math.min(1, (seconds - t) * 30);
    d[i] += Math.sin(2 * Math.PI * 140 * t) * 0.07 * env * (1 + 0.3 * Math.sin(2 * Math.PI * 9 * t));
  }
  return buf;
}

// Kassen-/Entwerter-Piep
export function beepBuffer(ctx, freq = 1750, seconds = 0.12) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.min(1, t * 200) * Math.min(1, (seconds - t) * 60);
    d[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.6;
  }
  return buf;
}

// Haltewunsch-Gong: zwei weiche Sinustöne
export function chimeBuffer(ctx) {
  const seconds = 0.9;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const notes = [{ t: 0, f: 880 }, { t: 0.22, f: 660 }];
  for (const n of notes) {
    const start = Math.floor(n.t * ctx.sampleRate);
    for (let i = start; i < len; i++) {
      const t = (i - start) / ctx.sampleRate;
      d[i] += Math.sin(2 * Math.PI * n.f * t) * Math.exp(-t * 5) * 0.35
            + Math.sin(2 * Math.PI * n.f * 2 * t) * Math.exp(-t * 9) * 0.1;
    }
  }
  return buf;
}
