// Funktionstest Fahrgast-Loop: Bus an Haltestelle setzen, Tür 1 öffnen,
// Einstieg + Ticketverkauf am Drucker durchspielen, Sitzplatz prüfen.

import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 9000));

// Bus an eine Haltestelle mit Wartenden teleportieren
const setup = await page.evaluate(() => {
  const g = window.game;
  // Haltestelle mit mindestens 2 Wartenden suchen
  let stop = null;
  g.city.route.stops.forEach((s, i) => {
    if (!stop && g.passengers.waiting[i].length >= 2) stop = s;
  });
  if (!stop) stop = g.city.route.stops[0];
  const yaw = Math.atan2(-stop.dir.x, -stop.dir.z);
  const b = g.bus.body;
  b.position.set(stop.pos.x, 1.4, stop.pos.z);
  b.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  b.velocity.set(0, 0, 0);
  b.angularVelocity.set(0, 0, 0);
  b.prevPosition.copy(b.position);
  b.prevQuaternion.copy(b.quaternion);
  g.bus.parkingBrake = false;
  g.bus.stopBrake = true;
  return { stopName: stop.name, waiting: g.passengers.waiting[stop.index].length, index: stop.index };
});
console.log('SETUP:', JSON.stringify(setup));

// Tür 1 öffnen
await new Promise((r) => setTimeout(r, 700));
await page.keyboard.press('Digit1');
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/bussim-shots/30-door-open.png' });

// Einstieg über max. 40 s beobachten, Ticketwünsche am Drucker bedienen
let lastLog = '';
for (let t = 0; t < 40; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const st = await page.evaluate(() => {
    const g = window.game;
    const tf = g.ticketFlow;
    const printer = g.cockpit.printer;
    // Ticketwunsch automatisch bedienen (simuliert Spielerklicks)
    if (tf.active && printer.state === 'idle') {
      printer._selectType(tf.active.type);
    } else if (tf.active && printer.state === 'ready') {
      printer._takeTicket();
    }
    return {
      serving: g.passengers.servingStop?.name ?? null,
      boarder: g.passengers.currentBoarder?.state ?? null,
      aboard: g.passengers.aboard.length,
      seated: g.passengers.aboard.filter((p) => p.state === 'SEATED').length,
      queue: g.passengers.boardingQueue.length,
      earnings: tf.earnings.toFixed(2),
      busCount: g.bus.passengerCount,
      ticketActive: !!tf.active,
    };
  });
  const log = JSON.stringify(st);
  if (log !== lastLog) {
    console.log(`t=${t}s`, log);
    lastLog = log;
  }
  if (st.aboard >= setup.waiting && st.seated === st.aboard && !st.ticketActive && st.boarder === null && st.queue === 0 && st.aboard > 0) break;
}

await page.screenshot({ path: '/tmp/bussim-shots/31-boarded.png' });

// Innenraum-Kamera: sitzen die Fahrgäste?
await page.keyboard.press('F4');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: '/tmp/bussim-shots/32-cabin.png' });

// Haltewunsch-Logik: nächster Halt = Ziel eines Fahrgasts simulieren
const stopReq = await page.evaluate(() => {
  const g = window.game;
  const p = g.passengers.aboard[0];
  if (!p) return { ok: false };
  g.passengers.setNextStop(p.destIndex);
  // Bus „fährt" (Haltewunsch-Bedingung speedKmh > 10)
  g.bus.body.velocity.set(0, 0, -4);
  return { dest: p.destIndex };
});
await new Promise((r) => setTimeout(r, 1500));
const reqState = await page.evaluate(() => ({
  stopRequested: window.game.bus.stopRequested,
  signVisible: window.game.busModel.stopSign.visible,
}));
console.log('HALTEWUNSCH:', JSON.stringify({ ...stopReq, ...reqState }));

await browser.close();
