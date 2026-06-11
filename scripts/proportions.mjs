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

// Bus an Haltestelle mit Wartenden + Tür auf
await page.evaluate(() => {
  const g = window.game;
  let stop = null;
  g.city.route.stops.forEach((s, i) => { if (!stop && g.passengers.waiting[i].length >= 2) stop = s; });
  const yaw = Math.atan2(-stop.dir.x, -stop.dir.z);
  const b = g.bus.body;
  b.position.set(stop.pos.x, stop.pos.y + 1.4, stop.pos.z);
  b.quaternion.set(0, Math.sin(yaw/2), 0, Math.cos(yaw/2));
  b.velocity.set(0,0,0); b.angularVelocity.set(0,0,0);
  b.prevPosition.copy(b.position); b.prevQuaternion.copy(b.quaternion);
  g.bus.parkingBrake = false; g.bus.stopBrake = true;
});
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.press('Digit1');

// 25 s warten, Ticketwünsche automatisch bedienen
for (let t = 0; t < 25; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => {
    const g = window.game, tf = g.ticketFlow, pr = g.cockpit.printer;
    if (tf.active && pr.state === 'idle') pr._selectType(tf.active.type);
    else if (tf.active && pr.state === 'ready') pr._takeTicket();
  });
}

// Kamera-Rig kapern: Seitenansicht in den Innenraum (Schnitt durch die Wand)
await page.evaluate(() => {
  const g = window.game;
  g.cameraRig.update = () => {
    const bg = g.busModel.group;
    const eye = new (g.camera.position.constructor)(-1.0, 0.6, -1.0);
    bg.localToWorld(eye);
    g.camera.position.copy(eye);
    const tgt = new (g.camera.position.constructor)(1.2, -0.5, -1.0);
    bg.localToWorld(tgt);
    g.camera.lookAt(tgt);
  };
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: '/tmp/bussim-shots/50-side-interior.png' });

// Fahrerbereich von rechts
await page.evaluate(() => {
  const g = window.game;
  g.cameraRig.update = () => {
    const bg = g.busModel.group;
    const eye = new (g.camera.position.constructor)(1.0, 0.7, -3.6);
    bg.localToWorld(eye);
    g.camera.position.copy(eye);
    const tgt = new (g.camera.position.constructor)(-0.8, -0.4, -5.0);
    bg.localToWorld(tgt);
    g.camera.lookAt(tgt);
  };
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/bussim-shots/51-driver-area.png' });

// Neue Cockpitansicht (Fahrerblick) prüfen
await page.evaluate(() => { delete window.game.cameraRig.update; });
await page.keyboard.press('F1');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/bussim-shots/52-new-eye.png' });

const info = await page.evaluate(() => ({
  aboard: window.game.passengers.aboard.length,
  seated: window.game.passengers.aboard.filter(p => p.state === 'SEATED').length,
}));
console.log(JSON.stringify(info));
await browser.close();
