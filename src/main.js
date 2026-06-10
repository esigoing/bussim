// Boot: Menü verdrahten, beim Start (User-Geste → AudioContext erlaubt)
// das Spiel erzeugen. ESC pausiert und öffnet das Menü wieder.

import { Game } from './core/Game.js';
import { Settings } from './core/Settings.js';

const settings = new Settings();

const menuEl = document.getElementById('menu');
const startBtn = document.getElementById('startBtn');
const timeSlider = document.getElementById('timeSlider');
const timeLabel = document.getElementById('timeLabel');
const loadingState = document.getElementById('loadingState');
const hudEl = document.getElementById('hud');

let game = null;
let weatherName = 'clear';

function fmtTime(t) {
  const h = Math.floor(t) % 24;
  const m = Math.round((t % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} Uhr`;
}

timeSlider.addEventListener('input', () => {
  timeLabel.textContent = fmtTime(parseFloat(timeSlider.value));
  if (game) game.setTimeOfDay(parseFloat(timeSlider.value));
});
timeLabel.textContent = fmtTime(parseFloat(timeSlider.value));

function wireSegment(id, onChange) {
  const seg = document.getElementById(id);
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    onChange(btn.dataset.v);
  });
}

wireSegment('weatherSeg', (v) => {
  weatherName = v;
  if (game) game.setWeather(v);
});

wireSegment('qualitySeg', (v) => {
  settings.setQuality(v);
  if (game) {
    loadingState.textContent = 'Qualität wird nach Neuladen der Seite aktiv.';
  }
});
// Gespeicherte Qualität im Menü anzeigen
document.querySelectorAll('#qualitySeg button').forEach((b) => {
  b.classList.toggle('active', b.dataset.v === settings.qualityName);
});

startBtn.addEventListener('click', async () => {
  if (!game) {
    startBtn.disabled = true;
    loadingState.textContent = 'Stadt wird generiert …';
    // Dem Browser einen Frame zum Rendern des Ladetexts geben
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    try {
      game = new Game(document.getElementById('app'), settings);
      window.game = game; // Debug-Zugriff (?debug=…)
      game.setTimeOfDay(parseFloat(timeSlider.value));
      game.setWeather(weatherName);
      await game.init();
    } catch (err) {
      console.error(err);
      loadingState.textContent = 'Fehler beim Start — siehe Konsole.';
      startBtn.disabled = false;
      return;
    }
    startBtn.disabled = false;
    loadingState.textContent = '';
  }
  menuEl.classList.add('hidden');
  hudEl.classList.add('visible');
  startBtn.textContent = 'Weiter fahren';
  game.resume();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game) {
    if (menuEl.classList.contains('hidden')) {
      menuEl.classList.remove('hidden');
      game.pause();
    } else {
      menuEl.classList.add('hidden');
      game.resume();
    }
  }
});
