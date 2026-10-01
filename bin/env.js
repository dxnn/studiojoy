// Where a maintenance script finds the studio's database and games. An
// explicit DB_PATH or GAMES_DIR wins; then the env file a deployed studio runs
// on (deploy/env-file.cjs); then the defaults a laptop uses, beside the code.
// Without the middle step, a script run on a server made an empty
// gamestudio.db in the work tree and acted on that — an `adduser` into a
// database the studio never reads. Only the two paths come from the file,
// never the key.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const { envFilePath, readEnv } = createRequire(import.meta.url)('../deploy/env-file.cjs');

export { envFilePath };

const DEFAULTS = { DB_PATH: 'gamestudio.db', GAMES_DIR: 'games' };

// `from` is the env file when it supplied either path, so a script can say
// which studio it is about to touch.
export function studioPaths(env = process.env, file = envFilePath(env)) {
  const inFile = fs.existsSync(file) ? readEnv(file) : {};
  const pick = (name) => env[name] ?? inFile[name] ?? DEFAULTS[name];
  const fromFile = Object.keys(DEFAULTS).some((name) => env[name] === undefined && inFile[name] !== undefined);
  return { dbPath: pick('DB_PATH'), gamesDir: pick('GAMES_DIR'), from: fromFile ? file : null };
}

export function paths() {
  const found = studioPaths();
  if (found.from) console.error(`using ${found.from}`);
  return found;
}

// For the scripts that only ever change an existing studio: an empty database
// made by mistake is worse than an error.
export function existingDb() {
  const { dbPath } = paths();
  if (!fs.existsSync(dbPath)) {
    console.error(`no database at ${dbPath} (set DB_PATH, here or in the studio's env file)`);
    process.exit(1);
  }
  return dbPath;
}
