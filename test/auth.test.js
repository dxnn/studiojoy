import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import {
  hashPassword,
  verifyPassword,
  verifyAgainstDummy,
  normalizeEmail,
  createUser,
  createSession,
  deleteSession,
  userForToken,
  parseCookies,
  sessionCookie,
  clearedSessionCookie,
  requireAuth,
  currentUser,
  createLockout,
  SESSION_COOKIE,
  MAX_EMAIL_CHARS,
  MAX_DISPLAY_NAME_CHARS,
} from '../server/auth.js';

const ctxFor = (db, cookieHeader) => ({
  db,
  req: { headers: cookieHeader ? { cookie: cookieHeader } : {} },
});

test('a hash verifies its own password and rejects others', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('wrong', stored), false);
  assert.equal(verifyPassword('', stored), false);
  assert.equal(verifyPassword('Correct horse battery staple', stored), false);
});

test('the stored format carries its parameters and a fresh salt', () => {
  const a = hashPassword('same password');
  const b = hashPassword('same password');
  assert.notEqual(a, b, 'equal passwords must not produce equal hashes');
  const parts = a.split('$');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts[1], '16384');
  assert.equal(parts[2], '8');
  assert.equal(parts[3], '1');
});

test('a malformed stored hash verifies as false rather than throwing', () => {
  for (const bad of [
    '', 'nonsense', 'scrypt$1$2$3', 'bcrypt$16384$8$1$aaaa$bbbb',
    'scrypt$16384$8$1$!!!$!!!', null, undefined, 42,
  ]) {
    assert.equal(verifyPassword('x', bad), false, `stored=${String(bad)}`);
  }
});

test('the dummy hash exists so an unknown email costs real work', () => {
  const started = process.hrtime.bigint();
  assert.equal(verifyAgainstDummy('anything'), false);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  // scrypt at N=16384 is milliseconds, not microseconds. A no-op would be
  // far under this and would leak "no such account" through timing.
  assert.ok(elapsedMs > 1, `dummy verify took only ${elapsedMs.toFixed(2)}ms`);
});

test('emails normalise to lowercase and trimmed', () => {
  assert.equal(normalizeEmail('  Dann@Example.COM '), 'dann@example.com');
  assert.equal(normalizeEmail(undefined), '');
});

test('createUser stores a normalised email and a verifiable hash', () => {
  const db = openDb(':memory:');
  const user = createUser(db, {
    email: '  Dann@Example.com ',
    password: 'hunter2',
    displayName: '  Dann  ',
  });
  assert.equal(user.email, 'dann@example.com');
  assert.equal(user.display_name, 'Dann');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  assert.equal(verifyPassword('hunter2', row.password_hash), true);
  db.close();
});

test('createUser refuses bad input and duplicate emails', () => {
  const db = openDb(':memory:');
  const ok = { email: 'a@b.com', password: 'pw', displayName: 'A' };
  createUser(db, ok);
  assert.throws(() => createUser(db, ok), /UNIQUE/);
  assert.throws(() => createUser(db, { ...ok, email: 'no-at-sign' }), /valid email/);
  assert.throws(() => createUser(db, { ...ok, email: '' }), /valid email/);
  assert.throws(() => createUser(db, { ...ok, email: 'c@d.com', displayName: '  ' }), /display name/);
  assert.throws(
    () => createUser(db, {
      ...ok, email: `${'x'.repeat(MAX_EMAIL_CHARS)}@b.com`,
    }),
    /longer than/,
  );
  assert.throws(
    () => createUser(db, {
      ...ok, email: 'e@f.com', displayName: 'y'.repeat(MAX_DISPLAY_NAME_CHARS + 1),
    }),
    /longer than/,
  );
  db.close();
});

test('a session resolves to its user until it is deleted', () => {
  const db = openDb(':memory:');
  const user = createUser(db, { email: 'a@b.com', password: 'pw', displayName: 'A' });
  const token = createSession(db, user.id);
  const found = userForToken(db, token);
  assert.equal(found.id, user.id);
  assert.equal(found.email, 'a@b.com');
  // No password material comes back with the user.
  assert.equal(found.password_hash, undefined);

  deleteSession(db, token);
  assert.equal(userForToken(db, token), null);
  assert.equal(userForToken(db, 'never-issued'), null);
  assert.equal(userForToken(db, ''), null);
  assert.equal(userForToken(db, undefined), null);
  db.close();
});

test('session tokens are unguessable and distinct', () => {
  const db = openDb(':memory:');
  const user = createUser(db, { email: 'a@b.com', password: 'pw', displayName: 'A' });
  const tokens = new Set();
  for (let i = 0; i < 50; i += 1) tokens.add(createSession(db, user.id));
  assert.equal(tokens.size, 50);
  for (const token of tokens) {
    // 32 bytes of base64url is 43 characters.
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  }
  db.close();
});

test('parseCookies handles absent, multiple, and undecodable values', () => {
  assert.deepEqual({ ...parseCookies(undefined) }, {});
  assert.deepEqual({ ...parseCookies('') }, {});
  assert.deepEqual({ ...parseCookies('a=1; b=2') }, { a: '1', b: '2' });
  assert.deepEqual({ ...parseCookies('  a = 1 ;b=2') }, { a: '1', b: '2' });
  assert.equal(parseCookies('session=a%20b').session, 'a b');
  // First wins, so a second injected cookie of the same name can't override.
  assert.equal(parseCookies('session=first; session=second').session, 'first');
  // A bad escape drops that cookie rather than throwing.
  assert.equal(parseCookies('session=%zz').session, undefined);
  // A value containing '=' survives intact.
  assert.equal(parseCookies('session=ab=cd').session, 'ab=cd');
});

test('the session cookie is HttpOnly, Lax, kept 400 days, and Secure only when asked', () => {
  const plain = sessionCookie('tok');
  assert.match(plain, /^session=tok;/);
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Lax/);
  assert.match(plain, /Path=\//);
  // A Max-Age, or the browser drops the cookie when it closes and everybody
  // signs in again every morning. 400 days is the most a browser will keep.
  assert.match(plain, /Max-Age=34560000/);
  assert.ok(!/Secure/.test(plain));
  assert.match(sessionCookie('tok', { secure: true }), /Secure/);
  assert.match(clearedSessionCookie(), /Max-Age=0/);
});

test('requireAuth accepts a live session and refuses everything else', () => {
  const db = openDb(':memory:');
  const user = createUser(db, { email: 'a@b.com', password: 'pw', displayName: 'A' });
  const token = createSession(db, user.id);

  assert.equal(requireAuth(ctxFor(db, `${SESSION_COOKIE}=${token}`)).id, user.id);
  assert.equal(currentUser(ctxFor(db, 'other=1')), null);

  for (const header of [undefined, '', 'other=1', `${SESSION_COOKIE}=bogus`]) {
    assert.throws(
      () => requireAuth(ctxFor(db, header)),
      (err) => err.status === 401,
      `header=${String(header)}`,
    );
  }
  db.close();
});

test('lockout opens after maxFailures and closes when the window passes', () => {
  const lock = createLockout({ maxFailures: 3, windowMs: 1000, lockoutMs: 5000 });
  let now = 10_000;
  lock.check('a@b.com', now);
  lock.fail('a@b.com', now);
  lock.fail('a@b.com', now);
  lock.check('a@b.com', now); // two failures is still fine
  lock.fail('a@b.com', now);

  assert.throws(() => lock.check('a@b.com', now), (err) => err.status === 429);
  // Still locked most of the way through.
  assert.throws(() => lock.check('a@b.com', now + 4999), (err) => err.status === 429);
  // Open again once the lockout elapses.
  lock.check('a@b.com', now + 5001);
});

test('a 429 says how long to wait', () => {
  const lock = createLockout({ maxFailures: 1, windowMs: 1000, lockoutMs: 5000 });
  lock.fail('k', 0);
  assert.throws(() => lock.check('k', 0), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.extra.retry_after, 5);
    assert.match(err.message, /try again in 5s/);
    return true;
  });
});

test('failures outside the window do not accumulate', () => {
  const lock = createLockout({ maxFailures: 3, windowMs: 1000, lockoutMs: 5000 });
  lock.fail('k', 0);
  lock.fail('k', 500);
  // This one is 2000ms after the first, so the first has aged out.
  lock.fail('k', 2000);
  lock.check('k', 2000);
});

test('a success clears the counter for that key only', () => {
  const lock = createLockout({ maxFailures: 2, windowMs: 1000, lockoutMs: 5000 });
  lock.fail('a', 0);
  lock.fail('b', 0);
  lock.succeed('a');
  lock.fail('a', 0);
  lock.check('a', 0); // one failure since the reset
  lock.fail('b', 0);
  assert.throws(() => lock.check('b', 0), (err) => err.status === 429);
});

test('keys are independent', () => {
  const lock = createLockout({ maxFailures: 1, windowMs: 1000, lockoutMs: 5000 });
  lock.fail('a', 0);
  assert.throws(() => lock.check('a', 0), (err) => err.status === 429);
  lock.check('b', 0);
});
