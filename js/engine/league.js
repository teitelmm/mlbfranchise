// The league: career state, rosters, lineups, and playing the schedule day by day.
import { Rng } from './rng.js';
import { Game, newBatLine, newPitLine } from './game.js';
import { calcOvr, defAt, batRAA, batRates, wobaFromRates, clamp, POS_DIFF } from './ratings.js';
import { buildSchedule, fmtDate } from './schedule.js';
import { MIN_SALARY, CBT } from './money.js';

export const ACTIVE_MAX = 26, FORTY_MAX = 40, PITCHERS_MAX = 14;
const LINE_POS = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'];

// ---------- state ----------
export function index(L) {
  Object.defineProperty(L, 'pm', { value: new Map(L.players.map(p => [p.id, p])), enumerable: false, configurable: true, writable: true });
  Object.defineProperty(L, 'tm', { value: new Map(L.teams.map(t => [t.id, t])), enumerable: false, configurable: true, writable: true });
  Object.defineProperty(L, 'rng', { value: new Rng(L.seed), enumerable: false, configurable: true, writable: true });
  return L;
}
export const P = (L, id) => L.pm.get(id);
export const T = (L, id) => L.tm.get(id);
export const name = p => `${p.first} ${p.last}`;
export const saveSeed = L => { L.seed = L.rng.s; };
export const today = L => fmtDate(L.season, L.phase === 'offseason' ? 215 + (L.off?.day || 0) : L.day);

export function news(L, text, kind = 'info', tid = 0, pid = 0) {
  L.news.unshift({ d: today(L), y: L.season, t: text, k: kind, tid, pid });
  if (L.news.length > 400) L.news.length = 400;
}

export function newCareer(data, { userTid, games = 162, seed = (Math.random() * 2 ** 31) | 0, gm = 'GM' }) {
  const L = {
    v: 1, season: data.season, userTid, games, seed, gm, day: 0, phase: 'regular',
    teams: structuredClone(data.teams), players: structuredClone(data.players),
    sched: [], news: [], tx: [], hist: [], inbox: [], nextId: 9000000,
    cbt: CBT.base, opts: { autoLineup: true, autoPitch: true, autoRest: true, autoRoster: false, autoDraft: false },
  };
  index(L);
  for (const p of L.players) { initPlayer(p); p.rk = (p.hist || []).filter(h => h.lv === 'MLB').reduce((s, h) => s + (h.PA || 0) + (h.BF || 0) * 2.6, 0) < 130 ? 1 : 0; }
  for (const t of L.teams) {
    Object.assign(t, { w: 0, l: 0, rs: 0, ra: 0, l10: [], strk: 0, hw: 0, hl: 0, aw: 0, al: 0, mw: 0, ml: 0, rotI: 0, cash: 20 + t.market * 8, taxYears: 0, rev: 0, gate: 0, att: 0, dead: 0, hist: [] });
    t.ownerMood = 60;
    setInitialRoster(L, t);
    autoLineup(L, t); autoPitching(L, t);
  }
  L.sched = buildSchedule(L.teams, games, L.rng);
  setExpectations(L);
  L.norm = talentLevel(L);
  news(L, `Welcome to the ${L.season} season. You are the new general manager of the ${T(L, userTid).name}.`, 'big', userTid);
  saveSeed(L);
  return L;
}

export function initPlayer(p) {
  p.st ??= {}; p.fat ??= 0; p.inj ??= null; p.il ??= 0; p.use ??= 0;
  if (!p.st.b) p.st.b = newBatLine(); if (!p.st.p && p.isP) p.st.p = newPitLine();
  p.st.b.G ??= 0;
  p.sm ??= { b: Object.assign(newBatLine(), { G: 0 }), p: p.isP ? newPitLine() : null };
  p.hist ??= []; p.optUsed ??= 0; p.d0 ??= p.ovr;
  return p;
}

// ---------- roster queries ----------
export const org = (L, tid) => L.players.filter(p => p.tid === tid);
export const active = (L, tid) => L.players.filter(p => p.tid === tid && p.lvl === 'MLB' && !p.il);
export const forty = (L, tid) => L.players.filter(p => p.tid === tid && p.on40 && p.il !== 60);
export const healthy = p => !p.inj || p.inj.days <= 0;
export const isHitter = p => !p.isP || p.twoWay;
export function payroll(L, tid) {
  let s = 0;
  for (const p of L.players) if (p.tid === tid && p.on40) s += p.con.sal;
  return s + (T(L, tid).dead || 0);
}
export const rosterCounts = (L, tid) => ({ active: active(L, tid).length, forty: forty(L, tid).length, pitchers: active(L, tid).filter(p => p.isP && !p.twoWay).length });

// ---------- lineups ----------
function offVal(p, hand) {
  const b = p.bat, r = batRates(b);
  const same = hand && p.bats !== 'S' && p.bats === hand;
  const k = hand ? (same ? 1.07 : 0.95) : 1, bb = hand ? (same ? 0.93 : 1.06) : 1, hr = hand ? (same ? 0.87 : 1.10) : 1;
  return wobaFromRates({ k: r.k * k, bb: r.bb * bb, hbp: r.hbp, hr: r.hr * hr, babip: r.babip * (hand ? (same ? 0.985 : 1.012) : 1) }, b.pow, b.spd);
}
function slotVal(p, pos, hand) {
  if (pos === 'C' && !(p.elig || []).includes('C')) return -999;
  const off = (offVal(p, hand) - 0.313) / 1.2 * 650;
  const d = pos === 'DH' ? 0 : (defAt(p, pos) - 50) * (pos === 'C' ? 0.30 : pos === '1B' ? 0.18 : 0.34);
  return off + d + (p.twoWay && pos !== 'DH' ? -99 : 0);
}
// Best nine and their positions from a pool of hitters. Returns [[pid,pos] x9] in batting order.
export function bestLineup(pool, hand) {
  const hitters = pool.filter(isHitter);
  if (hitters.length < 9) return null;
  const used = new Set(), asg = {};
  for (const pos of LINE_POS) {
    let best = null, bv = -1e9;
    for (const p of hitters) {
      if (used.has(p.id)) continue;
      // opportunity cost: do not burn a star bat at a spot a lesser glove can fill
      const v = slotVal(p, pos, hand) - (pos === 'DH' ? 0 : 0.35 * Math.max(0, slotVal(p, 'DH', hand)));
      if (v > bv) { bv = v; best = p; }
    }
    if (!best || bv < -500) { best = hitters.find(p => !used.has(p.id)); }
    asg[pos] = best; used.add(best.id);
  }
  // local search: swaps between slots and with the bench
  const total = () => LINE_POS.reduce((s, pos) => s + slotVal(asg[pos], pos, hand), 0);
  let cur = total();
  for (let it = 0; it < 12; it++) {
    let improved = false;
    for (const a of LINE_POS) for (const b of LINE_POS) {
      if (a >= b) continue;
      [asg[a], asg[b]] = [asg[b], asg[a]];
      const t = total();
      if (t > cur + 0.01) { cur = t; improved = true; } else [asg[a], asg[b]] = [asg[b], asg[a]];
    }
    for (const a of LINE_POS) for (const p of hitters) {
      if (used.has(p.id)) continue;
      const old = asg[a]; asg[a] = p;
      const t = total();
      if (t > cur + 0.01) { cur = t; used.delete(old.id); used.add(p.id); improved = true; } else asg[a] = old;
    }
    if (!improved) break;
  }
  // batting order
  const nine = LINE_POS.map(pos => ({ p: asg[pos], pos, w: offVal(asg[pos], hand) }));
  nine.sort((a, b) => b.w - a.w);
  const top = nine.slice(0, 5);
  const obp = x => { const r = batRates(x.p.bat); return r.bb + (1 - r.k - r.bb - r.hr) * r.babip + x.p.bat.spd * 0.0006; };
  const lead = [...top].sort((a, b) => obp(b) - obp(a))[0];
  const rest = nine.filter(x => x !== lead);
  const pow = [...rest.slice(0, 4)].sort((a, b) => b.p.bat.pow - a.p.bat.pow)[0];
  const others = rest.filter(x => x !== pow);
  const order = [lead, others[0], others[1], pow, ...others.slice(2)];
  return order.map(x => [x.p.id, x.pos]);
}

export function autoLineup(L, t) {
  const pool = active(L, t.id).filter(healthy);
  t.lineup = { R: bestLineup(pool, 'R') || t.lineup?.R || [], L: bestLineup(pool, 'L') || t.lineup?.L || [] };
}

export function autoPitching(L, t) {
  const ps = active(L, t.id).filter(p => p.isP && healthy(p));
  const sps = ps.filter(p => p.role === 'SP').sort((a, b) => b.ovr - a.ovr);
  let rot = sps.slice(0, 5);
  if (rot.length < 5) rot = rot.concat(ps.filter(p => !rot.includes(p)).sort((a, b) => b.pit.sta - a.pit.sta || b.ovr - a.ovr).slice(0, 5 - rot.length));
  const keep = (t.rot || []).filter(id => rot.some(p => p.id === id));
  // preserve the existing order so the rotation does not reshuffle mid-season
  t.rot = [...keep, ...rot.filter(p => !keep.includes(p.id)).map(p => p.id)];
  const pen = ps.filter(p => !t.rot.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  const short = pen.filter(p => p.role === 'RP');
  const cl = (short[0] || pen[0])?.id || 0;
  const su = pen.filter(p => p.id !== cl).slice(0, 2).map(p => p.id);
  const long = [...pen].filter(p => p.id !== cl && !su.includes(p.id)).sort((a, b) => b.pit.sta - a.pit.sta)[0]?.id || 0;
  t.roles = { cl, su, long };
}

// Opening roster: best 26 (13 pitchers), a legal 40-man, everyone else in the minors.
export function setInitialRoster(L, t) {
  const mine = org(L, t.id);
  const pool = mine.filter(p => p.lvl !== 'LOW' && healthy(p));
  const pit = pool.filter(p => p.isP).sort((a, b) => b.ovr - a.ovr);
  const sp = pit.filter(p => p.role === 'SP').slice(0, 5);
  const rp = pit.filter(p => !sp.includes(p)).slice(0, 13 - sp.length);
  const hitPool = pool.filter(p => !p.isP);
  const nine = bestLineup(hitPool, 'R') || [];
  const pick = new Set(nine.map(x => x[0]));
  const rest = hitPool.filter(p => !pick.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  const take = f => { const p = rest.find(x => !pick.has(x.id) && f(x)); if (p) pick.add(p.id); };
  take(p => (p.elig || []).includes('C'));
  take(p => (p.elig || []).some(e => e === 'SS' || e === '2B'));
  take(p => (p.elig || []).some(e => ['LF', 'CF', 'RF'].includes(e)));
  while (pick.size < 13 && rest.some(p => !pick.has(p.id))) take(() => true);
  const act = new Set([...sp, ...rp].map(p => p.id).concat([...pick]));
  for (const p of mine) {
    if (act.has(p.id)) { p.lvl = 'MLB'; p.on40 = 1; }
    else if (p.lvl === 'MLB') p.lvl = 'AAA';
  }
  trimForty(L, t);
  balanceMinors(L, t);
}
function trimForty(L, t) {
  let f = forty(L, t.id);
  if (f.length <= FORTY_MAX) return;
  const cut = f.filter(p => p.lvl !== 'MLB').sort((a, b) => keepVal(a) - keepVal(b));
  for (const p of cut) { if (forty(L, t.id).length <= FORTY_MAX) break; p.on40 = 0; if (p.con.sal > MIN_SALARY) p.con.sal = Math.max(0.1, p.con.sal); }
}
const keepVal = p => p.ovr + Math.max(0, p.pot - p.ovr) * 0.6 - Math.max(0, p.age - 30);
export function balanceMinors(L, t) {
  const aaa = org(L, t.id).filter(p => p.lvl === 'AAA').sort((a, b) => keepVal(b) - keepVal(a));
  for (const p of aaa.slice(34)) if (!p.on40) p.lvl = 'LOW';
}

// ---------- building a game ----------
const luCache = new Map();
export const clearLineupCache = () => luCache.clear();
function cachedBest(t, lvl, hitters, hand) {
  const k = t.id + lvl + hand, sig = hitters.map(p => p.id).sort((a, b) => a - b).join(',');
  const c = luCache.get(k);
  if (c && c.sig === sig) return c.lu ? c.lu.map(x => [...x]) : null;
  const lu = bestLineup(hitters, hand);
  luCache.set(k, { sig, lu });
  return lu ? lu.map(x => [...x]) : null;
}
function sideFor(L, t, lvl, oppHand, manual) {
  let pool, rot, roles;
  if (lvl === 'MLB') pool = active(L, t.id).filter(healthy);
  else {
    pool = L.players.filter(p => p.tid === t.id && p.lvl === 'AAA' && healthy(p) && !p.il);
    const needH = 11 - pool.filter(p => !p.isP).length, needP = 11 - pool.filter(p => p.isP).length;
    if (needH > 0 || needP > 0 || !pool.some(p => (p.elig || []).includes('C'))) {
      const low = L.players.filter(p => p.tid === t.id && p.lvl === 'LOW' && healthy(p)).sort((a, b) => b.ovr - a.ovr);
      pool = pool.concat(low.filter(p => !p.isP).slice(0, Math.max(0, needH) + 1), low.filter(p => p.isP).slice(0, Math.max(0, needP)), low.filter(p => (p.elig || []).includes('C')).slice(0, 1));
      pool = [...new Set(pool)];
    }
  }
  const ok = id => pool.some(p => p.id === id);
  // starter
  let sp;
  const pitchers = pool.filter(p => p.isP);
  if (lvl === 'MLB') {
    if (!t.rot?.length || !t.rot.some(ok)) autoPitching(L, t);
    const n = t.rot.length;
    for (let i = 0; i < n; i++) { const c = P(L, t.rot[(t.rotI + i) % n]); if (c && ok(c.id) && c.fat < 22) { sp = c; t.rotI = (t.rotI + i) % n; break; } }
    if (!sp) sp = pitchers.filter(p => p.fat < 22).sort((a, b) => b.pit.sta - a.pit.sta || b.ovr - a.ovr)[0] || pitchers.sort((a, b) => a.fat - b.fat)[0];
    roles = t.roles;
  } else {
    sp = pitchers.filter(p => p.role === 'SP' && p.fat < 15).sort((a, b) => b.ovr - a.ovr)[0] || pitchers.sort((a, b) => a.fat - b.fat || b.pit.sta - a.pit.sta)[0];
    const pen0 = pitchers.filter(p => p !== sp && p.role === 'RP').sort((a, b) => b.ovr - a.ovr);
    roles = { cl: pen0[0]?.id, su: pen0.slice(1, 3).map(p => p.id), long: 0 };
  }
  if (!sp) return null;
  const hitters = pool.filter(p => isHitter(p));
  let lu;
  const stored = lvl === 'MLB' ? t.lineup?.[oppHand] : null;
  const valid = stored && stored.length === 9 && stored.every(([id]) => ok(id)) && new Set(stored.map(x => x[0])).size === 9;
  const autoL = lvl !== 'MLB' || (t.id === L.userTid ? L.opts.autoLineup : true);
  if (valid && !autoL) lu = stored.map(x => [...x]);
  else {
    if (stored && !autoL) {
      // keep the manager's card, patch only the broken slots
      lu = stored.map(x => [...x]);
      const usedIds = new Set(lu.filter(([id]) => ok(id)).map(x => x[0]));
      for (const s of lu) if (!ok(s[0]) || lu.filter(y => y[0] === s[0]).length > 1) {
        const c = hitters.filter(p => !usedIds.has(p.id)).sort((a, b) => slotVal(b, s[1], oppHand) - slotVal(a, s[1], oppHand))[0];
        if (c) { s[0] = c.id; usedIds.add(c.id); }
      }
      if (!lu.every(([id]) => ok(id))) lu = cachedBest(t, lvl, hitters, oppHand);
    } else lu = cachedBest(t, lvl, hitters, oppHand);
    if (lvl === 'MLB' && lu && autoL) { t.lineup ??= {}; t.lineup[oppHand] = lu.map(x => [...x]); }
  }
  if (!lu) return null;
  // rest days: sit the catcher about one game in five, an everyday player now and then
  if (lvl === 'MLB' && (t.id !== L.userTid || L.opts.autoRest) && !manual) {
    const inIds = new Set(lu.map(x => x[0]));
    const bench = hitters.filter(p => !inIds.has(p.id) && !p.isP);
    for (const s of lu) {
      const pr = s[1] === 'C' ? 0.2 : s[1] === 'DH' ? 0 : 0.035;
      if (!L.rng.chance(pr)) continue;
      const c = bench.filter(p => !inIds.has(p.id) && slotVal(p, s[1], oppHand) > -200 && defAt(p, s[1]) >= 30).sort((a, b) => slotVal(b, s[1], oppHand) - slotVal(a, s[1], oppHand))[0];
      if (c) { inIds.delete(s[0]); s[0] = c.id; inIds.add(c.id); }
    }
  }
  const lineup = lu.map(([id, pos]) => ({ p: P(L, id), pos }));
  const ids = new Set(lineup.map(x => x.p.id));
  const bench = hitters.filter(p => !ids.has(p.id) && p !== sp);
  const pen = pitchers.filter(p => p !== sp && (lvl !== 'MLB' || !t.rot.includes(p.id) || pitchers.length < 9));
  return { tid: t.id, abbr: t.abbr, lineup, bench, pen, sp, roles, manual: !!manual };
}

function probableSP(L, t) {
  const n = t.rot?.length || 0;
  for (let i = 0; i < n; i++) { const c = P(L, t.rot[(t.rotI + i) % n]); if (c && c.tid === t.id && c.lvl === 'MLB' && !c.il && healthy(c) && c.fat < 22) return c; }
  return active(L, t.id).filter(p => p.isP && healthy(p)).sort((a, b) => a.fat - b.fat || b.ovr - a.ovr)[0];
}
export { probableSP };

export function makeGame(L, hId, aId, { detail = false, manualTid = 0, lvl = 'MLB', playoff = false } = {}) {
  const ht = T(L, hId), at = T(L, aId);
  const hsp = lvl === 'MLB' ? probableSP(L, ht) : null, asp = lvl === 'MLB' ? probableSP(L, at) : null;
  const home = sideFor(L, ht, lvl, asp?.throws || 'R', manualTid === hId);
  const away = sideFor(L, at, lvl, hsp?.throws || 'R', manualTid === aId);
  if (!home || !away) return null;
  return new Game({ home, away, park: ht.park, pf: ht.pf, rng: L.rng, detail, playoff });
}

// ---------- after a game ----------
const INJ = [
  ['hamstring strain', 10, 8, 30, 'any'], ['oblique strain', 9, 12, 40, 'any'], ['sprained ankle', 7, 3, 20, 'bat'], ['bruised hand', 8, 1, 6, 'bat'],
  ['back tightness', 8, 1, 12, 'any'], ['wrist sprain', 5, 5, 28, 'bat'], ['knee soreness', 6, 2, 18, 'any'], ['calf strain', 5, 8, 25, 'any'],
  ['fractured finger', 3, 25, 50, 'bat'], ['concussion', 2, 7, 20, 'bat'], ['groin strain', 5, 6, 24, 'any'], ['quad strain', 5, 7, 25, 'bat'],
  ['shoulder inflammation', 8, 12, 45, 'pit'], ['forearm tightness', 7, 10, 50, 'pit'], ['elbow inflammation', 6, 15, 60, 'pit'], ['blister', 6, 2, 10, 'pit'],
  ['lat strain', 4, 25, 70, 'pit'], ['flexor strain', 3, 40, 90, 'pit'], ['torn UCL (Tommy John surgery)', 1.6, 300, 420, 'pit'], ['rotator cuff strain', 2, 45, 120, 'pit'],
  ['torn ACL', 0.5, 180, 260, 'bat'], ['broken hamate bone', 1.5, 35, 55, 'bat'], ['torn labrum', 0.8, 120, 200, 'any'],
];
export function injure(L, p, how, forceDays = 0) {
  if (p.inj && p.inj.days > 0) return null;
  const kind = how === 'pitch' ? 'pit' : 'bat';
  const it = L.rng.weighted(INJ.filter(i => i[4] === 'any' || i[4] === kind), i => i[1]);
  const days = forceDays || Math.round(it[2] + Math.pow(L.rng.f(), 1.6) * (it[3] - it[2]));
  p.inj = { name: it[0], days, total: days };
  return p.inj;
}

export function applyGame(L, g, { lvl = 'MLB', hId, aId, playoff = false }) {
  const key = lvl === 'MLB' ? 'st' : 'sm';
  for (const bl of g.bat.values()) {
    const p = bl.p, s = (p[key].b ??= Object.assign(newBatLine(), { G: 0 }));
    for (const k in bl) if (k !== 'p' && typeof bl[k] === 'number') s[k] = (s[k] || 0) + bl[k];
    s.G = (s.G || 0) + 1; p.use += bl.PA;
    if (playoff) { const ps = (p.po ??= { b: newBatLine() }).b ??= newBatLine(); for (const k in bl) if (typeof bl[k] === 'number') ps[k] = (ps[k] || 0) + bl[k]; }
  }
  for (const l of g.pit.values()) {
    const p = l.p, s = (p[key].p ??= newPitLine());
    for (const k in l) if (typeof l[k] === 'number' && k !== 'startFat' && k !== 'entryLead' && k !== 'entryOuts' && k !== 'entryInning') s[k] = (s[k] || 0) + l[k];
    if (l.GS && l.O >= 18 && l.ER <= 3) s.QS = (s.QS || 0) + 1;
    p.fat = (p.fat || 0) + l.NP * (l.GS ? 1 : 1.15) + (l.GS ? 0 : 6); p.use += l.BF * 4;
  }
  if (playoff) return;
  const ht = T(L, hId), at = T(L, aId);
  const hw = g.winner === 1;
  if (lvl === 'MLB') {
    const upd = (t, won, rs, ra, home) => {
      if (won) { t.w++; home ? t.hw++ : t.aw++; } else { t.l++; home ? t.hl++ : t.al++; }
      t.rs += rs; t.ra += ra; t.l10.push(won ? 1 : 0); if (t.l10.length > 10) t.l10.shift();
      t.strk = won ? (t.strk > 0 ? t.strk + 1 : 1) : (t.strk < 0 ? t.strk - 1 : -1);
    };
    upd(ht, hw, g.score[1], g.score[0], true); upd(at, !hw, g.score[0], g.score[1], false);
    ht.rotI = (ht.rotI + 1) % Math.max(1, ht.rot.length); at.rotI = (at.rotI + 1) % Math.max(1, at.rot.length);
    // gate
    const gp = ht.w + ht.l, pct = gp > 8 ? ht.w / gp : 0.5;
    const fill = clamp(0.36 + ht.market * 0.075 + (pct - 0.5) * 0.9 + (ht.ownerMood - 50) * 0.001 + L.rng.range(-0.05, 0.07), 0.16, 1);
    const att = Math.round(ht.park.cap * fill);
    const gate = att * (21 + ht.market * 7.5) / 1e6 * (162 / L.games);
    ht.att += att; ht.gate += gate; g.att = att;
    (ht.fills ??= []).push(Math.round(fill * 100)); if (ht.fills.length > 10) ht.fills.shift();
  } else { hw ? (ht.mw++, at.ml++) : (ht.ml++, at.mw++); }
  // injuries
  for (const inj of g.injuries) {
    const p = inj.p; if (p.inj && p.inj.days > 0) continue;
    const r = injure(L, p, inj.how);
    if (r && lvl === 'MLB' && (r.days >= 4 || p.tid === L.userTid)) news(L, `${name(p)} (${T(L, p.tid).abbr}) leaves with a ${r.name}: out about ${r.days >= 14 ? Math.round(r.days / 7) + ' weeks' : r.days + ' days'}.`, 'inj', p.tid, p.id);
  }
}

// ---------- the user's roster must be legal before playing ----------
export function rosterProblems(L, tid = L.userTid) {
  const a = active(L, tid), out = [];
  if (a.length > ACTIVE_MAX) out.push(`Active roster has ${a.length} players (max ${ACTIVE_MAX}). Send someone down.`);
  if (forty(L, tid).length > FORTY_MAX) out.push(`40-man roster has ${forty(L, tid).length} players (max ${FORTY_MAX}).`);
  const h = a.filter(p => isHitter(p) && healthy(p));
  if (h.length < 9) out.push(`Only ${h.length} healthy position players. You need at least 9.`);
  if (!h.some(p => (p.elig || []).includes('C'))) out.push('No healthy catcher on the active roster.');
  if (a.filter(p => p.isP && healthy(p)).length < 6) out.push('Fewer than 6 healthy pitchers on the active roster.');
  return out;
}

// ---------- AI roster upkeep ----------
export function aiRosterUpkeep(L, t) {
  const mine = org(L, t.id);
  // injured list in and out
  for (const p of mine) {
    if (p.lvl === 'MLB' && !p.il && p.inj && p.inj.days >= 7) { p.il = p.inj.days > 55 ? 60 : p.isP ? 15 : 10; p.ilDay = L.day; }
    else if (p.il && healthy(p)) p.il = 0;
  }
  // never be left without a catcher: a short-term hurt one goes on the IL anyway, and with
  // none on the roster at all the weakest other bat makes room for one from the farm
  const isC = p => (p.elig || []).includes('C');
  if (!active(L, t.id).some(p => isC(p) && healthy(p)) && mine.some(p => isC(p) && healthy(p) && p.lvl !== 'MLB')) {
    for (const p of active(L, t.id)) if (isC(p) && !healthy(p)) { p.il = 10; p.ilDay = L.day; }
    const a = active(L, t.id);
    if (a.length >= ACTIVE_MAX) {
      const out = a.filter(p => !p.isP && !isC(p) && healthy(p)).sort((x, y) => x.ovr - y.ovr)[0];
      if (out) { out.lvl = 'AAA'; if (out.opt > 0 && !out.optUsed) { out.opt--; out.optUsed = 1; } }
    }
  }
  let act = active(L, t.id);
  const needP = () => act.filter(p => p.isP && healthy(p)).length < 12;
  const callUp = wantPitcher => {
    let cands = mine.filter(p => p.lvl !== 'MLB' && healthy(p) && !p.il && (p.lvl === 'AAA' || p.on40) && !!p.isP === wantPitcher).sort((a, b) => (b.ovr + b.on40 * 2) - (a.ovr + a.on40 * 2));
    if (!cands.length) cands = mine.filter(p => p.lvl === 'LOW' && healthy(p) && !!p.isP === wantPitcher).sort((a, b) => b.ovr - a.ovr);
    const c = cands[0];
    if (!c) return false;
    if (!c.on40) {
      if (forty(L, t.id).length >= FORTY_MAX) {
        const drop = forty(L, t.id).filter(p => p.lvl !== 'MLB').sort((a, b) => keepVal(a) - keepVal(b))[0];
        if (!drop || keepVal(drop) > keepVal(c) + 4) return false;
        drop.on40 = 0;
      }
      c.on40 = 1; if (c.con.sal < MIN_SALARY) c.con.sal = MIN_SALARY;
    }
    c.lvl = 'MLB'; if (!c.debutY) c.debutY = L.season;
    act = active(L, t.id);
    return true;
  };
  let guard = 0;
  while (act.length < ACTIVE_MAX && guard++ < 8) {
    const hit = act.filter(p => !p.isP && healthy(p)).length;
    const wantP = needP() || (hit >= 13 && act.filter(p => p.isP).length < 13);
    const needC = act.filter(p => healthy(p) && (p.elig || []).includes('C')).length < 2;
    if (needC && !wantP) {
      const c = mine.filter(p => p.lvl === 'AAA' && healthy(p) && (p.elig || []).includes('C')).sort((a, b) => b.ovr - a.ovr)[0];
      if (c) { if (!c.on40) { if (forty(L, t.id).length >= FORTY_MAX) { const d = forty(L, t.id).filter(p => p.lvl !== 'MLB').sort((a, b) => keepVal(a) - keepVal(b))[0]; if (d) d.on40 = 0; } c.on40 = 1; c.con.sal = Math.max(c.con.sal, MIN_SALARY); } c.lvl = 'MLB'; act = active(L, t.id); continue; }
    }
    if (!callUp(wantP) && !callUp(!wantP)) break;
  }
  guard = 0;
  while (act.length > ACTIVE_MAX && guard++ < 8) {
    const pc = act.filter(p => p.isP && !p.twoWay).length;
    const from = act.filter(p => (pc > 13 ? p.isP : pc < 13 ? !p.isP : true) && healthy(p));
    const worst = (from.length ? from : act).sort((a, b) => (a.ovr + (a.opt > 0 ? -3 : 0)) - (b.ovr + (b.opt > 0 ? -3 : 0)))[0];
    worst.lvl = 'AAA'; if (worst.opt > 0 && !worst.optUsed) { worst.opt--; worst.optUsed = 1; } else if (worst.opt <= 0 && !worst.optUsed) worst.on40 = 0;
    act = active(L, t.id);
  }
  const lineupIds = new Set([...(t.lineup?.R || []), ...(t.lineup?.L || [])].map(x => x[0]));
  const actIds = new Set(act.filter(healthy).map(p => p.id));
  if ([...lineupIds].some(id => !actIds.has(id)) || !t.lineup?.R?.length) autoLineup(L, t);
  if (!t.rot || t.rot.some(id => !actIds.has(id)) || t.rot.length < 5 || !actIds.has(t.roles?.cl)) autoPitching(L, t);
}

// ---------- one calendar day ----------
export function todaysGames(L) { return L.sched[L.day]?.g || []; }
export function userGameToday(L) {
  const g = todaysGames(L).find(x => (x.h === L.userTid || x.a === L.userTid) && !x.done);
  return g || null;
}
export function finishGame(L, sg, g) {
  applyGame(L, g, { lvl: 'MLB', hId: sg.h, aId: sg.a });
  sg.done = 1; sg.hs = g.score[1]; sg.as = g.score[0]; sg.w = g.winP?.id; sg.l = g.lossP?.id; sg.sv = g.saveP?.id || 0; sg.inn = g.inning;
  if (sg.h === L.userTid || sg.a === L.userTid) L.lastBox = slimBox(L, g, sg);
}
export function slimBox(L, g, sg) {
  const b = g.box();
  const line = l => { const o = {}; for (const k in l) if (typeof l[k] === 'number' && l[k]) o[k] = l[k]; o.id = l.p.id; return o; };
  return {
    h: sg.h, a: sg.a, score: b.score, line: b.line, hits: b.hits, errs: b.errs, W: b.W, L: b.L, SV: b.SV, att: g.att, day: L.day,
    order: g.sides.map(s => [...new Set([...s.lineup.map(l => l.p.id), ...s.out])]),
    lu: g.sides.map(s => s.lineup.map(l => [l.p.id, l.pos])),
    bat: b.bat.map(line), pit: g.sides.map(s => s.pitchers.map(p => line(g.pit.get(p.id)))),
    hr: g.log.filter(e => e.res === 'HR').map(e => e.batter),
  };
}

// Plays everything left on today's card, then moves the calendar forward one day.
export function simDay(L) {
  const day = L.sched[L.day];
  if (!day) return { done: true };
  const res = [];
  for (const t of L.teams) if (t.id !== L.userTid || L.opts.autoRoster) aiRosterUpkeep(L, t);
  for (const sg of day.g) {
    if (sg.done) continue;
    const g = makeGame(L, sg.h, sg.a);
    if (!g) { sg.done = 1; sg.hs = 0; sg.as = 0; continue; }
    g.play(); finishGame(L, sg, g); res.push(sg);
  }
  // Triple-A plays the same matchups
  for (const sg of day.g) {
    const g = makeGame(L, sg.h, sg.a, { lvl: 'AAA' });
    if (g) { g.play(); applyGame(L, g, { lvl: 'AAA', hId: sg.h, aId: sg.a }); }
  }
  endOfDay(L);
  return { games: res };
}

export function endOfDay(L) {
  for (const p of L.players) {
    if (p.fat > 0) p.fat = Math.max(0, p.fat - 20);
    if (p.inj) { p.inj.days--; if (p.inj.days <= 0) { p.inj = null; if (p.tid === L.userTid && p.il) inbox(L, `${name(p)} is healthy and ready to come off the injured list.`, 'heal', p.id); } }
    if (p.tid >= 0 && p.lvl === 'MLB' && !p.il) p.svcDays = (p.svcDays || 0) + 1;
    else if (p.il && p.tid >= 0) p.svcDays = (p.svcDays || 0) + 1;
  }
  // media money trickles in daily
  const days = L.sched.length;
  for (const t of L.teams) t.rev += (t.budget * 0.62 + 55) / days;
  L.day++;
  saveSeed(L);
}

export function inbox(L, text, kind = 'info', pid = 0, data = null) {
  L.inbox.unshift({ id: L.nextId++, d: today(L), t: text, k: kind, pid, data, unread: 1 });
  if (L.inbox.length > 120) L.inbox.length = 120;
}

// ---------- expectations ----------
export function teamStrength(L, tid) {
  const a = active(L, tid);
  const hit = a.filter(p => !p.isP || p.twoWay).sort((x, y) => y.ovr - x.ovr).slice(0, 9);
  const sp = a.filter(p => p.isP && p.role === 'SP').sort((x, y) => y.ovr - x.ovr).slice(0, 5);
  const rp = a.filter(p => p.isP && p.role === 'RP').sort((x, y) => y.ovr - x.ovr).slice(0, 5);
  const avg = (arr, d) => arr.length ? arr.reduce((s, p) => s + p.ovr, 0) / arr.length : d;
  return avg(hit, 65) * 0.5 + avg(sp, 65) * 0.35 + avg(rp, 65) * 0.15;
}
export function setExpectations(L) {
  const ranked = [...L.teams].sort((a, b) => teamStrength(L, b.id) - teamStrength(L, a.id));
  ranked.forEach((t, i) => {
    t.rank0 = i + 1;
    t.goal = i < 6 ? 'Win the pennant' : i < 12 ? 'Make the playoffs' : i < 20 ? 'Finish above .500' : 'Develop young players';
    t.goalW = Math.round(L.games * (i < 6 ? 0.57 : i < 12 ? 0.53 : i < 20 ? 0.49 : 0.43));
  });
}

// Snapshot of the league's talent: level, spread and the mix of individual skills.
export function talentLevel(L) {
  const lv = (f, keys, r) => {
    const top = L.players.filter(p => p.tid >= 0 && f(p)).sort((a, b) => b.ovr - a.ovr).slice(0, 390);
    const comp = {}; for (const k of keys) comp[k] = top.reduce((s, p) => s + p[r][k], 0) / top.length;
    return { med: top[195].ovr, p95: top[19].ovr, top: top[3].ovr, comp };
  };
  return { bat: lv(p => !p.isP, ['con', 'eye', 'pow', 'hit', 'spd', 'def', 'arm', 'gb'], 'bat'), pit: lv(p => p.isP, ['stf', 'ctl', 'mov', 'gb'], 'pit') };
}

// ---------- standings ----------
export function standings(L) {
  const out = {};
  for (const t of L.teams) (out[`${t.lg} ${t.div}`] ??= []).push(t);
  const pct = t => (t.w + t.l) ? t.w / (t.w + t.l) : 0.5;
  for (const k in out) out[k].sort((a, b) => pct(b) - pct(a) || (b.rs - b.ra) - (a.rs - a.ra));
  return out;
}
export function playoffField(L, lg) {
  const pct = t => (t.w + t.l) ? t.w / (t.w + t.l) : 0;
  const cmp = (a, b) => pct(b) - pct(a) || (b.rs - b.ra) - (a.rs - a.ra);
  const ts = L.teams.filter(t => t.lg === lg);
  const winners = ['East', 'Central', 'West'].map(d => ts.filter(t => t.div === d).sort(cmp)[0]).sort(cmp);
  const wc = ts.filter(t => !winners.includes(t)).sort(cmp).slice(0, 3);
  return [...winners, ...wc];
}

export { POS_DIFF, calcOvr, batRAA };
