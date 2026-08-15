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
// Names and slugs reach the catalog as text, never as markup.
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createGamesApp({ db, gamesDir }) {
  if (!db) throw new Error('createGamesApp requires a db');
  const root = path.resolve(gamesDir);

  const r = createRouter();

  // The catalog. Only published games appear, so an unfinished one stays
  // unlisted while still being playable by link — the same bargain as before,
  // just findable now. Names are escaped: they are typed by people and this
  // page is served to the public with no session anywhere near it.
  r.get('/', (ctx) => {
    const games = db
      .prepare(
        `SELECT slug, name FROM projects
          WHERE published = 1 AND kind = 'game' AND archived = 0
          ORDER BY name`,
      )
      .all();

    const cards = games
      .map((g) => `<li><a href="/${escapeHtml(g.slug)}/">${escapeHtml(g.name)}</a></li>`)
      .join('\n      ');

    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Games</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 40px 20px;
         display: flex; justify-content: center; }
  main { width: 100%; max-width: 640px; }
  h1 { font-size: 1.5rem; margin: 0 0 24px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  a { display: block; padding: 16px 18px; border: 1px solid currentColor;
      border-radius: 12px; text-decoration: none; font-weight: 600; }
  a:hover { outline: 2px solid currentColor; }
  p { opacity: 0.7; }
</style>
</head>
<body>
  <main>
    <h1>Games</h1>
    ${games.length ? `<ul>\n      ${cards}\n    </ul>` : '<p>No games yet.</p>'}
  </main>
</body>
</html>
`;
    ctx.res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    if (ctx.req.method === 'HEAD') return ctx.res.end();
    return ctx.res.end(page);
  });

  // `/tank`, `/tank/`, and `/tank/index.html` all serve the entry point;
  // `/tank/js/game.js` serves that file.
  r.get('/:slug/*path', async (ctx) => {
    const slug = checkSlug(ctx.params.slug);
    if (!slug.ok) throw new HttpError(404, 'not found');

    // A directory on disk with no project row is not public. This is also
    // what keeps a half-created project from being served. A chat has no
    // directory at all, so its slug is not public either.
    const project = db
      .prepare('SELECT slug, kind FROM projects WHERE slug = ?')
      .get(slug.slug);
    if (!project || project.kind === 'chat') throw new HttpError(404, 'not found');

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
