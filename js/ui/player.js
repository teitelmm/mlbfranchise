// The player card (opens from any player name).
import { S, on, esc, faceUrl, avatarSvg, logo, ovr, money, pname, modal, closeModal, toast, say, render, go, save, trait } from './core.js';
import { P, T, healthy, payroll } from '../engine/league.js';
import { shownPot, devFactor, devLabel, extensionAsk, offerExtension, offerFA, onClock, contested, bidState, potText, potRange, fogW, userCommitted } from '../engine/season.js';
import { pickAndReveal } from './office.js';
import { controlYears } from '../engine/trade.js';
import { bat, pit, f3, ip, batWAR, pitWAR } from '../engine/stats.js';
import { grade } from '../engine/ratings.js';

const PITCH = { FF: 'Four-seam fastball', SI: 'Sinker', FC: 'Cutter', SL: 'Slider', CH: 'Changeup', CU: 'Curveball', FS: 'Splitter', KN: 'Knuckleball', ST: 'Sweeper', SV: 'Slurve' };
const rate = (label, v) => `<div class="rate"><span>${label}</span><b>${Math.round(v)}</b><div class="bar"><i style="width:${Math.max(4, (v - 20) / 79 * 100)}%;background:${v >= 75 ? '#0d6e3f' : v >= 60 ? '#5b8f3a' : v >= 45 ? '#a07f1f' : '#a85f2a'}"></i></div></div>`;

function batRow(h) { const d = bat(h); return `<tr><td class="l">${h.y}</td><td class="l">${h.tm || ''} ${h.lv !== 'MLB' ? `<span class="tag">${h.lv}</span>` : ''}</td><td>${h.G || 0}</td><td>${h.PA || 0}</td><td>${f3(d.avg)}</td><td>${f3(d.obp)}</td><td>${f3(d.slg)}</td><td>${h.HR || 0}</td><td>${h.RBI || 0}</td><td>${h.R || 0}</td><td>${h.SB || 0}</td><td>${h.BB || 0}</td><td>${h.K || 0}</td></tr>`; }
function pitRow(h) { const d = pit(h); return `<tr><td class="l">${h.y}</td><td class="l">${h.tm || ''} ${h.lv !== 'MLB' ? `<span class="tag">${h.lv}</span>` : ''}</td><td>${h.G || 0}</td><td>${h.GS || 0}</td><td>${h.W || 0}-${h.L || 0}</td><td>${h.SV || 0}</td><td>${ip(h.O || 0)}</td><td>${d.era.toFixed(2)}</td><td>${d.whip.toFixed(2)}</td><td>${h.K || 0}</td><td>${h.BB || 0}</td><td>${h.HR || 0}</td></tr>`; }
const BH = '<thead><tr><th class="l">Year</th><th class="l">Club</th><th>G</th><th>PA</th><th>AVG</th><th>OBP</th><th>SLG</th><th>HR</th><th>RBI</th><th>R</th><th>SB</th><th>BB</th><th>K</th></tr></thead>';
const PH = '<thead><tr><th class="l">Year</th><th class="l">Club</th><th>G</th><th>GS</th><th>W-L</th><th>SV</th><th>IP</th><th>ERA</th><th>WHIP</th><th>K</th><th>BB</th><th>HR</th></tr></thead>';

export function playerCard(id) {
  const l = S.L, p = P(l, id);
  if (!p) return;
  const t = p.tid >= 0 ? T(l, p.tid) : null;
  const mine = p.tid === l.userTid;
  const c1 = t?.c1 || '#17402f';
  const where = p.tid === -1 ? 'Free agent' : p.tid === -2 ? 'Draft prospect' : `${t.name}${p.lvl === 'AAA' ? ' (Triple-A)' : p.lvl === 'LOW' ? ' (Double-A)' : ''}`;
  const cur = [];
  const y = l.season, tm = t?.abbr || '';
  const hitter = !p.isP || p.twoWay;
  if (hitter && p.st.b.PA) cur.push(['b', { y, lv: 'MLB', tm, ...p.st.b }]);
  if (hitter && p.sm?.b?.PA) cur.push(['b', { y, lv: 'AAA', tm, ...p.sm.b }]);
  if (p.isP && p.st.p?.BF) cur.push(['p', { y, lv: 'MLB', tm, ...p.st.p }]);
  if (p.isP && p.sm?.p?.BF) cur.push(['p', { y, lv: 'AAA', tm, ...p.sm.p }]);
  const bh = (p.isP ? (p.histB || []) : p.hist).slice().reverse(), ph = p.isP ? p.hist.slice().reverse() : [];
  const f = devFactor(l, p);
  const ctl = p.tid >= 0 ? controlYears(l, p) : 0;
  const conTxt = p.tid === -1 ? `Asking about ${money(p.ask.aav)} a year for ${p.ask.yrs} year${p.ask.yrs > 1 ? 's' : ''}` : p.tid === -2 ? 'Unsigned amateur'
    : !p.on40 ? 'Minor-league contract' : p.svc < 6 && p.con.exp <= l.season ? `${money(p.con.sal)} this year. ${p.svc < 3 ? 'Pre-arbitration' : 'Arbitration-eligible'}; under club control for ${ctl} more season${ctl > 1 ? 's' : ''}` : `${money(p.con.sal)} a year through ${p.con.exp}${p.con.next ? `, then ${money(p.con.next.sal)} through ${p.con.next.exp}` : ''}`;
  const b = (act, label, cls = '') => `<button class="btn ${cls}" data-act="${act}" data-id="${p.id}">${label}</button>`;
  let acts = '';
  if (mine) {
    if (p.il) acts += healthy(p) ? b('activate', 'Activate from IL', 'pri') : '';
    else if (p.lvl === 'MLB') acts += (healthy(p) ? '' : b('il', 'Place on injured list', 'pri')) + b('send-down', 'Send to Triple-A');
    else acts += (healthy(p) ? b('call-up', 'Call up to the majors', 'acc') : '') + (!p.on40 ? b('add40', 'Add to 40-man') : b('rem40', 'Remove from 40-man'));
    if (p.on40 && !p.con.next && (p.con.exp <= l.season + 1)) acts += b('extend', 'Offer an extension');
    acts += b('trade-add', 'Put in a trade') + b('release', 'Release');
  } else if (p.tid >= 0) acts += b('trade-for', 'Trade for him', 'pri');
  else if (p.tid === -1) acts += b('fa-offer', 'Make an offer', 'pri');
  else if (p.tid === -2 && onClock(l) === l.userTid) acts += b('draft-pick', 'Draft him', 'pri');
  if (fogW(p) >= 0.5 && (l.scout?.pts ?? 0) > 0) acts += b('scout', `Send scouts (${l.scout.pts} left)`);
  modal(`
    <div class="pcard" style="background-color:${c1}">
      <img class="face" src="${faceUrl(p)}" alt="" onerror="this.onerror=null;this.src='${avatarSvg(p).replace(/'/g, '%27')}'">
      <div><h2>${esc(pname(p))} ${p.num ? `<span style="opacity:.7">#${esc(p.num)}</span>` : ''}</h2>
        <div class="meta">${p.isP ? (p.role === 'SP' ? 'Starting pitcher' : 'Relief pitcher') + (p.twoWay ? ' and DH' : '') : (p.elig || [p.pos]).join(' / ')} · ${esc(where)}</div>
        <div class="meta">Age ${p.age} · Bats ${p.bats}, throws ${p.throws}${p.ht ? ` · ${esc(p.ht)}, ${p.wt} lb` : ''}${p.country ? ` · ${esc(p.country)}` : ''}</div>
        <div class="meta">${p.draft?.pk ? `Drafted ${p.draft.y}, pick ${p.draft.pk}. ` : p.intl ? 'International signing. ' : ''}${p.awards?.length ? esc(p.awards.join(', ')) : ''}${p.inj && p.inj.days > 0 ? `<b> Injured: ${esc(p.inj.name)}, ${p.inj.days} days.</b>` : ''}</div>
      </div>
      <div class="big-ovr"><b>${Math.round(p.ovr)}</b><span>overall · potential ${potText(p)}</span>${potRange(p) ? '<span style="opacity:.75">scouts\' range</span>' : ''}<span class="trait t-${trait(p).k}" style="display:inline-block;margin-top:6px">${trait(p).label} dev</span></div>
    </div>
    <div class="body">
      <div class="row wrap" style="margin-bottom:14px">${acts}</div>
      <div class="grid g3" style="margin-bottom:16px">
        ${hitter ? `<div><h3>Hitting</h3>${rate('Contact', p.bat.con)}${rate('Power', p.bat.pow)}${rate('Eye', p.bat.eye)}${rate('Hit tool', p.bat.hit)}${rate('Speed', p.bat.spd)}</div>` : ''}
        ${!p.isP ? `<div><h3>Fielding</h3>${rate('Glove', p.bat.def)}${rate('Arm', p.bat.arm)}<p class="muted" style="margin:8px 0 0">Plays ${(p.elig || [p.pos]).join(', ')}. Anywhere else he loses range.</p></div>` : ''}
        ${p.isP ? `<div><h3>Pitching</h3>${rate('Stuff', p.pit.stf)}${rate('Control', p.pit.ctl)}${rate('Movement', p.pit.mov)}${rate('Stamina', p.pit.sta)}</div>
        <div><h3>Pitches</h3><table class="t"><tbody>${p.pit.mix.map(m => `<tr><td class="l">${PITCH[m[0]] || m[0]}</td><td>${m[1]}%</td><td><b>${m[2].toFixed(1)}</b> mph</td></tr>`).join('')}</tbody></table><p class="muted" style="margin:6px 0 0">Ground balls: ${p.pit.gb}%</p></div>` : ''}
        <div><h3>Contract</h3><p style="margin:6px 0">${conTxt}.</p>
          <p class="muted" style="margin:6px 0">Service time ${p.svc.toFixed(1)} years${p.on40 ? ` · minor-league options left: ${p.opt}` : ''}.</p>
          ${p.tid >= 0 && p.age <= 28 && p.ovr < p.pot ? `<p style="margin:6px 0">Development right now: <span class="tag ${f >= 0.95 ? 'hot' : f < 0.7 ? 'inj' : ''}">${devLabel(f)}</span> <span class="${p.ovr - p.d0 >= 0 ? 'good' : 'bad'}">${p.ovr - p.d0 >= 0 ? '+' : ''}${Math.round(p.ovr - p.d0)} this year</span></p><p class="muted" style="margin:0">${p.lvl === 'MLB' ? 'Improves fastest when he plays every day. If he is sitting on your bench, Triple-A may suit him better.' : p.lvl === 'AAA' ? 'Regular Triple-A at-bats and innings speed him up.' : 'The lower minors help until about 63 overall.'}</p>` : ''}</div>
      </div>
      ${cur.length || bh.length || ph.length ? '' : '<p class="muted">No professional stats yet.</p>'}
      ${cur.some(c => c[0] === 'b') || bh.length ? `<h3>Batting</h3><div class="scroll" style="margin-bottom:14px"><table class="t">${BH}<tbody>${cur.filter(c => c[0] === 'b').map(c => batRow(c[1])).join('')}${bh.map(batRow).join('')}</tbody></table></div>` : ''}
      ${cur.some(c => c[0] === 'p') || ph.length ? `<h3>Pitching</h3><div class="scroll"><table class="t">${PH}<tbody>${cur.filter(c => c[0] === 'p').map(c => pitRow(c[1])).join('')}${ph.map(pitRow).join('')}</tbody></table></div>` : ''}
    </div>`);
}
on('player', el => playerCard(+el.dataset.id));

// ---------- contract offers ----------
function offerForm(p, ask, title, blurb, act, extra = '') {
  modal(`<div class="body"><h2>${esc(title)}</h2><p>${blurb}</p>${extra}
    <div class="row wrap" style="margin:14px 0"><label>Per year ($M)<br><input id="of-aav" type="number" step="0.1" min="0.8" value="${ask.aav.toFixed(1)}" style="width:110px"></label><label>Years<br><input id="of-yrs" type="number" min="1" max="10" value="${ask.yrs}" style="width:80px"></label></div>
    <div class="row"><button class="btn pri" data-act="${act}" data-id="${p.id}">Make the offer</button><button class="btn" data-act="close">Cancel</button></div></div>`, true);
}
on('fa-offer', el => {
  const L = S.L, p = P(L, +el.dataset.id);
  if (!p || p.tid !== -1) return toast('He is no longer a free agent.', true);
  const ask = `His agent is asking about <b>${money(p.ask.aav)}</b> a year for <b>${p.ask.yrs}</b> year${p.ask.yrs > 1 ? 's' : ''}.`;
  if (!contested(L, p)) return offerForm(p, p.ask, `Offer ${pname(p)} a contract`, `${p.age} years old, ${Math.round(p.ovr)} overall. ${ask} Older players like extra years; nobody likes a pay cut.`, 'fa-send');
  // an auction: show the competition and start the form a step above the best offer
  const b = bidState(L, p), lead = b?.lead, mine = b?.mine;
  const start = { aav: lead && !b.leading ? Math.round(lead.aav * 1.05 * 10) / 10 : mine ? mine.aav : p.ask.aav, yrs: mine?.yrs || lead?.yrs || p.ask.yrs };
  const t = T(L, L.userTid), room = t.budget - payroll(L, t.id) - userCommitted(L, p.id);
  const comp = !b ? 'Nobody has made an offer yet. Bid and other clubs will hear about it.'
    : b.leading ? `You have the best offer (${money(mine.aav)} × ${mine.yrs}). ${b.n - 1} other club${b.n === 2 ? '' : 's'} in.`
      : `Best offer: <b>the ${esc(T(L, lead.tid).name)}, ${money(lead.aav)} × ${lead.yrs}</b>.${mine ? ` Yours: ${money(mine.aav)} × ${mine.yrs}.` : ''}`;
  offerForm(p, start, `${mine ? 'Raise your offer for' : 'Bid for'} ${pname(p)}`, `${p.age} years old, ${Math.round(p.ovr)} overall. ${ask}`, 'fa-send',
    `<div class="auc"><b>Bidding war</b><span>${comp}</span><span>${b ? `He decides in <b>${b.days} day${b.days === 1 ? '' : 's'}</b>.` : 'He decides a few days after the first offer.'} Money counts most; extra years, a winning club and a big market help.</span><span>Budget room for this offer: <b class="${room <= 0 ? 'bad' : ''}">${money(Math.max(0, room))}</b></span></div>`);
});
on('fa-send', el => { const r = offerFA(S.L, +el.dataset.id, +document.getElementById('of-aav').value, +document.getElementById('of-yrs').value); toast(r.msg, !r.ok); if (r.ok) { closeModal(); save(); render(); } });
on('extend', el => { const p = P(S.L, +el.dataset.id), a = extensionAsk(S.L, p); offerForm(p, a, `Extend ${pname(p)}`, `He would sign for about <b>${money(a.aav)}</b> a year over <b>${a.yrs}</b> year${a.yrs > 1 ? 's' : ''}, starting next season. Players still under club control give a discount for security.`, 'ext-send'); });
on('ext-send', el => { const r = offerExtension(S.L, +el.dataset.id, +document.getElementById('of-aav').value, +document.getElementById('of-yrs').value); toast(r.msg, !r.ok); if (r.ok) { closeModal(); save(); render(); } });
on('draft-pick', el => { closeModal(); pickAndReveal(+el.dataset.id); });
