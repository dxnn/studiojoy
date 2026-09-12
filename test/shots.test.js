import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';
import { readShot, saveShot, latestShot, MAX_SHOT_BYTES } from '../server/shots.js';

// A studio with one game to put a shot on.
async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return app;
}

const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const uri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
const idOf = (app) => app.db.prepare("SELECT id FROM projects WHERE slug = 'tank'").get().id;

test('a data URI from the frame becomes bytes and a type', () => {
  const shot = readShot(uri);
  assert.equal(shot.mime, 'image/jpeg');
  assert.deepEqual([...shot.bytes], [...bytes]);
});

// ⚠️ The bytes come from inside a frame running LLM-written game code on
// another origin, so none of what they claim about themselves is taken.
test('anything the API would not look at is refused, with a reason', () => {
  const refusals = [
    [undefined, /data: URI/],
    ['', /data: URI/],
    ['https://example.com/hero.png', /data: URI/],
    // The three kinds of not-a-picture: a type the API rejects, a type a
    // canvas cannot make, and a script pretending to be a picture.
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', /not a picture/],
    ['data:text/html;base64,PGgxPmhpPC9oMT4=', /data: URI/],
    ['data:image/jpeg;base64,<script>', /data: URI/],
    ['data:image/jpeg;base64,', /data: URI/],
  ];
  for (const [value, pattern] of refusals) {
    assert.match(readShot(value).error, pattern, JSON.stringify(value));
  }
  // Decoding to nothing is its own case: valid base64, no picture in it.
  assert.match(readShot('data:image/png;base64,====').error, /decoded to nothing/);
});

test('a picture over the cap is refused rather than stored', () => {
  const big = `data:image/png;base64,${Buffer.alloc(MAX_SHOT_BYTES + 1, 1).toString('base64')}`;
  assert.match(readShot(big).error, /over the \d+ byte limit/);
});

test('a shot replaces the one before it, never joins it', async (t) => {
  const app = await studio(t);
  const id = idOf(app);

  saveShot(app.db, id, { mime: 'image/jpeg', bytes, version: 'abc123' });
  saveShot(app.db, id, { mime: 'image/png', bytes: Buffer.from([1, 2]), version: 'def456' });

  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM project_shots').get().n, 1);
  const kept = latestShot(app.db, id);
  assert.equal(kept.mime, 'image/png');
  assert.equal(kept.version, 'def456');
  assert.deepEqual([...kept.bytes], [1, 2]);
});

// The version rides along so a helper's picture can be tied to the bytes that
// drew it, and it is cleaned exactly the way the reporter's own mark is.
test('a version that is not one is cleaned rather than kept', async (t) => {
  const app = await studio(t);
  saveShot(app.db, idOf(app), { mime: 'image/jpeg', bytes, version: '<script>abc:9</script>' });
  assert.equal(latestShot(app.db, idOf(app)).version, 'cabc:9c');
});

test('no shot yet is null, not an empty row', async (t) => {
  const app = await studio(t);
  assert.equal(latestShot(app.db, idOf(app)), null);
});

test('the route stores one, and refuses what is not a picture', async (t) => {
  const app = await studio(t);
  const id = idOf(app);

  const ok = await app.client.json('PUT', '/api/projects/tank/shot', {
    body: { data: uri, version: 'abc' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.bytes, bytes.length);
  assert.deepEqual([...latestShot(app.db, id).bytes], [...bytes]);

  const bad = await app.client.json('PUT', '/api/projects/tank/shot', {
    body: { data: 'https://example.com/x.png' },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /data: URI/);

  // Still the good one: a refused shot does not clear the last real one.
  assert.deepEqual([...latestShot(app.db, id).bytes], [...bytes]);
});

test('a shot needs a session and a game that exists', async (t) => {
  const app = await studio(t);
  assert.equal(
    (await app.client.json('PUT', '/api/projects/nope/shot', { body: { data: uri } })).status,
    404,
  );
  app.client.forget();
  assert.equal(
    (await app.client.json('PUT', '/api/projects/tank/shot', { body: { data: uri } })).status,
    401,
  );
});
