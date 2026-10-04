import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createUser } from '../server/auth.js';
import { aliasProblem, setAlias, MAX_ALIAS_CHARS } from '../server/alias.js';
import {
  setup, signIn, playerSignIn, startGames, scratchDir,
} from './helpers.js';

// Two accounts on a bare database: Robin Fox, and Sam, who is Rocket.
function accounts() {
  const db = openDb(':memory:');
  const robin = createUser(db, { email: 'robin@example.com', password: 'hunter2', displayName: 'Robin Fox' });
  const sam = createUser(db, { email: 'sam@example.com', password: 'hunter2', displayName: 'Sam' });
  setAlias(db, sam, 'Rocket');
  return { db, robin, sam };
}

test('every account is born with its starting alias', () => {
  const { robin, sam } = accounts();
  assert.equal(robin.alias, `Alias ${robin.id}`);
  assert.notEqual(robin.id, sam.id);
});

test('an alias is refused when it would be a real name or somebody else\'s', () => {
  const { db, robin, sam } = accounts();
  // A bidi override and a zero-width space, as codepoints so no invisible
  // byte sits in this file.
  const [rlo, zwsp] = [0x202e, 0x200b].map((c) => String.fromCodePoint(c));
  const refused = [
    ['', /at least one letter/],
    ['x'.repeat(MAX_ALIAS_CHARS + 1), /stops at 24/],
    [`Ot${rlo}ter`, /will not print/],
    [`Ot${zwsp}ter`, /will not print/],
    ['Robin Fox', /real name/],
    ['robin  fox', /real name/],
    ['ROBIN', /real name/, 'the first word alone'],
    [`Alias ${sam.id}`, /starting alias/, 'somebody else\'s starting alias'],
    ['alias 999', /starting alias/, 'one nobody has yet'],
    ['rocket', /already has/, 'whatever the case'],
  ];
  for (const [alias, reason, why = alias] of refused) {
    assert.match(aliasProblem(db, robin, alias) ?? 'accepted', reason, why);
  }
  // A guard, not a wall: the name inside something longer goes through, and
  // so does your own starting alias, however it is spaced.
  for (const alias of ['Robin Foxy', `Alias ${robin.id}`, `alias  ${robin.id}`]) {
    assert.equal(aliasProblem(db, robin, alias), null, alias);
  }
  assert.equal(aliasProblem(db, sam, 'ROCKET'), null, 'your own alias is not somebody else\'s');
});

test('setting an alias trims it, keeps it, and refuses with a 400 that says why', () => {
  const { db, robin } = accounts();
  assert.equal(setAlias(db, robin, '  Otter  '), 'Otter');
  assert.equal(db.prepare('SELECT alias FROM users WHERE id = ?').get(robin.id).alias, 'Otter');
  assert.throws(() => setAlias(db, robin, 'Rocket'),
    (err) => err.status === 400 && /already has/.test(err.message));
});

test('you set your own alias in the studio, and an admin can set anybody\'s', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const me = (await app.client.json('GET', '/api/me')).body;
  assert.equal(me.alias, `Alias ${me.id}`);

  const set = await app.client.json('PATCH', '/api/me', { body: { alias: 'Captain' } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body, { alias: 'Captain' });
  assert.equal((await app.client.json('GET', '/api/me')).body.alias, 'Captain');

  const own = await app.client.json('PATCH', '/api/me', { body: { alias: 'Dann' } });
  assert.equal(own.status, 400);
  assert.match(own.body.error, /real name/);
  assert.equal((await app.client.json('PATCH', '/api/me', { body: {} })).status, 400);

  // The admin panel goes through the same door, for anybody.
  const robin = createUser(app.db, {
    email: 'robin@example.com', password: 'hunter2', displayName: 'Robin',
  });
  const byAdmin = await app.client.json('PATCH', `/api/admin/users/${robin.id}`, {
    body: { alias: 'Otter' },
  });
  assert.equal(byAdmin.status, 200);
  assert.equal(byAdmin.body.alias, 'Otter');
  const clash = await app.client.json('PATCH', `/api/admin/users/${robin.id}`, {
    body: { alias: 'captain' },
  });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /already has/);

  // Anybody who is not an admin changes their own and nobody else's.
  const other = app.newClient();
  await (await other.post('/api/login', { email: 'robin@example.com', password: 'hunter2' })).text();
  const theirs = await other.json('PATCH', `/api/admin/users/${me.id}`, { body: { alias: 'Gotcha' } });
  assert.equal(theirs.status, 403);
  assert.equal((await app.client.json('GET', '/api/me')).body.alias, 'Captain');
});

// ⚠️ The invariant, walked: every answer the games origin gives about people,
// with a player signed in, a score on the board and a trophy held — and the
// account's name in none of them.
test('the games origin never says an account\'s name, only its alias', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const games = await startGames(app);
  t.after(() => games.close());
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });
  await app.client.json('PUT', '/api/projects/tank/files/config/achievements.js', {
    rawBody: 'const ACHIEVEMENTS = [\n'
      + '  { id: "first", name: "First run", how: "Finish a run", when: { moment: "run-over" } },\n'
      + '];\n',
    headers: { 'content-type': 'application/octet-stream' },
  });

  const robin = await playerSignIn(app, games, {
    email: 'robin@example.com', displayName: 'Robin Realname', alias: 'Otter',
  });
  await robin.json('POST', '/_scores/tank', { body: { score: 10 } });
  await robin.json('POST', '/_achievements/tank', { body: { id: 'first' } });

  const login = await games.newClient().json('POST', '/_login', {
    body: { email: 'robin@example.com', password: 'hunter2' },
  });
  const said = [JSON.stringify(login.body)];
  for (const url of ['/', '/tank/_players', '/_scores/tank', '/_me', '/_achievements/tank']) {
    said.push(await (await robin.request('GET', url)).text());
  }
  for (const text of said) assert.doesNotMatch(text, /Realname/);
  assert.ok(said.filter((text) => text.includes('Otter')).length >= 4, 'the alias says it instead');
});

test('the games origin asks every crawler to stay out', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const games = await startGames(app);
  t.after(() => games.close());
  const res = await games.client.request('GET', '/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.equal(await res.text(), 'User-agent: *\nDisallow: /\n');
});

// Aliases arriving: every account gets its starting one, a signed-in
// player's rows on the boards say it instead of the name, and the rows typed
// before there was a sign-in — a name and no account — are gone.
test('aliases arrive on an older database and take the names off its boards', () => {
  const file = path.join(scratchDir('db'), 'studio.db');
  let db = openDb(file);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, created_at)
     VALUES ('a@b.c', 'x', 'Dann Realname', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO projects (slug, name, kind, created_by, created_at)
     VALUES ('tank', 'Tank', 'game', 1, ?)`,
  ).run(now);
  // Put the table back the way a database from before this looked.
  db.exec('DROP INDEX idx_users_alias');
  db.exec('ALTER TABLE users DROP COLUMN alias');
  db.prepare(
    `INSERT INTO scores (project_id, name, score, created_at, user_id)
     VALUES (1, 'Dann Realname', 50, ?, 1), (1, 'typed by a stranger', 70, ?, NULL)`,
  ).run(now, now);
  db.close();

  db = openDb(file);
  assert.equal(db.prepare('SELECT alias FROM users WHERE id = 1').get().alias, 'Alias 1');
  const rows = db.prepare('SELECT name, score FROM scores').all()
    .map(({ name, score }) => ({ name, score }));
  assert.deepEqual(rows, [{ name: 'Alias 1', score: 50 }]);
  db.close();
});
