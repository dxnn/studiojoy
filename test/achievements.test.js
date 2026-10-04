import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, playerSignIn, startGames } from './helpers.js';
import { UNLOCKS_PER_MINUTE, MAX_ACHIEVEMENTS_FILE_BYTES } from '../server/achievements.js';

// A studio plus its public listener, a game whose config/achievements.js
// defines three achievements (and one entry outside the shape), and Pat
// signed in as a player. Most tests raise the rate limit out of the way.
const FILE = `
// What a player can earn.
const ACHIEVEMENTS = [
  { id: "first-run", name: "First run", how: "Finish a run", icon: "🚀", when: { moment: "run-over" } },
  { id: "halfway", name: "Halfway there", how: "Reach level 5", when: { moment: "level", atLeast: 5 } },
  { id: "Not Right", name: "skipped", when: { moment: "level" } },
  { id: "secret", name: "Secret room", how: "Find it" },
];
`;

const put = (app, body, p = 'config/achievements.js') =>
  app.client.json('PUT', `/api/projects/tank/files/${p}`, {
    rawBody: body, headers: { 'content-type': 'application/octet-stream' },
  });

async function studio(t, opts = { unlockRate: { max: 1000 } }) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const games = await startGames(app, opts);
  t.after(() => games.close());
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  assert.equal((await put(app, FILE)).status, 201);
  await playerSignIn(app, games);
  return { app, games };
}

const list = (games, client = games.client) => client.json('GET', '/_achievements/tank');
const unlock = (games, id, client = games.client) =>
  client.json('POST', '/_achievements/tank', { body: { id } });

test('the list is the file, in its order, with got for whoever is signed in', async (t) => {
  const { games } = await studio(t);

  const anon = await list(games, games.newClient());
  assert.equal(anon.status, 200);
  assert.equal(anon.headers.get('cache-control'), 'no-store');
  assert.deepEqual(anon.body.achievements, [
    { id: 'first-run', name: 'First run', how: 'Finish a run', icon: '🚀', got: null, joy: 0 },
    { id: 'halfway', name: 'Halfway there', how: 'Reach level 5', icon: null, got: null, joy: 0 },
    { id: 'secret', name: 'Secret room', how: 'Find it', icon: null, got: null, joy: 0 },
  ], 'the entry outside the shape is not there');

  const first = await unlock(games, 'first-run');
  assert.equal(first.status, 201);
  assert.deepEqual(first.body, { new: true, joy: 0 });
  const again = await unlock(games, 'first-run');
  assert.equal(again.status, 201);
  assert.deepEqual(again.body, { new: false, joy: 0 }, 'earning it twice is nothing');

  const mine = await list(games);
  assert.match(mine.body.achievements[0].got, /^\d{4}-\d{2}-\d{2}T/, 'when Pat earned it');
  assert.equal(mine.body.achievements[1].got, null);

  // Signed out again, nobody sees Pat's.
  const other = await list(games, games.newClient());
  assert.ok(other.body.achievements.every((a) => a.got === null));
});

test('an unlock takes a signed-in player, a defined id and a text body', async (t) => {
  const { app, games } = await studio(t);

  const anon = await unlock(games, 'first-run', games.newClient());
  assert.equal(anon.status, 401);
  assert.match(anon.body.error, /sign in/i);

  const unknown = await unlock(games, 'nope');
  assert.equal(unknown.status, 404);
  const skipped = await unlock(games, 'Not Right');
  assert.equal(skipped.status, 404, 'an entry outside the shape is not an achievement');

  for (const body of [{}, { id: 7 }, { id: null }]) {
    const bad = await games.client.json('POST', '/_achievements/tank', { body });
    assert.equal(bad.status, 400, JSON.stringify(body));
  }
  const big = await games.client.json('POST', '/_achievements/tank', {
    body: { id: 'first-run', padding: 'x'.repeat(2048) },
  });
  assert.equal(big.status, 413);
  const raw = await games.client.request('POST', '/_achievements/tank', { rawBody: '{"id":"first-run"}' });
  assert.equal(raw.status, 415);
  await raw.text();

  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM achievements').get().c, 0, 'none of that was stored');
});

test('each player holds their own, and the studio counts them', async (t) => {
  const { app, games } = await studio(t);
  const sam = await playerSignIn(app, games, {
    email: 'sam@example.com', displayName: 'Sam', client: games.newClient(),
  });
  await unlock(games, 'first-run');
  await unlock(games, 'secret');
  await unlock(games, 'first-run', sam);

  const pat = await list(games);
  assert.deepEqual(pat.body.achievements.map((a) => a.got !== null), [true, false, true]);
  const sams = await list(games, sam);
  assert.deepEqual(sams.body.achievements.map((a) => a.got !== null), [true, false, false]);

  const counts = await app.client.json('GET', '/api/projects/tank/achievements');
  assert.equal(counts.status, 200);
  assert.deepEqual(counts.body.achievements.map((a) => [a.id, a.players]), [
    ['first-run', 2], ['halfway', 0], ['secret', 1],
  ]);
  assert.equal(counts.body.achievements[0].name, 'First run');

  const out = await app.newClient().json('GET', '/api/projects/tank/achievements');
  assert.equal(out.status, 401, 'the studio side takes a studio sign-in');
});

// Permanent means permanent: the row outlives its definition, hidden until
// the id comes back.
test('removing a definition hides its rows; putting it back shows them again', async (t) => {
  const { app, games } = await studio(t);
  await unlock(games, 'first-run');

  await put(app, 'const ACHIEVEMENTS = [{ id: "halfway", name: "Halfway", when: { moment: "level", atLeast: 5 } }];');
  const without = await list(games);
  assert.deepEqual(without.body.achievements.map((a) => a.id), ['halfway']);
  assert.equal((await unlock(games, 'first-run')).status, 404, 'no longer defined, no longer earnable');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM achievements').get().c, 1, 'but the row is kept');

  await put(app, FILE);
  const back = await list(games);
  assert.ok(back.body.achievements[0].got, 'and it is Pat\'s again the moment the id is back');
  assert.deepEqual((await unlock(games, 'first-run')).body, { new: false, joy: 0 });
});

test('a game without the file has no achievements, and one that is not a list has none', async (t) => {
  const { app, games } = await studio(t);
  for (const text of ['const ACHIEVEMENTS = { id: "x" };', 'const ACHIEVEMENTS = [1 + 1];',
    'not a config file at all', `const ACHIEVEMENTS = [${'{ id: "a", name: "A" },'.repeat(3000)}];`]) {
    await put(app, text);
    const res = await list(games);
    assert.equal(res.status, 200, text.slice(0, 40));
    assert.deepEqual(res.body.achievements, [], text.slice(0, 40));
    assert.equal((await unlock(games, 'a')).status, 404);
  }
  assert.ok(`const ACHIEVEMENTS = [${'{ id: "a", name: "A" },'.repeat(3000)}];`.length > MAX_ACHIEVEMENTS_FILE_BYTES,
    'the last one is refused for its size alone');

  await app.client.request('DELETE', '/api/projects/tank/files/config/achievements.js').then((r) => r.text());
  const gone = await list(games);
  assert.deepEqual(gone.body.achievements, []);
  assert.equal((await unlock(games, 'first-run')).status, 404);
});

test('only a game has achievements', async (t) => {
  const { app, games } = await studio(t);
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Talk', slug: 'talk', kind: 'chat' },
  });
  for (const slug of ['nope', 'talk', 'UPPER', '_achievements']) {
    assert.equal((await games.client.json('GET', `/_achievements/${slug}`)).status, 404, `GET ${slug}`);
    const posted = await games.client.json('POST', `/_achievements/${slug}`, { body: { id: 'first-run' } });
    assert.equal(posted.status, 404, `POST ${slug}`);
  }
  const talk = await app.client.json('GET', '/api/projects/talk/achievements');
  assert.equal(talk.status, 409, 'a chat has no file to read');
});

test('an archived game still hands them out, because it is still playable', async (t) => {
  const { app, games } = await studio(t);
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  assert.deepEqual((await unlock(games, 'first-run')).body, { new: true, joy: 0 });
  assert.equal((await app.client.json('GET', '/api/projects/tank/achievements')).body.achievements[0].players, 1);
});

test('unlocking is rate limited per player; reading is not', async (t) => {
  const { app, games } = await studio(t, {});
  const sam = await playerSignIn(app, games, {
    email: 'sam@example.com', displayName: 'Sam', client: games.newClient(),
  });
  for (let i = 0; i < UNLOCKS_PER_MINUTE; i++) {
    assert.equal((await unlock(games, 'first-run')).status, 201, `unlock ${i}`);
  }
  const blocked = await unlock(games, 'secret');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.body.retry_after > 0);
  assert.equal((await unlock(games, 'secret', sam)).status, 201, 'another player, same address');
  assert.equal((await list(games)).status, 200);
  assert.equal((await list(games)).body.achievements[2].got, null, 'the blocked unlock was not stored');
});

// ⚠️ The boundary: the studio's session opens nothing here, only the player
// cookie counts (spec.md §7), and nothing echoes a cookie back.
test('a studio session is not a player', async (t) => {
  const { app, games } = await studio(t);
  const withStudioCookie = games.newClient();
  withStudioCookie.use(app.client.peek());
  assert.equal((await unlock(games, 'first-run', withStudioCookie)).status, 401);
  const res = await games.client.request('POST', '/_achievements/tank', { body: { id: 'first-run' } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.headers.getSetCookie(), []);
  await res.text();
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const r = await games.client.request(method, '/_achievements/tank', {
      rawBody: method === 'DELETE' ? undefined : 'x',
    });
    assert.equal(r.status, 405, method);
    await r.text();
  }
});
