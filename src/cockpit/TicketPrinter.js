// Fahrscheindrucker am Fahrerplatz: Tasten für Tickettypen, Druckschacht,
// Ticket fährt animiert heraus und wird per Klick an den Fahrgast übergeben.
// Die Verkaufslogik (wer will was) liegt in TicketFlow — hier nur Gerät.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Events } from '../core/Events.js';

export const TICKET_TYPES = [
  { id: 'einzel', label: 'Einzel', price: 3.2 },
  { id: 'kurz', label: 'Kurzstr.', price: 1.9 },
  { id: 'tages', label: 'Tages', price: 8.6 },
];

function keypadTexture(label, color = '#d8dade') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = color;
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ticketTexture(typeLabel, price) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f0e4';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#222';
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('STADTWERKE', 64, 28);
  ctx.font = '11px monospace';
  ctx.fillText('Linie 73', 64, 48);
  ctx.fillText('────────────', 64, 64);
  ctx.font = 'bold 16px monospace';
  ctx.fillText(typeLabel.toUpperCase(), 64, 92);
  ctx.font = 'bold 20px monospace';
  ctx.fillText(`${price.toFixed(2)} €`, 64, 122);
  ctx.font = '10px monospace';
  ctx.fillText('────────────', 64, 142);
  ctx.fillText('Gültig ab Entwertung', 64, 160);
  // Barcode
  let x = 20;
  while (x < 108) {
    const w = 1 + Math.floor(Math.random() * 3);
    ctx.fillRect(x, 190, w, 40);
    x += w + 1 + Math.floor(Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TicketPrinter {
  constructor(buttons) {
    this.group = new THREE.Group();
    this.state = 'idle'; // idle | printing | ready
    this.printProgress = 0;
    this.currentType = null;
    this.onTicketTaken = null; // Callback von TicketFlow

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.5 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.13, 0.2, 2, 0.012), bodyMat);
    this.group.add(body);

    // Display-Leiste
    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 256;
    this.displayCanvas.height = 48;
    this.displayTex = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTex.colorSpace = THREE.SRGBColorSpace;
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.035),
      new THREE.MeshBasicMaterial({ map: this.displayTex, toneMapped: false })
    );
    display.position.set(0, 0.045, 0.101);
    this.group.add(display);
    this._setDisplay('BEREIT');

    // Tickettyp-Tasten
    this.typeButtons = [];
    TICKET_TYPES.forEach((t, i) => {
      const tex = keypadTexture(t.label);
      const btn = buttons.createButton({
        symbol: '', label: '',
        parent: this.group,
        position: new THREE.Vector3(-0.075 + i * 0.075, 0.0, 0.101),
        action: () => this._selectType(t),
        getLit: () => (this.currentType?.id === t.id && this.state !== 'idle' ? 1 : 0),
      });
      // Tastenfläche mit Typ-Label überschreiben
      btn.mesh.material[4].map = tex;
      btn.mesh.scale.set(1.4, 0.9, 0.7);
      this.typeButtons.push(btn);
    });

    // Druckschacht
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.008, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.3 })
    );
    slot.position.set(0, -0.045, 0.1);
    this.group.add(slot);

    // Ticket-Mesh (skaliert beim Druck heraus). Pivot an der Oberkante:
    // so wächst das Ticket aus dem Schacht heraus statt ins Gehäuse hinein.
    this.ticketMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const tGeo = new THREE.PlaneGeometry(0.07, 0.13);
    tGeo.translate(0, -0.065, 0);
    this.ticket = new THREE.Mesh(tGeo, this.ticketMat);
    this.ticket.position.set(0, -0.044, 0.104);
    this.ticket.rotation.x = -0.5;
    this.ticket.visible = false;
    this.group.add(this.ticket);

    // Klickzone fürs fertige Ticket
    buttons.createZone({
      size: new THREE.Vector3(0.12, 0.13, 0.10),
      position: new THREE.Vector3(0, -0.10, 0.15),
      parent: this.group,
      name: 'ticketTake',
      action: () => this._takeTicket(),
    });
  }

  _setDisplay(text, color = '#7fd4ff') {
    const ctx = this.displayCanvas.getContext('2d');
    ctx.fillStyle = '#0c0e10';
    ctx.fillRect(0, 0, 256, 48);
    ctx.fillStyle = color;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 26);
    this.displayTex.needsUpdate = true;
  }

  _selectType(type) {
    if (this.state === 'printing') return;
    this.currentType = type;
    this._setDisplay(`${type.label} ${type.price.toFixed(2)}€`);
    Events.emit('ticketTypeSelected', type);
    // Druck startet direkt nach Auswahl
    this.state = 'printing';
    this.printProgress = 0;
    this.ticket.rotation.x = -0.5; // Druckwinkel zurücksetzen (Entnahme-Kippung aufheben)
    this.ticketMat.map = ticketTexture(type.label, type.price);
    this.ticketMat.needsUpdate = true;
    Events.emit('ticketPrint');
  }

  _takeTicket() {
    if (this.state !== 'ready') return;
    this.state = 'idle';
    this.ticket.visible = false;
    this._setDisplay('BEREIT');
    Events.emit('ticketBeep');
    if (this.onTicketTaken) this.onTicketTaken(this.currentType);
    this.currentType = null;
  }

  update(dt) {
    if (this.state === 'printing') {
      this.printProgress += dt / 0.9;
      this.ticket.visible = true;
      const p = Math.min(1, this.printProgress);
      this.ticket.scale.y = Math.max(0.05, p);
      if (this.printProgress >= 1) {
        this.state = 'ready';
        this._setDisplay('ENTNEHMEN', '#ffd479');
      }
    } else if (this.state === 'ready') {
      // Fertiges Ticket kippt sanft nach vorn — signalisiert Entnahmebereitschaft
      this.ticket.rotation.x += (-0.75 - this.ticket.rotation.x) * Math.min(1, dt * 5);
    }
  }
}
