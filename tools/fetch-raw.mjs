// Downloads raw real-world data into tools/cache/. Run: node tools/fetch-raw.mjs
// Sources: MLB Stats API (statsapi.mlb.com) and Baseball Savant CSV leaderboards.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const API = 'https://statsapi.mlb.com/api/v1';
const SEASON = 2026;
const MLB_DATE = '2026-09-27';
const MILB_DATE = '2026-09-10';
const FORCE = process.argv.includes('--force');

await mkdir(CACHE, { recursive: true });

async function exists(f) { try { await access(f); return true; } catch { return false; } }

async function get(url, asText = false, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (ballclub data build)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return asText ? await r.text() : await r.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url} -> ${e.message}`);
      await new Promise(res => setTimeout(res, 600 * (i + 1)));
    }
  }
}

async function cached(name, fn) {
  const f = path.join(CACHE, name);
  if (!FORCE && await exists(f)) return name.endsWith('.json') ? JSON.parse(await readFile(f, 'utf8')) : await readFile(f, 'utf8');
  const v = await fn();
  await writeFile(f, typeof v === 'string' ? v : JSON.stringify(v));
  console.log('fetched', name);
  return v;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---- teams ----
const teams = await cached('teams.json', async () =>
  (await get(`${API}/teams?sportId=1&season=${SEASON}&hydrate=venue(fieldInfo,location)`)).teams);

// ---- last season's standings and playoff series ----
await cached('standings.json', async () => (await get(`${API}/standings?leagueId=103,104&season=${SEASON}&standingsTypes=regularSeason`)).records
  .flatMap(r => r.teamRecords.map(x => ({ id: x.team.id, w: x.wins, l: x.losses, div: +x.divisionRank, rd: x.runDifferential, wc: x.wildCardRank ? +x.wildCardRank : 0 }))));
await cached('postseason.json', async () => (await get(`${API}/schedule/postseason/series?season=${SEASON}&sportId=1`)).series
  .map(s => ({ type: s.series.gameType, games: s.games.filter(g => g.status?.abstractGameState === 'Final').map(g => ({ a: g.teams.away.team.id, h: g.teams.home.team.id, aw: !!g.teams.away.isWinner })) })));

// ---- rosters ----
const rosters = await cached('rosters.json', async () => {
  const out = {};
  await pool(teams, 6, async t => {
    const [active, forty, aff] = await Promise.all([
      get(`${API}/teams/${t.id}/roster?rosterType=active&date=${MLB_DATE}`),
      get(`${API}/teams/${t.id}/roster?rosterType=40Man&date=${MLB_DATE}`),
      get(`${API}/teams/affiliates?teamIds=${t.id}&season=${SEASON}`),
    ]);
    const aaa = aff.teams.find(x => x.sport?.id === 11);
    const aa = aff.teams.find(x => x.sport?.id === 12);
    const [aaaR, aaR] = await Promise.all([
      aaa ? get(`${API}/teams/${aaa.id}/roster?rosterType=active&date=${MILB_DATE}`) : { roster: [] },
      aa ? get(`${API}/teams/${aa.id}/roster?rosterType=active&date=${MILB_DATE}`) : { roster: [] },
    ]);
    const slim = r => (r.roster || []).map(x => ({
      id: x.person.id, name: x.person.fullName, num: x.jerseyNumber || '',
      pos: x.position?.abbreviation || '', status: x.status?.code || 'A',
    }));
    out[t.id] = {
      active: slim(active), forty: slim(forty),
      aaa: { id: aaa?.id, name: aaa?.name, roster: slim(aaaR) },
      aa: { id: aa?.id, name: aa?.name, roster: slim(aaR) },
    };
  });
  return out;
});

// ---- people ----
const ids = new Set();
for (const r of Object.values(rosters)) {
  for (const list of [r.active, r.forty, r.aaa.roster, r.aa.roster]) for (const p of list) ids.add(p.id);
}
const idList = [...ids];
console.log('players:', idList.length);
await cached('people.json', async () => {
  const chunks = [];
  for (let i = 0; i < idList.length; i += 120) chunks.push(idList.slice(i, i + 120));
  const res = await pool(chunks, 5, c => get(`${API}/people?personIds=${c.join(',')}`));
  return res.flatMap(r => r.people).map(p => ({
    id: p.id, first: p.useName || p.firstName, last: p.useLastName || p.lastName, full: p.fullName,
    num: p.primaryNumber || '', born: p.birthDate, country: p.birthCountry || '',
    city: p.birthCity || '', height: p.height || '', weight: p.weight || 0,
    pos: p.primaryPosition?.abbreviation || '', bats: p.batSide?.code || 'R', throws: p.pitchHand?.code || 'R',
    debut: p.mlbDebutDate || null, draftYear: p.draftYear || null,
  }));
});

// ---- stats ----
async function statTable(group, season, sportId) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const j = await get(`${API}/stats?stats=season&group=${group}&season=${season}&sportId=${sportId}&limit=2500&offset=${offset}&playerPool=ALL`);
    const s = j.stats?.[0];
    if (!s) break;
    for (const sp of s.splits) rows.push({ id: sp.player.id, pos: sp.position?.abbreviation || '', team: sp.team?.id || 0, ...sp.stat });
    offset += s.splits.length;
    if (!s.splits.length || offset >= s.totalSplits) break;
  }
  return rows;
}
const jobs = [];
for (const season of [2024, 2025, 2026]) for (const sportId of [1, 11, 12]) for (const group of ['hitting', 'pitching'])
  jobs.push({ group, season, sportId });
for (const season of [2025, 2026]) for (const sportId of [1, 11, 12]) jobs.push({ group: 'fielding', season, sportId });
await pool(jobs, 4, j => cached(`stats_${j.group}_${j.season}_${j.sportId}.json`, () => statTable(j.group, j.season, j.sportId)));

// ---- savant ----
const SAV = 'https://baseballsavant.mlb.com/leaderboard';
const sav = {
  sprint: y => `${SAV}/sprint_speed?year=${y}&position=&team=&min=0&csv=true`,
  oaa: y => `${SAV}/outs_above_average?type=Fielder&startYear=${y}&endYear=${y}&split=no&team=&range=year&min=0&pos=&roles=&viz=hide&csv=true`,
  arm: y => `${SAV}/arm-strength?type=player&year=${y}&minThrows=20&pos=&team=&csv=true`,
  arsenal: y => `${SAV}/pitch-arsenals?year=${y}&min=30&type=avg_speed&hand=&csv=true`,
  usage: y => `${SAV}/pitch-arsenals?year=${y}&min=30&type=n_&hand=&csv=true`,
  poptime: y => `${SAV}/poptime?year=${y}&team=&min2b=1&min3b=0&csv=true`,
};
for (const [k, f] of Object.entries(sav)) for (const y of [2025, 2026]) {
  try { await cached(`savant_${k}_${y}.csv`, () => get(f(y), true)); }
  catch (e) { console.warn('savant miss', k, y, e.message); }
}
console.log('done');
