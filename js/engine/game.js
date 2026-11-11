// One baseball game. Each call to step() plays the next thing that happens (a steal,
// a wild pitch, a plate appearance...) and returns the events the viewer animates.
//
// A "side" is { tid, abbr, lineup:[{p,pos} x9], bench:[p], pen:[p], sp:p,
//               roles:{cl,su:[],long}, manual:false }
import { LG, batRates, pitRates, xbhShares, defAt, clamp } from './ratings.js';

const or = (a, b, l) => { const x = (a / (1 - a)) * (b / (1 - b)) / (l / (1 - l)); return x / (1 + x); };
const full = p => `${p.first} ${p.last}`;
const ORD = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const POSNAME = { P: 'pitcher', C: 'catcher', '1B': 'first baseman', '2B': 'second baseman', '3B': 'third baseman', SS: 'shortstop', LF: 'left fielder', CF: 'center fielder', RF: 'right fielder' };
const FIELDNAME = { LF: 'left field', CF: 'center field', RF: 'right field', SS: 'shortstop', '2B': 'second base', '3B': 'third base', '1B': 'first base', P: 'the mound', C: 'the plate' };
const POSNUM = { P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };

export const newBatLine = () => ({ PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, R: 0, RBI: 0, BB: 0, K: 0, HBP: 0, SF: 0, SH: 0, SB: 0, CS: 0, GDP: 0 });
export const newPitLine = () => ({ G: 0, GS: 0, O: 0, H: 0, R: 0, ER: 0, BB: 0, K: 0, HR: 0, BF: 0, NP: 0, W: 0, L: 0, SV: 0, HLD: 0, BS: 0 });

export function staminaLimit(p) { return p.role === 'SP' || p.pit.sta >= 50 ? 59 + p.pit.sta * 0.62 : 14 + p.pit.sta * 0.62; }

export function fenceAt(park, angle) {
  const pts = [[-45, park.lf], [-22.5, park.lcf], [0, park.cf], [22.5, park.rcf], [45, park.rf]];
  const a = clamp(angle, -45, 45);
  for (let i = 0; i < 4; i++) if (a <= pts[i + 1][0]) {
    const t = (a - pts[i][0]) / 22.5;
    return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
  }
  return park.rf;
}

export class Game {
  constructor({ home, away, park, pf = [1, 1], rng, detail = false, playoff = false, dayNight = 'N' }) {
    this.sides = [away, home];
    this.park = park; this.pf = pf; this.rng = rng; this.detail = detail; this.playoff = playoff; this.dayNight = dayNight;
    this.inning = 1; this.half = 0; this.outs = 0;
    this.bases = [null, null, null];
    this.score = [0, 0]; this.line = [[0], []]; this.hits = [0, 0]; this.errs = [0, 0];
    this.over = false; this.log = []; this.wpHist = [0.5];
    this.errExtra = 0; this.tactic = [{}, {}];
    this.bat = new Map(); this.pit = new Map();
    this.injuries = [];
    this.win = null; this.loss = null; this.save = null;
    for (const s of this.sides) {
      s.idx = 0; s.used = new Set(); s.pitchers = []; s.out = new Set();
      s.lineup = s.lineup.map(x => ({ p: x.p, pos: x.pos }));
      s.bench = [...s.bench]; s.pen = [...s.pen];
      for (const l of s.lineup) { this.bl(l.p); s.used.add(l.p.id); }
      this.enterPitcher(s, s.sp, true);
      this.calcDefense(s);
    }
    this.started = false;
  }

  // ---------- bookkeeping ----------
  bl(p) { let l = this.bat.get(p.id); if (!l) { l = newBatLine(); l.p = p; this.bat.set(p.id, l); } return l; }
  pl(p) { let l = this.pit.get(p.id); if (!l) { l = newPitLine(); l.p = p; l.startFat = p.fat || 0; this.pit.set(p.id, l); } return l; }
  get batSide() { return this.sides[this.half]; }
  get fldSide() { return this.sides[1 - this.half]; }
  get pitcher() { return this.fldSide.pitcher; }
  get batter() { const s = this.batSide; return s.lineup[s.idx % 9]; }
  lead(sideIdx) { return this.score[sideIdx] - this.score[1 - sideIdx]; }

  enterPitcher(side, p, start = false) {
    const prev = side.pitcher;
    side.pitcher = p; side.pitchers.push(p); side.used.add(p.id);
    const l = this.pl(p); l.G = 1; if (start) l.GS = 1;
    const si = this.sides.indexOf(side);
    const ld = this.score[si] - this.score[1 - si];
    const on = this.bases.filter(Boolean).length;
    l.saveSit = !start && ld > 0 && (ld <= 3 || ld <= on + 2);
    l.entryLead = ld; l.entryOuts = 0; l.entryInning = this.inning;
    side.pen = side.pen.filter(x => x.id !== p.id);
    if (prev && !start) {
      const pl = this.pl(prev);
      if (pl.saveSit && pl.O > 0 && ld > 0 && this.win !== prev.id) pl.holdPending = true;
    }
    // a two-way starter keeps hitting; otherwise the pitcher is not in the batting order (DH)
  }

  calcDefense(side) {
    side.def = {};
    for (const l of side.lineup) if (l.pos !== 'DH') side.def[l.pos] = { p: l.p, r: defAt(l.p, l.pos) };
    side.def.P = { p: side.pitcher, r: 45 };
    const c = side.def.C; side.catcherArm = c ? c.p.bat.arm : 40;
  }

  // ---------- probabilities ----------
  effPit(p) {
    const l = this.pl(p), t = p.pit;
    const lim = staminaLimit(p);
    const over = l.NP + l.startFat * 0.7 - lim;
    const fat = clamp(over / 24, 0, 1.6);
    const tto = Math.min(3, Math.floor(l.BF / 9));
    return { stf: t.stf - fat * 13 - tto * 1.6 - (l.startFat > 20 ? 3 : 0), ctl: t.ctl - fat * 10, mov: t.mov - fat * 9 - tto * 1.2, fat };
  }

  paProbs(b, p) {
    const br = batRates(b.bat), e = this.effPit(p), pr = pitRates(e);
    const same = b.bats !== 'S' && b.bats === p.throws;
    const pk = same ? 1.07 : 0.95, pb = same ? 0.93 : 1.06, ph = same ? 0.87 : 1.10, pbab = same ? 0.985 : 1.012;
    const home = this.half === 1;
    const k = clamp(or(br.k * pk * (home ? 0.98 : 1.0), pr.k, LG.k), 0.02, 0.62);
    const bb = clamp(or(br.bb * pb * 0.955, pr.bb, LG.bb), 0.01, 0.30);
    const hr = clamp(or(br.hr * ph * (home ? 1.02 : 0.98), pr.hr, LG.hr) * this.pf[1], 0.001, 0.16);
    const babip = br.babip * pbab * (pr.babip / LG.babip) * (1 + (this.pf[0] - 1) * 0.55 - (this.pf[1] - 1) * 0.15);
    return { k, bb, hbp: pr.hbp, hr, babip };
  }

  // ---------- flow ----------
  step() {
    if (this.over) return [];
    const ev = [];
    if (!this.started) {
      this.started = true;
      ev.push({ type: 'start', desc: `${this.sides[0].sp.last} vs ${this.sides[1].sp.last} at ${this.park.name}.` });
    }
    if (this._needHalfStart !== false) { this.startHalf(ev); this._needHalfStart = false; }
    this.manage(ev);
    if (this.tryRunning(ev)) { this.afterPlay(ev); return this.emit(ev); }
    this.plateAppearance(ev);
    this.afterPlay(ev);
    return this.emit(ev);
  }
  emit(ev) { for (const e of ev) this.log.push(e); return ev; }

  startHalf(ev) {
    this.outs = 0; this.bases = [null, null, null]; this.errExtra = 0; this.tactic = [{}, {}]; this._fresh = true;
    this.line[this.half][this.inning - 1] ??= 0;
    if (this.inning > 9 && !this.playoff) {
      const s = this.batSide, r = s.lineup[(s.idx + 8) % 9].p;
      this.bases[1] = { p: r, resp: this.pitcher.id, ue: true };
    }
    ev.push({ type: 'half', inning: this.inning, half: this.half, desc: `${this.half ? 'Bottom' : 'Top'} of the ${ORD(this.inning)}` });
  }

  afterPlay(ev) {
    // walk-off
    if (this.half === 1 && this.inning >= 9 && this.score[1] > this.score[0]) return this.finish(ev);
    if (this.outs >= 3) {
      if (this.half === 0) {
        if (this.inning >= 9 && this.score[1] > this.score[0]) return this.finish(ev);
        this.half = 1;
      } else {
        if (this.inning >= 9 && this.score[0] !== this.score[1]) return this.finish(ev);
        this.half = 0; this.inning++;
      }
      this._needHalfStart = true;
    }
    this.wpHist.push(this.winProb());
  }

  finish(ev) {
    this.over = true;
    const w = this.score[1] > this.score[0] ? 1 : 0;
    this.winner = w;
    // decisions
    const ws = this.sides[w], ls = this.sides[1 - w];
    let wp = this.win && ws.pitchers.find(p => p.id === this.win) || ws.pitchers[ws.pitchers.length - 1];
    if (wp === ws.sp && this.pl(wp).O < 15 && ws.pitchers.length > 1) wp = ws.pitchers[1];
    let lp = this.loss && ls.pitchers.find(p => p.id === this.loss) || ls.sp;
    this.pl(wp).W = 1; this.pl(lp).L = 1;
    const last = ws.pitchers[ws.pitchers.length - 1], ll = this.pl(last);
    if (last !== wp && (ll.saveSit && ll.O >= 1 && (ll.entryLead <= 3 ? true : true) || ll.O >= 9)) { ll.SV = 1; this.save = last.id; }
    for (const p of ws.pitchers) { const l = this.pl(p); if (l.holdPending && !l.W && !l.SV) l.HLD = 1; }
    for (const p of ls.pitchers) { const l = this.pl(p); if (l.holdPending && !l.L) l.HLD = 1; }
    this.winP = wp; this.lossP = lp; this.saveP = this.save ? last : null;
    this.wpHist.push(w);
    ev.push({ type: 'final', desc: `Final: ${this.sides[0].abbr} ${this.score[0]}, ${this.sides[1].abbr} ${this.score[1]}. W: ${wp.last}. L: ${lp.last}.${this.save ? ` SV: ${last.last}.` : ''}`, score: [...this.score] });
  }

  winProb() {
    // chance the home team wins from here (normal approximation on remaining scoring)
    const RE = [[0.48, 0.25, 0.10], [0.85, 0.50, 0.22], [1.07, 0.65, 0.31], [1.43, 0.88, 0.42], [1.30, 0.90, 0.35], [1.75, 1.13, 0.47], [1.93, 1.34, 0.56], [2.25, 1.52, 0.74]];
    const bi = (this.bases[0] ? 1 : 0) + (this.bases[1] ? 2 : 0) + (this.bases[2] ? 4 : 0);
    const idx = [0, 1, 2, 4, 3, 5, 6, 7][bi];
    const cur = this.outs >= 3 ? 0 : RE[idx][this.outs];
    const inn = Math.max(0, 9 - this.inning);
    let lead = this.score[1] - this.score[0];
    let halvesLeft;
    if (this.half === 0) { lead -= cur; halvesLeft = inn * 2 + 1 + (this.outs >= 3 ? 0 : 0.5); }
    else { lead += cur; halvesLeft = inn * 2 + (this.outs >= 3 ? 0 : 0.5); }
    if (this.inning > 9) halvesLeft = Math.max(halvesLeft, 0.8);
    const sd = Math.sqrt(Math.max(0.15, halvesLeft) * 1.15);
    const z = (lead + 0.08) / sd;
    return clamp(1 / (1 + Math.exp(-1.7 * z)), 0.01, 0.99);
  }

  // ---------- scoring ----------
  scoreRun(runner, ev, rbi, batter) {
    const si = this.half;
    const before = this.lead(si);
    this.score[si]++; this.line[si][this.inning - 1] = (this.line[si][this.inning - 1] || 0) + 1;
    this.bl(runner.p).R++;
    if (rbi && batter) this.bl(batter).RBI++;
    const resp = this.pit.get(runner.resp);
    if (resp) { resp.R++; if (!runner.ue && this.outs + this.errExtra < 3) resp.ER++; }
    const after = this.lead(si);
    if (before <= 0 && after > 0) {
      this.win = this.batSide.pitcher.id; this.loss = runner.resp;
      const cur = this.pl(this.pitcher); if (cur.saveSit) { cur.BS = 1; cur.saveSit = false; }
    } else if (before < 0 && after === 0) {
      this.win = null; this.loss = null;
      const cur = this.pl(this.pitcher); if (cur.saveSit) { cur.BS = 1; cur.saveSit = false; }
      for (const p of this.fldSide.pitchers) this.pl(p).holdPending = false;
    }
    ev.scored.push(runner.p.id);
  }

  // moves: runners take `adv[i]` bases (i = 0 batter, 1..3 = from base). Runners never pass each other.
  applyAdvance(ev, adv, batter, opts = {}) {
    const nb = [null, null, null];
    let ceil = 5;
    for (let b = 3; b >= 1; b--) {
      const r = this.bases[b - 1];
      if (!r) continue;
      if (adv[b] === 'out') { ev.moves.push({ id: r.p.id, from: b, to: -1, at: opts.outAt?.[b] ?? b + 1 }); continue; }
      let to = Math.min(b + (adv[b] || 0), 4);
      if (to >= ceil && ceil < 5) to = ceil - 1;
      if (to >= 4) { this.scoreRun(r, ev, opts.rbi !== false && !(opts.noRbi && opts.noRbi[b]), batter); ev.moves.push({ id: r.p.id, from: b, to: 4 }); }
      else { nb[to - 1] = r; ceil = to; if (to !== b) ev.moves.push({ id: r.p.id, from: b, to }); }
    }
    if (batter && adv[0] && adv[0] !== 'out') {
      let to = Math.min(adv[0], 4);
      if (to >= ceil && ceil < 5) to = ceil - 1;
      const rn = { p: batter, resp: this.pitcher.id, ue: !!opts.batterUE };
      if (to >= 4) { this.scoreRun(rn, ev, opts.rbi !== false, batter); ev.moves.push({ id: batter.id, from: 0, to: 4 }); }
      else if (to >= 1) { nb[to - 1] = rn; ev.moves.push({ id: batter.id, from: 0, to }); }
    } else if (batter && adv[0] === 'out') ev.moves.push({ id: batter.id, from: 0, to: -1, at: 1 });
    this.bases = nb;
  }

  recordOuts(n, pitcherLine) { this.outs += n; pitcherLine.O += n; }

  // ---------- steals, wild pitches ----------
  tryRunning(ev) {
    if (this._ranThisPA) return false;
    const [r1, r2, r3] = this.bases, rng = this.rng;
    const tac = this.tactic[this.half], pitcher = this.pitcher, pline = this.pl(pitcher);
    // wild pitch / passed ball
    if ((r1 || r2 || r3) && rng.chance(0.017 * Math.exp(-0.3 * (pitcher.pit.ctl - 50) / 25))) {
      const e = { type: 'wp', inning: this.inning, half: this.half, moves: [], scored: [], pitcher: pitcher.id };
      this.applyAdvance(e, [0, 1, 1, 1], null, { rbi: false });
      e.desc = `Wild pitch by ${pitcher.last}. ${this.runText(e)}`;
      this.stamp(e); ev.push(e); this._ranThisPA = true;
      return this.outs >= 3 || (this.half === 1 && this.inning >= 9 && this.score[1] > this.score[0]);
    }
    if (this.outs >= 3) return false;
    const side = this.batSide, si = this.half;
    const lead = this.lead(si);
    let runner = null, from = 0;
    if (r1 && !r2) { runner = r1; from = 1; } else if (r2 && !r3 && !r1) { runner = r2; from = 2; }
    if (!runner || tac.hold) return false;
    const spd = runner.p.bat.spd;
    let att;
    if (side.manual) att = tac.steal ? 1 : 0;
    else {
      att = clamp(0.082 * Math.exp((spd - 58) / 11.5), 0, 0.30) * (from === 2 ? 0.16 : 1);
      if (lead <= -4 || lead >= 6) att *= 0.15;
      if (this.outs === 2 && from === 2) att *= 0.5;
    }
    if (!rng.chance(att)) return false;
    this._ranThisPA = true; tac.steal = false;
    let ok = 0.775 + (spd - 62) * 0.0062 - (this.fldSide.catcherArm - 50) * 0.0045 - (from === 2 ? 0.02 : 0) - (pitcher.throws === 'L' && from === 1 ? 0.03 : 0);
    ok = clamp(ok, 0.35, 0.95);
    const e = { type: 'steal', inning: this.inning, half: this.half, moves: [], scored: [], runner: runner.p.id, base: from + 1 };
    if (rng.chance(ok)) {
      this.bl(runner.p).SB++;
      const adv = [0, 0, 0, 0]; adv[from] = 1;
      this.applyAdvance(e, adv, null, { rbi: false });
      e.ok = true; e.desc = `${runner.p.last} steals ${from === 1 ? 'second' : 'third'} base.`;
    } else {
      this.bl(runner.p).CS++;
      const adv = [0, 0, 0, 0]; adv[from] = 'out';
      this.applyAdvance(e, adv, null, { rbi: false });
      this.recordOuts(1, pline);
      e.ok = false; e.desc = `${runner.p.last} is caught stealing ${from === 1 ? 'second' : 'third'}, ${this.fldSide.def.C?.p.last || 'catcher'} to ${from === 1 ? (this.fldSide.def.SS?.p.last || 'short') : (this.fldSide.def['3B']?.p.last || 'third')}.`;
    }
    this.stamp(e); ev.push(e);
    return this.outs >= 3;
  }

  stamp(e) { e.outs = this.outs; e.score = [...this.score]; e.bases = this.bases.map(b => b ? b.p.id : 0); }
  runText(e) {
    if (!e.scored.length) return '';
    const names = e.scored.map(id => this.bat.get(id).p.last);
    return names.length === 1 ? `${names[0]} scores.` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} score.`;
  }

  // ---------- pitch sequence ----------
  pitchSeq(target, pitcher, batter) {
    const rng = this.rng, seq = [];
    let b = 0, s = 0;
    for (let n = 0; n < 14; n++) {
      let wB = 0.365, wC = 0.19, wS = 0.125, wF = 0.155, wX = 0, wH = 0;
      if (s === 2) { wC = 0.06; wS = 0.15; wF = 0.19; }
      if (b === 3) { wB = 0.24; }
      if (target === 'K') { if (b === 3) wB = 0; }
      else if (target === 'BB') { if (s === 2) { wC = 0; wS = 0; } }
      else if (target === 'HBP') { if (b === 3) wB = 0; if (s === 2) { wC = 0; wS = 0; } wH = 0.3; }
      else { if (b === 3) wB = 0; if (s === 2) { wC = 0; wS = 0; } wX = 0.36 + n * 0.04; }
      let r = rng.f() * (wB + wC + wS + wF + wX + wH), c;
      if ((r -= wB) < 0) c = 'B'; else if ((r -= wC) < 0) c = 'C'; else if ((r -= wS) < 0) c = 'S'; else if ((r -= wF) < 0) c = 'F'; else if ((r -= wX) < 0) c = 'X'; else c = 'H';
      if (n === 13) c = target === 'K' ? 'S' : target === 'BB' ? 'B' : target === 'HBP' ? 'H' : 'X';
      seq.push(c);
      if (c === 'B') { if (++b === 4) break; }
      else if (c === 'C' || c === 'S') { if (++s === 3) break; }
      else if (c === 'F') { if (s < 2) s++; }
      else break;
    }
    if (!this.detail) return { n: seq.length, seq: null, balls: b, strikes: s };
    // dress each pitch for the viewer: type, speed, location (feet; plate centre x=0, z=height)
    const mix = pitcher.pit.mix, fat = this.effPit(pitcher).fat;
    let bb = 0, ss = 0;
    const out = seq.map(c => {
      const two = ss === 2;
      const m = rng.weighted(mix, x => x[1] * (two && !['FF', 'SI', 'FC'].includes(x[0]) ? 1.5 : 1));
      const v = m[2] + rng.n() * 0.9 - fat * 1.4;
      const inZone = c === 'C' ? true : c === 'B' || c === 'H' ? false : c === 'S' ? rng.chance(0.42) : rng.chance(0.78);
      let x, z;
      if (inZone) { x = rng.range(-0.78, 0.78); z = rng.range(1.65, 3.4); }
      else if (c === 'H') { x = (batter.bats === 'L' || (batter.bats === 'S' && pitcher.throws === 'R') ? 1 : -1) * rng.range(1.5, 2.1); z = rng.range(1.8, 4.2); }
      else {
        const far = c === 'B' ? rng.range(0.12, 0.95) : rng.range(0.08, 0.5);
        const side = rng.i(4);
        if (side === 0) { x = -0.83 - far; z = rng.range(1.3, 3.7); } else if (side === 1) { x = 0.83 + far; z = rng.range(1.3, 3.7); }
        else if (side === 2) { x = rng.range(-1, 1); z = 1.5 - far; } else { x = rng.range(-1, 1); z = 3.5 + far; }
      }
      const o = { t: m[0], v: Math.round(v * 10) / 10, x: +x.toFixed(2), z: +z.toFixed(2), r: c, b: bb, s: ss };
      if (c === 'B') bb++; else if (c === 'C' || c === 'S') ss++; else if (c === 'F' && ss < 2) ss++;
      return o;
    });
    return { n: seq.length, seq: out, balls: b, strikes: s };
  }

  // ---------- plate appearance ----------
  plateAppearance(ev) {
    const rng = this.rng, side = this.batSide, fs = this.fldSide;
    const slot = side.lineup[side.idx % 9], b = slot.p, p = this.pitcher;
    const bl = this.bl(b), pl = this.pl(p);
    const tac = this.tactic[this.half], dtac = this.tactic[1 - this.half];
    const e = { type: 'pa', inning: this.inning, half: this.half, batter: b.id, pitcher: p.id, moves: [], scored: [], outsBefore: this.outs, basesBefore: this.bases.map(x => x ? x.p.id : 0) };
    this._ranThisPA = false; this._fresh = false;
    side.idx++;
    bl.PA++; pl.BF++;
    const outs0 = this.outs;
    const [r1, r2, r3] = this.bases;

    // intentional walk
    if (dtac.ibb) {
      dtac.ibb = false; bl.BB++; pl.BB++;
      this.forceWalk(e, b); e.res = 'IBB'; e.desc = `${full(b)} is intentionally walked. ${this.runText(e)}`.trim();
      this.stamp(e); ev.push(e); return;
    }
    // sacrifice bunt
    if (tac.bunt && outs0 < 2 && (r1 || r2)) {
      tac.bunt = false;
      const q = rng.f();
      const seq = this.pitchSeq('IP', p, b); pl.NP += seq.n; e.pitches = seq.seq; e.np = seq.n;
      if (q < 0.70) {
        bl.SH++; this.applyAdvance(e, ['out', 1, 1, r1 && r2 ? 1 : 0], b, { rbi: true }); this.recordOuts(1, pl);
        e.res = 'SH'; e.bb = { type: 'BU', angle: rng.range(-30, 30), dist: 28, fielder: rng.pick(['P', '3B', '1B', 'C']) }; e.seq = [e.bb.fielder, '1B'];
        e.desc = `${full(b)} lays down a sacrifice bunt. ${this.runText(e)}`.trim();
      } else if (q < 0.84) {
        bl.AB++; const lead = r2 ? 2 : 1; const adv = ['x', 0, 0, 0]; adv[lead] = 'out'; adv[0] = 1; if (lead === 2 && r1) adv[1] = 1;
        this.applyAdvance(e, adv, b, { rbi: false }); this.recordOuts(1, pl);
        e.res = 'FC'; e.bb = { type: 'BU', angle: rng.range(-20, 20), dist: 22, fielder: 'P' }; e.seq = ['P', lead === 2 ? '3B' : 'SS'];
        e.desc = `${full(b)} bunts into a force out; the lead runner is cut down.`;
      } else if (q < 0.93) {
        bl.AB++; bl.H++; pl.H++; this.hits[this.half]++; this.applyAdvance(e, [1, 1, 1, 1], b, { rbi: true });
        e.res = '1B'; e.bb = { type: 'BU', angle: rng.range(-38, -15), dist: 40, fielder: '3B' };
        e.desc = `${full(b)} drops a bunt single down the line! ${this.runText(e)}`.trim();
      } else {
        bl.AB++; bl.K++; pl.K++; this.recordOuts(1, pl); e.res = 'K'; e.desc = `${full(b)} strikes out trying to bunt.`;
      }
      this.stamp(e); ev.push(e); return;
    }

    const pr = this.paProbs(b, p);
    let r = rng.f(), res;
    if ((r -= pr.hbp) < 0) res = 'HBP'; else if ((r -= pr.bb) < 0) res = 'BB'; else if ((r -= pr.k) < 0) res = 'K'; else if ((r -= pr.hr) < 0) res = 'HR'; else res = 'BIP';
    const seq = this.pitchSeq(res === 'BIP' || res === 'HR' ? 'IP' : res, p, b);
    pl.NP += seq.n; e.pitches = seq.seq; e.np = seq.n; e.count = [seq.balls, seq.strikes];

    if (res === 'HBP') {
      bl.HBP++; this.forceWalk(e, b); e.res = 'HBP'; e.desc = `${full(b)} is hit by a pitch. ${this.runText(e)}`.trim();
    } else if (res === 'BB') {
      bl.BB++; pl.BB++; this.forceWalk(e, b); e.res = 'BB'; e.desc = `${full(b)} walks. ${this.runText(e)}`.trim();
    } else if (res === 'K') {
      bl.AB++; bl.K++; pl.K++; this.recordOuts(1, pl); e.res = 'K';
      const look = seq.seq ? seq.seq.at(-1).r === 'C' : rng.chance(0.24); e.look = look;
      e.desc = `${full(b)} strikes out ${look ? 'looking' : 'swinging'}.`;
    } else if (res === 'HR') {
      bl.AB++; bl.H++; bl.HR++; pl.H++; pl.HR++; this.hits[this.half]++;
      const pull = b.bats === 'L' || (b.bats === 'S' && p.throws === 'R') ? 1 : -1;
      const angle = clamp(pull * 17 + rng.n() * 17, -44, 44);
      const fence = fenceAt(this.park, angle);
      const dist = Math.round(clamp(fence + 6 + Math.abs(rng.n()) * 26 + (b.bat.pow - 50) * 0.35, fence + 3, 485));
      const n = this.bases.filter(Boolean).length;
      e.bb = { type: 'FB', angle, dist, hr: true, hang: 4.6 + rng.f() * 1.4, ev: Math.round(100 + (dist - 380) * 0.13 + rng.n()) };
      this.applyAdvance(e, [4, 4, 4, 4], b, { rbi: true });
      e.res = 'HR'; e.rbi = n + 1;
      const dir = angle < -15 ? 'left field' : angle > 15 ? 'right field' : 'center field';
      const what = n === 3 ? 'a GRAND SLAM' : n === 2 ? 'a three-run homer' : n === 1 ? 'a two-run homer' : 'a solo home run';
      e.desc = `${full(b)} crushes ${what} to ${dir}, ${dist} feet!`;
    } else this.ballInPlay(e, b, p, bl, pl, pr, dtac);

    // injuries are rare and resolved by the league after the game
    tac.steal = false; this._fresh = false;
    if (rng.chance(0.00042)) this.injuries.push({ p: b, how: 'bat' });
    if (rng.chance(0.00048 + (this.effPit(p).fat > 0.6 ? 0.0006 : 0))) this.injuries.push({ p, how: 'pitch' });
    this.stamp(e); ev.push(e);
  }

  forceWalk(e, b) {
    const [r1, r2, r3] = this.bases;
    const adv = [1, r1 ? 1 : 0, r1 && r2 ? 1 : 0, r1 && r2 && r3 ? 1 : 0];
    this.applyAdvance(e, adv, b, { rbi: true });
  }

  ballInPlay(e, b, p, bl, pl, pr, dtac) {
    const rng = this.rng, fs = this.fldSide, bat = b.bat;
    const outs0 = this.outs, [r1, r2, r3] = this.bases;
    const pull = b.bats === 'L' || (b.bats === 'S' && p.throws === 'R') ? 1 : -1;
    // batted-ball type
    const gb = clamp(or(bat.gb / 100, p.pit.gb / 100, 0.47) * 0.94, 0.2, 0.7);
    const air = 1 - gb;
    const mix = { GB: gb, LD: air * 0.375, FB: air * 0.50, PU: air * 0.125 };
    let q = rng.f(), type = 'GB';
    if ((q -= mix.GB) < 0) type = 'GB'; else if ((q -= mix.LD) < 0) type = 'LD'; else if ((q -= mix.FB) < 0) type = 'FB'; else type = 'PU';
    const BASE = { GB: 0.25, LD: 0.695, FB: 0.133, PU: 0.01 };
    const expBabip = mix.GB * BASE.GB + mix.LD * BASE.LD + mix.FB * BASE.FB + mix.PU * BASE.PU;
    const infieldIn = !!dtac.infieldIn && r3 && outs0 < 2;
    // direction and fielder
    let angle, fielder;
    if (type === 'GB') angle = clamp(pull * 11 + rng.n() * 19, -44, 44);
    else if (type === 'LD') angle = clamp(pull * 5 + rng.n() * 22, -44, 44);
    else angle = clamp(pull * -2 + rng.n() * 24, -44, 44);
    const infielder = a => a < -27 ? '3B' : a < -5 ? 'SS' : a < 5 ? (rng.chance(0.3) ? 'P' : a < 0 ? 'SS' : '2B') : a < 27 ? '2B' : '1B';
    const outfielder = a => a < -15 ? 'LF' : a > 15 ? 'RF' : 'CF';
    let toOF = type === 'FB' || (type === 'LD' && rng.chance(0.62));
    if (type === 'PU') { fielder = rng.chance(0.12) ? 'C' : infielder(angle); toOF = false; }
    else fielder = toOF ? outfielder(angle) : infielder(angle);
    const fd = fs.def[fielder] || { r: 45, p: fs.pitcher };
    let pHit = BASE[type] * (pr.babip / expBabip);
    pHit *= 1 - (fd.r - 50) * (type === 'PU' ? 0 : 0.0042);
    if (type === 'GB') { pHit *= 1 + (bat.spd - 50) * 0.0028; if (infieldIn) pHit += 0.075; }
    pHit = clamp(pHit, 0.005, 0.92);
    const bb = e.bb = { type, angle: +angle.toFixed(1), fielder };
    const fence = fenceAt(this.park, angle);

    if (rng.chance(pHit)) {
      // ---- base hit ----
      const xs = xbhShares(bat.pow, bat.spd);
      const dF = xs.dbl / LG.dbl, tF = xs.tpl / LG.tpl;
      const pd = clamp({ GB: 0.065, LD: 0.275, FB: 0.53, PU: 0 }[type] * dF, 0, 0.8);
      const pt = clamp({ GB: 0, LD: 0.015, FB: 0.058, PU: 0 }[type] * tF, 0, 0.3);
      let h = 1; const z = rng.f();
      if (z < pt) h = 3; else if (z < pt + pd) h = 2;
      bl.AB++; bl.H++; pl.H++; this.hits[this.half]++;
      const of = type === 'GB' && rng.chance(0.14) ? null : outfielder(angle);   // null = infield hit
      const ofd = of ? (fs.def[of] || { p: null, r: 45 }) : null;
      const arm = ofd?.p?.bat.arm ?? 50;
      const adv = [h, 0, 0, 0];
      const two = outs0 === 2 ? 1 : 0;
      const outAt = {};
      if (h === 1) {
        if (!of) { adv[1] = 1; adv[2] = r1 ? 1 : 0; adv[3] = r1 && r2 ? 1 : 0; bb.dist = rng.range(60, 110); bb.infield = true; }
        else {
          const dirB = of === 'RF' ? 0.10 : of === 'CF' ? 0.03 : -0.08;
          if (r3) adv[3] = 1;
          if (r2) {
            const send = 0.60 + (r2.p.bat.spd - 50) * 0.006 + two * 0.22 - (arm - 50) * 0.003 + (of === 'LF' ? -0.05 : 0.02);
            if (rng.chance(send)) { if (rng.chance(0.035 + (arm - 50) * 0.0012)) { adv[2] = 'out'; outAt[2] = 4; } else adv[2] = 2; } else adv[2] = 1;
          }
          if (r1) {
            const send = 0.27 + (r1.p.bat.spd - 50) * 0.006 + dirB + two * 0.08 - (arm - 50) * 0.002;
            adv[1] = rng.chance(send) && adv[2] !== 1 ? 2 : 1;
          }
          bb.dist = type === 'GB' ? rng.range(170, 235) : rng.range(190, 265);
        }
        bb.field = of || fielder;
      } else if (h === 2) {
        adv[3] = 1; adv[2] = 2;
        if (r1) adv[1] = rng.chance(0.42 + (r1.p.bat.spd - 50) * 0.007 + two * 0.2) ? 3 : 2;
        bl.D++; bb.dist = type === 'GB' ? rng.range(230, 290) : rng.range(Math.min(290, fence - 40), fence - 4); bb.field = of || outfielder(angle);
      } else { adv[1] = adv[2] = adv[3] = 3; bl.T++; bb.dist = rng.range(fence - 30, fence - 3); bb.field = outfielder(angle); }
      bb.hang = type === 'GB' ? 0 : type === 'LD' ? rng.range(1.2, 2.2) : rng.range(3.4, 5.2);
      const thrown = adv.includes('out');
      this.applyAdvance(e, adv, b, { rbi: true, outAt });
      if (thrown) this.recordOuts(1, pl);
      e.res = ['', '1B', '2B', '3B'][h];
      const where = !of ? `an infield single to ${FIELDNAME[fielder]}` : `${h === 1 ? 'a single' : h === 2 ? 'a double' : 'a triple'} to ${FIELDNAME[bb.field]}`;
      const how = type === 'GB' ? 'grounds' : type === 'LD' ? 'lines' : 'drives';
      e.desc = `${full(b)} ${how} ${where}. ${this.runText(e)}${thrown ? ` ${this.bat.get(e.moves.find(m => m.to === -1).id).p.last} is thrown out at the plate!` : ''}`.trim();
      return;
    }

    // ---- error? ----
    const pErr = (type === 'GB' ? 0.036 : type === 'PU' ? 0.005 : 0.011) * clamp(1 - (fd.r - 50) * 0.014, 0.35, 2.2);
    if (rng.chance(pErr)) {
      bl.AB++; this.errs[1 - this.half]++; this.errExtra++;
      const of = toOF;
      (fs.errors ??= []).push(fd.p?.id);
      this.applyAdvance(e, of ? [2, 2, 2, 2] : [1, 1, 1, 1], b, { rbi: false, batterUE: true });
      for (const m of e.moves) if (m.to === 4) { /* unearned handled by errExtra */ }
      bb.dist = of ? rng.range(240, 320) : rng.range(90, 140); bb.err = true; bb.hang = of ? 4 : 0;
      e.res = 'E'; e.desc = `${full(b)} reaches on an error by ${POSNAME[fielder]} ${fd.p ? fd.p.last : ''}. ${this.runText(e)}`.trim();
      return;
    }

    // ---- outs ----
    bl.AB++;
    const F = POSNUM[fielder];
    if (type === 'GB') {
      bb.dist = fielder === 'P' ? 55 : fielder === '1B' || fielder === '3B' ? rng.range(95, 125) : rng.range(120, 150); bb.hang = 0;
      if (infieldIn && r3) {
        if (rng.chance(0.3)) { // cut down at the plate
          this.applyAdvance(e, [1, r1 ? 1 : 0, r1 && r2 ? 1 : 0, 'out'], b, { rbi: false, outAt: { 3: 4 } }); this.recordOuts(1, pl);
          e.res = 'FC'; e.seq = [fielder, 'C']; e.desc = `${full(b)} grounds to ${FIELDNAME[fielder]} with the infield in; the runner is thrown out at home.`; return;
        }
        this.applyAdvance(e, ['out', r1 ? 1 : 0, r1 && r2 ? 1 : 0, 0], b, { rbi: false }); this.recordOuts(1, pl);
        e.res = 'GO'; e.seq = [fielder, '1B']; e.desc = `${full(b)} grounds out to ${FIELDNAME[fielder]}; the runner holds at third.`; return;
      }
      if (r1 && outs0 < 2) {
        const pDP = clamp(0.45 - (bat.spd - 50) * 0.0045 + (fd.r - 50) * 0.003 - (fielder === 'P' || fielder === '1B' ? 0.1 : 0), 0.1, 0.65);
        const z = rng.f();
        const pivot = fielder === 'SS' || fielder === '3B' ? '2B' : 'SS';
        if (z < pDP) {
          const scoreOK = outs0 === 0;
          this.applyAdvance(e, ['out', 'out', 1, scoreOK ? 1 : 0], b, { rbi: false, outAt: { 1: 2 } });
          this.recordOuts(2, pl); bl.GDP++;
          if (!scoreOK) { /* inning over, nothing scores */ }
          e.res = 'DP'; e.seq = [fielder, pivot, '1B'];
          e.desc = `${full(b)} grounds into a double play, ${F}-${POSNUM[pivot]}-3. ${this.runText(e)}`.trim(); return;
        }
        if (z < pDP + 0.30) {
          this.applyAdvance(e, [1, 'out', 1, 1], b, { rbi: true, outAt: { 1: 2 } }); this.recordOuts(1, pl);
          e.res = 'FC'; e.seq = [fielder, pivot];
          e.desc = `${full(b)} grounds into a force out at second, ${F}-${POSNUM[pivot]}. ${this.runText(e)}`.trim(); return;
        }
        this.applyAdvance(e, ['out', 1, 1, 1], b, { rbi: true }); this.recordOuts(1, pl);
        e.res = 'GO'; e.seq = [fielder, '1B']; e.desc = `${full(b)} grounds out, ${F}-3. ${this.runText(e)}`.trim(); return;
      }
      if (outs0 === 2) { this.applyAdvance(e, ['out', 0, 0, 0], b, {}); this.recordOuts(1, pl); e.res = 'GO'; e.seq = [fielder, '1B']; e.desc = `${full(b)} grounds out to ${FIELDNAME[fielder]}.`; return; }
      const right = fielder === '2B' || fielder === '1B';
      const a3 = r3 && rng.chance(r1 ? 0.8 : 0.48) ? 1 : 0;
      const a2 = r2 && (a3 || !r3) && rng.chance(right ? 0.62 : 0.2) ? 1 : 0;
      this.applyAdvance(e, ['out', r1 ? 1 : 0, r2 ? (r1 ? 1 : a2) : 0, r3 ? (r1 && r2 ? 1 : a3) : 0], b, { rbi: true }); this.recordOuts(1, pl);
      e.res = 'GO'; e.seq = fielder === '1B' && rng.chance(0.6) ? ['1B'] : [fielder, '1B'];
      e.desc = `${full(b)} grounds out to ${FIELDNAME[fielder]}. ${this.runText(e)}`.trim(); return;
    }
    if (type === 'PU') {
      bb.dist = fielder === 'C' ? 25 : rng.range(90, 150); bb.hang = rng.range(4.5, 6);
      this.applyAdvance(e, ['out', 0, 0, 0], b, {}); this.recordOuts(1, pl);
      e.res = 'PO'; e.seq = [fielder]; e.desc = `${full(b)} pops out to ${POSNAME[fielder]} ${fd.p ? fd.p.last : ''}.`.trim(); return;
    }
    if (!toOF) { // infield liner
      bb.dist = rng.range(95, 150); bb.hang = rng.range(0.7, 1.1);
      const dbl = outs0 < 2 && (r1 || r2) && rng.chance(0.045);
      if (dbl) {
        const who = r1 ? 1 : 2; const adv = ['out', 0, 0, 0]; adv[who] = 'out';
        this.applyAdvance(e, adv, b, { outAt: { [who]: who } }); this.recordOuts(2, pl);
        e.res = 'DP'; e.seq = [fielder, who === 1 ? '1B' : 'SS']; e.desc = `${full(b)} lines into a double play! ${fd.p ? fd.p.last : ''} doubles the runner off.`; return;
      }
      this.applyAdvance(e, ['out', 0, 0, 0], b, {}); this.recordOuts(1, pl);
      e.res = 'LO'; e.seq = [fielder]; e.desc = `${full(b)} lines out to ${POSNAME[fielder]} ${fd.p ? fd.p.last : ''}.`.trim(); return;
    }
    // outfield fly / liner
    const deep = type === 'FB' ? rng.range(0.66, 0.975) : rng.range(0.55, 0.78);
    bb.dist = Math.round(fence * deep); bb.hang = type === 'FB' ? rng.range(3.8, 5.6) : rng.range(1.6, 2.6);
    const arm = fd.p?.bat.arm ?? 50;
    const adv = ['out', 0, 0, 0]; const outAt = {};
    let sf = false, dp = false;
    if (outs0 < 2) {
      if (r3) {
        const go = clamp(0.62 + (deep - 0.6) * 1.6 + (r3.p.bat.spd - 50) * 0.004 - (arm - 50) * 0.004, 0.02, 0.98);
        if (rng.chance(go)) { if (rng.chance(0.03 + (arm - 50) * 0.001)) { adv[3] = 'out'; outAt[3] = 4; dp = true; } else { adv[3] = 1; sf = true; } }
      }
      if (r2 && (adv[3] === 1 || !r3) && fielder !== 'LF' && rng.chance(0.2 + (deep - 0.7) * 1.1)) adv[2] = 1;
    }
    this.applyAdvance(e, adv, b, { rbi: true, outAt });
    this.recordOuts(dp ? 2 : 1, pl);
    if (sf) { bl.AB--; bl.SF++; }
    e.res = sf ? 'SF' : dp ? 'DP' : type === 'FB' ? 'FO' : 'LO'; e.seq = dp ? [fielder, 'C'] : [fielder];
    const verb = type === 'FB' ? 'flies out' : 'lines out';
    e.desc = sf ? `${full(b)} hits a sacrifice fly to ${FIELDNAME[fielder]}. ${this.runText(e)}`
      : dp ? `${full(b)} ${verb} to ${FIELDNAME[fielder]} and ${fd.p ? fd.p.last : 'the fielder'} guns down the runner at the plate! Double play.`
        : `${full(b)} ${verb} to ${POSNAME[fielder]} ${fd.p ? fd.p.last : ''}${deep > 0.93 && type === 'FB' ? ' at the warning track' : ''}.`;
  }

  // ---------- manager moves (also the user's buttons) ----------
  canHit(side) { return side.bench.filter(p => !p.isP || p.twoWay); }

  pinchHit(si, pid, ev = null) {
    const s = this.sides[si], i = s.bench.findIndex(p => p.id === pid);
    if (i < 0) return false;
    const p = s.bench.splice(i, 1)[0], slot = s.lineup[s.idx % 9], old = slot.p;
    s.out.add(old.id); s.used.add(p.id); slot.p = p; this.bl(p);
    if (slot.pos !== 'DH' && slot.pos !== 'P') s.needDef = true;
    const e = { type: 'sub', side: si, in: p.id, out: old.id, desc: `${s.abbr}: ${full(p)} pinch-hits for ${old.last}.` };
    (ev || this.log).push(e); this.calcDefense(s);
    return e;
  }
  pinchRun(si, base, pid, ev = null) {
    const s = this.sides[si], i = s.bench.findIndex(p => p.id === pid), r = this.bases[base - 1];
    if (i < 0 || !r) return false;
    const p = s.bench.splice(i, 1)[0], slot = s.lineup.find(l => l.p.id === r.p.id);
    if (!slot) return false;
    s.out.add(r.p.id); s.used.add(p.id); slot.p = p; this.bl(p); r.p = p; this.calcDefense(s);
    const e = { type: 'sub', side: si, in: p.id, out: [...s.out].at(-1), desc: `${s.abbr}: ${full(p)} pinch-runs.` };
    (ev || this.log).push(e); return e;
  }
  defSub(si, slotIdx, pid, ev = null) {
    const s = this.sides[si], i = s.bench.findIndex(p => p.id === pid);
    if (i < 0) return false;
    const p = s.bench.splice(i, 1)[0], slot = s.lineup[slotIdx], old = slot.p;
    s.out.add(old.id); s.used.add(p.id); slot.p = p; this.bl(p); this.calcDefense(s);
    const e = { type: 'sub', side: si, in: p.id, out: old.id, desc: `${s.abbr}: ${full(p)} enters at ${slot.pos} for ${old.last}.` };
    (ev || this.log).push(e); return e;
  }
  changePitcher(si, pid, ev = null) {
    const s = this.sides[si], p = s.pen.find(x => x.id === pid);
    if (!p) return false;
    const old = s.pitcher;
    this.enterPitcher(s, p); this.calcDefense(s);
    // a two-way pitcher leaving the mound stays in as DH; an ordinary one is simply gone
    const e = { type: 'sub', side: si, in: p.id, out: old.id, pitching: true, desc: `${s.abbr} pitching change: ${full(p)} (${p.throws}HP) replaces ${old.last}.` };
    (ev || this.log).push(e); return e;
  }
  setTactic(si, name, on = true) { this.tactic[si][name] = on; }

  fixDefense(side, ev) {
    // after a pinch hitter, make sure nobody is playing a spot he cannot handle (catcher above all)
    side.needDef = false;
    for (let i = 0; i < 9; i++) {
      const l = side.lineup[i];
      if (l.pos === 'DH') continue;
      const cur = defAt(l.p, l.pos);
      if (cur >= (l.pos === 'C' ? 35 : 28)) continue;
      const cand = side.bench.filter(p => !p.isP).map(p => ({ p, d: defAt(p, l.pos) })).sort((a, b) => b.d - a.d)[0];
      if (cand && cand.d > cur + 8) this.defSub(this.sides.indexOf(side), i, cand.p.id, ev);
    }
  }

  manage(ev) {
    const fi = 1 - this.half, bi = this.half;
    const fs = this.sides[fi], bs = this.sides[bi];
    if (fs.needDef && this._fresh) this.fixDefense(fs, ev);
    if (!fs.manual) this.managePitching(fs, fi, ev);
    if (!bs.manual) this.manageBatting(bs, bi, ev);
  }

  availablePen(side) { return side.pen.filter(p => (p.fat || 0) < 30 && !p.inj); }

  managePitching(side, si, ev) {
    const p = side.pitcher, l = this.pl(p);
    const pen = this.availablePen(side);
    if (!pen.length) return;
    const lead = this.lead(si), inn = this.inning;
    const fat = this.effPit(p).fat;
    const on = this.bases.filter(Boolean).length;
    const newInning = !!this._fresh;
    const isSP = l.GS === 1;
    let pull = false;
    if (isSP) {
      const lim = staminaLimit(p);
      if (l.NP >= lim + 12) pull = true;
      else if (newInning && l.NP >= lim - 8) pull = true;
      else if (fat > 0.25 && on >= 2) pull = true;
      else if (l.R >= 6 && inn <= 6 && (newInning || on >= 2)) pull = true;
      else if (l.R >= 4 && l.O < 9 && on >= 2 && l.NP > 55) pull = true;
      else if (inn >= 7 && newInning && l.NP > lim - 22 && lead > 0 && lead <= 3) pull = inn >= 8 || l.NP > lim - 14;
      else if (inn >= 9 && newInning && lead > 0 && lead <= 3 && side.roles?.cl && pen.some(x => x.id === side.roles.cl) && l.NP > 85) pull = true;
    } else {
      const lim = staminaLimit(p);
      const faced = l.BF;
      if (l.NP >= lim + 6) pull = true;
      else if (newInning && l.O >= 3 && (l.NP > lim * 0.55 || p.pit.sta < 34 || (inn >= 9 && lead > 0 && lead <= 3 && p.id !== side.roles?.cl))) pull = true;
      else if (newInning && l.O >= 6) pull = l.NP > lim * 0.8;
      else if (faced >= 3 && l.R >= 3 && on >= 1) pull = true;
      else if (faced >= 3 && on >= 2 && fat > 0.2) pull = true;
      // closer for the save
      if (!pull && newInning && inn >= 9 && lead > 0 && lead <= 3 && side.roles?.cl && p.id !== side.roles.cl && pen.some(x => x.id === side.roles.cl) && l.O >= 1) pull = true;
    }
    if (!pull) return;
    const nxt = this.pickReliever(side, si, pen);
    if (nxt) this.changePitcher(si, nxt.id, ev);
  }

  pickReliever(side, si, pen) {
    const lead = this.lead(si), inn = this.inning, roles = side.roles || {};
    const by = id => pen.find(p => p.id === id);
    const q = p => p.ovr - (p.fat || 0) * 0.25;
    const sorted = [...pen].sort((a, b) => q(b) - q(a));
    const close = Math.abs(lead) <= 2 || (lead > 0 && lead <= 3);
    if (inn >= 9 && lead > 0 && lead <= 3 && by(roles.cl)) return by(roles.cl);
    if (inn >= 9 && lead === 0 && by(roles.cl) && si === 1) return by(roles.cl);
    if (inn <= 5 && by(roles.long)) return by(roles.long);
    const nonCl = sorted.filter(p => p.id !== roles.cl);
    const poolP = nonCl.length ? nonCl : sorted;
    if (inn >= 7 && close) { const su = (roles.su || []).map(by).filter(Boolean); if (su.length) return su[0]; return poolP[0]; }
    if (Math.abs(lead) >= 5) return poolP[poolP.length - 1];                      // mop-up
    if (close) return poolP[Math.min(poolP.length - 1, 1 + (inn < 7 ? 1 : 0))] || poolP[0];
    return poolP[Math.min(poolP.length - 1, Math.floor(poolP.length / 2))];
  }

  manageBatting(side, si, ev) {
    const slot = side.lineup[side.idx % 9], b = slot.p, p = this.pitcher;
    const lead = this.lead(si), inn = this.inning;
    const tac = this.tactic[si];
    // pinch hit: late, close, clearly better bat available
    if (inn >= 7 && lead <= 1 && lead >= -4 && side.bench.length && !b.twoWay) {
      const val = x => { const r = batRates(x.bat); const same = x.bats !== 'S' && x.bats === p.throws; return (x.bat.con + x.bat.eye + x.bat.pow * 1.3 + x.bat.hit) / 4.3 - (same ? 3 : -2); };
      const risp = this.bases[1] || this.bases[2];
      const cands = side.bench.filter(x => !x.isP && !x.inj).map(x => ({ x, v: val(x) })).sort((a, b2) => b2.v - a.v);
      const best = cands[0];
      const backupC = side.bench.some(x => (x.elig || []).includes('C'));
      if (best && best.v > val(b) + (risp || inn >= 9 ? 7 : 11) && (slot.pos !== 'C' || backupC) && this.rng.chance(0.75)) {
        this.pinchHit(si, best.x.id, ev);
      }
    }
    // rare sacrifice bunt
    const bb = side.lineup[side.idx % 9].p;
    if (this.outs === 0 && inn >= 8 && lead >= -1 && lead <= 0 && (this.bases[0] || this.bases[1]) && !this.bases[2] && bb.bat.pow < 42 && bb.bat.con + bb.bat.hit < 100 && this.rng.chance(0.5)) tac.bunt = true;
    // defending manager: intentional walk and infield in
    const fsi = 1 - si, fside = this.sides[fsi];
    if (!fside.manual) {
      const dt = this.tactic[fsi];
      dt.infieldIn = !!this.bases[2] && this.outs < 2 && inn >= 8 && Math.abs(lead) <= 1;
      const next = side.lineup[(side.idx + 1) % 9].p;
      const gap = (bb.ovr || 60) - (next.ovr || 60);
      if (inn >= 8 && !this.bases[0] && (this.bases[1] || this.bases[2]) && this.outs >= 1 && lead <= 0 && lead >= -1 && gap >= 9 && this.rng.chance(0.55)) dt.ibb = true;
    }
  }

  // ---------- results ----------
  box() {
    return {
      score: [...this.score], line: this.line.map(l => [...l]), hits: [...this.hits], errs: [...this.errs],
      innings: this.inning, winner: this.winner,
      bat: [...this.bat.values()], pit: [...this.pit.values()],
      W: this.winP?.id, L: this.lossP?.id, SV: this.saveP?.id,
    };
  }
  play() { while (!this.over) this.step(); return this; }
}
