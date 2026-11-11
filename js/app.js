// Boot, start screen, the shell around every page, and the sim buttons.
import { S, views, mounts, on, esc, logo, toast, render, setShell, go, save, saveNow, loadSaved, wipeSaved, closeModal, modal, ord, sfx, muted, setMuted, accentOf } from './ui/core.js';
import { titleScreen } from './ui/title.js';
import { newCareer, index, T, today, userGameToday, todaysGames, standings, active, forty, payroll, probableSP } from './engine/league.js';
import { advanceDay, blockers, userSeries, liveSeries, offseasonAdvance, FA_DAYS, onClock, takeJob } from './engine/season.js';
import { tradeDeadlineDay } from './engine/trade.js';
import { fmtDate } from './engine/schedule.js';
import './ui/views.js';
import './ui/hub.js';
import './ui/office.js';
import './ui/player.js';
import './ui/legacy.js';
import './ui/prospects.js';
import { showPops } from './ui/moments.js';
import { ensureState } from './engine/legacy.js';
import { openViewer } from './ui/viewer.js';

const app = document.getElementById('app');
const textOn = hex => { const n = parseInt(hex.slice(1), 16), l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 150 ? '#16211c' : '#fff'; };

// ---------- shell ----------
// Four main tabs (Q / E switch them, like shoulder buttons) and the pages inside each.
const TABS = [
  ['Home', [['home', 'Home'], ['inbox', 'Messages'], ['legacy', 'Legacy']]],
  ['Team', [['roster', 'Roster'], ['lineup', 'Lineup'], ['minors', 'Minors'], ['prospects', 'Prospects']]],
  ['League', [['standings', 'Standings'], ['schedule', 'Schedule'], ['stats', 'Stats'], ['playoffs', 'Playoffs'], ['teams', 'Clubs']]],
  ['Office', [['trades', 'Trades'], ['fa', 'Free agents'], ['money', 'Contracts'], ['draft', 'Draft'], ['history', 'History']]],
];
const ALIAS = { box: 'home', team: 'teams', jobs: 'home' };
const tabOf = v => TABS.findIndex(t => t[1].some(x => x[0] === (ALIAS[v] || v)));
// The one thing to press next. Home has its own big buttons, so the bar stays empty there.
function primaryActions(L, view) {
  if (view === 'home' && !L.fired && !(L.draft && !L.draft.done)) return '';
  const btn = (act, label, extra = '') => `<button class="btn pri big" data-act="${act}" ${extra}>${label}</button>`;
  if (L.fired) return btn('go', 'Find a new job', 'data-v="jobs"');
  if (L.draft && !L.draft.done) return view === 'draft' ? '' : btn('go', 'Go to the draft', 'data-v="draft"');
  if (L.phase === 'offseason') return btn('adv', L.off.stage === 'resign' ? 'Open free agency' : 'Next day');
  if (blockers(L).length) return view === 'roster' ? '' : btn('go', 'Fix your roster', 'data-v="roster"');
  if (L.phase === 'playoffs') { const s = userSeries(L); return s && L.po.rest === 0 ? btn('play', 'Play game') : btn('adv', 'Sim day'); }
  return userGameToday(L) ? btn('play', 'Play game') : btn('adv', 'Next day');
}function whenText(L) {
  if (L.phase === 'offseason') return [`Offseason ${L.season}–${String(L.season + 1).slice(2)}`, L.off.stage === 'resign' ? 'Re-sign your own players' : `Free agency, day ${L.off.day + 1} of ${FA_DAYS}`];
  if (L.phase === 'playoffs') { const s = userSeries(L); return [`October ${L.season}`, s ? `Series ${s.a === L.userTid ? s.wa : s.wb}–${s.a === L.userTid ? s.wb : s.wa} vs ${T(L, s.a === L.userTid ? s.b : s.a).nick}` : 'Playoffs under way']; }
  const g = userGameToday(L);
  return [`${fmtDate(L.season, L.day, true)}, ${L.season}`, g ? `${g.h === L.userTid ? 'vs' : 'at'} ${T(L, g.h === L.userTid ? g.a : g.h).name}` : (L.sched[L.day] ? 'Day off' : '')];
}
let lastView = '';
function shell() {
  const L = S.L;
  if (!L) return;
  ensureState(L);
  const t = T(L, L.userTid);
  const css = document.documentElement.style;
  css.setProperty('--club', t.c1); css.setProperty('--club2', t.c2); css.setProperty('--club-ink', textOn(t.c1));
  css.setProperty('--accent', accentOf(t));
  const unread = L.inbox.filter(m => m.unread).length;
  const [w1, w2] = whenText(L);
  const view = views[S.view] ? S.view : 'home';
  const ti = tabOf(view);
  let body;
  try { body = views[view](); } catch (e) { console.error(e); body = `<div class="note err">Something went wrong drawing this page: ${esc(e.message)}</div>`; }
  const fresh = view !== lastView; lastView = view;
  const dot = v => (v === 'inbox' && unread) || (v === 'draft' && L.draft && !L.draft.done);
  const sub = ti >= 0 && TABS[ti][1].length > 1 ? TABS[ti][1] : null;
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <a class="bar-team" data-act="go" data-v="home" title="Home"><span class="logo">${logo(t.id, 34)}</span><span><b>${esc(t.nick)}</b><small>${t.w}-${t.l}</small></span></a>
      <nav class="tabs" aria-label="Main">${TABS.map(([label, pages], i) => `<a data-act="go" data-v="${pages[0][0]}" class="${i === ti ? 'on' : ''}">${label}${pages.some(x => dot(x[0])) ? '<i class="dot"></i>' : ''}</a>`).join('')}</nav>
      <div class="when"><b>${w1}</b><span>${w2}</span></div>
      <div class="acts">${S.busy ? '<button class="btn pri big" data-act="stop">Stop</button>' : primaryActions(L, view)}</div>
      <button class="gear${view === 'settings' ? ' on' : ''}" data-act="go" data-v="settings" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z"/></svg></button>
    </header>
    ${sub ? `<nav class="nav">${sub.map(([v, label]) => `<a data-act="go" data-v="${v}" class="${(ALIAS[view] || view) === v ? 'on' : ''}">${label}${dot(v) ? '<i class="dot"></i>' : ''}</a>`).join('')}</nav>` : ''}
    <main class="main${fresh ? ' enter' : ''}" id="main">${body}</main>
  </div>`;
  mounts[view]?.(document.getElementById('main'));
  showPops();
}on('mute', () => { setMuted(!muted()); render(); });
document.addEventListener('keydown', e => {
  if (!S.L || document.querySelector('.gv') || !document.getElementById('modal').hidden) return;
  if (e.target.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'q' && k !== 'e') return;
  const i = (Math.max(0, tabOf(S.view)) + (k === 'e' ? 1 : TABS.length - 1)) % TABS.length;
  sfx('tab'); go(TABS[i][1][0][0]);
});setShell(shell);

// ---------- sim controls ----------
let stopFlag = false;
function oneDay() {
  const L = S.L;
  const r = advanceDay(L);
  if (r.blocked) { toast(r.blocked[0], true); if (!(L.draft && !L.draft.done)) S.view = L.fired ? 'jobs' : 'roster'; return false; }
  return true;
}
async function simUntil(stopWhen, max = 400) {
  const L = S.L;
  S.busy = true; stopFlag = false; render();
  const phase0 = L.phase, season0 = L.season;
  let n = 0;
  const injBase = () => L.news.filter(x => x.k === 'inj' && x.tid === L.userTid).length + L.inbox.filter(m => m.k === 'offer' && !m.done).length;
  let base = injBase();
  L.pops ??= [];
  const big = () => L.pops.filter(p => p.stop).length;
  let big0 = big();
  while (n++ < max && !stopFlag) {
    if (!oneDay()) break;
    if (L.draft && !L.draft.done && onClock(L) === L.userTid) { toast('You are on the clock in the draft.'); S.view = 'draft'; break; }
    if (stopWhen(L, phase0, season0)) break;
    if (big() > big0) break;          // the owner, a free agent's decision: the GM has to see this now
    big0 = big();
    const now = injBase();
    if (now > base) { toast('Stopped: something needs your attention. Check the inbox and news.'); break; }
    base = now;
    if (n % 4 === 0) { const w = document.querySelector('.topbar .when'); if (w) { const [a, b] = whenText(L); w.innerHTML = `<b>${a}</b><span>${b}</span>`; } await new Promise(r => setTimeout(r, 0)); }
  }
  S.busy = false; save(); render();
}
on('stop', () => { stopFlag = true; });
on('adv', () => { if (oneDay()) { const b = S.L.lastBox; if (b && b.day === S.L.day - 1 && S.view === 'home') { /* stay */ } } save(); render(); });
on('simto', el => { const v = el.value; el.value = ''; if (v) runSim(v); });
on('sim', el => runSim(el.dataset.to));
function runSim(to) {
  const L = S.L;
  if (to === 'season') return simUntil((l, ph, se) => l.season !== se);
  if (to === 'phase') return simUntil((l, ph) => l.phase !== ph);
  if (to === 'asb') { const d = L.sched.findIndex(x => x.asb); return simUntil(l => l.day > d || l.draft); }
  if (to === 'dl') { const d = tradeDeadlineDay(L) - 3; return simUntil(l => l.day >= d); }
  const target = L.day + (+to || 1);
  return simUntil((l, ph) => l.day >= target || l.phase !== ph);
}
on('play', () => {
  const L = S.L;
  if (blockers(L).length) { toast(blockers(L)[0], true); return go('roster'); }
  openViewer(() => { save(); render(); });
});
on('take-job', el => { takeJob(S.L, +el.dataset.id); save(); go('home'); });
views.jobs = () => {
  const L = S.L;
  const open = [...L.teams].filter(t => t.id !== L.userTid).sort((a, b) => b.rank0 - a.rank0).slice(0, 8);
  return `<div class="head"><div><h1>You have been let go</h1><p>The owner lost patience. These clubs are looking for a general manager.</p></div></div>
  <div class="panel"><table class="t"><thead><tr><th class="l">Club</th><th>Last year</th><th>Budget</th><th></th></tr></thead><tbody>${open.map(t => `<tr><td class="l">${logo(t.id, 22)} <b>${esc(t.name)}</b></td><td>${t.hist.at(-1)?.w ?? '-'}–${t.hist.at(-1)?.l ?? '-'}</td><td>$${t.budget}M</td><td><button class="btn pri sm" data-act="take-job" data-id="${t.id}">Take this job</button></td></tr>`).join('')}</tbody></table></div>`;
};

// ---------- boot ----------
(async function boot() {
  try {
    S.data = await (await fetch('data/league.json')).json();
    // ids with a photo in img/faces; without the list every real player still tries one
    try { S.faces = new Set(await (await fetch('data/faces.json')).json()); } catch { S.faces = null; }
  } catch (e) {
    app.innerHTML = `<div class="boot">Could not load the league data.<br><small>Open the game through the start file (start.bat) so it runs from a local web address, not by double-clicking index.html.</small></div>`;
    return;
  }
  const saved = await loadSaved();
  titleScreen(saved);
})();
window.addEventListener('beforeunload', () => { if (S.L) saveNow(); });
export { whenText };
