import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn, openStream } from './helpers.js';
import { logCommits } from '../server/files/git.js';
import { MAX_FILE_BYTES } from '../server/files/tree.js';

async function project(t, { slug = 'tank' } = {}) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug } });
  return { app, dir: path.join(app.gamesDir, slug) };
}

const put = (app, p, body, headers) =>
  app.client.json('PUT', `/api/projects/tank/files/${p}`, { rawBody: body, headers });

test('a PUT creates the file, commits it, and announces the change', async (t) => {
  const { app, dir } = await project(t);
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const res = await put(app, 'index.html', '<h1>Tank</h1>');
  assert.equal(res.status, 201);
  assert.equal(res.body.path, 'index.html');
  assert.equal(res.body.size, 13);
  assert.match(res.body.commit, /^[0-9a-f]{40}$/);

  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>Tank</h1>');
  const commits = await logCommits(dir);
  assert.equal(commits[0].subject, 'create index.html');
  assert.equal(commits[0].author, 'Dann');

  const event = await stream.waitFor((e) => e.event === 'files.changed');
  assert.equal(event.data.project_slug, 'tank');
  assert.deepEqual(event.data.paths, ['index.html']);
});

test('a second PUT updates, and identical bytes are a no-op', async (t) => {
  const { app, dir } = await project(t);
  await put(app, 'game.js', 'let a = 1;');

  const update = await put(app, 'game.js', 'let a = 2;');
  assert.equal(update.status, 200);
  assert.match(update.body.commit, /^[0-9a-f]{40}$/);
  assert.equal((await logCommits(dir))[0].subject, 'update game.js');

  // Rewriting the same bytes must not manufacture an empty commit.
  const noop = await put(app, 'game.js', 'let a = 2;');
  assert.equal(noop.status, 200);
  assert.equal(noop.body.commit, null);
  assert.equal((await logCommits(dir)).length, 3);
});

test('nested paths create their directories', async (t) => {
  const { app, dir } = await project(t);
  const res = await put(app, 'js/lib/engine.js', 'export const go = 1;');
  assert.equal(res.status, 201);
  assert.equal(fs.existsSync(path.join(dir, 'js/lib/engine.js')), true);
});

test('a GET returns the bytes with an ETag and no caching', async (t) => {
  const { app } = await project(t);
  await put(app, 'index.html', '<h1>Tank</h1>');

  const res = await app.client.request('GET', '/api/projects/tank/files/index.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const etag = res.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{64}"$/);
  assert.equal(await res.text(), '<h1>Tank</h1>');

  const cached = await app.client.request('GET', '/api/projects/tank/files/index.html', {
    headers: { 'if-none-match': etag },
  });
  assert.equal(cached.status, 304);
  await cached.text();
});

test('If-Match stops the editor clobbering a change it never saw', async (t) => {
  const { app } = await project(t);
  const created = await put(app, 'game.js', 'version one');
  const etag = created.body.etag;

  // Someone else — an agent, say — writes in the meantime.
  await put(app, 'game.js', 'version two');

  const stale = await put(app, 'game.js', 'version three', { 'if-match': etag });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /changed since/);
  assert.equal(stale.body.content, 'version two', 'the response shows what it would have lost');
  assert.notEqual(stale.body.etag, etag);

  // Retrying with the fresh tag succeeds.
  const retried = await put(app, 'game.js', 'version three', { 'if-match': stale.body.etag });
  assert.equal(retried.status, 200);
});

test('If-Match: * requires the file to already exist', async (t) => {
  const { app } = await project(t);
  const missing = await put(app, 'new.js', 'x', { 'if-match': '*' });
  assert.equal(missing.status, 409);

  await put(app, 'new.js', 'x');
  const present = await put(app, 'new.js', 'y', { 'if-match': '*' });
  assert.equal(present.status, 200);
});

test('omitting If-Match forces the write', async (t) => {
  const { app } = await project(t);
  await put(app, 'game.js', 'one');
  const forced = await put(app, 'game.js', 'two');
  assert.equal(forced.status, 200);
});

// ⚠️ The boundary that matters. Every one of these must be refused before
// any filesystem call happens.
test('a hostile path is refused on every file verb', async (t) => {
  const { app, dir } = await project(t);
  const hostile = [
    '..%2Fescape.txt',
    '..%2F..%2Fetc%2Fpasswd',
    '%2E%2E%2Fescape.txt',
    '.git%2Fconfig',
    '.GIT%2Fconfig',
    'assets%2F..%2F..%2Fout.txt',
    'a%00b.txt',
  ];
  for (const p of hostile) {
    const written = await app.client.json('PUT', `/api/projects/tank/files/${p}`, {
      rawBody: 'pwned',
    });
    assert.equal(written.status, 400, `PUT ${p}`);

    const read = await app.client.json('GET', `/api/projects/tank/files/${p}`);
    assert.ok([400, 404].includes(read.status), `GET ${p} was ${read.status}`);

    const removed = await app.client.json('DELETE', `/api/projects/tank/files/${p}`);
    assert.equal(removed.status, 400, `DELETE ${p}`);
  }
  // Nothing escaped, and the repository metadata is untouched.
  assert.equal(fs.existsSync(path.join(dir, '..', 'escape.txt')), false);
  assert.equal(fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8').includes('pwned'), false);
});

test('a .gitignore is an ordinary file', async (t) => {
  const { app } = await project(t);
  const res = await put(app, '.gitignore', '*.log');
  assert.equal(res.status, 201);
  assert.equal(res.body.path, '.gitignore');
});

test('DELETE removes the file, commits, and prunes empty directories', async (t) => {
  const { app, dir } = await project(t);
  await put(app, 'assets/sprites/hero.png', 'bytes');

  const res = await app.client.json('DELETE', '/api/projects/tank/files/assets/sprites/hero.png');
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);
  assert.match(res.body.commit, /^[0-9a-f]{40}$/);
  assert.equal(fs.existsSync(path.join(dir, 'assets')), false);
  assert.equal((await logCommits(dir))[0].subject, 'delete assets/sprites/hero.png');

  assert.equal(
    (await app.client.json('DELETE', '/api/projects/tank/files/assets/sprites/hero.png')).status,
    404,
  );
});

test('move renames in one commit', async (t) => {
  const { app, dir } = await project(t);
  await put(app, 'game.js', 'contents');

  const res = await app.client.json('POST', '/api/projects/tank/files/move', {
    body: { from: 'game.js', to: 'js/game.js' },
  });
  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(dir, 'game.js')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'js/game.js'), 'utf8'), 'contents');
  assert.equal((await logCommits(dir))[0].subject, 'move game.js to js/game.js');
});

test('move refuses a missing source, an occupied target, and a no-op', async (t) => {
  const { app } = await project(t);
  await put(app, 'a.txt', 'a');
  await put(app, 'b.txt', 'b');

  const missing = await app.client.json('POST', '/api/projects/tank/files/move', {
    body: { from: 'nope.txt', to: 'c.txt' },
  });
  assert.equal(missing.status, 404);

  const occupied = await app.client.json('POST', '/api/projects/tank/files/move', {
    body: { from: 'a.txt', to: 'b.txt' },
  });
  assert.equal(occupied.status, 409);

  const same = await app.client.json('POST', '/api/projects/tank/files/move', {
    body: { from: 'a.txt', to: 'a.txt' },
  });
  assert.equal(same.status, 400);

  const escaping = await app.client.json('POST', '/api/projects/tank/files/move', {
    body: { from: 'a.txt', to: '../out.txt' },
  });
  assert.equal(escaping.status, 400);
});

test('duplicate copies the bytes in one commit and announces only the new path', async (t) => {
  const { app, dir } = await project(t);
  await put(app, 'game.js', 'contents');
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const res = await app.client.json('POST', '/api/projects/tank/files/duplicate', {
    body: { from: 'game.js', to: 'js/game.js' },
  });
  assert.equal(res.status, 201);
  assert.match(res.body.commit, /^[0-9a-f]{40}$/);
  assert.equal(fs.readFileSync(path.join(dir, 'game.js'), 'utf8'), 'contents');
  assert.equal(fs.readFileSync(path.join(dir, 'js/game.js'), 'utf8'), 'contents');
  assert.equal((await logCommits(dir))[0].subject, 'duplicate game.js as js/game.js');

  const event = await stream.waitFor((e) => e.event === 'files.changed');
  assert.deepEqual(event.data.paths, ['js/game.js']);
});

test('a binary file duplicates byte for byte', async (t) => {
  const { app, dir } = await project(t);
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
  await app.client.json('PUT', '/api/projects/tank/files/sprite.png', { rawBody: bytes });

  const res = await app.client.json('POST', '/api/projects/tank/files/duplicate', {
    body: { from: 'sprite.png', to: 'sprite-copy.png' },
  });
  assert.equal(res.status, 201);
  assert.deepEqual([...fs.readFileSync(path.join(dir, 'sprite-copy.png'))], [...bytes]);
});

test('duplicate refuses a missing source, an occupied target, and a no-op', async (t) => {
  const { app } = await project(t);
  await put(app, 'a.txt', 'a');
  await put(app, 'b.txt', 'b');

  const missing = await app.client.json('POST', '/api/projects/tank/files/duplicate', {
    body: { from: 'nope.txt', to: 'c.txt' },
  });
  assert.equal(missing.status, 404);

  const occupied = await app.client.json('POST', '/api/projects/tank/files/duplicate', {
    body: { from: 'a.txt', to: 'b.txt' },
  });
  assert.equal(occupied.status, 409);

  const same = await app.client.json('POST', '/api/projects/tank/files/duplicate', {
    body: { from: 'a.txt', to: 'a.txt' },
  });
  assert.equal(same.status, 400);

  const escaping = await app.client.json('POST', '/api/projects/tank/files/duplicate', {
    body: { from: 'a.txt', to: '../out.txt' },
  });
  assert.equal(escaping.status, 400);
});

test('files called move and duplicate are still writable', async (t) => {
  const { app } = await project(t);
  for (const name of ['move', 'duplicate']) {
    const res = await put(app, name, 'not a verb');
    assert.equal(res.status, 201, name);
    assert.equal(res.body.path, name);
  }
});

test('the listing reports paths, sizes, and totals', async (t) => {
  const { app } = await project(t);
  await put(app, 'index.html', '<h1>x</h1>');
  await put(app, 'js/game.js', 'go()');

  const res = await app.client.json('GET', '/api/projects/tank/files');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.files.map((f) => f.path), ['index.html', 'js/game.js']);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.total_bytes, 14);
  assert.ok(!res.body.files.some((f) => f.path.startsWith('.git/')));
});

test('binary content survives the round trip', async (t) => {
  const { app } = await project(t);
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
  const written = await app.client.json('PUT', '/api/projects/tank/files/sprite.png', {
    rawBody: bytes,
  });
  assert.equal(written.status, 201);

  const res = await app.client.request('GET', '/api/projects/tank/files/sprite.png');
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual([...Buffer.from(await res.arrayBuffer())], [...bytes]);
});

test('a file over the cap is refused', async (t) => {
  const { app } = await project(t);
  const res = await app.client.json('PUT', '/api/projects/tank/files/big.txt', {
    rawBody: Buffer.alloc(MAX_FILE_BYTES + 1, 0x61),
  });
  assert.equal(res.status, 413);
});

test('an archived project rejects writes but still serves reads', async (t) => {
  const { app } = await project(t);
  await put(app, 'index.html', 'x');
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  assert.equal((await put(app, 'index.html', 'y')).status, 409);
  assert.equal(
    (await app.client.json('DELETE', '/api/projects/tank/files/index.html')).status, 409,
  );
  assert.equal(
    (await app.client.json('POST', '/api/projects/tank/files/move', {
      body: { from: 'index.html', to: 'a.html' },
    })).status,
    409,
  );
  assert.equal(
    (await app.client.json('POST', '/api/projects/tank/files/duplicate', {
      body: { from: 'index.html', to: 'a.html' },
    })).status,
    409,
  );

  assert.equal((await app.client.json('GET', '/api/projects/tank/files')).status, 200);
  const read = await app.client.request('GET', '/api/projects/tank/files/index.html');
  assert.equal(read.status, 200);
  assert.equal(await read.text(), 'x');
});

test('file routes on an unknown project are 404', async (t) => {
  const { app } = await project(t);
  assert.equal((await app.client.json('GET', '/api/projects/nope/files')).status, 404);
  assert.equal(
    (await app.client.json('PUT', '/api/projects/nope/files/a.txt', { rawBody: 'x' })).status,
    404,
  );
});

test('concurrent writes to one project all land', async (t) => {
  const { app, dir } = await project(t);
  // Ten simultaneous writes serialise through the project mutex; every one
  // must produce a commit and none may lose another's file.
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => put(app, `f${i}.txt`, `body ${i}`)),
  );
  const listing = await app.client.json('GET', '/api/projects/tank/files');
  assert.equal(listing.body.count, 10);
  for (let i = 0; i < 10; i += 1) {
    assert.equal(fs.readFileSync(path.join(dir, `f${i}.txt`), 'utf8'), `body ${i}`);
  }
  // One initial commit plus ten writes.
  assert.equal((await logCommits(dir, { limit: 100 })).length, 11);
});
