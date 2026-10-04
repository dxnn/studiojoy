// Where a maintenance script finds the studio (bin/env.js): an explicit path,
// then the studio's env file, then the laptop defaults beside the code. Run on
// a server without the middle step, a script made an empty database in the
// work tree and acted on that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDir } from './helpers.js';
import { saying, studioPaths, whereDbPath } from '../bin/env.js';

function envFile(text) {
  const file = path.join(scratchDir('env'), 'studio.env');
  fs.writeFileSync(file, text);
  return file;
}

test('the env file gives a server its paths, and says it did', () => {
  const file = envFile(
    '# the key, the ports, the paths\n\nDB_PATH=/srv/data/db\nGAMES_DIR = /srv/data/games\nDEEPSEEK_API_KEY=sk-x\n',
  );
  assert.deepEqual(studioPaths({}, file), { dbPath: '/srv/data/db', gamesDir: '/srv/data/games', from: file });
});

test('an explicit path outranks the file, one name at a time', () => {
  const file = envFile('DB_PATH=/srv/data/db\nGAMES_DIR=/srv/data/games\n');
  assert.deepEqual(
    studioPaths({ DB_PATH: 'here.db', GAMES_DIR: 'here' }, file),
    { dbPath: 'here.db', gamesDir: 'here', from: null },
  );
  assert.deepEqual(
    studioPaths({ DB_PATH: 'here.db' }, file),
    { dbPath: 'here.db', gamesDir: '/srv/data/games', from: file },
  );
});

test('STUDIO_ENV names the file, the same as it does for pm2', () => {
  const file = envFile('DB_PATH=/elsewhere/db\n');
  assert.equal(studioPaths({ STUDIO_ENV: file }).dbPath, '/elsewhere/db');
});

test('no file is a laptop: the defaults beside the code', () => {
  const missing = path.join(scratchDir('env'), 'studio.env');
  assert.deepEqual(studioPaths({}, missing), { dbPath: 'gamestudio.db', gamesDir: 'games', from: null });
});

// The first line of every script: both paths, whole, and where they came
// from — the laptop's defaults included, since those are a real database and
// the production mirrors.
test('a script says what it is about to touch, defaults included', () => {
  const file = envFile('DB_PATH=/srv/data/db\nGAMES_DIR=/srv/data/games\n');
  assert.equal(saying(studioPaths({}, file)), `using /srv/data/db and /srv/data/games (from ${file})`);
  const missing = path.join(scratchDir('env'), 'studio.env');
  assert.equal(
    saying(studioPaths({}, missing)),
    `using ${path.resolve('gamestudio.db')} and ${path.resolve('games')} (no env file)`,
  );
});

// What a script says when it finds no database: which of the three places
// answered, and for the default, what the env file lacked — the case a
// server that still runs on a path pm2 remembers will hit.
test('a missing database says where its path came from', () => {
  const missing = path.join(scratchDir('env'), 'studio.env');
  assert.equal(whereDbPath({}, missing), `the default: there is no ${missing}`);
  const keyOnly = envFile('DEEPSEEK_API_KEY=sk-x\n# DB_PATH=/srv/data/db\n');
  assert.equal(whereDbPath({}, keyOnly), `the default: ${keyOnly} has no DB_PATH line`);
  const full = envFile('DB_PATH=/srv/data/db\n');
  assert.equal(whereDbPath({}, full), full);
  assert.equal(whereDbPath({ DB_PATH: 'here.db' }, full), 'DB_PATH in the environment');
});
