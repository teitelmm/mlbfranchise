// Moments: the big news cards (owner calls, free-agent decisions, achievements, debuts,
// breakouts, Hall of Fame). The engine queues them in L.pops; they show one at a time.
import { S, on, esc, logo, faceUrl, avatarSvg, modal, closeModal, sfx, render, T } from './core.js';
import { P } from '../engine/league.js';

const LOOK = {
  owner: ['#c8102e', 'brief'], ult: ['#ff5468', 'brief'], fired: ['#ff5468', 'brief'],
  'fa-won': ['#3ddc84', 'stamp', 'SIGNED'], 'fa-lost': ['#6e7c95', 'stamp', 'GONE'], outbid: ['#ffb020', 'brief'],
  ach: ['#ffc93c', 'ach'], debut: ['#4d8dff', 'card'], breakout: ['#a35cf0', 'card'], hof: ['#ffc93c', 'card'], record: ['#ffc93c', 'brief'], draft: ['#4d8dff', 'card'],
};
const pic = (p, cls = 'mo-face') => `<img class="${cls}" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">`;

export function showPops() {
  const L = S.L;
  if (S.popHold) { S.popHold = 0; return; }
  if (!L?.pops?.length || S.busy || document.querySelector('.gv') || !document.getElementById('modal').hidden) return;
  const m = L.pops.shift(), more = L.pops.length;
  const [col, kind, stamp] = LOOK[m.k] || LOOK.owner;
  const p = m.snap ? { ...m.snap, id: m.snap.pid, tid: -3 } : m.pid ? P(L, m.pid) : null;
  const t = m.tid ? T(L, m.tid) : p && p.tid >= 0 ? T(L, p.tid) : null;
  const art = kind === 'ach' ? `<div class="mo-medal"><b>+${m.pts || 0}</b><span>legacy</span></div>`
    : p ? pic(p) : t ? `<span class="mo-logo">${logo(t.id, 96)}</span>` : '';
  const acts = (m.acts || []).map(([label, act, d]) => `<button class="btn big" data-act="pop-act" data-a="${act}"${d?.v ? ` data-v="${d.v}"` : ''}${d?.id ? ` data-id="${d.id}"` : ''}>${esc(label)}</button>`).join('');
  modal(`<div class="moment mk-${kind}" style="--mc:${col}">
    <div class="mo-kick">${esc(m.kick || '')}</div>
    <div class="mo-row">${art}<div class="mo-txt"><h2>${esc(m.title)}</h2><p>${esc(m.text || '')}</p></div></div>
    ${stamp ? `<span class="mo-stamp">${stamp}</span>` : ''}
    <div class="mo-btns">${acts}<button class="btn pri big" data-act="pop-next">${more ? `Next (${more} more)` : 'Continue'}</button></div>
  </div>`, true);
  sfx(m.k === 'ach' || m.k === 'fa-won' || m.k === 'hof' ? 'go' : m.k === 'fa-lost' || m.k === 'fired' || m.k === 'outbid' ? 'bad' : 'open');
}
on('pop-next', () => { closeModal(); if (S.L?.pops?.length) showPops(); else render(); });
// an action button on a moment: close it, then do the thing (the rest of the queue waits)
on('pop-act', el => {
  closeModal(); S.popHold = 1;
  const a = el.dataset.a;
  const fake = document.createElement('button');
  fake.dataset.act = a; if (el.dataset.v) fake.dataset.v = el.dataset.v; if (el.dataset.id) fake.dataset.id = el.dataset.id;
  fake.hidden = true; document.body.appendChild(fake); fake.click(); fake.remove();
});
