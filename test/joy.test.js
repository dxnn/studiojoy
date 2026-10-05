// Chips and joy (server/joy.js, ideas/dreams.md §5): authors are given chips
// every week into a stash that holds fifty, put them on their published games'
// achievements for good, and every player who holds one of those ends up paid
// as much joy as it has chips — its editors too, never twice, and never from a
// game that is not published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, playerSignIn, startGames } from './helpers.js';
import { openDb } from '../server/db.js';
import { createUser } from '../server/auth.js';
import {
  CHIPS_A_WEEK, STASH_MOST, joyOf, stashOf, weekOf, settleAllJoy,
} from '../server/joy.js';

const FILE = `
const ACHIEVEMENTS = [
  { id: "first-run", name: "First run", how: "Finish a run", icon: "🚀", when: { moment: "run-over" } },
  { id: "halfway", name: "Halfway there", how: "Reach level 5", when: { moment: "level", atLeast: 5 } },
];
`;

test('a week is the Monday it falls in, in UTC', () => {
  assert.equal(weekOf(new Date('2026-10-04T23:00:00Z')), '2026-09-28', 'a Sunday is the end of its week');
  assert.equal(weekOf(new Date('2026-10-05T00:00:00Z')), '2026-10-05');
  assert.equal(weekOf(new Date('2026-10-07T12:00:00Z')), '2026-10-05');
});

test('the stash gets ten a week, the weeks nobody looked added later, and holds fifty', () => {
  const db = openDb(':memory:');
  const dann = createUser(db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });
  const at = (day) => new Date(`${day}T12:00:00Z`);
  assert.equal(CHIPS_A_WEEK, 10);
  assert.equal(STASH_MOST, 50);
  assert.equal(stashOf(db, dann.id, at('2026-10-05')), 10, 'the first look is this week');
  assert.equal(stashOf(db, dann.id, at('2026-10-08')), 10, 'once a week');
  assert.equal(stashOf(db, dann.id, at('2026-10-26')), 40, 'three weeks unlooked, added at once');
  assert.equal(stashOf(db, dann.id, at('2027-03-01')), 50, 'and never past fifty');

  // Nobody without the studio authors anything, so nobody gives them chips.
  const pat = createUser(db, { email: 'pat@example.com', password: 'hunter2', displayName: 'Pat' });
  db.prepare('UPDATE users SET studio_access = 0 WHERE id = ?').run(pat.id);
  assert.equal(stashOf(db, pat.id, at('2026-10-05')), 0);
});

// A studio where Dann authors Tank, with two achievements and Pat signed in
// on the games origin.
async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  const dann = await signIn(app);
  const games = await startGames(app, { unlockRate: { max: 1000 } });
  t.after(() => games.close());
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('PUT', '/api/projects/tank/files/config/achievements.js', {
    rawBody: FILE, headers: { 'content-type': 'application/octet-stream' },
  });
  await playerSignIn(app, games);
  const pat = app.db.prepare("SELECT id FROM users WHERE email = 'pat@example.com'").get();
  return { app, games, dann, pat };
}

const put = (app, id, chips, client = app.client) =>
  client.json('POST', `/api/projects/tank/achievements/${id}/chips`, { body: { chips } });
const publish = (app, published) =>
  app.client.json('POST', '/api/projects/tank/publish', { body: { published } });
const unlock = (client, id) => client.json('POST', '/_achievements/tank', { body: { id } });

test('an author puts chips on a published game\'s achievement, from their stash, for good', async (t) => {
  const { app } = await studio(t);

  const before = await app.client.json('GET', '/api/projects/tank/achievements');
  assert.equal(before.body.stash, 10);
  assert.equal(before.body.can_put, false, 'not published yet');
  assert.equal((await put(app, 'first-run', 3)).status, 409, 'chips go on a published game');

  await publish(app, true);
  const first = await put(app, 'first-run', 3);
  assert.equal(first.status, 201);
  assert.deepEqual(first.body, { joy: 3, stash: 7 });
  assert.deepEqual((await put(app, 'first-run', 2)).body, { joy: 5, stash: 5 }, 'more chips, more joy');

  const after = await app.client.json('GET', '/api/projects/tank/achievements');
  assert.equal(after.body.can_put, true);
  assert.deepEqual(after.body.achievements.map((a) => [a.id, a.joy]), [['first-run', 5], ['halfway', 0]]);

  const short = await put(app, 'halfway', 6);
  assert.equal(short.status, 409);
  assert.match(short.body.error, /5 chips in your stash/);
  assert.equal((await put(app, 'nope', 1)).status, 404);
  for (const chips of [0, -2, 1.5, '3', null]) {
    assert.equal((await put(app, 'halfway', chips)).status, 400, String(chips));
  }

  // Somebody in the studio who is not one of its editors — even of an open
  // game — puts nothing on it.
  const sam = app.newClient();
  await signIn(app, { email: 'sam@example.com', displayName: 'Sam', client: sam });
  assert.equal((await put(app, 'halfway', 1, sam)).status, 403);
  const theirs = await sam.json('GET', '/api/projects/tank/achievements');
  assert.equal(theirs.body.can_put, false);
});

test('every holder ends up paid what it gives now: editors too, never twice', async (t) => {
  const { app, games, dann, pat } = await studio(t);
  await publish(app, true);

  // Earned before any chips: nothing yet — then paid when they go on, and
  // the difference when more do (Dann, 2026-10-05).
  assert.deepEqual((await unlock(games.client, 'halfway')).body, { new: true, joy: 0 });
  await put(app, 'halfway', 2);
  assert.equal(joyOf(app.db, pat.id), 2, 'paid when the chips go on');
  await put(app, 'halfway', 3);
  assert.equal(joyOf(app.db, pat.id), 5, 'topped up to what it gives now');

  await put(app, 'first-run', 3);
  assert.deepEqual((await unlock(games.client, 'first-run')).body, { new: true, joy: 3 });
  assert.deepEqual((await unlock(games.client, 'first-run')).body, { new: false, joy: 0 });
  assert.equal(joyOf(app.db, pat.id), 8);

  // A second player gets the same: a bounty, not a pool.
  const sky = games.newClient();
  await playerSignIn(app, games, { email: 'sky@example.com', displayName: 'Sky', client: sky });
  assert.equal((await unlock(sky, 'first-run')).body.joy, 3);

  // Dann made the game, and playing it pays him like anybody else.
  const own = games.newClient();
  await playerSignIn(app, games, { email: 'dann@example.com', client: own });
  assert.deepEqual((await unlock(own, 'first-run')).body, { new: true, joy: 3 });
  assert.equal(joyOf(app.db, dann.id), 3);

  // Unpublished, an earn pays nothing yet — the chips stay where they were
  // put — and publishing it again pays what it owes.
  await publish(app, false);
  const lee = games.newClient();
  await playerSignIn(app, games, { email: 'lee@example.com', displayName: 'Lee', client: lee });
  assert.deepEqual((await unlock(lee, 'first-run')).body, { new: true, joy: 0 });
  const leeId = app.db.prepare("SELECT id FROM users WHERE email = 'lee@example.com'").get().id;
  assert.equal(joyOf(app.db, leeId), 0);
  await publish(app, true);
  assert.equal(joyOf(app.db, leeId), 3);
  assert.equal(joyOf(app.db, pat.id), 8, 'and nobody already paid is paid again');
  const list = await games.client.json('GET', '/_achievements/tank');
  assert.deepEqual(list.body.achievements.map((a) => a.joy), [3, 5]);
});

// What the old rules left unpaid — an earn before the chips, an editor's —
// lands as the studio starts, and never twice.
test('starting the studio pays what the old rules left owing, once', () => {
  const db = openDb(':memory:');
  const dann = createUser(db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });
  const pat = createUser(db, { email: 'pat@example.com', password: 'hunter2', displayName: 'Pat' });
  const tank = Number(db.prepare(
    "INSERT INTO projects (slug, name, created_by, created_at, published) VALUES ('tank', 'Tank', ?, '2026-10-01', 1)",
  ).run(dann.id).lastInsertRowid);
  db.prepare(
    "INSERT INTO ledger (user_id, currency, delta, why, project_id, achievement, created_at) VALUES (?, 'chips', -4, 'put', ?, 'first-run', '2026-10-02')",
  ).run(dann.id, tank);
  for (const who of [dann.id, pat.id]) {
    db.prepare(
      "INSERT INTO achievements (project_id, user_id, achievement, created_at) VALUES (?, ?, 'first-run', '2026-10-01')",
    ).run(tank, who);
  }
  settleAllJoy(db);
  assert.equal(joyOf(db, pat.id), 4, 'earned before the chips');
  assert.equal(joyOf(db, dann.id), 4, 'an editor too');
  settleAllJoy(db);
  assert.equal(joyOf(db, pat.id), 4, 'never twice');
});

test('the joy shows: the catalog card, the header, the players page and your settings', async (t) => {
  const { app, games } = await studio(t);
  await publish(app, true);
  await put(app, 'first-run', 3);
  await put(app, 'halfway', 4);

  const anon = await (await games.newClient().request('GET', '/')).text();
  assert.match(anon, /<span class="joy"><small>joy to earn<\/small> 7<\/span>/, 'everything on offer');

  await unlock(games.client, 'first-run');
  const pats = await (await games.client.request('GET', '/')).text();
  assert.match(pats, /<small>joy to earn<\/small> 4</, 'what Pat has not earned yet');
  assert.match(pats, /<span class="joy">3 <small>joy<\/small><\/span>/, 'and Pat\'s own joy beside the alias');

  const own = games.newClient();
  await playerSignIn(app, games, { email: 'dann@example.com', client: own });
  const danns = await (await own.request('GET', '/')).text();
  assert.match(danns, /<small>joy to earn<\/small> 7</, 'your own game pays you too');

  const players = await (await games.client.request('GET', '/tank/_players')).text();
  assert.match(players, /<span class="joy">3 <small>joy<\/small><\/span>/);

  const me = await app.client.json('GET', '/api/me');
  assert.equal(me.body.joy, 0);
  assert.equal(me.body.stash, 3, 'ten, less the seven put on Tank');
});
