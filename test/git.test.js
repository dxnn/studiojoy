import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  initRepo, isRepo, currentSha, commitPaths, movePath, logCommits,
  showFile, diffCommit, commitPathsTouched, isSha, GitError,
} from '../server/files/git.js';
import { removeFileAt } from '../server/files/tree.js';
import { scratchDir } from './helpers.js';

const DANN = { name: 'Dann', email: 'dann@example.com' };
const AGENT = { name: 'Level Designer', email: 'tank@agent.gamestudio.local' };

async function repo(label) {
  const dir = path.join(scratchDir(label), 'tank');
  await initRepo(dir, { author: DANN, slug: 'tank' });
  return dir;
}

const write = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

test('a fresh project is a repo with one commit', async () => {
  const dir = await repo('git-init');
  assert.equal(await isRepo(dir), true);
  const commits = await logCommits(dir);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'init tank');
  assert.equal(commits[0].author, 'Dann');
  assert.ok(isSha(commits[0].sha));
  assert.ok(isSha(await currentSha(dir)));
});

// The list carries what each commit touched, so the client can show a picture
// in a version without asking for a diff first. One git process, not one per
// commit — fifty extra invocations to find out a version has no picture in it
// would cost more than the feature is worth.
test('a commit in the list says which files it touched', async () => {
  const dir = await repo('git-log-paths');
  write(dir, 'assets/hero.png', 'not really a png');
  write(dir, 'js/game.js', 'let x = 1;');
  await commitPaths(dir, ['assets/hero.png', 'js/game.js'], 'add the hero', AGENT);
  write(dir, 'js/game.js', 'let x = 2;');
  await commitPaths(dir, ['js/game.js'], 'tweak', AGENT);

  const [head, before, first] = await logCommits(dir);
  assert.deepEqual(head.paths, ['js/game.js']);
  assert.deepEqual(before.paths.sort(), ['assets/hero.png', 'js/game.js']);
  assert.equal(Array.isArray(first.paths), true, 'the first commit still has a list');
  assert.equal(head.subject, 'tweak', 'the subject survives the extra parsing');
  assert.equal(head.author, 'Level Designer');
});

test('filtering the log by path leaves the commits it returns intact', async () => {
  const dir = await repo('git-log-filter');
  write(dir, 'assets/hero.png', 'bytes');
  await commitPaths(dir, ['assets/hero.png'], 'add the hero', AGENT);
  write(dir, 'js/game.js', 'let x = 1;');
  await commitPaths(dir, ['js/game.js'], 'add the code', AGENT);

  const commits = await logCommits(dir, { path: 'assets/hero.png' });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'add the hero');
  assert.deepEqual(commits[0].paths, ['assets/hero.png']);
});

// `paths` is filtered along with the commits, so how big each commit actually
// was is a separate question — and the one the client asks to decide whether
// there is any rest of the version to offer.
test('a filtered log still says how many files each commit touched', async () => {
  const dir = await repo('git-log-changed');
  write(dir, 'a.txt', '1');
  write(dir, 'b.txt', '1');
  await commitPaths(dir, ['a.txt', 'b.txt'], 'both', AGENT);
  write(dir, 'a.txt', '2');
  await commitPaths(dir, ['a.txt'], 'just a', AGENT);

  const [alone, together] = await logCommits(dir, { path: 'a.txt' });
  assert.equal(alone.changed, 1);
  assert.equal(together.changed, 2);
  assert.deepEqual(together.paths, ['a.txt'], 'the filter still holds for paths');

  // Nothing to count against when the whole log is already the whole story.
  const [head] = await logCommits(dir);
  assert.equal(head.changed, undefined);
});

// The point of passing identity per invocation: this must work with no
// global git config at all, which is how the deployed server runs.
test('the commit author is the identity passed in, not the host config', async () => {
  const dir = await repo('git-identity');
  write(dir, 'index.html', '<h1>Tank</h1>');
  await commitPaths(dir, ['index.html'], 'add index', AGENT);
  const [head] = await logCommits(dir, { limit: 1 });
  assert.equal(head.author, 'Level Designer');
  assert.equal(head.email, 'tank@agent.gamestudio.local');
});

test('an ambient GIT_CONFIG_PARAMETERS cannot influence a commit', async () => {
  const dir = await repo('git-ambient');
  const saved = process.env.GIT_CONFIG_PARAMETERS;
  // This is exactly what the dev sandbox sets; a leaked value here would
  // change behaviour between machines.
  process.env.GIT_CONFIG_PARAMETERS = "'user.name=Intruder' 'user.email=evil@example.com'";
  try {
    write(dir, 'a.txt', 'x');
    await commitPaths(dir, ['a.txt'], 'add a', DANN);
    const [head] = await logCommits(dir, { limit: 1 });
    assert.equal(head.author, 'Dann');
    assert.equal(head.email, 'dann@example.com');
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
    else process.env.GIT_CONFIG_PARAMETERS = saved;
  }
});

test('commitPaths returns a sha, and null when nothing changed', async () => {
  const dir = await repo('git-noop');
  write(dir, 'game.js', 'let score = 0;');
  const first = await commitPaths(dir, ['game.js'], 'add game', DANN);
  assert.ok(isSha(first));

  // Writing identical bytes is a no-op, not an error and not an empty commit.
  write(dir, 'game.js', 'let score = 0;');
  assert.equal(await commitPaths(dir, ['game.js'], 'no change', DANN), null);
  assert.equal((await logCommits(dir)).length, 2);

  write(dir, 'game.js', 'let score = 1;');
  const second = await commitPaths(dir, ['game.js'], 'bump', DANN);
  assert.ok(isSha(second));
  assert.notEqual(first, second);
});

test('one commit can carry every file a turn wrote', async () => {
  const dir = await repo('git-multi');
  write(dir, 'index.html', '<h1>a</h1>');
  write(dir, 'js/game.js', 'go()');
  write(dir, 'css/style.css', 'body{}');
  const sha = await commitPaths(
    dir, ['index.html', 'js/game.js', 'css/style.css'], 'Level Designer: scaffold', AGENT,
  );
  const touched = await commitPathsTouched(dir, sha);
  assert.deepEqual(touched.sort(), ['css/style.css', 'index.html', 'js/game.js']);
  assert.deepEqual(
    await commitPathsTouched(dir, sha, 'js/game.js'), ['js/game.js'],
    'one file\'s history asks what happened to that file',
  );
  assert.equal((await logCommits(dir)).length, 2, 'one turn is one commit');
});

test('an ignored path still commits, because the app owns the tree', async () => {
  const dir = await repo('git-ignored');
  write(dir, '.gitignore', '*.js\n');
  await commitPaths(dir, ['.gitignore'], 'add ignore', DANN);
  write(dir, 'game.js', 'go()');
  const sha = await commitPaths(dir, ['game.js'], 'add game', DANN);
  assert.ok(isSha(sha), 'a .gitignore must not silently swallow a requested write');
  assert.deepEqual(await commitPathsTouched(dir, sha), ['game.js']);
});

test('history is per-path when asked', async () => {
  const dir = await repo('git-log-path');
  write(dir, 'a.txt', '1');
  await commitPaths(dir, ['a.txt'], 'add a', DANN);
  write(dir, 'b.txt', '1');
  await commitPaths(dir, ['b.txt'], 'add b', DANN);
  write(dir, 'a.txt', '2');
  await commitPaths(dir, ['a.txt'], 'edit a', DANN);

  const all = await logCommits(dir);
  assert.equal(all.length, 4);
  const forA = await logCommits(dir, { path: 'a.txt' });
  assert.deepEqual(forA.map((c) => c.subject), ['edit a', 'add a']);
  assert.equal((await logCommits(dir, { limit: 2 })).length, 2);
});

test('showFile returns the bytes as they were at that commit', async () => {
  const dir = await repo('git-show');
  write(dir, 'game.js', 'version one');
  const first = await commitPaths(dir, ['game.js'], 'v1', DANN);
  write(dir, 'game.js', 'version two');
  await commitPaths(dir, ['game.js'], 'v2', DANN);

  assert.equal((await showFile(dir, first, 'game.js')).toString('utf8'), 'version one');
  assert.equal(
    fs.readFileSync(path.join(dir, 'game.js'), 'utf8'), 'version two',
    'the working tree keeps the newest bytes',
  );
});

test('showFile round-trips binary content', async () => {
  const dir = await repo('git-binary');
  // A PNG header plus a NUL, which a text round trip would corrupt.
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  fs.writeFileSync(path.join(dir, 'sprite.png'), bytes);
  const sha = await commitPaths(dir, ['sprite.png'], 'add sprite', DANN);
  const back = await showFile(dir, sha, 'sprite.png');
  assert.ok(Buffer.isBuffer(back));
  assert.deepEqual([...back], [...bytes]);
});

// A revision is interpolated into `<sha>:<path>`, so anything that isn't hex
// must be refused before it reaches git as a possible option.
test('a non-hex revision is refused rather than passed to git', async () => {
  const dir = await repo('git-sha-guard');
  for (const bad of [
    '--upload-pack=touch /tmp/pwned', '-n', 'HEAD', 'main', '', null, 'zzzz',
    '../../etc/passwd',
  ]) {
    await assert.rejects(
      () => showFile(dir, bad, 'a.txt'),
      (err) => err instanceof GitError && /not a commit id/.test(err.message),
      `revision ${String(bad)} must be refused`,
    );
    await assert.rejects(() => diffCommit(dir, bad), /not a commit id/);
  }
  assert.equal(isSha('a'.repeat(40)), true);
  assert.equal(isSha('A'.repeat(40)), false, 'uppercase hex is not what git prints');
});

test('diffCommit produces a patch for the path', async () => {
  const dir = await repo('git-diff');
  write(dir, 'game.js', 'let a = 1;\n');
  await commitPaths(dir, ['game.js'], 'v1', DANN);
  write(dir, 'game.js', 'let a = 2;\n');
  const sha = await commitPaths(dir, ['game.js'], 'v2', DANN);

  const patch = await diffCommit(dir, sha, 'game.js');
  assert.match(patch, /^-let a = 1;$/m);
  assert.match(patch, /^\+let a = 2;$/m);
});

test('movePath renames in one commit and keeps the content', async () => {
  const dir = await repo('git-mv');
  write(dir, 'game.js', 'contents');
  await commitPaths(dir, ['game.js'], 'add', DANN);
  const sha = await movePath(dir, 'game.js', 'js/game.js', 'move into js/', DANN);

  assert.ok(isSha(sha));
  assert.equal(fs.existsSync(path.join(dir, 'game.js')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'js/game.js'), 'utf8'), 'contents');
  assert.equal((await logCommits(dir, { limit: 1 }))[0].subject, 'move into js/');
});

test('a delete is staged and committed like any other change', async () => {
  const dir = await repo('git-delete');
  write(dir, 'assets/old.txt', 'bye');
  await commitPaths(dir, ['assets/old.txt'], 'add', DANN);

  await removeFileAt(dir, 'assets/old.txt');
  const sha = await commitPaths(dir, ['assets/old.txt'], 'delete old', DANN);
  assert.ok(isSha(sha));
  assert.equal(fs.existsSync(path.join(dir, 'assets/old.txt')), false);
  // Empty parent directories are tidied from the working tree.
  assert.equal(fs.existsSync(path.join(dir, 'assets')), false);
  // And the content is still recoverable from the commit before the delete.
  const commits = await logCommits(dir, { path: 'assets/old.txt' });
  const before = commits.find((c) => c.subject === 'add');
  assert.equal((await showFile(dir, before.sha, 'assets/old.txt')).toString('utf8'), 'bye');
});

test('a git failure is a GitError carrying stderr', async () => {
  const dir = await repo('git-error');
  const head = await currentSha(dir);
  await assert.rejects(
    () => showFile(dir, head, 'does-not-exist.txt'),
    (err) => {
      assert.ok(err instanceof GitError);
      assert.equal(typeof err.stderr, 'string');
      return true;
    },
  );
});

test('isRepo is false for a plain directory', async () => {
  const dir = scratchDir('git-not-a-repo');
  assert.equal(await isRepo(dir), false);
});

// If GAMES_DIR sits inside another repository — the gamestudio checkout, in
// development — an unpinned git command would walk upward, find that repo,
// and commit project files into it. This is the test for the pinning that
// prevents it.
test('a project directory never falls back to an enclosing repository', async () => {
  const outer = scratchDir('git-outer');
  await initRepo(outer, { author: DANN, slug: 'outer' });
  const inner = path.join(outer, 'games', 'tank');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'stray.txt'), 'must not reach the outer repo');

  assert.equal(await isRepo(inner), false, 'a nested directory is not a project');
  await assert.rejects(
    () => commitPaths(inner, ['stray.txt'], 'should never happen', DANN),
    (err) => err instanceof GitError,
  );
  // The outer repository still has only its own initial commit.
  assert.equal((await logCommits(outer)).length, 1);

  // Once initialised, the inner directory is its own repo with its own history.
  await initRepo(inner, { author: DANN, slug: 'tank' });
  assert.equal(await isRepo(inner), true);
  await commitPaths(inner, ['stray.txt'], 'add stray', DANN);
  assert.equal((await logCommits(inner)).length, 2);
  assert.equal((await logCommits(outer)).length, 1, 'the outer repo is untouched');
});

test('init copies no host hook templates', async () => {
  const dir = await repo('git-templates');
  const hooks = path.join(dir, '.git', 'hooks');
  const entries = fs.existsSync(hooks) ? fs.readdirSync(hooks) : [];
  assert.deepEqual(entries, [], `unexpected hooks: ${entries.join(', ')}`);
});
