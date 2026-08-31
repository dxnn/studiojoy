import path from 'node:path';
import { createRouter } from './http/router.js';
import { serveFile } from './http/static.js';
import { HttpError } from './http/respond.js';
import { checkSlug, checkProjectPath, resolveInside } from './files/paths.js';
import { readFileAt } from './files/tree.js';
import { currentSha } from './files/git.js';
import { WRAPPER_PATH, wrapHtml } from './reporter.js';
import { readJson } from './http/body.js';
import { json } from './http/respond.js';
import {
  topScores, submitScore, createScoreLimiter, MAX_SCORE_BODY_BYTES,
} from './scores.js';
// The one thing this listener borrows from the studio's routes: a pure
// function over headers. It reads no session and nothing here calls anything
// else in that module.
import { clientIp } from './routes/helpers.js';
import { escapeHtml } from './util/html.js';

const ENTRY_FILE = 'index.html';

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
// Nothing here reads a cookie or touches a session. The scoreboard is the
// one write, and it writes one bounded table — never a working tree
// (spec.md §6). Names and slugs reach the catalog as text, never as markup.

export function createGamesApp({ db, gamesDir, scoreRate, trustProxy = false }) {
  if (!db) throw new Error('createGamesApp requires a db');
  const root = path.resolve(gamesDir);

  const r = createRouter();
  const limitScores = createScoreLimiter(scoreRate);

  // Slug → game row. Any refusal is a plain 404: the public has no business
  // learning why. A directory on disk with no project row is not public —
  // which is also what keeps a half-created project from being served — and
  // a chat has no directory at all, so its slug is not public either.
  const gameForSlug = (raw) => {
    const slug = checkSlug(raw);
    if (!slug.ok) throw new HttpError(404, 'not found');
    const project = db
      .prepare('SELECT id, slug, kind, scores_on FROM projects WHERE slug = ?')
      .get(slug.slug);
    if (!project || project.kind === 'chat') throw new HttpError(404, 'not found');
    return project;
  };

  // A switched-off scoreboard is not public in either direction: reading it
  // is as gone as writing it, and the same plain 404 as everything else here.
  // The rows are kept — the switch lives in the studio, not in this listener.
  const scoreboardFor = (raw) => {
    const game = gameForSlug(raw);
    if (game.scores_on !== 1) throw new HttpError(404, 'not found');
    return game;
  };

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
<title>Unbridled Joy</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 40px 20px;
         display: flex; justify-content: center; }
  main { width: 100%; max-width: 640px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; letter-spacing: -0.02em; }
  .tag { margin: 0 0 24px; opacity: 0.7; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  a { display: block; padding: 16px 18px; border: 1px solid currentColor;
      border-radius: 12px; text-decoration: none; font-weight: 600; }
  a:hover { outline: 2px solid currentColor; }
  p { opacity: 0.7; }
</style>
</head>
<body>
  <main>
    <h1>Unbridled Joy</h1>
    <p class="tag">Games made by us. Click one and play it.</p>
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

  // The game's own index.html with the reporter injected (reporter.js), at a
  // path reserved in every project. Only the studio's preview asks for this;
  // the public plays `/:slug/`, whose bytes are exactly what is on disk.
  //
  // Injecting here rather than asking an agent to carry a script tag means no
  // game has to be edited, none can lose it, and the commit the bytes came
  // from can be baked in — which is what files a problem against the code that
  // actually caused it. HEAD is read before the file, deliberately: a commit
  // landing in between then makes the version older than the bytes, and an
  // error filed against a superseded commit is dropped rather than shown.
  r.get(`/:slug/${WRAPPER_PATH}`, async (ctx) => {
    const project = gameForSlug(ctx.params.slug);
    const dir = path.join(root, project.slug);
    const version = await currentSha(dir).catch(() => '');
    const html = await readFileAt(path.join(dir, ENTRY_FILE));
    if (html === null) throw new HttpError(404, 'not found');

    ctx.res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    if (ctx.req.method === 'HEAD') return ctx.res.end();
    return ctx.res.end(wrapHtml(html.toString('utf8'), version));
  });

  // The scoreboard (spec.md §6): the one thing here that is not a file, and
  // the origin's first write route. Same posture as the rest of this
  // listener — no cookie read, a plain 404 for a slug that is not a game's —
  // with every dimension capped in scores.js. `_scores` cannot shadow a
  // game: an underscore is not legal in a slug. Archived games stay
  // playable, so they keep taking scores too.
  r.get('/_scores/:slug', (ctx) => {
    const game = scoreboardFor(ctx.params.slug);
    ctx.res.setHeader('Cache-Control', 'no-store');
    json(ctx.res, 200, { scores: topScores(db, game.id, ctx.query.get('limit')) });
  });

  r.post('/_scores/:slug', async (ctx) => {
    const game = scoreboardFor(ctx.params.slug);
    // The limit is checked before the body is read, so a flood costs headers.
    // ⚠️ Behind a reverse proxy every player arrives from the proxy's own
    // address, so without `TRUST_PROXY=1` this is one bucket for the whole
    // studio: ten posts a minute shared by every player of every game. The
    // flag is what makes the forwarded address readable, and it stays a flag
    // because unproxied anyone could send a fresh one per post and never be
    // limited at all.
    limitScores(clientIp(ctx));
    const body = await readJson(ctx.req, MAX_SCORE_BODY_BYTES);
    const rank = submitScore(db, game.id, body);
    ctx.res.setHeader('Cache-Control', 'no-store');
    json(ctx.res, 201, { rank });
  });

  // `/tank`, `/tank/`, and `/tank/index.html` all serve the entry point;
  // `/tank/js/game.js` serves that file.
  r.get('/:slug/*path', async (ctx) => {
    const project = gameForSlug(ctx.params.slug);

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
    return r.handle(req, res, { trustProxy });
  };
}
