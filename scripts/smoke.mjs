// Headless-Smoke-Test: lädt das Spiel, klickt „Schicht starten", fährt an,
// sammelt Konsolenfehler und macht Screenshots.

import puppeteer from 'puppeteer-core';
import { CHROME, SHOT_DIR } from './_env.mjs';

const URL = process.env.URL || 'http://localhost:5173/?seed=73';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
const warnings = [];
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error') errors.push(msg.text());
  if (t === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.screenshot({ path: `${SHOT_DIR}/01-menu.png` });

// Schicht starten
await page.click('#startBtn');
// Stadtgenerierung + erste Frames abwarten
await new Promise((r) => setTimeout(r, 9000));
await page.screenshot({ path: `${SHOT_DIR}/02-cockpit.png` });

// Zustand auslesen
const state = await page.evaluate(() => {
  const hud = document.getElementById('hud');
  const menu = document.getElementById('menu');
  return {
    hudVisible: hud.classList.contains('visible'),
    menuHidden: menu.classList.contains('hidden'),
    loadingText: document.getElementById('loadingState').textContent,
    nextStop: document.querySelector('#nextStop .stop-name')?.textContent,
    speedBox: document.getElementById('speedBox')?.innerText,
  };
});
console.log('STATE:', JSON.stringify(state, null, 1));

// Feststellbremse lösen, D einlegen, Gas geben
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 400));
await page.keyboard.press('KeyM'); // N→? bereits D? KeyM zyklisch; sicherheitshalber W-Auto-D
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 6000));
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${SHOT_DIR}/03-driving.png` });

const speed = await page.evaluate(() => document.getElementById('speedBox')?.innerText);
console.log('SPEED AFTER 6s W:', JSON.stringify(speed));

// Außenkamera
await page.keyboard.press('F2');
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${SHOT_DIR}/04-chase.png` });
await page.keyboard.press('F3');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${SHOT_DIR}/05-front.png` });

console.log('ERRORS (' + errors.length + '):');
for (const e of errors.slice(0, 20)) console.log('  ', e.slice(0, 300));
console.log('WARNINGS (' + warnings.length + '):');
for (const w of [...new Set(warnings)].slice(0, 10)) console.log('  ', w.slice(0, 200));

await browser.close();
