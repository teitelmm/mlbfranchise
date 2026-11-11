// The calendar beyond a single day: player development, the draft, playoffs,
// the offseason (contracts, free agency) and rolling over to a new year.
import {
  P, T, org, active, forty, payroll, news, inbox, name, healthy, initPlayer, simDay, endOfDay, makeGame, applyGame, slimBox,
  autoLineup, autoPitching, setInitialRoster, balanceMinors, aiRosterUpkeep, setExpectations, playoffField, rosterProblems,
  clearLineupCache, injure, saveSeed, ACTIVE_MAX, FORTY_MAX, teamStrength, talentLevel,
} from './league.js';
import { calcOvr, clamp } from './ratings.js';
import { marketValue, MIN_SALARY, CBT } from './money.js';
import { buildSchedule } from './schedule.js';
import { newBatLine, newPitLine } from './game.js';
import { randomName } from './names.js';
import { war, batWAR, pitWAR, bat, pit } from './stats.js';
import { dailyTrades, teamMode } from './trade.js';
import { pop, unlock, ensureState, recordSeason, clubRecords, hofWinter, SCOUT_PTS } from './legacy.js';
import { ownerDay, ownerSeasonStart, ownerSeasonEnd, fire, liveMood } from './owner.js';

export const DEV_EVERY = 30, DRAFT_ROUNDS = 10, FA_DAYS = 30;
const tx = (L, t, tid) => L.tx.unshift({ d: L.day, y: L.season, t, tid });

// ---------- development ----------
const GROW = { 17: 0.16, 18: 0.17, 19: 0.19, 20: 0.21, 21: 0.23, 22: 0.25, 23: 0.26, 24: 0.27, 25: 0.26, 26: 0.24, 27: 0.21, 28: 0.16 };
function seed01(id, salt) { let h = (id * 2654435761 + salt * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; }

// how much a player's situation helps him improve (1 = normal)
export function devFactor(L, p, games = DEV_EVERY * 0.9) {
  if (p.inj && p.inj.days > 20) return 0.3;
  if (p.tid < 0) return 0.5;
  if (p.lvl === 'LOW') return p.ovr >= 63 ? 0.6 : 1.0;
  const full = p.isP && !p.twoWay ? games * (p.role === 'SP' ? 14 : 5) : games * 3.3;
  const u = clamp((p.use || 0) / full, 0, 1);
  if (p.lvl === 'AAA') return p.ovr >= 76 || p.ovr >= p.pot - 1 ? 0.75 : 0.6 + 0.75 * u;
  return 0.42 + 0.78 * u;
}
export function devLabel(f) { return f >= 1.2 ? 'Excellent' : f >= 0.95 ? 'Good' : f >= 0.7 ? 'Average' : f >= 0.5 ? 'Slow' : 'Stalled'; }

export function developAll(L, frac, offseason = false) {
  const rng = L.rng, notes = [];
  // what the scouts said about the club's own prospects before this round of growth
  const watch = new Map(L.players.filter(p => p.tid === L.userTid && p.age <= 25 && p.lvl !== 'MLB').map(p => [p.id, shownPot(p)]));
  const breaks = [];
  if (!offseason) for (const p of L.players) {
    // a monster half in the minors makes scouts (and the kid) believe
    if (!p.gen || p.tid < 0 || p.lvl === 'MLB' || p.age > 25 || p.boY === L.season || p.pot >= 97) continue;
    const s = p.sm, hot = p.isP && !p.twoWay ? (s.p?.O >= 90 && pit(s.p).era <= 2.8) : (s.b?.PA >= 90 && bat(s.b).ops >= 0.88);
    if (hot && rng.chance(0.4)) { p.boY = L.season; p.pot = clamp(p.pot + rng.range(2, 5), p.ovr, 99); tighten(p, 1.5); if (p.tid === L.userTid) breaks.push(p); }
  }
  for (const p of L.players) {
    if (p.tid === -2) continue;
    const a = p.age, f = offseason ? 1 : devFactor(L, p);
    let d;
    if (a <= 28 && p.ovr < p.pot) d = (p.pot - p.ovr) * (GROW[clamp(a, 17, 28)]) * f * frac + rng.n() * 0.9 * Math.sqrt(frac);
    else if (a >= 30) d = -((a - 29) * 0.42 + (a >= 34 ? (a - 33) * 0.55 : 0)) * frac + rng.n() * 1.1 * Math.sqrt(frac);
    else d = rng.n() * 0.8 * Math.sqrt(frac);
    const before = p.ovr;
    if (!p.isP || p.twoWay) {
      const b = p.bat;
      ['con', 'eye', 'pow', 'hit'].forEach((k, i) => { b[k] = clamp(b[k] + d * 1.05 * (0.6 + seed01(p.id, 100 + i) * 0.8), 20, 99); });
      if (a >= 28) b.spd = clamp(b.spd - 0.75 * frac * (1 + (a - 28) * 0.12), 20, 99); else b.spd = clamp(b.spd + Math.max(0, d) * 0.1, 20, 99);
      if (a >= 31) b.def = clamp(b.def - 0.6 * frac, 20, 99); else b.def = clamp(b.def + Math.max(0, d) * 0.3, 20, 99);
    }
    if (p.isP) {
      const t = p.pit;
      ['stf', 'ctl', 'mov'].forEach((k, i) => { t[k] = clamp(t[k] + d * 1.1 * (0.6 + seed01(p.id, 110 + i) * 0.8), 20, 99); });
      if (a >= 33) t.sta = clamp(t.sta - 0.8 * frac, 20, 99);
      if (a >= 31 && t.mix) for (const m of t.mix) m[2] = Math.round((m[2] - 0.35 * frac) * 10) / 10;
    }
    p.ovr = calcOvr(p);
    if (a >= 29) p.pot = p.ovr; else if (offseason && a <= 25) p.pot = clamp(Math.round(p.pot + (rng.chance(0.06) ? rng.range(3, 8) : rng.n() * 2.6 - 1.3)), p.ovr, 99);
    if (p.pot < p.ovr) p.pot = p.ovr;
    // the scouting picture sharpens as he plays (and all at once when he grows up)
    if (fogW(p) > 0) { if (a >= 23) tighten(p, 99); else tighten(p, offseason ? 1.5 : 0.4 + 0.5 * Math.min(1, (p.use || 0) / 60)); }
    p.use = 0;
    if (p.tid === L.userTid && Math.abs(p.ovr - before) >= 2) notes.push([p, p.ovr - before]);
  }
  clearLineupCache();
  if (notes.length) {
    notes.sort((x, y) => y[1] - x[1]);
    const up = notes.filter(n => n[1] > 0).slice(0, 5).map(n => `${name(n[0])} +${Math.round(n[1])}`), dn = notes.filter(n => n[1] < 0).slice(-4).map(n => `${name(n[0])} ${Math.round(n[1])}`);
    if (up.length) inbox(L, `Development report: ${up.join(', ')}.`, 'dev');
    if (dn.length) inbox(L, `Declining: ${dn.join(', ')}.`, 'dev');
  }
  // breakouts and busts among the club's own prospects
  const ups = [], downs = [];
  for (const [id, before] of watch) {
    const p = P(L, id); if (!p || p.tid !== L.userTid) continue;
    const d = shownPot(p) - before;
    if (d >= 4 || breaks.includes(p)) ups.push([p, d]); else if (d <= -4) downs.push([p, d]);
  }
  if (ups.length) {
    ups.sort((a, b) => b[1] - a[1]);
    const [p] = ups[0], lead = `${name(p)} (${p.pos}, ${p.age})`;
    for (const [q, d] of ups) news(L, `Breakout: ${name(q)} now projects to ${potText(q)}${d > 0 ? ` (+${d})` : ''}.`, 'dev', q.tid, q.id);
    pop(L, { k: 'breakout', kick: ups.length > 1 ? `${ups.length} prospects break out` : 'Prospect breakout', title: `${lead} breaks out`, pid: p.id,
      text: `Your scouts now see a ${potText(p)} ceiling, up from ${watch.get(p.id)}.${ups.length > 1 ? ` Also rising: ${ups.slice(1, 4).map(([q, d]) => `${name(q)} (+${d})`).join(', ')}.` : ''}`, acts: [['Prospects', 'go', { v: 'prospects' }]] });
  }
  if (downs.length) inbox(L, `Scouts are cooling on ${downs.slice(0, 4).map(([q, d]) => `${name(q)} (${d}, now ${potText(q)})`).join(', ')}.`, 'dev');
}

// ---------- scouting fog ----------
// Drafted and international kids come with a guess at their ceiling (shownPot) and a
// range of doubt (fogW) around it. Playing time, age and the club's scouts narrow it.
export const fogW = p => p.gen ? (p.fw ?? (p.age <= 22 && p.fz ? 3 : 0)) : 0;
function tighten(p, amt) {
  const w0 = fogW(p); if (w0 <= 0) return;
  const w = Math.max(0, Math.round((w0 - amt) * 10) / 10);
  p.fz = w > 0 ? Math.round((p.fz || 0) * (w / w0) * 10) / 10 : 0; p.fw = w;
}
export const potRange = p => { const w = fogW(p); if (w < 0.5) return null; const s = shownPot(p), lo = Math.round(Math.max(p.ovr, s - w)), hi = Math.min(99, Math.round(s + w)); return hi > lo ? [lo, hi] : null; };
export const potText = p => { const r = potRange(p); return r ? `${r[0]}–${r[1]}` : String(shownPot(p)); };
export function scoutPlayer(L, pid) {
  ensureState(L);
  const p = P(L, pid);
  if (!p || fogW(p) < 0.5) return fail('Your scouts already know what he is.');
  if (L.scout.pts <= 0) return fail('No scouting trips left this year. They reset on Opening Day.');
  const was = potText(p);
  L.scout.pts--; tighten(p, 3);
  return okay(`Your scouts watched ${name(p)}: ${was} becomes ${potText(p)}. ${L.scout.pts} trip${L.scout.pts === 1 ? '' : 's'} left this year.`);
}
// Every non-big-leaguer still on his first contract, ranked the way scouting lists do.
export function prospectList(L) {
  return L.players.filter(p => p.tid >= 0 && p.lvl !== 'MLB' && p.age <= 25 && p.rk !== 0 && !p.il)
    .map(p => ({ p, v: shownPot(p) * 0.7 + p.ovr * 0.3 - Math.max(0, p.age - 22) * 0.8 })).sort((a, b) => b.v - a.v);
}
export function farmRanks(L) {
  const by = new Map(L.teams.map(t => [t.id, []]));
  for (const x of prospectList(L)) { const a = by.get(x.p.tid); if (a && a.length < 10) a.push(x.v); }
  const score = [...by].map(([tid, a]) => ({ tid, v: a.reduce((s, v, i) => s + Math.max(0, v - 55) * (1 - i * 0.06), 0) })).sort((a, b) => b.v - a.v);
  return new Map(score.map((x, i) => [x.tid, i + 1]));
}
// A drafted kid of the user's reaching the majors is a moment.
export function checkDebuts(L) {
  for (const p of L.players) {
    if (p.tid !== L.userTid || !p.gen || p.lvl !== 'MLB' || p.debutSeen) continue;
    p.debutSeen = 1;
    const own = p.draft?.tid === L.userTid;
    news(L, `${name(p)} makes his big-league debut for the ${T(L, p.tid).nick}.`, 'big', p.tid, p.id);
    pop(L, { k: 'debut', kick: 'Big-league debut', title: `${name(p)} gets the call`, pid: p.id,
      text: own ? `Your ${p.draft.y} pick (number ${p.draft.pk}) is in the majors. ${p.age} years old, ${Math.round(p.ovr)} overall, ceiling ${potText(p)}.` : `${p.age} years old, ${Math.round(p.ovr)} overall, ceiling ${potText(p)}.` });
    if (own) unlock(L, 'farm');
  }
}

// Keeps the league's overall talent level where it started, so a 75 means the same
// thing in year 20 as in year 1 (and league-wide stats stay realistic).
function normalizeTalent(L) {
  if (!L.norm) return;
  // first keep the mix of skills steady (power, contact, speed, stuff...), then the overall level
  const c0 = talentLevel(L);
  for (const grp of ['bat', 'pit']) for (const k in L.norm[grp].comp) {
    const d = clamp((L.norm[grp].comp[k] - c0[grp].comp[k]) * 0.8, -1.5, 1.5);
    if (Math.abs(d) < 0.15) continue;
    for (const p of L.players) if ((grp === 'pit') === !!p.isP) { const r = grp === 'pit' ? p.pit : p.bat; r[k] = clamp(r[k] + d, 20, 99); }
  }
  for (const p of L.players) { const o = calcOvr(p); p.pot = clamp(Math.round(p.pot + (o - p.ovr)), o, 99); p.ovr = o; }
  const cur = talentLevel(L);
  for (const grp of ['bat', 'pit']) {
    const c = cur[grp], n = L.norm[grp];
    const shift = clamp((n.med - c.med) * 0.8, -1.5, 1.5);
    const stretch = clamp((n.p95 - n.med) - (c.p95 - c.med), -1.5, 1.5);
    const peak = clamp((n.top - n.p95) - (c.top - c.p95), -3, 3);
    if (Math.abs(shift) < 0.2 && Math.abs(stretch) < 0.2 && Math.abs(peak) < 0.2) continue;
    const span = Math.max(4, c.p95 - c.med), span2 = Math.max(2, c.top - c.p95);
    for (const p of L.players) {
      if ((grp === 'pit') !== !!p.isP) continue;
      const d = (shift + stretch * clamp((p.ovr - c.med) / span, 0, 1) + peak * clamp((p.ovr - c.p95) / span2, 0, 1.4)) * 1.05;
      if (grp === 'bat') for (const k of ['con', 'eye', 'pow', 'hit']) p.bat[k] = clamp(p.bat[k] + d, 20, 99);
      else for (const k of ['stf', 'ctl', 'mov']) p.pit[k] = clamp(p.pit[k] + d, 20, 99);
      const o = calcOvr(p); p.pot = clamp(Math.round(p.pot + (o - p.ovr)), o, 99); p.ovr = o;
    }
  }
}
// ---------- user roster moves ----------
const fail = msg => ({ ok: false, msg }), okay = msg => ({ ok: true, msg });
export function callUp(L, pid) {
  const p = P(L, pid), t = T(L, p.tid);
  if (!healthy(p)) return fail(`${name(p)} is injured.`);
  if (!p.on40) {
    if (forty(L, t.id).length >= FORTY_MAX) return fail('Your 40-man roster is full. Remove someone from the 40-man first.');
    p.on40 = 1; if (p.con.sal < MIN_SALARY) p.con.sal = MIN_SALARY;
  }
  p.lvl = 'MLB'; p.il = 0; if (!p.debutY) p.debutY = L.season;
  tx(L, `${t.abbr} recalled ${name(p)} from ${t.aaa}.`, t.id);
  refreshUser(L); checkDebuts(L);
  return okay(`${name(p)} is on the active roster.`);
}
function waiverClaim(L, p) {
  // another club may claim a useful player who is out of options
  const pr = clamp(0.12 + (p.ovr - 68) * 0.06 + (p.pot - p.ovr) * 0.02 - Math.max(0, p.con.sal - 3) * 0.04, 0, 0.9);
  if (!L.rng.chance(pr)) return null;
  const cands = L.teams.filter(t => t.id !== p.tid && payroll(L, t.id) + p.con.sal <= t.budget).sort((a, b) => (a.w - a.l) - (b.w - b.l));
  return cands[L.rng.i(Math.min(8, cands.length))] || null;
}
export function sendDown(L, pid, confirm = false) {
  const p = P(L, pid), t = T(L, p.tid);
  if (p.lvl !== 'MLB') return fail('He is not on the active roster.');
  if (p.il) return fail('He is on the injured list.');
  if (p.svc >= 5 && p.on40) return fail(`${name(p)} has 5+ years of service and can refuse a minor-league assignment. Trade or release him instead.`);
  if (p.opt <= 0 && !p.optUsed) {
    if (!confirm) return { ok: false, needConfirm: true, msg: `${name(p)} is out of minor-league options. He must clear waivers first, and another team may claim him. Continue?` };
    const c = waiverClaim(L, p);
    if (c) {
      p.tid = c.id; p.lvl = 'MLB'; aiRosterUpkeep(L, c);
      tx(L, `${c.abbr} claimed ${name(p)} off waivers from ${t.abbr}.`, t.id); news(L, `${name(p)} was claimed off waivers by the ${c.name}.`, 'tx', t.id, p.id);
      refreshUser(L);
      return okay(`${name(p)} was claimed on waivers by the ${c.name}. He is gone.`);
    }
    p.on40 = 0; p.lvl = 'AAA';
    tx(L, `${t.abbr} outrighted ${name(p)} to ${t.aaa}.`, t.id); refreshUser(L);
    return okay(`${name(p)} cleared waivers and was sent to Triple-A (off the 40-man).`);
  }
  if (!p.optUsed) { p.opt--; p.optUsed = 1; }
  p.lvl = 'AAA';
  tx(L, `${t.abbr} optioned ${name(p)} to ${t.aaa}.`, t.id); refreshUser(L);
  return okay(`${name(p)} optioned to Triple-A. Options left after this year: ${p.opt}.`);
}
export function setLevel(L, pid, lvl) {
  const p = P(L, pid);
  if (p.lvl === 'MLB') return fail('Use Send Down for active players.');
  p.lvl = lvl; return okay(`${name(p)} assigned to ${lvl === 'AAA' ? 'Triple-A' : 'the lower minors'}.`);
}
export function add40(L, pid) {
  const p = P(L, pid);
  if (forty(L, p.tid).length >= FORTY_MAX) return fail('Your 40-man roster is full.');
  p.on40 = 1; if (p.con.sal < 0.4) p.con.sal = 0.4;
  return okay(`${name(p)} added to the 40-man roster.`);
}
export function remove40(L, pid, confirm = false) {
  const p = P(L, pid), t = T(L, p.tid);
  if (p.lvl === 'MLB' && !p.il) return fail('Send him down or release him first.');
  if (!confirm) return { ok: false, needConfirm: true, msg: `Designating ${name(p)} for assignment puts him on waivers. Another team may claim him. Continue?` };
  const c = waiverClaim(L, p);
  if (c) { p.tid = c.id; p.il = 0; if (p.lvl === 'MLB') p.lvl = 'AAA'; aiRosterUpkeep(L, c); tx(L, `${c.abbr} claimed ${name(p)} off waivers from ${t.abbr}.`, t.id); refreshUser(L); return okay(`${name(p)} was claimed by the ${c.name}.`); }
  p.on40 = 0; if (p.lvl === 'MLB') p.lvl = 'AAA'; p.il = 0;
  tx(L, `${t.abbr} outrighted ${name(p)}.`, t.id);
  return okay(`${name(p)} cleared waivers and stays in your system, off the 40-man.`);
}
export function releasePlayer(L, pid) {
  const p = P(L, pid), t = T(L, p.tid);
  if (p.on40 && p.con.sal > MIN_SALARY) {
    const left = L.phase === 'regular' ? clamp(1 - L.day / L.sched.length, 0, 1) : 1;
    const future = Math.max(0, p.con.exp - L.season);
    t.dead = (t.dead || 0) + p.con.sal * left; t.deadNext = (t.deadNext || 0) + p.con.sal * future * 0.5;
  }
  tx(L, `${t.abbr} released ${name(p)}.`, t.id);
  toFreeAgency(L, p); refreshUser(L);
  return okay(`${name(p)} has been released.`);
}
export function placeIL(L, pid) {
  const p = P(L, pid);
  if (healthy(p)) return fail('He is not injured.');
  if (p.lvl !== 'MLB') return fail('Only active-roster players go on the injured list.');
  p.il = p.inj.days > 55 ? 60 : p.isP ? 15 : 10;
  tx(L, `${T(L, p.tid).abbr} placed ${name(p)} on the ${p.il}-day injured list (${p.inj.name}).`, p.tid); refreshUser(L);
  return okay(`${name(p)} placed on the ${p.il}-day IL.${p.il === 60 ? ' That also frees his 40-man spot.' : ''}`);
}
export function activateIL(L, pid) {
  const p = P(L, pid);
  if (!healthy(p)) return fail(`${name(p)} is not healthy yet (${p.inj.days} days).`);
  if (p.il === 60 && forty(L, p.tid).length >= FORTY_MAX) return fail('Your 40-man is full. Clear a spot before activating him from the 60-day IL.');
  p.il = 0; tx(L, `${T(L, p.tid).abbr} activated ${name(p)} from the injured list.`, p.tid); refreshUser(L);
  return okay(`${name(p)} is back on the active roster.`);
}
export function refreshUser(L) {
  const t = T(L, L.userTid);
  const ids = new Set(active(L, t.id).filter(healthy).map(p => p.id));
  const bad = lu => !lu || lu.length !== 9 || lu.some(([id]) => !ids.has(id));
  if (L.opts.autoLineup || bad(t.lineup?.R) || bad(t.lineup?.L)) { if (active(L, t.id).filter(p => healthy(p) && (!p.isP || p.twoWay)).length >= 9) autoLineup(L, t); }
  if (L.opts.autoPitch || !t.rot || t.rot.some(id => !ids.has(id)) || !ids.has(t.roles?.cl)) autoPitching(L, t);
}

// ---------- free agents and contracts ----------
export function faAsk(L, p) {
  const rp = p.isP && p.role === 'RP';
  const a = p.age;
  const ageF = a <= 29 ? 1.05 : a <= 32 ? 1 : a <= 34 ? 0.85 : a <= 36 ? 0.7 : 0.5;
  const aav = Math.max(MIN_SALARY, Math.round(marketValue(p.ovr, rp) * ageF * (0.92 + seed01(p.id, L.season) * 0.2) * 10) / 10);
  let yrs = p.ovr >= 88 ? 8 : p.ovr >= 83 ? 5 : p.ovr >= 78 ? 3 : p.ovr >= 73 ? 2 : 1;
  if (a >= 36) yrs = 1; else if (a >= 33) yrs = Math.min(yrs, 2); else if (a >= 31) yrs = Math.min(yrs, 4); else if (a >= 29) yrs = Math.min(yrs, 6);
  return { aav, yrs, thr: 0.96 + seed01(p.id, L.season + 7) * 0.08 };
}
export function toFreeAgency(L, p) {
  if (p.tid >= 0) p.lastTid = p.tid;
  p.tid = -1; p.on40 = 0; p.il = 0; p.lvl = 'FA'; p.ask = faAsk(L, p); p.con = { sal: 0, exp: L.season }; p.bids = null; p.decide = 0;
}
export const freeAgents = L => L.players.filter(p => p.tid === -1);
const firstYear = L => L.phase === 'offseason' ? L.season + 1 : L.season;

// The club's own player: what he wants to sign an extension before reaching the market.
export function extensionAsk(L, p) {
  const a = faAsk(L, p);
  if (p.svc < 6) a.aav = Math.max(MIN_SALARY, Math.round(a.aav * (0.62 + 0.07 * Math.floor(p.svc)) * 10) / 10);
  else a.aav = Math.round(a.aav * 0.95 * 10) / 10;
  if (p.svc < 6) a.yrs = Math.max(a.yrs, Math.ceil(6 - p.svc) + 1);
  return a;
}
export function judgeOffer(L, p, ask, aav, yrs) {
  const t = T(L, L.userTid);
  let score = aav / ask.aav;
  if (yrs < ask.yrs) score -= 0.05 * (ask.yrs - yrs) * (p.age <= 31 ? 1 : 0.3);
  else if (yrs > ask.yrs) score += (p.age >= 30 ? 0.035 : 0.01) * (yrs - ask.yrs);
  score += (t.ownerMood - 50) * 0.0006 + (t.market - 3) * 0.008;
  if (yrs > 10 || yrs < 1) return { ok: false, msg: 'Contracts run 1 to 10 years.' };
  if (score >= ask.thr) return { ok: true };
  const gap = ask.thr - score;
  return { ok: false, msg: gap < 0.05 ? `${name(p)}'s agent says you are close. Add a little more.` : yrs < ask.yrs && p.age <= 31 ? `${name(p)} wants more years (around ${ask.yrs}).` : `${name(p)} wants more money (around $${ask.aav.toFixed(1)}M a year).` };
}
export function offerFA(L, pid, aav, yrs) {
  const p = P(L, pid), t = T(L, L.userTid);
  if (p.tid !== -1) return fail('He is no longer a free agent.');
  if (!(aav > 0) || !(yrs >= 1)) return fail('Enter a salary and a number of years.');
  yrs = Math.round(yrs);
  if (contested(L, p)) return placeBid(L, p, aav, yrs);
  const pay = payroll(L, t.id);
  if (pay + aav > t.budget + 0.01) return fail(`The owner says no: that would put payroll at $${(pay + aav).toFixed(1)}M, over your $${t.budget.toFixed(0)}M budget.`);
  if (forty(L, t.id).length >= FORTY_MAX) return fail('Your 40-man roster is full.');
  const j = judgeOffer(L, p, p.ask, aav, yrs);
  if (!j.ok) return j;
  signPlayer(L, p, t, aav, yrs);
  news(L, `${name(p)} signs with the ${t.name}: ${yrs} year${yrs > 1 ? 's' : ''}, $${(aav * yrs).toFixed(1)}M.`, 'sign', t.id, p.id);
  refreshUser(L);
  return okay(`${name(p)} signed! ${yrs} year${yrs > 1 ? 's' : ''} at $${aav.toFixed(1)}M per year.`);
}

// ---------- the winter auction ----------
// In free agency the good ones (72+) do not sign on the spot. Clubs put in offers, he
// sets a decision day, rivals can raise, and on that day he picks the best package:
// money first, then years, a winning club and a big market.
export const CONTESTED = 72;
export const contested = (L, p) => L.phase === 'offseason' && L.off?.stage === 'fa' && p.tid === -1 && p.ovr >= CONTESTED;
function appeal(L, t) {
  const last = t.hist.at(-1), pct = last ? last.w / Math.max(1, last.w + last.l) : 0.5;
  return (t.market - 3) * 0.008 + (pct - 0.5) * 0.12 + (last?.po ? 0.01 : 0) + (t.id === L.userTid ? (t.ownerMood - 50) * 0.0006 : 0);
}
const yrsPart = (p, yrs) => { const a = p.ask; return yrs < a.yrs ? -0.05 * (a.yrs - yrs) * (p.age <= 31 ? 1 : 0.3) : yrs > a.yrs ? (p.age >= 30 ? 0.035 : 0.01) * (yrs - a.yrs) : 0; };
export const bidScore = (L, p, t, aav, yrs) => aav / p.ask.aav + yrsPart(p, yrs) + appeal(L, t);
const r1 = x => Math.round(x * 10) / 10;
export function topBid(L, p) {
  let best = null;
  for (const b of p.bids || []) { const s = bidScore(L, p, T(L, b.tid), b.aav, b.yrs); if (!best || s > best.s) best = { ...b, s }; }
  return best;
}
// What the UI shows for one free agent's market.
export function bidState(L, p) {
  if (!p.bids?.length) return null;
  const lead = topBid(L, p), mine = p.bids.find(b => b.tid === L.userTid) || null;
  return { lead, mine, leading: lead?.tid === L.userTid, n: p.bids.length, days: Math.max(0, p.decide - L.off.day) };
}
// money the user already has out in open offers (so he cannot promise it twice)
export const userCommitted = (L, except = 0) => freeAgents(L).filter(p => p.id !== except).reduce((s, p) => s + (p.bids?.find(b => b.tid === L.userTid)?.aav || 0), 0);
const userBidCount = L => freeAgents(L).filter(p => p.bids?.some(b => b.tid === L.userTid)).length;
function setBid(L, p, tid, aav, yrs) {
  p.bids ??= [];
  const b = p.bids.find(x => x.tid === tid);
  if (b) { b.aav = aav; b.yrs = yrs; } else p.bids.push({ tid, aav, yrs });
  if (!p.decide) p.decide = L.off.day + (p.ovr >= 84 ? 5 : 3);
}
function placeBid(L, p, aav, yrs) {
  const t = T(L, L.userTid);
  aav = r1(aav);
  const mine = p.bids?.find(b => b.tid === t.id);
  const tied = userCommitted(L, p.id), pay = payroll(L, t.id);
  if (pay + tied + aav > t.budget + 0.01) return fail(`The owner says no: payroll $${pay.toFixed(1)}M${tied ? ` plus $${tied.toFixed(1)}M in your other open offers` : ''} plus this would pass your $${t.budget.toFixed(0)}M budget.`);
  if (forty(L, t.id).length + userBidCount(L) - (mine ? 1 : 0) >= FORTY_MAX) return fail('Your 40-man roster has no room for him (counting your other open offers).');
  if (yrs > 10) return fail('Contracts run 1 to 10 years.');
  if (bidScore(L, p, t, aav, yrs) < p.ask.thr - 0.1) return fail(`${name(p)}'s agent says that is not a serious offer. He is asking about $${p.ask.aav.toFixed(1)}M a year for ${p.ask.yrs} year${p.ask.yrs > 1 ? 's' : ''}.`);
  if (mine && bidScore(L, p, t, aav, yrs) <= bidScore(L, p, t, mine.aav, mine.yrs)) return fail('A new offer has to be better than your last one.');
  const first = !p.bids?.length;
  setBid(L, p, t.id, aav, yrs);
  p.ulead = 0;
  if (first || p.bids.length < 2) stirMarket(L, p);
  const st = bidState(L, p);
  p.ulead = st.leading ? 1 : 0;
  const when = `He decides in ${st.days} day${st.days === 1 ? '' : 's'}.`;
  return okay(st.leading ? `Offer in. You have the best offer for ${name(p)} right now. ${when}` : `Offer in, but the ${T(L, st.lead.tid).name} have a better one ($${st.lead.aav.toFixed(1)}M × ${st.lead.yrs}). ${when}`);
}
// Clubs with room that would actually use him.
function suitors(L, p) {
  return L.teams.filter(t => t.id !== L.userTid && !freeAgents(L).some(q => q.bids?.some(b => b.tid === t.id)) && aiRoom(L, t) >= p.ask.aav * 0.95);
}
const aiRoom = (L, t) => t.budget * 0.98 - payrollNext(L, t.id);
// An AI club's offer: around the asking price. When it is chasing (a raise after being
// beaten), it goes just past the best offer if it can afford to.
function aiBid(L, p, t, chase = false) {
  const room = aiRoom(L, t), cap = Math.min(room, p.ask.aav * 1.3);
  const contend = teamMode(L, t) === 'contend' ? 1.03 : 1;
  let aav = p.ask.aav * L.rng.range(0.94, 1.05) * contend;
  const lead = topBid(L, p);
  if (chase && lead && lead.tid !== t.id) {
    const need = (lead.s + 0.006 - yrsPart(p, p.ask.yrs) - appeal(L, t)) * p.ask.aav;
    if (need > cap) return false;
    aav = Math.max(aav, need * L.rng.range(1, 1.035));
  }
  aav = r1(Math.min(aav, cap));
  if (aav < p.ask.aav * 0.9) return false;
  setBid(L, p, t.id, aav, p.ask.yrs);
  return true;
}
function stirMarket(L, p) {
  const n = p.ovr >= 85 ? 2 + L.rng.i(2) : 1 + L.rng.i(2);
  const cands = L.rng.shuffle(suitors(L, p));
  let made = 0;
  for (const t of cands) { if (made >= n) break; if (L.rng.chance(0.75) && aiBid(L, p, t)) made++; }
}
// Each winter day: rivals answer when the user is in front, then decisions are made.
function biddingDay(L, force = false) {
  for (const p of freeAgents(L)) {
    if (!p.bids?.length) continue;
    const st = bidState(L, p);
    if (!force && st.mine && st.leading && p.decide > L.off.day && (p.raises || 0) < 2) {
      const rivals = p.bids.filter(b => b.tid !== L.userTid).map(b => T(L, b.tid));
      const fresh = suitors(L, p).slice(0, 2);
      for (const t of L.rng.shuffle([...rivals, ...fresh])) {
        if (!L.rng.chance(0.4)) continue;
        if (aiBid(L, p, t, true)) { p.raises = (p.raises || 0) + 1; p.decide = Math.max(p.decide, L.off.day + 2); break; }
      }
    }
    const now = bidState(L, p);
    if (now.mine) {
      if (p.ulead && !now.leading) {
        const lt = T(L, now.lead.tid);
        inbox(L, `Outbid: the ${lt.name} offered ${name(p)} $${now.lead.aav.toFixed(1)}M a year for ${now.lead.yrs} years. He decides in ${now.days} day${now.days === 1 ? '' : 's'}.`, 'bid', p.id);
        pop(L, { k: 'outbid', kick: 'Free agency', title: `Outbid for ${name(p)}`, pid: p.id, tid: lt.id, stop: true,
          text: `The ${lt.name} offered $${now.lead.aav.toFixed(1)}M a year for ${now.lead.yrs} years. Yours: $${now.mine.aav.toFixed(1)}M for ${now.mine.yrs}. He decides in ${now.days} day${now.days === 1 ? '' : 's'}.`,
          acts: [['Raise my offer', 'fa-offer', { id: p.id }]] });
      }
      p.ulead = now.leading ? 1 : 0;
    }
    if (force || p.decide <= L.off.day) decide(L, p);
  }
}
function decide(L, p) {
  const ranked = p.bids.map(b => ({ ...b, s: bidScore(L, p, T(L, b.tid), b.aav, b.yrs) + L.rng.range(-0.008, 0.008) })).sort((a, b) => b.s - a.s);
  const userBid = p.bids.find(b => b.tid === L.userTid), n = p.bids.length;
  p.bids = null; p.decide = 0; p.raises = 0; p.ulead = 0;
  let won = null;
  for (const b of ranked) {
    const t = T(L, b.tid);
    if (t.id === L.userTid) { if (payroll(L, t.id) + b.aav <= t.budget + 0.01 && forty(L, t.id).length < FORTY_MAX) { won = b; break; } }
    else if (aiRoom(L, t) >= b.aav * 0.9) { won = b; break; }
  }
  if (!won) { if (userBid) inbox(L, `${name(p)} could not get a deal done and stays on the market.`, 'bid', p.id); return; }
  const t = T(L, won.tid);
  if (t.id !== L.userTid && forty(L, t.id).length >= FORTY_MAX) { const d = forty(L, t.id).sort((a, b) => a.ovr + (a.pot - a.ovr) * 0.6 - (b.ovr + (b.pot - b.ovr) * 0.6))[0]; d.on40 = 0; if (d.lvl === 'MLB') d.lvl = 'AAA'; }
  signPlayer(L, p, t, won.aav, won.yrs);
  if (p.ovr >= 76 || userBid) news(L, `${name(p)} ${n > 1 ? `picks the ${t.name} over ${n - 1} other club${n === 2 ? '' : 's'}` : `signs with the ${t.name}`}: ${won.yrs} year${won.yrs > 1 ? 's' : ''}, $${(won.aav * won.yrs).toFixed(0)}M.`, 'sign', t.id, p.id);
  if (!userBid) return;
  if (t.id === L.userTid) {
    refreshUser(L);
    inbox(L, `${name(p)} signs with you: ${won.yrs} years at $${won.aav.toFixed(1)}M a year.`, 'big', p.id);
    pop(L, { k: 'fa-won', kick: 'Free agency', title: `${name(p)} is yours`, pid: p.id, tid: t.id, stop: true,
      text: `${n > 1 ? `He picked you over ${n - 1} other club${n === 2 ? '' : 's'}` : 'Nobody else came close'}: ${won.yrs} year${won.yrs > 1 ? 's' : ''} at $${won.aav.toFixed(1)}M a year ($${(won.aav * won.yrs).toFixed(0)}M in all).` });
    if (p.ovr >= 85) unlock(L, 'bigfish');
  } else {
    inbox(L, `${name(p)} signed with the ${t.name}: ${won.yrs} years at $${won.aav.toFixed(1)}M a year. Your offer was $${userBid.aav.toFixed(1)}M for ${userBid.yrs}.`, 'bid', p.id);
    pop(L, { k: 'fa-lost', kick: 'Free agency', title: `${name(p)} signs with the ${t.nick}`, pid: p.id, tid: t.id, stop: true,
      text: `Their deal: $${won.aav.toFixed(1)}M a year for ${won.yrs} year${won.yrs > 1 ? 's' : ''}. Yours was $${userBid.aav.toFixed(1)}M for ${userBid.yrs}. ${userBid.aav >= won.aav ? 'You offered as much money; years, winning and market tipped it.' : ''}` });
  }
}
function signPlayer(L, p, t, aav, yrs) {
  p.tid = t.id; p.on40 = 1; p.lvl = L.phase === 'regular' ? 'AAA' : 'MLB'; p.ask = null; p.bids = null; p.decide = 0;
  p.con = { sal: Math.round(aav * 10) / 10, exp: firstYear(L) + yrs - 1 };
  if (p.svc < 6 && p.real) p.svc = Math.max(p.svc, 6);
  tx(L, `${t.abbr} signed free agent ${name(p)} (${yrs}y, $${aav.toFixed(1)}M/yr).`, t.id);
}
export function offerExtension(L, pid, aav, yrs) {
  const p = P(L, pid), t = T(L, p.tid);
  const ask = extensionAsk(L, p);
  const cur = L.phase === 'offseason' && p.con.exp <= L.season ? 0 : 0;
  const nextPay = payrollNext(L, t.id) - (p.con.exp > L.season ? p.con.sal : 0) + aav;
  if (nextPay > t.budget * 1.03) return fail(`The owner will not approve it: next year's commitments would reach $${nextPay.toFixed(0)}M.`);
  const j = judgeOffer(L, p, ask, aav, yrs);
  if (!j.ok) return j;
  if (L.phase === 'offseason') { p.con = { sal: Math.round(aav * 10) / 10, exp: L.season + yrs }; p.expiring = 0; }
  else p.con.next = { sal: Math.round(aav * 10) / 10, exp: L.season + yrs };
  if (p.svc < 6) p.locked = 1;
  tx(L, `${t.abbr} extended ${name(p)} (${yrs}y, $${aav.toFixed(1)}M/yr).`, t.id);
  news(L, `${name(p)} agrees to a ${yrs}-year extension with the ${t.name}.`, 'sign', t.id, p.id);
  return okay(`${name(p)} signed a ${yrs}-year extension.`);
}
export function payrollNext(L, tid) {
  let s = 0;
  for (const p of L.players) if (p.tid === tid && p.on40) s += p.con.next ? p.con.next.sal : p.con.exp > L.season ? p.con.sal : p.svc < 6 ? arbSalary(p, 1) : 0;
  return s + (T(L, tid).deadNext || 0);
}
function arbSalary(p, addSvc = 0) {
  const s = p.svc + addSvc;
  if (s < 3) return p.on40 ? MIN_SALARY : p.con.sal;
  const mv = marketValue(p.ovr, p.isP && p.role === 'RP');
  return Math.max(MIN_SALARY, Math.round(Math.max(mv * [0.28, 0.45, 0.62][Math.min(2, Math.floor(s) - 3)], p.con.sal * 1.08) * 10) / 10);
}
export function luxuryTax(L, t, pay = payroll(L, t.id)) {
  const over = pay - L.cbt;
  if (over <= 0) return 0;
  const rates = t.taxYears > 0 ? CBT.repeat : CBT.rates;
  let bill = 0;
  for (let i = 0; i < CBT.tiers.length; i++) {
    const lo = CBT.tiers[i], hi = CBT.tiers[i + 1] ?? Infinity;
    if (over > lo) bill += (Math.min(over, hi) - lo) * rates[i];
  }
  return bill;
}

// ---------- draft ----------
const POS_W = [['C', 9], ['1B', 7], ['2B', 9], ['3B', 10], ['SS', 16], ['LF', 8], ['CF', 14], ['RF', 10]];
function genMix(rng, role, throws, stf) {
  const fb = 91 + (stf - 50) * 0.12 + rng.n() * 1.6 + (role === 'RP' ? 1.2 : 0) - (throws === 'L' ? 0.8 : 0);
  const second = rng.chance(0.6) ? 'SL' : 'CU';
  const mix = [[rng.chance(0.72) ? 'FF' : 'SI', 52, +fb.toFixed(1)], [second, 28, +(fb - (second === 'SL' ? 8.5 : 14)).toFixed(1)], ['CH', 20, +(fb - 8).toFixed(1)]];
  if (role === 'SP' && rng.chance(0.5)) mix.push([second === 'SL' ? 'CU' : 'FC', 10, +(fb - (second === 'SL' ? 14 : 5)).toFixed(1)]);
  return mix;
}
export function genProspect(L, pick, total) {
  const rng = L.rng, nm = randomName(rng);
  const age = rng.chance(0.36) ? 18 : rng.chance(0.75) ? 21 : 22;
  let pot = clamp(Math.round(78 - (pick / total) * 23 + rng.n() * 6.5 + (pick < 10 ? 4 : 0)), 50, 97);
  const gap = age === 18 ? rng.range(20, 33) : rng.range(11, 23);
  const target = clamp(Math.round(pot - gap), 36, 72);
  const isP = rng.chance(0.48);
  const p = {
    id: L.nextId++, tid: -2, first: nm.first, last: nm.last, country: nm.country, num: '', age, born: `${L.season - age}-0${1 + rng.i(9)}-1${rng.i(9)}`,
    ht: `${rng.chance(0.75) ? 6 : 5}' ${rng.i(12)}"`, wt: 175 + rng.i(55), lvl: 'LOW', on40: 0, gen: 1, face: rng.i(1e6),
    svc: 0, opt: 3, con: { sal: 0.05, exp: L.season }, draft: { y: L.season, pk: pick + 1 },
  };
  const g = (m, sd) => clamp(m + rng.n() * sd, 20, 95);
  if (isP) {
    p.isP = 1; p.throws = rng.chance(0.28) ? 'L' : 'R'; p.bats = p.throws === 'L' ? 'L' : rng.chance(0.9) ? 'R' : 'L';
    p.role = rng.chance(0.62) ? 'SP' : 'RP'; p.pos = p.role;
    p.pit = { stf: g(40, 9), ctl: g(38, 9), mov: g(40, 8), sta: p.role === 'SP' ? g(60, 8) : g(32, 5), gb: Math.round(g(46, 6)) };
    p.pit.mix = genMix(rng, p.role, p.throws, p.pit.stf + 15); p.pit.vel = Math.max(...p.pit.mix.map(m => m[2]));
    p.bat = { con: 22, eye: 22, pow: 20, hit: 28, spd: 35, def: 40, arm: 55, gb: 50 };
    for (let i = 0; i < 14; i++) { const d = (target - calcOvr(p)) * 0.8; if (Math.abs(d) < 0.4) break; for (const k of ['stf', 'ctl', 'mov']) p.pit[k] = clamp(p.pit[k] + d, 20, 99); }
  } else {
    p.pos = rng.weighted(POS_W, x => x[1])[0]; p.elig = [p.pos];
    p.bats = rng.chance(0.55) ? 'R' : rng.chance(0.7) ? 'L' : 'S'; p.throws = p.bats === 'L' && ['1B', 'LF', 'CF', 'RF'].includes(p.pos) && rng.chance(0.6) ? 'L' : 'R';
    const fast = ['CF', 'SS', '2B'].includes(p.pos) ? 8 : p.pos === 'C' || p.pos === '1B' ? -12 : 0;
    p.bat = { con: g(40, 10), eye: g(38, 10), pow: g(38, 12), hit: g(42, 9), spd: g(52 + fast, 12), def: g(48, 10), arm: g(50, 10), gb: Math.round(g(45, 6)) };
    for (let i = 0; i < 14; i++) { const d = (target - calcOvr(p)) * 0.8; if (Math.abs(d) < 0.4) break; for (const k of ['con', 'eye', 'pow', 'hit']) p.bat[k] = clamp(p.bat[k] + d, 20, 99); }
  }
  if (rng.chance(0.03)) pot = Math.min(97, pot + 8);       // the rare phenom
  p.ovr = calcOvr(p); p.pot = Math.max(pot, p.ovr + 1);
  p.fz = Math.round(rng.n() * 4.5);                  // scouting error on his ceiling
  p.fw = age <= 18 ? 7 : 5;                          // and how unsure the scouts are
  initPlayer(p);
  return p;
}
export const shownPot = p => fogW(p) > 0 && p.fz ? clamp(Math.round(p.pot + p.fz), Math.round(p.ovr), 99) : p.pot;

export function startDraft(L) {
  const total = DRAFT_ROUNDS * 30;
  const cls = [];
  for (let i = 0; i < total + 40; i++) { const p = genProspect(L, Math.min(i, total), total); cls.push(p); L.players.push(p); L.pm.set(p.id, p); }
  const pct = t => (t.w + t.l) ? t.w / (t.w + t.l) : 0.5;
  const order = [...L.teams].sort((a, b) => pct(a) - pct(b) || b.rank0 - a.rank0).map(t => t.id);
  L.draft = { y: L.season, order, pick: 0, total, picks: [], done: false };
  news(L, `The ${L.season} amateur draft is here. ${T(L, order[0]).name} hold the first pick.`, 'big');
  if (!L.opts.autoDraft) inbox(L, `Draft day! You pick ${order.indexOf(L.userTid) + 1}${['st', 'nd', 'rd'][order.indexOf(L.userTid)] || 'th'} in each of ${DRAFT_ROUNDS} rounds. Open the Draft page.`, 'draft');
}
export const draftPool = L => L.players.filter(p => p.tid === -2);
export const onClock = L => L.draft && !L.draft.done ? L.draft.order[L.draft.pick % 30] : 0;
function doPick(L, p, tid) {
  const d = L.draft;
  p.tid = tid; p.lvl = 'LOW'; p.draft = { y: d.y, pk: d.pick + 1, rd: Math.floor(d.pick / 30) + 1, tid };
  d.picks.push({ pk: d.pick + 1, tid, pid: p.id });
  if (d.pick < 30) news(L, `Draft pick ${d.pick + 1}: ${T(L, tid).abbr} select ${p.pos} ${name(p)} (${p.age}).`, 'draft', tid, p.id);
  d.pick++;
  if (d.pick >= d.total) finishDraft(L);
}
function aiDraftChoice(L) {
  let best = null, bv = -1;
  for (const p of L.players) if (p.tid === -2) { const v = shownPot(p) * 0.72 + p.ovr * 0.28 + L.rng.n() * 2.5; if (v > bv) { bv = v; best = p; } }
  return best;
}
export function draftUserPick(L, pid) {
  if (onClock(L) !== L.userTid) return fail('You are not on the clock.');
  const p = P(L, pid); if (!p || p.tid !== -2) return fail('Not available.');
  doPick(L, p, L.userTid);
  return okay(`You selected ${name(p)}.`);
}
// AI clubs pick until it is the user's turn (or the draft ends). Returns the picks made.
export function draftAdvance(L, autoUser = false) {
  const made = [];
  while (L.draft && !L.draft.done) {
    const tid = onClock(L);
    if (tid === L.userTid && !autoUser) break;
    const p = aiDraftChoice(L); if (!p) { finishDraft(L); break; }
    made.push({ pk: L.draft.pick + 1, tid, pid: p.id }); doPick(L, p, tid);
  }
  return made;
}
function finishDraft(L) {
  L.draft.done = true;
  L.players = L.players.filter(p => p.tid !== -2);
  L.pm = new Map(L.players.map(p => [p.id, p]));
  const mine = L.draft.picks.filter(x => x.tid === L.userTid).map(x => name(P(L, x.pid)));
  inbox(L, `Draft complete. Your class: ${mine.join(', ')}. They report to the lower minors.`, 'draft');
  const g = draftGrade(L, L.userTid);
  L.draft.grade = { grade: g.grade, avg: Math.round(g.avg * 10) / 10 };
  const best = g.picks.sort((a, b) => b.d - a.d)[0];
  pop(L, { k: 'draft', kick: `${L.draft.y} draft class`, title: `Your class grades out: ${g.grade}`, pid: best?.p.id,
    text: `${g.picks.length} picks. ${best ? `The steal: ${name(best.p)} at number ${best.pk}, projected ${potText(best.p)}.` : ''} Grades are your scouts' read today; kids change.`, acts: [['Prospects', 'go', { v: 'prospects' }]] });
}
// How a club's picks compare with what that slot usually brings (the generator's own curve).
export function draftGrade(L, tid) {
  const d = L.draft, picks = d.picks.filter(x => x.tid === tid).map(x => ({ pk: x.pk, p: P(L, x.pid) })).filter(x => x.p);
  for (const x of picks) x.d = shownPot(x.p) - (78 - ((x.pk - 1) / d.total) * 23 + (x.pk <= 10 ? 4 : 0));
  const avg = picks.length ? picks.reduce((s, x) => s + x.d, 0) / picks.length : 0;
  const grade = avg >= 4 ? 'A+' : avg >= 2.5 ? 'A' : avg >= 1.2 ? 'B+' : avg >= 0 ? 'B' : avg >= -1.5 ? 'C+' : avg >= -3 ? 'C' : 'D';
  return { grade, avg, picks };
}

// ---------- playoffs ----------
const HOME = { 3: [1, 1, 1], 5: [1, 1, 0, 0, 1], 7: [1, 1, 0, 0, 0, 1, 1] };
const ROUND_NAME = ['Wild Card Series', 'Division Series', 'Championship Series', 'World Series'];
export function startPlayoffs(L) {
  const seeds = { AL: playoffField(L, 'AL').map(t => t.id), NL: playoffField(L, 'NL').map(t => t.id) };
  L.po = { round: 0, seeds, series: [], champ: 0, rest: 1, log: [] }; L.poDay = 0;
  for (const t of L.teams) t.po = 0;
  for (const lg of ['AL', 'NL']) for (const id of seeds[lg]) T(L, id).po = 1;
  for (const lg of ['AL', 'NL']) {
    const s = seeds[lg];
    L.po.series.push(mkSeries(lg, 0, s[2], s[5], 3), mkSeries(lg, 0, s[3], s[4], 3));
  }
  L.phase = 'playoffs';
  news(L, `The regular season is over. Playoffs: ${['AL', 'NL'].map(lg => `${lg} ${seeds[lg].map(id => T(L, id).abbr).join(', ')}`).join(' | ')}.`, 'big');
  const u = T(L, L.userTid);
  inbox(L, u.po ? 'You made the playoffs! Good luck in October.' : `Season over: ${u.w}-${u.l}. You missed the playoffs.`, 'big');
}
const mkSeries = (lg, round, a, b, n) => ({ lg, round, a, b, wa: 0, wb: 0, n, g: [] });
export const liveSeries = L => L.po ? L.po.series.filter(s => s.round === L.po.round && s.wa < (s.n + 1) / 2 && s.wb < (s.n + 1) / 2) : [];
export function seriesHome(s) { return HOME[s.n][s.g.length] ? [s.a, s.b] : [s.b, s.a]; }
export function userSeries(L) { return liveSeries(L).find(s => s.a === L.userTid || s.b === L.userTid) || null; }
export function playoffGameResult(L, s, g, hId) {
  applyGame(L, g, { lvl: 'MLB', hId, aId: hId === s.a ? s.b : s.a, playoff: true });
  const homeWon = g.winner === 1, winner = homeWon ? hId : (hId === s.a ? s.b : s.a);
  winner === s.a ? s.wa++ : s.wb++;
  s.g.push({ h: hId, hs: g.score[1], as: g.score[0] });
  const ht = T(L, hId); ht.gate += ht.park.cap * 95 / 1e6;
  if (s.a === L.userTid || s.b === L.userTid) L.lastBox = slimBox(L, g, { h: hId, a: hId === s.a ? s.b : s.a });
  const need = (s.n + 1) / 2;
  if (s.wa >= need || s.wb >= need) {
    const w = s.wa >= need ? s.a : s.b, l = w === s.a ? s.b : s.a;
    T(L, w).po = s.round + 2; s.winner = w;
    news(L, `${T(L, w).name} win the ${s.round === 3 ? 'World Series' : s.lg + ' ' + ROUND_NAME[s.round]} over the ${T(L, l).nick}, ${Math.max(s.wa, s.wb)}-${Math.min(s.wa, s.wb)}.`, 'big', w);
  }
}
export function playoffDay(L, skipUser = false) {
  const po = L.po;
  if (po.rest > 0) { po.rest--; restDay(L); return; }
  for (const t of L.teams) if (t.po) aiRosterUpkeepSafe(L, t);
  for (const s of liveSeries(L)) {
    if (s.played === L.poDay) continue;
    const [h, a] = seriesHome(s);
    const g = makeGame(L, h, a, { playoff: true });
    g.play(); playoffGameResult(L, s, g, h);
    T(L, h).rotI++; T(L, a).rotI++;
  }
  restDay(L);
  if (!liveSeries(L).length) nextRound(L);
}
function aiRosterUpkeepSafe(L, t) { if (t.id !== L.userTid || L.opts.autoRoster) aiRosterUpkeep(L, t); else refreshUser(L); }
function restDay(L) {
  for (const p of L.players) { if (p.fat > 0) p.fat = Math.max(0, p.fat - 20); if (p.inj) { p.inj.days--; if (p.inj.days <= 0) p.inj = null; } }
  L.poDay = (L.poDay || 0) + 1; saveSeed(L);
}
function nextRound(L) {
  const po = L.po, done = po.series.filter(s => s.round === po.round);
  if (po.round === 3) {
    po.champ = done[0].winner; const c = T(L, po.champ);
    c.titles = (c.titles || 0) + 1;
    news(L, `${c.name} are the ${L.season} World Series champions!`, 'big', c.id);
    startOffseason(L);
    return;
  }
  po.round++; po.rest = 1;
  if (po.round === 1) for (const lg of ['AL', 'NL']) {
    const s = po.seeds[lg], w = done.filter(x => x.lg === lg);
    po.series.push(mkSeries(lg, 1, s[0], w[1].winner, 5), mkSeries(lg, 1, s[1], w[0].winner, 5));
  } else if (po.round === 2) for (const lg of ['AL', 'NL']) {
    const w = done.filter(x => x.lg === lg).map(x => x.winner).sort((x, y) => po.seeds[lg].indexOf(x) - po.seeds[lg].indexOf(y));
    po.series.push(mkSeries(lg, 2, w[0], w[1], 7));
  } else {
    const al = done.find(x => x.lg === 'AL').winner, nl = done.find(x => x.lg === 'NL').winner;
    const [a, b] = T(L, al).w >= T(L, nl).w ? [al, nl] : [nl, al];
    po.series.push(mkSeries('WS', 3, a, b, 7));
  }
}

// ---------- season end ----------
function pickAwards(L) {
  const out = {};
  const mlb = L.players.filter(p => p.tid >= 0 && (p.st.b.PA > 0 || p.st.p?.O > 0));
  for (const lg of ['AL', 'NL']) {
    const inLg = mlb.filter(p => T(L, p.tid).lg === lg);
    const top = (arr, f) => arr.reduce((b, p) => (!b || f(p) > f(b) ? p : b), null);
    const mvp = top(inLg, p => war(p) + (T(L, p.tid).w / L.games - 0.5) * 2);
    const cy = top(inLg.filter(p => p.isP), p => pitWAR(p));
    const roy = top(inLg.filter(p => p.rk), p => war(p));
    out[lg] = { mvp: mvp?.id, cy: cy?.id, roy: roy?.id };
    for (const [k, p] of [['MVP', mvp], ['Cy Young', cy], ['Rookie of the Year', roy]]) if (p) {
      (p.awards ??= []).push(`${L.season} ${lg} ${k}`);
      news(L, `${lg} ${k}: ${name(p)} (${T(L, p.tid).abbr}).`, 'award', p.tid, p.id);
      if (p.tid === L.userTid && p.gen && p.draft?.tid === L.userTid) unlock(L, 'homegrown');
    }
  }
  return out;
}

export function startOffseason(L) {
  ensureState(L);
  const days = L.sched.length;
  const awards = pickAwards(L);
  const champ = L.po?.champ || 0;
  // the owner's verdict uses the same running number he showed all season
  ownerSeasonEnd(L, champ);
  recordSeason(L);
  clubRecords(L);
  // books
  for (const t of L.teams) {
    const pay = payroll(L, t.id), tax = luxuryTax(L, t, pay);
    t.taxYears = tax > 0 ? (t.taxYears || 0) + 1 : 0;
    const ops = 55 + t.market * 14 + 12;
    const revenue = t.rev + t.gate, profit = revenue - pay - tax - ops;
    t.cash += profit;
    (t.fin ??= []).push({ y: L.season, rev: revenue, gate: t.gate, pay, tax, ops, profit, att: t.att });
    t.budget0 = (t.budget0 || t.budget) * 1.02;
    const base = t.budget - (t.bump || 0); t.bump = 0;     // deadline money was for one season
    t.budget = clamp(Math.round(base * 0.72 + t.budget0 * 0.28 + clamp((t.w / L.games - 0.5) * 45, -6, 7) + (t.po ? 3 : 0) + (t.id === champ ? 6 : 0) - (t.id === L.userTid ? tax * 0.5 : 0)), 70, 450);
    t.hist.push({ y: L.season, w: t.w, l: t.l, po: t.po || 0, champ: t.id === champ ? 1 : 0, pay: Math.round(pay) });
    t.dead = t.deadNext || 0; t.deadNext = 0;
  }
  L.hist.push({ y: L.season, champ, ru: L.po ? (() => { const ws = L.po.series.find(s => s.round === 3); return ws ? (ws.winner === ws.a ? ws.b : ws.a) : 0; })() : 0, awards });
  const ut = T(L, L.userTid);
  if (!L.fired) {
    inbox(L, `Owner's verdict on ${L.season}: ${ut.w}-${ut.l} against a goal of "${ut.goal}". Confidence in you is now ${ut.ownerMood}%. Next year's payroll budget: $${ut.budget}M.`, 'big');
    if (ut.ownerMood <= 8 && L.hist.length >= 2) fire(L, `${ut.w}-${ut.l} against a goal of "${ut.goal}".`);
    else pop(L, { k: 'owner', kick: `The owner's verdict on ${L.season}`, title: ut.ownerMood >= 70 ? 'Great work' : ut.ownerMood >= 45 ? 'A fair season' : ut.ownerMood >= 25 ? 'Not good enough' : 'Last chance', tid: ut.id,
      text: `${ut.w}-${ut.l} against a goal of "${ut.goal}". Confidence in you: ${ut.ownerMood}%. Next year's payroll budget: $${ut.budget}M.` });
  }
  // stat lines into career history, service time, retirements
  const keep = [], retiring = [];
  for (const p of L.players) {
    if (p.tid === -2) continue;
    const tm = p.tid >= 0 ? T(L, p.tid).abbr : 'FA';
    if (p.st.b.PA > 0 && (!p.isP || p.twoWay)) (p.isP ? (p.histB ??= []) : p.hist).push({ y: L.season, lv: 'MLB', tm, ...strip(p.st.b), W: +batWAR(p).toFixed(1) });
    else if (!p.isP && p.sm?.b?.PA > 0) p.hist.push({ y: L.season, lv: p.lvl === 'LOW' ? 'AA' : 'AAA', tm, ...strip(p.sm.b) });
    if (p.isP && p.st.p?.BF > 0) p.hist.push({ y: L.season, lv: 'MLB', tm, ...strip(p.st.p), WAR: +pitWAR(p).toFixed(1) });
    else if (p.isP && p.sm?.p?.BF > 0) p.hist.push({ y: L.season, lv: 'AAA', tm, ...strip(p.sm.p) });
    if (p.hist.length > 24) p.hist.shift();
    p.svc = Math.round((p.svc + Math.min(1, (p.svcDays || 0) / (days * 0.92))) * 10) / 10; p.svcDays = 0;
    p.age++;
    const retire = p.age >= 42 || (p.age >= 35 && p.ovr < 70 && L.rng.chance(0.6)) || (p.age >= 37 && p.ovr < 76 && L.rng.chance(0.5)) || (p.tid === -1 && p.age >= 33 && p.ovr < 72)
      || (p.lvl === 'LOW' && p.age >= 25 && p.ovr < 58) || (p.lvl === 'LOW' && p.age >= 23 && p.pot < 63 && !p.on40) || (p.lvl !== 'MLB' && !p.on40 && p.age >= 30 && p.ovr < 62) || (p.tid === -1 && p.ovr < 60);
    if (retire) { if (p.ovr >= 78 || (p.awards?.length)) news(L, `${name(p)} retires at ${p.age}.`, 'info', p.tid, p.id); retiring.push(p); continue; }
    keep.push(p);
  }
  hofWinter(L, retiring);
  L.players = keep; L.pm = new Map(keep.map(p => [p.id, p]));
  developAll(L, 0.36, true);
  normalizeTalent(L);
  // contracts
  for (const p of L.players) {
    if (p.tid < 0) { if (p.tid === -1) p.ask = faAsk(L, p); continue; }
    if (p.con.next) { p.con = p.con.next; continue; }
    if (p.con.exp > L.season) continue;
    if (!p.on40) { p.con = { sal: p.con.sal, exp: L.season + 1 }; continue; }
    if (p.svc < 6) { p.con = { sal: arbSalary(p), exp: L.season + 1 }; continue; }
    p.expiring = 1;
  }
  // AI clubs settle their own expiring players now; the user gets a window first
  for (const t of L.teams) {
    if (t.id === L.userTid) continue;
    for (const p of org(L, t.id).filter(x => x.expiring)) {
      p.expiring = 0;
      const ask = faAsk(L, p);
      if (p.ovr >= 72 && payrollNext(L, t.id) + ask.aav < t.budget * 0.97 && L.rng.chance(p.age <= 31 ? 0.5 : 0.3)) p.con = { sal: ask.aav, exp: L.season + ask.yrs };
      else toFreeAgency(L, p);
    }
    aiTrimPayroll(L, t);
  }
  L.phase = 'offseason'; L.off = { stage: 'resign', day: 0 };
  const exp = org(L, L.userTid).filter(p => p.expiring);
  inbox(L, exp.length ? `${exp.length} of your players are out of contract: ${exp.map(name).join(', ')}. Re-sign them on the Contracts page before free agency opens, or they walk.` : 'None of your players are out of contract. Free agency opens next.', 'big');
  saveSeed(L);
}
const strip = s => { const o = {}; for (const k in s) if (typeof s[k] === 'number' && s[k]) o[k] = s[k]; return o; };
function aiTrimPayroll(L, t) {
  let guard = 0;
  while (payrollNext(L, t.id) > t.budget * 1.05 && guard++ < 6) {
    const c = org(L, t.id).filter(p => p.on40 && p.svc >= 3 && p.svc < 6 && p.con.exp <= L.season + 1 && !p.locked)
      .sort((a, b) => (marketValue(a.ovr) - a.con.sal) - (marketValue(b.ovr) - b.con.sal))[0];
    if (!c) break;
    toFreeAgency(L, c);
  }
}

// ---------- offseason days ----------
function aiSignDay(L, late) {
  const fas = freeAgents(L).filter(p => p.ovr >= 66).sort((a, b) => b.ovr - a.ovr);
  if (!fas.length) return;
  const chasing = new Set(); for (const p of fas) for (const b of p.bids || []) chasing.add(b.tid);
  for (const t of L.rng.shuffle([...L.teams])) {
    if (t.id === L.userTid || chasing.has(t.id) || !L.rng.chance(late ? 0.4 : 0.24)) continue;
    const room = t.budget * 0.98 - payrollNext(L, t.id);
    if (room < MIN_SALARY) continue;
    const mine = org(L, t.id).filter(p => p.on40 || p.lvl === 'AAA');
    const hitters = mine.filter(p => !p.isP).sort((a, b) => b.ovr - a.ovr), sp = mine.filter(p => p.role === 'SP').sort((a, b) => b.ovr - a.ovr), rp = mine.filter(p => p.role === 'RP').sort((a, b) => b.ovr - a.ovr);
    const base = p => p.role === 'SP' ? (sp[4]?.ovr ?? 55) : p.role === 'RP' ? (rp[5]?.ovr ?? 55) : (hitters.filter(h => h.pos === p.pos)[0]?.ovr ?? hitters[8]?.ovr ?? 55);
    let best = null, bg = 2.5;
    for (const p of fas) {
      if (p.tid !== -1 || p.ask.aav > room) continue;
      const g = p.ovr - base(p) - (p.age - 30) * 0.25 + L.rng.n() + Math.min(3, room / 30);
      if (g > bg) { bg = g; best = p; }
    }
    if (!best) continue;
    // a good player goes to auction: this club puts in an offer and waits for his decision
    if (best.ovr >= CONTESTED) { if (aiBid(L, best, t)) chasing.add(t.id); continue; }
    if (forty(L, t.id).length >= FORTY_MAX) { const d = forty(L, t.id).sort((a, b) => a.ovr + (a.pot - a.ovr) * 0.6 - (b.ovr + (b.pot - b.ovr) * 0.6))[0]; d.on40 = 0; if (d.lvl === 'MLB') d.lvl = 'AAA'; }
    const aav = Math.round(best.ask.aav * L.rng.range(0.94, 1.04) * 10) / 10, yrs = best.ask.yrs;
    signPlayer(L, best, t, aav, yrs);
    if (best.ovr >= 78) news(L, `${name(best)} signs with the ${t.name}: ${yrs} year${yrs > 1 ? 's' : ''}, $${(aav * yrs).toFixed(0)}M.`, 'sign', t.id, best.id);
  }
}
export function offseasonAdvance(L, all = false) {
  const off = L.off;
  do {
    if (off.stage === 'resign') {
      for (const p of org(L, L.userTid).filter(x => x.expiring)) { p.expiring = 0; news(L, `${name(p)} leaves the ${T(L, L.userTid).nick} for free agency.`, 'tx', L.userTid, p.id); toFreeAgency(L, p); }
      off.stage = 'fa'; off.day = 0;
      news(L, `Free agency is open. ${freeAgents(L).filter(p => p.ovr >= 75).length} notable players are on the market.`, 'big');
      if (!all) break;
    } else if (off.stage === 'fa') {
      aiSignDay(L, off.day > FA_DAYS * 0.6);
      off.day++;
      biddingDay(L, off.day >= FA_DAYS);
      // prices of players nobody is bidding on drift down as the winter goes on
      if (off.day > 10) for (const p of freeAgents(L)) if (!p.bids?.length) p.ask.aav = Math.max(MIN_SALARY, Math.round(p.ask.aav * 0.975 * 10) / 10);
      if (off.day % 10 === 0) for (const p of freeAgents(L)) if (!p.bids?.length && p.ask.yrs > 1 && L.rng.chance(0.5)) p.ask.yrs--;
      if (off.day >= FA_DAYS) { newSeason(L); return; }
    }
  } while (all && L.phase === 'offseason');
  saveSeed(L);
}

export function newSeason(L) {
  L.season++; L.day = 0; L.phase = 'regular'; L.po = null; L.off = null; L.draft = null; L.poDay = 0; L.lastBox = null;
  L.cbt = Math.round(L.cbt * 1.02);
  for (const p of L.players) {
    const mlbPA = (p.hist || []).filter(h => h.lv === 'MLB').reduce((s, h) => s + (h.PA || 0) + (h.BF || 0) * 2.6, 0);
    p.rk = mlbPA < 130 ? 1 : 0;
    p.st = { b: Object.assign(newBatLine(), { G: 0 }), p: p.isP ? newPitLine() : undefined };
    p.sm = { b: Object.assign(newBatLine(), { G: 0 }), p: p.isP ? newPitLine() : null };
    p.po = null; p.fat = 0; p.optUsed = 0; p.use = 0; p.d0 = p.ovr; p.il = 0; p.expiring = 0;
    if (p.inj && p.inj.days < 150) p.inj = null; else if (p.inj) p.inj.days -= 150;
  }
  for (const t of L.teams) {
    Object.assign(t, { w: 0, l: 0, rs: 0, ra: 0, l10: [], strk: 0, hw: 0, hl: 0, aw: 0, al: 0, mw: 0, ml: 0, rotI: 0, rev: 0, gate: 0, att: 0, po: 0 });
    // two international teenagers sign with every club each winter
    for (let i = 0; i < 2; i++) { const p = genProspect(L, 20 + L.rng.i(280), 300); p.tid = t.id; p.age = 17 + L.rng.i(2); p.intl = 1; p.draft = null; L.players.push(p); L.pm.set(p.id, p); }
    if (t.id !== L.userTid || L.opts.autoRoster) {
      // promote the best of the low minors, then choose a fresh opening roster
      for (const p of org(L, t.id).filter(x => x.lvl === 'LOW' && (x.ovr >= 60 || x.age >= 23) && x.age >= 19).sort((a, b) => b.ovr - a.ovr).slice(0, 12)) p.lvl = 'AAA';
      setInitialRoster(L, t);
    } else {
      for (const p of org(L, t.id)) if (p.lvl === 'FA') p.lvl = 'AAA';
      const act = active(L, t.id);
      if (act.length < 20) setInitialRoster(L, t);
    }
    autoLineup(L, t); autoPitching(L, t);
  }
  clearLineupCache();
  L.sched = buildSchedule(L.teams, L.games, L.rng);
  setExpectations(L);
  ownerSeasonStart(L);
  ensureState(L); L.scout = { y: L.season, pts: SCOUT_PTS };
  const ut = T(L, L.userTid);
  news(L, `Opening Day ${L.season}. The owner's goal for the ${ut.nick}: ${ut.goal}.`, 'big', ut.id);
  inbox(L, `Welcome to ${L.season}. Owner's goal: ${ut.goal} (about ${ut.goalW} wins). Payroll budget $${ut.budget}M. Check your roster before the first game.`, 'big');
  saveSeed(L);
}

// ---------- the one button: advance one step of the calendar ----------
export function blockers(L) {
  if (L.fired) return ['You have been dismissed. Choose a new club to continue.'];
  if (L.draft && !L.draft.done) return ['The draft is in progress. Finish it on the Draft page.'];
  if (L.phase !== 'offseason') return rosterProblems(L);
  return [];
}
export function advanceDay(L) {
  ensureState(L);
  // the assistant gets to tidy the roster before anything is called a problem
  if (L.opts.autoRoster && !L.fired && L.phase !== 'offseason' && !(L.draft && !L.draft.done)) aiRosterUpkeep(L, T(L, L.userTid));
  const b = blockers(L);
  if (b.length) return { blocked: b };
  if (L.phase === 'regular') {
    const day = L.sched[L.day];
    const r = simDay(L);
    dailyTrades(L);
    ownerDay(L);
    checkDebuts(L);
    if (L.day % DEV_EVERY === 0) developAll(L, 0.64 / Math.max(1, Math.floor(L.sched.length / DEV_EVERY)));
    for (const m of L.inbox) if (m.k === 'offer' && !m.done && m.data && L.day > m.data.exp) m.done = 1;
    if (day?.asb && !L.draft) { startDraft(L); if (L.opts.autoDraft) draftAdvance(L, true); else draftAdvance(L); }
    if (L.day >= L.sched.length) startPlayoffs(L);
    return r;
  }
  if (L.phase === 'playoffs') { playoffDay(L); return {}; }
  if (L.phase === 'offseason') { offseasonAdvance(L); return {}; }
  return {};
}

// take over another club after being dismissed
export function takeJob(L, tid) {
  ensureState(L);
  const old = T(L, L.userTid); old.ult = null;
  L.userTid = tid; L.fired = 0;
  const t = T(L, tid);
  // a new owner starts at 55% whatever the record so far
  t.ownerMood = 55; t.moodAdj = 0; t.mood0 = 55; t.mood0 = 55 - (liveMood(L, t) - 55); t.ownerMood = liveMood(L, t);
  t.ult = null; t.ultDone = 0; t.warned = 0;
  L.gmc.jobs.push({ y: L.season, tid });
  for (const p of L.players) if (p.tid === tid && p.gen && p.lvl === 'MLB') p.debutSeen = 1;
  inbox(L, `You are the new general manager of the ${t.name}.`, 'big');
  refreshUser(L);
}
export { ROUND_NAME };
