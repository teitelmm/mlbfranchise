// Title screen, franchise picker and the welcome moment.
import { S, on, esc, logo, money, ord, sfx, render, saveNow, confirmBox, faceUrl, avatarSvg, trait, accentOf } from './core.js';
import { newCareer, T, active, org, payroll } from '../engine/league.js';
import { shownPot } from '../engine/season.js';
import { fenceAt } from '../engine/game.js';
import { bat, pit, f3 } from '../engine/stats.js';
import { teamRatings } from './hub.js';

const app = document.getElementById('app');
let pv = null, info = null, saved = null, cur = 0, sortK = 'div', games = 162, gm = '', order = [];
const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const DIVS = ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West'];
const MARKET = ['', 'Small market', 'Mid-small market', 'Mid market', 'Big market', 'Huge market'];
const DIFF = ['', 'Easy', 'Comfortable', 'Balanced', 'Hard', 'Very hard'];
const DIFFTXT = ['', 'A ready-made contender with money to spend.', 'A good roster and a decent wallet. The owner expects October.', 'Some real pieces, some real holes. Every move matters.', 'A thin roster or a tight budget. It will take patience.', 'Small money and a short roster. This is a full rebuild.'];

// One preview league so every club shows its real opening roster and ratings.
function buildPreview() {
  if (pv) return;
  pv = newCareer(S.data, { userTid: S.data.teams[0].id, games: 162, seed: 7 });
  const rows = pv.teams.map(t => ({ t, r: teamRatings(pv, t.id), pay: payroll(pv, t.id), rk: {} }));
  const rank = (k, f) => [...rows].sort((a, b) => f(b) - f(a)).forEach((x, i) => { x.rk[k] = i + 1; });
  rank('ovr', x => x.r.ovr); rank('off', x => x.r.off); rank('rot', x => x.r.rot); rank('pen', x => x.r.pen); rank('def', x => x.r.def);
  rank('bud', x => x.t.budget); rank('pay', x => x.pay); rank('rev', x => books(x.t).rev);
  for (const x of rows) x.diff = Math.max(1, Math.min(5, Math.round(1 + (x.rk.ovr - 1) / 29 * 2.6 + (x.rk.bud - 1) / 29 * 1.4)));
  info = new Map(rows.map(x => [x.t.id, x]));
}
// What a club takes in and spends in a normal year (same formulas the season uses).
function books(t) {
  const fill = Math.min(1, 0.36 + t.market * 0.075);
  const tv = t.budget * 0.62 + 55, gate = 81 * t.park.cap * fill * (21 + t.market * 7.5) / 1e6, ops = 55 + t.market * 14 + 12;
  return { tv, gate, rev: tv + gate, ops, fans: Math.round(t.park.cap * fill), ticket: 21 + t.market * 7.5 };
}

// ---------- title ----------
export function titleScreen(sv) {
  saved = sv;
  const d = S.data, y = d.season - 1;
  const champ = d.teams.find(t => t.last?.pr === 5), best = [...d.teams].sort((a, b) => (b.last?.w || 0) - (a.last?.w || 0))[0];
  const rich = [...d.teams].sort((a, b) => b.budget - a.budget), top = [...d.players].sort((a, b) => b.ovr - a.ovr)[0];
  const kid = [...d.players].filter(p => p.lvl !== 'MLB' && p.age <= 23).sort((a, b) => b.pot - a.pot)[0];
  const tick = [
    champ && `${y} World Series champions: ${champ.name}`, best && `Best record in ${y}: ${best.name}, ${best.last.w}-${best.last.l}`,
    `Biggest budget: ${rich[0].name}, $${rich[0].budget}M`, `Smallest budget: ${rich.at(-1).name}, $${rich.at(-1).budget}M`,
    `Highest rated: ${top.first} ${top.last} (${top.ovr})`, kid && `Top prospect: ${kid.first} ${kid.last}, potential ${kid.pot}`,
    `${d.players.length.toLocaleString()} real players`, '30 clubs', 'Luxury tax line: $244M', `${d.season} season starts on Opening Day`,
  ].filter(Boolean);
  const st = saved ? T(saved, saved.userTid) : null;
  const menu = [
    st && `<button class="tm-item tm-cont" data-act="tm-go" data-k="continue" style="--tc:${st.c1}"><span class="tm-lg">${logo(st.id, 54)}</span><span><b>Continue</b><small>${esc(st.name)} · ${saved.season} · ${st.w}-${st.l} · GM ${esc(saved.gm)}</small></span></button>`,
    `<button class="tm-item" data-act="tm-go" data-k="new"><span><b>New franchise</b><small>Pick any of the 30 clubs and take over the front office</small></span></button>`,
    `<label class="tm-item" tabindex="0"><span><b>Load a save file</b><small>A .json file you downloaded from Settings</small></span><input type="file" accept=".json" data-chg="ul-save" hidden></label>`,
  ].filter(Boolean);
  app.innerHTML = `<div class="title${reduce() ? '' : ' anim'}">
    ${stadium()}
    <div class="beam b1"></div><div class="beam b2"></div>
    <div class="tl-main">
      <h1 class="tl-logo" aria-label="Ballclub">${'BALLCLUB'.split('').map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</h1>
      <p class="tl-sub">Franchise mode · ${d.season} season · real rosters, real money</p>
      <nav class="tl-menu">${menu.join('')}</nav>
    </div>
    <div class="ticker"><div class="tk-run">${[0, 1].map(() => tick.map(x => `<span>${esc(x)}</span>`).join('')).join('')}</div></div>
    <p class="tl-fine">A fan project. Team and player names, logos and photos belong to MLB and the players. Salaries are estimates.</p>
  </div>`;
  setTimeout(buildPreview, 60);
  setTimeout(() => app.querySelector('.tm-item')?.focus(), reduce() ? 0 : 1300);
}
function stadium() {
  // night ballpark from behind home plate: stands, wall, outfield, infield, light towers
  const tower = x => `<g transform="translate(${x} 0)"><rect x="-4" y="70" width="8" height="200" fill="#0b1220"/><rect x="-46" y="46" width="92" height="30" rx="3" fill="#1b2638"/>${[0, 1, 2, 3, 4, 5].map(i => `<circle cx="${-37 + i * 15}" cy="54" r="5" fill="#fff8d8"/><circle cx="${-37 + i * 15}" cy="68" r="5" fill="#fff8d8"/>`).join('')}<ellipse cx="0" cy="60" rx="150" ry="70" fill="url(#glow)"/></g>`;
  return `<svg class="tl-park" viewBox="0 0 1600 700" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><radialGradient id="glow"><stop offset="0" stop-color="#fff6c8" stop-opacity=".75"/><stop offset=".35" stop-color="#ffe9a0" stop-opacity=".2"/><stop offset="1" stop-color="#ffe9a0" stop-opacity="0"/></radialGradient>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#173f27"/><stop offset="1" stop-color="#2c6e3f"/></linearGradient>
      <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#080c13" stop-opacity="0"/><stop offset="1" stop-color="#080c13" stop-opacity=".95"/></linearGradient>
      <pattern id="mow" width="80" height="700" patternUnits="userSpaceOnUse"><rect width="40" height="700" fill="#fff" opacity=".035"/></pattern></defs>
    <path d="M-50 300 Q800 150 1650 300 L1650 470 Q800 330 -50 470Z" fill="#111a29"/>
    <path d="M-50 300 Q800 150 1650 300" fill="none" stroke="#1f2d44" stroke-width="3"/>
    ${Array.from({ length: 220 }, (_, i) => `<rect x="${(i * 97) % 1600}" y="${215 + ((i * 53) % 190) * Math.abs(Math.sin(i)) * 0.9 + Math.abs(((i * 97) % 1600) - 800) * 0.09}" width="3" height="3" fill="${['#2a3a55', '#334563', '#5a6b88', '#c8102e', '#ffffff'][i % 5]}" opacity="${0.35 + (i % 3) * 0.2}"/>`).join('')}
    ${tower(170)}${tower(1430)}
    <path d="M-50 470 Q800 330 1650 470 L1650 700 L-50 700Z" fill="url(#grass)"/>
    <path d="M-50 470 Q800 330 1650 470 L1650 700 L-50 700Z" fill="url(#mow)"/>
    <path d="M-50 468 Q800 328 1650 468" fill="none" stroke="#8a6040" stroke-width="16" opacity=".75"/>
    <path d="M-50 462 Q800 322 1650 462" fill="none" stroke="#0f2a1c" stroke-width="5"/>
    <path d="M800 690 L1150 585 L800 530 L450 585Z" fill="#7a5236" stroke="#7a5236" stroke-width="70" stroke-linejoin="round"/>
    <path d="M800 676 L1095 590 L800 545 L505 590Z" fill="#2f7342"/>
    <circle cx="800" cy="600" r="22" fill="#86593a"/>
    <path d="M800 690 L-60 455 M800 690 L1660 455" stroke="#f4f1e6" stroke-width="3" opacity=".55"/>
    ${[[1095, 590], [800, 545], [505, 590]].map(([x, yy]) => `<rect x="${x - 7}" y="${yy - 4}" width="14" height="8" fill="#fff" transform="rotate(${x === 800 ? 0 : x > 800 ? -14 : 14} ${x} ${yy})"/>`).join('')}
    <rect y="0" width="1600" height="700" fill="url(#fog)" opacity=".55"/>
  </svg>`;
}
on('tm-go', el => {
  const k = el.dataset.k;
  sfx('intro');
  if (k === 'continue' && saved) { S.L = saved; welcome(saved, true); return; }
  if (k === 'new') picker();
});

// ---------- franchise picker ----------
function picker() {
  buildPreview();
  if (!cur) cur = (saved && saved.userTid) || pv.teams.find(t => t.abbr === 'NYY')?.id || pv.teams[0].id;
  gm = gm || saved?.gm || '';
  app.innerHTML = `<div class="fpick" id="pick">
    <div class="pk-water" id="pk-water"></div>
    <header class="pk-top"><button class="btn" data-act="pk-back">Back</button><h1>Choose your franchise</h1><span class="grow"></span>
      <span class="seg" id="pk-sort">${[['div', 'Division'], ['ovr', 'Best roster'], ['bud', 'Most money'], ['last', 'Last season']].map(([k, l]) => `<button class="${sortK === k ? 'on' : ''}" data-act="pk-sort" data-k="${k}">${l}</button>`).join('')}</span></header>
    <aside class="pk-list" id="pk-list"></aside>
    <main class="pk-hero" id="pk-hero"></main>
    <aside class="pk-info" id="pk-info"></aside>
    <footer class="pk-foot">
      <label class="pk-field">General manager<input id="pk-gm" type="text" maxlength="24" placeholder="Your name" value="${esc(gm)}"></label>
      <div class="pk-field">Season length<span class="seg" id="pk-len">${[[162, 'Full · 162'], [81, 'Half · 81'], [54, 'Quick · 54']].map(([n, l]) => `<button class="${games === n ? 'on' : ''}" data-act="pk-len" data-n="${n}">${l}</button>`).join('')}</span></div>
      <span class="grow"></span><small class="muted" id="pk-hint">Arrow keys to browse · Enter to start</small>
      <button class="btn pri huge" data-act="pk-go" id="pk-go">Take over</button>
    </footer>
  </div>`;
  drawList();
  choose(cur, true, true);
}
function sortedTeams() {
  const ts = [...pv.teams], inf = id => info.get(id);
  if (sortK === 'ovr') return ts.sort((a, b) => inf(b.id).r.ovr - inf(a.id).r.ovr);
  if (sortK === 'bud') return ts.sort((a, b) => b.budget - a.budget);
  if (sortK === 'last') return ts.sort((a, b) => (b.last?.w || 0) - (a.last?.w || 0));
  return DIVS.flatMap(k => ts.filter(t => `${t.lg} ${t.div}` === k).sort((a, b) => a.name.localeCompare(b.name)));
}
function drawList() {
  const ts = sortedTeams(); order = ts.map(t => t.id);
  const maxB = Math.max(...ts.map(t => t.budget));
  let html = '', lastDiv = '';
  ts.forEach((t, i) => {
    const x = info.get(t.id), dv = `${t.lg} ${t.div}`;
    if (sortK === 'div' && dv !== lastDiv) { html += `<div class="pk-div">${dv}</div>`; lastDiv = dv; }
    const tail = sortK === 'bud' ? `<span class="pk-money">$${t.budget}M</span>` : sortK === 'last' ? `<span class="pk-money">${t.last ? `${t.last.w}-${t.last.l}` : ''}</span>` : `<span class="pk-ovr">${Math.round(x.r.ovr)}</span>`;
    html += `<button class="pk-row${t.id === cur ? ' on' : ''}" data-act="pk-team" data-id="${t.id}" style="--rc:${t.c1}">
      ${sortK === 'div' ? '' : `<span class="pk-n">${i + 1}</span>`}<span class="pk-lg">${logo(t.id, 30)}</span>
      <span class="pk-nm"><b>${esc(t.nick)}</b><small>${esc(t.city)}</small><i class="pk-bar"><i style="width:${(t.budget / maxB * 100).toFixed(1)}%"></i></i></span>${tail}</button>`;
  });
  document.getElementById('pk-list').innerHTML = html;
}
function choose(id, scroll = false, first = false) {
  cur = id;
  const t = T(pv, id), x = info.get(id), root = document.getElementById('pick');
  if (!root) return;
  root.style.setProperty('--tc', t.c1); root.style.setProperty('--ta', accentOf(t));
  document.getElementById('pk-water').innerHTML = logo(t.id, 900);
  const hero = document.getElementById('pk-hero'), inf = document.getElementById('pk-info');
  hero.innerHTML = heroHtml(t, x); inf.innerHTML = infoHtml(t, x);
  for (const el of [hero, inf]) { el.classList.remove('swap'); void el.offsetWidth; if (!first) el.classList.add('swap'); }
  document.querySelectorAll('.pk-row').forEach(r => r.classList.toggle('on', +r.dataset.id === id));
  document.getElementById('pk-go').textContent = `Take over the ${t.nick}`;
  if (scroll) document.querySelector(`.pk-row[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}
function parkSvg(p) {
  const s = 0.205, pt = (d, a) => [100 + d * s * Math.sin(a * Math.PI / 180), 106 - d * s * Math.cos(a * Math.PI / 180)];
  let wall = '';
  for (let a = -45; a <= 45; a += 3) { const [x, y] = pt(fenceAt(p, a), a); wall += `L${x.toFixed(1)} ${y.toFixed(1)} `; }
  const [hx, hy] = pt(0, 0), f = (d, a) => pt(d, a).map(v => v.toFixed(1)).join(' ');
  const lab = (a, v) => { const [x, y] = pt(fenceAt(p, a) + 20, a); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${v}</text>`; };
  return `<svg class="pk-park" viewBox="0 0 200 112" role="img" aria-label="${esc(p.name)} outfield: ${p.lf} left, ${p.cf} center, ${p.rf} right">
    <path d="M${hx} ${hy} ${wall}Z" fill="#2c6e3f" stroke="#a8784e" stroke-width="3" stroke-linejoin="round"/>
    <path d="M${hx} ${hy} ${wall}Z" fill="none" stroke="var(--ta)" stroke-width="1.1"/>
    <path d="M${f(0, 0)} L${f(118, 40)} L${f(150, 0)} L${f(118, -40)}Z" fill="#a8784e" stroke="#a8784e" stroke-width="7" stroke-linejoin="round"/>
    <path d="M${f(4, 0)} L${f(90, 45)} L${f(127, 0)} L${f(90, -45)}Z" fill="#337d49"/>
    ${[[90, 45], [127, 0], [90, -45]].map(([d, a]) => { const [x, y] = pt(d, a); return `<rect x="${(x - 1.6).toFixed(1)}" y="${(y - 1.6).toFixed(1)}" width="3.2" height="3.2" fill="#fff" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>`; }).join('')}
    ${lab(-45, p.lf)}${lab(-22.5, p.lcf)}${lab(0, p.cf)}${lab(22.5, p.rcf)}${lab(45, p.rf)}
  </svg>`;
}
function card(p, tag) {
  const tr = trait(p), pitcher = p.isP && !p.twoWay;
  const hs = (pitcher ? p.hist : p.isP ? p.histB : p.hist) || [];
  const h = hs.filter(x => x.lv === 'MLB').at(-1) || hs.at(-1);
  const line = !h ? 'No pro stats yet' : pitcher ? `${h.y}${h.lv !== 'MLB' ? ' ' + h.lv : ''}: ${h.W || 0}-${h.L || 0}, ${pit(h).era.toFixed(2)} ERA` : `${h.y}${h.lv !== 'MLB' ? ' ' + h.lv : ''}: ${f3(bat(h).avg)}, ${h.HR || 0} HR`;
  return `<div class="scard t-${tr.k}"><span class="sc-ovr"><b>${Math.round(p.ovr)}</b><i>${p.pos}</i></span>
    <img class="sc-face" loading="lazy" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">
    <span class="sc-name"><small>${esc(p.first)}</small>${esc(p.last)}</span><span class="sc-line">${line}</span><span class="sc-trait">${tag || tr.label}</span></div>`;
}
function heroHtml(t, x) {
  const L0 = t.last, k = t.park;
  const stars = active(pv, t.id).sort((a, b) => b.ovr - a.ovr).slice(0, 3);
  const kid = org(pv, t.id).filter(p => p.lvl !== 'MLB' && p.age <= 24).sort((a, b) => shownPot(b) - shownPot(a))[0];
  return `<div class="ph-id"><span class="ph-logo">${logo(t.id, 132)}</span>
      <div><small>${esc(t.city)} · ${t.lg} ${t.div}</small><h2>${esc(t.nick)}</h2>
      ${L0 ? `<p class="ph-last"><b>${L0.y}: ${L0.w}-${L0.l}</b><span>${ord(L0.div)} in the division · ${L0.rd > 0 ? '+' : ''}${L0.rd} run differential</span><em class="po${L0.pr}">${esc(L0.po)}</em></p>` : ''}</div></div>
    <div class="ph-park">${parkSvg(k)}<div><b>${esc(k.name)}</b><span>${k.cap.toLocaleString()} seats · ${esc(k.roof)} roof · ${esc(k.turf)}</span>
      <span>${k.lf} ft left · ${k.cf} ft center · ${k.rf} ft right</span><span>${t.pf[1] >= 1.06 ? 'Hitter-friendly: the ball carries here.' : t.pf[1] <= 0.94 ? 'Pitcher-friendly: home runs die here.' : 'Plays fair for hitters and pitchers.'}</span></div></div>
    <h3 class="ph-h">Faces of the franchise</h3>
    <div class="ph-cards">${stars.map(p => card(p)).join('')}${kid ? card(kid, `Top prospect · potential ${shownPot(kid)}`) : ''}</div>`;
}
const bar = (label, v, rk) => `<div class="meter"><span>${label}</span><div class="bar"><i style="width:${Math.max(6, Math.min(100, (v - 55) / 35 * 100))}%"></i></div><b>${Math.round(v)}</b><em>${ord(rk)}</em></div>`;
function infoHtml(t, x) {
  const b = books(t), pay = x.pay, cbt = pv.cbt, room = t.budget - pay;
  const top = Math.max(t.budget, cbt, pay) * 1.08, pc = v => `${Math.min(100, v / top * 100).toFixed(1)}%`;
  return `<section class="pi-box pi-money"><h3>The money</h3>
      <div class="pi-big"><b>$${t.budget}M</b><span>owner's payroll budget<br>${ord(x.rk.bud)} of 30</span></div>
      <div class="pi-track" aria-label="Payroll ${money(pay)} against budget $${t.budget}M and tax line $${cbt}M">
        <i class="pay" style="width:${pc(pay)}"></i><i class="mk bud" style="left:${pc(t.budget)}"><em>Budget</em></i><i class="mk tax" style="left:${pc(cbt)}"><em>Tax line</em></i></div>
      <dl class="pi-dl">
        <dt>Payroll now</dt><dd>${money(pay)} <small>${ord(x.rk.pay)}</small></dd>
        <dt>Room to spend</dt><dd class="${room < 0 ? 'bad' : 'good'}">${room < 0 ? '-' : ''}${money(Math.abs(room))}</dd>
        <dt>Luxury tax</dt><dd class="${pay > cbt ? 'bad' : ''}">${pay > cbt ? `${money(pay - cbt)} over the line` : `${money(cbt - pay)} under`}</dd>
      </dl>
      <div class="pi-rev"><div class="pi-revbar"><i style="flex:${b.tv.toFixed(0)}"><em>TV and media ${money(b.tv)}</em></i><i style="flex:${b.gate.toFixed(0)}"><em>Tickets ${money(b.gate)}</em></i></div>
        <p>Takes in about <b>${money(b.rev)}</b> a year (${ord(x.rk.rev)} in baseball). Running the club costs ${money(b.ops)} before salaries. About ${b.fans.toLocaleString()} fans a night at $${b.ticket.toFixed(0)} a head. Cash in the bank: ${money(t.cash)}.</p></div>
      <div class="pi-mkt"><span>${MARKET[t.market]}</span><span class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= t.market ? 'on' : ''}"></i>`).join('')}</span></div></section>
    <section class="pi-box"><h3>Roster rating</h3><div class="pi-ovr"><b>${Math.round(x.r.ovr)}</b><span>overall<br>${ord(x.rk.ovr)} of 30</span></div>
      ${bar('Lineup', x.r.off, x.rk.off)}${bar('Rotation', x.r.rot, x.rk.rot)}${bar('Bullpen', x.r.pen, x.rk.pen)}${bar('Defense', x.r.def, x.rk.def)}</section>
    <section class="pi-box"><h3>The job</h3><p class="pi-goal">${esc(t.goal)}</p><p class="muted">The owner wants about ${t.goalW} wins in a full season.</p>
      <div class="pi-diff"><span class="pips d${x.diff}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= x.diff ? 'on' : ''}"></i>`).join('')}</span><b>${DIFF[x.diff]}</b></div><p class="muted">${DIFFTXT[x.diff]}</p></section>`;
}
on('pk-team', el => { if (+el.dataset.id !== cur) { sfx('swipe'); choose(+el.dataset.id); } });
on('pk-sort', el => { sortK = el.dataset.k; document.querySelectorAll('#pk-sort button').forEach(b => b.classList.toggle('on', b === el)); drawList(); document.querySelector(`.pk-row[data-id="${cur}"]`)?.scrollIntoView({ block: 'nearest' }); });
on('pk-len', el => { games = +el.dataset.n; document.querySelectorAll('#pk-len button').forEach(b => b.classList.toggle('on', b === el)); });
on('pk-back', () => titleScreen(saved));
on('pk-go', () => {
  gm = document.getElementById('pk-gm').value.trim();
  const go = () => { S.L = newCareer(S.data, { userTid: cur, games, gm: gm || 'GM' }); saveNow(); welcome(S.L, false); };
  if (saved) return confirmBox('Start a new career?', `This replaces your saved career with the ${T(saved, saved.userTid).name}. Download it from Settings first if you want to keep it.`, 'Start the new career', go);
  go();
});
document.addEventListener('keydown', e => {
  if (S.L || !document.getElementById('modal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const pick = document.getElementById('pick'), title = app.querySelector('.title');
  if (pick) {
    if (e.target.closest?.('input')) { if (e.key === 'Enter') document.getElementById('pk-go').click(); return; }
    const i = order.indexOf(cur);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sfx('swipe'); choose(order[(i + (e.key === 'ArrowDown' ? 1 : order.length - 1)) % order.length], true); }
    else if (e.key === 'Enter' && !e.target.closest?.('button')) document.getElementById('pk-go').click();
    else if (e.key === 'Escape') titleScreen(saved);
  } else if (title) {
    const items = [...title.querySelectorAll('.tm-item')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sfx('tick'); items[(Math.max(0, i) + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    else if (e.key === 'Enter' && document.activeElement?.tagName === 'LABEL') document.activeElement.click();
  }
});

// ---------- welcome ----------
function welcome(L, back) {
  const t = T(L, L.userTid);
  const d = document.createElement('div');
  d.className = 'welcome';
  d.style.setProperty('--tc', t.c1); d.style.setProperty('--ta', accentOf(t));
  d.innerHTML = `<div class="wl-stripe"></div><div class="wl-in"><span class="wl-logo">${logo(t.id, 200)}</span>
    <small>${back ? 'Welcome back' : `Welcome to ${esc(t.city)}`}</small><b>${esc(t.nick)}</b><span>General manager ${esc(L.gm)} · ${L.season} season</span></div>`;
  document.body.appendChild(d);
  const fast = reduce();
  setTimeout(() => { S.view = 'home'; render(); }, fast ? 0 : 700);
  setTimeout(() => d.classList.add('out'), fast ? 600 : 1900);
  setTimeout(() => d.remove(), fast ? 700 : 2500);
}
