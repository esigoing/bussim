// DOM-HUD: nächste Haltestelle, Meldungen, Ticket-Prompt, Status-Box.
// Updates gedrosselt (10 Hz), Events-getrieben für Meldungen.

import { Events } from '../core/Events.js';

export class HUD {
  constructor() {
    this.elStop = document.querySelector('#nextStop .stop-name');
    this.elMsg = document.getElementById('hudMsg');
    this.elTicket = document.getElementById('ticketPrompt');
    this.elSpeed = document.getElementById('speedBox');

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
