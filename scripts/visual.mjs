// Visuelle Prüfung: Abendsonne (Schatten), Nacht (Lichter), Regen (Scheibe).

import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:5173/?seed=73';
const SHOT = '/tmp/bussim-shots';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

// Abend einstellen (16:30 → lange Schatten)
await page.evaluate(() => {
  const slider = document.getElementById('timeSlider');
  slider.value = '16.5';
  slider.dispatchEvent(new Event('input'));
});
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 9000));

// Außenansicht für Schattencheck
await page.keyboard.press('F2');
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${SHOT}/10-evening-chase.png` });

// Nacht + Licht an
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const slider = document.getElementById('timeSlider');
  slider.value = '22.5';
  slider.dispatchEvent(new Event('input'));
});
await page.keyboard.press('Escape'); // weiter
await new Promise((r) => setTimeout(r, 5000));
await page.keyboard.press('KeyL');
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${SHOT}/11-night-chase.png` });
await page.keyboard.press('F1');
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${SHOT}/12-night-cockpit.png` });

// Regen am Tag, Cockpit (Tropfen + Wischer)
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const slider = document.getElementById('timeSlider');
  slider.value = '11';
  slider.dispatchEvent(new Event('input'));
  document.querySelector('#weatherSeg button[data-v="rain"]').click();
});
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 12000));
await page.screenshot({ path: `${SHOT}/13-rain-cockpit.png` });
// Wischer an (2 Stufen)
await page.evaluate(() => {});
await page.keyboard.press('F2');
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: `${SHOT}/14-rain-chase.png` });

console.log('ERRORS:', errors.length, errors.slice(0, 5));
await browser.close();
