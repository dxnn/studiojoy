import { json, noContent, HttpError } from '../http/respond.js';
import { userSpentToday } from '../budget.js';
import { readJson } from '../http/body.js';
import {
  normalizeEmail, verifyPassword, verifyAgainstDummy, createSession,
  deleteSession, sessionCookie, clearedSessionCookie, parseCookies,
  requireAuth, SESSION_COOKIE, MAX_EMAIL_CHARS,
} from '../auth.js';
import { clientIp } from './helpers.js';

export function authRoutes(r) {
  // Still no signup route on this origin: studio accounts come from
  // `npm run adduser` and the admin panel. The games origin has a public
  // sign-up now, but it only feeds the waiting list, and what an admin
  // approves has game access only (spec.md §11).
  r.post('/api/login', async (ctx) => {
    const body = await readJson(ctx.req);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = clientIp(ctx);

    // Both limiters are consulted before any password work, so a locked-out
    // caller can't use login as a scrypt oracle.
    ctx.ipLockout.check(ip);
    if (email) ctx.emailLockout.check(email);

    if (!email || email.length > MAX_EMAIL_CHARS || !password) {
      throw new HttpError(400, 'email and password are required');
    }

    // ⚠️ A removed account is not found here, so it takes the unknown-email
    // path below — same refusal, same wall-clock cost. Whether somebody was
    // taken out of the studio is not something the login form says. A
    // game-access account takes the same path: which kind of account an
    // address carries is not said here either.
    const user = ctx.db
      .prepare(`SELECT id, email, display_name, password_hash FROM users
                 WHERE email = ? AND deleted = 0 AND studio_access = 1`)
      .get(email);

    // An unknown email still pays for a scrypt derivation, so response
    // timing doesn't disclose whether the account exists.
    const ok = user
      ? verifyPassword(password, user.password_hash)
      : verifyAgainstDummy(password);

    if (!ok) {
      ctx.emailLockout.fail(email);
      ctx.ipLockout.fail(ip);
      throw new HttpError(401, 'incorrect email or password');
    }

    ctx.emailLockout.succeed(email);
    const token = createSession(ctx.db, user.id);
    ctx.res.setHeader('Set-Cookie', sessionCookie(token, { secure: ctx.secureCookies }));
    json(ctx.res, 200, {
      id: user.id, email: user.email, display_name: user.display_name,
    });
  });

  r.post('/api/logout', (ctx) => {
    const cookies = parseCookies(ctx.req.headers.cookie);
    deleteSession(ctx.db, cookies[SESSION_COOKIE]);
    ctx.res.setHeader('Set-Cookie', clearedSessionCookie({ secure: ctx.secureCookies }));
    noContent(ctx.res);
  });

  // Who else is in the studio. Names only: the sidebar's Crew tab shows the
  // people beside the helpers, and an email address is more than a list of who
  // is here needs. Studio access only — a player is somebody on a scoreboard,
  // not somebody in the crew.
  r.get('/api/users', (ctx) => {
    requireAuth(ctx);
    const rows = ctx.db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE deleted = 0 AND studio_access = 1
          ORDER BY display_name COLLATE NOCASE`,
      )
      .all();
    json(ctx.res, 200, rows);
  });

  r.get('/api/me', (ctx) => {
    const user = requireAuth(ctx);
    // The same cookie again, with its 400 days counted from now: the studio
    // asks this on every load, so anybody who opens it once a year never
    // signs in again, and the row itself never expires anyway (auth.js).
    ctx.res.setHeader('Set-Cookie', sessionCookie(
      parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE], { secure: ctx.secureCookies },
    ));
    json(ctx.res, 200, {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      // The studio's only role, so the interface knows whether to offer the
      // panel. Every route behind it checks for itself.
      admin: user.admin === 1,
      // What this person's helpers may spend in a day, and what they have
      // spent: shown to them, not only to whoever set it.
      daily_tokens: user.daily_tokens ?? null,
      spent_today: userSpentToday(ctx.db, user.id),
      games_url: ctx.gamesUrl,
    });
  });
}
