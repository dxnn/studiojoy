// Running the studio: who is in it, what they may spend, and the wall around
// everybody. One bit decides who sees any of this — `users.admin`, which the
// first account has and an admin can hand to anybody else.
//
// It is deliberately small. Accounts still come from `npm run adduser` when
// there is no studio running to add them from, and everything here does the
// same thing that script does.

import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import {
  requireAuth, createUser, setPassword, normalizeEmail, MIN_PASSWORD_CHARS,
} from '../auth.js';
import { requireString, optionalBool } from './helpers.js';
import {
  DEFAULT_DAILY_TOKEN_BUDGET, studioLimit, userSpentToday, budgetState,
} from '../budget.js';

const MAX_NAME = 100;

function requireAdmin(ctx) {
  const user = requireAuth(ctx);
  if (user.admin !== 1) throw new HttpError(403, 'only a studio admin can do that');
  return user;
}

// A number of tokens, or null for "no allowance of their own".
function optionalTokens(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${field} must be a whole number`);
  return n;
}

const personPublic = (db, row) => ({
  id: row.id,
  email: row.email,
  display_name: row.display_name,
  admin: row.admin === 1,
  daily_tokens: row.daily_tokens ?? null,
  spent_today: userSpentToday(db, row.id),
  created_at: row.created_at,
});

// The last admin cannot be taken away or demoted: a studio nobody can run is
// one nobody can add an account to either, and there is no way back in.
function assertNotLastAdmin(db, userId) {
  const row = db.prepare('SELECT admin FROM users WHERE id = ?').get(userId);
  if (!row || row.admin !== 1) return;
  const admins = db.prepare('SELECT COUNT(*) AS c FROM users WHERE admin = 1').get().c;
  if (admins <= 1) {
    throw new HttpError(409, 'the studio keeps at least one admin — make somebody else one first');
  }
}

export function adminRoutes(r) {
  // Everything the panel shows: the people, what they have spent today, and
  // the studio's own wall.
  r.get('/api/admin/studio', (ctx) => {
    requireAdmin(ctx);
    const people = ctx.db.prepare('SELECT * FROM users ORDER BY id').all();
    json(ctx.res, 200, {
      people: people.map((row) => personPublic(ctx.db, row)),
      budget: budgetState(ctx.db, studioLimit(ctx.db)),
      default_budget: DEFAULT_DAILY_TOKEN_BUDGET,
    });
  });

  r.post('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.req);
    const email = requireString(body.email, 'email', { max: 200 });
    const displayName = requireString(body.display_name, 'display_name', { max: MAX_NAME });
    const password = requireString(body.password, 'password', { max: 200 });
    if (password.length < MIN_PASSWORD_CHARS) {
      throw new HttpError(400, `password must be at least ${MIN_PASSWORD_CHARS} characters`);
    }
    if (ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizeEmail(email))) {
      throw new HttpError(409, 'somebody already has that email');
    }
    let user;
    try {
      user = createUser(ctx.db, { email, password, displayName });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const tokens = optionalTokens(body.daily_tokens, 'daily_tokens');
    if (tokens !== undefined) {
      ctx.db.prepare('UPDATE users SET daily_tokens = ? WHERE id = ?').run(tokens, user.id);
    }
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    json(ctx.res, 201, personPublic(ctx.db, row));
  });

  // Rename, set an allowance, make somebody an admin, change a password. Each
  // field is optional; what is absent is left alone.
  r.patch('/api/admin/users/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = Number(ctx.params.id);
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'no such person');
    const body = await readJson(ctx.req);

    if (body.display_name !== undefined) {
      const name = requireString(body.display_name, 'display_name', { max: MAX_NAME });
      ctx.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, id);
    }
    const tokens = optionalTokens(body.daily_tokens, 'daily_tokens');
    if (tokens !== undefined) {
      ctx.db.prepare('UPDATE users SET daily_tokens = ? WHERE id = ?').run(tokens, id);
    }
    const admin = optionalBool(body.admin, 'admin');
    if (admin !== undefined) {
      if (!admin) assertNotLastAdmin(ctx.db, id);
      ctx.db.prepare('UPDATE users SET admin = ? WHERE id = ?').run(admin ? 1 : 0, id);
    }
    if (body.password !== undefined) {
      const password = requireString(body.password, 'password', { max: 200 });
      if (password.length < MIN_PASSWORD_CHARS) {
        throw new HttpError(400, `password must be at least ${MIN_PASSWORD_CHARS} characters`);
      }
      // Every session of theirs goes with it: a password changed because
      // somebody else knew it has to end the somebody else's session too.
      setPassword(ctx.db, id, password);
      ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    json(ctx.res, 200, personPublic(ctx.db, ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  // Taking somebody out of the studio. Their messages stay — a thread with
  // holes in it is worse than a name nobody can sign in as — and are shown
  // without an author, which the message shape already handles.
  r.delete('/api/admin/users/:id', (ctx) => {
    const me = requireAdmin(ctx);
    const id = Number(ctx.params.id);
    if (id === me.id) throw new HttpError(409, 'somebody else has to take you out');
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'no such person');
    assertNotLastAdmin(ctx.db, id);

    ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    // A game they authored keeps its other authors; one they authored alone
    // would be left with none, so they stay named on it rather than the game
    // becoming unmaintainable.
    ctx.db.prepare(
      `DELETE FROM project_authors
        WHERE user_id = ?
          AND (SELECT COUNT(*) FROM project_authors o
                WHERE o.project_id = project_authors.project_id) > 1`,
    ).run(id);
    const stillNamed = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM project_authors WHERE user_id = ?')
      .get(id).c;
    if (stillNamed > 0) {
      throw new HttpError(409, 'they are the only author of a game — add somebody to it first');
    }
    ctx.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    noContent(ctx.res);
  });

  r.patch('/api/admin/studio', async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.req);
    const budget = optionalTokens(body.daily_token_budget, 'daily_token_budget');
    if (budget === undefined) throw new HttpError(400, 'daily_token_budget is required');
    ctx.db.prepare('UPDATE studio_state SET daily_token_budget = ? WHERE id = 1').run(budget);
    json(ctx.res, 200, { budget: budgetState(ctx.db, studioLimit(ctx.db)) });
  });
}
