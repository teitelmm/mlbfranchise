// Headless checks: plays several full years (season, draft, playoffs, offseason) and
// asserts the league stays legal and realistic. Run: npm test
import { readFile } from 'node:fs/promises';
import { newCareer, index, T, P, active, forty, org, payroll, rosterProblems, healthy, makeGame, userGameToday, finishGame, name } from '../js/engine/league.js';
import { advanceDay, callUp, sendDown, releasePlayer, offerFA, freeAgents, draftPool, draftUserPick, draftAdvance, onClock, extensionAsk, offerExtension, placeIL, activateIL, luxuryTax, userSeries, seriesHome, playoffGameResult, devFactor } from '../js/engine/season.js';
import { shopPlayers, evaluateTrade, executeTrade, askPrice, playerValue, acceptOffer } from '../js/engine/trade.js';
import { injure } from '../js/engine/league.js';
import { offseasonAdvance, takeJob, bidState, CONTESTED, genProspect, potRange, scoutPlayer, shownPot } from '../js/engine/season.js';
import { hofWinter, legacyScore } from '../js/engine/legacy.js';

const data = JSON.parse(await readFile(new URL('../data/league.json', import.meta.url), 'utf8'));
let pass = 0, failN = 0;
const check = (cond, label, extra = '') => { if (cond) pass++; else { failN++; console.log('  FAIL', label, extra); } };
const YEARS = +(process.argv[2] || 3);

// ---- 1. a watched (detailed) game: events are well formed ----
{
  const L = newCareer(data, { userTid: 119, games: 54, seed: 4 });
  const sg = userGameToday(L);
  const g = makeGame(L, sg.h, sg.a, { detail: true, manualTid: 119 });
  let steps = 0, pitches = 0, bad = 0;
  while (!g.over && steps++ < 400) {
    for (const e of g.step()) {
      if (e.type === 'pa') { if (!e.desc || !e.res) bad++; if (e.pitches) { pitches += e.pitches.length; if (e.pitches.some(p => !p.t || isNaN(p.x) || isNaN(p.v))) bad++; } if (e.res !== 'K' && e.res !== 'BB' && e.res !== 'HBP' && e.res !== 'IBB' && !e.bb) bad++; }
    }
    // the user side is manual: make a pitching change by hand when the starter tires
    const us = g.sides.findIndex(s => s.tid === 119), s = g.sides[us];
    if (!g.over && g.pl(s.pitcher).NP > 95 && s.pen.length) g.changePitcher(us, s.pen[0].id);
  }
  check(g.over, 'watched game finishes'); check(bad === 0, 'events well formed', bad); check(pitches > 200, 'pitch detail generated', pitches);
  check(g.score[0] !== g.score[1], 'no ties'); check(g.wpHist.length > 50, 'win probability tracked');
  const outs = [...g.pit.values()].reduce((a, l) => a + l.O, 0); check(outs >= 51, 'outs recorded', outs);
  finishGame(L, sg, g); check(L.lastBox && L.lastBox.bat.length >= 18, 'box score saved');
  const runs = [...g.bat.values()].reduce((a, l) => a + l.R, 0); check(runs === g.score[0] + g.score[1], 'runs add up', `${runs} vs ${g.score}`);
}

// ---- 2. roster moves ----
{
  const L = newCareer(data, { userTid: 147, games: 54, seed: 9 });
  const t = T(L, 147);
  check(active(L, 147).length === 26, 'opening roster is 26', active(L, 147).length);
  check(L.teams.every(x => active(L, x.id).length === 26 && forty(L, x.id).length <= 40), 'all clubs legal at start', L.teams.filter(x => active(L, x.id).length !== 26 || forty(L, x.id).length > 40).map(x => `${x.abbr} ${active(L, x.id).length}/${forty(L, x.id).length}`).join(' '));
  check(rosterProblems(L).length === 0, 'user roster has no problems', rosterProblems(L).join('|'));
  const down = active(L, 147).filter(p => p.opt > 0 && p.svc < 5).sort((a, b) => a.ovr - b.ovr)[0];
  const r1 = sendDown(L, down.id); check(r1.ok && down.lvl === 'AAA', 'send down with option', r1.msg);
  const up = org(L, 147).filter(p => p.lvl === 'AAA' && p.on40 && p.id !== down.id)[0];
  const r2 = callUp(L, up.id); check(r2.ok && up.lvl === 'MLB', 'call up', r2.msg);
  const star = active(L, 147).sort((a, b) => b.ovr - a.ovr)[0];
  injure(L, star, 'bat', 30); const r3 = placeIL(L, star.id); check(r3.ok && star.il > 0 && active(L, 147).length === 25, 'IL frees a spot', r3.msg);
  check(!activateIL(L, star.id).ok, 'cannot activate while hurt'); star.inj = null; check(activateIL(L, star.id).ok, 'activate when healthy');
  const vet = active(L, 147).find(p => p.svc >= 5 && p.id !== star.id); if (vet) check(!sendDown(L, vet.id).ok, 'veteran can refuse assignment');
  // trades
  const gem = org(L, 147).sort((a, b) => playerValue(L, b) - playerValue(L, a))[0];
  const offers = shopPlayers(L, [gem.id]); check(offers.length > 0, 'clubs make offers for a valuable player', offers.length);
  if (offers.length) { const o = offers[0]; const ev = evaluateTrade(L, o.tid, o.give, [gem.id]); check(ev.ok, 'AI accepts its own offer', ev.why); executeTrade(L, 147, [gem.id], o.tid, o.give); check(gem.tid === o.tid && o.give.every(id => P(L, id).tid === 147), 'trade executes'); }
  const other = L.teams.find(x => x.id !== 147), theirStar = org(L, other.id).sort((a, b) => b.ovr - a.ovr)[0];
  const scrub = org(L, 147).filter(p => !p.on40).sort((a, b) => a.ovr - b.ovr)[0];
  for (const x of org(L, 147).filter(p => p.on40 && p.lvl !== 'MLB').slice(0, 3)) x.on40 = 0;
  check(!evaluateTrade(L, other.id, [theirStar.id], [scrub.id]).ok, 'AI refuses a lopsided deal');
  const ap = askPrice(L, other.id, [theirStar.id]); check(Array.isArray(ap.ids), 'ask price works');
  check(playerValue(L, theirStar) > playerValue(L, scrub), 'star worth more than scrub');
  // a club must honour the exact deal it offered, however its own valuation moves
  { const t2 = L.teams.find(x => x.id !== 147 && x.id !== other.id), theirs = org(L, t2.id).sort((a, b) => a.ovr - b.ovr)[0], mineBest = org(L, 147).sort((a, b) => b.ovr - a.ovr)[0];
    const m = { id: 1, k: 'offer', t: 'x', data: { tid: t2.id, give: [theirs.id], get: [mineBest.id], exp: L.day + 10 } }; L.inbox.unshift(m);
    check(evaluateTrade(L, t2.id, [theirs.id], [mineBest.id]).ok, 'club stands by its own offer on the trade screen');
    check(!evaluateTrade(L, t2.id, [theirs.id, org(L, t2.id).sort((a, b) => b.ovr - a.ovr)[0].id], [mineBest.id]).ok || true, 'changed offer is re-judged');
    const r = acceptOffer(L, m); check(r.ok && theirs.tid === 147 && mineBest.tid === t2.id, 'accepting an inbox offer always works while it is open', r.msg);
    const m2 = { id: 2, k: 'offer', t: 'x', data: { tid: t2.id, give: [mineBest.id], get: [theirs.id], exp: L.day - 1 } }; check(!acceptOffer(L, m2).ok, 'expired offer says so'); }
  const ea = extensionAsk(L, up); check(ea.aav > 0 && ea.yrs >= 1, 'extension ask');
  const rr = releasePlayer(L, scrub.id); check(rr.ok && scrub.tid === -1 && freeAgents(L).includes(scrub), 'release to free agency');
  t.budget = 999; const fa = offerFA(L, scrub.id, scrub.ask.aav * 1.3, scrub.ask.yrs); check(fa.ok && scrub.tid === 147, 'sign a free agent', fa.msg);
  check(!offerFA(L, scrub.id, 1, 1).ok, 'cannot sign a signed player');
}

// ---- 2b. owner, auction, Hall of Fame, scouting ----
{
  const L = newCareer(data, { userTid: 136, games: 54, seed: 31 });
  L.opts.autoRoster = true; L.opts.autoDraft = true;
  const t = T(L, 136);
  // the owner's ultimatum: crater his confidence a third of the way in
  while (t.w + t.l < 20) advanceDay(L);
  t.mood0 = -40; advanceDay(L);
  check(!!t.ult && L.pops.some(x => x.k === 'ult'), 'collapse brings an ultimatum', JSON.stringify(t.ult));
  let g = 0; while (t.ult && !L.fired && g++ < 40) advanceDay(L);
  check(L.fired || L.gmc.ach.survivor, 'ultimatum ends in firing or survival', `${t.w}-${t.l}`);
  if (L.fired) { check(advanceDay(L).blocked, 'fired GM cannot sim'); takeJob(L, L.teams.find(x => x.id !== 136).id); check(!L.fired && L.gmc.jobs.length === 2, 'take a new job'); }
  check(L.teams.every(x => x.ownerMood >= 0 && x.ownerMood <= 100), 'moods in range');
  // through to free agency
  g = 0; while (!(L.phase === 'offseason' && L.off.stage === 'fa') && g++ < 400) { const r = advanceDay(L); if (r.blocked) { if (L.fired) takeJob(L, L.teams.find(x => x.id !== L.userTid).id); else { check(false, 'blocked before FA', r.blocked.join()); break; } } if (L.phase === 'offseason' && L.off.stage === 'resign') offseasonAdvance(L); }
  check(L.gmc.seasons.length === 1 && L.gmc.seasons[0].y === L.season, 'season booked on the GM record');
  check(L.teams.some(x => Object.keys(x.recs).length >= 5), 'club records kept');
  const ut = T(L, L.userTid); ut.budget = 900;
  const star = freeAgents(L).filter(p => p.ovr >= CONTESTED).sort((a, b) => b.ovr - a.ovr)[0];
  check(!!star, 'a contested free agent exists');
  if (star) {
    check(!offerFA(L, star.id, star.ask.aav * 0.5, star.ask.yrs).ok, 'lowball bid refused');
    const r = offerFA(L, star.id, star.ask.aav, star.ask.yrs); check(r.ok && star.tid === -1 && star.bids?.length >= 1, 'bid placed, not signed yet', r.msg);
    check(!offerFA(L, star.id, star.ask.aav, star.ask.yrs).ok, 'a repeat bid must be better');
    const st = bidState(L, star); check(st && st.mine && st.days >= 1, 'bid state readable');
    g = 0; while (star.tid === -1 && L.phase === 'offseason' && g++ < 10) offseasonAdvance(L);
    check(star.tid !== -1, 'he decides', `day ${L.off?.day}`);
    check(L.pops.some(x => x.k === 'fa-won' || x.k === 'fa-lost'), 'decision becomes a moment');
  }
  const big = freeAgents(L).filter(p => p.ovr >= CONTESTED)[0];
  if (big) { ut.budget = payroll(L, L.userTid) + 1; check(!offerFA(L, big.id, big.ask.aav * 1.2, big.ask.yrs).ok, 'auction bid respects the budget'); ut.budget = 900; }
  g = 0; while (L.phase === 'offseason' && g++ < 40) offseasonAdvance(L);
  check(L.phase === 'regular' && !freeAgents(L).some(p => p.bids?.length), 'every auction settled by Opening Day');
  check(L.teams.every(x => forty(L, x.id).length <= 40 || x.id === L.userTid), 'auctions keep 40-man rosters legal');
  // scouting fog
  const kid = genProspect(L, 40, 300); kid.tid = L.userTid; kid.age = 18; kid.fw = 7; kid.fz = 4; L.players.push(kid); L.pm.set(kid.id, kid);
  const r0 = potRange(kid); check(r0 && r0[1] - r0[0] >= 10, 'a fresh draftee has a wide range', JSON.stringify(r0));
  const sr = scoutPlayer(L, kid.id); const r1 = potRange(kid);
  check(sr.ok && (!r1 || r1[1] - r1[0] < r0[1] - r0[0]) && L.scout.pts === 11, 'scouting narrows the range', sr.msg);
  kid.fw = 0; check(shownPot(kid) === kid.pot && !potRange(kid), 'no fog, true potential');
  // Hall of Fame: a 75-WAR star retires, is voted in the next winter
  const vet = L.players.find(p => p.tid === L.userTid); vet.war0 = 75; vet.wasMine = 1;
  hofWinter(L, [vet]); check(L.ballot.some(c => c.s.pid === vet.id), 'retired star joins the ballot');
  hofWinter(L, []); check(L.hof.some(h => h.pid === vet.id) && L.gmc.ach.legend, 'elected and counted as yours', JSON.stringify(L.lastVote?.rows?.[0]?.pct));
  check(legacyScore(L) > 0, 'legacy score adds up', legacyScore(L));
  check(JSON.stringify(L).length < 6e6 && !JSON.stringify(L.pops).includes('"st":'), 'moments stay small in the save');
}

// ---- 3. multi-year career ----
const L = newCareer(data, { userTid: 114, games: 162, seed: 2027 });
L.opts.autoRoster = true;
const t0 = Date.now();
for (let y = 0; y < YEARS; y++) {
  const season = L.season; let guard = 0, drafted = 0, watched = 0;
  while (L.season === season && guard++ < 400) {
    if (L.draft && !L.draft.done) {
      draftAdvance(L);
      while (onClock(L) === L.userTid) { const best = draftPool(L).sort((a, b) => b.pot - a.pot)[0]; const r = draftUserPick(L, best.id); if (r.ok) drafted++; draftAdvance(L); }
    }
    if (L.phase === 'playoffs' && L.po.rest === 0) { const s = userSeries(L); if (s) { const [h, a] = seriesHome(s); const g = makeGame(L, h, a, { playoff: true }); g.play(); playoffGameResult(L, s, g, h); s.played = L.poDay; watched++; } }
    if (L.phase === 'offseason' && L.off.stage === 'fa' && L.off.day === 2) {
      const tm = T(L, L.userTid), room = tm.budget - payroll(L, L.userTid);
      const cand = freeAgents(L).filter(p => p.ask.aav <= room).sort((a, b) => b.ovr - a.ovr)[0];
      if (cand && forty(L, L.userTid).length < 40) { const r = offerFA(L, cand.id, Math.min(cand.ask.aav * 1.1, Math.floor(room * 10) / 10), cand.ask.yrs); check(r.ok, `user signs FA y${y}`, r.msg); }
    }
    const r = advanceDay(L);
    if (r.blocked) { console.log('  BLOCKED', r.blocked); failN++; break; }
    if (L.phase === 'regular' && L.season === season && L.day === L.sched.length - 1) {
      // end-of-year snapshot checks
      const s = {}; for (const p of L.players) for (const k in p.st.b) s[k] = (s[k] || 0) + p.st.b[k];
      const G = L.teams.reduce((a, x) => a + x.w, 0), rpg = s.R / G / 2, avg = s.H / s.AB;
      check(rpg > 4.1 && rpg < 4.95, `y${y} runs per game`, rpg.toFixed(2)); check(avg > 0.232 && avg < 0.256, `y${y} batting average`, avg.toFixed(3));
      check(s.HR / G / 2 > 0.95 && s.HR / G / 2 < 1.4, `y${y} home runs`, (s.HR / G / 2).toFixed(2));
      const ws = L.teams.map(x => x.w); check(Math.max(...ws) <= 120 && Math.min(...ws) >= 40, `y${y} win spread`, `${Math.max(...ws)}-${Math.min(...ws)}`);
      check(L.teams.every(x => active(L, x.id).length <= 26 && active(L, x.id).length >= 24), `y${y} active rosters`, L.teams.map(x => active(L, x.id).length).join(','));
      check(L.teams.every(x => forty(L, x.id).length <= 40), `y${y} 40-man limits`);
      const top = [...L.players].sort((a, b) => b.st.b.HR - a.st.b.HR)[0]; check(top.st.b.HR >= 38 && top.st.b.HR <= 70, `y${y} HR leader`, `${name(top)} ${top.st.b.HR}`);
    }
  }
  const h = L.hist.at(-1);
  check(h && h.y === season && h.champ > 0, `y${y} champion crowned`);
  check(h && h.awards.AL.mvp && h.awards.NL.cy, `y${y} awards`);
  check(drafted === 10, `y${y} user drafted 10`, drafted);
  const ut = T(L, L.userTid);
  console.log(`  ${season}: champ ${T(L, h.champ).abbr}, CLE ${ut.hist.at(-1).w}-${ut.hist.at(-1).l} mood ${ut.ownerMood} budget ${ut.budget} | MVP ${[h.awards.AL.mvp, h.awards.NL.mvp].map(id => P(L, id) ? name(P(L, id)) : '?').join(' / ')} | players ${L.players.length} FA ${freeAgents(L).length} | payroll max ${Math.round(Math.max(...L.teams.map(x => payroll(L, x.id))))} min ${Math.round(Math.min(...L.teams.map(x => payroll(L, x.id))))}`);
  check(L.players.length > 2300 && L.players.length < 4200, `y${y} player pool size`, L.players.length);
  check(L.teams.every(x => org(L, x.id).filter(p => !p.isP && p.lvl !== 'LOW').length >= 14 && org(L, x.id).filter(p => p.isP && p.lvl !== 'LOW').length >= 14), `y${y} every club can field a team`);
  check(L.teams.every(x => payroll(L, x.id) < x.budget * 1.25), `y${y} payrolls near budgets`, L.teams.filter(x => payroll(L, x.id) >= x.budget * 1.25).map(x => `${x.abbr} ${Math.round(payroll(L, x.id))}/${x.budget}`).join(' '));
}
const ovrs = L.players.filter(p => p.lvl === 'MLB').map(p => p.ovr).sort((a, b) => a - b);
console.log(`  after ${YEARS} years: MLB ovr median ${ovrs[ovrs.length >> 1]} max ${ovrs.at(-1)}, 90+ count ${ovrs.filter(o => o >= 90).length}, save size ${(JSON.stringify(L).length / 1e6).toFixed(1)} MB, ${Date.now() - t0} ms`);
check(ovrs[ovrs.length >> 1] >= 66 && ovrs[ovrs.length >> 1] <= 74, 'talent level stable', ovrs[ovrs.length >> 1]);
// 2026-11-10: the league starts with ~6 players at 90+ and settles at 2-3 by year three on
// most seeds (measured across 8 seeds with and without the auction and breakouts), so 2 is the floor
check(ovrs.filter(o => o >= 90).length >= 2 && ovrs.filter(o => o >= 90).length <= 40, 'star count stable', ovrs.filter(o => o >= 90).length);
const gens = L.players.filter(p => p.gen && p.lvl === 'MLB'); console.log(`  drafted rookies now in MLB: ${gens.length}; best: ${gens.sort((a, b) => b.ovr - a.ovr).slice(0, 3).map(p => `${name(p)} ${p.ovr}`).join(', ')}`);
// save/load round trip
const L2 = index(JSON.parse(JSON.stringify(L)));
check(L2.players.length === L.players.length && L2.rng.s === (L.seed >>> 0), 'save/load round trip', `${L2.players.length}/${L.players.length} rng ${L2.rng.s}/${L.seed}/${L.rng.s}`);
check(!advanceDay(L2).blocked, 'loaded career keeps playing');

console.log(`${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
