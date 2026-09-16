import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initRepo, logCommits, commitPathsTouched } from '../server/files/git.js';
import { createMutex } from '../server/files/mutex.js';
import { reconcileTrees } from '../server/files/reconcile.js';
import { scratchDir } from './helpers.js';

const DANN = { name: 'Dann', email: 'dann@example.com' };

const write = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

// A games directory holding `slugs`, each an initialised repo.
async function gamesDirWith(label, slugs) {
  const root = scratchDir(label);
  for (const slug of slugs) {
    const dir = path.join(root, slug);
    await initRepo(dir, { author: DANN, slug });
  }
  return root;
}

test('a tree left dirty is landed as one commit', async () => {
  const games = await gamesDirWith('reconcile-dirty', ['tank']);
  const dir = path.join(games, 'tank');
  write(dir, 'js/game.js', 'go()');
  write(dir, 'config/world.js', 'const W = 1;');

  const landed = await reconcileTrees({ gamesDir: games, mutex: createMutex() });

  assert.equal(landed.length, 1);
  assert.equal(landed[0].slug, 'tank');
  assert.deepEqual(landed[0].paths.sort(), ['config/world.js', 'js/game.js']);
  const commits = await logCommits(dir);
  assert.equal(commits.length, 2, 'one commit for the lot');
  assert.equal(commits[0].subject, 'work left uncommitted when the studio stopped');
  assert.equal(commits[0].author, 'Unbridled Joy', 'the studio, not a guessed name');
  assert.deepEqual(await commitPathsTouched(dir, commits[0].sha), [
    'config/world.js', 'js/game.js',
  ]);
});

test('a clean tree is left alone', async () => {
  const games = await gamesDirWith('reconcile-clean', ['tank']);
  const before = await logCommits(path.join(games, 'tank'));

  const landed = await reconcileTrees({ gamesDir: games, mutex: createMutex() });

  assert.deepEqual(landed, [], 'nothing to land');
  const after = await logCommits(path.join(games, 'tank'));
  assert.equal(after.length, before.length, 'no empty commit');
});

// The whole point is the games that are fine still get their work back, so one
// unreadable directory cannot be allowed to end the sweep.
test('one game that cannot be landed does not stop the others', async () => {
  const games = await gamesDirWith('reconcile-partial', ['aa-broken', 'zz-fine']);
  write(path.join(games, 'zz-fine'), 'js/game.js', 'go()');
  // A directory that looks like a game and is not a repo at all.
  fs.mkdirSync(path.join(games, 'mm-plain'), { recursive: true });
  write(path.join(games, 'mm-plain'), 'stray.txt', 'x');

  const landed = await reconcileTrees({ gamesDir: games, mutex: createMutex() });

  assert.deepEqual(landed.map((l) => l.slug), ['zz-fine']);
});

test('a missing games directory is not an error', async () => {
  const landed = await reconcileTrees({
    gamesDir: path.join(scratchDir('reconcile-missing'), 'nope'),
    mutex: createMutex(),
  });
  assert.deepEqual(landed, []);
});

// Ignored files are the one thing reconcile must not sweep in: nothing named
// these paths, so a .gitignore is the only word available on what belongs.
test('an ignored file stays out of the recovery commit', async () => {
  const games = await gamesDirWith('reconcile-ignored', ['tank']);
  const dir = path.join(games, 'tank');
  write(dir, '.gitignore', 'notes.tmp\n');
  write(dir, 'notes.tmp', 'scratch');
  write(dir, 'js/game.js', 'go()');

  const landed = await reconcileTrees({ gamesDir: games, mutex: createMutex() });

  assert.deepEqual(landed[0].paths.sort(), ['.gitignore', 'js/game.js']);
});
