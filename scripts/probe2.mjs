import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  const s = document.getElementById('timeSlider');
  s.value = '16.5'; s.dispatchEvent(new Event('input'));
});
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 8000));
await page.evaluate(() => {
  const g = window.game;
  g.lighting.hemi.intensity = 0;
  g.scene.environment = null;
  // Umwelt-Updates einfrieren, damit die Werte bleiben
  g.lighting.update = () => { g.lighting.csm.update(); };
  g.env.update = () => {};
});
await page.keyboard.press('F2');
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: '/tmp/bussim-shots/20-shadowtest.png' });
await browser.close();
