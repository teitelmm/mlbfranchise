# Ballclub

A browser MLB franchise game: take over one of the 30 real clubs with real players and run it year after year. Trades, free-agent bidding wars, the draft, the minors, an owner who can fire you, and an animated top-down game viewer where you make the manager's calls.

A fan project. Team and player names, logos and photos belong to MLB and the players; photos and logos load from MLB's servers.

## Play

- Online: deploy this repo on Vercel (framework "Other", no build command). `.vercelignore` keeps it a plain static site.
- Locally: `start.bat`, or `npm start`, then open http://localhost:5173. Opening `index.html` straight from disk will not load the data.

Saves live in each player's own browser. Settings can download and load a save file.

## Develop

- `npm install` once (test tools only; the game has no dependencies or build step).
- `npm test` runs the engine checks; `node tests/ui.mjs` walks every page headlessly.
- `node tests/calib.mjs` compares a simulated season with real MLB rates; `node tests/evolve.mjs 10` runs ten years on autopilot.
- `npm run data` rebuilds `data/league.json` from the MLB Stats API and Baseball Savant.
