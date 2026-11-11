// Ratings <-> on-field rates. Shared by the data builder (Node) and the game (browser).
// Every rating is on a 20-99 scale where 50 = MLB average. A rating maps to a real
// per-plate-appearance rate through  rate = leagueRate * exp(S * (rating-50)/25).

export const LG = {
  k: 0.2214, bb: 0.0859, hbp: 0.0115, hr: 0.0303, babip: 0.2896,
  dbl: 0.2186, tpl: 0.0196,        // share of non-HR hits
  sbAtt: 0.88, sbPct: 0.77,        // per team-game, success
  wp: 0.0077, err: 0.0145, rpg: 4.48,
};

// sensitivity of each rate to its rating
export const S = {
  con: -0.45, eye: 0.45, pow: 0.50, hit: 0.10,     // batter: K, BB, HR, BABIP
  stf: 0.32, ctl: -0.42, mov: -0.30,               // pitcher: K, BB, HR
};

export const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const FIELD_POS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
// how hard a position is to play (higher = harder) and its run value over a season
export const POS_DIFF = { C: 8, SS: 7, CF: 6.5, '2B': 6, '3B': 5.5, RF: 4.5, LF: 4, '1B': 2, DH: 0, P: 0 };
export const POS_RUNS = { C: 9, SS: 7, CF: 2.5, '2B': 2.5, '3B': 2.5, RF: -5.5, LF: -6.5, '1B': -9.5, DH: -14 };

export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const rate = (lg, s, r) => lg * Math.exp(s * (r - 50) / 25);
export const ratingFor = (lg, s, rt) => 50 + 25 * Math.log(Math.max(rt, 1e-5) / lg) / s;

// Raw (vs league-average opponent) rates for a batter's ratings.
export function batRates(b) {
  const k = rate(LG.k, S.con, b.con);
  const bb = rate(LG.bb, S.eye, b.eye);
  const hr = rate(LG.hr, S.pow, b.pow);
  const babip = rate(LG.babip, S.hit, b.hit);
  return { k, bb, hbp: LG.hbp, hr, babip };
}
export function pitRates(p) {
  const k = rate(LG.k, S.stf, p.stf);
  const bb = rate(LG.bb, S.ctl, p.ctl);
  const hr = rate(LG.hr, S.mov, p.mov);
  return { k, bb, hbp: LG.hbp * Math.exp(-0.25 * (p.ctl - 50) / 25), hr, babip: LG.babip * (1 - 0.0006 * (p.stf - 50)) };
}

// share of balls-in-play hits that go for extra bases
export function xbhShares(pow, spd) {
  const dbl = clamp(LG.dbl * Math.exp(0.22 * (pow - 50) / 25) * (1 + 0.0015 * (spd - 50)), 0.10, 0.36);
  const tpl = clamp(LG.tpl * Math.exp(0.95 * (spd - 50) / 25), 0.002, 0.07);
  return { dbl, tpl };
}

const W = { bb: 0.69, hbp: 0.72, s: 0.88, d: 1.25, t: 1.58, hr: 2.03 };
export function wobaFromRates(r, pow = 50, spd = 50) {
  const bip = Math.max(0, 1 - r.k - r.bb - r.hbp - r.hr);
  const hits = bip * r.babip;
  const { dbl, tpl } = xbhShares(pow, spd);
  return r.bb * W.bb + r.hbp * W.hbp + r.hr * W.hr + hits * ((1 - dbl - tpl) * W.s + dbl * W.d + tpl * W.t);
}
export const LG_WOBA = wobaFromRates({ k: LG.k, bb: LG.bb, hbp: LG.hbp, hr: LG.hr, babip: LG.babip });

// Defensive ability at a given position (0-99), from the player's base glove, the
// position's difficulty and whether he has actually played there.
export function defAt(p, pos) {
  if (pos === 'DH') return 50;
  const b = p.bat;
  if (!b) return 20;
  const elig = p.elig || [p.pos];
  if (pos === p.pos) return b.def;
  const from = POS_DIFF[p.pos] ?? 0, to = POS_DIFF[pos] ?? 0;
  if (pos === 'C') return elig.includes('C') ? b.def - 6 : Math.max(10, b.def - 45);
  let pen = Math.max(0, to - from) * 4.5;
  if (!elig.includes(pos)) {
    pen += 9;
    const ofFrom = ['LF', 'CF', 'RF'].includes(p.pos), ofTo = ['LF', 'CF', 'RF'].includes(pos);
    if (ofFrom !== ofTo && pos !== '1B') pen += 8;      // infielder <-> outfielder is a real switch
  } else pen *= 0.45;
  if (to < from) pen -= (from - to) * 1.6;              // easier spot: glove plays up
  return clamp(Math.round(b.def - pen), 10, 99);
}

// Runs above average over a full season for a hitter at a position.
export function batRAA(p, pos = p.pos) {
  const b = p.bat;
  const w = wobaFromRates(batRates(b), b.pow, b.spd);
  const off = (w - LG_WOBA) / 1.2 * 650;
  const run = (b.spd - 50) * 0.09;
  const fpos = pos === 'P' || pos === 'TWP' ? 'DH' : pos;
  const d = fpos === 'DH' ? 0 : (defAt(p, fpos) - 50) * (fpos === 'C' ? 0.30 : fpos === '1B' ? 0.18 : 0.34) + (b.arm - 50) * 0.04;
  return off + run + d + (POS_RUNS[fpos] ?? -8);
}
export function pitRAA(p) {
  const t = p.pit;
  const w = wobaFromRates(pitRates(t));
  if (p.role === 'SP' || t.sta >= 55) {
    const bf = 560 + (t.sta - 50) * 6.5;                // durable starters are worth more
    return (LG_WOBA - w) / 1.2 * bf;
  }
  return (LG_WOBA - w) / 1.2 * 520 - 4;                 // leverage-weighted relief innings
}
const curve = raa => {
  const o = 72 + raa * 0.5;
  return o > 88 ? 88 + (o - 88) * 0.7 : o;             // squeeze the very top so 99 is rare
};
export const ovrBat = (p, pos) => clamp(Math.round(curve(batRAA(p, pos))), 30, 99);
export const ovrPit = p => clamp(Math.round(curve(pitRAA(p) * 1.3)), 30, 99);
export function calcOvr(p) {
  if (p.isP && p.pit) {
    const o = ovrPit(p);
    return p.twoWay && p.bat ? Math.min(99, Math.max(o, ovrBat(p, 'DH')) + 5) : o;
  }
  return ovrBat(p, p.pos);
}

// 20-80 style letter grade used around the UI
export function grade(r) {
  return r >= 90 ? 'A+' : r >= 82 ? 'A' : r >= 74 ? 'B+' : r >= 66 ? 'B' : r >= 58 ? 'C+' : r >= 50 ? 'C' : r >= 42 ? 'D+' : r >= 34 ? 'D' : 'F';
}
