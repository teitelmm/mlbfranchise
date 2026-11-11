// Drives the real pages in a headless DOM (jsdom): start a career, open every page,
// play a game in the viewer, draft, reach the offseason. Run: node tests/ui.mjs
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/, ''), { url: 'http://localhost:5173/', pretendToBeVisual: true });
const w = dom.window;
const noop = new Proxy(function () { }, { get: (t, k) => k === 'canvas' ? {} : k === 'width' ? 0 : noop, apply: () => noop, set: () => true });
w.HTMLCanvasElement.prototype.getContext = () => noop;
w.confirm = () => true; w.scrollTo = () => { }; w.Element.prototype.scrollIntoView = () => { };
console.warn = () => { };
for (const k of ['window', 'document', 'location', 'HTMLElement', 'CustomEvent', 'Blob']) globalThis[k] = w[k];
globalThis.requestAnimationFrame = fn => setTimeout(() => fn(performance.now()), 4);
globalThis.fetch = async u => ({ json: async () => JSON.parse(await readFile(new URL(u, root), 'utf8')) });
globalThis.indexedDB = undefined;
Object.defineProperty(globalThis, 'localStorage', { value: w.localStorage, configurable: true });
const errors = [];
const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ')); };
process.on('unhandledRejection', e => { errors.push('unhandled: ' + (e?.stack || e)); });

let pass = 0, fail = 0;
const check = (c, label, extra = '') => { if (c) pass++; else { fail++; console.log('  FAIL', label, extra); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const main = () => $('#main')?.innerHTML || '';
const broken = () => main().includes('Something went wrong');

await import('../js/app.js');
const { S, go: nav } = await import('../js/ui/core.js');
const season = await import('../js/engine/season.js');
const league = await import('../js/engine/league.js');
await wait(300);
check(!!$('.title .tl-logo') && !!$('.ticker'), 'title screen draws');
click($('[data-act="tm-go"][data-k="new"]'));
check($$('.pk-row').length === 30, 'franchise picker lists 30 clubs', $$('.pk-row').length);
click($$('.pk-row').find(c => c.textContent.includes('Mariners')));
check($('#pk-hero').textContent.includes('Mariners') && $('#pk-info').textContent.includes('owner'), 'picked club shows its money and roster');
click($('[data-act="pk-sort"][data-k="bud"]')); check($$('.pk-row')[0].textContent.includes('$'), 'sort by money');
click($('#pk-go'));
await wait(1200);
check(!!S.L && $('.topbar .bar-team b')?.textContent.includes('Mariners'), 'career starts');
const L = S.L;

const pages = ['home', 'inbox', 'legacy', 'roster', 'lineup', 'minors', 'prospects', 'schedule', 'standings', 'stats', 'playoffs', 'teams', 'trades', 'fa', 'money', 'draft', 'history', 'settings'];
const tour = tag => {
  for (const v of pages) { nav(v); check(main().length > 200 && !broken(), `${tag}: ${v} page draws`, main().slice(0, 160)); }
  nav('legacy'); for (const k of ['ach', 'hof', 'rec', 'career']) { click($(`[data-act="lg-tab"][data-k="${k}"]`)); check(!broken() && main().length > 300, `${tag}: legacy ${k} tab`); }
  nav('prospects'); click($('[data-act="pro-tab"][data-k="top"]')); check(!broken() && main().includes('Ceiling'), `${tag}: top 100`); click($('[data-act="pro-tab"][data-k="mine"]'));
  // drain any moments so they do not pile up between checks
  let n = 0; while (!$('#modal').hidden && $('#modal .moment') && n++ < 40) click($('#modal [data-act="pop-next"]'));
  if (!$('#modal').hidden) click($('#modal .x'));
};
tour('opening day');

// player card, lineup swap, trade screen
nav('roster'); click($('#main .pl'));
check(!$('#modal').hidden && $('#modal').textContent.includes('overall'), 'player card opens'); click($('#modal .x'));
nav('lineup'); const slots = $$('.lu .slot[data-k^="L"]'); const before = L.teams.find(t => t.id === L.userTid).lineup.R.map(x => x[0]).join();
click(slots[0]); click($$('.lu .slot[data-k^="L"]')[3]);
check(L.teams.find(t => t.id === L.userTid).lineup.R.map(x => x[0]).join() !== before && !L.opts.autoLineup, 'lineup swap works and turns the coach off');
nav('trades'); click($('#main tr[data-act="tr-row"][data-side="give"] td')); check($$('.tcard').length === 1, 'clicking a player deals his card onto the table'); click($('#main tr[data-act="tr-row"][data-side="get"] td')); check(main().includes('gauge') && $$('.tcard').length === 2, 'interest gauge draws');
click($('[data-act="tr-shop"]')); check(main().includes('Offers for') && !broken(), 'shopping a player lists offers or says nobody bites');
click($('[data-act="tr-clear"]'));

// watch a game
nav('home');
const day0 = L.day;
click($('[data-act="play"]'));
await wait(200);
check(!!$('.gv'), 'viewer opens');
click($$('#gv-speed button')[2]);
await wait(6000);
check($$('#gv-pbp div').length > 3, 'play-by-play is flowing', $$('#gv-pbp div').length);
check($$('#gv-zone circle').length >= 0 && $('#gv-board .board'), 'scoreboard drawn');
const pr = $('.gv-prompt'); if (pr) click(pr.querySelector('[data-r=""]') || pr.querySelector('[data-r]'));
click($('#gv-skip'));
await wait(1500);
check(!!$('#gv-done'), 'final screen shows', errors.slice(-2).join(' | '));
if ($('#gv-done')) click($('#gv-done'));
await wait(100);
check(!$('.gv') && L.day === day0 + 1, 'game booked and the day advanced', `day ${L.day}`);
check(L.lastBox && !!$('.lastline'), 'last game box on home page');
click($('[data-act="go"][data-v="box"]')); check(main().includes('Batter') && !broken(), 'box score page');

// a full game played out by the bench coach at top speed (no skip)
nav('home'); click($('[data-act="play"]')); await wait(100);
$('#gv-coach').checked = true; $('#gv-coach').dispatchEvent(new w.Event('change', { bubbles: true }));
click($$('#gv-speed button')[2]);
const { default: _ } = { default: 0 };
let waited = 0; while (!$('#gv-done') && waited < 150000) { await wait(1000); waited += 1000; const p2 = $('.gv-prompt'); if (p2) click(p2.querySelector('[data-r]')); }
check(!!$('#gv-done'), 'a whole animated game finishes', `${waited} ms`);
if ($('#gv-done')) click($('#gv-done'));

// sim on: next day, then to the draft
L.opts.autoRoster = true;
click($('[data-act="adv"]')); check(L.day === day0 + 3, 'next day button');
while (!(L.draft) && L.phase === 'regular') { const r = season.advanceDay(L); if (r.blocked) { check(false, 'sim blocked', r.blocked.join()); break; } }
check(L.draft && !L.draft.done, 'draft starts at the break');
nav('draft');
check(main().includes('Draft board') && !broken(), 'draft board draws');
if (season.onClock(L) !== L.userTid) season.draftAdvance(L);
nav('draft');
const db = $('[data-act="draft-pick"]'); check(!!db, 'user is on the clock with Draft buttons');
if (db) { click(db); check(L.draft.picks.some(x => x.tid === L.userTid), 'user pick recorded'); }
click($('[data-act="dr-autoall"]')); check(L.draft.done, 'auto-draft finishes the draft');
tour('mid-season');

// finish the year
let guard = 0; while (L.phase === 'regular' && guard++ < 300) season.advanceDay(L);
check(L.phase === 'playoffs', 'playoffs begin'); tour('playoffs');
guard = 0; while (L.phase === 'playoffs' && guard++ < 80) season.advanceDay(L);
check(L.phase === 'offseason' && L.off.stage === 'resign', 'offseason begins'); tour('offseason');
click($('.topbar [data-act="adv"]')); check(L.off.stage === 'fa', 'free agency opens from the masthead button');
nav('fa'); const ob = $('[data-act="fa-offer"]'); check(!!ob, 'free agents listed');
if (ob) { click(ob); check($('#of-aav') && !$('#modal').hidden, 'offer form opens'); click($('#modal .x')); }
// a bidding war through the real buttons
{
  const tm = L.teams.find(t => t.id === L.userTid); tm.budget = 900;
  const star = season.freeAgents(L).filter(p => p.ovr >= season.CONTESTED).sort((a, b) => b.ovr - a.ovr)[0];
  check(!!star, 'a star is on the market');
  if (star) {
    nav('fa'); click($(`[data-act="fa-offer"][data-id="${star.id}"]`));
    check(!!$('#modal .auc'), 'auction offer form shows the bidding war');
    $('#of-aav').value = (star.ask.aav * 1.15).toFixed(1); click($('#modal [data-act="fa-send"]'));
    check(star.bids?.some(b => b.tid === L.userTid) && star.tid === -1, 'bid placed through the form', $('#toast').textContent);
    nav('fa'); check(!!$('.bwar'), 'bidding war card on the free agents page');
    nav('home'); check(!broken(), 'hub draws during an auction');
    guard = 0; while (star.tid === -1 && guard++ < 10) click($('#main [data-act="adv"]'));
    check(star.tid !== -1, 'he decided');
    check(!!$('#modal .moment') && /Free agency/.test($('#modal').textContent), 'decision shown as a moment', $('#modal').textContent.slice(0, 120));
    let n = 0; while (!$('#modal').hidden && n++ < 40) click($('#modal [data-act="pop-next"]') || $('#modal .x'));
  }
}
guard = 0; while (L.phase === 'offseason' && guard++ < 60) season.advanceDay(L);
check(L.phase === 'regular' && L.season === S.data.season + 1, 'new season starts'); tour('year two');
check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' || '));
console.error = origErr;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
