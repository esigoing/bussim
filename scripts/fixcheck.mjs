import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 8000));

// 1) Cockpit: Lenkrad-Orientierung
await page.screenshot({ path: '/tmp/bussim-shots/80-wheel.png' });

// 2) Tür 1 öffnen, Außenansicht auf die Türseite
await page.evaluate(() => { window.game.bus.stopBrake = true; });
await page.keyboard.press('Digit1');
await page.keyboard.press('Digit2');
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => {
  const g = window.game;
  g.cameraRig.update = () => {
    const bg = g.busModel.group;
    const eye = new g.camera.position.constructor(6, 1.2, -3.5);
    bg.localToWorld(eye);
    g.camera.position.copy(eye);
    const tgt = new g.camera.position.constructor(0, -0.3, -3.0);
    bg.localToWorld(tgt);
    g.camera.lookAt(tgt);
  };
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/bussim-shots/81-doors.png' });

// 3) Straßen in Senken: Tiefblick über eine Senke
await page.evaluate(() => {
  const g = window.game;
  const t = g.city.terrain;
  // tiefsten Punkt auf der Routen-Südstraße suchen
  let minH = 99, mx = 0, mz = 0;
  for (let x = -400; x < 400; x += 15) {
    const z = 263.5;
    const h = t.hExact(x, z);
    if (h < minH) { minH = h; mx = x; mz = z; }
  }
  g.cameraRig.update = () => {
    g.camera.position.set(mx + 60, t.hExact(mx + 60, mz) + 14, mz + 40);
    g.camera.lookAt(mx, minH, mz);
  };
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/bussim-shots/82-valley.png' });

// 4) Haltestelle von oben
await page.evaluate(() => {
  const g = window.game;
  const s = g.city.route.stops[0];
  g.cameraRig.update = () => {
    g.camera.position.set(s.pos.x + 16, s.pos.y + 17, s.pos.z + 12);
    g.camera.lookAt(s.shelterPos.x, s.pos.y, s.shelterPos.z);
  };
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/bussim-shots/83-stop.png' });
await browser.close();
