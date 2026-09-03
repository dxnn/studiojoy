import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setup, signIn } from './helpers.js';
import { createUser } from '../server/auth.js';

// For the two tests of what the studio actually serves: the rest of the suite
// runs against setup()'s stand-in public directory.
const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public');

test('login issues a session cookie that /api/me accepts', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  createUser(app.db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });

  const login = await app.client.json('POST', '/api/login', {
    body: { email: 'dann@example.com', password: 'hunter2' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.display_name, 'Dann');
  assert.equal(login.body.password_hash, undefined);

  const cookie = login.headers.getSetCookie()[0];
  assert.match(cookie, /^session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!/Secure/.test(cookie), 'not Secure unless NODE_ENV=production');

  const me = await app.client.json('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'dann@example.com');
  assert.equal(me.body.games_url, 'http://games.test');
  // Every load re-issues the same cookie, so its 400 days count from the last
  // visit: an open studio never asks for the password again.
  const again = me.headers.getSetCookie()[0];
  assert.equal(again.split(';')[0], cookie.split(';')[0], 'the same token, not a new session');
  assert.match(again, /Max-Age=34560000/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('the email is matched case-insensitively', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  createUser(app.db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });
  const res = await app.client.json('POST', '/api/login', {
    body: { email: '  Dann@Example.COM ', password: 'hunter2' },
  });
  assert.equal(res.status, 200);
});

test('a wrong password and an unknown email are indistinguishable', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  createUser(app.db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });

  const wrong = await app.client.json('POST', '/api/login', {
    body: { email: 'dann@example.com', password: 'nope' },
  });
  const unknown = await app.client.json('POST', '/api/login', {
    body: { email: 'nobody@example.com', password: 'nope' },
  });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body, 'the response must not disclose existence');
  assert.equal(wrong.headers.getSetCookie().length, 0, 'no cookie on failure');
});

test('login requires both fields', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  for (const body of [
    {}, { email: 'a@b.com' }, { password: 'x' },
    { email: '', password: 'x' }, { email: 'a@b.com', password: '' },
  ]) {
    const res = await app.client.json('POST', '/api/login', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('there is no signup route', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  for (const p of ['/api/signup', '/api/users', '/api/register']) {
    const res = await app.client.json('POST', p, { body: { email: 'x@y.com' } });
    assert.equal(res.status, 404, p);
  }
});

// The Crew tab lists the people beside the helpers, so it needs the people.
// Names and nothing else: a list of who is here does not need addresses in it.
test('the crew list is names, without addresses', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  createUser(app.db, { email: 'bea@example.com', displayName: 'Bea', password: 'hunter22' });
  await signIn(app);

  const res = await app.client.json('GET', '/api/users');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((u) => u.display_name).sort(), ['Bea', 'Dann']);
  for (const user of res.body) {
    assert.ok(user.id, 'each one is identified');
    assert.ok(!('email' in user), 'and no address travels with it');
    assert.ok(!('password_hash' in user));
  }
});

test('logout clears the cookie and the session', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  assert.equal((await app.client.json('GET', '/api/me')).status, 200);

  const out = await app.client.request('POST', '/api/logout');
  assert.equal(out.status, 204);
  await out.text();
  assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);

  assert.equal((await app.client.json('GET', '/api/me')).status, 401);
});

test('a session that was logged out cannot be replayed', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const stolen = app.client.peek();
  await (await app.client.request('POST', '/api/logout')).text();

  const replay = app.newClient();
  replay.use(stolen);
  assert.equal((await replay.json('GET', '/api/me')).status, 401);
});

test('every /api route refuses an anonymous caller', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const calls = [
    ['GET', '/api/me'],
    ['GET', '/api/users'],
    ['GET', '/api/projects'],
    ['POST', '/api/projects'],
    ['GET', '/api/projects/tank'],
    ['GET', '/api/agents'],
    ['POST', '/api/agents'],
    ['GET', '/api/stream'],
    ['GET', '/api/messages/1/receipt'],
    ['GET', '/api/messages/1/prompt'],
    ['GET', '/api/projects/tank/scores'],
    ['DELETE', '/api/projects/tank/scores'],
    ['DELETE', '/api/projects/tank/scores/1'],
  ];
  for (const [method, p] of calls) {
    const res = await app.client.request(
      method, p, method === 'GET' ? {} : { body: {} },
    );
    assert.equal(res.status, 401, `${method} ${p}`);
    await res.text();
  }
});

test('repeated failures lock the account out with a retry hint', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  createUser(app.db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });

  let locked = null;
  for (let i = 0; i < 12; i += 1) {
    const res = await app.client.json('POST', '/api/login', {
      body: { email: 'dann@example.com', password: 'wrong' },
    });
    if (res.status === 429) { locked = res; break; }
  }
  assert.ok(locked, 'expected a lockout within 12 attempts');
  assert.equal(typeof locked.body.retry_after, 'number');
  assert.match(locked.body.error, /try again in/);

  // The correct password is refused too while the lock holds — otherwise the
  // limiter would be trivially bypassable by the attacker who guessed right.
  const correct = await app.client.json('POST', '/api/login', {
    body: { email: 'dann@example.com', password: 'hunter2' },
  });
  assert.equal(correct.status, 429);
});

test('hardening headers are set on every response', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  for (const p of ['/', '/api/me', '/css/base.css', '/nope']) {
    const res = await app.client.request('GET', p);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', p);
    await res.text();
  }
});

test('the shell is served for client-side routes', async (t) => {
  const app = await setup({ publicDir: PUBLIC_DIR });
  t.after(() => app.close());
  for (const p of ['/', '/p/tank']) {
    const res = await app.client.request('GET', p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /<div id="root">/);
    // ⚠️ The shell starts the studio; main.js does not start itself on the
    // way in. That is what lets `npm test` import the client's render
    // functions without firing a studio at the server (test/conventions).
    assert.match(html, /from '\/main\.js'/);
    assert.match(html, /start\(\);/);
  }
});

test('the studio is installable as a PWA', async (t) => {
  const app = await setup({ publicDir: PUBLIC_DIR });
  t.after(() => app.close());

  const shell = await app.client.request('GET', '/');
  const html = await shell.text();
  assert.match(html, /<link rel="manifest" href="\/manifest\.json" \/>/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);

  const manifest = await app.client.request('GET', '/manifest.json');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /application\/json/);
  const parsed = await manifest.json();
  assert.equal(parsed.display, 'standalone');
  assert.equal(parsed.start_url, '/');
  assert.ok(parsed.icons.length >= 2, 'at least a regular and a maskable icon');

  const sw = await app.client.request('GET', '/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /text\/javascript/);

  for (const icon of parsed.icons) {
    const res = await app.client.request('GET', icon.src);
    assert.equal(res.status, 200, icon.src);
    assert.equal(res.headers.get('content-type'), 'image/png');
    await res.arrayBuffer();
  }
});

test('static assets are served and traversal is refused', async (t) => {
  const app = await setup({ publicDir: PUBLIC_DIR });
  t.after(() => app.close());
  const css = await app.client.request('GET', '/css/base.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  await css.text();

  for (const p of ['/../server/auth.js', '/..%2Fserver%2Fauth.js', '/../../etc/passwd']) {
    const res = await app.client.request('GET', p);
    assert.equal(res.status, 404, p);
    const text = await res.text();
    assert.ok(!text.includes('scrypt'), `${p} leaked server source`);
  }
});

// A game-access account belongs to the games origin; at the studio door it
// takes the unknown-email path, so the form does not say which kind of
// account an address carries.
test('a game-access account cannot sign in to the studio', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const player = createUser(app.db, {
    email: 'player@example.com', password: 'hunter2', displayName: 'Player',
  });
  app.db.prepare('UPDATE users SET studio_access = 0 WHERE id = ?').run(player.id);

  const denied = await app.client.json('POST', '/api/login', {
    body: { email: 'player@example.com', password: 'hunter2' },
  });
  assert.equal(denied.status, 401);
  assert.match(denied.body.error, /incorrect email or password/);

  // And the crew never lists them.
  const crew = await app.client.json('GET', '/api/users');
  assert.deepEqual(crew.body.map((u) => u.display_name), ['Dann']);
});
