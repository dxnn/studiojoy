import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, startGames } from './helpers.js';
import { MAX_SCORE_ROWS, SCORE_POSTS_PER_MINUTE } from '../server/scores.js';

// A studio plus its public listener. Most tests raise the rate limit out of
// the way; the one about the rate limit uses the default.
async function board(t, opts = { scoreRate: { max: 1000 } }) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const games = await startGames(app, opts);
  t.after(() => games.close());
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return { app, games };
}

const post = (games, body) => games.client.json('POST', '/_scores/tank', { body });
const top = (games, q = '') => games.client.json('GET', `/_scores/tank${q}`);

test('scores post, rank, and come back best first', async (t) => {
  const { games } = await board(t);

  const empty = await top(games);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { scores: [] });

  assert.deepEqual((await post(games, { name: 'Pat', score: 100 })).body, { rank: 1 });
  assert.deepEqual((await post(games, { name: 'Sam', score: 250 })).body, { rank: 1 });
  // A tie ranks behind the earlier post.
  assert.deepEqual((await post(games, { name: 'Kim', score: 100 })).body, { rank: 3 });

  const { status, body } = await top(games);
  assert.equal(status, 200);
  assert.deepEqual(body.scores, [
    { name: 'Sam', score: 250 },
    { name: 'Pat', score: 100 },
    { name: 'Kim', score: 100 },
  ]);
});

test('the board answers ten by default and ?limit= is clamped, never an error', async (t) => {
  const { games } = await board(t);
  for (let i = 1; i <= 15; i++) await post(games, { name: `p${i}`, score: i });

  assert.equal((await top(games)).body.scores.length, 10);
  assert.equal((await top(games, '?limit=3')).body.scores.length, 3);
  assert.equal((await top(games, '?limit=1000')).body.scores.length, 15);
  assert.equal((await top(games, '?limit=zero')).body.scores.length, 10);
  assert.equal((await top(games, '?limit=-2')).body.scores.length, 1);
});

test(`the board keeps the best ${MAX_SCORE_ROWS} and a miss is a null rank`, async (t) => {
  const { games } = await board(t);
  for (let i = 1; i <= MAX_SCORE_ROWS + 5; i++) {
    await post(games, { name: 'p', score: i });
  }

  const { body } = await top(games, `?limit=${MAX_SCORE_ROWS}`);
  assert.equal(body.scores.length, MAX_SCORE_ROWS);
  assert.equal(body.scores[0].score, MAX_SCORE_ROWS + 5);
  assert.equal(body.scores.at(-1).score, 6, 'the lowest five were pruned');

  // Below the floor: refused politely, and not stored.
  const miss = await post(games, { name: 'p', score: 3 });
  assert.equal(miss.status, 201);
  assert.deepEqual(miss.body, { rank: null });
  const after = await top(games, `?limit=${MAX_SCORE_ROWS}`);
  assert.equal(after.body.scores.at(-1).score, 6);
});

test('a bad entry is a 400 that says why', async (t) => {
  const { games } = await board(t);
  const bad = [
    {},
    { score: 1 },
    { name: '   ', score: 1 },
    { name: 42, score: 1 },
    { name: 'x'.repeat(25), score: 1 },
    { name: 'a\tb', score: 1 },
    { name: 'Pat' },
    { name: 'Pat', score: '100' },
    { name: 'Pat', score: 1.5 },
    { name: 'Pat', score: 2 ** 53 },
    { name: 'Pat', score: null },
  ];
  for (const body of bad) {
    const res = await post(games, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error, 'the refusal carries a reason');
  }
  // The boundaries themselves are fine.
  const edge = await post(games, { name: 'x'.repeat(24), score: -(2 ** 53) + 1 });
  assert.equal(edge.status, 201);
  assert.equal((await top(games)).body.scores.length, 1);
});

test('a score post must declare application/json', async (t) => {
  const { games } = await board(t);
  const res = await games.client.request('POST', '/_scores/tank', {
    rawBody: '{"name":"Pat","score":1}',
  });
  assert.equal(res.status, 415);
  await res.text();
  assert.deepEqual((await top(games)).body.scores, []);
});

test('an oversized score body is refused', async (t) => {
  const { games } = await board(t);
  const res = await post(games, { name: 'Pat', score: 1, padding: 'x'.repeat(2048) });
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
      body: { name: 'Pat', score: 1 },
    });
    assert.equal(posted.status, 404, `POST ${slug}`);
  }
});

test('an archived game still keeps score, because it is still playable', async (t) => {
  const { app, games } = await board(t);
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  assert.equal((await post(games, { name: 'Pat', score: 7 })).status, 201);
  assert.deepEqual((await top(games)).body.scores, [{ name: 'Pat', score: 7 }]);
});

test('posting is rate limited per address; reading is not', async (t) => {
  const { games } = await board(t, {});

  for (let i = 0; i < SCORE_POSTS_PER_MINUTE; i++) {
    const res = await post(games, { name: 'Pat', score: i });
    assert.equal(res.status, 201, `post ${i}`);
  }
  const blocked = await post(games, { name: 'Pat', score: 999 });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.body.retry_after > 0, 'says when to try again');

  const read = await top(games);
  assert.equal(read.status, 200, 'the board still reads while posting is blocked');
  assert.equal(read.body.scores[0].score, SCORE_POSTS_PER_MINUTE - 1, 'the blocked post was not stored');
});

test('the scoreboard reads no cookie and issues none', async (t) => {
  const { app, games } = await board(t);

  // Replay the studio's session at the games origin: same answer, no echo.
  games.client.use(app.client.peek());
  const res = await games.client.request('POST', '/_scores/tank', {
    body: { name: 'Pat', score: 1 },
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
