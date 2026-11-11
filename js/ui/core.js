// Shared UI plumbing: state, saving, small HTML helpers, click routing.
import { index, P, T } from '../engine/league.js';
import { fmtMoney } from '../engine/money.js';
import { shownPot } from '../engine/season.js';

export const S = { L: null, data: null, view: 'home', arg: null, busy: false };
export const views = {};       // name -> () => html
export const mounts = {};      // name -> (root) => void, after render
const actions = {};            // data-act -> handler(el, event)
export const on = (name, fn) => { actions[name] = fn; };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = m => fmtMoney(m);
export const pname = p => `${p.first} ${p.last}`;
export const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

// ---------- pictures ----------
const SKIN = ['#f1c9a5', '#e0ac7e', '#c68642', '#a5673f', '#7a4a2a', '#f5d6b8'];
export function avatarSvg(p, c1 = '#17402f', c2 = '#fff') {
  const s = (p.face ?? p.id) | 0, skin = SKIN[s % SKIN.length], hair = ['#2b1b10', '#111', '#5a3a1e', '#8a5a2b', '#3b2a1a'][(s >> 3) % 5];
  const beard = (s >> 5) % 3 === 0;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#dfe5dd"/><path d="M14 100c2-22 16-30 36-30s34 8 36 30z" fill="${c1}"/><path d="M42 70h16l-8 12z" fill="${c2}"/><rect x="43" y="56" width="14" height="16" fill="${skin}"/><ellipse cx="50" cy="44" rx="17" ry="20" fill="${skin}"/>${beard ? `<path d="M34 48c2 16 30 16 32 0-4 9-28 9-32 0z" fill="${hair}"/>` : ''}<path d="M31 38c0-15 9-22 19-22s19 7 19 22c-6-6-32-6-38 0z" fill="${c1}"/><path d="M29 38c10-5 32-5 42 0l6 3c-16-4-38-4-54 0z" fill="${c1}"/><circle cx="50" cy="26" r="5" fill="${c2}"/></svg>`)}`;
}
export function faceUrl(p) {
  const t = p.tid >= 0 && S.L ? T(S.L, p.tid) : null;
  if (p.real) return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${p.id}/headshot/67/current`;
  return avatarSvg(p, t?.c1, t?.c2 === '#27251F' ? '#fff' : t?.c2);
}
export function face(p, size = 34) {
  const fb = avatarSvg(p).replace(/'/g, '%27');
  return `<img class="face" loading="lazy" width="${size}" height="${size}" style="width:${size}px;height:${size}px" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${fb}'">`;
}
export function logo(tid, size = 24) {
  const t = S.L ? T(S.L, tid) : S.data.teams.find(x => x.id === tid);
  if (!t) return '';
  return `<span class="tlogo" style="width:${size}px;height:${size}px" title="${esc(t.name)}"><img width="${size}" height="${size}" style="width:${size}px;height:${size}px;max-width:100%;object-fit:contain" src="https://www.mlbstatic.com/team-logos/${t.id}.svg" alt="${esc(t.abbr)}" onerror="this.outerHTML='<span class=&quot;abbr&quot; style=&quot;background:${t.c1};font-size:${Math.max(9, size * 0.36)}px&quot;>${t.abbr}</span>'"></span>`;
}
export const ovrCls = n => n >= 88 ? 's' : n >= 80 ? 'a' : n >= 73 ? 'b' : n >= 66 ? 'c' : n >= 58 ? 'd' : 'f';
export const ovr = n => `<span class="ovr ${ovrCls(n)}">${Math.round(n)}</span>`;
export function plink(p, { photo = true, sub = '', size = 30 } = {}) {
  return `<span class="pl" data-act="player" data-id="${p.id}">${photo ? face(p, size) : ''}<span class="nm">${esc(pname(p))}${sub ? ` <small>${sub}</small>` : ''}</span></span>`;
}
export function status(p) {
  let s = '';
  if (p.il) s += `<span class="tag il">IL-${p.il}</span> `;
  if (p.inj && p.inj.days > 0) s += `<span class="tag inj" title="${esc(p.inj.name)}">${p.inj.days}d</span> `;
  if (p.rk && p.lvl === 'MLB') s += '<span class="tag rk">R</span> ';
  return s;
}

// Development trait, franchise-mode style: how high his ceiling is.
export function trait(p) {
  const v = Math.max(p.ovr, shownPot(p));
  return v >= 92 ? { k: 'x', label: 'X-Factor' } : v >= 85 ? { k: 'ss', label: 'Superstar' } : v >= 78 ? { k: 'st', label: 'Star' } : { k: 'n', label: 'Normal' };
}
export const traitTag = p => { const t = trait(p); return t.k === 'n' ? '' : `<span class="trait t-${t.k}">${t.label}</span>`; };

// A bright, saturated version of the club's own hue, so navy and black clubs still glow.
export function accentOf(t) {
  const hsl = hex => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; const l = (mx + mn) / 2; return [(h * 60 + 360) % 360, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l]; };
  for (const c of [t.c1, t.c2]) { const [h, s, l] = hsl(c); if (s > 0.3 && l > 0.08 && l < 0.92) return `hsl(${Math.round(h)} ${Math.round(Math.max(72, s * 100))}% 60%)`; }
  return '#ffc93c';
}

// ---------- menu sounds (synthesised, no files) ----------
let actx = null;
export const muted = () => { try { return localStorage.getItem('bc-mute') === '1'; } catch { return false; } };
export const setMuted = m => { try { localStorage.setItem('bc-mute', m ? '1' : '0'); } catch { } };
const SFX = {
  tick: [[660, 0, 0.045, 'triangle', 0.05]], tab: [[420, 0, 0.05, 'square', 0.035], [630, 0.045, 0.06, 'square', 0.035]],
  ok: [[523, 0, 0.08, 'triangle', 0.07], [784, 0.07, 0.14, 'triangle', 0.07]], bad: [[196, 0, 0.16, 'sawtooth', 0.05], [147, 0.1, 0.2, 'sawtooth', 0.05]],
  go: [[330, 0, 0.09, 'square', 0.05], [494, 0.08, 0.09, 'square', 0.05], [659, 0.16, 0.22, 'square', 0.06]], open: [[880, 0, 0.05, 'sine', 0.05], [1175, 0.04, 0.09, 'sine', 0.045]],
  intro: [[98, 0, 1.4, 'triangle', 0.09], [196, 0.02, 1.2, 'triangle', 0.05], [247, 0.12, 1.1, 'triangle', 0.045], [294, 0.22, 1.0, 'triangle', 0.045], [392, 0.42, 0.5, 'square', 0.035], [523, 0.58, 0.9, 'square', 0.04], [784, 0.74, 0.7, 'triangle', 0.035]],
  swipe: [[300, 0, 0.06, 'triangle', 0.04], [450, 0.03, 0.07, 'triangle', 0.035]],
};
export function sfx(name) {
  if (muted() || typeof AudioContext === 'undefined') return;
  try {
    actx ??= new AudioContext(); if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime;
    for (const [f, at, dur, type, vol] of SFX[name] || SFX.tick) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t0 + at); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(actx.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
    }
  } catch { }
}

// ---------- toast and modal ----------
let toastT;
export function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast' + (err ? ' err' : ''); el.hidden = false; sfx(err ? 'bad' : 'ok');
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, err ? 5200 : 3200);
}
export const say = r => { toast(r.msg, !r.ok); return r.ok; };
export function modal(html, narrow = false) {
  const el = document.getElementById('modal');
  el.innerHTML = `<div class="sheet${narrow ? ' narrow' : ''}" style="position:relative">${html}<button class="x" data-act="close" aria-label="Close">×</button></div>`;
  el.hidden = false; sfx('open');
}
export function closeModal() { const el = document.getElementById('modal'); el.hidden = true; el.innerHTML = ''; }
export function confirmBox(title, text, yes, fn) {
  modal(`<div class="body"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row"><button class="btn pri" data-act="confirm-yes">${esc(yes)}</button><button class="btn" data-act="close">Cancel</button></div></div>`, true);
  actions['confirm-yes'] = () => { closeModal(); fn(); };
}

// ---------- saving (IndexedDB, with a download as backup) ----------
const DB = 'ballclub', STORE = 'saves';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function saveNow() {
  if (!S.L) return;
  try {
    const d = await db();
    await new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(JSON.stringify(S.L), 'career'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { console.warn('save failed', e); toast('Could not save in this browser. Use Settings → Download save.', true); }
}
let saveT;
export function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 700); }
export async function loadSaved() {
  try {
    const d = await db();
    const txt = await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get('career'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return txt ? index(JSON.parse(txt)) : null;
  } catch { return null; }
}
export async function wipeSaved() { const d = await db(); await new Promise(res => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete('career'); tx.oncomplete = res; }); }

// ---------- rendering ----------
let renderShell = () => {};
export const setShell = fn => { renderShell = fn; };
export function render() { renderShell(); }
export function go(view, arg = null) { S.view = view; S.arg = arg; render(); window.scrollTo(0, 0); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (e.target.id === 'modal') closeModal(); return; }
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); const a = el.dataset.act; if (a === 'adv' || a === 'play' || a === 'sim') sfx('go'); else if (a === 'go') sfx('tab'); else if (a !== 'sort' && a !== 'close') sfx('tick'); fn(el, e); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (el && actions[el.dataset.chg]) actions[el.dataset.chg](el, e);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
on('close', closeModal);
on('go', el => go(el.dataset.v, el.dataset.arg || null));

// sortable tables: th[data-sort=key]; view keeps its own sort state through S.sort
export const sorts = {};
export function sortBy(key, list, getters, def, dir = -1) {
  const st = sorts[key] ??= { k: def, d: dir };
  const g = getters[st.k] || getters[def];
  return [...list].sort((a, b) => { const x = g(a), y = g(b); return (x > y ? 1 : x < y ? -1 : 0) * st.d; });
}
on('sort', el => {
  const st = sorts[el.dataset.t] ??= { k: el.dataset.sort, d: -1 };
  if (st.k === el.dataset.sort) st.d *= -1; else { st.k = el.dataset.sort; st.d = el.dataset.asc ? 1 : -1; }
  render();
});
export const th = (t, key, label, cls = '', asc = false) => `<th class="${cls}${sorts[t]?.k === key ? ' srt' : ''}" data-act="sort" data-t="${t}" data-sort="${key}"${asc ? ' data-asc="1"' : ''}>${label}</th>`;
export { P, T };
