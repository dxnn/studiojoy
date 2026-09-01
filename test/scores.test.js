import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, playerSignIn, startGames } from './helpers.js';
import { MAX_SCORE_ROWS, SCORE_POSTS_PER_MINUTE } from '../server/scores.js';

// A studio plus its public listener, with Pat signed in as a player — a
// score does not count without a sign-in now, and the name on the board is
// the account's. Most tests raise the rate limit out of the way; the ones
// about the rate limit use the default.
async function board(t, opts = { scoreRate: { max: 1000 } }) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const games = await startGames(app, opts);
  t.after(() => games.close());
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await playerSignIn(app, games);
  return { app, games };
}

// Two more players on their own cookie jars, for the tests about rank and
// whose name lands on a row.
async function morePlayers(app, games) {
  const sam = await playerSignIn(app, games, {
    email: 'sam@example.com', displayName: 'Sam', client: games.newClient(),
  });
  const kim = await playerSignIn(app, games, {
    email: 'kim@example.com', displayName: 'Kim', client: games.newClient(),
  });
  return { sam, kim };
}

const post = (games, body, client = games.client) =>
  client.json('POST', '/_scores/tank', { body });
const top = (games, q = '') => games.client.json('GET', `/_scores/tank${q}`);

test('scores post, rank, and come back best first under account names', async (t) => {
  const { app, games } = await board(t);
  const { sam, kim } = await morePlayers(app, games);

  const empty = await top(games);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { scores: [] });

  assert.deepEqual((await post(games, { score: 100 })).body, { rank: 1 });
  assert.deepEqual((await post(games, { score: 250 }, sam)).body, { rank: 1 });
  // A tie ranks behind the earlier post.
  assert.deepEqual((await post(games, { score: 100 }, kim)).body, { rank: 3 });

  const { status, body } = await top(games);
  assert.equal(status, 200);
  assert.deepEqual(body.scores, [
    { name: 'Sam', score: 250 },
    { name: 'Pat', score: 100 },
    { name: 'Kim', score: 100 },
  ]);
});

test('a post without a sign-in is refused and stores nothing', async (t) => {
  const { games } = await board(t);
  const anon = games.newClient();
  const res = await anon.json('POST', '/_scores/tank', { body: { score: 999 } });
  assert.equal(res.status, 401);
  assert.match(res.body.error, /sign in/i, 'the refusal tells the player what to do');
  assert.deepEqual((await top(games)).body.scores, []);
});

test('the name is the account\'s; whatever the body says is ignored', async (t) => {
  const { games } = await board(t);
  const res = await post(games, { name: 'Forged McPhony', score: 5 });
  assert.equal(res.status, 201);
  assert.deepEqual((await top(games)).body.scores, [{ name: 'Pat', score: 5 }]);
});

test('a long account name is squeezed to the board\'s width, not refused', async (t) => {
  const { app, games } = await board(t);
  const wide = await playerSignIn(app, games, {
    email: 'wide@example.com',
    displayName: 'Bartholomew Montgomery III',
    client: games.newClient(),
  });
  assert.equal((await post(games, { score: 1 }, wide)).status, 201);
  const { body } = await top(games);
  assert.equal(body.scores[0].name.length, 24);
  assert.equal(body.scores[0].name, 'Bartholomew Montgomery I');
});

test('the board answers ten by default and ?limit= is clamped, never an error', async (t) => {
  const { games } = await board(t);
  for (let i = 1; i <= 15; i++) await post(games, { score: i });

  assert.equal((await top(games)).body.scores.length, 10);
  assert.equal((await top(games, '?limit=3')).body.scores.length, 3);
  assert.equal((await top(games, '?limit=1000')).body.scores.length, 15);
  assert.equal((await top(games, '?limit=zero')).body.scores.length, 10);
  assert.equal((await top(games, '?limit=-2')).body.scores.length, 1);
});

test(`the board keeps the best ${MAX_SCORE_ROWS} and a miss is a null rank`, async (t) => {
  const { games } = await board(t);
  for (let i = 1; i <= MAX_SCORE_ROWS + 5; i++) {
    await post(games, { score: i });
  }

  const { body } = await top(games, `?limit=${MAX_SCORE_ROWS}`);
  assert.equal(body.scores.length, MAX_SCORE_ROWS);
  assert.equal(body.scores[0].score, MAX_SCORE_ROWS + 5);
  assert.equal(body.scores.at(-1).score, 6, 'the lowest five were pruned');

  // Below the floor: refused politely, and not stored.
  const miss = await post(games, { score: 3 });
  assert.equal(miss.status, 201);
  assert.deepEqual(miss.body, { rank: null });
  const after = await top(games, `?limit=${MAX_SCORE_ROWS}`);
  assert.equal(after.body.scores.at(-1).score, 6);
});

test('a personal best is kept per player, above the board\'s pruning', async (t) => {
  const { app, games } = await board(t);
  const { sam } = await morePlayers(app, games);

  // Pat's best is set, not lowered, and raised.
  await post(games, { score: 40 });
  await post(games, { score: 25 });
  await post(games, { score: 60 });
  // Sam's is Sam's own.
  await post(games, { score: 10 }, sam);
  // …and a hundred better runs from Sam prune Pat's rows off the board.
  for (let i = 100; i < 100 + MAX_SCORE_ROWS; i++) await post(games, { score: i }, sam);

  const bests = app.db.prepare(
    `SELECT u.display_name AS name, pb.score FROM personal_bests pb
       JOIN users u ON u.id = pb.user_id ORDER BY pb.score DESC`,
  ).all().map(({ name, score }) => ({ name, score }));
  assert.deepEqual(bests, [
    { name: 'Sam', score: 100 + MAX_SCORE_ROWS - 1 },
    { name: 'Pat', score: 60 },
  ], 'Pat\'s best survives being pruned off the board');
  const onBoard = await top(games, `?limit=${MAX_SCORE_ROWS}`);
  assert.ok(onBoard.body.scores.every((s) => s.name === 'Sam'), 'the board itself moved on');
});

test('a bad score is a 400 that says why', async (t) => {
  const { games } = await board(t);
  const bad = [
    {},
    { score: '100' },
    { score: 1.5 },
    { score: 2 ** 53 },
    { score: null },
  ];
  for (const body of bad) {
    const res = await post(games, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error, 'the refusal carries a reason');
  }
  // The boundary itself is fine.
  const edge = await post(games, { score: -(2 ** 53) + 1 });
  assert.equal(edge.status, 201);
  assert.equal((await top(games)).body.scores.length, 1);
});

test('a score post must declare application/json', async (t) => {
  const { games } = await board(t);
  const res = await games.client.request('POST', '/_scores/tank', {
    rawBody: '{"score":1}',
  });
  assert.equal(res.status, 415);
  await res.text();
  assert.deepEqual((await top(games)).body.scores, []);
});

test('an oversized score body is refused', async (t) => {
  const { games } = await board(t);
  const res = await post(games, { score: 1, padding: 'x'.repeat(2048) });
  assert.equal(res.status, 413);
});

test('only a game has a scoreboard', async (t) => {
  const { app, games } = await board(t);
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Talk', slug: 'talk', kind: 'chat' },
  });

  for (const slug of ['nope', 'talk', 'UPPER', '_scores']) {
    const get = await games.client.json('GET', `/_scores/${slug}`);
    assert.equal(get.status, 404, `GET ${slug}`);
    const posted = await games.client.json('POST', `/_scores/${slug}`, {
      body: { score: 1 },
    });
    assert.equal(posted.status, 404, `POST ${slug}`);
  }
});

test('an archived game still keeps score, because it is still playable', async (t) => {
  const { app, games } = await board(t);
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  assert.equal((await post(games, { score: 7 })).status, 201);
  assert.deepEqual((await top(games)).body.scores, [{ name: 'Pat', score: 7 }]);
});

test('posting is rate limited per address; reading is not', async (t) => {
  const { games } = await board(t, {});

  for (let i = 0; i < SCORE_POSTS_PER_MINUTE; i++) {
    const res = await post(games, { score: i });
    assert.equal(res.status, 201, `post ${i}`);
  }
  const blocked = await post(games, { score: 999 });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.body.retry_after > 0, 'says when to try again');

  const read = await top(games);
  assert.equal(read.status, 200, 'the board still reads while posting is blocked');
  assert.equal(read.body.scores[0].score, SCORE_POSTS_PER_MINUTE - 1, 'the blocked post was not stored');
});

// Behind a proxy every player shares the proxy's address, so without this the
// whole studio gets ten posts a minute between them.
test('the forwarded address is the bucket, but only when trusted', async (t) => {
  const { games } = await board(t, { trustProxy: true });
  const from = (ip, score) =>
    games.client.json('POST', '/_scores/tank', {
      body: { score },
      headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
    });

  for (let i = 0; i < SCORE_POSTS_PER_MINUTE; i++) {
    assert.equal((await from('203.0.113.7', i)).status, 201, `post ${i}`);
  }
  assert.equal((await from('203.0.113.7', 999)).status, 429, 'that player is done');
  assert.equal((await from('203.0.113.8', 1)).status, 201, 'the next one is not');
});

test('the forwarded address is ignored when the proxy is not trusted', async (t) => {
  const { games } = await board(t, {});
  const from = (ip, score) =>
    games.client.json('POST', '/_scores/tank', {
      body: { score },
      headers: { 'x-forwarded-for': ip },
    });

  // A fresh address per post would sidestep the limit entirely if the header
  // were read here, which is why reading it takes a flag.
  for (let i = 0; i < SCORE_POSTS_PER_MINUTE; i++) {
    assert.equal((await from(`203.0.113.${i}`, i)).status, 201, `post ${i}`);
  }
  assert.equal((await from('203.0.113.99', 999)).status, 429);
});

// ⚠️ The boundary, both ways round: the studio's session opens nothing here,
// and only the player cookie counts (spec.md §7).
test('a studio session is not a player: only the player cookie signs a score', async (t) => {
  const { app, games } = await board(t);

  const withStudioCookie = games.newClient();
  withStudioCookie.use(app.client.peek());
  const refused = await withStudioCookie.json('POST', '/_scores/tank', {
    body: { score: 1 },
  });
  assert.equal(refused.status, 401, 'the studio cookie means nothing on this origin');

  // The player cookie works, and a score post never echoes a cookie back.
  const res = await games.client.request('POST', '/_scores/tank', {
    body: { score: 1 },
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.headers.getSetCookie(), []);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  await res.text();
});

test('the scoreboard answers 405 to methods it does not have', async (t) => {
  const { games } = await board(t);
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const res = await games.client.request(method, '/_scores/tank', {
      rawBody: method === 'DELETE' ? undefined : 'x',
    });
    assert.equal(res.status, 405, method);
    await res.text();
  }
});

test('a switched-off scoreboard is 404 both ways, and keeps its rows', async (t) => {
  const { app, games } = await board(t);
  await post(games, { score: 100 });

  const off = await app.client.json('PATCH', '/api/projects/tank', {
    body: { scores_on: false },
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.scores_on, false);

  assert.equal((await top(games)).status, 404, 'reading is as gone as writing');
  assert.equal((await post(games, { score: 1 })).status, 404);

  // The rows were kept: the studio still lists them, and the public board
  // comes back whole when the switch goes back on.
  const kept = await app.client.json('GET', '/api/projects/tank/scores');
  assert.equal(kept.status, 200);
  assert.equal(kept.body.scores_on, false);
  assert.equal(kept.body.scores.length, 1);

  await app.client.json('PATCH', '/api/projects/tank', { body: { scores_on: true } });
  const back = await top(games);
  assert.equal(back.status, 200);
  assert.deepEqual(back.body.scores, [{ name: 'Pat', score: 100 }]);
});

test('the studio lists, deletes, and clears scores', async (t) => {
  const { app, games } = await board(t);
  const { sam, kim } = await morePlayers(app, games);
  await post(games, { score: 100 });
  await post(games, { score: 250 }, sam);
  await post(games, { score: 50 }, kim);

  const list = await app.client.json('GET', '/api/projects/tank/scores');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.scores.map((s) => s.name), ['Sam', 'Pat', 'Kim'], 'best first');
  assert.ok(list.body.scores.every((s) => s.id && s.created_at), 'ids and times, for the admin');

  // Delete the middle one; rank order closes over it.
  const pat = list.body.scores[1];
  const gone = await app.client.request('DELETE', `/api/projects/tank/scores/${pat.id}`);
  assert.equal(gone.status, 204);
  await gone.text();
  assert.deepEqual((await top(games)).body.scores.map((s) => s.name), ['Sam', 'Kim']);

  const again = await app.client.request('DELETE', `/api/projects/tank/scores/${pat.id}`);
  assert.equal(again.status, 404);
  await again.text();
  const bad = await app.client.request('DELETE', '/api/projects/tank/scores/potato');
  assert.equal(bad.status, 400);
  await bad.text();

  const cleared = await app.client.request('DELETE', '/api/projects/tank/scores');
  assert.equal(cleared.status, 204);
  await cleared.text();
  assert.deepEqual((await top(games)).body.scores, []);
});
