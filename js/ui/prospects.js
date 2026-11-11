// Prospects: your farm system as cards, and the league's top 100.
import { S, views, on, esc, faceUrl, avatarSvg, logo, ovr, pname, trait, render } from './core.js';
import { T } from '../engine/league.js';
import { prospectList, farmRanks, potText, fogW, devFactor, devLabel } from '../engine/season.js';
import { ord } from './core.js';

let tab = 'mine';
const LV = { AAA: 'Triple-A', LOW: 'Double-A' };

function card(L, p, rank) {
  const f = devFactor(L, p), pts = L.scout?.pts ?? 0;
  return `<div class="tcard pro t-${trait(p).k}"><span class="sc-ovr"><b>${Math.round(p.ovr)}</b><i>${p.pos}</i></span>
    ${rank ? `<span class="pro-rk" title="League prospect rank">#${rank}</span>` : ''}
    <img class="sc-face" loading="lazy" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">
    <span class="sc-name" data-act="player" data-id="${p.id}"><small>${esc(p.first)} · ${p.age} · ${LV[p.lvl] || p.lvl}</small>${esc(p.last)}</span>
    <span class="pro-pot">Ceiling <b>${potText(p)}</b></span>
    <span class="sc-line">Growth: <span class="${f >= 0.95 ? 'good' : f < 0.7 ? 'bad' : ''}">${p.age >= 29 || p.ovr >= p.pot ? 'Finished' : devLabel(f)}</span>${p.ovr - p.d0 >= 1 ? ` · <span class="good">+${Math.round(p.ovr - p.d0)} this year</span>` : ''}</span>
    ${fogW(p) >= 0.5 && pts > 0 ? `<span class="dr-btns"><button class="btn sm" data-act="scout" data-id="${p.id}">Scout</button></span>` : ''}</div>`;
}

views.prospects = () => {
  const L = S.L, me = L.userTid;
  const list = prospectList(L), rankOf = new Map(list.slice(0, 100).map((x, i) => [x.p.id, i + 1]));
  const fr = farmRanks(L).get(me) || 30;
  const mine = list.filter(x => x.p.tid === me).slice(0, 12);
  const inTop = mine.filter(x => rankOf.has(x.p.id)).length;
  const seg = `<span class="seg">${[['mine', 'My system'], ['top', 'Top 100']].map(([k, lab]) => `<button class="${tab === k ? 'on' : ''}" data-act="pro-tab" data-k="${k}">${lab}</button>`).join('')}</span>`;
  const head = `<div class="head"><div><h1>Prospects</h1><p>Ceilings are your scouts' range. It narrows as a kid plays, as he grows up, and when you send scouts (${L.scout?.pts ?? 0} trips left this year).</p></div><span class="sp"></span>${seg}</div>`;
  if (tab === 'top') {
    return `${head}<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>#</th><th class="l">Player</th><th class="l">Club</th><th>Age</th><th class="l">Level</th><th>OVR</th><th>Ceiling</th></tr></thead><tbody>
      ${list.slice(0, 100).map((x, i) => `<tr class="${x.p.tid === me ? 'me' : ''}"><td><b>${i + 1}</b></td><td class="l"><span class="pl" data-act="player" data-id="${x.p.id}"><span class="nm">${esc(pname(x.p))}</span> <small>${x.p.pos}</small></span></td><td class="l">${logo(x.p.tid, 20)} ${T(L, x.p.tid).abbr}</td><td>${x.p.age}</td><td class="l">${LV[x.p.lvl] || x.p.lvl}</td><td>${ovr(x.p.ovr)}</td><td class="pot">${potText(x.p)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  return `${head}
  <section class="tile farm"><div class="farm-rk"><b>${fr}<small>${ord(fr).replace(/^\d+/, '')}</small></b><span>farm system<br>of 30</span></div>
    <div class="farm-txt"><b>${inTop ? `${inTop} of the league's top 100` : 'Nobody in the top 100'}</b><span>${mine[0] ? `Best: ${esc(pname(mine[0].p))}, ${mine[0].p.pos}, ceiling ${potText(mine[0].p)}.` : 'Your system is empty. The draft is at the All-Star break.'}</span></div></section>
  ${mine.length ? `<div class="pros">${mine.map(x => card(L, x.p, rankOf.get(x.p.id))).join('')}</div>` : '<div class="empty">No prospects yet.</div>'}`;
};
on('pro-tab', el => { tab = el.dataset.k; render(); });
