// Gear and avatars (server/gear.js, public/gear-shapes.js, ideas/dreams.md §6):
// a head, a body and legs, each drawn inside its shape; three new pieces a
// person a week, theirs for nothing; everybody else's for 20 joy, which goes
// to nobody; and what is worn shows in the crew, in your settings and beside
// the games a person made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { setup, signIn, startGames } from './helpers.js';
import { SIZES, SLOTS, insideShape, maskFor, shapeSvg } from '../public/gear-shapes.js';
import { GEAR_PRICE, MAKES_A_WEEK } from '../server/gear.js';
import { joyOf } from '../server/joy.js';

// A real PNG of a size, every pixel one colour: what the pixel editor saves.
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('three shapes, stacked into one figure 32 wide', () => {
  assert.deepEqual(SLOTS, ['head', 'body', 'legs']);
  for (const slot of SLOTS) {
    assert.equal(SIZES[slot].width, 32);
    assert.equal(maskFor(slot).length, SIZES[slot].width * SIZES[slot].height);
    assert.match(shapeSvg(slot, '#123'), /^data:image\/svg\+xml,/);
  }
  assert.equal(insideShape('head', 16, 16), true, 'the middle of the circle');
  assert.equal(insideShape('head', 0, 0), false, 'a corner is outside it');
  assert.equal(insideShape('legs', 15, 12), false, 'between the legs');
  assert.equal(insideShape('body', 0, 27), false, 'below an arm');
});

async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  const dann = await signIn(app);
  const sam = app.newClient();
  const samUser = await signIn(app, { email: 'sam@example.com', displayName: 'Sam', client: sam });
  return { app, dann, sam, samUser };
}

const make = (client, slot, name, bytes = png(SIZES[slot]?.width ?? 32, SIZES[slot]?.height ?? 32)) =>
  client.json('POST', `/api/gear?slot=${slot}&name=${encodeURIComponent(name)}`, {
    rawBody: bytes, headers: { 'content-type': 'image/png' },
  });

test('a person makes three pieces a week, each the right size, and owns them', async (t) => {
  const { app } = await studio(t);
  assert.equal(MAKES_A_WEEK, 3);

  assert.equal((await make(app.client, 'head', 'Crown', png(32, 30))).status, 400, 'a head is 32 by 32');
  assert.equal((await make(app.client, 'hat', 'Crown')).status, 400);
  assert.equal((await make(app.client, 'head', '  ')).status, 400, 'it needs a name');
  assert.equal((await make(app.client, 'head', 'Crown', Buffer.from('not a png'))).status, 400);

  const crown = await make(app.client, 'head', 'Crown');
  assert.equal(crown.status, 201);
  assert.deepEqual(Object.keys(crown.body).sort(), ['id', 'name', 'slot']);
  await make(app.client, 'body', 'Cape');
  await make(app.client, 'legs', 'Boots');
  const fourth = await make(app.client, 'head', 'Hat');
  assert.equal(fourth.status, 409);
  assert.match(fourth.body.error, /3 pieces this week/);

  const wardrobe = await app.client.json('GET', '/api/gear');
  assert.equal(wardrobe.body.made_this_week, 3);
  assert.equal(wardrobe.body.price, GEAR_PRICE);
  assert.deepEqual(wardrobe.body.gear.map((g) => [g.name, g.owned, g.mine]), [
    ['Boots', true, true], ['Cape', true, true], ['Crown', true, true],
  ], 'newest first, and the maker owns each for nothing');

  const picture = await app.client.request('GET', `/api/gear/${crown.body.id}/picture`);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  assert.match(picture.headers.get('cache-control'), /immutable/);
});

test('everybody else buys it for 20 joy, which goes to nobody', async (t) => {
  const { app, dann, sam, samUser } = await studio(t);
  const crown = (await make(app.client, 'head', 'Crown')).body;

  const broke = await sam.json('POST', `/api/gear/${crown.id}/buy`);
  assert.equal(broke.status, 409);
  assert.match(broke.body.error, /20 joy, and you have 0/);

  app.db.prepare(
    "INSERT INTO ledger (user_id, currency, delta, why, created_at) VALUES (?, 'joy', 25, 'earned', ?)",
  ).run(samUser.id, new Date().toISOString());
  const bought = await sam.json('POST', `/api/gear/${crown.id}/buy`);
  assert.equal(bought.status, 201);
  assert.deepEqual(bought.body, { joy: 5 });
  assert.equal(joyOf(app.db, samUser.id), 5);
  assert.equal(joyOf(app.db, dann.id), 0, 'the maker gets none of it');
  assert.equal((await sam.json('POST', `/api/gear/${crown.id}/buy`)).status, 409, 'yours already');
  assert.equal((await sam.json('POST', '/api/gear/999/buy')).status, 404);
});

test('you wear what you own, in its own slot, and everybody sees it', async (t) => {
  const { app, sam } = await studio(t);
  const crown = (await make(app.client, 'head', 'Crown')).body;
  const cape = (await make(app.client, 'body', 'Cape')).body;

  assert.equal((await sam.json('PUT', '/api/me/avatar', { body: { head: crown.id } })).status, 404,
    'not Sam\'s to wear');
  assert.equal((await app.client.json('PUT', '/api/me/avatar', { body: { head: cape.id } })).status, 400,
    'a body on a head');
  const worn = await app.client.json('PUT', '/api/me/avatar', { body: { head: crown.id, body: cape.id } });
  assert.deepEqual(worn.body, { head: crown.id, body: cape.id, legs: null });
  assert.deepEqual(
    (await app.client.json('PUT', '/api/me/avatar', { body: { body: null } })).body,
    { head: crown.id, body: null, legs: null }, 'taking one off leaves the others',
  );

  assert.deepEqual((await app.client.json('GET', '/api/me')).body.avatar, { head: crown.id, body: null, legs: null });
  const crew = (await sam.json('GET', '/api/users')).body;
  assert.deepEqual(crew.find((p) => p.display_name === 'Dann').avatar, { head: crown.id, body: null, legs: null });
  assert.deepEqual(crew.find((p) => p.display_name === 'Sam').avatar, { head: null, body: null, legs: null });
});

test('the catalog shows whoever made each game as their avatar, never their name', async (t) => {
  const { app } = await studio(t);
  const games = await startGames(app);
  t.after(() => games.close());
  const crown = (await make(app.client, 'head', 'Crown')).body;
  await app.client.json('PUT', '/api/me/avatar', { body: { head: crown.id } });
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });

  const page = await (await games.client.request('GET', '/')).text();
  const maker = page.match(/<span class="maker"[^>]*>.*?<\/span>/s)?.[0] ?? '';
  assert.match(maker, /title="made by Alias \d+"/);
  assert.match(maker, new RegExp(`<img class="head" src="/_gear/${crown.id}"`));
  assert.match(maker, /<img class="body" src="data:image\/svg\+xml,/, 'the bare shape where nothing is worn');
  assert.doesNotMatch(page, /Dann/);

  const picture = await games.client.request('GET', `/_gear/${crown.id}`);
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  assert.equal((await games.client.request('GET', '/_gear/999')).status, 404);
});
