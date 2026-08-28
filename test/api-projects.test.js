import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn } from './helpers.js';
import { isRepo, logCommits } from '../server/files/git.js';

async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  return app;
}

test('creating a project makes a working tree with a repo behind it', async (t) => {
  const app = await studio(t);
  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Tank Game' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.slug, 'tank-game');
  assert.equal(res.body.name, 'Tank Game');
  assert.equal(res.body.archived, false);

  const dir = path.join(app.gamesDir, 'tank-game');
  assert.equal(fs.existsSync(dir), true, 'the working tree exists');
  assert.equal(await isRepo(dir), true, 'and it is its own repository');

  // The empty initial commit is what makes `git log` safe on a new project.
  const commits = await logCommits(dir);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'init tank-game');
  assert.equal(commits[0].author, 'Dann');
});

// Against the real public/, unlike the rest of the suite, whose fixture
// offers no libraries: this is the one test of what creation scaffolds.
test('a new game is born holding the studio library', async (t) => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const app = await setup({ publicDir });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });

  const dir = path.join(app.gamesDir, 'tank');
  const index = JSON.parse(
    fs.readFileSync(path.join(publicDir, 'studio-lib', 'index.json'), 'utf8'),
  );
  // Whatever the studio offers is what a game is born with, version and all.
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'studio/studio.json'), 'utf8'));
  assert.deepEqual(
    manifest,
    Object.fromEntries(Object.entries(index.libraries).map(([n, l]) => [n, l.version])),
  );
  assert.deepEqual(
    fs.readFileSync(path.join(dir, 'studio/input.js')),
    fs.readFileSync(path.join(publicDir, 'studio-lib/input/input.js')),
  );
  assert.deepEqual(
    fs.readFileSync(path.join(dir, 'config/controls.js')),
    fs.readFileSync(path.join(publicDir, 'templates/controls.js')),
  );

  const commits = await logCommits(dir);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].subject, 'set up the studio library');
  assert.equal(commits[1].subject, 'init tank');

  const res = await app.client.json('GET', '/api/projects/tank');
  const byPath = Object.fromEntries(res.body.files.map((f) => [f.path, f]));
  assert.equal(byPath['studio/input.js'].library, true, 'listed as a library file');
  assert.equal(byPath['config/controls.js'].library, undefined, 'the seed is the game\'s own');
});

test('an explicit slug overrides the derived one', async (t) => {
  const app = await studio(t);
  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Tank Game', slug: 'tanks' },
  });
  assert.equal(res.body.slug, 'tanks');
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'tanks')), true);
});

test('a name with no derivable slug asks for one rather than inventing it', async (t) => {
  const app = await studio(t);
  const res = await app.client.json('POST', '/api/projects', {
    body: { name: '!!! ???' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /explicit slug/);
});

test('bad slugs are refused before anything is created', async (t) => {
  const app = await studio(t);
  for (const slug of ['UPPER', 'has space', 'has.dot', '-lead', '..', '.git', 'x'.repeat(41)]) {
    const res = await app.client.json('POST', '/api/projects', {
      body: { name: 'Game', slug },
    });
    assert.equal(res.status, 400, slug);
  }
  assert.deepEqual(fs.readdirSync(app.gamesDir), [], 'no stray directories');
});

// ⚠️ The CSRF-shaped forgery from spec.md §7: a game on the same hostname can
// POST cross-origin with the operator's cookie, and text/plain skips the
// preflight. The signed-in cookie must not be enough — the declared type is.
test('a text/plain POST is refused even with a valid session', async (t) => {
  const app = await studio(t);
  const res = await app.client.request('POST', '/api/projects', {
    headers: { 'content-type': 'text/plain' },
    rawBody: JSON.stringify({ name: 'Sneak' }),
  });
  assert.equal(res.status, 415);
  await res.text();
  assert.deepEqual(fs.readdirSync(app.gamesDir), [], 'nothing was created');
});

test('a duplicate slug is a conflict', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const again = await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /taken/);
});

test('a name is required and bounded', async (t) => {
  const app = await studio(t);
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 5 }, { name: 'x'.repeat(201) }]) {
    const res = await app.client.json('POST', '/api/projects', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('the list is newest first and carries a preview', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'First' } });
  await app.client.json('POST', '/api/projects', { body: { name: 'Second' } });

  const res = await app.client.json('GET', '/api/projects');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.slug), ['second', 'first']);
  assert.equal(res.body[0].preview, '');
});

test('project detail carries the play url, agents, files, and messages', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  fs.writeFileSync(path.join(app.gamesDir, 'tank', 'index.html'), '<h1>Tank</h1>');

  const res = await app.client.json('GET', '/api/projects/tank');
  assert.equal(res.status, 200);
  assert.equal(res.body.play_url, 'http://games.test/tank/');
  assert.deepEqual(res.body.agents, []);
  assert.deepEqual(res.body.messages, []);
  assert.deepEqual(res.body.files.map((f) => f.path), ['index.html']);
  assert.equal(res.body.files[0].text, true);
});

test('an unknown project is 404, and so is a malformed slug', async (t) => {
  const app = await studio(t);
  assert.equal((await app.client.json('GET', '/api/projects/nope')).status, 404);
  // A slug that could never exist is a 400 from validation, not a 404.
  assert.equal((await app.client.json('GET', '/api/projects/UPPER')).status, 400);
});

test('renaming changes the name and never the slug', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const res = await app.client.json('PATCH', '/api/projects/tank', {
    body: { name: 'Tank Deluxe' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Tank Deluxe');
  assert.equal(res.body.slug, 'tank');
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'tank')), true);
});

test('archiving blocks writes, reads keep working, and it reverses', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });

  const archived = await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.archived, true);

  // Reads continue.
  const read = await app.client.json('GET', '/api/projects/tank');
  assert.equal(read.status, 200);
  assert.equal(read.body.archived, true);

  // Writes are refused with 409.
  const write = await app.client.json('PATCH', '/api/projects/tank', {
    body: { name: 'Nope' },
  });
  assert.equal(write.status, 409);
  assert.match(write.body.error, /archived/);

  // And it is not a one-way door.
  const restored = await app.client.json('POST', '/api/projects/tank/archive', {
    body: { archived: false },
  });
  assert.equal(restored.body.archived, false);
  assert.equal(
    (await app.client.json('PATCH', '/api/projects/tank', { body: { name: 'Yes' } })).status,
    200,
  );
});

test('archive requires a boolean and an existing project', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  assert.equal(
    (await app.client.json('POST', '/api/projects/tank/archive', {
      body: { archived: 'yes' },
    })).status,
    400,
  );
  assert.equal(
    (await app.client.json('POST', '/api/projects/nope/archive', { body: {} })).status,
    404,
  );
});

// Zero account complexity: a second account has exactly the same authority
// over a project it did not create (spec.md §3).
test('a fork copies the files, their history, and the helpers', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const agent = await app.client.json('POST', '/api/agents', {
    body: { name: 'Builder', description: 'builds' },
  });
  await app.client.json('POST', '/api/projects/tank/agents', {
    body: { agent_id: agent.body.id, chatty: true },
  });
  await app.client.put('/api/projects/tank/files/index.html', {
    headers: { 'content-type': 'text/plain' }, rawBody: '<h1>tank</h1>',
  });

  const forked = await app.client.json('POST', '/api/projects/tank/fork', {
    body: { name: 'Tank Two', slug: 'tank-two' },
  });
  assert.equal(forked.status, 201);
  assert.equal(forked.body.slug, 'tank-two');

  const dir = path.join(app.gamesDir, 'tank-two');
  assert.equal(await isRepo(dir), true, 'the fork is its own repository');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>tank</h1>');

  // History came along, and the remote pointing back at the original did not.
  const commits = await logCommits(dir);
  assert.ok(commits.length >= 2, 'the original commits are present');
  assert.equal(fs.existsSync(path.join(dir, '.git', 'refs', 'remotes', 'origin')), false);

  const detail = await app.client.json('GET', '/api/projects/tank-two');
  assert.deepEqual(detail.body.agents.map((a) => a.name), ['Builder']);
  // A fresh thread, saying where it came from.
  assert.equal(detail.body.messages.length, 1);
  assert.equal(detail.body.messages[0].kind, 'system');
  assert.match(detail.body.messages[0].body, /copy of "Tank"/);

  // The two trees are independent from here on.
  await app.client.put('/api/projects/tank-two/files/index.html', {
    headers: { 'content-type': 'text/plain' }, rawBody: 'changed',
  });
  assert.equal(
    fs.readFileSync(path.join(app.gamesDir, 'tank', 'index.html'), 'utf8'),
    '<h1>tank</h1>',
    'the original is untouched',
  );
});

test('a fork refuses a taken slug and refuses a chat', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Chat', slug: 'chat', kind: 'chat' },
  });

  const taken = await app.client.json('POST', '/api/projects/tank/fork', {
    body: { name: 'Again', slug: 'tank' },
  });
  assert.equal(taken.status, 409);

  const chat = await app.client.json('POST', '/api/projects/chat/fork', {
    body: { name: 'Nope', slug: 'nope' },
  });
  assert.equal(chat.status, 400);
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'nope')), false);
});

test('publishing is a boolean, games only, and shows in the payload', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Chat', slug: 'chat', kind: 'chat' },
  });

  const before = await app.client.json('GET', '/api/projects/tank');
  assert.equal(before.body.published, false);

  const on = await app.client.json('POST', '/api/projects/tank/publish', { body: {} });
  assert.equal(on.status, 200);
  assert.equal(on.body.published, true);
  const after = await app.client.json('GET', '/api/projects/tank');
  assert.equal(after.body.published, true);

  const bad = await app.client.json('POST', '/api/projects/tank/publish', {
    body: { published: 'yes' },
  });
  assert.equal(bad.status, 400);

  const chat = await app.client.json('POST', '/api/projects/chat/publish', { body: {} });
  assert.equal(chat.status, 400);
});

test('any account can edit any project', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });

  const other = app.newClient();
  await signIn(app, {
    email: 'sam@example.com', password: 'pw', displayName: 'Sam', client: other,
  });
  const res = await other.json('PATCH', '/api/projects/tank', { body: { name: 'Sam Was Here' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Sam Was Here');
});
