// Player value and trades.
import { P, T, org, active, forty, payroll, news, inbox, name, autoLineup, autoPitching, FORTY_MAX, aiRosterUpkeep, healthy } from './league.js';
import { marketValue, MIN_SALARY } from './money.js';
import { clamp } from './ratings.js';
import { unlock } from './legacy.js';

export function tradeDeadlineDay(L) { return Math.round(L.sched.length * 0.67); }
export const deadlinePassed = L => L.phase === 'regular' && L.day > tradeDeadlineDay(L);

// years of team control left, including this season
export function controlYears(L, p) {
  const byContract = Math.max(1, p.con.exp - L.season + 1);
  if (p.svc >= 6) return byContract;
  return Math.max(byContract, Math.ceil(6 - p.svc));
}

// Surplus value in $M: what he should produce minus what he is paid, over his control years.
export function playerValue(L, p, mode = 'mid') {
  const yrs = Math.min(7, controlYears(L, p));
  const rp = p.isP && p.role === 'RP';
  const frac = L.phase === 'regular' ? clamp(1 - L.day / L.sched.length, 0.15, 1) : 1;
  let v = 0, ovr = p.ovr, age = p.age, svc = p.svc;
  for (let y = 0; y < yrs; y++) {
    if (y > 0) {
      if (age <= 27) ovr += (p.pot - ovr) * 0.32; else if (age >= 31) ovr -= 0.7 + (age - 31) * 0.35;
      age++; svc++;
    }
    let prod = marketValue(Math.round(ovr), rp);
    if (ovr < 66) prod = 0.25;                                  // not a big leaguer yet
    let cost;
    if (y < Math.max(1, p.con.exp - L.season + 1) && (p.svc >= 6 || p.con.sal > MIN_SALARY * 1.5)) cost = p.con.sal;
    else if (svc < 3) cost = MIN_SALARY;
    else if (svc < 6) cost = Math.max(MIN_SALARY, prod * [0.28, 0.45, 0.62][Math.floor(svc) - 3]);
    else cost = prod;
    let w = Math.pow(0.9, y) * (y === 0 ? frac : 1);
    if (mode === 'contend') w *= y === 0 ? 1.25 : y >= 3 ? 0.8 : 1;
    if (mode === 'rebuild') w *= y === 0 ? 0.6 : y >= 2 ? 1.15 : 0.9;
    v += (prod - cost) * w;
  }
  // upside lottery for young talent that is not close yet
  if (p.age <= 23 && p.pot >= 74) v += (marketValue(p.pot, rp) - marketValue(Math.max(66, p.ovr), rp)) * 0.22 * (mode === 'rebuild' ? 1.25 : mode === 'contend' ? 0.8 : 1);
  if (p.inj && p.inj.days > 30) v *= 0.75;
  return v;
}

export function teamMode(L, t) {
  if (L.phase !== 'regular' || t.w + t.l < 25) return t.rank0 <= 10 ? 'contend' : t.rank0 >= 22 ? 'rebuild' : 'mid';
  const pct = t.w / (t.w + t.l);
  return pct >= 0.54 ? 'contend' : pct <= 0.45 ? 'rebuild' : 'mid';
}

// Would the AI club `aiTid` do this deal?  give = ids the AI gives up, get = ids it receives.
export function evaluateTrade(L, aiTid, give, get) {
  const t = T(L, aiTid), mode = teamMode(L, t);
  // a club never turns down the exact deal it proposed itself
  if (standingOffer(L, aiTid, give, get)) return { ok: true, why: `This is the ${t.nick}' own offer. They will do it.`, vIn: 1, vOut: 1, own: true };
  const out = give.map(id => P(L, id)), inn = get.map(id => P(L, id));
  const vOut = out.reduce((s, p) => s + Math.max(playerValue(L, p, mode), playerValue(L, p, 'mid')), 0);
  const vIn = inn.reduce((s, p) => s + playerValue(L, p, mode), 0);
  // too many bodies is worth less than one good player
  const depthPenalty = Math.max(0, inn.length - out.length - 1) * 1.5;
  const need = vOut * (vOut > 0 ? 1.08 : 0.92) + 0.4 + depthPenalty;
  const payAfter = payroll(L, aiTid) - out.filter(p => p.on40).reduce((s, p) => s + p.con.sal, 0) + inn.filter(p => p.on40).reduce((s, p) => s + p.con.sal, 0);
  if (payAfter > t.budget * 1.04 && payAfter > payroll(L, aiTid)) return { ok: false, why: `${t.nick} cannot take on that much salary.`, vIn, vOut: need };
  const best = [...inn].sort((a, b) => playerValue(L, b, mode) - playerValue(L, a, mode))[0];
  if (out.some(p => p.ovr >= 86 && p.age <= 29) && mode !== 'rebuild' && vIn < need * 1.25) return { ok: false, why: `${t.nick} will not move a franchise player without a huge return.`, vIn, vOut: need };
  if (vIn >= need) return { ok: true, why: 'Deal.', vIn, vOut: need };
  const gap = need - vIn;
  return { ok: false, why: gap < 4 ? `${t.nick} are close. They want a little more.` : gap < 15 ? `${t.nick} want noticeably more value.` : `${t.nick} are not interested. That offer is far too light.`, vIn, vOut: need, gap };
}

export function executeTrade(L, tidA, idsA, tidB, idsB) {
  const move = (ids, to) => { for (const id of ids) { const p = P(L, id); p.tid = to; if (p.lvl === 'MLB' && !healthy(p) && !p.il) { /* stays */ } p.il = p.il && !healthy(p) ? p.il : 0; } };
  const namesA = idsA.map(id => name(P(L, id))), namesB = idsB.map(id => name(P(L, id)));
  move(idsA, tidB); move(idsB, tidA);
  for (const tid of [tidA, tidB]) {
    const t = T(L, tid);
    // keep the 40-man legal
    let f = forty(L, tid);
    while (f.length > FORTY_MAX && tid !== L.userTid) {
      const drop = f.filter(p => p.lvl !== 'MLB').sort((a, b) => a.ovr + (a.pot - a.ovr) * 0.5 - (b.ovr + (b.pot - b.ovr) * 0.5))[0] || f.sort((a, b) => a.ovr - b.ovr)[0];
      drop.on40 = 0; if (drop.lvl === 'MLB') drop.lvl = 'AAA'; f = forty(L, tid);
    }
    if (tid !== L.userTid) aiRosterUpkeep(L, t);
    else { if (L.opts.autoLineup) autoLineup(L, t); if (L.opts.autoPitch) autoPitching(L, t); }
  }
  const got = tidA === L.userTid ? idsB : tidB === L.userTid ? idsA : [];
  if (got.some(id => P(L, id).ovr >= 85)) unlock(L, 'blockbuster');
  const a = T(L, tidA), b = T(L, tidB);
  const txt = `TRADE: ${a.abbr} send ${namesA.join(', ')} to ${b.abbr} for ${namesB.join(', ')}.`;
  L.tx.unshift({ d: L.day, y: L.season, t: txt, tid: tidA, tid2: tidB });
  news(L, txt, 'trade', tidA);
}

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
export const offerOpen = (L, m) => m.k === 'offer' && !m.done && m.data && !(L.phase === 'regular' && (L.day > m.data.exp || deadlinePassed(L))) && L.phase !== 'playoffs';
export function standingOffer(L, aiTid, give, get) {
  return L.inbox.find(m => offerOpen(L, m) && m.data.tid === aiTid && sameSet(m.data.give, give) && sameSet(m.data.get, get)) || null;
}
export const openOffers = L => L.inbox.filter(m => offerOpen(L, m) && m.data.give.every(id => P(L, id)?.tid === m.data.tid) && m.data.get.every(id => P(L, id)?.tid === L.userTid));

// What would other clubs give for these players of mine? One package per interested club.
export function shopPlayers(L, ids, max = 6) {
  const offers = [];
  const mine = ids.map(id => P(L, id));
  for (const t of L.teams) {
    if (t.id === L.userTid) continue;
    const mode = teamMode(L, t);
    const want = mine.reduce((s, p) => s + playerValue(L, p, mode), 0);
    if (want < 1) continue;
    const pay = payroll(L, t.id) + mine.filter(p => p.on40).reduce((s, p) => s + p.con.sal, 0);
    if (pay > t.budget * 1.04) continue;
    // build a package from their tradeable players that they value at ~92% of what they get
    const pool = org(L, t.id).filter(p => !(p.ovr >= 86 && p.age <= 29) && (p.lvl !== 'LOW' || p.pot >= 68))
      .map(p => ({ p, v: Math.max(playerValue(L, p, mode), playerValue(L, p, 'mid')) })).filter(x => x.v > 0.8).sort((a, b) => b.v - a.v);
    const target = want / 1.08 - 0.5;
    const pack = []; let sum = 0;
    for (const x of pool) {
      if (pack.length >= 4) break;
      if (sum + x.v <= target) { pack.push(x.p); sum += x.v; }
      if (sum >= target * 0.9) break;
    }
    if (!pack.length || sum < target * 0.6) continue;
    const payBack = pay - pack.filter(p => p.on40).reduce((s, p) => s + p.con.sal, 0);
    if (payBack > t.budget * 1.04) continue;
    offers.push({ tid: t.id, give: pack.map(p => p.id), value: sum, mode });
  }
  return offers.sort((a, b) => b.value - a.value).slice(0, max);
}

// What would the AI need from me to hand over these players?
export function askPrice(L, aiTid, wantIds) {
  const t = T(L, aiTid), mode = teamMode(L, t);
  const res = evaluateTrade(L, aiTid, wantIds, []);
  const need = res.vOut;
  const pool = org(L, L.userTid).map(p => ({ p, v: playerValue(L, p, mode) })).filter(x => x.v > 0.8).sort((a, b) => b.v - a.v);
  const pack = []; let sum = 0;
  // start from the smallest single piece that covers it, otherwise stack from the top
  const single = [...pool].reverse().find(x => x.v >= need);
  if (single && single.v < need * 1.35) return { ids: [single.p.id], enough: true };
  for (const x of pool) { if (pack.length >= 4 || sum >= need) break; if (x.v <= need * 1.1) { pack.push(x.p.id); sum += x.v; } }
  return { ids: pack, enough: sum >= need };
}

// ---------- AI activity ----------
function aiAiTrade(L) {
  const cont = L.teams.filter(t => t.id !== L.userTid && teamMode(L, t) === 'contend');
  const reb = L.teams.filter(t => t.id !== L.userTid && teamMode(L, t) === 'rebuild');
  if (!cont.length || !reb.length) return;
  const buyer = L.rng.pick(cont), seller = L.rng.pick(reb);
  const vets = active(L, seller.id).filter(p => p.age >= 28 && p.ovr >= 76 && controlYears(L, p) <= 2 && healthy(p)).sort((a, b) => b.ovr - a.ovr);
  const vet = vets[L.rng.i(Math.min(3, vets.length))];
  if (!vet) return;
  if (payroll(L, buyer.id) + vet.con.sal > buyer.budget * 1.04) return;
  const want = playerValue(L, vet, 'contend');
  if (want < 2) return;
  const pool = org(L, buyer.id).filter(p => p.lvl !== 'MLB' && p.age <= 25).map(p => ({ p, v: playerValue(L, p, 'rebuild') })).filter(x => x.v > 0.8).sort((a, b) => b.v - a.v);
  const pack = []; let sum = 0;
  for (const x of pool) { if (pack.length >= 3 || sum >= want * 0.92) break; if (sum + x.v <= want * 1.1) { pack.push(x.p.id); sum += x.v; } }
  if (sum < want * 0.8 || !pack.length) return;
  executeTrade(L, seller.id, [vet.id], buyer.id, pack);
}

function aiOfferToUser(L) {
  const ut = T(L, L.userTid);
  const others = L.teams.filter(t => t.id !== L.userTid);
  const t = L.rng.pick(others), mode = teamMode(L, t);
  const umode = teamMode(L, ut);
  // they ask for a player that fits their timeline
  const targets = org(L, L.userTid).filter(p => mode === 'contend' ? (p.lvl === 'MLB' && p.ovr >= 74 && p.ovr < 88) : (p.age <= 25 && p.pot >= 74))
    .map(p => ({ p, v: playerValue(L, p, mode) })).filter(x => x.v > 3);
  if (!targets.length) return;
  const tg = L.rng.pick(targets);
  const pool = org(L, t.id).filter(p => !(p.ovr >= 86 && p.age <= 29)).filter(p => umode === 'rebuild' ? p.age <= 25 : true)
    .map(p => ({ p, v: playerValue(L, p, mode), uv: playerValue(L, p, umode) })).filter(x => x.v > 0.8 && x.uv > 0.5).sort((a, b) => b.uv - a.uv);
  const pack = []; let sum = 0;
  for (const x of pool) { if (pack.length >= 3) break; if (sum + x.v <= tg.v / 1.08) { pack.push(x.p.id); sum += x.v; } if (sum >= tg.v / 1.08 * 0.88) break; }
  if (!pack.length || sum < tg.v * 0.65) return;
  const inc = pack.filter(id => P(L, id).on40).reduce((s, id) => s + P(L, id).con.sal, 0) - (tg.p.on40 ? tg.p.con.sal : 0);
  if (payroll(L, L.userTid) + inc > ut.budget) return;
  inbox(L, `The ${t.name} offer ${pack.map(id => name(P(L, id))).join(', ')} for ${name(tg.p)}.`, 'offer', tg.p.id, { tid: t.id, give: pack, get: [tg.p.id], exp: L.day + 10 });
}

export function dailyTrades(L) {
  if (L.phase !== 'regular') return;
  const dl = tradeDeadlineDay(L);
  if (L.day > dl || L.day < 20) return;
  const hot = L.day > dl - 14;
  if (L.rng.chance(hot ? 0.45 : 0.07)) aiAiTrade(L);
  if (L.rng.chance(hot ? 0.16 : 0.035)) aiOfferToUser(L);
  if (L.day === dl) news(L, 'The trade deadline has passed. No more trades until the offseason.', 'big');
}

export function acceptOffer(L, msg) {
  const o = msg.data;
  if (!o || msg.done) return { ok: false, msg: 'Offer no longer available.' };
  if (L.phase === 'regular' && (L.day > o.exp || deadlinePassed(L))) { msg.done = 1; return { ok: false, msg: deadlinePassed(L) ? 'The trade deadline has passed.' : 'That offer expired. Offers stay open for 10 days.' }; }
  const all = [...o.give.map(id => P(L, id)), ...o.get.map(id => P(L, id))];
  if (o.give.some(id => P(L, id)?.tid !== o.tid) || o.get.some(id => P(L, id)?.tid !== L.userTid) || all.some(p => !p)) { msg.done = 1; return { ok: false, msg: 'A player in that offer has since moved.' }; }
  executeTrade(L, L.userTid, o.get, o.tid, o.give);
  msg.done = 1;
  return { ok: true, msg: 'Trade completed.' };
}
