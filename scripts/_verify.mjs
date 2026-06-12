// Einmal-Verifikation der Großausbau-Features + Spieltest-Fixes:
// Fußgänger, Fahrplan-Overlay, Fahrerfenster, Cockpit-Sicht, Spiegel,
// Ampelmasten am Hang, Stadt-Luftbild.

import puppeteer from 'puppeteer-core';
import { CHROME, SHOT_DIR } from './_env.mjs';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 9000));

// --- Cockpit aus exakt DRIVER_EYE (Lenkrad/Konsole/Wischer)
await page.screenshot({ path: `${SHOT_DIR}/70-cockpit-neu.png` });

// --- Fahrerfenster (Taste G)
const winBefore = await page.evaluate(() => window.game.busModel.driverWindowProgress);
await page.keyboard.press('KeyG');
await new Promise((r) => setTimeout(r, 1600));
const winAfter = await page.evaluate(() => window.game.busModel.driverWindowProgress);
console.log('FENSTER G:', JSON.stringify({ winBefore, winAfter }));

// --- Blick nach links: Spiegelglas frei sichtbar?
await page.evaluate(() => {
  const g = window.game;
  g.cameraRig.update = () => {
    const bg = g.busModel.group;
    const eye = new (g.camera.position.constructor)(-0.62, 0.82, -4.5);
    bg.localToWorld(eye);
    g.camera.position.copy(eye);
    const tgt = new (g.camera.position.constructor)(-2.6, 0.7, -5.65);
    bg.localToWorld(tgt);
    g.camera.lookAt(tgt);
  };
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${SHOT_DIR}/71-spiegel-links.png` });

// --- Ampel am stärksten Hang suchen und anschauen
const pole = await page.evaluate(() => {
  const g = window.game;
  const tl = g.city.trafficLights || g.trafficLights || (g.city.roadNet && g.city.roadNet.trafficLights);
  if (!tl || !tl._poles) return null;
  let best = null;
  for (const p of tl._poles) {
    if (!best || Math.abs(p.y) > Math.abs(best.y)) best = p;
  }
  return best;
});
console.log('AMPEL-MAST (max |y|):', JSON.stringify(pole));
if (pole) {
  await page.evaluate(({ x, y, z }) => {
    const g = window.game;
    g.cameraRig.update = () => {
      g.camera.position.set(x + 9, y + 3.5, z + 9);
      g.camera.lookAt(x, y + 1.6, z);
    };
  }, pole);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${SHOT_DIR}/72-ampel-hang.png` });
}

// --- Fußgänger zählen + anschauen
const ped = await page.evaluate(() => {
  const g = window.game;
  const p = g.pedestrians;
  if (!p) return null;
  if (!p.peds || p.peds.length === 0) return { count: 0 };
  const pos = p.peds[0].grp.position;
  return { count: p.peds.length, x: pos.x, y: pos.y, z: pos.z };
});
console.log('FUSSGAENGER:', JSON.stringify(ped));
if (ped && ped.count > 0) {
  await page.evaluate(({ x, y, z }) => {
    const g = window.game;
    g.cameraRig.update = () => {
      g.camera.position.set(x + 5, y + 2.5, z + 5);
      g.camera.lookAt(x, y + 1, z);
    };
  }, ped);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${SHOT_DIR}/73-fussgaenger.png` });
}

// --- Render-Statistik
const stats = await page.evaluate(() => ({
  drawCalls: window.game.renderer.info.render.calls,
  triangles: window.game.renderer.info.render.triangles,
}));
console.log('RENDER:', JSON.stringify(stats));

console.log('ERRORS:', errors.length, errors.slice(0, 5));
await browser.close();
