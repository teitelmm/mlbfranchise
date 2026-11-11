// Small seedable random generator. State is one integer so it saves with the career.
export class Rng {
  constructor(seed = Date.now()) { this.s = seed >>> 0; }
  f() {
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p) { return this.f() < p; }
  i(n) { return Math.floor(this.f() * n); }
  range(a, b) { return a + this.f() * (b - a); }
  pick(arr) { return arr[this.i(arr.length)]; }
  n() { return (this.f() + this.f() + this.f() + this.f() - 2) * 1.732; }   // ~N(0,1)
  weighted(items, wf) {
    let tot = 0; for (const it of items) tot += wf(it);
    let r = this.f() * tot;
    for (const it of items) { r -= wf(it); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = this.i(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
}
