// Legacy: the GM's résumé, trophy case, achievements, the Hall of Fame and club records.
import { S, views, on, esc, logo, faceUrl, avatarSvg, render, T, P } from './core.js';
import { ensureState, ACH, legacyScore, gmRank, REC_LIST, fmtRec } from '../engine/legacy.js';

let tab = 'career';
const cup = (gold = true) => `<svg viewBox="0 0 60 70" class="cup"><path d="M14 6h32v14c0 12-7 20-16 20S14 32 14 20z" fill="${gold ? 'url(#gold)' : 'url(#silver)'}"/><path d="M14 10H5c0 10 5 16 11 17M46 10h9c0 10-5 16-11 17" fill="none" stroke="${gold ? '#e0a400' : '#aab6ca'}" stroke-width="3"/><rect x="26" y="40" width="8" height="12" fill="${gold ? '#e0a400' : '#8894a8'}"/><rect x="16" y="52" width="28" height="9" rx="2" fill="${gold ? '#7a5600' : '#3a4558'}"/></svg>`;
const flag = () => `<svg viewBox="0 0 60 70" class="cup"><rect x="8" y="4" width="3" height="62" fill="#aab6ca"/><path d="M11 6 L56 20 L11 34Z" fill="url(#silver)"/></svg>`;
const DEFS = `<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="gold" x1="0" x2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#ffc93c"/><stop offset="1" stop-color="#e09a00"/></linearGradient><linearGradient id="silver" x1="0" x2="1"><stop offset="0" stop-color="#f4f6fa"/><stop offset="1" stop-color="#8894a8"/></linearGradient></defs></svg>`;
const plaque = (L, h, extra = '') => `<div class="plaque"><img src="${faceUrl({ ...h, id: h.pid, tid: -3 })}" alt="" onerror="this.onerror=null;this.src='${avatarSvg({ ...h, id: h.pid }).replace(/'/g, '%27')}'">
  <b>${esc(h.first)} ${esc(h.last)}</b><span>${h.pos} · ${h.war} WAR${h.awards.length ? ` · ${h.awards.length} award${h.awards.length > 1 ? 's' : ''}` : ''}</span>${extra}<span class="muted">${T(L, h.tid) ? `${T(L, h.tid).abbr} · ` : ''}${h.mine ? 'played for you' : ''}</span></div>`;

views.legacy = () => {
  const L = ensureState(S.L), g = L.gmc;
  const score = legacyScore(L), rank = gmRank(score);
  const W = g.seasons.reduce((s, x) => s + x.w, 0), Lo = g.seasons.reduce((s, x) => s + x.l, 0);
  const titles = g.seasons.filter(x => x.champ), pennants = g.seasons.filter(x => x.po >= 4 && !x.champ), po = g.seasons.filter(x => x.po).length;
  const got = ACH.filter(a => g.ach[a.id]).length;
  const prog = rank.next ? Math.round((score - rank.from) / (rank.next.at - rank.from) * 100) : 100;
  const seg = `<span class="seg">${[['career', 'Career'], ['ach', `Achievements ${got}/${ACH.length}`], ['hof', 'Hall of Fame'], ['rec', 'Club records']].map(([k, lab]) => `<button class="${tab === k ? 'on' : ''}" data-act="lg-tab" data-k="${k}">${lab}</button>`).join('')}</span>`;
  const banner = `<section class="tile gm">${DEFS}<div class="gm-id"><small>General manager</small><b>${esc(L.gm)}</b><em>${rank.title}</em>
      <div class="gm-prog"><div class="bar"><i style="width:${prog}%"></i></div><span>${rank.next ? `${rank.next.at - score} points to ${rank.next.title}` : 'The top of the profession'}</span></div></div>
    <div class="gm-pts"><b>${score}</b><span>legacy points</span></div>
    <div class="gm-stats"><span><b>${g.seasons.length}</b>seasons</span><span><b>${W}-${Lo}</b>record</span><span><b>${po}</b>playoffs</span><span><b>${pennants.length + titles.length}</b>pennants</span><span><b>${titles.length}</b>titles</span></div></section>`;
  let body = '';
  if (tab === 'career') {
    const case_ = [...titles.map(x => [x, true]), ...pennants.map(x => [x, false])].sort((a, b) => a[0].y - b[0].y);
    body = `<div class="panel" style="margin-bottom:16px"><h3>Trophy case</h3>${case_.length ? `<div class="case">${case_.map(([x, gold]) => `<div class="trophy">${gold ? cup() : flag()}<b>${x.y}</b><span>${gold ? 'World Series' : 'Pennant'} · ${x.abbr}</span></div>`).join('')}</div>` : '<div class="empty">Empty for now. Pennants and World Series trophies go here.</div>'}</div>
    <div class="panel"><h3>Seasons</h3>${g.seasons.length ? `<div class="scroll"><table class="t"><thead><tr><th class="l">Year</th><th class="l">Club</th><th>Record</th><th class="l">Finish</th><th>Payroll</th></tr></thead><tbody>${g.seasons.slice().reverse().map(x => `<tr><td class="l"><b>${x.y}</b></td><td class="l">${logo(x.tid, 20)} ${x.abbr}</td><td>${x.w}-${x.l}</td><td class="l">${x.champ ? '<b class="good">World Series champions</b>' : x.po >= 4 ? 'Lost the World Series' : x.po >= 3 ? 'Lost the LCS' : x.po >= 2 ? 'Lost the Division Series' : x.po ? 'Lost in the first round' : x.w > x.l ? 'Missed the playoffs' : '<span class="muted">Losing season</span>'}</td><td>$${x.pay}M</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Your first season is still being written.</div>'}${g.fired ? `<p class="muted" style="padding:0 16px 12px">Fired ${g.fired} time${g.fired > 1 ? 's' : ''}. ${g.jobs.length} job${g.jobs.length > 1 ? 's' : ''} in all.</p>` : ''}</div>`;
  } else if (tab === 'ach') {
    body = `<div class="achs">${ACH.map(a => { const u = g.ach[a.id]; return `<div class="ach${u ? ' on' : ''}"><i>${u ? '★' : '☆'}</i><b>${esc(a.title)}</b><span>${esc(a.desc)}</span><em>${u ? `${u.y} · ${T(L, u.tid)?.abbr || ''} · ` : ''}+${a.pts}</em></div>`; }).join('')}</div>`;
  } else if (tab === 'hof') {
    const v = L.lastVote;
    body = `${v?.rows?.length ? `<div class="panel" style="margin-bottom:16px"><h3>${v.y} ballot <small>75% gets in · under 5% falls off · ten years at most</small></h3><div class="ballot">${v.rows.slice(0, 12).map(r => `<div class="vote${r.in ? ' in' : ''}"><span class="pl" data-act="${P(L, r.s.pid) ? 'player' : ''}" data-id="${r.s.pid}"><b class="nm">${esc(r.s.first)} ${esc(r.s.last)}</b> <small>${r.s.pos} · ${r.s.war} WAR · year ${r.yrs}</small></span><div class="vbar"><i style="width:${r.pct}%"></i><em></em></div><b>${r.pct}%</b></div>`).join('')}</div></div>` : ''}
    <div class="panel"><h3>Inducted <small>${L.hof.length}</small></h3>${L.hof.length ? `<div class="plaques">${L.hof.slice().reverse().map(h => plaque(L, h, `<span>Class of ${h.ind} · ${h.pct}%</span>`)).join('')}</div>` : `<div class="empty">Nobody yet. Retired stars join the ballot the winter after they retire.${L.ballot.length ? ` ${L.ballot.length} on the next ballot.` : ''}</div>`}</div>`;
  } else {
    const t = T(L, L.userTid), r = t.recs || {};
    body = `<div class="panel"><h3>${logo(t.id, 22)} ${esc(t.name)} single-season records <small>since ${L.gmc.start}</small></h3>${Object.keys(r).length ? `<div class="recs">${[...REC_LIST, { k: 'tW', label: 'Wins in a season', fmt: 0 }].filter(x => r[x.k]).map(x => `<div class="rec"><span>${x.label}</span><b>${x.k === 'tW' ? r.tW.nm : fmtRec(x.fmt, r[x.k].v)}</b><em>${x.k === 'tW' ? r.tW.y : `${esc(r[x.k].nm)}, ${r[x.k].y}`}</em></div>`).join('')}</div>` : '<div class="empty">Records are set at the end of each season.</div>'}</div>`;
  }
  return `<div class="head"><div><h1>Legacy</h1><p>What you have built, and what people will remember.</p></div><span class="sp"></span>${seg}</div>${banner}${body}`;
};
on('lg-tab', el => { tab = el.dataset.k; render(); });
