// Derived statistics for display, leaderboards and awards.
import { POS_RUNS } from './ratings.js';

export const f3 = x => (isFinite(x) ? x : 0).toFixed(3).replace(/^0/, '');
export const ip = outs => `${Math.floor(outs / 3)}.${outs % 3}`;

export function bat(s) {
  const AB = s.AB || 0, PA = s.PA || 0, H = s.H || 0;
  const s1 = H - (s.D || 0) - (s.T || 0) - (s.HR || 0);
  const avg = AB ? H / AB : 0;
  const obpD = AB + (s.BB || 0) + (s.HBP || 0) + (s.SF || 0);
  const obp = obpD ? (H + (s.BB || 0) + (s.HBP || 0)) / obpD : 0;
  const slg = AB ? (s1 + 2 * (s.D || 0) + 3 * (s.T || 0) + 4 * (s.HR || 0)) / AB : 0;
  const woba = PA ? (0.69 * (s.BB || 0) + 0.72 * (s.HBP || 0) + 0.88 * s1 + 1.25 * (s.D || 0) + 1.58 * (s.T || 0) + 2.03 * (s.HR || 0)) / PA : 0;
  return { avg, obp, slg, ops: obp + slg, woba };
}
export function pit(s) {
  const O = s.O || 0, IP = O / 3;
  return {
    era: O ? (s.ER || 0) * 27 / O : 0, whip: O ? ((s.BB || 0) + (s.H || 0)) / IP : 0,
    k9: O ? (s.K || 0) * 27 / O : 0, bb9: O ? (s.BB || 0) * 27 / O : 0, hr9: O ? (s.HR || 0) * 27 / O : 0, ip: IP,
  };
}
export function batWAR(p, s = p.st.b) {
  if (!s || !s.PA) return 0;
  const { woba } = bat(s), share = s.PA / 650;
  const pos = p.isP ? 'DH' : p.pos;
  const raa = (woba - 0.313) / 1.2 * s.PA + (s.SB || 0) * 0.2 - (s.CS || 0) * 0.42
    + ((POS_RUNS[pos] ?? -8) + (pos === 'DH' ? 0 : (p.bat.def - 50) * 0.3)) * share;
  return (raa + 20 * share) / 9.5;
}
export function pitWAR(p, s = p.st.p) {
  if (!s || !s.O) return 0;
  const IP = s.O / 3, ra9 = (s.R || 0) * 9 / IP;
  // blend runs allowed with strikeouts/walks/homers so one lucky month is not an MVP season
  const fip = ((13 * (s.HR || 0) + 3 * (s.BB || 0) - 2 * (s.K || 0)) / IP) + 3.2;
  const val = 0.5 * ra9 + 0.5 * (fip + 0.35);
  const lev = s.GS ? 1 : 1.5;
  return ((4.62 - val) / 9 * IP * lev + IP * 0.105) / 9.5;
}
export const war = p => (p.isP ? pitWAR(p) : 0) + (!p.isP || p.twoWay ? batWAR(p) : 0);
