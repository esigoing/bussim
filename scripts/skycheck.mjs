import puppeteer from 'puppeteer-core';
import { CHROME, SHOT_DIR } from './_env.mjs';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  document.querySelector('#weatherSeg button[data-v="overcast"]').click();
  const s = document.getElementById('timeSlider');
  s.value = '13'; s.dispatchEvent(new Event('input'));
});
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 9000));
// Blick zum Himmel
await page.evaluate(() => { window.game.input.lookPitch = 0.55; window.game.input._returnLook = false; });
await new Promise((r) => setTimeout(r, 4000));
await page.screenshot({ path: `${SHOT_DIR}/90-overcast.png` });
// Regen
await page.keyboard.press('Escape');
await page.evaluate(() => document.querySelector('#weatherSeg button[data-v="rain"]').click());
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 8000));
await page.screenshot({ path: `${SHOT_DIR}/91-rainsky.png` });
// klar als Gegenprobe
await page.keyboard.press('Escape');
await page.evaluate(() => document.querySelector('#weatherSeg button[data-v="clear"]').click());
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 10000));
await page.screenshot({ path: `${SHOT_DIR}/92-clearsky.png` });
// Blinkerhebel: Blick auf die Lenksäule
await page.evaluate(() => {
  const g = window.game;
  g.input.lookPitch = -0.45; g.input.lookYaw = 0.15;
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${SHOT_DIR}/93-stalk.png` });
// Seitenblinker: Außenansicht rechte Seite mit offener Tür 1 + Blinker an
await page.evaluate(() => {
  const g = window.game;
  g.bus.stopBrake = true;
  g.bus.doors.toggle(0, 0);
  g.bus.blinker = 1;
  g.cameraRig.update = () => {
    const bg = g.busModel.group;
    const eye = new g.camera.position.constructor(7, 0.6, -4.4);
    bg.localToWorld(eye);
    g.camera.position.copy(eye);
    const tgt = new g.camera.position.constructor(0, -0.2, -4.4);
    bg.localToWorld(tgt);
    g.camera.lookAt(tgt);
  };
});
await new Promise((r) => setTimeout(r, 2600));
await page.screenshot({ path: `${SHOT_DIR}/94-sideblinker.png` });
await browser.close();
