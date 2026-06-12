// M9-Verifikation: (1) Verkehrs-Soak — bewegen sich Autos, halten sie an
// roten Ampeln, gibt es Dauersteher? (2) Fahrtest 0–50 km/h.
// (3) Frame-Zeiten (Software-Renderer → nur Relativwerte).

import puppeteer from 'puppeteer-core';
import { CHROME } from './_env.mjs';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 8000));

// ---- Verkehrs-Snapshot t0
const snap = () => page.evaluate(() => {
  const cars = window.game.traffic.cars;
  return {
    moving: cars.filter((c) => c.v > 0.5).length,
    stopped: cars.filter((c) => c.v <= 0.5).length,
    stuck: cars.filter((c) => c.stuckTimer > 30).length,
    avgV: (cars.reduce((a, c) => a + c.v, 0) / cars.length).toFixed(1),
  };
});
console.log('TRAFFIC t=0s :', JSON.stringify(await snap()));
await new Promise((r) => setTimeout(r, 30000));
console.log('TRAFFIC t=30s:', JSON.stringify(await snap()));
await new Promise((r) => setTimeout(r, 30000));
console.log('TRAFFIC t=60s:', JSON.stringify(await snap()));

// ---- Fahrtest 0→50
await page.evaluate(() => {
  const g = window.game;
  g.bus.parkingBrake = false;
  g.bus.gearbox.setSelector('D');
});
await page.keyboard.down('KeyW');
const t0 = Date.now();
let t50 = null;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const v = await page.evaluate(() => window.game.bus.speedKmh);
  if (v >= 50) { t50 = (Date.now() - t0) / 1000; break; }
}
await page.keyboard.up('KeyW');
console.log('0–50 km/h:', t50 ? t50.toFixed(1) + ' s' : 'nicht erreicht');

// Gänge geprüft?
const gear = await page.evaluate(() => ({
  gear: window.game.bus.gearbox.gear,
  rpm: Math.round(window.game.bus.engine.rpm),
}));
console.log('GEAR:', JSON.stringify(gear));

// ---- Frame-Zeiten (60 Frames)
const frames = await page.evaluate(() => new Promise((resolve) => {
  const times = [];
  let last = performance.now();
  let n = 0;
  function tick(now) {
    times.push(now - last);
    last = now;
    if (++n < 60) requestAnimationFrame(tick);
    else {
      times.sort((a, b) => a - b);
      resolve({
        median: times[30].toFixed(1),
        p90: times[54].toFixed(1),
        calls: window.game.renderer.info.render.calls,
        tris: Math.round(window.game.renderer.info.render.triangles / 1000) + 'k',
      });
    }
  }
  requestAnimationFrame(tick);
}));
console.log('FRAMES (SwiftShader):', JSON.stringify(frames));

await browser.close();
