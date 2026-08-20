import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDir } from './helpers.js';
import { patchFor, hasHunks, renameIn } from '../public/patch.js';
import {
  initRepo, commitPaths, movePath, diffCommit, logCommits,
} from '../server/files/git.js';

const AGENT = { name: 'Level Designer', email: 'tank@agent.gamestudio.local' };

// Against git's own output rather than a hand-written sample: the thing this
// has to survive is what git actually prints, renames and odd names and all.
async function repo(name) {
  const dir = path.join(scratchDir(name), name);
  await initRepo(dir, { author: AGENT, slug: name });
  return dir;
}

const write = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

test('one file is taken out of a commit that touched several', async () => {
  const dir = await repo('patch-many');
  const files = ['index.html', 'js/game.js', 'css/style.css'];
  write(dir, 'index.html', '<h1>one</h1>\n');
  write(dir, 'js/game.js', 'let a = 1;\n');
  write(dir, 'css/style.css', 'body { color: red }\n');
  await commitPaths(dir, files, 'first', AGENT);
  write(dir, 'index.html', '<h1>two</h1>\n');
  write(dir, 'js/game.js', 'let a = 2;\n');
  write(dir, 'css/style.css', 'body { color: blue }\n');
  const sha = await commitPaths(dir, files, 'change all three', AGENT);

  const whole = await diffCommit(dir, sha);
  const one = patchFor(whole, 'js/game.js');
  assert.match(one, /^\+let a = 2;$/m);
  assert.doesNotMatch(one, /style\.css/);
  assert.doesNotMatch(one, /index\.html/);
  assert.equal(one.split('\n').filter((l) => l.startsWith('diff --git ')).length, 1);
  assert.ok(hasHunks(one));

  // A file that is not in the commit has nothing to show, rather than the
  // whole commit or the wrong file's changes.
  assert.equal(patchFor(whole, 'js/other.js'), '');
  assert.equal(hasHunks(''), false);
});

// A space is left alone by git, and an accent would be escaped to
// "caf\303\251.png" if core.quotePath were on — a name matching nothing in a
// file listing read from the filesystem. Both have to come back as themselves.
test('a name with a space or an accent in it is still found', async () => {
  const dir = await repo('patch-odd-names');
  const spaced = 'assets/big sprite.txt';
  const accented = 'assets/café.txt';
  const all = [spaced, accented, 'game.js'];
  write(dir, spaced, 'one\n');
  write(dir, accented, 'un\n');
  write(dir, 'game.js', 'let a = 1;\n');
  await commitPaths(dir, all, 'first', AGENT);
  write(dir, spaced, 'two\n');
  write(dir, accented, 'deux\n');
  write(dir, 'game.js', 'let a = 2;\n');
  const sha = await commitPaths(dir, all, 'change them all', AGENT);

  const whole = await diffCommit(dir, sha);
  assert.doesNotMatch(whole, /\\303/, 'git printed the name rather than escaping it');
  assert.match(patchFor(whole, spaced), /^\+two$/m);
  assert.match(patchFor(whole, accented), /^\+deux$/m);
  assert.doesNotMatch(patchFor(whole, accented), /game\.js/);

  // The same name has to come back from the log, or the list and the patch
  // would be talking about different files.
  const [head] = await logCommits(dir, { limit: 1 });
  assert.ok(head.paths.includes(accented), JSON.stringify(head.paths));
});

// A rename is one section under two names, and the version list of the old
// name is exactly where somebody goes looking for where the file went. git
// heads that section `a/<old> b/<new>`, so matching only the new name finds
// nothing and the drawer says there is nothing to show.
test('a rename is found under either of its names, and says where it went', async () => {
  const dir = await repo('patch-rename');
  write(dir, 'game.js', 'let a = 1;\n');
  await commitPaths(dir, ['game.js'], 'first', AGENT);
  const sha = await movePath(dir, 'game.js', 'js/game.js', 'move into js/', AGENT);

  const whole = await diffCommit(dir, sha);
  assert.match(whole, /^diff --git a\/game\.js b\/js\/game\.js$/m, 'git heads it with both');

  for (const name of ['game.js', 'js/game.js']) {
    const one = patchFor(whole, name);
    assert.match(one, /rename to js\/game\.js/, `found under ${name}`);
    assert.equal(hasHunks(one), false, 'nothing changed inside it');
    assert.equal(renameIn(one), 'js/game.js', `where it went, from ${name}`);
  }

  // The list filtered to the old name still finds the commit, so the drawer
  // has something to be about.
  const commits = await logCommits(dir, { path: 'game.js' });
  assert.equal(commits[0].subject, 'move into js/');
  assert.equal(renameIn('diff --git a/a b/a\n@@ -1 +1 @@\n-x\n+y\n'), null);
});

// A picture's diff is "Binary files differ" — a section with no hunk in it.
// The drawer shows the picture instead, and needs to be able to tell.
test('a section with no hunks is recognised as nothing to render', async () => {
  const dir = await repo('patch-binary');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  fs.writeFileSync(path.join(dir, 'hero.png'), png);
  write(dir, 'game.js', 'let a = 1;\n');
  await commitPaths(dir, ['hero.png', 'game.js'], 'first', AGENT);
  fs.writeFileSync(path.join(dir, 'hero.png'), Buffer.concat([png, Buffer.from([1, 2, 3])]));
  write(dir, 'game.js', 'let a = 2;\n');
  const sha = await commitPaths(dir, ['hero.png', 'game.js'], 'change both', AGENT);

  const whole = await diffCommit(dir, sha);
  assert.equal(hasHunks(patchFor(whole, 'hero.png')), false);
  assert.equal(hasHunks(patchFor(whole, 'game.js')), true);
});
