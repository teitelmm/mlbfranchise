// Copies every real player's MLB headshot and every team logo into img/ so the game
// serves its own pictures. Networks and blockers that stop img.mlbstatic.com (school
// filters, ad blockers) then no longer turn every face into the cartoon fallback.
// Run after `npm run data`: node tools/fetch-faces.mjs   (skips files already on disk)
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const L = JSON.parse(await readFile('data/league.json', 'utf8'));
await mkdir('img/faces', { recursive: true });
await mkdir('img/logos', { recursive: true });

const shot = id => `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:good,f_webp/v1/people/${id}/headshot/67/current`;
const get = async url => {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (r.ok) return Buffer.from(await r.arrayBuffer()); if (r.status === 404) return null; }
    catch {}
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  throw new Error('failed ' + url);
};
const exists = f => access(f).then(() => true, () => false);
const md5 = b => createHash('md5').update(b).digest('hex');

// MLB answers a missing photo with a grey silhouette; leave those out so the game draws
// its own avatar (the <img> 404s and its onerror swaps in the SVG).
const generic = md5(await get(shot(1)));

const ids = L.players.filter(p => p.real).map(p => p.id);
let saved = 0, silhouette = 0, have = 0, next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++], f = `img/faces/${id}.webp`;
    if (await exists(f)) { have++; continue; }
    const b = await get(shot(id));
    if (!b || md5(b) === generic) { silhouette++; continue; }
    await writeFile(f, b); saved++;
    if (saved % 200 === 0) console.log(`${saved} saved...`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

const onDisk = (await readdir('img/faces')).filter(f => f.endsWith('.webp')).map(f => +f.slice(0, -5)).sort((a, b) => a - b);
await writeFile('data/faces.json', JSON.stringify(onDisk));

let logos = 0;
for (const t of L.teams) {
  const f = `img/logos/${t.id}.svg`;
  if (await exists(f)) continue;
  const b = await get(`https://www.mlbstatic.com/team-logos/${t.id}.svg`);
  if (b) { await writeFile(f, b); logos++; }
}
console.log(`faces: ${saved} new, ${have} already here, ${silhouette} with no photo · logos: ${logos} new`);
