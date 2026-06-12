import puppeteer from 'puppeteer-core';
import { CHROME, SHOT_DIR } from './_env.mjs';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 8000));
await page.evaluate(() => {
  const g = window.game;
  const t = g.city.terrain;
  const rn = g.city.roadNet;
  // tiefste Stelle entlang der NS-Straße i=2 suchen (kurvig + Senken)
  let minH = 99, mz = 0;
  for (let z = -400; z < 400; z += 10) {
    const h = t.hExact(rn.centerX(2, z), z);
    if (h < minH) { minH = h; mz = z; }
  }
  const x0 = rn.centerX(2, mz + 90);
  g.cameraRig.update = () => {
    g.camera.position.set(x0, t.hExact(x0, mz + 90) + 7, mz + 90);
    g.camera.lookAt(rn.centerX(2, mz), minH, mz);
  };
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${SHOT_DIR}/84-valley2.png` });
await browser.close();
