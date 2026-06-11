import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
// Freie Kamera: Blick über die Dächer in den Himmel
await page.evaluate(() => {
  const g = window.game;
  g.cameraRig.update = () => {
    const b = g.bus.body.position;
    g.camera.position.set(b.x, b.y + 25, b.z);
    g.camera.lookAt(b.x - 200, b.y + 120, b.z - 300);
  };
});
await new Promise((r) => setTimeout(r, 5000));
await page.screenshot({ path: '/tmp/bussim-shots/95-sky-overcast.png' });
await page.keyboard.press('Escape');
await page.evaluate(() => document.querySelector('#weatherSeg button[data-v="clear"]').click());
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 12000));
await page.screenshot({ path: '/tmp/bussim-shots/96-sky-clear.png' });
// Spiegel-Check aus Fahrersicht: Blick zum rechten Außenspiegel
await page.evaluate(() => {
  delete window.game.cameraRig.update;
  window.game.input.lookYaw = -0.7;
  window.game.input.lookPitch = 0.1;
  window.game.input._returnLook = false;
});
await page.keyboard.press('F1');
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/bussim-shots/97-mirror-right.png' });
await page.evaluate(() => { window.game.input.lookYaw = 0.75; });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/bussim-shots/98-mirror-left.png' });
await browser.close();
