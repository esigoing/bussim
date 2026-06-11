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
  const rn = g.city.roadNet;
  const s = g.city.route.stops[0]; // Hauptbahnhof
  const sp = s.shelterPos;
  const out = { name: s.name, x: sp.x, z: sp.z, hits: [] };
  for (let i = 0; i < rn.xs.length; i++) {
    const cx = rn.centerX(i, sp.z);
    if (Math.abs(sp.x - cx) <= rn.halfX[i]) {
      out.hits.push({ type: 'NS', i, cx: cx.toFixed(1), seg: rn._segIndex(rn.zs, sp.z), segOn: rn.segNS[i][rn._segIndex(rn.zs, sp.z)] });
    }
  }
  for (let j = 0; j < rn.zs.length; j++) {
    if (Math.abs(sp.z - rn.zs[j]) <= rn.halfZ[j]) {
      out.hits.push({ type: 'EW', j, zj: rn.zs[j].toFixed(1), seg: rn._segIndex(rn.xs, sp.x), segOn: rn.segEW[j][rn._segIndex(rn.xs, sp.x)] });
    }
  }
  out.nearInt = rn._nearIntersection(sp.x, sp.z);
  out.zs6 = rn.zs[6].toFixed(1);
  out.laneZ = s.pos.z.toFixed(1);
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
