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
// Fahrgast direkt einsetzen (sitzt) mit Ziel = aktueller nächster Halt
const res1 = await page.evaluate(() => {
  const g = window.game;
  const sys = g.passengers;
  // künstlich: ersten wartenden Fahrgast an Bord setzen
  const p = sys.waiting.flat()[0];
  p.state = 'SEATED';
  p.aboard = true;
  sys.aboard.push(p);
  p.destIndex = sys.nextStopIndex;
  g.bus.body.velocity.set(0, 0, -4);
  return { dest: p.destIndex, next: sys.nextStopIndex };
});
await new Promise((r) => setTimeout(r, 1500));
const res2 = await page.evaluate(() => ({
  stopRequested: window.game.bus.stopRequested,
  signVisible: window.game.busModel.stopSign.visible,
}));
console.log(JSON.stringify({ ...res1, ...res2 }));
await browser.close();
