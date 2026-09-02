import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, playerSignIn, startGames } from './helpers.js';
import { createLockout } from '../server/auth.js';
import { PLAYER_SESSION_DAYS, createPlayerSession } from '../server/players.js';

// Spelled as codepoints rather than typed in: invisible bytes in a source
// file grep badly and die silently if an editor normalises them.
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const ZWSP = String.fromCodePoint(0x200b); // zero-width space

// The games origin's own sign-in: same accounts as the studio, separate
// sessions, and a public sign-up that only ever feeds the waiting list.

async function origins(t, opts = {}) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const games = await startGames(app, opts);
  t.after(() => games.close());
  return { app, games };
}

test('a player signs in, is somebody at /_me, and signs out', async (t) => {
  const { app, games } = await origins(t);

  const nobody = await games.client.json('GET', '/_me');
  assert.equal(nobody.status, 200);
  assert.deepEqual(nobody.body, { user: null });
  assert.equal(nobody.headers.get('cache-control'), 'no-store');

  const res = await games.client.request('POST', '/_login', {
    body: { email: 'dann@example.com', password: 'hunter2' },
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie()[0];
  assert.match(cookie, /^player=/, 'its own cookie, never `session`');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=/, 'player sessions expire');
  assert.deepEqual(await res.json(), { user: { name: 'Dann' } });

  const somebody = await games.client.json('GET', '/_me');
  assert.deepEqual(somebody.body, { user: { name: 'Dann' } });

  const out = await games.client.request('POST', '/_logout', { body: {} });
  assert.equal(out.status, 204);
  await out.text();
  assert.match(out.headers.getSetCookie()[0], /^player=;/, 'the cookie is cleared');
  assert.deepEqual((await games.client.json('GET', '/_me')).body, { user: null });
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM player_sessions').get().c, 0,
    'the row went with it');
});

test('a bad login is refused, and the games origin has its own lockout', async (t) => {
  const { games } = await origins(t, {
    emailLockout: createLockout({ maxFailures: 2, windowMs: 60_000, lockoutMs: 60_000 }),
  });

  const wrong = await games.client.json('POST', '/_login', {
    body: { email: 'dann@example.com', password: 'nope' },
  });
  assert.equal(wrong.status, 401);
  const unknown = await games.client.json('POST', '/_login', {
    body: { email: 'stranger@example.com', password: 'nope' },
  });
  assert.equal(unknown.status, 401, 'same refusal for an unknown address');

  await games.client.json('POST', '/_login', {
    body: { email: 'dann@example.com', password: 'still nope' },
  });
  const locked = await games.client.json('POST', '/_login', {
    body: { email: 'dann@example.com', password: 'hunter2' },
  });
  assert.equal(locked.status, 429, 'locked even with the right password');
});

test('the two sessions never cross origins', async (t) => {
  const { app, games } = await origins(t);
  await playerSignIn(app, games, { email: 'dann@example.com', displayName: 'Dann' });

  // The player cookie says nothing to the studio…
  const onStudio = app.newClient();
  onStudio.use(games.client.peek());
  assert.equal((await onStudio.json('GET', '/api/me')).status, 401);

  // …and a player token pasted into a `session` cookie is not a session.
  const token = games.client.peek().replace(/^player=/, '');
  const forged = app.newClient();
  forged.use(`session=${token}`);
  assert.equal((await forged.json('GET', '/api/me')).status, 401);
});

test('a player session ages out where a studio session does not', async (t) => {
  const { app, games } = await origins(t);
  const user = app.db.prepare('SELECT id FROM users').get();
  const stale = new Date(Date.now() - (PLAYER_SESSION_DAYS + 1) * 24 * 60 * 60 * 1000);
  const token = createPlayerSession(app.db, user.id, stale);

  games.client.use(`player=${token}`);
  assert.deepEqual((await games.client.json('GET', '/_me')).body, { user: null });
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM player_sessions WHERE token = ?').get(token).c,
    0, 'the stale row was swept on the way past',
  );
});

test('a removed account cannot sign in as a player either', async (t) => {
  const { app, games } = await origins(t);
  const { removeAccount, createUser } = await import('../server/auth.js');
  const gone = createUser(app.db, {
    email: 'gone@example.com', password: 'hunter2', displayName: 'Gone',
  });
  removeAccount(app.db, gone.id);
  const res = await games.client.json('POST', '/_login', {
    body: { email: 'gone@example.com', password: 'hunter2' },
  });
  assert.equal(res.status, 401);
});

test('sign-up joins the waiting list; the answer never says what an address is', async (t) => {
  const { app, games } = await origins(t);

  const asked = await games.client.json('POST', '/_signup', {
    body: { name: 'Robin Fox', email: 'robin@example.com', password: 'secret7' },
  });
  assert.equal(asked.status, 202);
  assert.deepEqual(asked.body, { waiting: true });
  const row = app.db.prepare('SELECT * FROM signups').get();
  assert.equal(row.email, 'robin@example.com');
  assert.equal(row.display_name, 'Robin Fox');
  assert.ok(row.password_hash.startsWith('scrypt$'), 'hashed on the way in');

  // The same answer for an address already waiting, and for one that is an
  // account — and neither writes a second row.
  const again = await games.client.json('POST', '/_signup', {
    body: { name: 'Robin', email: 'robin@example.com', password: 'secret7' },
  });
  assert.equal(again.status, 202);
  const taken = await games.client.json('POST', '/_signup', {
    body: { name: 'Dann?', email: 'dann@example.com', password: 'secret7' },
  });
  assert.equal(taken.status, 202);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM signups').get().c, 1);

  // Waiting is not in: the login form does not know them yet.
  const early = await games.client.json('POST', '/_login', {
    body: { email: 'robin@example.com', password: 'secret7' },
  });
  assert.equal(early.status, 401);
});

test('a sign-up that cannot be an account is a 400 that says why', async (t) => {
  // The limit out of the way: six refusals still count against it.
  const { games } = await origins(t, { signupRate: { max: 100 } });
  const bad = [
    { name: 'Robin', email: 'not-an-email', password: 'secret7' },
    { name: '  ', email: 'robin@example.com', password: 'secret7' },
    { name: 'a\tb', email: 'robin@example.com', password: 'secret7' },
    // The path validator's class too: a bidi override or a zero-width space
    // would print as another name on the board.
    { name: `Rob${RLO}in`, email: 'robin@example.com', password: 'secret7' },
    { name: `Ro${ZWSP}bin`, email: 'robin@example.com', password: 'secret7' },
    { name: 'x'.repeat(101), email: 'robin@example.com', password: 'secret7' },
    { name: 'Robin', email: 'robin@example.com', password: 'short' },
    { name: 'Robin', email: 'robin@example.com' },
  ];
  for (const body of bad) {
    const res = await games.client.json('POST', '/_signup', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error, 'the refusal carries a reason');
  }
});

test('sign-ups are rate limited per address, harder than scores', async (t) => {
  const { games } = await origins(t, {
    signupRate: { max: 2, windowMs: 60_000, what: 'signups' },
  });
  const ask = (i) => games.client.json('POST', '/_signup', {
    body: { name: `Kid ${i}`, email: `kid${i}@example.com`, password: 'secret7' },
  });
  assert.equal((await ask(1)).status, 202);
  assert.equal((await ask(2)).status, 202);
  const blocked = await ask(3);
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /signups/);
});

// A fresh address per ask would sidestep the limit entirely if the header
// were read here, which is why reading it takes a flag.
test('the forwarded address is ignored when the proxy is not trusted', async (t) => {
  const { games } = await origins(t, {
    signupRate: { max: 2, windowMs: 60_000, what: 'signups' },
  });
  const ask = (ip, i) => games.client.json('POST', '/_signup', {
    body: { name: `Kid ${i}`, email: `kid${i}@example.com`, password: 'secret7' },
    headers: { 'x-forwarded-for': ip },
  });
  assert.equal((await ask('203.0.113.1', 1)).status, 202);
  assert.equal((await ask('203.0.113.2', 2)).status, 202);
  assert.equal((await ask('203.0.113.3', 3)).status, 429, 'the header changed nothing');
});

// Every residential IPv6 connection is a /64 at least, so the bucket is the
// prefix: a fresh address inside it is the same asker (spec.md §6).
test('an IPv6 asker is limited by their /64, not by each address they can mint', async (t) => {
  const { games } = await origins(t, {
    trustProxy: true, signupRate: { max: 2, windowMs: 60_000, what: 'signups' },
  });
  const ask = (ip, i) => games.client.json('POST', '/_signup', {
    body: { name: `Kid ${i}`, email: `kid${i}@example.com`, password: 'secret7' },
    headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
  });
  assert.equal((await ask('2001:db8:1:2::1', 1)).status, 202);
  assert.equal((await ask('2001:db8:1:2:ffff::2', 2)).status, 202);
  assert.equal((await ask('2001:db8:1:2:abcd::3', 3)).status, 429, 'same /64, same bucket');
  assert.equal((await ask('2001:db8:1:3::1', 4)).status, 202, 'the next /64 is somebody else');
});

test('approval makes a player account: games origin yes, studio no', async (t) => {
  const { app, games } = await origins(t);
  await games.client.json('POST', '/_signup', {
    body: { name: 'Robin Fox', email: 'robin@example.com', password: 'secret7' },
  });
  const { waiting } = (await app.client.json('GET', '/api/admin/studio')).body;
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].email, 'robin@example.com');

  const approved = await app.client.json('POST', `/api/admin/signups/${waiting[0].id}/approve`, {
    body: {},
  });
  assert.equal(approved.status, 201);
  assert.equal(approved.body.studio_access, false);
  assert.equal(approved.body.admin, false);

  // The password they chose at sign-up works on the games origin…
  const robin = games.newClient();
  const play = await robin.json('POST', '/_login', {
    body: { email: 'robin@example.com', password: 'secret7' },
  });
  assert.equal(play.status, 200);
  assert.deepEqual(play.body, { user: { name: 'Robin Fox' } });

  // …and not on the studio, whose crew list does not know them.
  const studio = app.newClient();
  const front = await studio.post('/api/login', {
    email: 'robin@example.com', password: 'secret7',
  });
  assert.equal(front.status, 401);
  await front.text();
  const crew = await app.client.json('GET', '/api/users');
  assert.ok(!crew.body.some((u) => u.display_name === 'Robin Fox'));

  // Decided is decided: the row leaves the waiting list and cannot be
  // decided twice.
  assert.equal((await app.client.json('GET', '/api/admin/studio')).body.waiting.length, 0);
  const twice = await app.client.json(
    'POST', `/api/admin/signups/${waiting[0].id}/approve`, { body: {} },
  );
  assert.equal(twice.status, 404);
});

test('a refusal keeps the row, and who refused it, and shows none of it', async (t) => {
  const { app, games } = await origins(t);
  await games.client.json('POST', '/_signup', {
    body: { name: 'Nope', email: 'nope@example.com', password: 'secret7' },
  });
  const { waiting } = (await app.client.json('GET', '/api/admin/studio')).body;

  const refused = await app.client.json('POST', `/api/admin/signups/${waiting[0].id}/refuse`, {
    body: {},
  });
  assert.equal(refused.status, 204);

  const row = app.db.prepare('SELECT * FROM signups WHERE id = ?').get(waiting[0].id);
  assert.ok(row, 'kept, for the audit trail');
  assert.ok(row.refused_at, 'when');
  const admin = app.db.prepare('SELECT id FROM users WHERE admin = 1').get();
  assert.equal(row.refused_by, admin.id, 'and who');

  assert.equal((await app.client.json('GET', '/api/admin/studio')).body.waiting.length, 0);
  // The address stays decided: asking again neither errors nor re-opens it.
  const again = await games.client.json('POST', '/_signup', {
    body: { name: 'Nope', email: 'nope@example.com', password: 'secret7' },
  });
  assert.equal(again.status, 202);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM signups').get().c, 1);
  // No account, so no login.
  const login = await games.client.json('POST', '/_login', {
    body: { email: 'nope@example.com', password: 'secret7' },
  });
  assert.equal(login.status, 401);
});

test('only an admin decides the waiting list', async (t) => {
  const { app, games } = await origins(t);
  await games.client.json('POST', '/_signup', {
    body: { name: 'Robin', email: 'robin@example.com', password: 'secret7' },
  });
  const { waiting } = (await app.client.json('GET', '/api/admin/studio')).body;

  const plain = app.newClient();
  await signIn(app, { email: 'pal@example.com', displayName: 'Pal', client: plain });
  for (const verb of ['approve', 'refuse']) {
    const res = await plain.json('POST', `/api/admin/signups/${waiting[0].id}/${verb}`, {
      body: {},
    });
    assert.equal(res.status, 403, verb);
  }
});

test('the catalog signs its player in and out, and defends its form', async (t) => {
  const { app, games } = await origins(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });

  const out = await games.client.request('GET', '/');
  const anon = await out.text();
  assert.equal(out.headers.get('content-security-policy'), "frame-ancestors 'none'",
    'no game may frame the page holding the password form');
  assert.equal(out.headers.get('cross-origin-opener-policy'), 'same-origin',
    'and none may script a window it opened onto it');
  assert.match(anon, /Sign in/);
  assert.match(anon, /Ask to join/);

  await playerSignIn(app, games, { email: 'dann@example.com', displayName: 'Dann' });
  const home = await games.client.request('GET', '/');
  const html = await home.text();
  assert.match(html, /Dann/, 'the signed-in name is on the page');
  assert.match(html, /Sign out/);
  assert.doesNotMatch(html, /Ask to join/);
});

test('a game the board knows shows its top score on the card, in order', async (t) => {
  const { app, games } = await origins(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });

  const before = await games.client.request('GET', '/');
  assert.doesNotMatch(await before.text(), /top score/, 'no scores, no number');

  await playerSignIn(app, games, { email: 'dann@example.com', displayName: 'Dann' });
  await games.client.json('POST', '/_scores/tank', { body: { score: 4520 } });
  const after = await games.client.request('GET', '/');
  const html = await after.text();
  assert.match(html, /top score/);
  assert.match(html, /4,520/, 'formatted for reading, not for parsing');
});

// Signed in, a card says how you are doing: your own best on that board and
// your trophies against what the game defines — yours, never another player's,
// and nothing of the kind for the signed-out.
test('a card says your best and your trophies to whoever is signed in', async (t) => {
  const { app, games } = await origins(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });
  await app.client.json('PUT', '/api/projects/tank/files/config/achievements.js', {
    rawBody: 'const ACHIEVEMENTS = [\n'
      + '  { id: "first", name: "First run", how: "Finish a run", when: { moment: "run-over" } },\n'
      + '  { id: "ten", name: "Ten", how: "Reach level 10", when: { moment: "level", atLeast: 10 } },\n'
      + '];\n',
    headers: { 'content-type': 'application/octet-stream' },
  });

  const dann = await playerSignIn(app, games, { email: 'dann@example.com', displayName: 'Dann' });
  await dann.json('POST', '/_scores/tank', { body: { score: 4520 } });
  await dann.json('POST', '/_scores/tank', { body: { score: 300 } });
  await dann.json('POST', '/_achievements/tank', { body: { id: 'first' } });
  const pat = await playerSignIn(app, games, {
    email: 'pat@example.com', displayName: 'Pat', client: games.newClient(),
  });
  await pat.json('POST', '/_scores/tank', { body: { score: 1000 } });

  const mine = await (await dann.request('GET', '/')).text();
  assert.match(mine, /top score<\/small> 4,520/);
  assert.match(mine, /your best<\/small> 4,520/, 'the best, not the latest');
  assert.match(mine, /1 of 2/);

  const theirs = await (await pat.request('GET', '/')).text();
  assert.match(theirs, /top score<\/small> 4,520/, 'the board\'s top is everybody\'s');
  assert.match(theirs, /your best<\/small> 1,000/, 'the best is the signed-in player\'s own');
  assert.doesNotMatch(theirs, /your best<\/small> 4,520/);
  assert.match(theirs, /0 of 2/, 'trophies to be had, none yet');

  const nobody = await (await games.newClient().request('GET', '/')).text();
  assert.match(nobody, /top score/);
  assert.doesNotMatch(nobody, /your best/);
  assert.doesNotMatch(nobody, / of 2/);
});

// The games origin still never mints or honours a *studio* session; the
// player cookie is the only one it reads, and games.test.js keeps holding it
// to that for every game-file route.
test('game files are served without any sign-in, exactly as before', async (t) => {
  const { app, games } = await origins(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('PUT', '/api/projects/tank/files/index.html', {
    rawBody: '<h1>tank</h1>',
  });
  const fresh = games.newClient();
  const res = await fresh.request('GET', '/tank/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /tank/);
});
