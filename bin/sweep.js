// Bring every game's studio library up to date: libraries a game lacks are
// added, held copies are raised to the current version, and the game's own
// files — seeds like config/controls.js, index.html, everything else — are
// never touched. One commit per game that needed anything, authored as the
// studio, so the change reads in Versions like any other and reverts the
// same way.
//
//   npm run sweep                      # against ./games and ./gamestudio.db,
//                                      # or the paths in the studio's env file
//   DB_PATH=… GAMES_DIR=… npm run sweep
//
// Safe by the compatibility law (spec.md §4): a library version bump must
// run every game the old version ran. Archived games are skipped and catch
// up on the first sweep after they are reopened. Best run while the studio
// is quiet: a game being written at the same moment fails its commit
// cleanly — run the sweep again. A game open in a browser does not notice
// until it is next opened; the commit lands outside the server, so there is
// no files.changed event.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sweepLibraries } from '../server/files/library.js';
import { existingDb, studioPaths } from './env.js';

const dbPath = existingDb();
const gamesDir = path.resolve(studioPaths().gamesDir);
const publicDir = path.resolve(import.meta.dirname, '..', 'public');

// The reserved domain keeps these commits from ever reading as a person's —
// the same trick agent commits use.
const STUDIO = { name: 'Unbridled Joy', email: 'studio@gamestudio.local' };

const db = new DatabaseSync(dbPath, { readOnly: true });
const games = db.prepare(
  "SELECT slug, archived FROM projects WHERE kind = 'game' ORDER BY slug",
).all();
db.close();

let swept = 0;
let current = 0;
let skipped = 0;
let failed = 0;

for (const game of games) {
  if (game.archived === 1) {
    console.log(`${game.slug}: skipped (archived)`);
    skipped += 1;
    continue;
  }
  const dir = path.join(gamesDir, game.slug);
  if (!fs.existsSync(dir)) {
    console.log(`${game.slug}: ! no working tree at ${dir}`);
    failed += 1;
    continue;
  }
  try {
    const result = await sweepLibraries(dir, publicDir, STUDIO);
    if (!result) {
      console.log(`${game.slug}: up to date`);
      current += 1;
      continue;
    }
    const parts = [];
    if (result.added.length > 0) parts.push(`added ${result.added.join(', ')}`);
    for (const u of result.updated) parts.push(`${u.name} ${u.from} -> ${u.to}`);
    console.log(`${game.slug}: ${parts.join('; ')}`);
    swept += 1;
  } catch (err) {
    console.log(`${game.slug}: ! ${err.message}`);
    failed += 1;
  }
}

console.log(
  `${games.length} games: ${swept} brought up to date, ${current} already current, `
  + `${skipped} archived, ${failed} failed`,
);
if (failed > 0) process.exit(1);
