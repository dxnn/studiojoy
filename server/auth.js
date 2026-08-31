import crypto from 'node:crypto';
import { HttpError } from './http/respond.js';
import { tx } from './db.js';

// scrypt parameters from spec.md §11. Stored format carries them so an
// existing hash keeps verifying if these are ever raised.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const SESSION_BYTES = 32;

export const MAX_EMAIL_CHARS = 254;
export const MAX_DISPLAY_NAME_CHARS = 100;
export const SESSION_COOKIE = 'session';

function derive(password, salt, { n = N, r = R, p = P, keylen = KEYLEN } = {}) {
  // maxmem must exceed 128 * n * r or scrypt refuses; the default 32 MB is
  // just under what N=16384, r=8 needs on some builds, so state it.
  return crypto.scryptSync(password, salt, keylen, {
    N: n, r, p, maxmem: 256 * n * r,
  });
}

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = derive(password, salt);
  return [
    'scrypt', N, R, P, salt.toString('base64'), key.toString('base64'),
  ].join('$');
}

// Buffer.from(s, 'base64') silently ignores characters outside the alphabet
// rather than throwing, so 'scrypt$16384$8$1$!!!$!!!' would decode to two
// empty buffers and timingSafeEqual(empty, empty) is true — a hash like that
// would accept any password. Hence the explicit alphabet and length checks
// before anything is compared.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_SALT_BYTES = 8;
const MIN_KEY_BYTES = 32;
const MAX_N = 1 << 20; // refuse a stored cost high enough to wedge a verify

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;

  const cost = { n: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.n) || cost.n < 1024 || cost.n > MAX_N) return false;
  if (!Number.isInteger(cost.r) || cost.r < 1 || cost.r > 32) return false;
  if (!Number.isInteger(cost.p) || cost.p < 1 || cost.p > 16) return false;
  if (!BASE64.test(saltB64) || !BASE64.test(keyB64)) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (salt.length < MIN_SALT_BYTES || expected.length < MIN_KEY_BYTES) return false;

  let actual;
  try {
    actual = derive(password, salt, { ...cost, keylen: expected.length });
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// A real hash of a random secret, derived once. Login runs this for unknown
// emails so a missing account costs the same wall-clock time as a wrong
// password, and the response can't be used to enumerate accounts.
const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));

export function verifyAgainstDummy(password) {
  verifyPassword(password, DUMMY_HASH);
  return false;
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function createSession(db, userId, now = new Date()) {
  const token = crypto.randomBytes(SESSION_BYTES).toString('base64url');
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)',
  ).run(token, userId, now.toISOString());
  return token;
}

export function deleteSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ⚠️ `u.deleted = 0` is belt to the braces: removing somebody deletes their
// sessions, so there should be no token left to resolve. This is what makes
// that a tidy-up rather than the whole of the revocation.
export function userForToken(db, token) {
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.email, u.display_name, u.admin, u.daily_tokens, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.deleted = 0`,
  ).get(token) ?? null;
}

export function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(pair.slice(eq + 1).trim());
    } catch {
      // A cookie we can't decode is a cookie we don't have.
    }
  }
  return out;
}

export function sessionCookie(token, { secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedSessionCookie({ secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// A resolved session says who you are, and the row carries the two things
// that decide what you may do beyond reading: `admin`, which is the studio's
// only role, and `daily_tokens`, which is what your helpers may spend. What
// you may change in a game is a question about that game (server/authors.js).
export function currentUser(ctx) {
  const cookies = parseCookies(ctx.req.headers.cookie);
  return userForToken(ctx.db, cookies[SESSION_COOKIE]);
}

export function requireAuth(ctx) {
  const user = currentUser(ctx);
  if (!user) throw new HttpError(401, 'sign in required');
  return user;
}

// Sliding-window failure counter, keyed by email or IP. In-memory by
// design (spec.md §11): a restart clears it, which costs an attacker a
// fresh budget of guesses but gains them no sustained advantage.
export function createLockout({ maxFailures, windowMs, lockoutMs }) {
  const entries = new Map();

  const prune = (entry, now) => {
    entry.failures = entry.failures.filter((t) => now - t < windowMs);
  };

  return {
    // Throws 429 while locked. Called before the password is checked.
    check(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry) return;
      if (entry.until && entry.until > now) {
        const seconds = Math.ceil((entry.until - now) / 1000);
        throw new HttpError(429, `too many attempts; try again in ${seconds}s`, {
          retry_after: seconds,
        });
      }
      if (entry.until && entry.until <= now) {
        entries.delete(key);
      }
    },
    fail(key, now = Date.now()) {
      const entry = entries.get(key) ?? { failures: [], until: 0 };
      prune(entry, now);
      entry.failures.push(now);
      if (entry.failures.length >= maxFailures) {
        entry.until = now + lockoutMs;
        entry.failures = [];
      }
      entries.set(key, entry);
    },
    succeed(key) {
      entries.delete(key);
    },
    // Test seam.
    _size() {
      return entries.size;
    },
  };
}

export const DEFAULT_EMAIL_LOCKOUT = {
  maxFailures: 10,
  windowMs: 5 * 60 * 1000,
  lockoutMs: 5 * 60 * 1000,
};

// The IP lock outlasts the per-email lock, so a jammed account recovers
// before the attacker's address is allowed to try again.
export const DEFAULT_IP_LOCKOUT = {
  maxFailures: 20,
  windowMs: 5 * 60 * 1000,
  lockoutMs: 10 * 60 * 1000,
};

// Short enough for a ten-year-old to remember, long enough that it is not a
// word. The studio is a handful of people behind one login; the account list
// is the real boundary (spec.md §11).
export const MIN_PASSWORD_CHARS = 6;

// Changing somebody's password. The caller ends their sessions — a password
// changed because it leaked has to end the leak too.
export function setPassword(db, userId, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(password), userId);
}

// ⚠️ The studio keeps at least one admin: a studio nobody can run is one
// nobody can add an account to either, and there is no way back in. Asked by
// the panel before it demotes somebody and by `deluser` before it takes them
// out, and the count is of admins still in the studio — a removed one is not
// one of them.
export function isLastAdmin(db, userId) {
  const row = db.prepare('SELECT admin FROM users WHERE id = ?').get(userId);
  if (!row || row.admin !== 1) return false;
  return db
    .prepare('SELECT COUNT(*) AS c FROM users WHERE admin = 1 AND deleted = 0')
    .get().c <= 1;
}

// ⚠️ Taking somebody out of the studio: one bit and their sessions, never a
// DELETE (spec.md §3). Everything else on the row and everything referencing
// it stays, which is what makes the undo below an undo. Reachable only from
// `npm run deluser` — there is no route and no button.
export function removeAccount(db, userId) {
  return tx(db, () => {
    const sessions = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
    db.prepare('UPDATE users SET deleted = 1 WHERE id = ?').run(userId);
    return sessions;
  });
}

// Their sessions are not given back — those went on the way out, so they sign
// in again. Everything else was never taken.
export function restoreAccount(db, userId) {
  db.prepare('UPDATE users SET deleted = 0 WHERE id = ?').run(userId);
}

// The first account is the studio's admin: somebody has to be able to make the
// second one, and there is nobody else to ask.
export function createUser(db, { email, password, displayName }, now = new Date()) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    throw new Error('a valid email is required');
  }
  if (normalized.length > MAX_EMAIL_CHARS) {
    throw new Error(`email is longer than ${MAX_EMAIL_CHARS} characters`);
  }
  const name = String(displayName ?? '').trim();
  if (!name) throw new Error('a display name is required');
  if (name.length > MAX_DISPLAY_NAME_CHARS) {
    throw new Error(`display name is longer than ${MAX_DISPLAY_NAME_CHARS} characters`);
  }
  // Removed accounts do not count: a studio whose people have all been taken
  // out still has to be able to make somebody who can let the rest back in.
  const first = db.prepare('SELECT COUNT(*) AS c FROM users WHERE deleted = 0').get().c === 0;
  const info = db.prepare(
    `INSERT INTO users (email, password_hash, display_name, admin, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(normalized, hashPassword(password), name, first ? 1 : 0, now.toISOString());
  return db.prepare('SELECT id, email, display_name, admin, created_at FROM users WHERE id = ?')
    .get(info.lastInsertRowid);
}
