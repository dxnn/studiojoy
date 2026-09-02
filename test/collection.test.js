// The studio collection: art people here have added, offered on the same
// shelf as the shipped standard set (spec.md §6). ⚠️ No licence is recorded
// anywhere — whoever drew it keeps their copyright — so the tests below are
// as much about what is *absent* from a row as what is in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';
import { pngSize, readsAsStrip, MAX_BYTES } from '../server/collection.js';

// A real PNG of a given size: an 8-byte signature, then an IHDR whose length
// and CRC nothing here checks, which is all the studio reads.
function png(width, height) {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from('rest of the picture')]);
}

async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  const user = await signIn(app);
  return { app, user };
}

const add = (app, params, bytes = png(140, 130), client = app.client) => {
  const q = new URLSearchParams(params).toString();
  return client.json('POST', `/api/collection?${q}`, {
    rawBody: bytes, headers: { 'content-type': 'image/png' },
  });
};

/* Adding ------------------------------------------------------------------- */

test('a picture somebody drew goes in, credited to them and licensed to nobody', async (t) => {
  const { app, user } = await studio(t);
  const res = await add(app, { kind: 'portrait', name: 'My dragon', who: 'dragon', mood: 'cross' });
  assert.equal(res.status, 201);

  assert.equal(res.body.kind, 'portrait');
  assert.equal(res.body.name, 'My dragon');
  assert.equal(res.body.who, 'dragon');
  assert.equal(res.body.mood, 'cross');
  assert.equal(res.body.by, 'Dann');
  assert.equal(res.body.made_here, true);
  assert.equal(res.body.mine, true);
  // ⚠️ The whole point of the decision: no licence is asked for, none is
  // recorded, and none is implied. Whoever drew it kept it.
  assert.equal('licence' in res.body, false);
  assert.equal('license' in res.body, false);

  // The credit is a copy, not a lookup: renaming the account later must not
  // rewrite who drew a picture.
  const row = app.db.prepare('SELECT * FROM collection_art WHERE id = ?').get(res.body.id);
  assert.equal(row.by_name, 'Dann');
  assert.equal(row.added_by, user.id);
  assert.equal(row.width, 140);
  assert.equal(row.height, 130);
  assert.equal(row.mime, 'image/png');
  // The bytes are in the row, which is what puts them inside `npm run backup`.
  assert.equal(Buffer.from(row.bytes).length, png(140, 130).length);
});

test('the shelf lists it beside nothing else, and the bytes come back whole', async (t) => {
  const { app } = await studio(t);
  const bytes = png(200, 120);
  const made = await add(app, { kind: 'background', name: 'My cave' }, bytes);

  const list = await app.client.json('GET', '/api/collection');
  assert.equal(list.status, 200);
  assert.equal(list.body.art.length, 1);
  assert.equal(list.body.art[0].name, 'My cave');
  // A background has no who or mood at all, so the shape stays clean.
  assert.equal('who' in list.body.art[0], false);
  // The index carries a URL rather than the bytes: one row's picture must
  // never ride in the list.
  assert.equal(list.body.art[0].file, `/api/collection/${made.body.id}`);
  assert.equal('bytes' in list.body.art[0], false);

  const got = await app.client.request('GET', `/api/collection/${made.body.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  // A row's bytes never change — an edit is a new row — so this is the one
  // read in the studio that may be cached hard.
  assert.match(got.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);
});

/* What is refused ---------------------------------------------------------- */

test('only a png, only a kind the shelf offers, and only with a name', async (t) => {
  const { app } = await studio(t);
  assert.equal((await add(app, { kind: 'portrait', name: 'x' }, Buffer.from('not a png at all'))).status, 400);
  assert.equal((await add(app, { kind: 'mural', name: 'x' })).status, 400);
  assert.equal((await add(app, { kind: 'portrait', name: '   ' })).status, 400);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM collection_art').get().n, 0);
});

// ⚠️ The rule with teeth. A portrait is copied into assets/sprites/, where
// the sprites library reads a whole-multiple width as a strip of square
// frames — so a 2:1 face would animate rather than stand still.
test('a portrait games would animate is refused, and told why', async (t) => {
  const { app } = await studio(t);
  const res = await add(app, { kind: 'portrait', name: 'Wide' }, png(256, 128));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /animation rather than a face/);

  // One pixel off the multiple is fine, which is how every shipped animal is.
  assert.equal((await add(app, { kind: 'portrait', name: 'Nearly' }, png(257, 128))).status, 201);
  // And a tall portrait is normal — a giraffe.
  assert.equal((await add(app, { kind: 'portrait', name: 'Tall' }, png(128, 260))).status, 201);
});

test('a background has to be wider than it is tall', async (t) => {
  const { app } = await studio(t);
  const res = await add(app, { kind: 'background', name: 'Portrait-shaped' }, png(100, 200));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /wider than it is tall/);
});

test('an oversized picture is refused before anything is measured', async (t) => {
  const { app } = await studio(t);
  const huge = Buffer.concat([png(140, 130), Buffer.alloc(MAX_BYTES + 1)]);
  const res = await add(app, { kind: 'portrait', name: 'Enormous' }, huge);
  assert.equal(res.status, 413);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM collection_art').get().n, 0);
});

test('a who that is not an identifier is dropped rather than written bare', async (t) => {
  const { app } = await studio(t);
  // The key is written bare into config/story.js, so it has to be one.
  const res = await add(app, { kind: 'portrait', name: 'Odd', who: '!!!', mood: 'cross' });
  assert.equal(res.status, 201);
  assert.equal('who' in res.body, false);
  // A name that tidies to an identifier is kept, and a missing mood becomes
  // the one the guide asks for first.
  const ok = await add(app, { kind: 'portrait', name: 'Space Dog', who: 'Space Dog' });
  assert.equal(ok.body.who, 'space_dog');
  assert.equal(ok.body.mood, 'normal');
});

/* Who may do what ---------------------------------------------------------- */

test('signed out, the collection is neither readable nor writable', async (t) => {
  const { app } = await studio(t);
  const made = await add(app, { kind: 'background', name: 'Mine' }, png(200, 120));
  app.client.forget();
  assert.equal((await app.client.json('GET', '/api/collection')).status, 401);
  assert.equal((await app.client.json('GET', `/api/collection/${made.body.id}`)).status, 401);
  assert.equal((await add(app, { kind: 'background', name: 'Theirs' }, png(200, 120))).status, 401);
});

test('a picture is taken out by whoever added it, or by an admin, and by nobody else', async (t) => {
  const { app } = await studio(t);
  const mine = await add(app, { kind: 'background', name: 'Mine' }, png(200, 120));

  // Somebody else in the studio: they see it, and it is not theirs.
  const other = app.newClient();
  await signIn(app, { email: 'sam@example.com', displayName: 'Sam', client: other });
  const theirView = await other.json('GET', '/api/collection');
  assert.equal(theirView.body.art[0].mine, false);
  assert.equal(theirView.body.art[0].by, 'Dann');
  assert.equal((await other.json('DELETE', `/api/collection/${mine.body.id}`)).status, 403);

  // Their own, which they may take out.
  const theirs = await add(app, { kind: 'background', name: 'Theirs' }, png(200, 120), other);
  assert.equal((await other.json('DELETE', `/api/collection/${theirs.body.id}`)).status, 204);

  // The first account is an admin, so it may take out anybody's.
  const again = await add(app, { kind: 'background', name: 'Sam again' }, png(200, 120), other);
  assert.equal((await app.client.json('DELETE', `/api/collection/${again.body.id}`)).status, 204);

  assert.equal((await app.client.json('DELETE', '/api/collection/9999')).status, 404);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM collection_art').get().n, 1);
});

/* The pure parts ----------------------------------------------------------- */

test('pngSize reads the header and refuses anything else', () => {
  assert.deepEqual(pngSize(png(480, 270)), { width: 480, height: 270 });
  assert.equal(pngSize(Buffer.from('GIF89a and then some padding here')), null);
  assert.equal(pngSize(Buffer.alloc(4)), null);
  assert.equal(pngSize(png(0, 10)), null, 'a zero side is not a picture');
});

test('readsAsStrip is the sprites library\'s own rule', () => {
  assert.equal(readsAsStrip(256, 128), true);
  assert.equal(readsAsStrip(384, 128), true);
  assert.equal(readsAsStrip(257, 128), false);
  assert.equal(readsAsStrip(128, 128), false, 'a square is one frame, not a strip');
  assert.equal(readsAsStrip(128, 256), false, 'taller than wide is never a strip');
});
