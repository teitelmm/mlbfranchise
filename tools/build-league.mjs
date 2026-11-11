// Turns the raw cache into data/league.json (teams + rated real players).
// Run: node tools/build-league.mjs   (after tools/fetch-raw.mjs)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LG, S, clamp, ratingFor, calcOvr, POS_DIFF } from '../js/engine/ratings.js';
import { marketValue, MIN_SALARY } from '../js/engine/money.js';
import { TEAM_STATIC, KNOWN_CONTRACTS } from './teams-static.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const OUT = path.join(HERE, '..', 'data');
const START_SEASON = 2027;
const J = async n => JSON.parse(await readFile(path.join(CACHE, n), 'utf8'));
const T = async n => { try { return await readFile(path.join(CACHE, n), 'utf8'); } catch { return ''; } };

function csv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const parse = l => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
  const head = parse(lines[0]);
  return lines.slice(1).map(l => { const v = parse(l), o = {}; head.forEach((h, i) => o[h] = v[i]); return o; });
}
// deterministic per-player randomness so rebuilding never reshuffles the league
function seeded(id, salt) {
  let h = (id * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const gauss = (id, salt) => (seeded(id, salt) + seeded(id, salt + 1) + seeded(id, salt + 2) + seeded(id, salt + 3) - 2) * 1.73;
const ip2outs = s => { const [a, b] = String(s || '0').split('.'); return (+a) * 3 + (+b || 0); };

const teamsRaw = await J('teams.json');
const rosters = await J('rosters.json');
const people = new Map((await J('people.json')).map(p => [p.id, p]));

// ---------- stats tables ----------
const SEASONS = [2026, 2025, 2024], SPORTS = [1, 11, 12];
const WT = { 2026: 1, 2025: 0.8, 2024: 0.6 };
const hit = {}, pit = {}, fld = new Map();
for (const y of SEASONS) for (const s of SPORTS) {
  for (const r of await J(`stats_hitting_${y}_${s}.json`)) ((hit[r.id] ??= []).push({ y, s, ...r }));
  for (const r of await J(`stats_pitching_${y}_${s}.json`)) ((pit[r.id] ??= []).push({ y, s, ...r }));
}
for (const y of [2026, 2025]) for (const s of SPORTS) for (const r of await J(`stats_fielding_${y}_${s}.json`)) {
  if (!r.pos || r.pos === 'P' || r.pos === 'DH') continue;
  const m = fld.get(r.id) || fld.set(r.id, {}).get(r.id);
  m[r.pos] = (m[r.pos] || 0) + ip2outs(r.innings) / 3 * (y === 2026 ? 1 : 0.6);
}
const byId = (rows, key = 'player_id') => new Map(rows.map(r => [+r[key], r]));
const sprint = [byId(csv(await T('savant_sprint_2026.csv'))), byId(csv(await T('savant_sprint_2025.csv')))];
const oaa = [byId(csv(await T('savant_oaa_2026.csv'))), byId(csv(await T('savant_oaa_2025.csv')))];
const armRows = [csv(await T('savant_arm_2026.csv')), csv(await T('savant_arm_2025.csv'))];
const arm = armRows.map(r => byId(r));
const pop = [byId(csv(await T('savant_poptime_2026.csv')), 'entity_id'), byId(csv(await T('savant_poptime_2025.csv')), 'entity_id')];
const speedCsv = [byId(csv(await T('savant_arsenal_2026.csv')), 'pitcher'), byId(csv(await T('savant_arsenal_2025.csv')), 'pitcher')];
const usageCsv = [byId(csv(await T('savant_usage_2026.csv')), 'pitcher'), byId(csv(await T('savant_usage_2025.csv')), 'pitcher')];
const armAvg = {};
{ const acc = {}; for (const r of armRows[0]) { const p = r.primary_position, v = +r.arm_overall; if (!v) continue; (acc[p] ??= []).push(v); }
  for (const [p, v] of Object.entries(acc)) armAvg[p] = v.reduce((a, b) => a + b, 0) / v.length; }

// minor-league equivalencies: multiply the raw rate to estimate the MLB rate
const MLE_B = { 1: { k: 1, bb: 1, hr: 1, babip: 1 }, 11: { k: 1.16, bb: 0.84, hr: 0.76, babip: 0.935 }, 12: { k: 1.27, bb: 0.76, hr: 0.66, babip: 0.90 } };
const MLE_P = { 1: { k: 1, bb: 1, hr: 1 }, 11: { k: 0.84, bb: 1.16, hr: 1.22 }, 12: { k: 0.76, bb: 1.24, hr: 1.34 } };

function batterRatings(id, pos, age) {
  const rows = hit[id] || [];
  let PA = 0, mlbPA = 0, aaaPA = 0, K = 0, BB = 0, HR = 0, BIP = 0, H = 0, GO = 0, AO = 0, SBA = 0, T3 = 0, rawPA = 0;
  for (const r of rows) {
    const w = WT[r.y], f = MLE_B[r.s], pa = r.plateAppearances || 0;
    if (!pa) continue;
    rawPA += pa; PA += w * pa; if (r.s === 1) mlbPA += w * pa; if (r.s === 11) aaaPA += w * pa;
    K += w * (r.strikeOuts || 0) * f.k;
    BB += w * ((r.baseOnBalls || 0) - (r.intentionalWalks || 0)) * f.bb;
    HR += w * (r.homeRuns || 0) * f.hr;
    const bip = (r.atBats || 0) - (r.strikeOuts || 0) - (r.homeRuns || 0) + (r.sacFlies || 0);
    BIP += w * bip; H += w * ((r.hits || 0) - (r.homeRuns || 0)) * f.babip;
    GO += w * (r.groundOuts || 0); AO += w * (r.airOuts || 0);
    SBA += w * ((r.stolenBases || 0) + (r.caughtStealing || 0)); T3 += w * (r.triples || 0);
  }
  const m = PA ? mlbPA / PA : 0;
  const prior = 27 + 18 * m + 7 * (PA ? aaaPA / PA : 0);       // what an unknown of this pedigree looks like
  const pr = (lg, s) => lg * Math.exp(s * (prior - 50) / 25);
  const reg = (num, den, n0, p0) => (num + n0 * p0) / (den + n0);
  const noise = k => PA < 60 ? gauss(id, k) * 5 : 0;
  const b = {
    con: ratingFor(LG.k, S.con, reg(K, PA, 70, pr(LG.k, S.con))) + noise(11),
    eye: ratingFor(LG.bb, S.eye, reg(BB, PA, 130, pr(LG.bb, S.eye))) + noise(12),
    pow: ratingFor(LG.hr, S.pow, reg(HR, PA, 190, pr(LG.hr, S.pow))) + noise(13),
    hit: ratingFor(LG.babip, S.hit, reg(H, BIP, 520, pr(LG.babip, S.hit))) + noise(14),
  };
  // speed
  const ss = +(sprint[0].get(id)?.sprint_speed || 0) || +(sprint[1].get(id)?.sprint_speed || 0) - 0.15;
  if (ss > 20) b.spd = 50 + (ss - 27.1) * 13.5;
  else {
    const base = { CF: 62, SS: 58, '2B': 55, LF: 52, RF: 52, '3B': 47, '1B': 38, C: 33, DH: 38 }[pos] ?? 48;
    b.spd = base + clamp((PA ? SBA / PA : 0.01) * 320 - 4, -6, 26) + clamp((PA ? T3 / PA : 0) * 900 - 3, -3, 8) + gauss(id, 21) * 5 - Math.max(0, age - 28) * 1.2;
  }
  // glove
  const o0 = oaa[0].get(id), o1 = oaa[1].get(id);
  if (o0 || o1) b.def = 50 + (+(o0?.outs_above_average || 0)) * 1.7 + (+(o1?.outs_above_average || 0)) * 0.9;
  else b.def = (pos === 'C' ? 50 : 46 + 4 * m) + gauss(id, 31) * 9;
  // arm
  const a = arm[0].get(id) || arm[1].get(id), pp = pop[0].get(id) || pop[1].get(id);
  if (pos === 'C' && pp && +pp.pop_2b_sba) b.arm = 50 + (1.955 - +pp.pop_2b_sba) * 250;
  else if (a && +a.arm_overall) b.arm = 50 + (+a.arm_overall - (armAvg[a.primary_position] || 85)) * 4.2;
  else b.arm = ({ RF: 58, SS: 57, '3B': 57, C: 55, CF: 52, '2B': 47, LF: 46, '1B': 44 }[pos] ?? 48) + gauss(id, 41) * 8;
  b.gb = clamp(((GO + 60 * 0.47) / (GO + AO + 60)), 0.3, 0.64);
  for (const k of ['con', 'eye', 'pow', 'hit', 'spd', 'def', 'arm']) b[k] = Math.round(clamp(b[k], 20, 99));
  b.gb = Math.round(b.gb * 100);
  return { b, rawPA, m };
}

const PITCH_KEYS = ['ff', 'si', 'fc', 'sl', 'ch', 'cu', 'fs', 'kn', 'st', 'sv'];
function pitcherRatings(id, throws) {
  const rows = pit[id] || [];
  let BF = 0, mlbBF = 0, aaaBF = 0, K = 0, BB = 0, HR = 0, GO = 0, AO = 0, rawBF = 0;
  for (const r of rows) {
    const w = WT[r.y], f = MLE_P[r.s], bf = r.battersFaced || 0;
    if (!bf) continue;
    rawBF += bf; BF += w * bf; if (r.s === 1) mlbBF += w * bf; if (r.s === 11) aaaBF += w * bf;
    K += w * (r.strikeOuts || 0) * f.k; BB += w * ((r.baseOnBalls || 0) - (r.intentionalWalks || 0)) * f.bb;
    HR += w * (r.homeRuns || 0) * f.hr; GO += w * (r.groundOuts || 0); AO += w * (r.airOuts || 0);
  }
  const latest = rows.filter(r => (r.battersFaced || 0) > 0).sort((a, b) => b.y - a.y || a.s - b.s);
  const ly = latest.length ? latest[0].y : 0;
  let G = 0, GS = 0, OUTS = 0;
  for (const r of latest) if (r.y === ly) { G += r.gamesPitched || r.gamesPlayed || 0; GS += r.gamesStarted || 0; OUTS += r.outs || ip2outs(r.inningsPitched); }
  const role = G && GS / G >= 0.5 ? 'SP' : 'RP';
  const m = BF ? mlbBF / BF : 0;
  const prior = 27 + 18 * m + 7 * (BF ? aaaBF / BF : 0) + (role === 'RP' ? 2 : 0);
  const pr = (lg, s) => lg * Math.exp(s * (prior - 50) / 25);
  const reg = (num, den, n0, p0) => (num + n0 * p0) / (den + n0);
  const noise = k => BF < 60 ? gauss(id, k) * 5 : 0;
  const t = {
    stf: ratingFor(LG.k, S.stf, reg(K, BF, 80, pr(LG.k, S.stf))) + noise(51),
    ctl: ratingFor(LG.bb, S.ctl, reg(BB, BF, 190, pr(LG.bb, S.ctl))) + noise(52),
    mov: ratingFor(LG.hr, S.mov, reg(HR, BF, 420, pr(LG.hr, S.mov))) + noise(53),
  };
  const ipg = G ? OUTS / 3 / G : 1;
  t.sta = role === 'SP' ? clamp(52 + (ipg - 5.2) * 20, 42, 92) : clamp(22 + (ipg - 1) * 26, 20, 46);
  t.gb = Math.round(clamp((GO + 70 * 0.47) / (GO + AO + 70), 0.3, 0.66) * 100);
  for (const k of ['stf', 'ctl', 'mov', 'sta']) t[k] = Math.round(clamp(t[k], 20, 99));
  // arsenal
  const sp = speedCsv[0].get(id) || speedCsv[1].get(id), us = usageCsv[0].get(id) || usageCsv[1].get(id);
  let mix = [];
  if (sp && us) for (const k of PITCH_KEYS) {
    const u = +us[`n_${k}`], v = +sp[`${k}_avg_speed`];
    if (u >= 3 && v) mix.push([k.toUpperCase(), Math.round(u), Math.round(v * 10) / 10]);
  }
  if (!mix.length) {
    const fb = 91.5 + (t.stf - 50) * 0.11 + gauss(id, 61) * 1.6 + (role === 'RP' ? 1.2 : 0) - (throws === 'L' ? 0.8 : 0);
    const second = seeded(id, 62) < 0.6 ? 'SL' : 'CU';
    mix = [[seeded(id, 63) < 0.72 ? 'FF' : 'SI', 52, +fb.toFixed(1)], [second, 28, +(fb - (second === 'SL' ? 8.5 : 14)).toFixed(1)], ['CH', 20, +(fb - 8).toFixed(1)]];
    if (role === 'SP' && seeded(id, 64) < 0.5) mix.push([second === 'SL' ? 'CU' : 'FC', 10, +(fb - (second === 'SL' ? 14 : 5)).toFixed(1)]);
  }
  mix.sort((a, b) => b[1] - a[1]);
  t.mix = mix;
  t.vel = Math.max(...mix.filter(x => ['FF', 'SI', 'FC'].includes(x[0])).map(x => x[2]), mix[0][2]);
  return { t, role, rawBF, m };
}

function histBat(id) {
  const out = [];
  for (const y of [2024, 2025, 2026]) {
    const rs = (hit[id] || []).filter(r => r.y === y && (r.plateAppearances || 0) > 0).sort((a, b) => a.s - b.s);
    const r = rs.find(x => x.s === 1) || rs[0];
    if (!r) continue;
    out.push({ y, lv: r.s === 1 ? 'MLB' : r.s === 11 ? 'AAA' : 'AA', G: r.gamesPlayed || 0, PA: r.plateAppearances, AB: r.atBats || 0, H: r.hits || 0, D: r.doubles || 0, T: r.triples || 0, HR: r.homeRuns || 0, R: r.runs || 0, RBI: r.rbi || 0, BB: r.baseOnBalls || 0, K: r.strikeOuts || 0, SB: r.stolenBases || 0, CS: r.caughtStealing || 0, HBP: r.hitByPitch || 0, SF: r.sacFlies || 0 });
  }
  return out;
}
function histPit(id) {
  const out = [];
  for (const y of [2024, 2025, 2026]) {
    const rs = (pit[id] || []).filter(r => r.y === y && (r.battersFaced || 0) > 0).sort((a, b) => a.s - b.s);
    const r = rs.find(x => x.s === 1) || rs[0];
    if (!r) continue;
    out.push({ y, lv: r.s === 1 ? 'MLB' : r.s === 11 ? 'AAA' : 'AA', G: r.gamesPitched || r.gamesPlayed || 0, GS: r.gamesStarted || 0, W: r.wins || 0, L: r.losses || 0, SV: r.saves || 0, O: r.outs || ip2outs(r.inningsPitched), H: r.hits || 0, R: r.runs || 0, ER: r.earnedRuns || 0, BB: r.baseOnBalls || 0, K: r.strikeOuts || 0, HR: r.homeRuns || 0, BF: r.battersFaced || 0 });
  }
  return out;
}

const HEAD_MAX = { 18: 36, 19: 34, 20: 31, 21: 28, 22: 24, 23: 19, 24: 14, 25: 10, 26: 6, 27: 3, 28: 1 };
const EXPECT = a => 40 + (clamp(a, 18, 28) - 18) * 3.1;

// ---------- last season ----------
const lastStand = new Map((await J('standings.json')).map(s => [s.id, s]));
const lastPO = new Map();
{
  const ROUND = { F: 1, D: 2, L: 3, W: 4 };
  const NAME = { F: 'Wild Card Series', D: 'Division Series', L: 'LCS', W: 'World Series' };
  for (const s of await J('postseason.json')) {
    if (!ROUND[s.type] || !s.games.length) continue;
    const wins = new Map();
    for (const g of s.games) { const w = g.aw ? g.a : g.h; wins.set(w, (wins.get(w) || 0) + 1); for (const id of [g.a, g.h]) if (!wins.has(id)) wins.set(id, 0); }
    const [win, lose] = [...wins.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const note = (id, txt, r) => { const cur = lastPO.get(id); if (!cur || cur.r < r) lastPO.set(id, { r, txt }); };
    if (s.type === 'W') { note(win, 'Won the World Series', 5); note(lose, 'Lost the World Series', 4); }
    else { note(lose, `Lost in the ${NAME[s.type]}`, ROUND[s.type]); note(win, `Won the ${NAME[s.type]}`, ROUND[s.type] + 0.5); }
  }
}

// ---------- teams ----------
const DIV ={ 200: ['AL', 'West'], 201: ['AL', 'East'], 202: ['AL', 'Central'], 203: ['NL', 'West'], 204: ['NL', 'East'], 205: ['NL', 'Central'] };
const teams = teamsRaw.map(t => {
  const st = TEAM_STATIC[t.id], f = t.venue?.fieldInfo || {}, r = rosters[t.id];
  const [lg, div] = DIV[t.division.id];
  return {
    id: t.id, abbr: t.abbreviation, name: t.name, city: t.locationName, nick: t.teamName, lg, div,
    c1: st.c1, c2: st.c2, market: st.market, budget: st.budget, pf: st.pf,
    park: { name: t.venue?.name || `${t.teamName} Park`, cap: f.capacity || 40000, lf: f.leftLine || 330, lcf: f.leftCenter || 375, cf: f.center || 400, rcf: f.rightCenter || 375, rf: f.rightLine || 330, roof: f.roofType || 'Open', turf: f.turfType || 'Grass' },
    aaa: r.aaa.name || `${t.teamName} AAA`, aa: r.aa.name || `${t.teamName} AA`,
    last: (() => { const s = lastStand.get(t.id); if (!s) return null; const po = lastPO.get(t.id); return { y: SEASONS[0], w: s.w, l: s.l, div: s.div, rd: s.rd, po: po ? po.txt : s.div === 1 ? 'Won the division' : 'Missed the playoffs', pr: po ? po.r : 0 }; })(),
  };
}).sort((a, b) => a.name.localeCompare(b.name));

// ---------- players ----------
const players = [];
const seen = new Set();
const ageAt = born => { const d = new Date(born + 'T00:00:00Z'); let a = START_SEASON - d.getUTCFullYear(); if (d.getUTCMonth() > 5) a--; return a; };

function makePlayer(id, tid, level, on40, rosterPos, num) {
  if (seen.has(id)) return;
  const pe = people.get(id);
  if (!pe || !pe.born) return;
  seen.add(id);
  const age = ageAt(pe.born);
  const hasPit = (pit[id] || []).some(r => (r.battersFaced || 0) > 20);
  const hasHit = (hit[id] || []).some(r => (r.plateAppearances || 0) > 60);
  const twoWay = pe.pos === 'TWP' || (hasPit && hasHit && ((hit[id] || []).reduce((a, r) => a + (r.plateAppearances || 0), 0) > 600) && ((pit[id] || []).reduce((a, r) => a + (r.battersFaced || 0), 0) > 300));
  const isP = pe.pos === 'P' || rosterPos === 'P' || (twoWay && hasPit) || (!hasHit && hasPit && pe.pos !== 'C');
  let pos = pe.pos;
  const fm = fld.get(id) || {};
  const fpos = Object.entries(fm).filter(([p]) => POS_DIFF[p] !== undefined).sort((a, b) => b[1] - a[1]);
  if (!isP || twoWay) {
    if (['OF', 'IF', 'UTL', 'TWP', 'P', '', 'PH', 'PR', 'X'].includes(pos) || POS_DIFF[pos] === undefined) pos = fpos[0]?.[0] || (twoWay ? 'DH' : pe.pos === 'OF' ? 'LF' : pe.pos === 'IF' ? '2B' : 'DH');
    if (pos !== 'DH' && fpos.length && fpos[0][1] > 250 && (fm[pos] || 0) < fpos[0][1] * 0.4) pos = fpos[0][0];
  }
  const p = {
    id, tid, first: pe.first, last: pe.last, num: num || pe.num || '', born: pe.born, age,
    country: pe.country, ht: pe.height, wt: pe.weight, bats: pe.bats, throws: pe.throws,
    lvl: level, on40, real: 1,
  };
  if (isP) {
    const { t, role, rawBF } = pitcherRatings(id, pe.throws);
    p.isP = 1; p.pos = role; p.role = role; p.pit = t; p.sample = rawBF;
    if (twoWay) { const { b } = batterRatings(id, 'DH', age); p.twoWay = 1; p.bat = b; p.elig = ['DH']; }
    else p.bat = { con: 22, eye: 22, pow: 20, hit: 28, spd: 35, def: 40, arm: 55, gb: 50 };
    const h = histPit(id); if (h.length) p.hist = h;
    if (twoWay) p.histB = histBat(id);
  } else {
    const { b, rawPA } = batterRatings(id, pos, age);
    p.pos = pos; p.bat = b; p.sample = rawPA;
    p.elig = [...new Set([pos, ...fpos.filter(([, inn]) => inn >= 70).map(([q]) => q)])];
    const h = histBat(id); if (h.length) p.hist = h;
  }
  p.ovr = calcOvr(p);
  const perf = clamp((p.ovr - EXPECT(age)) / 22 + 0.5, 0, 1);
  const head = (HEAD_MAX[clamp(age, 18, 28)] ?? 0) * (age > 28 ? 0 : 0.12 + 0.88 * (0.55 * perf + 0.45 * Math.pow(seeded(id, 71), 1.4)));
  let pot = p.ovr + head; if (pot > 86) pot = 86 + (pot - 86) * 0.55;
  p.pot = clamp(Math.round(pot), p.ovr, 99);
  // service time (years), estimated from debut date and how much he has actually played
  if (pe.debut) {
    const dy = (Date.UTC(2026, 9, 1) - Date.parse(pe.debut)) / 31557600000;
    const mlbPlay = (hit[id] || []).filter(r => r.s === 1).reduce((a, r) => a + (r.plateAppearances || 0), 0) / 600
      + (pit[id] || []).filter(r => r.s === 1).reduce((a, r) => a + (r.battersFaced || 0), 0) / (p.role === 'SP' ? 700 : 260);
    p.svc = Math.round(clamp(Math.min(dy, dy > 3 ? Math.max(dy * 0.8, mlbPlay + (dy - 3)) : Math.max(mlbPlay, dy * 0.5)), 0, 20) * 10) / 10;
  } else p.svc = 0;
  p.opt = p.svc >= 5 ? 0 : clamp(3 - Math.floor(Math.max(0, p.svc - 0.5) * (0.6 + seeded(id, 81) * 0.5)), 0, 3);
  players.push(p);
}

for (const t of teamsRaw) {
  const r = rosters[t.id];
  const activeIds = new Set(r.active.map(x => x.id));
  for (const x of r.forty) makePlayer(x.id, t.id, activeIds.has(x.id) || x.status.startsWith('D') ? 'MLB' : 'AAA', 1, x.pos, x.num);
  for (const x of r.active) makePlayer(x.id, t.id, 'MLB', 1, x.pos, x.num);
  for (const x of r.aaa.roster) makePlayer(x.id, t.id, 'AAA', 0, x.pos, x.num);
  for (const x of r.aa.roster) makePlayer(x.id, t.id, 'LOW', 0, x.pos, x.num);
}

// ---------- contracts ----------
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const known = new Map(Object.entries(KNOWN_CONTRACTS).map(([k, v]) => [norm(k), v]));
for (const p of players) {
  const k = known.get(norm(`${p.first} ${p.last}`));
  const rp = p.isP && p.role === 'RP';
  const mv = marketValue(p.ovr, rp);
  if (k && k[1] >= START_SEASON && p.ovr >= 60) { p.con = { sal: k[0], exp: k[1] }; p.svc = Math.max(p.svc, 6); continue; }
  if (!p.on40 || p.svc < 3) { p.con = { sal: p.on40 && p.lvl === 'MLB' ? MIN_SALARY : p.on40 ? 0.4 : 0.05, exp: START_SEASON }; continue; }
  if (p.svc < 6) {
    const yr = Math.floor(p.svc) - 3;                      // arbitration year 0..2
    p.con = { sal: Math.max(MIN_SALARY, Math.round(mv * [0.28, 0.45, 0.62][yr] * (0.85 + seeded(p.id, 91) * 0.3) * 10) / 10), exp: START_SEASON };
    continue;
  }
  const ageCut = p.age >= 36 ? 0.55 : p.age >= 33 ? 0.75 : 1;
  const sal = Math.max(MIN_SALARY, Math.round(mv * ageCut * (0.72 + seeded(p.id, 92) * 0.4) * 10) / 10);
  const maxY = p.age >= 35 ? 1 : p.age >= 32 ? 2 : p.ovr >= 85 ? 6 : p.ovr >= 78 ? 4 : 2;
  p.con = { sal, exp: START_SEASON + Math.floor(seeded(p.id, 93) * maxY) };
}
// keep each club's payroll near what its owner really spends
for (const t of teams) {
  const mine = players.filter(p => p.tid === t.id && p.on40);
  const fixed = mine.filter(p => known.has(norm(`${p.first} ${p.last}`)) || p.con.sal <= MIN_SALARY);
  const flex = mine.filter(p => !fixed.includes(p));
  const sum = a => a.reduce((x, p) => x + p.con.sal, 0);
  const target = t.budget * (0.80 + seeded(t.id, 5) * 0.14);
  const f = clamp((target - sum(fixed)) / Math.max(1, sum(flex)), 0.35, 2.4);
  for (const p of flex) p.con.sal = Math.max(MIN_SALARY, Math.round(p.con.sal * f * 10) / 10);
  t.payroll0 = Math.round(sum(mine));
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'league.json'), JSON.stringify({ season: START_SEASON, built: new Date().toISOString().slice(0, 10), teams, players }));

// ---------- report ----------
const top = (arr, n = 12) => arr.sort((a, b) => b.ovr - a.ovr).slice(0, n).map(p => `${p.ovr} ${p.first} ${p.last}`).join(' | ');
console.log('players', players.length, 'MLB', players.filter(p => p.lvl === 'MLB').length, 'on40', players.filter(p => p.on40).length);
console.log('TOP BAT:', top(players.filter(p => !p.isP)));
console.log('TOP SP :', top(players.filter(p => p.role === 'SP')));
console.log('TOP RP :', top(players.filter(p => p.role === 'RP')));
const dist = lv => { const a = players.filter(p => p.lvl === lv).map(p => p.ovr).sort((x, y) => x - y); return `${lv} n=${a.length} p10=${a[a.length * 0.1 | 0]} med=${a[a.length >> 1]} p90=${a[a.length * 0.9 | 0]} max=${a.at(-1)}`; };
console.log(dist('MLB'), '\n' + dist('AAA'), '\n' + dist('LOW'));
console.log('2-way:', players.filter(p => p.twoWay).map(p => `${p.first} ${p.last} ${p.ovr}`).join(', '));
console.log('top prospects:', players.filter(p => p.lvl !== 'MLB' && p.age <= 23).sort((a, b) => b.pot - a.pot).slice(0, 10).map(p => `${p.first} ${p.last} ${p.age} ${p.ovr}/${p.pot}`).join(' | '));
console.log('payrolls:', teams.map(t => `${t.abbr} ${t.payroll0}/${t.budget}`).join(' '));
const unk = Object.keys(KNOWN_CONTRACTS).filter(k => !players.some(p => norm(`${p.first} ${p.last}`) === norm(k)));
console.log('known contracts not matched:', unk.join(', '));
