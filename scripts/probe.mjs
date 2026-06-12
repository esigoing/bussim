// Laufzeit-Diagnose: Schatten, Draw Calls, Lichter, Materialien.

import puppeteer from 'puppeteer-core';
import { CHROME } from './_env.mjs';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  const slider = document.getElementById('timeSlider');
  slider.value = '16.5';
  slider.dispatchEvent(new Event('input'));
});
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 9000));

const probe = await page.evaluate(() => {
  const g = window.game;
  const csm = g.lighting.csm;
  const l0 = csm.lights[0];
  return {
    renderInfo: { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles },
    shadowMapEnabled: g.renderer.shadowMap.enabled,
    cascades: csm.lights.length,
    light0: {
      castShadow: l0.castShadow,
      intensity: l0.intensity,
      hasMap: !!l0.shadow.map,
      mapSize: l0.shadow.mapSize.width,
      camLeft: l0.shadow.camera.left,
      camFar: l0.shadow.camera.far,
      pos: l0.position.toArray().map((v) => Math.round(v)),
      target: l0.target.position.toArray().map((v) => Math.round(v)),
    },
    lightDir: csm.lightDirection.toArray().map((v) => v.toFixed(2)),
    sunFactor: g.env.sunFactor.toFixed(2),
    night: g.env.night.toFixed(2),
    busPos: g.bus.body.position.toArray().map((v) => Math.round(v)),
    paintHasCSMDefine: !!g.busModel.paintMat.defines?.USE_CSM,
    sceneEnvSet: !!g.scene.environment,
    postfxEnabled: g.postfx.enabled,
  };
});
console.log(JSON.stringify(probe, null, 1));
await browser.close();
