// Front office pages: trades, free agents, money, draft, history, settings.
import { muted, setMuted } from './core.js';
import { S, views, on, esc, face, faceUrl, avatarSvg, trait, modal, logo, plink, ovr, status, money, pname, toast, say, render, go, save, saveNow, wipeSaved, closeModal, confirmBox, sortBy, th, ord } from './core.js';
import { P, T, index, active, forty, org, payroll, FORTY_MAX } from '../engine/league.js';
import { freeAgents, shownPot, luxuryTax, payrollNext, draftPool, draftAdvance, draftUserPick, onClock, DRAFT_ROUNDS, extensionAsk, FA_DAYS, contested, bidState, userCommitted, CONTESTED, potText, potRange, fogW, scoutPlayer, draftGrade } from '../engine/season.js';
import { evaluateTrade, executeTrade, shopPlayers, askPrice, playerValue, deadlinePassed, tradeDeadlineDay, teamMode, controlYears, standingOffer, openOffers } from '../engine/trade.js';
import { bat, pit, f3, ip } from '../engine/stats.js';
import { fmtDate } from '../engine/schedule.js';

const L = () => S.L;
const stars = v => { const n = v <= 0.5 ? 0 : v < 4 ? 1 : v < 12 ? 2 : v < 28 ? 3 : v < 55 ? 4 : 5; return `<span title="Trade value" style="letter-spacing:1px;color:${n ? '#b7791f' : 'var(--ink3)'}">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`; };

// ---------- trades ----------
const tr = { tid: 0, give: [], get: [], res: null, offers: null, filt: 'all' };
const sal = (l, ids) => ids.reduce((s, id) => s + (P(l, id).on40 ? P(l, id).con.sal : 0), 0);
function trList(tid, picked, side) {
  const l = L();
  let list = org(l, tid);
  if (tr.filt === 'mlb') list = list.filter(p => p.lvl === 'MLB'); else if (tr.filt === 'farm') list = list.filter(p => p.lvl !== 'MLB');
  list.sort((a, b) => b.ovr - a.ovr);
  return `<div class="scroll" style="max-height:520px"><table class="t pickable"><thead><tr><th></th><th class="l">Pos</th><th class="l">Player</th><th>Age</th><th>OVR</th><th>POT</th><th>Salary</th><th>Years</th><th>Value</th></tr></thead><tbody>
    ${list.slice(0, 90).map(p => { const on = picked.includes(p.id); return `<tr class="${on ? 'me' : ''}" data-act="tr-row" data-side="${side}" data-id="${p.id}"><td><span class="addbtn${on ? ' on' : ''}">${on ? '✓' : '+'}</span></td><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p, { size: 26, sub: p.lvl === 'MLB' ? '' : p.lvl === 'AAA' ? 'AAA' : 'AA' })} ${status(p)}</td><td>${p.age}</td><td>${ovr(p.ovr)}</td><td class="pot">${potText(p)}</td><td>${p.con.sal >= 0.1 ? money(p.con.sal) : '–'}</td><td>${controlYears(l, p)}</td><td>${stars(playerValue(l, p))}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function tcard(p, side) {
  const l = L(), t = trait(p);
  return `<div class="tcard t-${t.k}"><span class="sc-ovr"><b>${Math.round(p.ovr)}</b><i>${p.pos}</i></span>
    <img class="sc-face" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">
    <button class="tc-x" data-act="tr-row" data-side="${side}" data-id="${p.id}" aria-label="Remove ${esc(pname(p))}">×</button>
    <span class="sc-name" data-act="player" data-id="${p.id}"><small>${esc(p.first)}</small>${esc(p.last)}</span>
    <span class="sc-line">Age ${p.age} · ${p.con.sal >= 0.1 ? money(p.con.sal) : 'minors'} · ${controlYears(l, p)} yr</span><span class="sc-line">${stars(playerValue(l, p))}</span></div>`;
}
const slot = text => `<div class="tslot"><b>+</b><span>${text}</span></div>`;
function gauge(ratio, label, color) {
  // half-dial: needle sweeps from "no" on the left to "yes" on the right
  const k = Math.max(0, Math.min(1, ratio / 1.4)), ang = -90 + k * 180;
  const arc = (a0, a1, col) => { const pt = a => { const r = (a - 90) * Math.PI / 180; return `${(100 + 80 * Math.cos(r)).toFixed(1)} ${(100 + 80 * Math.sin(r)).toFixed(1)}`; }; return `<path d="M${pt(a0)} A80 80 0 0 1 ${pt(a1)}" fill="none" stroke="${col}" stroke-width="16"/>`; };
  return `<svg class="gauge" viewBox="0 0 200 122" role="img" aria-label="${esc(label)}">${arc(-90, -14, '#ff5468')}${arc(-14, 38, '#ffc93c')}${arc(38, 90, '#3ddc84')}
    <g transform="rotate(${ang.toFixed(1)} 100 100)" style="transition:transform .5s cubic-bezier(.3,1.4,.5,1)"><path d="M96 100 L100 30 L104 100Z" fill="#fff"/></g><circle cx="100" cy="100" r="9" fill="#fff"/><circle cx="100" cy="100" r="4" fill="#05080d"/>
    <text x="22" y="118" font-size="10" fill="#aab6ca" font-weight="700" text-anchor="middle">NO</text><text x="178" y="118" font-size="10" fill="#aab6ca" font-weight="700" text-anchor="middle">YES</text></svg><b class="g-label" style="color:${color}">${label}</b>`;
}
views.trades = () => {
  const l = L();
  if (S.arg) { try { const a = JSON.parse(S.arg); tr.tid = a.tid || tr.tid; tr.give = a.give || []; tr.get = a.get || []; tr.res = null; tr.offers = null; } catch { } S.arg = null; }
  if (!tr.tid || tr.tid === l.userTid) tr.tid = l.teams.find(t => t.id !== l.userTid).id;
  tr.give = tr.give.filter(id => P(l, id)?.tid === l.userTid); tr.get = tr.get.filter(id => P(l, id)?.tid === tr.tid);
  const them = T(l, tr.tid), me = T(l, l.userTid);
  const closed = deadlinePassed(l) || l.phase === 'playoffs';
  const inc = sal(l, tr.get) - sal(l, tr.give);
  const payAfter = payroll(l, me.id) + inc;
  const f40 = forty(l, me.id).length + tr.get.filter(id => P(l, id).on40).length - tr.give.filter(id => P(l, id).on40).length;
  const mode = { contend: 'Trying to win now. They pay for proven big leaguers.', rebuild: 'Rebuilding. They want young players and prospects.', mid: 'In the middle. They will listen on anything fair.' }[teamMode(l, them)];
  const empty = !tr.give.length && !tr.get.length;
  const ev = empty ? null : evaluateTrade(l, tr.tid, tr.get, tr.give);
  const overBudget = ev?.ok && inc > 0 && payAfter > me.budget;
  const ratio = !ev ? 0 : ev.own ? 1.3 : ev.vOut <= 0.5 ? (ev.vIn > 0 ? 1.3 : 0.7) : ev.vIn / ev.vOut;
  const [glabel, gcol] = !ev ? ['Build an offer', '#aab6ca'] : overBudget ? ['Your owner says no', '#ff5468'] : ev.ok ? ['They would say yes', '#3ddc84'] : ratio >= 0.85 ? ['Close', '#ffc93c'] : ratio >= 0.55 ? ['They want more', '#ffb020'] : ['Not interested', '#ff5468'];
  const desk = openOffers(l);
  const side = (t, ids, key, emptyText, cap) => `<div class="tt-side" style="--tc:${t.c1}"><div class="tt-banner">${logo(t.id, 46)}<div><b>${esc(t.nick)}</b><span>${cap}</span></div></div>
      <div class="tt-cards">${ids.map(id => tcard(P(l, id), key)).join('')}${ids.length < 4 ? slot(emptyText) : ''}</div></div>`;
  return `<div class="head"><div><h1>Trade center</h1><p>${closed ? 'The trade deadline has passed. Trading reopens in the offseason.' : l.phase === 'regular' ? `Deadline ${fmtDate(l.season, tradeDeadlineDay(l))}. Click players in the lists to put them on the table.` : 'Offseason trading is open. Click players in the lists to put them on the table.'}</p></div><span class="sp"></span>
    <label>Trade with <select data-chg="tr-team">${[...l.teams].filter(t => t.id !== l.userTid).sort((a, b) => a.name.localeCompare(b.name)).map(t => `<option value="${t.id}"${t.id === tr.tid ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label></div>
  ${desk.length ? `<div class="panel" style="margin-bottom:14px"><h3>Offers on your desk <small>these are theirs, so they will not back out</small></h3>${desk.map(m => `<div class="deskrow">${logo(m.data.tid, 30)}<p><b>${esc(T(l, m.data.tid).nick)}</b> give ${m.data.give.map(id => `${esc(pname(P(l, id)))} <span class="muted">(${Math.round(P(l, id).ovr)})</span>`).join(', ')} for ${m.data.get.map(id => `${esc(pname(P(l, id)))} <span class="muted">(${Math.round(P(l, id).ovr)})</span>`).join(', ')}${l.phase === 'regular' ? ` <span class="tag">open ${m.data.exp - l.day + 1} more day${m.data.exp - l.day ? 's' : ''}</span>` : ''}</p><button class="btn pri sm" data-act="offer-yes" data-id="${m.id}">Accept</button><button class="btn sm" data-act="offer-view" data-id="${m.id}">Put on the table</button><button class="btn sm" data-act="offer-no" data-id="${m.id}">Decline</button></div>`).join('')}</div>` : ''}
  <section class="ttable">
    ${side(me, tr.give, 'give', 'Add your players', `You send · ${money(sal(l, tr.give))} in salary`)}
    <div class="tt-mid">${gauge(ratio, glabel, gcol)}
      <p>${ev && !ev.ok ? esc(ev.why) : overBudget ? `This takes your payroll to ${money(payAfter)}, over your $${me.budget}M budget.` : esc(mode)}</p>
      <button class="btn pri huge" data-act="tr-propose" ${closed || empty ? 'disabled' : ''}>Propose</button>
      <div class="tt-tools"><button class="btn sm" data-act="tr-ask" ${closed || !tr.get.length ? 'disabled' : ''}>What do they want?</button><button class="btn sm" data-act="tr-shop" ${closed || !tr.give.length ? 'disabled' : ''}>Shop my players</button><button class="btn sm" data-act="tr-clear" ${empty ? 'disabled' : ''}>Clear</button></div>
      <small>After the deal: payroll <b class="${payAfter > me.budget ? 'bad' : ''}">${money(payAfter)}</b> of $${me.budget}M · 40-man <b class="${f40 > FORTY_MAX ? 'bad' : ''}">${f40}/${FORTY_MAX}</b></small></div>
    ${side(them, tr.get, 'get', 'Add their players', `You get · ${money(sal(l, tr.get))} in salary`)}
  </section>
  ${tr.offers ? `<div class="panel" style="margin:14px 0"><h3>Offers for ${tr.give.map(id => esc(P(l, id).last)).join(', ')}</h3>${tr.offers.length ? tr.offers.map((o, i) => `<div class="deskrow">${logo(o.tid, 30)}<p><b>${esc(T(l, o.tid).nick)}</b> would give ${o.give.map(id => { const p = P(l, id); return `${plink(p, { photo: false })} <span class="muted">${p.pos}, ${p.age}, ${Math.round(p.ovr)}/${shownPot(p)}</span>`; }).join('; ')}</p><button class="btn pri sm" data-act="tr-take" data-i="${i}">Put on the table</button></div>`).join('') : '<p class="empty">Nobody is biting. His value may be too low, or the salary too high.</p>'}</div>` : ''}
  <div class="row" style="margin:16px 0 10px"><h3>Rosters</h3><span class="grow"></span><span class="seg">${[['all', 'Everyone'], ['mlb', 'Big leaguers'], ['farm', 'Prospects']].map(([k, lab]) => `<button class="${tr.filt === k ? 'on' : ''}" data-act="tr-filt" data-k="${k}">${lab}</button>`).join('')}</span></div>
  <div class="grid g2 stack"><div class="panel"><h3>${logo(me.id, 20)} ${esc(me.name)}</h3>${trList(me.id, tr.give, 'give')}</div><div class="panel"><h3>${logo(them.id, 20)} ${esc(them.name)}</h3>${trList(them.id, tr.get, 'get')}</div></div>`;
};
on('tr-team', el => { tr.tid = +el.value; tr.get = []; tr.res = null; tr.offers = null; render(); });
on('tr-filt', el => { tr.filt = el.dataset.k; render(); });
on('tr-row', (el, e) => { if (e.target.closest('.pl')) return; const a = tr[el.dataset.side], id = +el.dataset.id, i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else if (a.length >= 6) return toast('Six players a side is the limit.', true); else a.push(id); tr.offers = null; render(); });
on('tr-clear', () => { tr.give = []; tr.get = []; tr.res = null; tr.offers = null; render(); });
on('tr-ask', () => { const r = askPrice(L(), tr.tid, tr.get); tr.give = r.ids; toast(r.enough ? 'This is roughly what they would ask for.' : 'You may not have enough to get this done. This is the closest package.', !r.enough); render(); });
on('tr-shop', () => { tr.offers = shopPlayers(L(), tr.give); render(); });
on('tr-take', el => { const o = tr.offers[+el.dataset.i]; tr.tid = o.tid; tr.get = [...o.give]; tr.offers = null; render(); });
function tradeDone(l, tid, give, get) {
  const col = (t, ids) => `<div><div class="tt-banner" style="--tc:${t.c1}">${logo(t.id, 40)}<div><b>${esc(t.nick)}</b><span>receive</span></div></div>${ids.map(id => `<p style="margin:8px 0">${plink(P(l, id), { sub: `${P(l, id).pos} · ${Math.round(P(l, id).ovr)}` })}</p>`).join('')}</div>`;
  modal(`<div class="body"><h2 class="stamp">Trade complete</h2><div class="grid g2" style="margin:16px 0">${col(T(l, l.userTid), get)}${col(T(l, tid), give)}</div><button class="btn pri" data-act="close">Back to work</button></div>`, true);
}
on('tr-propose', () => {
  const l = L(), me = T(l, l.userTid);
  const res = evaluateTrade(l, tr.tid, tr.get, tr.give);
  const inc = sal(l, tr.get) - sal(l, tr.give);
  if (res.ok && inc > 0 && payroll(l, me.id) + inc > me.budget) return toast('Your owner blocks it: this takes payroll over your budget.', true);
  if (!res.ok) return toast(res.why, true);
  const give = [...tr.give], get = [...tr.get], tid = tr.tid;
  confirmBox('They say yes', `Send ${give.map(id => pname(P(l, id))).join(', ') || 'nothing'} to the ${T(l, tid).nick} for ${get.map(id => pname(P(l, id))).join(', ') || 'nothing'}?`, 'Make the trade', () => {
    const own = standingOffer(l, tid, get, give); if (own) own.done = 1;
    executeTrade(l, l.userTid, give, tid, get); tr.give = []; tr.get = []; tr.res = null; save(); render(); tradeDone(l, tid, give, get);
  });
});
on('trade-add', el => { closeModal(); const id = +el.dataset.id; if (!tr.give.includes(id)) tr.give.push(id); tr.res = null; go('trades'); });
on('trade-for', el => { closeModal(); const p = P(L(), +el.dataset.id); go('trades', JSON.stringify({ tid: p.tid, give: tr.tid === p.tid ? tr.give : [], get: [...(tr.tid === p.tid ? tr.get : []).filter(x => x !== p.id), p.id] })); });
// ---------- free agents ----------
let faPos = 'all';
views.fa = () => {
  const l = L(), t = T(l, l.userTid);
  let list = freeAgents(l);
  if (faPos === 'H') list = list.filter(p => !p.isP); else if (faPos === 'SP') list = list.filter(p => p.role === 'SP'); else if (faPos === 'RP') list = list.filter(p => p.role === 'RP');
  const g = { name: p => p.last, age: p => p.age, ovr: p => p.ovr, pot: p => p.pot, ask: p => p.ask.aav, yrs: p => p.ask.yrs };
  const rows = sortBy('fa', list, g, 'ovr').slice(0, 120);
  const room = t.budget - payroll(l, t.id) - userCommitted(l);
  const auction = l.phase === 'offseason' && l.off.stage === 'fa';
  const mine = auction ? freeAgents(l).filter(p => p.bids?.some(b => b.tid === t.id)) : [];
  const market = p => {
    if (!auction || !contested(l, p)) return auction ? '<span class="muted">Signs on the spot</span>' : '';
    const b = bidState(l, p);
    if (!b) return '<span class="tag">Open</span>';
    return `<span class="tag ${b.mine ? (b.leading ? 'hot' : 'inj') : ''}">${b.mine ? (b.leading ? 'You lead' : 'Outbid') : `${b.n} club${b.n > 1 ? 's' : ''} in`}</span> <small class="muted">decides in ${b.days}d</small>`;
  };
  const war = p => { const b = bidState(l, p); const lt = T(l, b.lead.tid); return `<div class="bwar ${b.leading ? 'lead' : 'out'}" style="--tc:${lt.c1}">
      <span class="sc-ovr"><b>${Math.round(p.ovr)}</b><i>${p.pos}</i></span>${face(p, 84)}
      <div class="bw-txt"><span class="pl" data-act="player" data-id="${p.id}"><b class="nm">${esc(pname(p))}</b></span>
        <em>${b.leading ? 'You lead' : `Outbid by the ${esc(lt.nick)}`}</em>
        <span>Yours: <b>${money(b.mine.aav)}</b> × ${b.mine.yrs}${b.leading ? '' : ` · theirs: <b>${money(b.lead.aav)}</b> × ${b.lead.yrs}`}</span>
        <span>${b.n} club${b.n > 1 ? 's' : ''} bidding · decides in <b>${b.days} day${b.days === 1 ? '' : 's'}</b></span></div>
      <button class="btn ${b.leading ? '' : 'pri'}" data-act="fa-offer" data-id="${p.id}">${b.leading ? 'Improve' : 'Raise'}</button></div>`; };
  return `<div class="head"><div><h1>Free agents</h1><p>${l.phase === 'offseason' ? (auction ? `Day ${l.off.day + 1} of ${FA_DAYS}. Players rated ${CONTESTED}+ go to auction: clubs make offers and he picks the best one on his decision day. Everyone else signs on the spot.` : 'The market opens when you finish re-signing your own players.') : 'Unsigned players can join any time. In-season signings report to Triple-A.'} You have <b class="${room < 0 ? 'bad' : ''}">${money(Math.max(0, room))}</b> of budget room${mine.length ? ' after your open offers' : ''} and ${FORTY_MAX - forty(l, t.id).length} open 40-man spots.</p></div><span class="sp"></span>
    <span class="seg">${[['all', 'All'], ['H', 'Hitters'], ['SP', 'Starters'], ['RP', 'Relievers']].map(([k, lab]) => `<button class="${faPos === k ? 'on' : ''}" data-act="fa-pos" data-k="${k}">${lab}</button>`).join('')}</span></div>
  ${mine.length ? `<div class="panel" style="margin-bottom:14px"><h3>Your bidding wars <small>${mine.length} open</small></h3><div class="bwars">${mine.map(war).join('')}</div></div>` : ''}
  <div class="panel"><div class="scroll"><table class="t"><thead><tr><th class="l">Pos</th>${th('fa', 'name', 'Player', 'l', true)}${th('fa', 'age', 'Age')}<th>B/T</th>${th('fa', 'ovr', 'OVR')}${th('fa', 'pot', 'POT')}<th class="l">Last season</th>${th('fa', 'ask', 'Asking / year')}${th('fa', 'yrs', 'Years')}${auction ? '<th class="l">Market</th>' : ''}<th></th></tr></thead><tbody>
  ${rows.map(p => { const h = p.hist.at(-1); const ls = h ? (p.isP ? `${h.W || 0}-${h.L || 0}, ${pit(h).era.toFixed(2)} ERA, ${ip(h.O || 0)} IP` : `${f3(bat(h).avg)}, ${h.HR || 0} HR, ${h.RBI || 0} RBI`) : ''; const bs = auction && bidState(l, p); return `<tr><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p)}</td><td>${p.age}</td><td>${p.bats}/${p.throws}</td><td>${ovr(p.ovr)}</td><td class="pot">${potText(p)}</td><td class="l muted">${ls}</td><td><b>${money(p.ask.aav)}</b></td><td>${p.ask.yrs}</td>${auction ? `<td class="l">${market(p)}</td>` : ''}<td><button class="btn sm pri" data-act="fa-offer" data-id="${p.id}" ${l.phase === 'offseason' && l.off.stage === 'resign' ? 'disabled' : ''}>${bs?.mine ? 'Raise' : contested(l, p) ? 'Bid' : 'Offer'}</button></td></tr>`; }).join('') || '<tr><td colspan="11" class="empty">No free agents right now. The market fills up after the World Series.</td></tr>'}</tbody></table></div></div>`;
};
on('fa-pos', el => { faPos = el.dataset.k; render(); });

// ---------- contracts and money ----------
views.money = () => {
  const l = L(), t = T(l, l.userTid);
  const pay = payroll(l, t.id), tax = luxuryTax(l, t, pay), next = payrollNext(l, t.id);
  const list = org(l, t.id).filter(p => p.on40);
  const g = { name: p => p.last, age: p => p.age, ovr: p => p.ovr, sal: p => p.con.sal, exp: p => p.svc < 6 && p.con.exp <= l.season ? l.season + controlYears(l, p) - 1 : p.con.exp, svc: p => p.svc };
  const rows = sortBy('mn', list, g, 'sal');
  const exp = org(l, t.id).filter(p => p.expiring);
  const st = p => p.expiring ? '<span class="tag inj">Out of contract</span>' : p.con.next ? `<span class="tag hot">Extended to ${p.con.next.exp}</span>` : p.svc < 3 && p.con.exp <= l.season ? 'Pre-arbitration' : p.svc < 6 && p.con.exp <= l.season ? `Arbitration (${Math.ceil(6 - p.svc)} yr of control)` : p.con.exp <= l.season ? '<span class="warn">Free agent after this season</span>' : `Signed through ${p.con.exp}`;
  const fin = t.fin || [];
  return `<div class="head"><div><h1>Contracts and money</h1><p>The owner sets the budget. Go over the luxury-tax line and you pay a penalty that also comes out of next year's budget.</p></div></div>
  <div class="grid g3" style="margin-bottom:16px">
    <div class="panel"><div class="pad"><span class="muted">Payroll this year</span><h2 class="${pay > t.budget ? 'bad' : ''}">${money(pay)}</h2><div class="bar" style="margin:8px 0"><i style="width:${Math.min(100, pay / t.budget * 100)}%;background:var(--club)"></i></div>Budget $${t.budget}M${t.bump ? `, including $${t.bump}M of deadline money from the owner` : ''}. ${t.dead ? `Includes ${money(t.dead)} owed to released players.` : ''}</div></div>
    <div class="panel"><div class="pad"><span class="muted">Luxury tax</span><h2 class="${tax > 0 ? 'bad' : 'good'}">${tax > 0 ? money(tax) + ' bill' : 'None'}</h2><p style="margin:8px 0 0">The line is $${l.cbt}M. You are ${pay > l.cbt ? `<b class="bad">${money(pay - l.cbt)} over</b>` : `${money(l.cbt - pay)} under`}. ${t.taxYears > 0 ? `Repeat offender (${t.taxYears} straight years): higher rates.` : 'Rates: 20% on the first $20M over, rising to 80%.'}</p></div></div>
    <div class="panel"><div class="pad"><span class="muted">Already committed for next year</span><h2>${money(next)}</h2><p style="margin:8px 0 0">Cash in the bank: ${money(t.cash)}. Average crowd: ${t.hw + t.hl ? Math.round(t.att / (t.hw + t.hl)).toLocaleString() : '–'} at ${esc(t.park.name)}.</p></div></div>
  </div>
  ${exp.length ? `<div class="note"><b>Out of contract.</b> Re-sign these players now or they become free agents when you open the market: ${exp.map(p => `${esc(pname(p))} <button class="btn sm" data-act="extend" data-id="${p.id}">Offer</button>`).join(' ')}</div>` : ''}
  <div class="panel" style="margin-bottom:16px"><h3>40-man roster contracts</h3><div class="scroll"><table class="t"><thead><tr><th class="l">Pos</th>${th('mn', 'name', 'Player', 'l', true)}${th('mn', 'age', 'Age')}${th('mn', 'ovr', 'OVR')}${th('mn', 'svc', 'Service')}${th('mn', 'sal', 'Salary')}<th class="l">Status</th><th></th></tr></thead><tbody>
  ${rows.map(p => `<tr><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p, { size: 26 })}</td><td>${p.age}</td><td>${ovr(p.ovr)}</td><td>${p.svc.toFixed(1)}</td><td><b>${money(p.con.sal)}</b></td><td class="l">${st(p)}</td><td>${!p.con.next && p.con.exp <= l.season + 1 ? `<button class="btn sm" data-act="extend" data-id="${p.id}">Extend</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
  ${fin.length ? `<div class="panel"><h3>The books</h3><div class="scroll"><table class="t"><thead><tr><th class="l">Year</th><th>Revenue</th><th>Gate</th><th>Payroll</th><th>Luxury tax</th><th>Running costs</th><th>Profit</th><th>Attendance</th></tr></thead><tbody>${fin.slice().reverse().map(f => `<tr><td class="l">${f.y}</td><td>${money(f.rev)}</td><td>${money(f.gate)}</td><td>${money(f.pay)}</td><td>${f.tax ? money(f.tax) : '–'}</td><td>${money(f.ops)}</td><td class="${f.profit >= 0 ? 'good' : 'bad'}">${f.profit < 0 ? '-' : ''}${money(Math.abs(f.profit))}</td><td>${f.att.toLocaleString()}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
};

// ---------- draft ----------
let drPos = 'all';
views.draft = () => {
  const l = L(), d = l.draft;
  const asb = l.sched.findIndex(x => x.asb);
  if (!d) {
    return `<div class="head"><div><h1>Draft</h1><p>${l.phase === 'regular' ? `The ${l.season} amateur draft is held at the All-Star break (${fmtDate(l.season, asb)}). ${DRAFT_ROUNDS} rounds; the worst record picks first.` : 'The next draft is at next summer\'s All-Star break.'} Every club also signs two international teenagers each winter.</p></div><span class="sp"></span><label class="row gap8"><input type="checkbox" data-chg="opt" data-k="autoDraft" ${l.opts.autoDraft ? 'checked' : ''}> Let my scouting director make the picks</label></div>
    <div class="panel"><h3>Your recent draft picks</h3><div class="scroll"><table class="t"><thead><tr><th class="l">Year</th><th>Pick</th><th class="l">Pos</th><th class="l">Player</th><th>Age</th><th>OVR</th><th>POT</th><th class="l">Now</th></tr></thead><tbody>${l.players.filter(p => p.gen && p.draft?.tid === l.userTid).sort((a, b) => b.draft.y - a.draft.y || a.draft.pk - b.draft.pk).slice(0, 40).map(p => `<tr><td class="l">${p.draft.y}</td><td>${p.draft.pk}</td><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p)}</td><td>${p.age}</td><td>${ovr(p.ovr)}</td><td class="pot">${potText(p)}</td><td class="l">${p.tid === l.userTid ? (p.lvl === 'MLB' ? 'Majors' : p.lvl === 'AAA' ? 'Triple-A' : 'Double-A') : p.tid >= 0 ? T(l, p.tid).abbr : 'Free agent'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No picks yet.</td></tr>'}</tbody></table></div></div>`;
  }
  const clock = onClock(l), mineTurn = clock === l.userTid && !d.done;
  let pool = draftPool(l);
  if (drPos === 'H') pool = pool.filter(p => !p.isP); else if (drPos === 'P') pool = pool.filter(p => p.isP);
  const g = { name: p => p.last, age: p => p.age, ovr: p => p.ovr, pot: p => shownPot(p), pos: p => p.pos };
  const rows = sortBy('dr', pool, g, 'pot').slice(0, 80);
  const myNext = d.done ? 0 : (() => { for (let i = d.pick; i < d.total; i++) if (d.order[i % 30] === l.userTid) return i + 1; return 0; })();
  const tool = p => p.isP ? `Stuff ${Math.round(p.pit.stf)}, control ${Math.round(p.pit.ctl)}, ${p.pit.vel.toFixed(0)} mph` : `Contact ${Math.round(p.bat.con)}, power ${Math.round(p.bat.pow)}, speed ${Math.round(p.bat.spd)}`;
  const pts = l.scout?.pts ?? 0;
  const scoutBtn = p => fogW(p) >= 0.5 && pts > 0 ? `<button class="btn sm" data-act="scout" data-id="${p.id}" title="Send your scouts: narrows his range">Scout</button>` : '';
  const top3 = mineTurn ? draftPool(l).sort((a, b) => (shownPot(b) * 0.72 + b.ovr * 0.28) - (shownPot(a) * 0.72 + a.ovr * 0.28)).slice(0, 3) : [];
  const g8 = d.done && d.grade;
  return `<div class="head"><div><h1>${d.y} draft</h1><p>${d.done ? `The draft is over. Your picks are in the lower minors.${g8 ? ` Your class grade: <b>${g8.grade}</b>.` : ''}` : `Round ${Math.floor(d.pick / 30) + 1}, pick ${d.pick + 1} of ${d.total}. ${mineTurn ? '<b class="bad">You are on the clock.</b>' : `${esc(T(l, clock).name)} are picking. Your next pick is number ${myNext}.`}`} Potential is a range: your scouts' best guess and how sure they are. Scouting trips left this year: <b>${pts}</b>.</p></div><span class="sp"></span>
    ${d.done ? '' : `<button class="btn" data-act="dr-auto1" ${mineTurn ? '' : 'disabled'}>Scouts pick for me</button><button class="btn" data-act="dr-autoall">Auto-draft the rest</button>`}
    <span class="seg">${[['all', 'All'], ['H', 'Hitters'], ['P', 'Pitchers']].map(([k, lab]) => `<button class="${drPos === k ? 'on' : ''}" data-act="dr-pos" data-k="${k}">${lab}</button>`).join('')}</span></div>
  ${top3.length ? `<div class="panel" style="margin-bottom:14px"><h3>Your scouts like <small>best available on your board</small></h3><div class="dr-top">${top3.map(p => `<div class="tcard t-${trait(p).k}"><span class="sc-ovr"><b>${Math.round(p.ovr)}</b><i>${p.pos}</i></span>
      <img class="sc-face" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">
      <span class="sc-name" data-act="player" data-id="${p.id}"><small>${esc(p.first)} · ${p.age}, ${p.age <= 19 ? 'high school' : 'college'}</small>${esc(p.last)}</span>
      <span class="sc-line">Ceiling <b>${potText(p)}</b></span><span class="sc-line">${tool(p)}</span>
      <span class="dr-btns"><button class="btn sm pri" data-act="draft-pick" data-id="${p.id}">Draft</button>${scoutBtn(p)}</span></div>`).join('')}</div></div>` : ''}
  <div class="grid g21">
    <div class="panel"><h3>Draft board <small>${pool.length} available</small></h3><div class="scroll" style="max-height:70vh"><table class="t"><thead><tr>${th('dr', 'pos', 'Pos', 'l', true)}${th('dr', 'name', 'Player', 'l', true)}${th('dr', 'age', 'Age')}<th>B/T</th>${th('dr', 'ovr', 'OVR')}${th('dr', 'pot', 'POT')}<th class="l">Tools</th><th></th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p, { sub: p.age <= 19 ? 'high school' : 'college' })}</td><td>${p.age}</td><td>${p.bats}/${p.throws}</td><td>${ovr(p.ovr)}</td><td class="pot"><b>${potText(p)}</b></td><td class="l muted">${tool(p)}</td><td class="acts">${scoutBtn(p)}</td><td>${mineTurn ? `<button class="btn sm pri" data-act="draft-pick" data-id="${p.id}">Draft</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nobody left.</td></tr>'}</tbody></table></div></div>
    <div class="panel"><h3>Picks so far</h3><div class="scroll" style="max-height:70vh"><table class="t"><tbody>${d.picks.slice().reverse().slice(0, 60).map(x => { const p = P(l, x.pid); return p ? `<tr class="${x.tid === l.userTid ? 'me' : ''}"><td>${x.pk}</td><td class="l">${logo(x.tid, 18)}</td><td class="l">${plink(p, { photo: false, sub: `${p.pos}, ${p.age}` })}</td><td class="pot">${potText(p)}</td></tr>` : ''; }).join('') || '<tr><td class="empty">The first pick is coming up.</td></tr>'}</tbody></table></div></div>
  </div>`;
};
on('dr-pos', el => { drPos = el.dataset.k; render(); });
on('dr-auto1', () => { const l = L(); const best = draftPool(l).sort((a, b) => (shownPot(b) * 0.72 + b.ovr * 0.28) - (shownPot(a) * 0.72 + a.ovr * 0.28))[0]; if (best) pickAndReveal(best.id); });
on('scout', el => { const r = scoutPlayer(L(), +el.dataset.id); toast(r.msg, !r.ok); if (r.ok) { save(); if (!document.getElementById('modal').hidden && document.querySelector('.pcard')) { import('./player.js').then(m => m.playerCard(+el.dataset.id)); } render(); } });
// The pick is in: a draft-night card for the user's selection.
export function pickAndReveal(pid) {
  const l = L(), d = l.draft, n = d.pick + 1;
  const r = draftUserPick(l, pid);
  if (!r.ok) return toast(r.msg, true);
  const p = P(l, pid), t = T(l, l.userTid);
  draftAdvance(l); save();
  const tool = p.isP ? `Stuff ${Math.round(p.pit.stf)} · control ${Math.round(p.pit.ctl)} · ${p.pit.vel.toFixed(0)} mph` : `Contact ${Math.round(p.bat.con)} · power ${Math.round(p.bat.pow)} · speed ${Math.round(p.bat.spd)}`;
  modal(`<div class="reveal" style="--tc:${t.c1}"><div class="rv-kick">With pick ${n} in the ${d.y} draft, the ${esc(t.name)} select</div>
    <div class="rv-card"><img class="rv-face" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">
      <div><b class="rv-name">${esc(pname(p))}</b><span>${p.pos} · ${p.age} · ${p.age <= 19 ? 'high school' : 'college'} · bats ${p.bats}, throws ${p.throws}</span><span>${tool}</span>
      <span class="rv-pot">Ceiling <b>${potText(p)}</b> · today ${Math.round(p.ovr)}</span></div></div>
    <span class="mo-stamp">DRAFTED</span>
    <div class="mo-btns"><button class="btn pri big" data-act="pop-next">Back to the board</button></div></div>`, true);
  render();
}
on('dr-autoall', () => { draftAdvance(L(), true); save(); render(); });

// ---------- history ----------
views.history = () => {
  const l = L(), t = T(l, l.userTid);
  const aw = (id, lab) => { const p = P(l, id); return p ? `${lab}: ${plink(p, { photo: false })}` : ''; };
  return `<div class="head"><div><h1>History</h1><p>Champions, awards and every move you have made.</p></div></div>
  <div class="grid g2">
    <div class="panel"><h3>Seasons</h3>${l.hist.length ? `<table class="t"><thead><tr><th class="l">Year</th><th class="l">Champion</th><th class="l">Runner-up</th><th class="l">${esc(t.nick)}</th></tr></thead><tbody>${l.hist.slice().reverse().map(h => { const m = t.hist.find(x => x.y === h.y); return `<tr><td class="l"><b>${h.y}</b></td><td class="l">${logo(h.champ, 20)} ${esc(T(l, h.champ)?.name || '')}</td><td class="l">${h.ru ? esc(T(l, h.ru).nick) : ''}</td><td class="l">${m ? `${m.w}–${m.l}${m.champ ? ', champions' : m.po ? ', playoffs' : ''}` : ''}</td></tr><tr><td></td><td class="l muted" colspan="3">${['AL', 'NL'].map(lg => [aw(h.awards[lg].mvp, lg + ' MVP'), aw(h.awards[lg].cy, 'Cy Young'), aw(h.awards[lg].roy, 'Rookie')].filter(Boolean).join(' · ')).join('<br>')}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Your first season is still being written.</div>'}</div>
    <div class="panel"><h3>Transactions</h3><ul class="news" style="max-height:70vh;overflow:auto">${l.tx.slice(0, 150).map(x => `<li class="${x.tid === l.userTid || x.tid2 === l.userTid ? 'big' : ''}"><time>${x.y}</time><p>${esc(x.t)}</p></li>`).join('') || '<li class="empty">No moves yet.</li>'}</ul></div>
  </div>`;
};

// ---------- settings ----------
views.settings = () => {
  const l = L(), o = l.opts;
  const chk = (k, label, help) => `<label class="row" style="align-items:flex-start;margin-bottom:12px"><input type="checkbox" data-chg="opt" data-k="${k}" ${o[k] ? 'checked' : ''} style="margin-top:4px"><span><b>${label}</b><br><span class="muted">${help}</span></span></label>`;
  return `<div class="head"><div><h1>Settings</h1><p>Your career saves in this browser after every move.</p></div></div>
  <div class="grid g2"><div class="panel"><h3>Help from your staff</h3><div class="pad">
    ${chk('autoLineup', 'Bench coach sets the lineup', 'Picks the best nine against left- and right-handed starters. Turn off to keep your own card.')}
    ${chk('autoPitch', 'Pitching coach sets the rotation and bullpen', 'Orders the five starters and names a closer and setup men.')}
    ${chk('autoRest', 'Give regulars rest days', 'The catcher sits about one game in five; everyone else now and then.')}
    ${chk('autoRoster', 'Assistant handles injuries and call-ups', 'Moves hurt players to the injured list and calls up replacements so you never get stuck.')}
    ${chk('autoDraft', 'Scouting director runs the draft', 'Picks the best available player for you every round.')}
    <label class="row" style="align-items:flex-start;margin-bottom:12px"><input type="checkbox" data-chg="mute-chk" ${muted() ? '' : 'checked'} style="margin-top:4px"><span><b>Menu sounds</b><br><span class="muted">Clicks and whooshes when you move around the menus.</span></span></label>
  </div></div>
  <div class="panel"><h3>Your save</h3><div class="pad">
    <p>${esc(l.gm)}, ${esc(T(l, l.userTid).name)}, ${l.season}. ${l.games}-game seasons. Rosters built from real stats on ${esc(S.data.built)}.</p>
    <div class="row wrap"><button class="btn" data-act="dl-save">Download save file</button><label class="btn">Load a save file<input type="file" accept=".json" data-chg="ul-save" hidden></label><button class="btn" data-act="new-career">Start a new career</button></div>
    <p class="muted" style="margin-top:14px">A fan project. Team and player names, logos and photos belong to MLB and the players. Salaries and contract lengths are estimates; ratings are worked out from real ${S.data.season - 1} and earlier stats.</p>
  </div></div></div>`;
};
on('mute-chk', el => { setMuted(!el.checked); });
on('dl-save', () => { const l = L(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(l)], { type: 'application/json' })); a.download = `ballclub-${T(l, l.userTid).abbr}-${l.season}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
on('ul-save', async el => { try { const txt = await el.files[0].text(); const l = index(JSON.parse(txt)); if (!l.players || !l.teams) throw new Error('not a save'); S.L = l; await saveNow(); toast('Save loaded.'); go('home'); } catch { toast('That file is not a Ballclub save.', true); } });
on('new-career', () => confirmBox('Start over?', 'This deletes your current career from this browser. Download a save first if you want to keep it.', 'Delete and start over', async () => { await wipeSaved(); location.reload(); }));
