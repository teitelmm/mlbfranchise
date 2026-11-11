// Long-run balance check: sims N years on autopilot and prints how the league's talent,
// scoring and money drift. Run: node tests/evolve.mjs 10
import { readFile } from 'node:fs/promises';
import { newCareer, T, P, active, payroll, name } from '../js/engine/league.js';
import { advanceDay, freeAgents } from '../js/engine/season.js';

const data = JSON.parse(await readFile(new URL('../data/league.json', import.meta.url), 'utf8'));
const YEARS = +(process.argv[2] || 8);
const L = newCareer(data, { userTid: 134, games: 162, seed: +(process.argv[3] || 5) });
L.opts.autoRoster = true; L.opts.autoDraft = true;
const snap = () => {
  const act = L.players.filter(p => p.lvl === 'MLB' && p.tid >= 0);
  const o = act.map(p => p.ovr).sort((a, b) => a - b), q = f => o[Math.floor(o.length * f)];
  const age = act.reduce((a, p) => a + p.age, 0) / act.length;
  return `ovr p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${o.at(-1)} | 85+ ${o.filter(x => x >= 85).length} 90+ ${o.filter(x => x >= 90).length} | age ${age.toFixed(1)} | gen ${act.filter(p => p.gen).length}`;
};
console.log('start  ', snap(), '| pay', Math.round(L.teams.reduce((a, t) => a + payroll(L, t.id), 0)));
for (let y = 0; y < YEARS; y++) {
  const season = L.season; let line = '';
  let g = 0;
  while (L.season === season && g++ < 400) {
    if (L.phase === 'regular' && L.day === L.sched.length - 1) {
      const s = {}; for (const p of L.players) for (const k in p.st.b) s[k] = (s[k] || 0) + p.st.b[k];
      const G = L.teams.reduce((a, x) => a + x.w, 0) || 1;
      const hr = [...L.players].sort((a, b) => b.st.b.HR - a.st.b.HR)[0];
      const ws = L.teams.map(t => t.w).sort((a, b) => b - a);
      line = `R/G ${(s.R / G / 2).toFixed(2)} AVG ${(s.H / s.AB).toFixed(3)} HR/G ${(s.HR / G / 2).toFixed(2)} K% ${(s.K / s.PA).toFixed(3)} BB% ${(s.BB / s.PA).toFixed(3)} 2B ${(s.D / G / 2).toFixed(2)} SB ${(s.SB / G / 2).toFixed(2)} | HR ldr ${hr.st.b.HR} | W ${ws[0]}-${ws.at(-1)}`;
    }
    const r = advanceDay(L);
    if (r.blocked) { console.log('BLOCKED', r.blocked); process.exit(1); }
  }
  const h = L.hist.at(-1), pays = L.teams.map(t => payroll(L, t.id));
  console.log(season, snap(), '|', line, `| champ ${T(L, h.champ).abbr} | pay tot ${Math.round(pays.reduce((a, b) => a + b, 0))} max ${Math.round(Math.max(...pays))} min ${Math.round(Math.min(...pays))} | n ${L.players.length} FA ${freeAgents(L).length} (75+: ${freeAgents(L).filter(p => p.ovr >= 75).length}) | budgets ${Math.min(...L.teams.map(t => t.budget))}-${Math.max(...L.teams.map(t => t.budget))} cbt ${L.cbt}`);
}
const best = L.players.filter(p => p.tid >= 0).sort((a, b) => b.ovr - a.ovr).slice(0, 8).map(p => `${name(p)} ${p.age} ${p.ovr}${p.gen ? '*' : ''}`);
console.log('best now:', best.join(' | '));
const titles = L.teams.filter(t => t.titles).map(t => `${t.abbr} ${t.titles}`); console.log('titles:', titles.join(' '));
