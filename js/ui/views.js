// Clubhouse and league pages.
import { S, views, on, esc, face, logo, plink, ovr, status, money, pname, toast, say, render, go, save, confirmBox, closeModal, sortBy, th, sorts, ord, traitTag } from './core.js';
import { P, T, active, forty, org, payroll, healthy, standings, playoffField, userGameToday, todaysGames, probableSP, autoLineup, autoPitching, rosterProblems, teamStrength, isHitter, ACTIVE_MAX, FORTY_MAX } from '../engine/league.js';
import { callUp, sendDown, setLevel, add40, remove40, releasePlayer, placeIL, activateIL, refreshUser, devFactor, devLabel, shownPot, potText, liveSeries, ROUND_NAME, luxuryTax } from '../engine/season.js';
import { bat, pit, f3, ip, war, batWAR, pitWAR } from '../engine/stats.js';
import { defAt, POS_DIFF } from '../engine/ratings.js';
import { fmtDate, dateOf } from '../engine/schedule.js';
import { acceptOffer } from '../engine/trade.js';

const L = () => S.L;
const me = () => T(S.L, S.L.userTid);
const rec = t => `${t.w}–${t.l}`;
const pct = t => (t.w + t.l) ? t.w / (t.w + t.l) : 0;
const lvlStats = p => p.lvl === 'MLB' || (p.st.b.PA > 0 && p.lvl === 'MLB') ? p.st : p.sm;

export function lineBoard(box, compact = false) {
  const l = S.L, a = T(l, box.a), h = T(l, box.h);
  const n = Math.max(9, box.line[0].length);
  const cells = (arr, isHome) => Array.from({ length: n }, (_, i) => `<td class="inn">${arr[i] ?? (isHome && i === n - 1 && box.score[1] > box.score[0] ? 'x' : arr[i] === 0 ? 0 : '')}</td>`).join('');
  return `<div class="board"><table><thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr></thead><tbody>
    <tr><td class="tm">${logo(a.id, 22)} ${a.abbr}</td>${cells(box.line[0])}<td class="tot">${box.score[0]}</td><td>${box.hits[0]}</td><td>${box.errs[0]}</td></tr>
    <tr><td class="tm">${logo(h.id, 22)} ${h.abbr}</td>${cells(box.line[1], true)}<td class="tot">${box.score[1]}</td><td>${box.hits[1]}</td><td>${box.errs[1]}</td></tr>
  </tbody></table>${compact ? '' : `<div class="cap"><span>${box.W ? `W: ${esc(P(l, box.W)?.last || '')}` : ''}${box.L ? ` &nbsp; L: ${esc(P(l, box.L)?.last || '')}` : ''}${box.SV ? ` &nbsp; SV: ${esc(P(l, box.SV)?.last || '')}` : ''}</span><span>${box.att ? `Attendance ${box.att.toLocaleString()}` : ''}</span></div>`}</div>`;
}
export function boxTables(box) {
  const l = S.L;
  const side = i => {
    const t = T(l, i ? box.h : box.a);
    const bats = box.order[i].map(id => box.bat.find(b => b.id === id)).filter(Boolean);
    const pos = id => box.lu[i].find(x => x[0] === id)?.[1] || 'PH';
    return `<div class="panel"><h3>${logo(t.id, 20)} ${esc(t.name)}</h3><div class="scroll"><table class="t"><thead><tr><th class="l">Batter</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>HR</th></tr></thead><tbody>
      ${bats.map(b => { const p = P(l, b.id); return p ? `<tr><td class="l">${plink(p, { photo: false, sub: pos(b.id) })}</td><td>${b.AB || 0}</td><td>${b.R || 0}</td><td>${b.H || 0}</td><td>${b.RBI || 0}</td><td>${b.BB || 0}</td><td>${b.K || 0}</td><td>${b.HR || ''}</td></tr>` : ''; }).join('')}
      </tbody></table><table class="t"><thead><tr><th class="l">Pitcher</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>NP</th></tr></thead><tbody>
      ${box.pit[i].map(x => { const p = P(l, x.id); return p ? `<tr><td class="l">${plink(p, { photo: false, sub: x.W ? 'W' : x.L ? 'L' : x.SV ? 'SV' : x.HLD ? 'H' : '' })}</td><td>${ip(x.O || 0)}</td><td>${x.H || 0}</td><td>${x.R || 0}</td><td>${x.ER || 0}</td><td>${x.BB || 0}</td><td>${x.K || 0}</td><td>${x.NP || 0}</td></tr>` : ''; }).join('')}
      </tbody></table></div></div>`;
  };
  return `<div class="grid g2">${side(0)}${side(1)}</div>`;
}
const spLine = p => { if (!p) return 'TBD'; const s = p.st.p || {}; return `${esc(pname(p))} <span class="muted">(${s.W || 0}-${s.L || 0}, ${s.O ? pit(s).era.toFixed(2) : '-.--'})</span>`; };

// ---------- home ----------
views.home = () => {
  const l = L(), t = me();
  const probs = rosterProblems(l);
  const g = l.phase === 'regular' ? userGameToday(l) : null;
  let hero = '';
  if (g) {
    const h = T(l, g.h), a = T(l, g.a), hs = probableSP(l, h), as = probableSP(l, a);
    hero = `<div class="board" style="margin-bottom:16px"><div class="cap"><span>Today at ${esc(h.park.name)}</span><span>Game ${t.w + t.l + 1} of ${l.games}</span></div>
      <div class="next"><div class="side">${logo(a.id, 64)}<div><b>${esc(a.name)}</b><span>${rec(a)}</span></div></div><div class="vs">AT</div><div class="side r">${logo(h.id, 64)}<div><b>${esc(h.name)}</b><span>${rec(h)}</span></div></div></div>
      <div class="sp-line"><div class="grow">${as ? face(as, 38) : ''}<span>${spLine(as)}</span></div><div class="grow r">${hs ? face(hs, 38) : ''}<span>${spLine(hs)}</span></div></div></div>`;
  } else if (l.phase === 'playoffs') {
    hero = `<div class="note"><b>October baseball.</b> ${t.po ? 'Your series is on the Playoffs page.' : 'Your season is over. Sim through the playoffs to reach the offseason.'}</div>`;
  } else if (l.phase === 'offseason') {
    hero = `<div class="note"><b>Offseason.</b> ${l.off.stage === 'resign' ? 'Re-sign your out-of-contract players on the Contracts page, then open free agency.' : 'Free agency is open. Sign players on the Free agents page; trades are open too.'}</div>`;
  }
  const last = l.lastBox;
  const div = standings(l)[`${t.lg} ${t.div}`];
  const hit = active(l, t.id).filter(p => !p.isP || p.twoWay), pt = active(l, t.id).filter(p => p.isP);
  const top = (arr, f, fmt) => { const p = [...arr].sort((x, y) => f(y) - f(x))[0]; return p ? `<tr><td class="l">${plink(p, { size: 26 })}</td><td><b>${fmt(f(p))}</b></td></tr>` : ''; };
  const pay = payroll(l, t.id);
  return `${probs.length ? `<div class="note err"><b>Your roster needs attention before the next game.</b><br>${probs.map(esc).join('<br>')} <button class="btn sm" data-act="go" data-v="roster">Open roster</button></div>` : ''}
  ${hero}
  <div class="grid g21">
    <div class="grid" style="align-content:start">
      ${last ? `<div><h3 style="margin-bottom:8px">Last game <button class="btn sm" data-act="go" data-v="box" style="margin-left:8px;font-family:var(--body)">Full box score</button></h3>${lineBoard(last)}</div>` : ''}
      <div class="panel"><h3>News around the league</h3><ul class="news">${l.news.slice(0, 14).map(n => `<li class="${n.k === 'big' ? 'big' : ''}"><time>${n.d}</time><p>${esc(n.t)}</p></li>`).join('')}</ul></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>${t.lg} ${t.div}</h3><table class="t"><thead><tr><th class="l">Club</th><th>W</th><th>L</th><th>GB</th><th>L10</th></tr></thead><tbody>
        ${div.map(x => `<tr class="${x.id === t.id ? 'me' : ''}"><td class="l">${logo(x.id, 18)} ${x.abbr}</td><td>${x.w}</td><td>${x.l}</td><td>${gb(div[0], x)}</td><td>${x.l10.filter(Boolean).length}-${x.l10.length - x.l10.filter(Boolean).length}</td></tr>`).join('')}</tbody></table></div>
      <div class="panel"><h3>The owner</h3><div class="pad">
        <p style="margin:0 0 8px">Goal this year: <b>${esc(t.goal)}</b> (around ${t.goalW} wins)</p>
        <div class="row"><span class="grow">Confidence in you</span><b>${t.ownerMood}%</b></div><div class="bar"><i style="width:${t.ownerMood}%;background:${t.ownerMood < 30 ? 'var(--stitch)' : t.ownerMood < 55 ? 'var(--warn)' : 'var(--good)'}"></i></div>
        <div class="row" style="margin-top:10px"><span class="grow">Payroll</span><b>${money(pay)} of $${t.budget}M</b></div><div class="bar"><i style="width:${Math.min(100, pay / t.budget * 100)}%;background:${pay > t.budget ? 'var(--stitch)' : 'var(--club)'}"></i></div>
        ${pay > l.cbt ? `<p class="bad" style="margin:8px 0 0">Over the $${l.cbt}M luxury-tax line: bill so far ${money(luxuryTax(l, t, pay))}.</p>` : `<p class="muted" style="margin:8px 0 0">${money(l.cbt - pay)} under the $${l.cbt}M luxury-tax line.</p>`}
      </div></div>
      <div class="panel"><h3>Club leaders</h3><table class="t"><tbody>
        ${top(hit.filter(p => p.st.b.AB >= Math.max(10, (t.w + t.l) * 2.2)), p => bat(p.st.b).avg, v => f3(v) + ' AVG')}${top(hit, p => p.st.b.HR, v => v + ' HR')}${top(hit, p => p.st.b.RBI, v => v + ' RBI')}
        ${top(pt, p => p.st.p?.W || 0, v => v + ' W')}${top(pt, p => p.st.p?.K || 0, v => v + ' K')}${top(pt, p => p.st.p?.SV || 0, v => v + ' SV')}
      </tbody></table></div>
    </div>
  </div>`;
};
const gb = (lead, t) => { const d = ((lead.w - t.w) + (t.l - lead.l)) / 2; return d <= 0 ? '–' : d % 1 ? d.toFixed(1) : d; };
views.box = () => S.L.lastBox ? `<div class="head"><h1>Box score</h1><span class="sp"></span><button class="btn" data-act="go" data-v="home">Back</button></div><div style="margin-bottom:16px">${lineBoard(S.L.lastBox)}</div>${boxTables(S.L.lastBox)}` : '<div class="empty">No game played yet.</div>';

// ---------- inbox ----------
views.inbox = () => {
  const l = L();
  const html = `<div class="head"><div><h1>Inbox</h1><p>Messages for you: trade offers, injuries, scouting and the owner.</p></div></div>
  <div class="panel">${l.inbox.length ? `<ul class="news">${l.inbox.map(m => `<li class="${m.unread ? 'unread' : ''} ${m.k === 'big' ? 'big' : ''}"><time>${m.d}</time><div><p>${esc(m.t)}</p>
    ${m.k === 'offer' && !m.done ? `<div class="row gap8" style="margin-top:6px">${l.phase === 'regular' ? `<span class="tag ${m.data.exp - l.day <= 2 ? 'inj' : ''}">${m.data.exp - l.day >= 0 ? `open ${m.data.exp - l.day + 1} more day${m.data.exp - l.day ? 's' : ''}` : 'expired'}</span>` : ''}<button class="btn pri sm" data-act="offer-yes" data-id="${m.id}">Accept trade</button><button class="btn sm" data-act="offer-no" data-id="${m.id}">Decline</button><button class="btn sm" data-act="offer-view" data-id="${m.id}">Look at the players</button></div>` : m.k === 'offer' ? '<small class="muted">Closed</small>' : ''}
    ${m.k === 'heal' && m.pid && P(l, m.pid)?.il ? `<button class="btn sm" data-act="activate" data-id="${m.pid}" style="margin-top:6px">Activate him</button>` : ''}
    ${m.k === 'draft' && l.draft && !l.draft.done ? '<button class="btn sm" data-act="go" data-v="draft" style="margin-top:6px">Open the draft</button>' : ''}</div></li>`).join('')}</ul>` : '<div class="empty">Nothing yet. Messages arrive as the season goes on.</div>'}</div>`;
  for (const m of l.inbox) m.unread = 0;
  return html + `<div class="panel" style="margin-top:16px"><h3>Around the league</h3><ul class="news">${l.news.slice(0, 25).map(n => `<li class="${n.k === 'big' ? 'big' : ''}"><time>${n.d}</time><p>${esc(n.t)}</p></li>`).join('')}</ul></div>`;
};
on('offer-yes', el => { const m = S.L.inbox.find(x => x.id === +el.dataset.id); if (m && say(acceptOffer(S.L, m))) save(); render(); });
on('offer-no', el => { const m = S.L.inbox.find(x => x.id === +el.dataset.id); if (m) m.done = 1; render(); });
on('offer-view', el => { const m = S.L.inbox.find(x => x.id === +el.dataset.id); if (m) go('trades', JSON.stringify({ tid: m.data.tid, give: m.data.get, get: m.data.give })); });

// ---------- roster ----------
const HIT_COLS = '<th>AVG</th><th>HR</th><th>RBI</th><th>OPS</th>';
const PIT_COLS = '<th>W-L</th><th>ERA</th><th>IP</th><th>K</th>';
const hitCells = s => s && s.PA ? `<td>${f3(bat(s).avg)}</td><td>${s.HR}</td><td>${s.RBI}</td><td>${f3(bat(s).ops)}</td>` : '<td class="muted">–</td><td class="muted">–</td><td class="muted">–</td><td class="muted">–</td>';
const pitCells = s => s && s.BF ? `<td>${s.W}-${s.L}${s.SV ? ` <small class="muted">${s.SV} SV</small>` : ''}</td><td>${pit(s).era.toFixed(2)}</td><td>${ip(s.O)}</td><td>${s.K}</td>` : '<td class="muted">–</td><td class="muted">–</td><td class="muted">–</td><td class="muted">–</td>';
const conCell = p => `<td>${p.con.sal >= 0.1 ? money(p.con.sal) : '–'}</td>`;
function rosterActions(p) {
  const b = (act, label, cls = '') => `<button class="btn sm ${cls}" data-act="${act}" data-id="${p.id}">${label}</button>`;
  if (p.il) return healthy(p) ? b('activate', 'Activate', 'pri') : `<span class="muted">${p.inj.days} days</span>`;
  if (p.lvl === 'MLB') return `${!healthy(p) ? b('il', 'To IL', 'pri') : ''}${b('send-down', 'Send down')}`;
  return `${healthy(p) ? b('call-up', 'Call up', 'acc') : ''}${p.lvl === 'AAA' ? b('to-low', 'To AA') : b('to-aaa', 'To AAA')}`;
}
function rosterTable(list, pitchers, key, extra = true) {
  const g = {
    name: p => p.last, pos: p => p.pos, age: p => p.age, ovr: p => p.ovr, pot: p => p.pot, sal: p => p.con.sal,
    s1: p => pitchers ? -(lvlStats(p).p?.BF ? pit(lvlStats(p).p).era : 99) : (lvlStats(p).b.AB ? bat(lvlStats(p).b).avg : 0),
  };
  const rows = sortBy(key, list, g, 'ovr');
  return `<div class="scroll"><table class="t"><thead><tr>${th(key, 'pos', 'Pos', 'l', true)}${th(key, 'name', 'Player', 'l', true)}${th(key, 'age', 'Age')}${th(key, 'ovr', 'OVR')}${th(key, 'pot', 'POT')}${pitchers ? PIT_COLS : HIT_COLS}${th(key, 'sal', 'Salary')}${extra ? '<th class="l"></th>' : ''}</tr></thead><tbody>
    ${rows.map(p => `<tr><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p)} ${status(p)}</td><td>${p.age}</td><td>${ovr(p.ovr)}</td><td class="pot">${potText(p)}</td>${pitchers ? pitCells(lvlStats(p).p) : hitCells(lvlStats(p).b)}${conCell(p)}${extra ? `<td class="l acts"><span class="row gap8">${rosterActions(p)}</span></td>` : ''}</tr>`).join('') || `<tr><td colspan="16" class="empty">Nobody here.</td></tr>`}
  </tbody></table></div>`;
}
views.roster = () => {
  const l = L(), t = me();
  const act = active(l, t.id), il = org(l, t.id).filter(p => p.il);
  const probs = rosterProblems(l);
  const f = forty(l, t.id).length;
  const up = org(l, t.id).filter(p => p.lvl !== 'MLB' && p.on40 && !p.il);
  return `<div class="head"><div><h1>Roster</h1><p>Active <b class="${act.length > ACTIVE_MAX ? 'bad' : ''}">${act.length}/${ACTIVE_MAX}</b> &nbsp; 40-man <b class="${f > FORTY_MAX ? 'bad' : ''}">${f}/${FORTY_MAX}</b> &nbsp; Payroll <b>${money(payroll(l, t.id))}</b> of $${t.budget}M</p></div><span class="sp"></span>
    <label class="row gap8"><input type="checkbox" data-chg="opt" data-k="autoRoster" ${l.opts.autoRoster ? 'checked' : ''}> Let my assistant handle injuries and call-ups</label></div>
  ${probs.length ? `<div class="note err">${probs.map(esc).join('<br>')}</div>` : ''}
  <div class="grid">
    <div class="panel"><h3>Position players <small>${act.filter(p => !p.isP).length} active</small></h3>${rosterTable(act.filter(p => !p.isP || p.twoWay), false, 'rh')}</div>
    <div class="panel"><h3>Pitchers <small>${act.filter(p => p.isP).length} active</small></h3>${rosterTable(act.filter(p => p.isP), true, 'rp')}</div>
    ${il.length ? `<div class="panel"><h3>Injured list <small>players here do not use an active spot; the 60-day list also frees a 40-man spot</small></h3>${rosterTable(il.filter(p => !p.isP), false, 'ih')}${il.some(p => p.isP) ? rosterTable(il.filter(p => p.isP), true, 'ip') : ''}</div>` : ''}
    <div class="panel"><h3>On the 40-man, in the minors <small>one phone call away</small></h3>${rosterTable(up.filter(p => !p.isP), false, 'uh')}${rosterTable(up.filter(p => p.isP), true, 'up')}</div>
  </div>`;
};
const act1 = fn => el => { const r = fn(S.L, +el.dataset.id); closeModal(); toast(r.msg, !r.ok); save(); render(); };
on('call-up', act1(callUp));
on('il', act1(placeIL));
on('activate', act1(activateIL));
on('to-low', act1((l, id) => setLevel(l, id, 'LOW')));
on('to-aaa', act1((l, id) => setLevel(l, id, 'AAA')));
on('add40', act1(add40));
on('send-down', el => {
  const id = +el.dataset.id, r = sendDown(S.L, id);
  if (r.needConfirm) return confirmBox('Out of options', r.msg, 'Put him on waivers', () => { say(sendDown(S.L, id, true)); save(); render(); });
  toast(r.msg, !r.ok); save(); render();
});
on('rem40', el => { const id = +el.dataset.id, r = remove40(S.L, id); if (r.needConfirm) return confirmBox('Designate for assignment', r.msg, 'Designate', () => { say(remove40(S.L, id, true)); save(); render(); }); toast(r.msg, !r.ok); render(); });
on('release', el => { const p = P(S.L, +el.dataset.id); confirmBox(`Release ${pname(p)}?`, p.on40 && p.con.sal > 1 ? `You still owe the rest of his contract (${money(p.con.sal)} a year through ${p.con.exp}).` : 'He becomes a free agent.', 'Release him', () => { say(releasePlayer(S.L, p.id)); save(); render(); }); });
on('opt', el => { S.L.opts[el.dataset.k] = el.checked; if (el.checked && (el.dataset.k === 'autoLineup' || el.dataset.k === 'autoPitch')) refreshUser(S.L); save(); render(); });

// ---------- lineup and pitching ----------
let luHand = 'R', luSel = null;
views.lineup = () => {
  const l = L(), t = me();
  if (!t.lineup?.[luHand]?.length) autoLineup(l, t);
  const lu = t.lineup[luHand] || [];
  const ids = new Set(lu.map(x => x[0]));
  const bench = active(l, t.id).filter(p => isHitter(p) && !ids.has(p.id));
  const posSel = (i, pos) => `<select data-chg="lu-pos" data-i="${i}" ${l.opts.autoLineup ? 'disabled' : ''}>${['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].map(x => `<option${x === pos ? ' selected' : ''}>${x}</option>`).join('')}</select>`;
  const dupes = lu.map(x => x[1]).filter((x, i, a) => a.indexOf(x) !== i);
  const pen = active(l, t.id).filter(p => p.isP && !t.rot.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
  const rot = t.rot.map(id => P(l, id)).filter(Boolean);
  const nextSP = probableSP(l, t);
  const roleOf = p => p.id === t.roles.cl ? 'Closer' : t.roles.su.includes(p.id) ? 'Setup' : p.id === t.roles.long ? 'Long relief' : 'Middle relief';
  const rest = p => p.fat >= 30 ? '<span class="tag inj">Tired</span>' : p.fat >= 12 ? '<span class="tag">Used recently</span>' : '<span class="tag hot">Fresh</span>';
  return `<div class="head"><div><h1>Lineup and pitching</h1><p>Click two players to swap them. Your card is used every game until you change it.</p></div></div>
  <div class="grid g2">
    <div class="panel"><h3>Batting order <span class="seg" style="margin-left:auto;font-family:var(--body)"><button class="${luHand === 'R' ? 'on' : ''}" data-act="lu-hand" data-h="R">vs right-handers</button><button class="${luHand === 'L' ? 'on' : ''}" data-act="lu-hand" data-h="L">vs left-handers</button></span></h3>
      <div class="pad row wrap" style="border-bottom:1px solid var(--line)"><label class="row gap8"><input type="checkbox" data-chg="opt" data-k="autoLineup" ${l.opts.autoLineup ? 'checked' : ''}> Bench coach sets the lineup</label><label class="row gap8"><input type="checkbox" data-chg="opt" data-k="autoRest" ${l.opts.autoRest ? 'checked' : ''}> Give regulars rest days</label><span class="grow"></span><button class="btn sm" data-act="lu-auto">Best lineup now</button></div>
      ${dupes.length ? `<div class="note err" style="margin:10px">Two players are listed at ${dupes.join(', ')}. Each position can be used once.</div>` : ''}
      <div class="lu">${lu.map(([id, pos], i) => { const p = P(l, id); if (!p) return ''; const s = p.st.b; return `<div class="slot${luSel === 'L' + i ? ' sel' : ''}" data-act="lu-pick" data-k="L${i}"><b class="n">${i + 1}</b>${posSel(i, pos)}<span>${plink(p, { sub: `${p.bats} · ${s.AB ? f3(bat(s).avg) : '.---'} · ${s.HR} HR` })} ${status(p)}</span><span class="row gap8"><small class="muted" title="Glove at this position">${pos === 'DH' ? '' : 'glove ' + Math.round(defAt(p, pos))}</small>${ovr(p.ovr)}</span></div>`; }).join('')}</div>
      <h3 style="border-top:1px solid var(--line)">Bench</h3>
      <div class="lu">${bench.map(p => `<div class="slot${luSel === 'B' + p.id ? ' sel' : ''}" data-act="lu-pick" data-k="B${p.id}"><b class="n"></b><b>${p.pos}</b><span>${plink(p, { sub: `${p.bats} · plays ${(p.elig || [p.pos]).join(', ')}` })} ${status(p)}</span>${ovr(p.ovr)}</div>`).join('') || '<div class="empty">No bench players.</div>'}</div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Starting rotation <small>next up: ${nextSP ? esc(nextSP.last) : '–'}</small></h3>
        <div class="pad" style="border-bottom:1px solid var(--line)"><label class="row gap8"><input type="checkbox" data-chg="opt" data-k="autoPitch" ${l.opts.autoPitch ? 'checked' : ''}> Pitching coach sets the rotation and bullpen roles</label></div>
        <div class="lu">${rot.map((p, i) => `<div class="slot${luSel === 'R' + p.id ? ' sel' : ''}" data-act="lu-pick" data-k="R${p.id}"><b class="n">${i + 1}</b><b>${p.throws}HP</b><span>${plink(p, { sub: p.st.p?.BF ? `${p.st.p.W}-${p.st.p.L}, ${pit(p.st.p).era.toFixed(2)}` : '' })} ${status(p)} ${rest(p)}</span>${ovr(p.ovr)}</div>`).join('')}</div></div>
      <div class="panel"><h3>Bullpen</h3><div class="lu">${pen.map(p => `<div class="slot${luSel === 'R' + p.id ? ' sel' : ''}" data-act="lu-pick" data-k="R${p.id}"><b class="n"></b><select data-chg="pen-role" data-id="${p.id}" style="width:56px" ${l.opts.autoPitch ? 'disabled' : ''} title="${roleOf(p)}">${[['cl', 'CL'], ['su', 'SU'], ['long', 'LR'], ['mid', 'MR']].map(([k, lab]) => `<option value="${k}"${roleOf(p) === { cl: 'Closer', su: 'Setup', long: 'Long relief', mid: 'Middle relief' }[k] ? ' selected' : ''}>${lab}</option>`).join('')}</select><span>${plink(p, { sub: `${p.throws}HP · ${roleOf(p)}${p.st.p?.BF ? ` · ${pit(p.st.p).era.toFixed(2)}` : ''}` })} ${status(p)} ${rest(p)}</span>${ovr(p.ovr)}</div>`).join('')}</div></div>
    </div>
  </div>`;
};
on('lu-hand', el => { luHand = el.dataset.h; luSel = null; render(); });
on('lu-auto', () => { autoLineup(S.L, me()); luSel = null; save(); render(); });
on('lu-pos', el => { const t = me(); t.lineup[luHand][+el.dataset.i][1] = el.value; save(); render(); });
on('pen-role', el => {
  const t = me(), id = +el.dataset.id, r = t.roles;
  if (r.cl === id) r.cl = 0; r.su = r.su.filter(x => x !== id); if (r.long === id) r.long = 0;
  if (el.value === 'cl') r.cl = id; else if (el.value === 'su') { r.su.unshift(id); r.su = r.su.slice(0, 2); } else if (el.value === 'long') r.long = id;
  save(); render();
});
on('lu-pick', (el, e) => {
  if (e.target.closest('select') || e.target.closest('.pl')) return;
  const l = S.L, t = me(), k = el.dataset.k;
  if (!luSel) { luSel = k; return render(); }
  if (luSel === k) { luSel = null; return render(); }
  const a = luSel, b = k; luSel = null;
  const kind = x => x[0], val = x => +x.slice(1);
  if (kind(a) === 'R' || kind(b) === 'R') {
    if (kind(a) !== 'R' || kind(b) !== 'R') { toast('Swap pitchers with pitchers.', true); return render(); }
    if (l.opts.autoPitch) { l.opts.autoPitch = false; toast('Pitching coach switched off. You now set the rotation.'); }
    const ia = t.rot.indexOf(val(a)), ib = t.rot.indexOf(val(b));
    if (ia >= 0 && ib >= 0) [t.rot[ia], t.rot[ib]] = [t.rot[ib], t.rot[ia]];
    else if (ia >= 0) t.rot[ia] = val(b); else if (ib >= 0) t.rot[ib] = val(a);
    const r = t.roles; for (const id of t.rot) { if (r.cl === id) r.cl = 0; r.su = r.su.filter(x => x !== id); if (r.long === id) r.long = 0; }
  } else {
    if (l.opts.autoLineup) { l.opts.autoLineup = false; toast('Bench coach switched off. This is now your lineup card.'); }
    const lu = t.lineup[luHand];
    if (kind(a) === 'L' && kind(b) === 'L') { const i = val(a), j = val(b); [lu[i][0], lu[j][0]] = [lu[j][0], lu[i][0]]; }
    else if (kind(a) === 'B' && kind(b) === 'B') { /* nothing to swap */ }
    else { const slot = kind(a) === 'L' ? val(a) : val(b), pid = kind(a) === 'B' ? val(a) : val(b); const p = P(l, pid); if (lu[slot][1] === 'C' && !(p.elig || []).includes('C')) toast(`${p.last} has never caught. He will be a liability behind the plate.`, true); lu[slot][0] = pid; }
  }
  save(); render();
});

// ---------- minors ----------
let minLvl = 'AAA';
views.minors = () => {
  const l = L(), t = me();
  const list = org(l, t.id).filter(p => p.lvl === minLvl && !p.il);
  const tbl = (arr, pitchers, key) => {
    const g = { name: p => p.last, age: p => p.age, ovr: p => p.ovr, pot: p => shownPot(p), dev: p => devFactor(l, p), gain: p => p.ovr - p.d0 };
    const rows = sortBy(key, arr, g, 'pot');
    return `<div class="scroll"><table class="t"><thead><tr><th class="l">Pos</th>${th(key, 'name', 'Player', 'l', true)}${th(key, 'age', 'Age')}${th(key, 'ovr', 'OVR')}${th(key, 'pot', 'POT')}${th(key, 'dev', 'Growth')}${pitchers ? PIT_COLS : HIT_COLS}<th class="l"></th></tr></thead><tbody>
    ${rows.map(p => { const f = devFactor(l, p), gain = Math.round(p.ovr - p.d0); return `<tr><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p)} ${status(p)}${p.on40 ? '<span class="tag o40">40</span>' : ''}</td><td>${p.age}</td><td>${ovr(p.ovr)}</td><td class="pot">${potText(p)}</td><td><span class="tag ${f >= 0.95 ? 'hot' : f < 0.7 ? 'inj' : ''}">${p.age >= 29 || p.ovr >= p.pot ? 'Finished' : devLabel(f)}</span></td>${pitchers ? pitCells(p.sm.p) : hitCells(p.sm.b)}<td class="l acts"><span class="row gap8">${rosterActions(p)}${!p.on40 ? `<button class="btn sm" data-act="add40" data-id="${p.id}">Add to 40</button>` : ''}</span></td></tr>`; }).join('') || '<tr><td colspan="16" class="empty">Nobody at this level.</td></tr>'}</tbody></table></div>`;
  };
  return `<div class="head"><div><h1>Minor leagues</h1><p>${minLvl === 'AAA' ? `${esc(t.aaa)} (${t.mw}–${t.ml}). Triple-A games are played every day. Young players who play regularly here improve faster than they would on a big-league bench.` : `${esc(t.aa)} and below. Raw prospects grow here until they reach about 63 overall, then they need Triple-A to keep improving.`}</p></div><span class="sp"></span>
    <span class="seg"><button class="${minLvl === 'AAA' ? 'on' : ''}" data-act="min-lvl" data-l="AAA">Triple-A</button><button class="${minLvl === 'LOW' ? 'on' : ''}" data-act="min-lvl" data-l="LOW">Double-A and below</button></span></div>
  <div class="grid"><div class="panel"><h3>Position players <small>${list.filter(p => !p.isP).length}</small></h3>${tbl(list.filter(p => !p.isP), false, 'mh')}</div><div class="panel"><h3>Pitchers <small>${list.filter(p => p.isP).length}</small></h3>${tbl(list.filter(p => p.isP), true, 'mp')}</div></div>`;
};
on('min-lvl', el => { minLvl = el.dataset.l; render(); });

// ---------- schedule ----------
let schedMonth = null;
views.schedule = () => {
  const l = L(), t = me();
  if (l.phase !== 'regular' && !l.sched.length) return '<div class="empty">No schedule yet.</div>';
  const cur = dateOf(l.season, Math.min(l.day, l.sched.length - 1));
  if (schedMonth === null) schedMonth = cur.getUTCMonth();
  const months = [...new Set(l.sched.map((_, i) => dateOf(l.season, i).getUTCMonth()))];
  if (!months.includes(schedMonth)) schedMonth = months[0];
  const names = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];
  const first = new Date(Date.UTC(l.season, schedMonth, 1)), pad = first.getUTCDay(), dim = new Date(Date.UTC(l.season, schedMonth + 1, 0)).getUTCDate();
  const day0 = Math.round((first - dateOf(l.season, 0)) / 864e5);
  let cells = Array(pad).fill('<div></div>').join('');
  for (let d = 1; d <= dim; d++) {
    const i = day0 + d - 1, sd = l.sched[i];
    const g = sd?.g.find(x => x.h === t.id || x.a === t.id);
    if (!sd) { cells += `<div class="d off"><span class="dt">${d}</span></div>`; continue; }
    if (!g) { cells += `<div class="d off${i === l.day ? ' today' : ''}"><span class="dt">${d}</span><div class="muted">${sd.asb ? 'All-Star break, draft' : i === Math.round(l.sched.length * 0.67) ? 'Day off' : 'Day off'}</div></div>`; continue; }
    const home = g.h === t.id, opp = T(l, home ? g.a : g.h);
    let res = '';
    if (g.done) { const us = home ? g.hs : g.as, them = home ? g.as : g.hs; res = `<b class="${us > them ? 'good' : 'bad'}">${us > them ? 'W' : 'L'} ${us}–${them}</b>`; }
    cells += `<div class="d ${g.done ? ((home ? g.hs > g.as : g.as > g.hs) ? 'w' : 'l') : ''}${i === l.day && l.phase === 'regular' ? ' today' : ''}"><span class="dt">${d}${i === Math.round(l.sched.length * 0.67) ? ' · trade deadline' : ''}</span><div class="opp">${home ? '' : '@'}${logo(opp.id, 18)}${opp.abbr}</div>${res}</div>`;
  }
  return `<div class="head"><div><h1>Schedule</h1><p>${rec(t)} · home ${t.hw}–${t.hl}, road ${t.aw}–${t.al} · runs ${t.rs} for, ${t.ra} against</p></div><span class="sp"></span><span class="seg">${months.map(m => `<button class="${m === schedMonth ? 'on' : ''}" data-act="sched-m" data-m="${m}">${names[m]}</button>`).join('')}</span></div>
  <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('')}${cells}</div>`;
};
on('sched-m', el => { schedMonth = +el.dataset.m; render(); });

// ---------- standings ----------
views.standings = () => {
  const l = L(), st = standings(l);
  const row = (x, lead, cut = false) => `<tr class="${x.id === l.userTid ? 'me' : ''}${cut ? ' cut' : ''}"><td class="l"><span class="pl" data-act="go" data-v="team" data-arg="${x.id}">${logo(x.id, 20)} <span class="nm">${esc(x.name)}</span></span></td><td>${x.w}</td><td>${x.l}</td><td>${f3(pct(x))}</td><td>${gb(lead, x)}</td><td>${x.hw}-${x.hl}</td><td>${x.aw}-${x.al}</td><td>${x.rs}</td><td>${x.ra}</td><td class="${x.rs - x.ra >= 0 ? 'good' : 'bad'}">${x.rs - x.ra > 0 ? '+' : ''}${x.rs - x.ra}</td><td>${x.l10.filter(Boolean).length}-${x.l10.length - x.l10.filter(Boolean).length}</td><td>${x.strk > 0 ? 'W' + x.strk : x.strk < 0 ? 'L' + -x.strk : '–'}</td></tr>`;
  const head = '<thead><tr><th class="l">Club</th><th>W</th><th>L</th><th>Pct</th><th>GB</th><th>Home</th><th>Road</th><th>RS</th><th>RA</th><th>Diff</th><th>L10</th><th>Strk</th></tr></thead>';
  const lgCol = lg => {
    const field = playoffField(l, lg), winners = field.slice(0, 3);
    const wc = l.teams.filter(x => x.lg === lg && !winners.includes(x)).sort((a, b) => pct(b) - pct(a) || (b.rs - b.ra) - (a.rs - a.ra));
    return `<div class="grid" style="align-content:start">${['East', 'Central', 'West'].map(d => `<div class="panel"><h3>${lg} ${d}</h3><div class="scroll"><table class="t">${head}<tbody>${st[`${lg} ${d}`].map(x => row(x, st[`${lg} ${d}`][0])).join('')}</tbody></table></div></div>`).join('')}
      <div class="panel"><h3>${lg} wild card <small>top three get in</small></h3><div class="scroll"><table class="t">${head}<tbody>${wc.slice(0, 8).map((x, i) => row(x, wc[2], i === 2)).join('')}</tbody></table></div></div></div>`;
  };
  return `<div class="head"><h1>Standings</h1></div><div class="grid g2">${lgCol('AL')}${lgCol('NL')}</div>`;
};

// ---------- stats ----------
let stKind = 'bat', stScope = 'lg', stLvl = 'MLB';
views.stats = () => {
  const l = L();
  const gp = Math.max(1, Math.round(l.teams.reduce((s, t) => s + t.w + t.l, 0) / 30));
  const key = stLvl === 'MLB' ? 'st' : 'sm';
  let list = l.players.filter(p => p.tid >= 0 && (stScope === 'lg' || p.tid === l.userTid));
  let body;
  if (stKind === 'bat') {
    const q = stScope === 'lg' ? gp * 3.1 : 1;
    list = list.filter(p => (p[key]?.b?.PA || 0) >= q && (!p.isP || p.twoWay));
    const b = p => p[key].b, d = p => bat(b(p));
    const g = { name: p => p.last, G: p => b(p).G, PA: p => b(p).PA, AVG: p => d(p).avg, OBP: p => d(p).obp, SLG: p => d(p).slg, OPS: p => d(p).ops, H: p => b(p).H, D: p => b(p).D, T: p => b(p).T, HR: p => b(p).HR, R: p => b(p).R, RBI: p => b(p).RBI, BB: p => b(p).BB, K: p => b(p).K, SB: p => b(p).SB, WAR: p => batWAR(p, b(p)) };
    const rows = sortBy('sb', list, g, 'OPS').slice(0, 60);
    const c = ['G', 'PA', 'AVG', 'OBP', 'SLG', 'OPS', 'H', 'D', 'T', 'HR', 'R', 'RBI', 'BB', 'K', 'SB', 'WAR'];
    const lab = { D: '2B', T: '3B' };
    body = `<table class="t"><thead><tr><th>#</th>${th('sb', 'name', 'Player', 'l', true)}<th class="l">Club</th>${c.map(k => th('sb', k, lab[k] || k)).join('')}</tr></thead><tbody>${rows.map((p, i) => `<tr class="${p.tid === l.userTid ? 'me' : ''}"><td>${i + 1}</td><td class="l">${plink(p, { sub: p.pos, size: 26 })}</td><td class="l">${logo(p.tid, 18)}</td>${c.map(k => `<td>${['AVG', 'OBP', 'SLG', 'OPS'].includes(k) ? f3(g[k](p)) : k === 'WAR' ? g[k](p).toFixed(1) : g[k](p)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="20" class="empty">No qualified hitters yet. Play some games.</td></tr>'}</tbody></table>`;
  } else {
    const q = stScope === 'lg' ? gp * (stKind === 'sp' ? 1 : 0.25) * 3 : 1;
    list = list.filter(p => p.isP && (p[key]?.p?.O || 0) >= q && (stKind === 'sp' ? p[key].p.GS > 0 : stScope === 'lg' ? p[key].p.GS === 0 : true));
    const s = p => p[key].p, d = p => pit(s(p));
    const g = { name: p => p.last, G: p => s(p).G, GS: p => s(p).GS, W: p => s(p).W, L: p => s(p).L, SV: p => s(p).SV, HLD: p => s(p).HLD || 0, IP: p => s(p).O, ERA: p => -d(p).era, WHIP: p => -d(p).whip, K: p => s(p).K, BB: p => s(p).BB, HR: p => s(p).HR, K9: p => d(p).k9, WAR: p => pitWAR(p, s(p)) };
    const rows = sortBy('sp' + stKind, list, g, 'ERA').slice(0, 60);
    const c = ['G', 'GS', 'W', 'L', 'SV', 'HLD', 'IP', 'ERA', 'WHIP', 'K', 'BB', 'HR', 'K9', 'WAR'];
    const fmt = (k, p) => k === 'IP' ? ip(s(p).O) : k === 'ERA' ? d(p).era.toFixed(2) : k === 'WHIP' ? d(p).whip.toFixed(2) : k === 'K9' ? d(p).k9.toFixed(1) : k === 'WAR' ? g.WAR(p).toFixed(1) : g[k](p);
    body = `<table class="t"><thead><tr><th>#</th>${th('sp' + stKind, 'name', 'Player', 'l', true)}<th class="l">Club</th>${c.map(k => th('sp' + stKind, k, k === 'K9' ? 'K/9' : k)).join('')}</tr></thead><tbody>${rows.map((p, i) => `<tr class="${p.tid === l.userTid ? 'me' : ''}"><td>${i + 1}</td><td class="l">${plink(p, { sub: p.throws + 'HP', size: 26 })}</td><td class="l">${logo(p.tid, 18)}</td>${c.map(k => `<td>${fmt(k, p)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="20" class="empty">No qualified pitchers yet.</td></tr>'}</tbody></table>`;
  }
  const seg = (cur, set, opts) => `<span class="seg">${opts.map(([v, lab]) => `<button class="${cur === v ? 'on' : ''}" data-act="st-set" data-k="${set}" data-v="${v}">${lab}</button>`).join('')}</span>`;
  return `<div class="head"><div><h1>Stats and leaders</h1><p>Click a column to sort. League lists show qualified players only.</p></div><span class="sp"></span>${seg(stKind, 'kind', [['bat', 'Hitters'], ['sp', 'Starters'], ['rp', 'Relievers']])}${seg(stScope, 'scope', [['lg', 'Whole league'], ['me', 'My club']])}${seg(stLvl, 'lvl', [['MLB', 'Majors'], ['AAA', 'Triple-A']])}</div><div class="panel"><div class="scroll">${body}</div></div>`;
};
on('st-set', el => { const { k, v } = el.dataset; if (k === 'kind') stKind = v; else if (k === 'scope') stScope = v; else stLvl = v; render(); });

// ---------- playoffs ----------
views.playoffs = () => {
  const l = L();
  if (!l.po) {
    const col = lg => `<div class="panel"><h3>${lg} if the season ended today</h3><table class="t"><tbody>${playoffField(l, lg).map((t, i) => `<tr class="${t.id === l.userTid ? 'me' : ''}"><td>${i + 1}</td><td class="l">${logo(t.id, 20)} ${esc(t.name)}</td><td>${rec(t)}</td><td class="l muted">${i < 2 ? 'First-round bye' : i === 2 ? 'Division winner' : 'Wild card'}</td></tr>`).join('')}</tbody></table></div>`;
    return `<div class="head"><div><h1>Playoffs</h1><p>Twelve clubs qualify: three division winners and three wild cards per league. The top two seeds skip the first round.</p></div></div><div class="grid g2">${col('AL')}${col('NL')}</div>`;
  }
  const ser = s => { const a = T(l, s.a), b = T(l, s.b); return `<div class="board ser"><table><tbody><tr><td class="tm">${logo(a.id, 20)} ${a.abbr}</td><td class="tot">${s.wa}</td></tr><tr><td class="tm">${logo(b.id, 20)} ${b.abbr}</td><td class="tot">${s.wb}</td></tr></tbody></table><div class="cap"><span>${s.lg === 'WS' ? '' : s.lg} best of ${s.n}</span><span>${s.winner ? T(l, s.winner).abbr + ' advance' : ''}</span></div></div>`; };
  return `<div class="head"><div><h1>${l.season} playoffs</h1><p>${l.po.champ ? `${esc(T(l, l.po.champ).name)} won the World Series.` : ROUND_NAME[l.po.round] + ' in progress.'}</p></div></div>
  <div class="bracket">${[0, 1, 2, 3].map(r => `<div><h3 style="margin-bottom:8px">${ROUND_NAME[r]}</h3>${l.po.series.filter(s => s.round === r).map(ser).join('') || '<p class="muted">To be decided</p>'}</div>`).join('')}</div>`;
};

// ---------- other clubs ----------
views.teams = () => {
  const l = L();
  const g = { name: t => t.name, w: t => pct(t), str: t => teamStrength(l, t.id), pay: t => payroll(l, t.id), bud: t => t.budget, titles: t => t.titles || 0 };
  const rows = sortBy('tm', l.teams, g, 'str');
  return `<div class="head"><div><h1>Other clubs</h1><p>Open a club to scout its roster and start a trade.</p></div></div><div class="panel"><div class="scroll"><table class="t"><thead><tr>${th('tm', 'name', 'Club', 'l', true)}<th class="l">Division</th>${th('tm', 'w', 'Record')}${th('tm', 'str', 'Roster strength')}${th('tm', 'pay', 'Payroll')}${th('tm', 'bud', 'Budget')}${th('tm', 'titles', 'Titles')}<th class="l">Owner wants</th></tr></thead><tbody>
  ${rows.map(t => `<tr class="${t.id === l.userTid ? 'me' : ''}"><td class="l"><span class="pl" data-act="go" data-v="team" data-arg="${t.id}">${logo(t.id, 22)} <span class="nm">${esc(t.name)}</span></span></td><td class="l">${t.lg} ${t.div}</td><td>${rec(t)}</td><td>${ovr(g.str(t))}</td><td>${money(g.pay(t))}</td><td>$${t.budget}M</td><td>${t.titles || 0}</td><td class="l muted">${esc(t.goal)}</td></tr>`).join('')}</tbody></table></div></div>`;
};
views.team = () => {
  const l = L(), t = T(l, +S.arg) || me();
  const act = active(l, t.id), farm = org(l, t.id).filter(p => p.lvl !== 'MLB').sort((a, b) => shownPot(b) - shownPot(a)).slice(0, 14);
  return `<div class="head"><span class="tlogo" style="width:56px;height:56px">${logo(t.id, 56)}</span><div><h1>${esc(t.name)}</h1><p>${rec(t)} · ${t.lg} ${t.div} · payroll ${money(payroll(l, t.id))} of $${t.budget}M · ${esc(t.park.name)}</p></div><span class="sp"></span>${t.id !== l.userTid ? `<button class="btn pri" data-act="go" data-v="trades" data-arg='${JSON.stringify({ tid: t.id })}'>Trade with the ${esc(t.nick)}</button>` : ''}</div>
  <div class="grid"><div class="panel"><h3>Position players</h3>${rosterTable(act.filter(p => !p.isP || p.twoWay), false, 'th', false)}</div><div class="panel"><h3>Pitchers</h3>${rosterTable(act.filter(p => p.isP), true, 'tp', false)}</div>
  <div class="panel"><h3>Top prospects</h3><div class="scroll"><table class="t"><thead><tr><th class="l">Pos</th><th class="l">Player</th><th>Age</th><th>OVR</th><th>POT</th><th class="l">Level</th></tr></thead><tbody>${farm.map(p => `<tr><td class="l"><b>${p.pos}</b></td><td class="l">${plink(p)}</td><td>${p.age}</td><td>${ovr(p.ovr)}</td><td class="pot">${potText(p)}</td><td class="l">${p.lvl === 'AAA' ? 'Triple-A' : 'Double-A'}</td></tr>`).join('')}</tbody></table></div></div></div>`;
};
export { rosterTable, hitCells, pitCells, HIT_COLS, PIT_COLS, rec, lvlStats };
