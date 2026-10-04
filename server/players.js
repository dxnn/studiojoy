import crypto from 'node:crypto';
import { HttpError } from './http/respond.js';
import { tx, fillDefaultAliases } from './db.js';
import { forbiddenCharKind } from './util/text.js';
import {
  hashPassword, normalizeEmail, parseCookies,
  MAX_EMAIL_CHARS, MAX_DISPLAY_NAME_CHARS, MIN_PASSWORD_CHARS,
} from './auth.js';

// The public half of accounts: who is signed in on the games origin, and the
// waiting list a stranger joins to become somebody an admin can let in.
//
// ⚠️ Player sessions are deliberately not `sessions`. The games origin serves
// LLM-written code on the same origin as these cookies travel, so a token
// here must open exactly three doors — post a score as yourself, say who you
// are, sign out — and never the studio (spec.md §7). Separate table,
// separate cookie name, and an expiry the studio's sessions do not have,
// because the public is not the account list.

const SESSION_BYTES = 32;

export const PLAYER_COOKIE = 'player';
export const PLAYER_SESSION_DAYS = 90;
const PLAYER_SESSION_MS = PLAYER_SESSION_DAYS * 24 * 60 * 60 * 1000;

export function createPlayerSession(db, userId, now = new Date()) {
  const token = crypto.randomBytes(SESSION_BYTES).toString('base64url');
  db.prepare(
    'INSERT INTO player_sessions (token, user_id, created_at) VALUES (?, ?, ?)',
  ).run(token, userId, now.toISOString());
  return token;
}

export function deletePlayerSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM player_sessions WHERE token = ?').run(token);
}

// Any account that is still in — studio access or not — is a player. The age
// check is the expiry: the cookie's Max-Age matches it, but a copied token
// has no cookie jar, so the row itself has to age out.
//
// ⚠️ A player is an id and an alias, and never the account's name: this is
// the games origin's whole idea of who somebody is, so nothing there can say
// a name it was never handed (server/alias.js, spec/ §7).
export function playerForToken(db, token, now = new Date()) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.alias, s.created_at
       FROM player_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.deleted = 0`,
  ).get(token);
  if (!row) return null;
  if (now.getTime() - Date.parse(row.created_at) > PLAYER_SESSION_MS) {
    deletePlayerSession(db, token);
    return null;
  }
  return { id: row.id, alias: row.alias };
}

export function currentPlayer(ctx) {
  const cookies = parseCookies(ctx.req.headers.cookie);
  return playerForToken(ctx.db, cookies[PLAYER_COOKIE]);
}

export function playerCookie(token, { secure = false } = {}) {
  const parts = [
    `${PLAYER_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/',
    `Max-Age=${PLAYER_SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedPlayerCookie({ secure = false } = {}) {
  const parts = [`${PLAYER_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// The sign-up form's whole server side. Everything is validated here because
// the form is the public's; the 400s name what to fix. The one thing this
// never says is whether an address is already spoken for — an account, a
// pending row, a refusal, a removal all get the same quiet null, and the
// route answers "you're on the list" either way (spec.md §11).
export function createSignup(db, { email, displayName, password }, now = new Date()) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@') || normalized.length > MAX_EMAIL_CHARS) {
    throw new HttpError(400, 'that email does not look right');
  }
  const name = String(displayName ?? '').trim();
  if (!name) throw new HttpError(400, 'a name is required');
  if (name.length > MAX_DISPLAY_NAME_CHARS) {
    throw new HttpError(400, `a name stops at ${MAX_DISPLAY_NAME_CHARS} characters`);
  }
  // The path validator's class, not just C0: a zero-width space or a bidi
  // override prints as nothing or as another name, on a board kids read.
  if (forbiddenCharKind(name)) {
    throw new HttpError(400, 'that name has characters that will not print');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_CHARS) {
    throw new HttpError(400, `a password needs at least ${MIN_PASSWORD_CHARS} characters`);
  }
  if (password.length > 200) throw new HttpError(400, 'that password is too long');

  const taken = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized)
    ?? db.prepare('SELECT id FROM signups WHERE email = ?').get(normalized);
  if (taken) return null;

  db.prepare(
    `INSERT INTO signups (email, display_name, password_hash, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(normalized, name, hashPassword(password), now.toISOString());
  return true;
}

// What the admin panel shows: the rows nobody has decided yet. Decided rows
// stay in the table as the audit trail and appear nowhere.
export function waitingSignups(db) {
  return db.prepare(
    `SELECT id, email, display_name, created_at FROM signups
      WHERE approved_at IS NULL AND refused_at IS NULL ORDER BY id`,
  ).all();
}

const pendingSignup = (db, id) => {
  const row = db.prepare('SELECT * FROM signups WHERE id = ?').get(Number(id));
  if (!row || row.approved_at || row.refused_at) {
    throw new HttpError(404, 'no such signup waiting');
  }
  return row;
};

// Approval makes the account: game access only, never an admin, the password
// they chose. The row stays, saying who let them in and where they went.
export function approveSignup(db, signupId, adminId, now = new Date()) {
  return tx(db, () => {
    const signup = pendingSignup(db, signupId);
    // An account made since they signed up wins; the row stays undecided so
    // the panel can show it until somebody refuses it.
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(signup.email)) {
      throw new HttpError(409, 'somebody already has that email');
    }
    const info = db.prepare(
      `INSERT INTO users (email, password_hash, display_name, admin, studio_access, created_at)
       VALUES (?, ?, ?, 0, 0, ?)`,
    ).run(signup.email, signup.password_hash, signup.display_name, now.toISOString());
    fillDefaultAliases(db);
    db.prepare(
      `UPDATE signups SET approved_by = ?, approved_at = ?, approved_user_id = ?
        WHERE id = ?`,
    ).run(adminId, now.toISOString(), info.lastInsertRowid, signup.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  });
}

// A refusal is two columns, not a DELETE: who turned it away and when is the
// audit trail, and nothing in the interface ever shows it (spec.md §3).
export function refuseSignup(db, signupId, adminId, now = new Date()) {
  const signup = pendingSignup(db, signupId);
  db.prepare('UPDATE signups SET refused_by = ?, refused_at = ? WHERE id = ?')
    .run(adminId, now.toISOString(), signup.id);
}
