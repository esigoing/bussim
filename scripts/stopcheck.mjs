import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 8000));
const res = await page.evaluate(() => {
  const g = window.game;
  const t = g.city.terrain;
  return g.city.route.stops.map((s) => {
    const sp = s.shelterPos;
    const gh = g.city.groundHeight(sp.x, sp.z);
    const th = t.hExact(sp.x, sp.z);
    return {
      name: s.name,
      onRoad: Math.abs(gh - th) < 0.05,         // Straße = exakt Terrainhöhe
      shelter: [sp.x.toFixed(0), sp.z.toFixed(0)],
      stopPos: [s.pos.x.toFixed(0), s.pos.z.toFixed(0)],
      dir: [s.dir.x.toFixed(2), s.dir.z.toFixed(2)],
    };
  });
});
console.table ? console.log(JSON.stringify(res, null, 1)) : 0;
await browser.close();
