// Builds a season schedule of 3-game series. Every team plays every round.
// gamesPerTeam must be a multiple of 3 (162, 81, 54).
const DIVS = [['AL', 'East'], ['AL', 'Central'], ['AL', 'West'], ['NL', 'East'], ['NL', 'Central'], ['NL', 'West']];

export function buildSchedule(teams, gamesPerTeam, rng) {
  const rounds = [];
  const total = gamesPerTeam / 3;
  const divCycles = gamesPerTeam >= 162 ? 5 : gamesPerTeam >= 81 ? 2 : 1;
  const ids = teams.map(t => t.id);
  // division round-robins (5 teams: 5 rounds, one team idle each round; idle teams play each other)
  const divTeams = DIVS.map(([lg, div]) => rng.shuffle(teams.filter(t => t.lg === lg && t.div === div).map(t => t.id)));
  for (let c = 0; c < divCycles; c++) {
    for (let r = 0; r < 5; r++) {
      const pairs = [], idle = [];
      for (const d of divTeams) {
        const a = [...d.slice(r), ...d.slice(0, r)];           // rotate; a[0] sits out
        idle.push(a[0]); pairs.push([a[1], a[4]], [a[2], a[3]]);
      }
      rng.shuffle(idle);
      for (let i = 0; i < 6; i += 2) pairs.push([idle[i], idle[i + 1]]);
      rounds.push(pairs);
    }
  }
  // league-wide circle method for the rest
  const circ = rng.shuffle([...ids]);
  const all = [];
  for (let r = 0; r < 29; r++) {
    const pairs = [];
    const arr = [circ[0], ...circ.slice(1 + r), ...circ.slice(1, 1 + r)];
    for (let i = 0; i < 15; i++) pairs.push([arr[i], arr[29 - i]]);
    all.push(pairs);
  }
  rng.shuffle(all);
  let k = 0;
  while (rounds.length < total) rounds.push(all[k++ % all.length]);
  rng.shuffle(rounds);
  // home/away balance
  const homeCount = new Map(ids.map(i => [i, 0]));
  const last = new Map();
  const series = rounds.map(pairs => pairs.map(([a, b]) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let home;
    const ha = homeCount.get(a), hb = homeCount.get(b);
    if (last.has(key) && Math.abs(ha - hb) <= 1) home = last.get(key) === a ? b : a;
    else home = ha < hb ? a : hb < ha ? b : (rng.chance(0.5) ? a : b);
    last.set(key, home); homeCount.set(home, homeCount.get(home) + 1);
    return home === a ? [a, b] : [b, a];
  }));
  // lay the series onto calendar days with off days and an All-Star break
  const days = [];
  const mid = Math.floor(series.length / 2);
  series.forEach((ser, i) => {
    if (i === mid) { for (let j = 0; j < 4; j++) days.push({ g: [], asb: j === 1 }); }
    for (let g = 0; g < 3; g++) days.push({ g: ser.map(([h, a]) => ({ h, a })) });
    if (i !== mid - 1 && i < series.length - 1 && rng.chance(0.42)) days.push({ g: [] });
  });
  return days;
}

export function dateOf(season, day) {
  const d = new Date(Date.UTC(season, 2, 26 + day));
  return d;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(season, day, withDow = false) {
  const d = dateOf(season, day);
  return `${withDow ? DOW[d.getUTCDay()] + ', ' : ''}${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
