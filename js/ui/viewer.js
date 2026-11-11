// The game viewer: a top-down animated ballpark, pitch tracker, scoreboard and the
// manager's buttons. Plays one Game object event by event.
import { S, esc, face, logo, ovr, pname, toast, muted, setMuted } from './core.js';
import { parkOn, parkOff, parkMute, cheer, groan, crack, pop, organ } from './audio.js';
import { P, T, makeGame, userGameToday, finishGame, healthy } from '../engine/league.js';
import { advanceDay, userSeries, seriesHome, playoffGameResult } from '../engine/season.js';
import { fenceAt, staminaLimit } from '../engine/game.js';
import { bat, pit, f3, ip } from '../engine/stats.js';
import { lineBoard, boxTables } from './views.js';
import { slimBox } from '../engine/league.js';

const D2R = Math.PI / 180;
const polar = (d, a) => [d * Math.sin(a * D2R), d * Math.cos(a * D2R)];
const BASE = [[0, 0], [63.64, 63.64], [0, 127.28], [-63.64, 63.64], [0, 0]];
const SPOT = { P: [0, 59], C: [0, -14], '1B': polar(108, 33), '2B': polar(150, 14), SS: polar(150, -14), '3B': polar(108, -33), LF: polar(290, -27), CF: polar(318, 0), RF: polar(290, 27) };
const PITCH = { FF: 'Fastball', SI: 'Sinker', FC: 'Cutter', SL: 'Slider', CH: 'Changeup', CU: 'Curveball', FS: 'Splitter', KN: 'Knuckleball', ST: 'Sweeper', SV: 'Slurve' };
const RES = { B: ['Ball', '#2f9e5b'], C: ['Called strike', '#d83a3a'], S: ['Swinging strike', '#a11d1d'], F: ['Foul', '#d98a1f'], X: ['In play', '#2f6fd8'], H: ['Hit batter', '#8a4fd8'] };
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const textOn = hex => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#16211c' : '#fff'; };
const SAY = { B: 'ball', C: 'called strike', S: 'swinging strike', F: 'fouled off', X: 'in play', H: 'hit by the pitch' };
const ORDN = n => n + (['st', 'nd', 'rd'][n - 1] || 'th');
// where a pitch crossed the plate, from the hitter's point of view
function spot(pt, bats) {
  const high = pt.z > 3.35 ? 'up' : pt.z < 1.75 ? 'down' : '';
  const inside = (bats === 'L' ? pt.x > 0.35 : pt.x < -0.35), away = (bats === 'L' ? pt.x < -0.35 : pt.x > 0.35);
  const side = inside ? 'in' : away ? 'away' : '';
  if (!high && !side) return 'over the plate';
  if (high && side) return `${high} and ${side}`;
  return high || side;
}
// Speeds: every pitch, key moments (rush the routine, slow down for what matters), fast.
const MODES = { all: 1.15, key: 0, fast: 5 };

export function openViewer(onDone) {
  const L = S.L;
  let sg = null, ser = null, hId, aId;
  if (L.phase === 'playoffs') { ser = userSeries(L); if (!ser) return; [hId, aId] = seriesHome(ser); }
  else { sg = userGameToday(L); if (!sg) return; hId = sg.h; aId = sg.a; }
  const g = makeGame(L, hId, aId, { detail: true, manualTid: L.userTid, playoff: !!ser });
  if (!g) { toast('Could not set up the game. Check your roster.', true); return; }
  const ui = g.sides.findIndex(s => s.tid === L.userTid);
  const teams = [T(L, aId), T(L, hId)];
  const park = teams[1].park;
  let speed = 1.35, mode = 'key', paused = false, picking = false, closed = false, coach = false, skip = false;
  const asked = {};
  let halfHits = [0, 0], lastOn = 0;

  const root = document.createElement('div');
  root.className = 'gv';
  root.innerHTML = `
    <div class="gv-top">
      <div id="gv-board"></div>
      <div class="gv-sit"><div><div class="inn" id="gv-inn">Top 1st</div><small>${esc(park.name)}</small></div>
        <div class="diamond"><i class="b2" id="gv-b2"></i><i class="b3" id="gv-b3"></i><i class="b1" id="gv-b1"></i></div>
        <div class="cnts"><span>Balls</span><div class="bulbs" id="gv-balls"><i></i><i></i><i></i></div><span>Strikes</span><div class="bulbs" id="gv-strikes"><i></i><i></i></div><span>Outs</span><div class="bulbs o" id="gv-outs"><i></i><i></i><i></i></div></div></div>
      <div class="gv-ctl">
        <label class="row gap8" style="font-size:13px"><input type="checkbox" id="gv-coach"> Bench coach manages for me</label>
        <span class="seg" id="gv-speed" title="Key moments rushes routine at-bats and slows down for the ones that matter"><button data-m="all">Every pitch</button><button data-m="key" class="on">Key moments</button><button data-m="fast">Fast</button></span>
        <button class="btn" id="gv-snd" aria-label="Sound">${muted() ? 'Sound off' : 'Sound on'}</button><button class="btn" id="gv-pause">Pause</button><button class="btn pri" id="gv-skip">Sim to the end</button>
      </div>
    </div>
    <div class="gv-body">
      <div class="gv-col">
        <div><h4>Pitching</h4><div class="mcard" id="gv-pit"></div></div>
        <div><h4>At bat</h4><div class="mcard" id="gv-bat"></div></div>
        <div class="zone"><div class="cnt"><span id="gv-ptype">Pitch tracker</span><span id="gv-pv"></span></div><svg viewBox="-2 0.4 4 4.3" id="gv-zone"></svg><div class="plist" id="gv-plist"></div></div>
      </div>
      <div class="gv-field"><canvas id="gv-cv"></canvas><div class="gv-call" id="gv-call"></div><div class="gv-desc" id="gv-desc">First pitch coming up.</div></div>
      <div class="gv-col rt">
        <div style="min-width:240px"><h4>Your move</h4><div class="mgr" id="gv-mgr"></div></div>
        <div class="wp" style="min-width:200px"><svg viewBox="0 0 200 54" preserveAspectRatio="none" id="gv-wp"></svg></div>
        <div class="pbp" id="gv-pbp"></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);
  const cv = $('gv-cv'), cx = cv.getContext('2d');

  // ---------- field geometry ----------
  let W = 0, H = 0, sc = 1, ox = 0, oy = 0, bg = null;
  const toS = (x, y) => [ox + x * sc, oy - y * sc];
  function resize() {
    const r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(200, r.width); H = Math.max(200, r.height);
    cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc = Math.min(W / 590, H / 520); ox = W / 2; oy = H - 58 * sc - 46;
    bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height;
    const c = bg.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); drawField(c);
  }
  function fencePath(c, extra = 0) {
    c.beginPath();
    for (let a = -45; a <= 45; a += 1.5) { const [x, y] = polar(fenceAt(park, a) + extra, a), [sx, sy] = toS(x, y); a === -45 ? c.moveTo(sx, sy) : c.lineTo(sx, sy); }
  }
  function drawField(c) {
    const club = teams[1];
    c.fillStyle = '#0d2219'; c.fillRect(0, 0, W, H);
    // stands
    c.save(); fencePath(c, 62); const [hx, hy] = toS(0, -62); c.lineTo(...toS(95, -40)); c.lineTo(hx, hy); c.lineTo(...toS(-95, -40)); c.closePath(); c.fillStyle = '#243b33'; c.fill(); c.clip();
    for (let i = 0; i < 2600; i++) { const a = -60 + (i * 137.5) % 120, d = 330 + (i * 53) % 170; const [x, y] = polar(d, a); if (d < fenceAt(park, a) + 6) continue; const [sx, sy] = toS(x, y); c.fillStyle = i % 5 === 0 ? club.c1 : i % 7 === 0 ? '#e8e3d3' : i % 3 === 0 ? '#51685e' : '#3a5248'; c.fillRect(sx, sy, 2.2, 2.2); }
    c.restore();
    // foul ground and fair grass
    c.beginPath(); c.moveTo(...toS(0, -46)); c.lineTo(...toS(-282, 236)); fencePath2(c); c.lineTo(...toS(282, 236)); c.closePath(); c.fillStyle = '#3a8548'; c.fill();
    c.save(); c.beginPath(); c.moveTo(...toS(0, 0)); for (let a = -45; a <= 45; a += 1.5) c.lineTo(...toS(...polar(fenceAt(park, a), a))); c.closePath(); c.clip();
    for (let d = 0, i = 0; d < 460; d += 26, i++) { c.beginPath(); const [mx, my] = toS(0, 0); c.arc(mx, my, (d + 26) * sc, 0, Math.PI * 2); c.arc(mx, my, d * sc, 0, Math.PI * 2, true); c.fillStyle = i % 2 ? '#3f8f4f' : '#479a57'; c.fill(); }
    // warning track
    c.lineWidth = 15 * sc; c.strokeStyle = '#b98a5e'; fencePath(c, -7.5); c.stroke();
    c.restore();
    // infield dirt
    c.save(); c.beginPath(); c.moveTo(...toS(0, -14)); c.lineTo(...toS(150, 136)); c.lineTo(...toS(0, 240)); c.lineTo(...toS(-150, 136)); c.closePath(); c.clip();
    const [px, py] = toS(0, 60.5); c.beginPath(); c.arc(px, py, 95 * sc, 0, Math.PI * 2); c.fillStyle = '#b98a5e'; c.fill(); c.restore();
    c.beginPath(); c.moveTo(...toS(0, 9)); c.lineTo(...toS(54.5, 63.64)); c.lineTo(...toS(0, 118)); c.lineTo(...toS(-54.5, 63.64)); c.closePath(); c.fillStyle = '#479a57'; c.fill();
    const disc = (x, y, r, col) => { const [sx, sy] = toS(x, y); c.beginPath(); c.arc(sx, sy, r * sc, 0, Math.PI * 2); c.fillStyle = col; c.fill(); };
    disc(0, 0, 13, '#b98a5e'); disc(0, 59.5, 9, '#c2946a');
    // lines
    c.strokeStyle = '#f4f1e6'; c.lineWidth = Math.max(1.2, 1.1 * sc);
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(...toS(0, 0)); c.lineTo(...toS(...polar(fenceAt(park, 45 * s), 45 * s))); c.stroke(); }
    c.lineWidth = Math.max(2.5, 2.2 * sc); c.strokeStyle = '#17402f'; fencePath(c); c.stroke();
    c.lineWidth = Math.max(1, 0.8 * sc); c.strokeStyle = '#ffd24a'; fencePath(c, 1.5); c.stroke();
    // bases
    for (let i = 1; i <= 3; i++) { const [sx, sy] = toS(...BASE[i]); c.save(); c.translate(sx, sy); c.rotate(Math.PI / 4); c.fillStyle = '#fff'; const b = Math.max(3.4, 2.4 * sc); c.fillRect(-b, -b, b * 2, b * 2); c.restore(); }
    const [h1, h2] = toS(0, 0); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(h1 - 3.5, h2 - 3); c.lineTo(h1 + 3.5, h2 - 3); c.lineTo(h1 + 3.5, h2 + 0.5); c.lineTo(h1, h2 + 4); c.lineTo(h1 - 3.5, h2 + 0.5); c.closePath(); c.fill();
    const [m1, m2] = toS(0, 60.5); c.fillRect(m1 - 3, m2 - 1, 6, 2);
    // distances on the wall
    c.fillStyle = '#ffd24a'; c.font = `800 ${Math.max(10, 11 * sc)}px "Big Shoulders Display", sans-serif`; c.textAlign = 'center';
    for (const [a, v] of [[-43, park.lf], [-22.5, park.lcf], [0, park.cf], [22.5, park.rcf], [43, park.rf]]) { const [sx, sy] = toS(...polar(fenceAt(park, a) + 14, a)); c.fillText(v, sx, sy + 4); }
    function fencePath2(cc) { for (let a = -45; a <= 45; a += 1.5) cc.lineTo(...toS(...polar(fenceAt(park, a), a))); }
  }

  // ---------- things on the field ----------
  // E.half and E.bat follow the play on screen; the game itself is already one step ahead
  const E = { f: {}, runners: new Map(), ball: null, batter: true, trail: [], wind: 0, swing: null, fx: [], half: 0, bat: null };
  // fireworks over the outfield stands (home-team home runs and wins)
  function fireworks(n = 5) {
    const cols = [teams[1].c1, teams[1].c2, '#ffd24a', '#ffffff', '#ff5a6a'];
    for (let b = 0; b < n; b++) {
      const a = -38 + Math.random() * 76, [x, y] = polar(fenceAt(park, a) + 55 + Math.random() * 40, a), [sx, sy0] = toS(x, y), sy = sy0 - 30 - Math.random() * 50 * sc;
      const col = cols[b % cols.length], delay = b * 260;
      for (let i = 0; i < 46; i++) { const ang = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90; E.fx.push({ x: sx, y: sy, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, t0: performance.now() + delay, life: 1100 + Math.random() * 600, col }); }
    }
  }
  function resetFielders() { for (const k in SPOT) E.f[k] = { x: SPOT[k][0], y: SPOT[k][1] }; }
  function syncRunners() {
    E.runners.clear();
    g.bases.forEach((r, i) => { if (r) E.runners.set(r.p.id, { x: BASE[i + 1][0], y: BASE[i + 1][1] }); });
  }
  function dot(x, y, r, fill, stroke, label, ink) {
    const [sx, sy] = toS(x, y);
    cx.beginPath(); cx.ellipse(sx + 1, sy + r * 0.75, r * 0.95, r * 0.42, 0, 0, Math.PI * 2); cx.fillStyle = 'rgba(0,0,0,.28)'; cx.fill();
    cx.beginPath(); cx.arc(sx, sy, r, 0, Math.PI * 2); cx.fillStyle = fill; cx.fill(); cx.lineWidth = 1.6; cx.strokeStyle = stroke; cx.stroke();
    if (label) { cx.fillStyle = ink; cx.font = `800 ${Math.round(r * 1.05)}px "Big Shoulders Display", sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(label, sx, sy + 0.5); cx.textBaseline = 'alphabetic'; }
  }
  function frame() {
    if (closed) return;
    if (bg) { cx.drawImage(bg, 0, 0, W, H); }
    const fld = teams[1 - E.half], btm = teams[E.half];
    const r = Math.max(10, 7.4 * sc);
    const rim = fld.c2 === fld.c1 || fld.c2 === '#27251F' ? '#fff' : fld.c2;
    for (const k in E.f) dot(E.f[k].x, E.f[k].y, k === 'P' ? r * (1 + 0.28 * Math.sin(E.wind * Math.PI)) : r, fld.c1, rim, k === 'P' ? '' : k.replace('B', ''), textOn(fld.c1));
    for (const [, p] of E.runners) dot(p.x, p.y, r, '#fff', btm.c1, '', '#000');
    if (E.batter && E.bat) {
      const lefty = E.bat.lefty, bx = lefty ? 5 : -5, [sx, sy] = toS(bx, 0.5);
      // the bat: cocked behind him, then it whips through the zone on a swing
      // a righty's bat rests back over his shoulder (pointing at the catcher) and sweeps counter-clockwise through the zone; a lefty mirrors it
      const k = E.swing ?? 0, ang = (lefty ? 270 - k * 235 : 270 + k * 235) * D2R, len = r * 2.6, ex = sx + Math.cos(ang) * len, ey = sy - Math.sin(ang) * len;
      cx.save(); cx.lineCap = 'round';
      cx.strokeStyle = '#1a0f05'; cx.lineWidth = Math.max(5, r * 0.55); cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(ex, ey); cx.stroke();
      cx.strokeStyle = '#f0cf95'; cx.lineWidth = Math.max(3, r * 0.34); cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(ex, ey); cx.stroke(); cx.restore();
      dot(bx, 0.5, r, '#fff', btm.c1, '', '#000');
      // name tag on the outside of the batter's box, clear of the bat and the pitch
      cx.font = `700 ${Math.max(11, r * 1.05)}px "Public Sans", sans-serif`; cx.textBaseline = 'middle';
      const nm = E.bat.p.last.toUpperCase(), tw = cx.measureText(nm).width + 12, th = r * 1.35 + 4, tx = lefty ? sx + r * 1.6 : sx - r * 1.6 - tw;
      cx.fillStyle = 'rgba(5,8,13,.85)'; cx.fillRect(tx, sy - th / 2, tw, th); cx.fillStyle = '#fff'; cx.textAlign = 'left'; cx.fillText(nm, tx + 6, sy + 1); cx.textBaseline = 'alphabetic';
    }
    for (const t of E.trail) { const [sx, sy] = toS(t[0], t[1]); cx.beginPath(); cx.arc(sx, sy - t[2] * sc * 0.55, 1.6, 0, Math.PI * 2); cx.fillStyle = 'rgba(255,255,255,.35)'; cx.fill(); }
    if (E.ball) {
      const [sx, sy] = toS(E.ball.x, E.ball.y), h = E.ball.h || 0;
      cx.beginPath(); cx.ellipse(sx, sy, 3.4, 1.8, 0, 0, Math.PI * 2); cx.fillStyle = 'rgba(0,0,0,.35)'; cx.fill();
      cx.beginPath(); cx.arc(sx, sy - h * sc * 0.55, 3.2 + h * 0.022, 0, Math.PI * 2); cx.fillStyle = '#fff'; cx.fill(); cx.lineWidth = 1; cx.strokeStyle = '#c8102e'; cx.stroke();
    }
    if (E.fx.length) {
      const now = performance.now();
      cx.save(); cx.globalCompositeOperation = 'lighter';
      E.fx = E.fx.filter(p => now - p.t0 < p.life);
      for (const p of E.fx) {
        const t = (now - p.t0) / 1000; if (t < 0) continue;
        const x = p.x + p.vx * t, y = p.y + p.vy * t + 60 * t * t, a = 1 - (now - p.t0) / p.life;
        cx.globalAlpha = Math.max(0, a); cx.fillStyle = p.col; cx.beginPath(); cx.arc(x, y, 2.2, 0, Math.PI * 2); cx.fill();
      }
      cx.restore();
    }
    requestAnimationFrame(frame);
  }

  // ---------- timing ----------
  const sleep = ms => new Promise(res => { if (skip || closed) return res(); setTimeout(res, ms / speed); });
  const hold = async () => { while ((paused || picking) && !closed && !skip) await new Promise(r => setTimeout(r, 80)); };
  function tracks(list) {
    // list of [startMs, durMs, fn(k 0..1)]; all run together
    const total = Math.max(...list.map(t => t[0] + t[1]), 1);
    return new Promise(res => {
      if (skip || closed) { for (const t of list) t[2](1); return res(); }
      const t0 = performance.now();
      const tick = now => {
        const el = (now - t0) * speed;
        for (const t of list) { const k = (el - t[0]) / t[1]; if (k >= 0) t[2](Math.min(1, k)); }
        if (el >= total || skip || closed) { for (const t of list) t[2](1); res(); } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  const moveF = (k, to, dur, start = 0) => { const f = E.f[k]; if (!f) return [0, 1, () => { }]; const x0 = f.x, y0 = f.y; return [start, dur, t => { f.x = lerp(x0, to[0], ease(t)); f.y = lerp(y0, to[1], ease(t)); }]; };
  const throwBall = (from, to, start, dur, arc = 9) => [start, dur, t => { E.ball = { x: lerp(from[0], to[0], t), y: lerp(from[1], to[1], t), h: Math.sin(t * Math.PI) * arc + 4 }; }];
  const coverSpot = k => k === '1B' ? BASE[1] : k === 'C' ? [0, 0] : k === '3B' ? BASE[3] : k === 'P' ? SPOT.P : BASE[2];
  function runnerTrack(m, start, perBase = 3300) {
    const from = m.from, to = m.to === -1 ? (m.at || from + 1) : m.to;
    const n = Math.max(1, to - from), rp = P(L, m.id);
    perBase *= rp ? Math.min(1.28, Math.max(0.8, 1 + (55 - rp.bat.spd) * 0.0065)) : 1;   // fast guys get there quicker
    if (!E.runners.has(m.id)) E.runners.set(m.id, { x: BASE[from][0], y: BASE[from][1] });
    const r = E.runners.get(m.id);
    return [start, n * perBase, t => {
      const pos = from + t * n, i = Math.min(3, Math.floor(pos)), k = pos - i;
      const a = BASE[i], b = BASE[Math.min(4, i + 1)];
      r.x = lerp(a[0], b[0], k); r.y = lerp(a[1], b[1], k);
      if (t >= 1 && (m.to === 4 || m.to === -1)) E.runners.delete(m.id);
    }];
  }

  // ---------- panels ----------
  function call(text, cls = '', ms = 1300) { const el = $('gv-call'); el.textContent = text; el.className = 'gv-call on ' + cls; clearTimeout(call.t); call.t = setTimeout(() => el.classList.remove('on'), ms / Math.min(speed, 2.5)); }
  function bulbs(id, n) { [...$(id).children].forEach((b, i) => b.classList.toggle('on', i < n)); }
  function board() {
    $('gv-board').innerHTML = lineBoard({ a: aId, h: hId, score: g.score, line: g.line, hits: g.hits, errs: g.errs }, true);
    $('gv-inn').textContent = `${g.half ? 'Bot' : 'Top'} ${g.inning}${['st', 'nd', 'rd'][g.inning - 1] || 'th'}`;
    bulbs('gv-outs', Math.min(3, g.outs));
    ['gv-b1', 'gv-b2', 'gv-b3'].forEach((id, i) => $(id).classList.toggle('on', !!g.bases[i]));
    const hist = g.wpHist, n = hist.length;
    const pts = hist.map((v, i) => `${(i / Math.max(1, n - 1) * 200).toFixed(1)},${(54 - v * 54).toFixed(1)}`).join(' ');
    $('gv-wp').innerHTML = `<rect width="200" height="27" fill="${teams[1].c1}" opacity=".35"/><rect y="27" width="200" height="27" fill="${teams[0].c1}" opacity=".35"/><line x1="0" x2="200" y1="27" y2="27" stroke="#fff" stroke-opacity=".3"/><polyline points="${pts}" fill="none" stroke="#ffd24a" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="3" y="11" fill="#fff" font-size="9" font-weight="700">${teams[1].abbr} ${Math.round(hist[n - 1] * 100)}%</text><text x="3" y="50" fill="#fff" font-size="9" font-weight="700">${teams[0].abbr} ${Math.round((1 - hist[n - 1]) * 100)}%</text>`;
  }
  function cards() {
    const b = g.batter?.p, p = g.pitcher;
    if (p) { const l = g.pl(p), lim = staminaLimit(p), tired = l.NP + l.startFat * 0.7 - lim; const s = p.st.p || {}; $('gv-pit').innerHTML = `${face(p, 62)}<div><small>${teams[1 - g.half].abbr} · ${p.throws}HP · ${Math.round(p.ovr)} overall</small><b>${esc(pname(p))}</b><span>Today: ${ip(l.O)} IP, ${l.H} H, ${l.R} R, ${l.K} K<br><b style="display:inline;font:700 13px var(--body);color:${tired > 0 ? '#ff8a8a' : tired > -15 ? '#ffd24a' : '#9fe0b5'}">${l.NP} pitches${tired > 0 ? ' · tiring' : ''}</b> · ${s.O ? pit(s).era.toFixed(2) : '-.--'} ERA</span></div>`; }
    if (b) { const l = g.bl(b), s = b.st.b; const pos = g.batter.pos; $('gv-bat').innerHTML = `${face(b, 62)}<div><small>${teams[g.half].abbr} · ${pos} · bats ${b.bats} · ${Math.round(b.ovr)} overall</small><b>${esc(pname(b))}</b><span>Today: ${l.H}-for-${l.AB}${l.HR ? `, ${l.HR} HR` : ''}${l.RBI ? `, ${l.RBI} RBI` : ''}${l.BB ? `, ${l.BB} BB` : ''}<br>${s.AB ? f3(bat(s).avg) : '.---'} · ${s.HR} HR · ${s.RBI} RBI</span></div>`; }
  }
  function zoneClear() { $('gv-zone').innerHTML = `<rect x="-2" y="0.4" width="4" height="4.3" fill="#0f2d21"/><rect x="-0.83" y="${5 - 3.5}" width="1.66" height="2" fill="none" stroke="#f6e7b0" stroke-width="0.035"/><path d="M-0.83 ${5 - 2.83}H0.83M-0.83 ${5 - 2.17}H0.83M-0.28 1.5V3.5M0.28 1.5V3.5" stroke="#f6e7b0" stroke-opacity=".25" stroke-width="0.02"/><path d="M-0.71 4.45H0.71L0.71 4.55 0 4.66-0.71 4.55Z" fill="#fff" opacity=".8"/>`; $('gv-plist').innerHTML = ''; bulbs('gv-balls', 0); bulbs('gv-strikes', 0); $('gv-ptype').textContent = 'Pitch tracker'; $('gv-pv').textContent = ''; }
  function zoneAdd(pt, n, ms = 0) {
    const [lab, col] = RES[pt.r];
    // the ball flies in from the pitcher's hand (small, centred) to where it crossed the plate
    const anim = ms > 30 ? ` class="pz" style="--dx:${(-pt.x * 0.85).toFixed(2)}px;--dy:${(-(2.6 - pt.z) * 0.85 - 0.6).toFixed(2)}px;animation-duration:${Math.round(ms)}ms"` : '';
    $('gv-zone').insertAdjacentHTML('beforeend', `<g${anim}><circle cx="${pt.x}" cy="${5 - pt.z}" r="0.13" fill="${col}" stroke="#fff" stroke-width="0.02"/><text x="${pt.x}" y="${5 - pt.z + 0.055}" font-size="0.16" text-anchor="middle" fill="#fff" font-weight="700">${n}</text></g>`);
    $('gv-plist').insertAdjacentHTML('afterbegin', `<div><i style="background:${col}">${n}</i><span>${PITCH[pt.t] || pt.t} · ${lab}</span><b>${pt.v.toFixed(1)}</b></div>`);
    $('gv-ptype').textContent = PITCH[pt.t] || pt.t; $('gv-pv').textContent = pt.v.toFixed(1) + ' mph';
  }
  function countAfter(pt) {
    const b = pt.b + (pt.r === 'B' ? 1 : 0), s = Math.min(2, pt.s + (pt.r === 'C' || pt.r === 'S' || pt.r === 'F' ? 1 : 0));
    bulbs('gv-balls', Math.min(3, b)); bulbs('gv-strikes', s);
  }
  // crowd reaction: good for the batting team cheers if they are the home side, groans if not
  function react(half, good, level) {
    if (good) { if (half === 1) cheer(level); else { groan(level * 0.7); cheer(level * 0.25); } }
    else if (half === 0) cheer(level * 0.6); else groan(level * 0.5);
  }
  function log(text, cls = '') { $('gv-pbp').insertAdjacentHTML('afterbegin', `<div class="${cls}">${esc(text)}</div>`); }
  function desc(text) { $('gv-desc').textContent = text; }

  // ---------- manager ----------
  function mgr() {
    const el = $('gv-mgr');
    if (coach) { el.innerHTML = '<p style="grid-column:1/-1;margin:0;color:#aab6ca;font-size:13px">Your bench coach is making the moves. Untick the box above to take over.</p>'; return; }
    const batting = g.half === ui, tac = g.tactic[ui], s = g.sides[ui];
    const [r1, r2, r3] = g.bases;
    const b = (id, label, on, dis) => dis ? '' : `<button class="btn${on ? ' on' : ''}" data-m="${id}">${label}</button>`;
    if (batting) {
      const canSteal = (r1 && !r2) || (r2 && !r3 && !r1);
      el.innerHTML = b('ph', 'Pinch hit', false, !s.bench.some(p => !p.isP)) + b('pr', 'Pinch run', false, !(r1 || r2 || r3) || !s.bench.some(p => !p.isP))
        + b('steal', tac.steal ? 'Stealing!' : 'Steal', tac.steal, !canSteal) + b('bunt', tac.bunt ? 'Bunting' : 'Sacrifice bunt', tac.bunt, g.outs >= 2 || !(r1 || r2));
    } else {
      el.innerHTML = b('pc', 'Pitching change', false, !s.pen.length) + b('ibb', tac.ibb ? 'Walking him' : 'Intentional walk', tac.ibb, false)
        + b('in', tac.infieldIn ? 'Infield is in' : 'Infield in', tac.infieldIn, !r3 || g.outs >= 2) + b('ds', 'Defensive sub', false, !s.bench.some(p => !p.isP));
    }
    if (!el.innerHTML) el.innerHTML = '<p style="grid-column:1/-1;margin:0;color:#aab6ca;font-size:13px">No moves to make right now.</p>';
  }
  let pendingRes = null;
  function prompt(html) { if (skip || closed) return Promise.resolve(''); return new Promise(res => { picking = true; const d = document.createElement('div'); d.className = 'gv-prompt'; d.innerHTML = html; root.querySelector('.gv-field').appendChild(d); const done = v => { d.remove(); picking = false; pendingRes = null; res(v); }; pendingRes = () => done(''); d.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r); }); }); }
  const pickList = (title, text, list, row) => prompt(`<h3>${title}</h3><p>${text}</p><div class="pick">${list.map(p => `<button data-r="${p.id}">${face(p, 34)}<span><b>${esc(pname(p))}</b><br><small class="muted">${row(p)}</small></span>${ovr(p.ovr)}</button>`).join('')}</div><button class="btn" data-r="">Never mind</button>`);
  const penRow = p => { const s = p.st.p || {}; return `${p.throws}HP · ${p.id === g.sides[ui].roles?.cl ? 'closer' : (g.sides[ui].roles?.su || []).includes(p.id) ? 'setup' : p.role === 'SP' ? 'starter' : 'reliever'} · ${s.O ? pit(s).era.toFixed(2) + ' ERA' : 'no innings'} · ${p.fat >= 30 ? 'TIRED' : p.fat >= 12 ? 'used recently' : 'fresh'}`; };
  const batRowTxt = p => { const s = p.st.b; return `${p.pos} · bats ${p.bats} · ${s.AB ? f3(bat(s).avg) : '.---'}, ${s.HR} HR · speed ${Math.round(p.bat.spd)}`; };
  async function doPitchChange(text = 'Who do you want from the bullpen?') {
    const s = g.sides[ui]; const id = await pickList('Pitching change', text, [...s.pen].sort((a, b) => b.ovr - a.ovr), penRow);
    if (id) { const e = g.changePitcher(ui, +id); if (e) { log(e.desc, 'sub'); desc(e.desc); cards(); } }
    mgr();
  }
  root.querySelector('#gv-mgr').addEventListener('click', async e => {
    const btn = e.target.closest('[data-m]'); if (!btn || btn.disabled || picking) return;
    const s = g.sides[ui], m = btn.dataset.m;
    if (m === 'steal' || m === 'bunt' || m === 'ibb') { g.setTactic(ui, m, !g.tactic[ui][m]); return mgr(); }
    if (m === 'in') { g.setTactic(ui, 'infieldIn', !g.tactic[ui].infieldIn); return mgr(); }
    if (m === 'pc') return doPitchChange();
    if (m === 'ph') { const cur = g.batter.p; const id = await pickList('Pinch hitter', `Batting for ${esc(pname(cur))} against a ${g.pitcher.throws === 'L' ? 'left' : 'right'}-hander.`, s.bench.filter(p => !p.isP), batRowTxt); if (id) { const ev = g.pinchHit(ui, +id); if (ev) { log(ev.desc, 'sub'); desc(ev.desc); cards(); } } return mgr(); }
    if (m === 'pr') { const on = g.bases.map((r, i) => r ? i + 1 : 0).filter(Boolean); const base = on[on.length - 1]; const id = await pickList('Pinch runner', `Running for ${esc(g.bases[base - 1].p.last)} at ${['first', 'second', 'third'][base - 1]}.`, s.bench.filter(p => !p.isP).sort((a, b) => b.bat.spd - a.bat.spd), batRowTxt); if (id) { const ev = g.pinchRun(ui, base, +id); if (ev) { log(ev.desc, 'sub'); syncRunners(); } } return mgr(); }
    if (m === 'ds') { const slot = await prompt(`<h3>Defensive sub</h3><p>Who comes out?</p><div class="pick">${s.lineup.map((l, i) => l.pos === 'DH' ? '' : `<button data-r="${i}"><b>${l.pos}</b><span>${esc(pname(l.p))}</span><small class="muted">glove ${Math.round(s.def[l.pos]?.r || 0)}</small></button>`).join('')}</div><button class="btn" data-r="">Never mind</button>`); if (slot !== '') { const id = await pickList('Defensive sub', `Who plays ${s.lineup[+slot].pos}?`, s.bench.filter(p => !p.isP), p => `${p.pos} · plays ${(p.elig || [p.pos]).join(', ')} · glove ${Math.round(p.bat.def)}`); if (id) { const ev = g.defSub(ui, +slot, +id); if (ev) log(ev.desc, 'sub'); } } return mgr(); }
  });
  async function keyMoments() {
    if (coach || skip || g.over) return;
    const s = g.sides[ui];
    if (g.half !== ui) {
      const p = s.pitcher, l = g.pl(p), lim = staminaLimit(p), over = l.NP + l.startFat * 0.7 - lim, key = 'tired' + p.id;
      const lead = g.lead(ui);
      if (s.pen.length && over > 0 && (asked[key] ?? -9) < l.BF - 3) { asked[key] = l.BF; const r = await prompt(`<h3>${esc(p.last)} is running out of gas</h3><p>${l.NP} pitches, ${ip(l.O)} innings, ${l.R} runs allowed. Tired pitchers lose stuff and control.</p><div class="row"><button class="btn pri" data-r="y">Go to the bullpen</button><button class="btn" data-r="">Leave him in</button></div>`); if (r) await doPitchChange(); }
      else if (g._fresh && g.inning >= 9 && lead > 0 && lead <= 3 && s.roles?.cl && s.pen.some(x => x.id === s.roles.cl) && !asked['cl' + g.inning]) { asked['cl' + g.inning] = 1; const c = s.pen.find(x => x.id === s.roles.cl); const r = await prompt(`<h3>Save situation</h3><p>You lead by ${lead} in the ${g.inning}th. Bring in your closer, ${esc(pname(c))}?</p><div class="row"><button class="btn pri" data-r="y">Bring him in</button><button class="btn" data-r="">Stay with ${esc(p.last)}</button></div>`); if (r) { const e = g.changePitcher(ui, c.id); if (e) { log(e.desc, 'sub'); cards(); } } }
    } else {
      const b = g.batter.p, lead = g.lead(ui), k = 'ph' + g.inning + b.id;
      const val = x => (x.bat.con + x.bat.eye + x.bat.pow * 1.3 + x.bat.hit) / 4.3;
      const best = s.bench.filter(x => !x.isP).sort((x, y) => val(y) - val(x))[0];
      if (best && g.inning >= 7 && lead <= 0 && lead >= -3 && (g.bases[1] || g.bases[2]) && val(best) > val(b) + 7 && !asked[k] && (g.batter.pos !== 'C' || s.bench.some(x => (x.elig || []).includes('C')))) {
        asked[k] = 1; const r = await prompt(`<h3>Big spot</h3><p>${esc(pname(b))} is due with a runner in scoring position. ${esc(pname(best))} is on your bench.</p><div class="row"><button class="btn pri" data-r="y">Send up ${esc(best.last)}</button><button class="btn" data-r="">Let ${esc(b.last)} hit</button></div>`);
        if (r) { const e = g.pinchHit(ui, best.id); if (e) { log(e.desc, 'sub'); cards(); } }
      }
    }
  }

  // ---------- playing events ----------
  async function playPA(e) {
    const batter = P(L, e.batter), pitcher = P(L, e.pitcher);
    E.bat = { p: batter, lefty: batter.bats === 'L' || (batter.bats === 'S' && pitcher?.throws === 'R') };
    E.batter = true; E.ball = null; E.trail = []; E.swing = null;
    const fast = speed >= 5;
    if (!fast) { const s = batter.st.b, l = g.bl(batter); desc(`Now batting: ${pname(batter)} · ${l.AB ? `${l.H}-for-${l.AB} today` : `${s.AB ? f3(bat(s).avg) : '.---'}, ${s.HR} HR`}`); await sleep(650); }
    if (e.pitches) {
      for (let i = 0; i < e.pitches.length; i++) {
        const pt = e.pitches[i], last = i === e.pitches.length - 1, swing = pt.r === 'S' || pt.r === 'F' || pt.r === 'X';
        await hold();
        if (!fast || last) {
          // windup, then the pitch; the hitter offers at it late in the flight
          await tracks([[0, 260, t => { E.wind = t; }]]); E.wind = 0;
          zoneAdd(pt, i + 1, 430 / speed);
          await tracks([[0, 430, t => { E.ball = { x: lerp(0, pt.x * 1.2, t), y: lerp(58, 1, t), h: 5 + Math.sin(t * Math.PI) * 1.5 }; }], ...(swing ? [[300, 200, t => { E.swing = t; }]] : [])]);
          if (pt.r === 'F') crack(0.35); else if (pt.r !== 'X') pop(pt.r === 'C' || pt.r === 'S' ? 1 : 0.7);
        } else zoneAdd(pt, i + 1);
        countAfter(pt);
        if (!fast && pt.r !== 'X') desc(`${PITCH[pt.t] || pt.t}, ${Math.round(pt.v)} mph, ${spot(pt, E.bat.lefty ? 'L' : 'R')}: ${SAY[pt.r]}.`);
        if (pt.r !== 'X') { E.ball = null; if (!last) { await sleep(fast ? 60 : 560); E.swing = null; } }
      }
    }
    const res = e.res;
    if (res === 'K') { call(e.look ? 'STRIKE THREE CALLED' : 'STRIKEOUT', '', 1100); react(e.half, false, 0.45); }
    else if (res === 'BB' || res === 'IBB' || res === 'HBP') { call(res === 'HBP' ? 'HIT BY PITCH' : res === 'IBB' ? 'INTENTIONAL WALK' : 'WALK', '', 1000); react(e.half, true, 0.25); E.batter = false; await tracks(e.moves.filter(m => m.to !== -1).map(m => runnerTrack(m, 0, 1500))); }
    else if (e.bb) await playBall(e, batter);
    desc(e.desc); log(e.desc, e.scored.length ? 'sc' : '');
    if (e.scored.length && res !== 'HR') { call(e.scored.length === 1 ? 'RUN SCORES' : `${e.scored.length} RUNS SCORE`, '', 1200); react(e.half, true, 0.5 + e.scored.length * 0.25); }
    lastOn = e.bases.filter(Boolean).length;
    board(); syncRunners(); E.ball = null; E.batter = false; E.swing = null; resetFielders();
    await sleep(res === 'HR' ? 1600 : 950);
  }
  async function playBall(e, batter) {
    const bb = e.bb, hit = ['1B', '2B', '3B', 'HR'].includes(e.res);
    const land = polar(bb.dist || 120, bb.angle);
    const isGB = bb.type === 'GB' || bb.type === 'BU';
    const fl = isGB ? (bb.dist / 135) * 1000 + 250 : Math.max(900, (bb.hang || 3) * 620);
    const peak = isGB ? 1.5 : bb.type === 'LD' ? 14 : bb.type === 'PU' ? 95 : bb.hr ? 95 : 75;
    const who = bb.field || bb.fielder, f = E.f[who];
    crack(bb.hr ? 1.4 : bb.type === 'BU' ? 0.25 : bb.type === 'PU' ? 0.55 : bb.type === 'GB' ? 0.75 : 1);
    if (!isGB && bb.dist > 250) cheer(bb.hr ? 0.9 : 0.35);          // the crowd rises on anything deep
    E.swing = 1; await sleep(90); E.swing = null;
    E.batter = false; E.trail = [];
    const list = [[0, fl, t => { const x = lerp(0, land[0], t), y = lerp(0, land[1], t), h = isGB ? Math.abs(Math.sin(t * 9)) * peak * (1 - t) : Math.sin(t * Math.PI) * peak + 3; E.ball = { x, y, h }; if (!isGB && Math.random() < 0.5) E.trail.push([x, y, h]); }]];
    if (bb.hr) {
      call('HOME RUN!', 'hr', 2600);
      react(e.half, true, 1.6 + e.scored.length * 0.2);
      if (e.half === 1) { fireworks(e.scored.length >= 3 ? 9 : 5); setTimeout(() => organ('charge'), 900); }
      if (f) list.push(moveF(who, polar(fenceAt(park, bb.angle) - 6, bb.angle), fl * 0.9));
      for (const m of e.moves) list.push(runnerTrack(m, 300, 1500));
      await tracks(list); E.ball = null; return;
    }
    const outOnFly = !hit && !isGB && !bb.err;
    // the fielder goes after it
    let reach = fl;
    if (f) {
      const target = outOnFly || isGB && !hit ? land : [land[0] + (hit ? 0 : 0), land[1]];
      const d = Math.hypot(target[0] - f.x, target[1] - f.y);
      reach = outOnFly || (isGB && !hit) ? fl : Math.max(fl + 250, d / 27 * 1000);
      list.push(moveF(who, target, reach));
      if (hit) list.push([fl, Math.max(1, reach - fl), t => { E.ball = { x: land[0], y: land[1], h: 0 }; }]);
    }
    // the catch (or the pick-up) and every throw after it get a mitt pop
    const once = fn => { let done = false; return k => { if (k >= 1 && !done) { done = true; fn(); } }; };
    if (outOnFly || (isGB && !hit)) list.push([reach - 1, 1, once(() => pop(outOnFly ? 1 : 0.7))]);
    let t = reach + (hit ? 200 : 120), from = land;
    const seq = e.seq || (hit ? [who, bb.infield ? '1B' : e.moves.some(m => m.to === 4) ? 'C' : 'SS'] : [who]);
    for (let i = 1; i < seq.length; i++) {
      const to = coverSpot(seq[i]), d = Math.hypot(to[0] - from[0], to[1] - from[1]), dur = d / 125 * 1000 + 120;
      list.push(moveF(seq[i], to, Math.max(400, t - 100)));
      list.push(throwBall(from, to, t, dur, d > 180 ? 22 : 7));
      list.push([t + dur - 1, 1, once(() => pop(0.9))]);
      t += dur + 140; from = to;
    }
    // runners
    for (const m of e.moves) list.push(runnerTrack(m, isGB ? 120 : outOnFly ? fl + 60 : 200, m.from === 0 ? 3500 : 3300));
    await tracks(list);
    if (!hit && !bb.err) { call(e.res === 'DP' ? 'DOUBLE PLAY' : e.res === 'SF' ? 'SACRIFICE FLY' : 'OUT', '', 900); if (e.res === 'DP') react(e.half, false, 0.8); else if (e.outs === 3 && e.basesBefore?.some(Boolean)) react(e.half, false, 0.5); }
    else if (bb.err) { call('ERROR', '', 1100); react(e.half, true, 0.4); }
    else { call(e.res === '1B' ? 'BASE HIT' : e.res === '2B' ? 'DOUBLE' : 'TRIPLE', '', 1100); react(e.half, true, e.res === '1B' ? 0.45 : 0.8); }
  }
  // Key moments: anything that scores, extra-base hits, double plays, steals, and late,
  // close at-bats with men on base play at watching speed; routine at-bats fly by.
  function important(e) {
    if (e.type !== 'pa' && e.type !== 'steal' && e.type !== 'wp') return true;
    if (e.scored?.length || e.type === 'steal' || ['HR', '2B', '3B', 'DP', 'E'].includes(e.res)) return true;
    const late = e.inning >= 7 && Math.abs(e.score[0] - e.score[1]) <= 2;
    return late && (e.basesBefore || []).some(Boolean);
  }
  async function playEvent(e) {
    if (mode === 'key') speed = important(e) ? 1.35 : 7; else speed = MODES[mode];
    if (e.half !== undefined) E.half = e.half;
    if (e.type === 'start') { log(e.desc); desc(e.desc); cheer(0.7); organ('charge'); halfHits = [...g.hits]; return; }
    if (e.type === 'half') {
      // recap the half-inning that just ended, then who is due up
      const prevHalf = 1 - e.half, prevInn = e.half === 1 ? e.inning : e.inning - 1;
      if (prevInn >= 1) {
        const runs = g.line[prevHalf][prevInn - 1] || 0, hits = g.hits[prevHalf] - halfHits[prevHalf];
        const recap = `End of the ${prevHalf ? 'bottom' : 'top'} of the ${ORDN(prevInn)}: ${runs} run${runs === 1 ? '' : 's'}, ${hits} hit${hits === 1 ? '' : 's'}${lastOn ? `, ${lastOn} left on` : ''}. ${teams[0].abbr} ${g.score[0]}, ${teams[1].abbr} ${g.score[1]}.`;
        log(recap, 'sub'); desc(recap);
      }
      halfHits = [...g.hits]; lastOn = 0;
      log(e.desc, 'h'); resetFielders(); syncRunners(); board(); zoneClear(); cards(); mgr();
      const s = g.batSide, due = [0, 1, 2].map(k => s.lineup[(s.idx + k) % 9].p.last);
      call(e.desc, '', 1300);
      if (e.half === 1 && e.inning === 7) organ('stretch'); else if (e.half === 1) organ('walkup');
      await sleep(1100); desc(`Due up for the ${teams[e.half].nick}: ${due.join(', ')}.`); await sleep(1000);
      return;
    }
    if (e.type === 'sub') { log(e.desc, 'sub'); desc(e.desc); cards(); await sleep(900); return; }
    if (e.type === 'steal') {
      const m = e.moves[0] || { id: e.runner, from: e.base - 1, to: e.ok ? e.base : -1, at: e.base };
      const target = e.base === 2 ? BASE[2] : BASE[3];
      await tracks([[0, 420, t => { E.ball = { x: 0, y: lerp(58, 1, t), h: 5 }; }], throwBall([0, 0], target, 520, 950, 10), moveF(e.base === 2 ? 'SS' : '3B', target, 900), runnerTrack(m, 0, 1700)]);
      call(e.ok ? 'SAFE! STOLEN BASE' : 'CAUGHT STEALING', '', 1200); react(e.half, e.ok, 0.55); lastOn = e.bases.filter(Boolean).length;
      log(e.desc, ''); desc(e.desc); board(); syncRunners(); E.ball = null; resetFielders(); mgr(); await sleep(800); return;
    }
    if (e.type === 'wp') { await tracks([[0, 500, t => { E.ball = { x: lerp(0, 9, t), y: lerp(58, -28, t), h: 3 }; }], ...e.moves.map(m => runnerTrack(m, 200, 1700))]); call('WILD PITCH', '', 1000); log(e.desc, e.scored.length ? 'sc' : ''); desc(e.desc); board(); syncRunners(); E.ball = null; await sleep(600); return; }
    if (e.type === 'pa') return playPA(e);
    if (e.type === 'final') { log(e.desc, 'h'); desc(e.desc); board(); if (g.winner === 1) { cheer(2); fireworks(10); organ('charge'); } else groan(1.2); await sleep(1800); }
  }

  // ---------- main loop ----------
  async function run() {
    resetFielders(); board(); zoneClear(); cards(); mgr();
    while (!g.over && !closed) {
      await hold();
      if (skip) break;
      await keyMoments();
      if (g.outs < 3) { zoneClear(); cards(); mgr(); }
      const evs = g.step();
      for (const e of evs) { if (closed) return; await playEvent(e); if (skip) break; }
    }
    if (closed) return;
    if (!g.over) { for (const s of g.sides) s.manual = false; g.detail = false; g.play(); board(); }
    finish();
  }
  function finish() {
    const won = g.winner === ui;
    // book the result, then let the rest of the league play its day
    if (ser) { playoffGameResult(L, ser, g, hId); ser.played = L.poDay; T(L, hId).rotI++; T(L, aId).rotI++; }
    else finishGame(L, sg, g);
    const box = L.lastBox || slimBox(L, g, { h: hId, a: aId });
    advanceDay(L);
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;inset:0;background:rgba(5,8,13,.95);overflow:auto;padding:26px 4vw;z-index:5';
    d.innerHTML = `<h1 style="font-size:72px;color:var(--gold);margin-bottom:6px">${won ? 'You win' : 'You lose'}, ${g.score[ui]}–${g.score[1 - ui]}</h1><p style="margin:0 0 16px;color:#aab6ca">${esc(g.log.at(-1)?.desc || '')}</p><div style="max-width:780px;margin-bottom:16px">${lineBoard(box)}</div><button class="btn pri big" id="gv-done" style="margin-bottom:18px">Back to the clubhouse</button>${boxTables(box)}`;
    root.appendChild(d);
    d.querySelector('#gv-done').addEventListener('click', close);
  }
  function close() { closed = true; parkOff(); window.removeEventListener('resize', resize); root.remove(); onDone(); }

  // ---------- controls ----------
  $('gv-speed').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; if (mode !== 'key') speed = MODES[mode]; [...$('gv-speed').children].forEach(x => x.classList.toggle('on', x === b)); });
  $('gv-snd').addEventListener('click', () => { const m = !muted(); setMuted(m); parkMute(m); $('gv-snd').textContent = m ? 'Sound off' : 'Sound on'; });
  $('gv-pause').addEventListener('click', () => { paused = !paused; $('gv-pause').textContent = paused ? 'Resume' : 'Pause'; });
  $('gv-skip').addEventListener('click', () => { skip = true; if (pendingRes) pendingRes(); });
  $('gv-coach').addEventListener('change', e => { coach = e.target.checked; g.sides[ui].manual = !coach; mgr(); });
  window.addEventListener('resize', resize);
  resize(); syncRunners(); requestAnimationFrame(frame);
  parkOn();
  run();
}
