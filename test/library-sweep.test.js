// The sweep: bringing an existing game's studio library forward. The rule it
// shares with the creation scaffold — fill what is missing, never touch what
// is the game's own — applied to trees that already have history, plus the
// bin script's archived filter. Against the real public/, like the scaffold
// test in api-projects.test.js: this is the one place the real index.json is
// what is being tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { createUser } from '../server/auth.js';
import { initRepo, commitPaths, logCommits } from '../server/files/git.js';
import { writeFileAt } from '../server/files/tree.js';
import { sweepLibraries } from '../server/files/library.js';
import { scratchDir } from './helpers.js';

const run = promisify(execFile);
const publicDir = path.resolve(import.meta.dirname, '..', 'public');
const INDEX = JSON.parse(
  fs.readFileSync(path.join(publicDir, 'studio-lib', 'index.json'), 'utf8'),
);
// The core set: what the sweep hands every game. Extras are libraries.test.js's.
const CORE = Object.entries(INDEX.libraries).filter(([, l]) => l.core);
const CURRENT = Object.fromEntries(CORE.map(([name, l]) => [name, l.version]));
const STUDIO = { name: 'Unbridled Joy', email: 'studio@gamestudio.local' };

// A game as some earlier studio left it: its own files, and whatever slice
// of the library that studio had.
async function oldGame(dir, { manifest = null, files = {} } = {}) {
  await initRepo(dir, { author: STUDIO, slug: path.basename(dir) });
  const paths = [];
  for (const [rel, content] of Object.entries(files)) {
    await writeFileAt(path.join(dir, rel), content);
    paths.push(rel);
  }
  if (manifest) {
    await writeFileAt(path.join(dir, 'studio/studio.json'), JSON.stringify(manifest));
    paths.push('studio/studio.json');
  }
  if (paths.length > 0) await commitPaths(dir, paths, 'as it was', STUDIO);
}

test('a game from before the library gets everything, once', async () => {
  const dir = path.join(scratchDir('sweep'), 'oldest');
  await oldGame(dir, { files: { 'index.html': '<canvas></canvas>' } });

  const result = await sweepLibraries(dir, publicDir, STUDIO);
  assert.deepEqual(result.added.sort(), Object.keys(CURRENT).sort());
  assert.deepEqual(result.updated, []);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'studio/studio.json'), 'utf8'),
  );
  assert.deepEqual(manifest, CURRENT);
  // Every declared file, byte for byte — the sweep is how the fleet gets the
  // screens library's typefaces, and a .woff2 that came through a text read
  // would be a game with no type and nothing said about why.
  for (const [name, library] of CORE) {
    for (const file of library.files) {
      assert.deepEqual(
        fs.readFileSync(path.join(dir, 'studio', file)),
        fs.readFileSync(path.join(publicDir, 'studio-lib', name, file)),
        `studio/${file}`,
      );
    }
  }
  assert.ok(fs.existsSync(path.join(dir, 'config/controls.js')), 'the seed came too');

  const commits = await logCommits(dir);
  assert.equal(commits[0].subject, 'brought the studio library up to date');
  assert.equal(commits[0].author, 'Unbridled Joy');

  // Running it again finds nothing to do and leaves no commit behind.
  assert.equal(await sweepLibraries(dir, publicDir, STUDIO), null);
  assert.equal((await logCommits(dir)).length, commits.length);
});

test("a held library is raised, and the game's own files stay its own", async () => {
  const dir = path.join(scratchDir('sweep'), 'held');
  await oldGame(dir, {
    manifest: { input: 1 },
    files: {
      'studio/input.js': '// the old input, version 1\n',
      'config/controls.js': 'const CONTROLS = { theirs: true };\n',
      'index.html': '<script src="studio/input.js"></script>',
    },
  });

  const result = await sweepLibraries(dir, publicDir, STUDIO);
  assert.deepEqual(result.updated, [{ name: 'input', from: 1, to: CURRENT.input }]);
  assert.equal(result.added.includes('screens'), true);
  assert.deepEqual(
    fs.readFileSync(path.join(dir, 'studio/input.js')),
    fs.readFileSync(path.join(publicDir, 'studio-lib/input/input.js')),
  );
  assert.equal(
    fs.readFileSync(path.join(dir, 'config/controls.js'), 'utf8'),
    'const CONTROLS = { theirs: true };\n',
    'a seed already there is never replaced',
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, 'studio/studio.json'), 'utf8')),
    CURRENT,
  );
});

test("a copy newer than the studio's is left alone", async () => {
  const dir = path.join(scratchDir('sweep'), 'newer');
  await oldGame(dir, {
    manifest: { ...CURRENT, input: CURRENT.input + 1 },
    files: { 'studio/input.js': '// from the future\n' },
  });
  assert.equal(await sweepLibraries(dir, publicDir, STUDIO), null);
  assert.equal(
    fs.readFileSync(path.join(dir, 'studio/input.js'), 'utf8'),
    '// from the future\n',
  );
});

// Archived games too: one is still playable, and eight once took a move onto
// State that needed a library the sweep had skipped them for.
test('the script sweeps every game, archived ones included, and says where it is', async () => {
  const root = scratchDir('sweep-bin');
  const gamesDir = path.join(root, 'games');
  const dbPath = path.join(root, 'studio.db');

  const db = openDb(dbPath);
  createUser(db, { email: 'kid@example.com', password: 'hunter2', displayName: 'Kid' });
  const { id } = db.prepare('SELECT id FROM users LIMIT 1').get();
  const insert = db.prepare(
    "INSERT INTO projects (slug, name, kind, archived, created_by, created_at)"
    + " VALUES (?, ?, 'game', ?, ?, datetime('now'))",
  );
  insert.run('stale', 'Stale', 0, id);
  insert.run('frozen', 'Frozen', 1, id);
  db.close();

  await oldGame(path.join(gamesDir, 'stale'), { files: { 'index.html': 'x' } });
  await oldGame(path.join(gamesDir, 'frozen'), { files: { 'index.html': 'x' } });

  const script = path.join(import.meta.dirname, '..', 'bin', 'sweep.js');
  const { stdout, stderr } = await run('node', [script], {
    env: { ...process.env, DB_PATH: dbPath, GAMES_DIR: gamesDir },
  });
  assert.match(stderr, new RegExp(`using ${dbPath} and ${gamesDir}`), 'what it touches, before it does');
  assert.match(stdout, /stale: added /);
  assert.match(stdout, /frozen: added /);
  assert.match(stdout, /2 games: 2 brought up to date, 0 already current, 0 failed/);
  assert.ok(fs.existsSync(path.join(gamesDir, 'stale/studio/state.js')));
  assert.ok(fs.existsSync(path.join(gamesDir, 'frozen/studio/state.js')), 'an archived game is swept too');
});
