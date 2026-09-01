// Running the studio: who is in it, what they may spend, and the wall around
// everybody. One bit decides who sees any of this — `users.admin`, which the
// first account has and an admin can hand to anybody else.
//
// It is deliberately small, and deliberately one-way: an account can be made
// and changed from here, and never taken out. `npm run adduser` still exists
// for when there is no studio running to add somebody from; `npm run deluser`
// has no counterpart in here at all (spec.md §11).

import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import {
  requireAuth, createUser, setPassword, normalizeEmail, isLastAdmin, MIN_PASSWORD_CHARS,
} from '../auth.js';
import { waitingSignups, approveSignup, refuseSignup } from '../players.js';
import { requireString, optionalBool } from './helpers.js';
import { forbiddenCharKind } from '../util/text.js';
import {
  DEFAULT_DAILY_TOKEN_BUDGET, studioLimit, userSpentToday, budgetState,
} from '../budget.js';
import { starterAgent } from '../starter.js';

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

// A living agent's id, or null for "nobody joins a new game". Undefined means
// the field was not sent at all, which leaves the setting alone.
function optionalAgentId(db, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const id = Number(value);
  const agent = Number.isInteger(id)
    ? db.prepare('SELECT id FROM agents WHERE id = ? AND deleted = 0').get(id)
    : null;
  if (!agent) throw new HttpError(400, 'no such helper');
  return agent.id;
}

const personPublic = (db, row) => ({
  id: row.id,
  email: row.email,
  display_name: row.display_name,
  admin: row.admin === 1,
  studio_access: row.studio_access === 1,
  daily_tokens: row.daily_tokens ?? null,
  spent_today: userSpentToday(db, row.id),
  created_at: row.created_at,
});

function assertNotLastAdmin(db, userId) {
  if (isLastAdmin(db, userId)) {
    throw new HttpError(409, 'the studio keeps at least one admin — make somebody else one first');
  }
}

export function adminRoutes(r) {
  // Everything the panel shows: the people, what they have spent today, and
  // the studio's own wall.
  r.get('/api/admin/studio', (ctx) => {
    requireAdmin(ctx);
    // The people in the studio, which is not the same as the rows in `users`:
    // a removed account is not listed, and comes back through
    // `npm run restoreuser` rather than a button in here.
    const people = ctx.db.prepare('SELECT * FROM users WHERE deleted = 0 ORDER BY id').all();
    json(ctx.res, 200, {
      people: people.map((row) => personPublic(ctx.db, row)),
      // The waiting list: who has asked in from the games origin and not been
      // decided. Approve and refuse are the two routes below.
      waiting: waitingSignups(ctx.db),
      budget: budgetState(ctx.db, studioLimit(ctx.db)),
      default_budget: DEFAULT_DAILY_TOKEN_BUDGET,
      // Who joins a new game. Read back through starterAgent rather than
      // straight off the row, so a helper that has since been deleted shows
      // as nobody — which is what it is.
      starter_agent_id: starterAgent(ctx.db)?.id ?? null,
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
    // An address stays with the account that had it, removed or not — so this
    // says which of the two it is. A second row for somebody who was taken out
    // would split their messages and their games across two people.
    const clash = ctx.db
      .prepare('SELECT deleted FROM users WHERE email = ?').get(normalizeEmail(email));
    if (clash) {
      throw new HttpError(409, clash.deleted === 1
        ? 'that account was removed — bring it back with `npm run restoreuser`'
        : 'somebody already has that email');
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
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(id);
    if (!row) throw new HttpError(404, 'no such person');
    const body = await readJson(ctx.req);

    if (body.display_name !== undefined) {
      const name = requireString(body.display_name, 'display_name', { max: MAX_NAME });
      // The same door createUser keeps: a name is a scoreboard name.
      const unprintable = forbiddenCharKind(name);
      if (unprintable) throw new HttpError(400, `display_name has ${unprintable} in it`);
      ctx.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, id);
    }
    const tokens = optionalTokens(body.daily_tokens, 'daily_tokens');
    if (tokens !== undefined) {
      ctx.db.prepare('UPDATE users SET daily_tokens = ? WHERE id = ?').run(tokens, id);
    }
    const admin = optionalBool(body.admin, 'admin');
    if (admin !== undefined) {
      if (!admin) assertNotLastAdmin(ctx.db, id);
      // The admin bit implies the studio one: handing it to a player is
      // letting them in, and the toggle below refuses the other order.
      if (admin) ctx.db.prepare('UPDATE users SET studio_access = 1 WHERE id = ?').run(id);
      ctx.db.prepare('UPDATE users SET admin = ? WHERE id = ?').run(admin ? 1 : 0, id);
    }
    const studioAccess = optionalBool(body.studio_access, 'studio_access');
    if (studioAccess !== undefined) {
      if (!studioAccess && ctx.db.prepare('SELECT admin FROM users WHERE id = ?').get(id).admin === 1) {
        throw new HttpError(409, 'an admin runs the studio — take the admin bit back first');
      }
      ctx.db.prepare('UPDATE users SET studio_access = ? WHERE id = ?')
        .run(studioAccess ? 1 : 0, id);
      // Off ends their studio sessions the way removal does. Their player
      // sessions stay: the games origin is still theirs.
      if (!studioAccess) ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (body.password !== undefined) {
      const password = requireString(body.password, 'password', { max: 200 });
      if (password.length < MIN_PASSWORD_CHARS) {
        throw new HttpError(400, `password must be at least ${MIN_PASSWORD_CHARS} characters`);
      }
      // Every session of theirs goes with it, on both origins: a password
      // changed because somebody else knew it has to end the somebody else's
      // session too.
      setPassword(ctx.db, id, password);
      ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      ctx.db.prepare('DELETE FROM player_sessions WHERE user_id = ?').run(id);
    }
    json(ctx.res, 200, personPublic(ctx.db, ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  // ⚠️ There is no route that takes somebody out of the studio, and no button
  // for one. Adding an account is an everyday thing and belongs in here;
  // removing one is rare, has consequences no click can show, and is a
  // terminal job — `npm run deluser -- <email>`, undone with
  // `npm run restoreuser`. A red Remove sitting beside Save and Password
  // invites the press; a command does not (spec.md §3, §11).

  // The waiting list's two decisions. Approval makes the account — game
  // access only — and refusal marks the row and keeps it; neither is a
  // DELETE, and refusing somebody the panel showed a minute ago answers 404
  // because another admin already decided.
  r.post('/api/admin/signups/:id/approve', (ctx) => {
    const admin = requireAdmin(ctx);
    const user = approveSignup(ctx.db, ctx.params.id, admin.id);
    json(ctx.res, 201, personPublic(ctx.db, user));
  });

  r.post('/api/admin/signups/:id/refuse', (ctx) => {
    const admin = requireAdmin(ctx);
    refuseSignup(ctx.db, ctx.params.id, admin.id);
    noContent(ctx.res);
  });

  r.patch('/api/admin/studio', async (ctx) => {
    requireAdmin(ctx);
    const body = await readJson(ctx.req);
    const budget = optionalTokens(body.daily_token_budget, 'daily_token_budget');
    if (budget === undefined) throw new HttpError(400, 'daily_token_budget is required');
    // Both settings arrive on the one Save, so the starter helper is optional
    // here where the budget is not: leaving it out changes nothing.
    const starter = optionalAgentId(ctx.db, body.starter_agent_id);
    ctx.db.prepare('UPDATE studio_state SET daily_token_budget = ? WHERE id = 1').run(budget);
    if (starter !== undefined) {
      ctx.db.prepare('UPDATE studio_state SET default_agent_id = ? WHERE id = 1').run(starter);
    }
    json(ctx.res, 200, {
      budget: budgetState(ctx.db, studioLimit(ctx.db)),
      starter_agent_id: starterAgent(ctx.db)?.id ?? null,
    });
  });
}
