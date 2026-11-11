// The franchise hub: the home screen, built from tiles like a console franchise mode.
import { S, views, on, esc, face, faceUrl, avatarSvg, logo, plink, ovr, money, pname, ord, trait, sfx } from './core.js';
import { P, T, active, forty, org, payroll, healthy, standings, userGameToday, probableSP, rosterProblems, teamStrength, ACTIVE_MAX } from '../engine/league.js';
import { luxuryTax, userSeries, seriesHome, freeAgents, onClock, FA_DAYS, shownPot, bidState } from '../engine/season.js';
import { ultStatus, crowd } from '../engine/owner.js';
import { bat, pit, f3, ip } from '../engine/stats.js';
import { defAt } from '../engine/ratings.js';
import { lineBoard } from './views.js';

const rec = t => `${t.w}-${t.l}`;
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 60;

export function teamRatings(L, tid) {
  const a = active(L, tid), t = T(L, tid);
  const hit = a.filter(p => !p.isP || p.twoWay).sort((x, y) => y.ovr - x.ovr).slice(0, 9);
  const sp = a.filter(p => p.isP && p.role === 'SP').sort((x, y) => y.ovr - x.ovr).slice(0, 5);
  const rp = a.filter(p => p.isP && p.role === 'RP').sort((x, y) => y.ovr - x.ovr).slice(0, 5);
  const lu = (t.lineup?.R || []).map(([id, pos]) => [P(L, id), pos]).filter(x => x[0] && x[1] !== 'DH');
  return {
    ovr: teamStrength(L, tid), off: avg(hit.map(p => p.ovr)), rot: avg(sp.map(p => p.ovr)), pen: avg(rp.map(p => p.ovr)),
    def: lu.length ? 50 + (avg(lu.map(([p, pos]) => defAt(p, pos))) - 50) * 0.9 + 18 : 68,
  };
}
function ranks(L) {
  const all = L.teams.map(t => ({ id: t.id, r: teamRatings(L, t.id) }));
  const rk = k => { const s = [...all].sort((a, b) => b.r[k] - a.r[k]); return s.findIndex(x => x.id === L.userTid) + 1; };
  const me = all.find(x => x.id === L.userTid).r;
  return { me, rk: { ovr: rk('ovr'), off: rk('off'), rot: rk('rot'), pen: rk('pen'), def: rk('def') } };
}

// What the GM should deal with right now.
export function todo(L) {
  const t = T(L, L.userTid), out = [];
  const add = (text, v, label, hot = false, act = 'go', id = '') => out.push({ text, v, label, hot, act, id });
  if (L.fired) { add('You were let go. Find a new club.', 'jobs', 'Job offers', true); return out; }
  const u = ultStatus(L, t);
  if (u) add(`Owner's ultimatum: win ${u.need} of ${u.n}. You are ${u.won}-${u.played - u.won} with ${u.left} to play.`, 'lineup', 'Lineup', true);
  if (L.draft && !L.draft.done) add(onClock(L) === L.userTid ? 'You are on the clock in the draft.' : 'The draft is under way.', 'draft', 'Draft room', true);
  if (L.phase === 'offseason') for (const p of freeAgents(L)) { const b = bidState(L, p); if (b?.mine && !b.leading) add(`Outbid for ${pname(p)}: the ${T(L, b.lead.tid).nick} offer $${b.lead.aav.toFixed(1)}M. He decides in ${b.days} day${b.days === 1 ? '' : 's'}.`, '', 'Raise', true, 'fa-offer', p.id); }
  for (const m of L.inbox.filter(m => m.k === 'offer' && !m.done).slice(0, 2)) add(m.t, 'inbox', 'See offer', true);
  if (L.phase !== 'offseason') for (const pr of rosterProblems(L)) add(pr, 'roster', 'Fix roster', true);
  const mine = org(L, t.id);
  for (const p of mine.filter(p => p.lvl === 'MLB' && !p.il && p.inj && p.inj.days >= 3)) add(`${pname(p)} is hurt (${p.inj.name}, ${p.inj.days} days).`, '', 'Put on IL', true, 'il', p.id);
  for (const p of mine.filter(p => p.il && healthy(p))) add(`${pname(p)} is healthy again.`, '', 'Activate', true, 'activate', p.id);
  const act = active(L, t.id);
  if (L.phase !== 'offseason' && act.length < ACTIVE_MAX) add(`You have ${ACTIVE_MAX - act.length} open spot${ACTIVE_MAX - act.length > 1 ? 's' : ''} on the active roster.`, 'roster', 'Call someone up');
  if (L.phase === 'offseason') {
    const exp = mine.filter(p => p.expiring);
    if (exp.length) add(`${exp.length} player${exp.length > 1 ? 's are' : ' is'} out of contract: ${exp.slice(0, 3).map(p => p.last).join(', ')}${exp.length > 3 ? '…' : ''}.`, 'money', 'Re-sign', true);
    if (L.off.stage === 'fa') { const room = t.budget - payroll(L, t.id); const best = freeAgents(L).filter(p => p.ask.aav <= room).sort((a, b) => b.ovr - a.ovr)[0]; if (best && best.ovr >= 72) add(`${pname(best)} (${Math.round(best.ovr)} overall) is on the market and fits your budget.`, 'fa', 'Free agents'); }
  } else {
    // a kid in Triple-A who is better than a big-league regular
    const worstH = act.filter(p => !p.isP).sort((a, b) => a.ovr - b.ovr)[0], worstP = act.filter(p => p.isP).sort((a, b) => a.ovr - b.ovr)[0];
    const kid = mine.filter(p => p.lvl === 'AAA' && healthy(p) && p.ovr >= ((p.isP ? worstP : worstH)?.ovr ?? 99) + 3).sort((a, b) => b.ovr - a.ovr)[0];
    if (kid) add(`${pname(kid)} (${Math.round(kid.ovr)} overall) has outgrown Triple-A.`, 'minors', 'Minor leagues');
    const ready = mine.filter(p => p.lvl === 'LOW' && p.ovr >= 63 && p.age <= 25).length;
    if (ready) add(`${ready} prospect${ready > 1 ? 's have' : ' has'} outgrown Double-A and need${ready > 1 ? '' : 's'} Triple-A to keep improving.`, 'minors', 'Promote');
    const walk = act.filter(p => p.svc >= 6 && p.con.exp <= L.season && !p.con.next && p.ovr >= 78);
    if (walk.length) add(`${walk.slice(0, 2).map(p => p.last).join(' and ')} can leave as free agent${walk.length > 1 ? 's' : ''} after the season.`, 'money', 'Extend');
  }
  const unread = L.inbox.filter(m => m.unread).length;
  if (unread) add(`${unread} unread message${unread > 1 ? 's' : ''}.`, 'inbox', 'Inbox');
  return out;
}

function statLine(p) {
  if (p.isP && !p.twoWay) { const s = p.st.p || {}; return s.BF ? `${s.W}-${s.L} · ${pit(s).era.toFixed(2)} ERA · ${s.K} K${s.SV ? ` · ${s.SV} SV` : ''}` : 'No innings yet'; }
  const s = p.st.b; return s.AB ? `${f3(bat(s).avg)} · ${s.HR} HR · ${s.RBI} RBI${s.SB >= 5 ? ` · ${s.SB} SB` : ''}` : 'No at-bats yet';
}
export function starCard(p, tag = '') {
  const tr = trait(p);
  return `<button class="scard t-${tr.k}" data-act="player" data-id="${p.id}">
    <span class="sc-ovr"><b>${Math.round(p.ovr)}</b><i>${p.pos}</i></span>
    <img class="sc-face" loading="lazy" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">
    <span class="sc-name"><small>${esc(p.first)}</small>${esc(p.last)}</span>
    <span class="sc-line">${statLine(p)}</span>
    <span class="sc-trait">${tag || tr.label}</span>
  </button>`;
}
// how job security has moved since Opening Day
function trend(t) {
  if (t.mood0 === undefined || S.L.phase !== 'regular') return '';
  const d = Math.round(t.ownerMood - Math.max(0, Math.min(100, t.mood0)));
  return d ? ` <span class="${d > 0 ? 'good' : 'bad'}" title="Since Opening Day">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>` : '';
}
const meter = (label, v, rk) => `<div class="meter"><span>${label}</span><div class="bar"><i style="width:${Math.max(6, Math.min(100, (v - 55) / 35 * 100))}%"></i></div><b>${Math.round(v)}</b><em>${ord(rk)}</em></div>`;

views.home = () => {
  const L = S.L, t = T(L, L.userTid);
  const list = todo(L).slice(0, 4);
  const g = L.phase === 'regular' ? userGameToday(L) : null;
  const ser = L.phase === 'playoffs' ? userSeries(L) : null;
  const blocked = L.phase !== 'offseason' && rosterProblems(L).length;
  const simAhead = `<select class="btn big ghost" data-chg="simto" aria-label="Sim ahead"><option value="">Sim ahead</option><option value="7">One week</option><option value="30">One month</option><option value="asb">To the draft</option><option value="dl">To the trade deadline</option><option value="phase">To the end of the season</option></select>`;
  let big;
  const matchup = (a, h, cap, sub, buttons, spA, spH) => `<section class="tile t-play" style="--ca:${a.c1};--ch:${h.c1}">
      <div class="tp-cap"><span>${cap}</span><span>${sub}</span></div>
      <div class="tp-vs"><div class="tp-side">${logo(a.id, 96)}<b>${esc(a.nick)}</b><span>${rec(a)}</span></div><div class="tp-at">${a.id === L.userTid ? 'AT' : 'VS'}</div><div class="tp-side">${logo(h.id, 96)}<b>${esc(h.nick)}</b><span>${rec(h)}</span></div></div>
      <div class="tp-sp"><span>${spA ? `${face(spA, 34)} ${esc(spA.last)} <i>${Math.round(spA.ovr)}</i>` : ''}</span><span>${spH ? `<i>${Math.round(spH.ovr)}</i> ${esc(spH.last)} ${face(spH, 34)}` : ''}</span></div>
      <div class="tp-btn">${buttons}</div></section>`;
  if (g) {
    const h = T(L, g.h), a = T(L, g.a);
    big = matchup(a, h, `Game ${t.w + t.l + 1} of ${L.games}`, esc(h.park.name), blocked ? '<button class="btn pri huge" data-act="go" data-v="roster">Fix your roster first</button>' : `<button class="btn pri huge" data-act="play">Play game</button><button class="btn big" data-act="adv">Sim game</button>${simAhead}`, probableSP(L, a), probableSP(L, h));
  } else if (ser) {
    const [hId, aId] = seriesHome(ser), h = T(L, hId), a = T(L, aId);
    big = matchup(a, h, `Playoffs · game ${ser.g.length + 1}, best of ${ser.n}`, `${T(L, ser.a).abbr} ${ser.wa} - ${ser.wb} ${T(L, ser.b).abbr}`, L.po.rest ? '<button class="btn pri huge" data-act="adv">Continue</button>' : '<button class="btn pri huge" data-act="play">Play game</button><button class="btn big" data-act="adv">Sim game</button>', probableSP(L, a), probableSP(L, h));
  } else {
    const [title, text, btn] = L.phase === 'offseason'
      ? (L.off.stage === 'resign' ? ['Offseason', 'Re-sign your own players, then open the market.', '<button class="btn pri huge" data-act="adv">Open free agency</button><button class="btn big" data-act="go" data-v="money">Contracts</button>']
        : [`Free agency · day ${L.off.day + 1} of ${FA_DAYS}`, 'The best players sign early. Prices drop later.', '<button class="btn pri huge" data-act="adv">Next day</button><button class="btn big" data-act="go" data-v="fa">Free agents</button><button class="btn big ghost" data-act="sim" data-to="season">Skip to Opening Day</button>'])
      : L.phase === 'playoffs' ? ['October', t.po ? 'Waiting on the next round.' : 'Your season is over.', '<button class="btn pri huge" data-act="adv">Sim day</button><button class="btn big" data-act="sim" data-to="phase">Sim the playoffs</button>']
        : ['Day off', L.draft && !L.draft.done ? 'The draft is on.' : 'No game today.', L.draft && !L.draft.done ? '<button class="btn pri huge" data-act="go" data-v="draft">Go to the draft</button>' : `<button class="btn pri huge" data-act="adv">Next day</button>${simAhead}`];
    big = `<section class="tile t-play solo" style="--ca:${t.c1};--ch:${t.c1}"><div class="tp-cap"><span>${L.season}</span><span>${esc(t.park.name)}</span></div><div class="tp-vs"><div class="tp-side">${logo(t.id, 104)}</div><div class="tp-solo"><b>${title}</b><span>${text}</span></div></div><div class="tp-btn">${btn}</div></section>`;
  }
  const lb = L.lastBox;
  let last = '';
  if (lb) {
    const home = lb.h === L.userTid, us = lb.score[home ? 1 : 0], them = lb.score[home ? 0 : 1], opp = T(L, home ? lb.a : lb.h);
    last = `<a class="lastline" data-act="go" data-v="box"><b class="${us > them ? 'good' : 'bad'}">${us > them ? 'W' : 'L'} ${us}-${them}</b> ${home ? 'vs' : 'at'} ${esc(opp.nick)} <span class="muted">· box score</span></a>`;
  }
  const div = standings(L)[`${t.lg} ${t.div}`];
  const gbv = x => { const d = ((div[0].w - x.w) + (x.l - div[0].l)) / 2; return d <= 0 ? '-' : d; };
  return `<div class="hub">
    <div class="hub-main">${big}${last}</div>
    <aside class="hub-side">
      <section class="tile t-todo"><h3>Needs you${list.length ? ` <small>${list.length}</small>` : ''}</h3>${list.length ? `<ul>${list.map(i => `<li class="${i.hot ? 'hot' : ''}"><p>${esc(i.text)}</p><button class="btn sm" data-act="${i.act}" ${i.act === 'go' ? `data-v="${i.v}"` : `data-id="${i.id}"`}>${i.label}</button></li>`).join('')}</ul>` : '<div class="allset"><b>All set</b><span>Nothing needs you. Play ball.</span></div>'}</section>
      <section class="tile t-div"><h3>${t.lg} ${t.div}</h3><table class="t"><tbody>${div.map((x, i) => `<tr class="${x.id === t.id ? 'me' : ''}"><td>${i + 1}</td><td class="l">${logo(x.id, 20)} ${esc(x.nick)}</td><td>${x.w}-${x.l}</td><td class="muted">${gbv(x)}</td></tr>`).join('')}</tbody></table>
        <p class="goalline">Owner wants: <b>${esc(t.goal)}</b> · ${t.w} of ${t.goalW} wins · job security <b class="${t.ownerMood < 30 ? 'bad' : t.ownerMood < 55 ? 'warn' : 'good'}">${t.ownerMood}%</b>${trend(t)}${crowd(t) !== null ? ` · crowds <b>${crowd(t)}%</b> full` : ''}</p></section>
    </aside>
  </div>`;
};