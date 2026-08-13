import path from 'node:path';
import { createRouter } from './http/router.js';
import { serveFile } from './http/static.js';
import { HttpError } from './http/respond.js';
import { checkSlug, checkProjectPath, resolveInside } from './files/paths.js';

// ⚠️ The public listener, and the reason the studio is safe (spec.md §7).
//
// Game code is written by an LLM and served to anyone. If it ran on the
// studio's origin, its JavaScript could call /api/* with the operator's
// session cookie and delete every project. This listener exists so the
// browser treats games as a different origin: the session cookie never
// travels here, a fetch('/api/…') from inside a game reaches a server that
// has no such route, and each origin gets its own localStorage — so games
// keep working save state, which a CSP sandbox would have cost them.
//
// The only thing this serves is a regular file from inside a project
// directory. Nothing here reads a cookie, touches a session, or writes.
export function createGamesApp({ db, gamesDir }) {
  if (!db) throw new Error('createGamesApp requires a db');
  const root = path.resolve(gamesDir);

  const r = createRouter();

  // `/tank`, `/tank/`, and `/tank/index.html` all serve the entry point;
  // `/tank/js/game.js` serves that file.
  r.get('/:slug/*path', async (ctx) => {
    const slug = checkSlug(ctx.params.slug);
    if (!slug.ok) throw new HttpError(404, 'not found');

    // A directory on disk with no project row is not public. This is also
    // what keeps a half-created project from being served.
    const project = db
      .prepare('SELECT slug FROM projects WHERE slug = ?')
      .get(slug.slug);
    if (!project) throw new HttpError(404, 'not found');

    const requested = ctx.params.path === '' ? 'index.html' : ctx.params.path;
    // Same validation as the studio, but a refusal is reported as 404: the
    // public has no business learning why a path was rejected.
    const checked = checkProjectPath(requested);
    if (!checked.ok) throw new HttpError(404, 'not found');
    const abs = resolveInside(path.join(root, project.slug), checked.path);
    if (abs === null) throw new HttpError(404, 'not found');

    // no-store so iterating on a game shows fresh bytes on reload, with no
    // cache-busting query strings in the game's own markup.
    await serveFile(ctx.req, ctx.res, abs, { 'Cache-Control': 'no-store' });
  });

  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Deliberately no X-Frame-Options: the studio embeds a game in its
    // preview pane, which DENY would break. Framing a game is harmless —
    // there is no session here to clickjack.
    return r.handle(req, res, {});
  };
}
