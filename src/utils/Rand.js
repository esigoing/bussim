// Seeded RNG (mulberry32) — eine Instanz treibt alle prozeduralen Inhalte,
// damit jede Stadt über ?seed= reproduzierbar ist.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rand {
  constructor(seed = 1337) {
    this.next = mulberry32(seed);
  }
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }
  int(min, max) { // inklusive
    return Math.floor(this.float(min, max + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  // Abgeleiteter Strom, damit Teilsysteme sich gegenseitig nicht verschieben
  fork(salt) {
    return new Rand((this.next() * 0xffffffff) ^ salt);
  }
}

export function getSeedFromURL() {
  const p = new URLSearchParams(window.location.search).get('seed');
  const n = p === null ? NaN : Number(p);
  return Number.isFinite(n) ? (n >>> 0) : 73;
}
