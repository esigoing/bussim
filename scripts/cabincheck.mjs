import puppeteer from 'puppeteer-core';
import { CHROME, SHOT_DIR } from './_env.mjs';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--window-size=1280,800', '--use-gl=angle', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:5173/?seed=73', { waitUntil: 'networkidle0' });
await page.click('#startBtn');
await new Promise((r) => setTimeout(r, 8000));
await page.keyboard.press('F4');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${SHOT_DIR}/99-cabin.png` });
await browser.close();
