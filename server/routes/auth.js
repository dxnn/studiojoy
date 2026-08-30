import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import {
  normalizeEmail, verifyPassword, verifyAgainstDummy, createSession,
  deleteSession, sessionCookie, clearedSessionCookie, parseCookies,
  requireAuth, SESSION_COOKIE, MAX_EMAIL_CHARS,
} from '../auth.js';
import { clientIp } from './helpers.js';

export function authRoutes(r) {
  // There is no signup route: accounts come from `npm run adduser`
  // (spec.md §2). Presence in `users` is the entire permission model.
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

    const user = ctx.db
      .prepare('SELECT id, email, display_name, password_hash FROM users WHERE email = ?')
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
  // is here needs. There is no route that makes one — accounts come from
  // `npm run adduser` and nowhere else (§11).
  r.get('/api/users', (ctx) => {
    requireAuth(ctx);
    const rows = ctx.db
      .prepare('SELECT id, display_name FROM users ORDER BY display_name COLLATE NOCASE')
      .all();
    json(ctx.res, 200, rows);
  });

  r.get('/api/me', (ctx) => {
    const user = requireAuth(ctx);
    json(ctx.res, 200, {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      games_url: ctx.gamesUrl,
    });
  });
}
