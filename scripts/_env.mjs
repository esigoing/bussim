// Gemeinsame Umgebung für alle Test-Scripts: Chrome-Pfad (per env CHROME
// überschreibbar, sonst plattformabhängiger Standard) und Screenshot-Ordner
// im System-Temp — wird beim Import angelegt.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const CHROME = process.env.CHROME ?? (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

export const SHOT_DIR = path.join(os.tmpdir(), 'bussim-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
