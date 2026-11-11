// The owner, day by day. Job security moves with the club's pace against his goal, he
// reacts to streaks, opens his wallet for a contender at the deadline, and if things
// collapse he hands down an ultimatum: win enough of the next stretch or you are gone.
import { T, news, inbox, playoffField } from './league.js';
import { pop, unlock, ensureState } from './legacy.js';
import { tradeDeadlineDay } from './trade.js';
import { clamp } from './ratings.js';
import { fmtDate } from './schedule.js';

// how far ahead of (or behind) the owner's target pace the club is, in confidence points
const pace = (L, t) => { const gp = t.w + t.l; return gp ? (t.w - t.goalW * gp / L.games) / L.games * 220 : 0; };
export function liveMood(L, t) { return clamp(Math.round((t.mood0 ?? t.ownerMood) + pace(L, t) + (t.moodAdj || 0)), 0, 100); }
export const ultSize = L => Math.max(8, Math.round(L.games * 0.09));

export function ownerSeasonStart(L) {
  for (const t of L.teams) { t.mood0 = t.ownerMood; t.moodAdj = 0; t.ult = null; t.ultDone = 0; t.warned = 0; t.bump = 0; t.bumpDone = 0; t.lastStrk = 0; t.fills = []; }
}
function init(L) {
  for (const t of L.teams) if (t.mood0 === undefined) { t.moodAdj = t.moodAdj || 0; t.mood0 = t.ownerMood - pace(L, t) - t.moodAdj; t.fills ??= []; }
}

// After every regular-season day.
export function ownerDay(L) {
  ensureState(L); init(L);
  for (const t of L.teams) t.ownerMood = liveMood(L, t);
  if (L.fired) return;
  const t = T(L, L.userTid), gp = t.w + t.l;
  if (!gp) return;
  if (t.w >= 1) unlock(L, 'win1');
  if (t.strk >= 10) unlock(L, 'streak10');
  const say = (title, text, stop = false, extra = {}) => pop(L, { k: 'owner', kick: 'From the owner', title, text, tid: t.id, stop, ...extra });
  // streaks: once each time one is reached
  if (t.strk !== t.lastStrk) {
    if (t.strk === 7) { t.moodAdj = (t.moodAdj || 0) + 2; say('Keep it rolling', `Seven straight. The phones are ringing in the ticket office and I like the sound of it.`); }
    if (t.strk === -7) { t.moodAdj = (t.moodAdj || 0) - 3; say('This has to stop', `Seven losses in a row. I do not pay for this. Fix it.`, true); }
    t.lastStrk = t.strk;
  }
  t.ownerMood = liveMood(L, t);
  const mood = t.ownerMood;
  // the deadline: a contender gets money to add, everyone else gets the owner's blessing to sell
  const dl = tradeDeadlineDay(L);
  if (!t.bumpDone && L.day >= dl - 12 && L.day <= dl) {
    t.bumpDone = 1;
    const field = playoffField(L, t.lg), cut = field[5];
    const gb = field.includes(t) ? 0 : ((cut.w - t.w) + (t.l - cut.l)) / 2;
    if (gb <= 3 && mood >= 40) {
      const bump = Math.max(4, Math.round(t.budget * 0.06));
      t.budget += bump; t.bump = bump;
      inbox(L, `The owner adds $${bump}M to your budget for deadline moves this season.`, 'big');
      say('Go get someone', `We are in this race. I am adding $${bump}M to this year's budget. Spend it before the deadline on ${fmtDate(L.season, dl)}.`, true, { acts: [['Trade center', 'go', { v: 'trades' }]] });
    } else if (gb >= 8) say('About the deadline', `We are ${gb} games out of a playoff spot. If moving veterans for young talent makes us better next year, you have my blessing.`, false, { acts: [['Trade center', 'go', { v: 'trades' }]] });
  }
  // hot seat, then an ultimatum
  if (!t.warned && mood < 35 && gp >= L.games * 0.15) {
    t.warned = 1;
    say('You are on the hot seat', `Confidence in you is down to ${mood}%. The goal was "${t.goal}". I want to see a turnaround, soon.`, true);
  }
  if (!t.ult && !t.ultDone && mood < 20 && gp >= L.games * 0.3 && gp <= L.games - ultSize(L)) {
    const n = ultSize(L), need = Math.ceil(n / 2);
    t.ult = { gp0: gp, w0: t.w, n, need };
    inbox(L, `Ultimatum from the owner: win ${need} of the next ${n} games or you are fired.`, 'big');
    say('Win, or you are done', `I have seen enough. Win ${need} of the next ${n} games or I find a new general manager.`, true, { k: 'ult' });
  }
  if (t.ult && gp - t.ult.gp0 >= t.ult.n) settleUltimatum(L, t);
}
export function ultStatus(L, t) {
  if (!t.ult) return null;
  const played = t.w + t.l - t.ult.gp0, won = t.w - t.ult.w0;
  return { ...t.ult, played, won, left: t.ult.n - played };
}
function settleUltimatum(L, t, end = false) {
  const u = ultStatus(L, t);
  t.ult = null; t.ultDone = 1;
  const ok = end ? u.won >= u.need * (u.played / u.n) - 0.01 : u.won >= u.need;
  if (ok) {
    t.moodAdj = (t.moodAdj || 0) + 10; t.ownerMood = liveMood(L, t);
    unlock(L, 'survivor');
    pop(L, { k: 'owner', kick: 'From the owner', title: 'You live to fight another day', text: `${u.won} wins in ${u.played} games. That is what I asked for. Do not make me ask again.`, tid: t.id, stop: true });
  } else fire(L, `${u.won} wins in ${u.played} games. You needed ${u.need}.`);
}
export function fire(L, why) {
  const t = T(L, L.userTid);
  L.fired = 1; L.gmc.fired = (L.gmc.fired || 0) + 1;
  news(L, `The ${t.name} have fired their general manager.`, 'big', t.id);
  inbox(L, `You have been fired by the ${t.name}. ${why}`, 'big');
  pop(L, { k: 'fired', kick: 'From the owner', title: 'You are fired', text: `${why} Clean out your office. Other clubs are hiring.`, tid: t.id, stop: true });
}

// End of the season: the final verdict uses the same formula the season has shown all year.
export function ownerSeasonEnd(L, champ) {
  init(L);
  const ut = T(L, L.userTid);
  if (ut.ult && !L.fired) settleUltimatum(L, ut, true);
  for (const t of L.teams) {
    const delta = (t.po ? 8 + (t.po - 1) * 7 : 0) + (t.id === champ ? 20 : 0);
    t.ownerMood = clamp(liveMood(L, t) + delta, 0, 100);
  }
}
export const crowd = t => t.fills?.length ? Math.round(t.fills.reduce((s, x) => s + x, 0) / t.fills.length) : null;
