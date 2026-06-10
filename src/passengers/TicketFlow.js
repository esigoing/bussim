// Ticketverkauf am Fahrscheindrucker: Fahrgast nennt einen Tickettyp,
// der Spieler wählt am 3D-Drucker den Typ (Druck startet), klickt das
// gedruckte Ticket an → Übergabe + Münzgeld. Falsches Ticket (2×) oder
// 12 s Timeout blockieren den Ablauf nie dauerhaft.

import { Events } from '../core/Events.js';
import { TICKET_TYPES } from '../cockpit/TicketPrinter.js';

export class TicketFlow {
  constructor(printer) {
    this.printer = printer;
    this.active = null;     // {passenger, type, timer, wrongCount, resolve}
    this.earnings = 0;

    printer.onTicketTaken = (type) => this._onTicket(type);
  }

  // resolve() wird gerufen, wenn der Fahrgast weitergehen darf
  request(passenger, rand, resolve) {
    const type = rand.chance(0.5) ? TICKET_TYPES[0] : rand.pick(TICKET_TYPES);
    this.active = { passenger, type, timer: 12, wrongCount: 0, resolve };
    Events.emit('ticketRequest', { label: type.label, price: type.price });
  }

  _onTicket(type) {
    if (!this.active) return;
    if (type.id === this.active.type.id) {
      this.earnings += type.price;
      Events.emit('coinPay');
      Events.emit('ticketResolved', { ok: true, earnings: this.earnings });
      this._finish();
    } else {
      this.active.wrongCount++;
      if (this.active.wrongCount >= 2) {
        // Fahrgast nimmt es hin, zahlt passend
        this.earnings += this.active.type.price;
        Events.emit('coinPay');
        Events.emit('ticketResolved', { ok: false, reason: 'wrong', earnings: this.earnings });
        this._finish();
      } else {
        Events.emit('ticketWrong', { wanted: this.active.type.label });
      }
    }
  }

  _finish() {
    const resolve = this.active.resolve;
    this.active = null;
    resolve();
  }

  update(dt) {
    if (!this.active) return;
    this.active.timer -= dt;
    if (this.active.timer <= 0) {
      // Fahrgast zahlt bar und geht durch
      this.earnings += this.active.type.price;
      Events.emit('coinPay');
      Events.emit('ticketResolved', { ok: false, reason: 'timeout', earnings: this.earnings });
      this._finish();
    }
  }
}
