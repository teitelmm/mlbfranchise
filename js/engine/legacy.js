// The GM's own career: seasons run, trophies, achievements, the Hall of Fame and club
// records. Also the "moments" queue: big news the UI shows as a pop-up card.
import { P, T, news, name, payroll } from './league.js';
import { war } from './stats.js';
import { clamp } from './ratings.js';

// ---------- moments ----------
// k: kind (owner, fa-won, fa-lost, outbid, ach, debut, breakout, hof, record, draft, fired)
// stop: true halts a multi-day sim so the GM sees it straight away
export function pop(L, m) {
  (L.pops ??= []).push({ id: L.nextId++, ...m });
  if (L.pops.length > 30) L.pops.splice(0, L.pops.length - 30);
}

// ---------- state for careers started before this existed ----------
export function ensureState(L) {
  if (L.gmc && L.pops && L.hof) return L;
  L.pops ??= []; L.hof ??= []; L.ballot ??= [];
  if (!L.gmc) {
    const t = T(L, L.userTid);
    L.gmc = { start: L.season - (t.hist?.length || 0), seasons: [], ach: {}, jobs: [{ y: L.season - (t.hist?.length || 0), tid: L.userTid }], fired: 0 };
    for (const h of t.hist || []) L.gmc.seasons.push({ y: h.y, tid: t.id, abbr: t.abbr, w: h.w, l: h.l, po: h.po || 0, champ: h.champ || 0, pay: h.pay || 0 });
    L.gmc.titles = L.gmc.seasons.filter(s => s.champ).length;
  }
  for (const t of L.teams) t.recs ??= {};
  const done = L.hist?.length || 0;
  for (const p of L.players) {
    // what a real veteran did before the save began, so Hall of Fame cases are fair
    if (p.war0 === undefined) p.war0 = p.real ? estWar0(p, Math.max(0, (p.svc || 0) - done)) : 0;
    if (p.gen && p.lvl === 'MLB' && p.tid === L.userTid) p.debutSeen = 1;
  }
  L.scout ??= { y: L.season, pts: SCOUT_PTS };
  return L;
}
export const SCOUT_PTS = 12;
// wins above replacement before the save: years in the majors times a rate from his rating
export function estWar0(p, yrs = p.svc || 0) { return Math.round(yrs * clamp((p.ovr - 60) / 4.2, 0, 7.5) * 0.8 * 10) / 10; }
export const careerWAR = p => (p.war0 || 0) + (p.cw || 0);

// ---------- achievements ----------
export const ACH = [
  ['win1', 'Opening act', 'Win your first game.', 5],
  ['streak10', 'Red hot', 'Win ten games in a row.', 20],
  ['winning', 'Winning culture', 'Finish a season above .500.', 10],
  ['w100', 'Century club', 'Win 100 games (or that pace in a shorter season).', 40],
  ['october', 'October baseball', 'Make the playoffs.', 20],
  ['pennant', 'Pennant winners', 'Win the league and reach the World Series.', 40],
  ['title', 'Champions', 'Win the World Series.', 80],
  ['dynasty', 'Dynasty', 'Win three World Series.', 150],
  ['moneyball', 'Moneyball', 'Make the playoffs with one of the ten lowest payrolls.', 50],
  ['turnaround', 'Worst to first', 'Win your division a year after a losing season.', 40],
  ['lifer', 'Lifer', 'Run the same club for five straight seasons.', 30],
  ['blockbuster', 'Blockbuster', 'Trade for a player rated 85 or better.', 20],
  ['bigfish', 'Big fish', 'Win a bidding war for a free agent rated 85 or better.', 25],
  ['farm', 'Farm to table', 'A player you drafted makes his big-league debut for you.', 15],
  ['homegrown', 'Homegrown hardware', 'A player you drafted wins MVP, Cy Young or Rookie of the Year.', 40],
  ['survivor', 'Saved your job', 'Beat the owner\'s ultimatum.', 25],
  ['secondact', 'Second act', 'Make the playoffs after being fired.', 40],
  ['legend', 'Builder of legends', 'A player who played for you goes into the Hall of Fame.', 30],
].map(([id, title, desc, pts]) => ({ id, title, desc, pts }));
const ACH_BY = new Map(ACH.map(a => [a.id, a]));

export function unlock(L, id) {
  ensureState(L);
  if (L.gmc.ach[id] || !ACH_BY.has(id)) return false;
  const a = ACH_BY.get(id);
  L.gmc.ach[id] = { y: L.season, tid: L.userTid };
  pop(L, { k: 'ach', kick: 'Achievement unlocked', title: a.title, text: `${a.desc} +${a.pts} legacy points.`, pts: a.pts });
  return true;
}

// ---------- the GM's résumé ----------
export function legacyScore(L) {
  ensureState(L);
  let s = 0;
  for (const id in L.gmc.ach) s += ACH_BY.get(id)?.pts || 0;
  for (const x of L.gmc.seasons) s += (x.po ? 15 : 0) + (x.po >= 4 ? 30 : 0) + (x.champ ? 60 : 0) + Math.max(0, x.w - x.l) * 0.5;
  return Math.round(s);
}
const RANKS = [[0, 'Rookie GM'], [100, 'Front-office regular'], [250, 'Respected executive'], [500, 'Franchise architect'], [900, 'Executive of the decade'], [1500, 'Living legend']];
export function gmRank(score) {
  let i = 0; while (i + 1 < RANKS.length && score >= RANKS[i + 1][0]) i++;
  return { title: RANKS[i][1], next: RANKS[i + 1] ? { at: RANKS[i + 1][0], title: RANKS[i + 1][1] } : null, from: RANKS[i][0] };
}

// End of the regular season and playoffs: book the year on the GM's record and check the
// season-long achievements. Runs before contracts roll over and players retire.
export function recordSeason(L) {
  ensureState(L);
  const t = T(L, L.userTid), g = L.gmc, champ = L.po?.champ === t.id;
  const pay = payroll(L, t.id);
  g.seasons.push({ y: L.season, tid: t.id, abbr: t.abbr, w: t.w, l: t.l, po: t.po || 0, champ: champ ? 1 : 0, pay: Math.round(pay) });
  g.titles = g.seasons.filter(s => s.champ).length;
  if (t.w > t.l) unlock(L, 'winning');
  if (t.w >= Math.round(L.games * 100 / 162)) unlock(L, 'w100');
  if (t.po) unlock(L, 'october');
  if (t.po >= 4) unlock(L, 'pennant');
  if (champ) unlock(L, 'title');
  if (g.titles >= 3) unlock(L, 'dynasty');
  if (t.po) {
    const payRank = [...L.teams].sort((a, b) => payroll(L, b.id) - payroll(L, a.id)).findIndex(x => x.id === t.id) + 1;
    if (payRank >= 21) unlock(L, 'moneyball');
    if (g.fired > 0 && g.jobs.length > 1) unlock(L, 'secondact');
  }
  const prev = t.hist.at(-1);
  const divWinner = L.po?.seeds?.[t.lg]?.slice(0, 3).includes(t.id);
  if (divWinner && prev && prev.w < prev.l) unlock(L, 'turnaround');
  let run = 0; for (let i = g.seasons.length - 1; i >= 0 && g.seasons[i].tid === t.id; i--) run++;
  if (run >= 5) unlock(L, 'lifer');
  // everyone on the club this year can later count as "played for you"
  for (const p of L.players) if (p.tid === t.id && (p.st.b.PA > 0 || p.st.p?.BF > 0)) p.wasMine = 1;
  // career value keeps adding up, so it survives the trimming of old stat lines
  for (const p of L.players) if (p.tid >= -1) { const w = war(p); if (w) p.cw = Math.round(((p.cw || 0) + w) * 10) / 10; }
}

// ---------- club records ----------
const REC = [
  ['HR', 'Home runs', 'b', s => s.HR || 0, 1, 0], ['RBI', 'Runs batted in', 'b', s => s.RBI || 0, 1, 0], ['H', 'Hits', 'b', s => s.H || 0, 1, 0],
  ['SB', 'Stolen bases', 'b', s => s.SB || 0, 1, 0], ['AVG', 'Batting average', 'b', s => s.AB ? s.H / s.AB : 0, 1, 'avg'],
  ['pW', 'Pitcher wins', 'p', s => s.W || 0, 1, 0], ['K', 'Strikeouts', 'p', s => s.K || 0, 1, 0], ['SV', 'Saves', 'p', s => s.SV || 0, 1, 0],
  ['ERA', 'ERA', 'p', s => s.O ? s.ER * 27 / s.O : 99, -1, 'era'],
];
export const REC_LIST = REC.map(([k, label, , , , fmt]) => ({ k, label, fmt }));
export function clubRecords(L) {
  const broken = [];
  for (const t of L.teams) {
    t.recs ??= {};
    const fresh = !Object.keys(t.recs).length;
    const mine = L.players.filter(p => p.tid === t.id);
    for (const [k, label, side, f, dir, fmt] of REC) {
      let best = null, bv = dir > 0 ? -1 : 99;
      for (const p of mine) {
        const s = side === 'b' ? p.st.b : p.st.p; if (!s) continue;
        if (side === 'b' && p.isP && !p.twoWay) continue;
        if (k === 'AVG' && (s.PA || 0) < L.games * 3.1) continue;
        if (k === 'ERA' && (s.O || 0) < L.games * 3) continue;
        const v = f(s); if (dir > 0 ? v > bv : v < bv) { bv = v; best = p; }
      }
      if (!best || (dir > 0 && bv <= 0)) continue;
      const cur = t.recs[k];
      if (!cur || (dir > 0 ? bv > cur.v : bv < cur.v)) {
        t.recs[k] = { v: Math.round(bv * 1000) / 1000, pid: best.id, nm: name(best), y: L.season };
        if (!fresh && t.id === L.userTid) broken.push(`${name(best)}: ${label.toLowerCase()} (${fmtRec(fmt, bv)})`);
      }
    }
    const tw = t.recs.tW;
    if (!tw || t.w > tw.v) { t.recs.tW = { v: t.w, y: L.season, nm: `${t.w}-${t.l}` }; if (!fresh && t.id === L.userTid && tw) broken.push(`Most wins in a season (${t.w})`); }
  }
  if (broken.length) {
    news(L, `New ${T(L, L.userTid).nick} club records: ${broken.join('; ')}.`, 'big', L.userTid);
    pop(L, { k: 'record', kick: 'Club record', title: broken.length > 1 ? `${broken.length} club records fall` : 'A club record falls', text: broken.join('. ') + '.', tid: L.userTid });
  }
}
export function fmtRec(fmt, v) { return fmt === 'avg' ? v.toFixed(3).replace(/^0/, '') : fmt === 'era' ? v.toFixed(2) : Math.round(v); }

// ---------- Hall of Fame ----------
const snap = (L, p) => ({
  pid: p.id, first: p.first, last: p.last, real: p.real || 0, face: p.face, pos: p.pos, isP: p.isP || 0, age: p.age,
  war: Math.round(careerWAR(p) * 10) / 10, awards: p.awards || [], tid: p.tid >= 0 ? p.tid : (p.lastTid || 0), y: L.season, mine: p.wasMine || 0,
});
// Players retire this winter and join next winter's ballot. Voters need 75%.
export function hofScore(s) {
  const n = k => s.awards.filter(a => a.includes(k)).length;
  return s.war + n('MVP') * 6 + n('Cy Young') * 6 + n('Rookie') * 1;
}
export function hofWinter(L, retiring) {
  ensureState(L);
  const res = [];
  for (const c of L.ballot) {
    c.yrs++;
    c.pct = clamp(Math.round(75 + (hofScore(c.s) - 60) * 2.8 + (c.yrs - 1) * 2.5 + L.rng.n() * 3), 0, 100);
    res.push({ s: c.s, pct: c.pct, yrs: c.yrs, in: c.pct >= 75 });
  }
  const inducted = res.filter(r => r.in);
  for (const r of inducted) {
    L.hof.push({ ...r.s, ind: L.season, pct: r.pct });
    news(L, `${r.s.first} ${r.s.last} is elected to the Hall of Fame with ${r.pct}% of the vote.`, 'big', r.s.tid, r.s.pid);
    if (r.s.mine) {
      unlock(L, 'legend');
      pop(L, { k: 'hof', kick: 'Hall of Fame', title: `${r.s.first} ${r.s.last} is a Hall of Famer`, text: `${r.pct}% of the vote. He played for you, and now he has a plaque.`, snap: r.s });
    }
  }
  L.ballot = L.ballot.filter(c => c.pct < 75 && c.pct >= 5 && c.yrs < 10);
  L.lastVote = { y: L.season, rows: res.sort((a, b) => b.pct - a.pct) };
  for (const p of retiring) {
    const s = snap(L, p);
    if (hofScore(s) >= 30) L.ballot.push({ s, yrs: 0, pct: 0 });
  }
}
export { snap as hofSnap };
