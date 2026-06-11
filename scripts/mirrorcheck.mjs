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
  const V = g.camera.position.constructor;
  const eyeWorld = g.busModel.group.localToWorld(new V(-0.62, 0.82, -4.5));
  return g.mirrors.mirrors.map((m, i) => {
    // Plane-Normale (+z lokal) in Welt
    const n = new V(0, 0, 1).applyQuaternion(m.plane.getWorldQuaternion(new (g.camera.quaternion.constructor)()));
    const pos = m.plane.getWorldPosition(new V());
    const toEye = eyeWorld.clone().sub(pos).normalize();
    return {
      i,
      facesDriver: n.dot(toEye) > 0,
      dot: n.dot(toEye).toFixed(2),
      visibleLayer: m.plane.layers.mask,
    };
  });
});
console.log(JSON.stringify(res));
await browser.close();
