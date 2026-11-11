// Offline page renders: draws every page to PNG with a hidden headless browser (its own
// throwaway profile; no window opens). Run: node tools/shots.mjs [outDir] [width] [height]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'shots');
const W = +(process.argv[3] || 1440), H = +(process.argv[4] || 900);
const only = process.argv[5] ? process.argv[5].split(',') : null;
const PORT = 5199;
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
await mkdir(out, { recursive: true });
const srv = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, PORT }, stdio: 'ignore' });
const prof = await mkdtemp(path.join(os.tmpdir(), 'ballclub-shots-'));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: prof, args: ['--mute-audio', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_/.test(m.text())) errs.push(m.text()); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, full = true) => { if (only && !only.includes(name)) return; await wait(700); await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full }); console.log('shot', name); };
// elements whose boxes collide or spill out of their parent
const audit = async name => {
  const bad = await page.evaluate(() => {
    const out = []; const vis = e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    for (const el of document.querySelectorAll('.mast, .tabs, .nav, .head, .tile, .panel > h3, .tile > h3, .tp-vs, .tp-sp, .tp-btn, .meter, .scard, .lu .slot, .pcard, .gv-top, .mcard, .mgr, .row')) {
      if (!vis(el)) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible') out.push(`overflow-x ${el.className} ${el.scrollWidth}>${el.clientWidth}`);
      const kids = [...el.children].filter(vis);
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        if (getComputedStyle(kids[i]).position === 'absolute' || getComputedStyle(kids[j]).position === 'absolute') continue;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 3 && oy > 3) out.push(`overlap in .${el.className.split(' ')[0]}: ${kids[i].className || kids[i].tagName} x ${kids[j].className || kids[j].tagName} (${Math.round(ox)}x${Math.round(oy)})`);
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 2) out.push(`page scrolls sideways ${document.documentElement.scrollWidth}>${innerWidth}`);
    return [...new Set(out)].slice(0, 12);
  });
  if (bad.length) console.log(`  [${name}]`, bad.join('\n     '));
};
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });
  await wait(1800); await shot('00-title', false);
  await page.evaluate(() => document.querySelector('[data-k="new"]').click()); await wait(500); await shot('01-pick', false); await audit('pick');
  await page.evaluate(() => [...document.querySelectorAll('.pk-row')].find(c => c.textContent.includes('Padres')).click()); await shot('02-pick-sd', false);
  await page.evaluate(() => [...document.querySelectorAll('.pk-row')].find(c => c.textContent.includes('Yankees')).click()); await page.evaluate(() => document.getElementById('pk-go').click()); await wait(900); await shot('03-welcome', false); await wait(1800);
  const go = v => page.evaluate(v => document.dispatchEvent(new CustomEvent('bc-go', { detail: v })), v);
  // play a few weeks so pages have content
  await page.evaluate(async () => { const m = await import('/js/engine/season.js'); const { S } = await import('/js/ui/core.js'); S.L.opts.autoRoster = true; for (let i = 0; i < 24; i++) m.advanceDay(S.L); S.L.opts.autoRoster = false; const c = await import('/js/ui/core.js'); window.__go = c.go; c.render(); });
  const views = ['home', 'inbox', 'roster', 'lineup', 'minors', 'schedule', 'standings', 'stats', 'playoffs', 'teams', 'trades', 'fa', 'money', 'draft', 'history', 'settings'];
  for (const v of views) { await page.evaluate(v => window.__go(v), v); await shot(v); await audit(v); }
  await page.evaluate(() => { window.__go('trades'); for (const s of ['give', 'get']) { const rows = document.querySelectorAll(`#main tr[data-side="${s}"] td`); rows[0].click(); } }); await page.evaluate(() => { document.querySelectorAll('#main tr[data-side="give"]')[3].querySelector('td').click(); }); await shot('trades2'); await audit('trades2');
  await page.evaluate(() => { window.__go('roster'); document.querySelector('#main .pl').click(); });
  await shot('player', false); await audit('player');
  await page.evaluate(() => { document.querySelector('#modal .x').click(); window.__go('home'); document.querySelector('[data-act="play"]')?.click(); });
  await wait(9000); await shot('viewer', false); await audit('viewer');
  await page.evaluate(() => document.querySelector('#gv-skip')?.click()); await wait(1500); await shot('viewer-final', false);
  // ---- moments, legacy, prospects, draft room, auction, ultimatum ----
  const run = (fn, arg) => page.evaluate(fn, arg);
  const drain = () => run(async () => { const { S } = await import('/js/ui/core.js'); S.L.pops.length = 0; const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; });
  await run(() => document.querySelector('#gv-done')?.click()); await wait(300); await drain();
  const say = (k, extra) => run(async ([k, extra]) => { const { S, render } = await import('/js/ui/core.js'); const L = S.L; const star = L.players.filter(p => p.tid === L.userTid).sort((a, b) => b.ovr - a.ovr)[0];
    const base = { owner: { k: 'owner', kick: 'From the owner', title: 'Go get someone', text: 'We are in this race. I am adding $14M to this year\'s budget. Spend it before the deadline on Jul 31.', tid: L.userTid, acts: [['Trade center', 'go', { v: 'trades' }]] },
      ach: { k: 'ach', kick: 'Achievement unlocked', title: 'Red hot', text: 'Win ten games in a row. +20 legacy points.', pts: 20 },
      won: { k: 'fa-won', kick: 'Free agency', title: `${star.first} ${star.last} is yours`, text: 'He picked you over 2 other clubs: 6 years at $31.5M a year ($189M in all).', pid: star.id, tid: L.userTid } }[k];
    L.pops.push({ id: 1, ...base, ...extra }); render(); }, [k, extra || {}]);
  for (const k of ['owner', 'ach', 'won']) { await say(k); await shot(`moment-${k}`, false); await audit(`moment-${k}`); await drain(); }
  await run(async () => { const { S } = await import('/js/ui/core.js'); const L = S.L, t = L.teams.find(x => x.id === L.userTid);
    L.gmc.seasons.push({ y: 2027, tid: t.id, abbr: t.abbr, w: 97, l: 65, po: 5, champ: 1, pay: 251 }, { y: 2028, tid: t.id, abbr: t.abbr, w: 91, l: 71, po: 4, champ: 0, pay: 262 });
    for (const id of ['win1', 'october', 'title', 'blockbuster']) L.gmc.ach[id] = { y: 2027, tid: t.id };
    const vet = L.players.filter(p => p.real).sort((a, b) => b.ovr - a.ovr)[0];
    L.hof.push({ pid: vet.id, first: vet.first, last: vet.last, real: 1, pos: vet.pos, war: 88.4, awards: ['2025 AL MVP'], tid: vet.tid, mine: 1, ind: 2028, pct: 97 });
    L.lastVote = { y: 2028, rows: [{ s: { pid: vet.id, first: vet.first, last: vet.last, pos: vet.pos, war: 88.4, awards: [] }, pct: 97, yrs: 1, in: true }, { s: { pid: 1, first: 'Joe', last: 'Example', pos: 'SS', war: 52.1, awards: [] }, pct: 58, yrs: 3, in: false }] };
    t.recs = { HR: { v: 52, nm: 'Aaron Judge', y: 2027 }, K: { v: 241, nm: 'Gerrit Cole', y: 2027 }, AVG: { v: 0.322, nm: 'Juan Soto', y: 2027 }, tW: { v: 97, nm: '97-65', y: 2027 } }; });
  for (const k of ['career', 'ach', 'hof', 'rec']) { await run(k => { window.__go('legacy'); document.querySelector(`[data-act="lg-tab"][data-k="${k}"]`).click(); }, k); await shot(`legacy-${k}`); await audit(`legacy-${k}`); }
  await run(() => window.__go('prospects')); await shot('prospects'); await audit('prospects');
  await run(() => { document.querySelector('[data-act="pro-tab"][data-k="top"]').click(); }); await shot('prospects-top'); await run(() => document.querySelector('[data-act="pro-tab"][data-k="mine"]').click());
  // the ultimatum on the hub
  await run(async () => { const m = await import('/js/engine/season.js'); const { S, render } = await import('/js/ui/core.js'); const L = S.L, t = L.teams.find(x => x.id === L.userTid); L.opts.autoRoster = true;
    while (t.w + t.l < L.games * 0.32) m.advanceDay(L); t.mood0 = -40; m.advanceDay(L); L.pops.length = 0; window.__go('home'); render(); });
  await shot('home-ultimatum', false); await audit('home-ultimatum');
  // draft room
  await run(async () => { const m = await import('/js/engine/season.js'); const { S } = await import('/js/ui/core.js'); const L = S.L, t = L.teams.find(x => x.id === L.userTid);
    t.ult = null; t.ultDone = 1; t.mood0 = 60; L.fired = 0; let g = 0; while (!L.draft && g++ < 200) m.advanceDay(L); if (m.onClock(L) !== L.userTid) m.draftAdvance(L); L.pops.length = 0; window.__go('draft'); });
  await shot('draft-room'); await audit('draft-room');
  await run(() => document.querySelector('.dr-top [data-act="draft-pick"]')?.click()); await wait(600); await shot('draft-reveal', false); await audit('draft-reveal');
  // the winter auction
  await run(async () => { const m = await import('/js/engine/season.js'); const { S } = await import('/js/ui/core.js'); const L = S.L, t = L.teams.find(x => x.id === L.userTid);
    document.getElementById('modal').hidden = true; m.draftAdvance(L, true); let g = 0; while (L.phase !== 'offseason' && g++ < 400) m.advanceDay(L); if (L.off.stage === 'resign') m.offseasonAdvance(L); m.offseasonAdvance(L);
    t.budget = 600; const fas = m.freeAgents(L).filter(p => p.ovr >= m.CONTESTED).sort((a, b) => b.ovr - a.ovr);
    m.offerFA(L, fas[0].id, fas[0].ask.aav * 1.02, fas[0].ask.yrs); m.offerFA(L, fas[1].id, fas[1].ask.aav * 1.1, fas[1].ask.yrs); L.pops.length = 0; window.__fa = fas[0].id; window.__go('fa'); });
  await shot('fa-auction'); await audit('fa-auction');
  await run(() => document.querySelector(`[data-act="fa-offer"][data-id="${window.__fa}"]`).click()); await wait(300); await shot('fa-bid', false); await audit('fa-bid');
  await run(() => { document.getElementById('modal').hidden = true; window.__go('home'); }); await shot('home-auction', false); await audit('home-auction');
} finally {
  if (errs.length) console.log('page errors:', errs.slice(0, 5).join(' | '));
  await browser.close(); srv.kill(); await rm(prof, { recursive: true, force: true }).catch(() => { });
}
