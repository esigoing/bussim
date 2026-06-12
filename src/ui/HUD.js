// DOM-HUD: nächste Haltestelle, Fahrplan/Verspätung, Meldungen, Ticket-Prompt,
// Status-Box, Fahrplan-Overlay. Updates gedrosselt (10 Hz), Events-getrieben.

import { Events } from '../core/Events.js';

// Spielstunden (0–24, Bruchteile) → "HH:MM"
function fmtClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class HUD {
  constructor() {
    this.elStop = document.querySelector('#nextStop .stop-name');
    this.elMsg = document.getElementById('hudMsg');
    this.elTicket = document.getElementById('ticketPrompt');
    this.elSpeed = document.getElementById('speedBox');
    this.elPlan = document.getElementById('planTime');
    this.elDelay = document.getElementById('delayChip');
    this.elTimetable = document.getElementById('timetable');
    this.elTimetableBody = document.getElementById('timetableBody');

    this._msgTimer = 0;
    this._accum = 0;
    this.earnings = 0;

    Events.on('ticketRequest', ({ label, price }) => {
      this.elTicket.innerHTML =
        `Fahrgast möchte: <span class="want">${label} (${price.toFixed(2)} €)</span>` +
        `<div class="hint">Tickettyp am Drucker wählen, dann das gedruckte Ticket anklicken</div>`;
      this.elTicket.classList.add('visible');
    });
    Events.on('ticketWrong', ({ wanted }) => {
      this.message(`Falsches Ticket — gewünscht: ${wanted}`, true);
    });
    Events.on('ticketResolved', ({ ok, reason, earnings }) => {
      this.earnings = earnings;
      this.elTicket.classList.remove('visible');
      if (ok) this.message('Ticket verkauft ✓');
      else if (reason === 'timeout') this.message('Fahrgast hat passend gezahlt', true);
      else this.message('Fahrgast nimmt das Ticket trotzdem', true);
    });
    Events.on('punctualBonus', ({ bonus }) => {
      this.message(`Pünktlich abgefahren ✓ Bonus +${bonus.toFixed(2)} €`);
    });
    Events.on('doorBlocked', () => this.message('Türfreigabe nur im Stand (< 3 km/h)', true));
    Events.on('lowAir', () => this.message('⚠ Luftdruck niedrig — Kompressor lädt', true));
    Events.on('stopRequested', () => this.message('Haltewunsch'));
  }

  message(text, warn = false) {
    this.elMsg.textContent = text;
    this.elMsg.classList.toggle('warn', warn);
    this.elMsg.classList.add('visible');
    this._msgTimer = 3.2;
  }

  setNextStop(name) {
    if (this.elStop.textContent !== name) this.elStop.textContent = name;
  }

  // Soll-Zeit (Spielstunden 0–24) + Abweichung (Minuten, + = verspätet)
  setSchedule(plannedHours, delayMin) {
    if (plannedHours === null || plannedHours === undefined) {
      this.elPlan.textContent = '';
      this.elDelay.textContent = '—';
      this.elDelay.className = 'delay-chip';
      return;
    }
    this.elPlan.textContent = 'an ' + fmtClock(plannedHours);
    const cls = delayMin > 0.75 ? 'late' : delayMin < -0.75 ? 'early' : 'ontime';
    this.elDelay.className = 'delay-chip ' + cls;
    if (cls === 'ontime') {
      this.elDelay.textContent = 'pünktlich';
    } else {
      const a = Math.abs(delayMin);
      const m = Math.floor(a);
      const s = Math.round((a - m) * 60);
      this.elDelay.textContent = `${delayMin > 0 ? '+' : '−'}${m}:${String(s).padStart(2, '0')}`;
    }
  }

  // Fahrplan-Overlay: rows = [{name, plannedHours, state: 'passed'|'next'|''}]
  toggleTimetable(rows) {
    const vis = this.elTimetable.classList.toggle('visible');
    if (vis && rows) this.renderTimetable(rows);
    return vis;
  }

  renderTimetable(rows) {
    this.elTimetableBody.innerHTML = rows.map((r) =>
      `<tr class="${r.state}"><td>${r.name}</td><td style="text-align:right">${fmtClock(r.plannedHours)}</td></tr>`
    ).join('');
  }

  update(dt, bus) {
    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this.elMsg.classList.remove('visible');
    }
    this._accum += dt;
    if (this._accum < 0.1) return;
    this._accum = 0;

    const gb = bus.gearbox;
    const gear = gb.selector === 'D' ? `D${gb.gear}` : gb.selector;
    this.elSpeed.innerHTML =
      `<b>${Math.round(bus.speedKmh)}</b> km/h · ${gear}` +
      `<br>Luft ${bus.air.circuit1.toFixed(1)} / ${bus.air.circuit2.toFixed(1)} bar` +
      `<br>Fahrgäste ${bus.passengerCount} · Kasse ${this.earnings.toFixed(2)} €` +
      (bus.parkingBrake ? '<br><span style="color:#ff6a5e">Feststellbremse</span>' : '') +
      (bus.stopBrake ? '<br><span style="color:#ffd479">Haltestellenbremse</span>' : '');
  }
}
