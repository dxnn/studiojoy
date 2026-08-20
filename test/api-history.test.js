import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn } from './helpers.js';
import { logCommits, commitPaths } from '../server/files/git.js';

async function project(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return { app, dir: path.join(app.gamesDir, 'tank') };
}

const put = (app, p, body) =>
  app.client.json('PUT', `/api/projects/tank/files/${p}`, { rawBody: body });

test('history lists commits newest first', async (t) => {
  const { app } = await project(t);
  await put(app, 'game.js', 'v1');
  await put(app, 'game.js', 'v2');

  const res = await app.client.json('GET', '/api/projects/tank/history');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((c) => c.subject), [
    'update game.js', 'create game.js', 'init tank',
  ]);
  const [head] = res.body;
  assert.match(head.sha, /^[0-9a-f]{40}$/);
  assert.equal(head.short, head.sha.slice(0, 7));
  assert.equal(head.author, 'Dann');
  assert.ok(!Number.isNaN(Date.parse(head.at)));
});

test('history filters by path and honours a limit', async (t) => {
  const { app } = await project(t);
  await put(app, 'a.txt', '1');
  await put(app, 'b.txt', '1');
  await put(app, 'a.txt', '2');

  const forA = await app.client.json('GET', '/api/projects/tank/history?path=a.txt');
  assert.deepEqual(forA.body.map((c) => c.subject), ['update a.txt', 'create a.txt']);
  // Each of these commits is one file, which is what tells the versions list
  // there is no whole version worth offering.
  assert.deepEqual(forA.body.map((c) => c.changed), [1, 1]);

  const limited = await app.client.json('GET', '/api/projects/tank/history?limit=2');
  assert.equal(limited.body.length, 2);

  // A nonsense limit falls back to the default rather than erroring.
  const bad = await app.client.json('GET', '/api/projects/tank/history?limit=abc');
  assert.equal(bad.body.length, 4);
});

test('a hostile ?path= is refused', async (t) => {
  const { app } = await project(t);
  const withNul = `a${String.fromCharCode(0)}b`;
  for (const p of ['../escape', '.git/config', withNul, '/etc/passwd']) {
    const res = await app.client.json(
      'GET', `/api/projects/tank/history?path=${encodeURIComponent(p)}`,
    );
    assert.equal(res.status, 400, JSON.stringify(p));
  }
});

test('an old version is readable at its commit', async (t) => {
  const { app } = await project(t);
  const first = await put(app, 'game.js', 'version one');
  await put(app, 'game.js', 'version two');

  const res = await app.client.request(
    `GET`, `/api/projects/tank/history/${first.body.commit}/game.js`,
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
  assert.equal(await res.text(), 'version one');

  // And the working tree still holds the newest bytes.
  const current = await app.client.request('GET', '/api/projects/tank/files/game.js');
  assert.equal(await current.text(), 'version two');
});

test('a non-hex revision is a 400 and a plausible-but-absent one is a 404', async (t) => {
  const { app } = await project(t);
  await put(app, 'game.js', 'x');

  const encode = (s) => [...s]
    .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .join('');
  for (const sha of ['HEAD', 'main', '--upload-pack=evil', 'zzzzzzz', 'a'.repeat(41)]) {
    const res = await app.client.json(
      'GET', `/api/projects/tank/history/${encode(sha)}/game.js`,
    );
    assert.equal(res.status, 400, sha);
  }

  // A lone dot segment cannot reach a handler at all: the WHATWG URL parser
  // resolves `..` during normalisation, and does so even when it is
  // percent-encoded as %2e%2e. The route simply stops matching, so this is a
  // 404 rather than a validation error — defence in depth ahead of isSha.
  for (const dots of ['..', encode('..')]) {
    const res = await app.client.json(
      'GET', `/api/projects/tank/history/${dots}/game.js`,
    );
    assert.equal(res.status, 404, dots);
  }

  // A single dot collapses too, which leaves the filename occupying the :sha
  // slot — so that one surfaces as a validation error instead.
  const single = await app.client.json('GET', '/api/projects/tank/history/./game.js');
  assert.equal(single.status, 400);
  assert.match(single.body.error, /not a commit id/);
  const absent = await app.client.json(
    'GET', `/api/projects/tank/history/${'a'.repeat(40)}/game.js`,
  );
  assert.equal(absent.status, 404);
});

test('a path absent from that commit is a 404', async (t) => {
  const { app } = await project(t);
  const first = await put(app, 'a.txt', 'a');
  await put(app, 'b.txt', 'b');

  const res = await app.client.json(
    'GET', `/api/projects/tank/history/${first.body.commit}/b.txt`,
  );
  assert.equal(res.status, 404);
});

test('a diff carries the patch and the paths it touched', async (t) => {
  const { app } = await project(t);
  await put(app, 'game.js', 'let a = 1;\n');
  const second = await put(app, 'game.js', 'let a = 2;\n');

  const res = await app.client.json('GET', `/api/projects/tank/diff/${second.body.commit}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.sha, second.body.commit);
  assert.deepEqual(res.body.paths, ['game.js']);
  assert.match(res.body.patch, /^-let a = 1;$/m);
  assert.match(res.body.patch, /^\+let a = 2;$/m);

  const scoped = await app.client.json(
    'GET', `/api/projects/tank/diff/${second.body.commit}?path=game.js`,
  );
  assert.match(scoped.body.patch, /let a = 2;/);
});

// The versions list filtered to one file opens its diffs filtered too, so both
// halves of the response have to be about that file — a patch for one path
// beside a paths list naming three is the drawer disagreeing with itself.
test('a diff scoped to one path reports only that path', async (t) => {
  const { app, dir } = await project(t);
  const author = { name: 'Dann', email: 'dann@example.com' };
  const both = ['game.js', 'notes.md'];
  const writeBoth = (game, notes) => {
    fs.writeFileSync(path.join(dir, 'game.js'), game);
    fs.writeFileSync(path.join(dir, 'notes.md'), notes);
  };
  writeBoth('let a = 1;\n', 'one\n');
  await commitPaths(dir, both, 'add both', author);
  writeBoth('let a = 2;\n', 'two\n');
  const sha = await commitPaths(dir, both, 'change both', author);

  const all = await app.client.json('GET', `/api/projects/tank/diff/${sha}`);
  assert.deepEqual(all.body.paths.sort(), ['game.js', 'notes.md']);

  const scoped = await app.client.json('GET', `/api/projects/tank/diff/${sha}?path=game.js`);
  assert.deepEqual(scoped.body.paths, ['game.js']);
  assert.doesNotMatch(scoped.body.patch, /notes\.md/);
  assert.match(scoped.body.patch, /^\+let a = 2;$/m);
});

test('restore writes the old bytes as a new commit', async (t) => {
  const { app, dir } = await project(t);
  const first = await put(app, 'game.js', 'version one');
  await put(app, 'game.js', 'version two');
  const before = (await logCommits(dir, { limit: 100 })).length;

  const res = await app.client.json('POST', '/api/projects/tank/restore', {
    body: { sha: first.body.commit, path: 'game.js' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.restored_from, first.body.commit);
  assert.equal(fs.readFileSync(path.join(dir, 'game.js'), 'utf8'), 'version one');

  // History grew rather than being rewritten — the point of spec.md §5.
  const commits = await logCommits(dir, { limit: 100 });
  assert.equal(commits.length, before + 1);
  assert.equal(commits[0].subject, `restore game.js to ${first.body.commit.slice(0, 7)}`);
  assert.ok(
    commits.some((c) => c.sha === first.body.commit),
    'the original commit is still reachable',
  );
});

test('restore validates its arguments and respects archiving', async (t) => {
  const { app } = await project(t);
  const first = await put(app, 'game.js', 'v1');

  for (const body of [
    {}, { sha: 'HEAD', path: 'game.js' }, { sha: first.body.commit },
    { sha: first.body.commit, path: '../escape' },
    { sha: first.body.commit, path: '.git/config' },
  ]) {
    const res = await app.client.json('POST', '/api/projects/tank/restore', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const absent = await app.client.json('POST', '/api/projects/tank/restore', {
    body: { sha: 'b'.repeat(40), path: 'game.js' },
  });
  assert.equal(absent.status, 404);

  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  const archived = await app.client.json('POST', '/api/projects/tank/restore', {
    body: { sha: first.body.commit, path: 'game.js' },
  });
  assert.equal(archived.status, 409);
});

test('history reads keep working on an archived project', async (t) => {
  const { app } = await project(t);
  const first = await put(app, 'game.js', 'v1');
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  assert.equal((await app.client.json('GET', '/api/projects/tank/history')).status, 200);
  assert.equal(
    (await app.client.json('GET', `/api/projects/tank/diff/${first.body.commit}`)).status, 200,
  );
  const old = await app.client.request(
    'GET', `/api/projects/tank/history/${first.body.commit}/game.js`,
  );
  assert.equal(old.status, 200);
  await old.text();
});

test('rollback puts the whole tree back and takes newer files away', async (t) => {
  const { app, dir } = await project(t);
  await put(app, 'index.html', '<h1>one</h1>');
  const good = await put(app, 'js/game.js', 'let a = 1;');
  // Everything after the version we roll back to: an edit, a new file, and a
  // deletion, so all three directions are covered by one call.
  await put(app, 'js/game.js', 'let a = 2; // broken');
  await put(app, 'js/extra.js', 'made later');
  await app.client.json('DELETE', '/api/projects/tank/files/index.html');

  const res = await app.client.json('POST', '/api/projects/tank/rollback', {
    body: { sha: good.body.commit },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.restored_from, good.body.commit);
  assert.equal(res.body.restored, 2);
  assert.equal(res.body.removed, 1);

  assert.equal(fs.readFileSync(path.join(dir, 'js/game.js'), 'utf8'), 'let a = 1;');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>one</h1>');
  assert.equal(fs.existsSync(path.join(dir, 'js/extra.js')), false, 'and its directory tidied');

  // One new commit, nothing rewritten, and the rolled-back-from state is still
  // reachable — a rollback is itself undoable.
  const commits = await logCommits(dir, { limit: 100 });
  assert.equal(commits[0].subject, `restore everything to ${good.body.commit.slice(0, 7)}`);
  assert.ok(commits.some((c) => c.subject === 'create js/extra.js'));
});

test('rollback to the current version changes nothing', async (t) => {
  const { app, dir } = await project(t);
  const head = await put(app, 'game.js', 'v1');
  const before = (await logCommits(dir, { limit: 100 })).length;

  const res = await app.client.json('POST', '/api/projects/tank/rollback', {
    body: { sha: head.body.commit },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.commit, null, 'no empty commit');
  assert.equal((await logCommits(dir, { limit: 100 })).length, before);
});

test('rollback to the initial commit empties the tree', async (t) => {
  const { app, dir } = await project(t);
  await put(app, 'game.js', 'v1');
  const [init] = (await logCommits(dir, { limit: 100 })).slice(-1);

  const res = await app.client.json('POST', '/api/projects/tank/rollback', {
    body: { sha: init.sha },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.restored, 0);
  assert.equal(res.body.removed, 1);
  assert.equal(fs.existsSync(path.join(dir, 'game.js')), false);
  // Still recoverable: the commit that held it is untouched.
  const files = await app.client.json('GET', '/api/projects/tank/files');
  assert.deepEqual(files.body.files, []);
});

test('rollback validates its argument and respects archiving', async (t) => {
  const { app } = await project(t);
  const first = await put(app, 'game.js', 'v1');

  for (const body of [{}, { sha: 'HEAD' }, { sha: 'not-a-sha' }]) {
    const res = await app.client.json('POST', '/api/projects/tank/rollback', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const absent = await app.client.json('POST', '/api/projects/tank/rollback', {
    body: { sha: 'b'.repeat(40) },
  });
  assert.equal(absent.status, 404);

  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  const archived = await app.client.json('POST', '/api/projects/tank/rollback', {
    body: { sha: first.body.commit },
  });
  assert.equal(archived.status, 409);
});

test('a deleted file is still recoverable from history', async (t) => {
  const { app, dir } = await project(t);
  const created = await put(app, 'doomed.txt', 'still here');
  await app.client.json('DELETE', '/api/projects/tank/files/doomed.txt');
  assert.equal(fs.existsSync(path.join(dir, 'doomed.txt')), false);

  const restored = await app.client.json('POST', '/api/projects/tank/restore', {
    body: { sha: created.body.commit, path: 'doomed.txt' },
  });
  assert.equal(restored.status, 200);
  assert.equal(fs.readFileSync(path.join(dir, 'doomed.txt'), 'utf8'), 'still here');
});
