import fs from 'node:fs';
import path from 'node:path';
import { createRouter } from './http/router.js';
import { serveFile } from './http/static.js';
import { HttpError } from './http/respond.js';
import { checkSlug, checkProjectPath, resolveInside } from './files/paths.js';
import { readFileAt, listTree } from './files/tree.js';
import { currentSha, logCommits } from './files/git.js';
import { ROBOT_FILE, WRAPPER_PATH, wrapHtml } from './reporter.js';
import { readJson } from './http/body.js';
import { json, noContent } from './http/respond.js';
import {
  topScores, submitScore, createScoreLimiter, MAX_SCORE_BODY_BYTES, MAX_SCORE_ROWS,
} from './scores.js';
import {
  listAchievements, unlockAchievement, definedAchievements,
  UNLOCKS_PER_MINUTE, MAX_UNLOCK_BODY_BYTES,
} from './achievements.js';
// What this listener borrows from the studio's modules is pure and narrow: a
// function over headers, the password verifiers and lockouts, and the player
// half of accounts. Nothing here can resolve a *studio* session.
import { clientIp } from './routes/helpers.js';
import {
  normalizeEmail, verifyPassword, verifyAgainstDummy, parseCookies,
  createLockout, DEFAULT_EMAIL_LOCKOUT, DEFAULT_IP_LOCKOUT, MAX_EMAIL_CHARS,
} from './auth.js';
import {
  PLAYER_COOKIE, createPlayerSession, deletePlayerSession, playerForToken,
  playerCookie, clearedPlayerCookie, createSignup,
} from './players.js';
import { catalogPage, playersPage } from './catalog.js';
import { joyOf, joyOn } from './joy.js';
import { isAuthor } from './authors.js';

const ENTRY_FILE = 'index.html';
// Login and sign-up bodies: three short strings.
const MAX_AUTH_BODY_BYTES = 1024;
// How recently a game's tree must have been committed to for the catalog to
// treat it as new, and how many such games lead the page.
const NEW_GAME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FEATURED_COUNT = 4;

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
// ⚠️ The one cookie read here is the *player* cookie — never `session`,
// which in development travels to this listener on the shared hostname and
// must open nothing. A player token opens exactly three doors: post a score
// as yourself, say who you are, sign out. Everything a game's own code could
// drive with it, it may as well do — a game already speaks for its player.
// The writes are the scoreboard and the waiting list, each one bounded
// table, never a working tree (spec.md §6). Names and slugs reach the
// catalog as text, never as markup.

const DEFAULT_PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public');

export function createGamesApp({
  db, gamesDir, pending = null, scoreRate, signupRate, unlockRate,
  trustProxy = false, secureCookies = false,
  publicDir = DEFAULT_PUBLIC_DIR,
  emailLockout = createLockout(DEFAULT_EMAIL_LOCKOUT),
  ipLockout = createLockout(DEFAULT_IP_LOCKOUT),
}) {
  if (!db) throw new Error('createGamesApp requires a db');
  const root = path.resolve(gamesDir);

  const r = createRouter();
  const limitScores = createScoreLimiter(scoreRate);
  // Stingier than scores on purpose: a person signs up once, a flood is
  // never a person, and every row costs a scrypt derivation on the way in.
  const limitSignups = createScoreLimiter(
    signupRate ?? { max: 5, windowMs: 10 * 60 * 1000, what: 'signups' },
  );
  // A game has at most fifty achievements, and a rule is met once a page, so
  // twenty a minute is the generous ceiling on an honest page.
  const limitUnlocks = createScoreLimiter(
    unlockRate ?? { max: UNLOCKS_PER_MINUTE, what: 'unlocks' },
  );

  const currentPlayer = (ctx) =>
    playerForToken(db, parseCookies(ctx.req.headers.cookie)[PLAYER_COOKIE]);

  // Slug → game row. Any refusal is a plain 404: the public has no business
  // learning why. A directory on disk with no project row is not public —
  // which is also what keeps a half-created project from being served — and
  // a chat has no directory at all, so its slug is not public either.
  const gameForSlug = (raw) => {
    const slug = checkSlug(raw);
    if (!slug.ok) throw new HttpError(404, 'not found');
    const project = db
      .prepare('SELECT id, slug, name, kind, scores_on, published FROM projects WHERE slug = ?')
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

  // The catalog (catalog.js). Only published games appear, so an unfinished
  // one stays unlisted while still being playable by link — the same bargain
  // as before, just findable now. Each card carries the game's hero.png when
  // it holds one (a reserved image, served like any other file of the
  // game's) and its board's best score when the board is on.
  //
  // ⚠️ The two extra headers are load-bearing, not hygiene: this page holds
  // a password form on the same origin as LLM-written game code, so a game
  // could otherwise iframe it or script a window it opened onto it and read
  // what is typed. frame-ancestors refuses every frame — the studio only
  // ever frames games, never this page — and COOP cuts the opener handle, so
  // window.open('/') from a game hands back nothing (spec.md §7).
  r.get('/', async (ctx) => {
    const player = currentPlayer(ctx);
    const rows = db
      .prepare(
        `SELECT p.id, p.slug, p.name, p.play_count,
                (SELECT MAX(score) FROM scores s WHERE s.project_id = p.id) AS top
           FROM projects p
          WHERE p.published = 1 AND p.kind = 'game' AND p.archived = 0
          ORDER BY p.name`,
      )
      .all();

    // Signed in, each card also says how *you* are doing: your best on that
    // board, and your trophies against what the game defines. Two reads keyed
    // on the player, and one file read per game — a handful of games, on a
    // page built per request anyway (ideas/front-page-players.md, rung 1).
    // Only ids the file still defines are counted, so a rule a helper removed
    // never makes it "3 of 2".
    const bests = new Map();
    const earned = new Map();
    if (player) {
      for (const b of db.prepare('SELECT project_id, score FROM personal_bests WHERE user_id = ?').all(player.id)) {
        bests.set(b.project_id, b.score);
      }
      for (const a of db.prepare('SELECT project_id, achievement FROM achievements WHERE user_id = ?').all(player.id)) {
        if (!earned.has(a.project_id)) earned.set(a.project_id, new Set());
        earned.get(a.project_id).add(a.achievement);
      }
    }
    const entries = [];
    for (const g of rows) {
      const dir = path.join(root, g.slug);
      const defined = await definedAchievements(dir);
      const mine = earned.get(g.id) ?? new Set();
      const [latest] = await logCommits(dir, { limit: 1 });
      // The joy still there to earn (server/joy.js): signed in, what you have
      // not earned yet — none in a game you author, which pays you nothing —
      // and signed out, everything the game gives. The catalog's whole pull.
      const joy = joyOn(db, g.id);
      const toEarn = player && isAuthor(db, g.id, player.id) ? 0 : defined
        .filter((a) => !mine.has(a.id))
        .reduce((n, a) => n + (joy.get(a.id) ?? 0), 0);
      entries.push({
        card: {
          slug: g.slug,
          name: g.name,
          top: g.top ?? null,
          hero: fs.existsSync(path.join(dir, 'hero.png')),
          icon: fs.existsSync(path.join(dir, 'icon.png')),
          best: bests.get(g.id) ?? null,
          achievements: player && defined.length
            ? { got: defined.filter((a) => mine.has(a.id)).length, of: defined.length }
            : null,
          joy: toEarn || null,
        },
        playCount: g.play_count,
        fresh: latest ? Date.now() - Date.parse(latest.at) < NEW_GAME_WINDOW_MS : false,
      });
    }

    // A few recently-changed games lead the page, reshuffled on every
    // request so no one game camps the top slot; everything else follows by
    // play count — a sort key only, never rendered (card() in catalog.js has
    // no field for it).
    const fresh = entries.filter((e) => e.fresh);
    for (let i = fresh.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
    }
    const featured = new Set(fresh.slice(0, FEATURED_COUNT));
    const rest = entries
      .filter((e) => !featured.has(e))
      .sort((a, b) => b.playCount - a.playCount);
    const games = [...featured, ...rest].map((e) => e.card);

    return sendPage(ctx, catalogPage({
      games, player: player ? { ...player, joy: joyOf(db, player.id) } : null,
    }));
  });

  // The two studio-authored pages share one posture: the catalog's headers
  // are load-bearing for its password form (§7), and the players page has no
  // form, but one posture for two pages costs nothing.
  const sendPage = (ctx, page) => {
    ctx.res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (ctx.req.method === 'HEAD') return ctx.res.end();
    return ctx.res.end(page);
  };

  // The front page as an installable PWA: its own manifest (a distinct name
  // from the studio's), the service worker catalogPage() registers, and the
  // icons both reference — all served from the studio's own public/ tree
  // rather than a second copy of the artwork. Underscore-prefixed like every
  // other studio-authored path here, so none of them can ever be shadowed by
  // a game's slug (checkSlug forbids `_`).
  r.get('/_manifest.json', (ctx) => serveFile(ctx.req, ctx.res, path.join(publicDir, 'games-manifest.json')));
  // Nothing here is for a search engine: the games are for the people who
  // were sent the link, and the boards were never meant to be read by the
  // whole internet (ideas/scoreboard-trust.md). An unlinked hostname is not a
  // hidden one — a certificate puts it in public logs. Not underscored, since
  // a crawler only ever asks this one path, and no slug can hold a dot.
  r.get('/robots.txt', (ctx) => {
    ctx.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    ctx.res.end(ctx.req.method === 'HEAD' ? undefined : 'User-agent: *\nDisallow: /\n');
  });
  r.get('/_sw.js', (ctx) => serveFile(ctx.req, ctx.res, path.join(publicDir, 'sw.js')));
  for (const name of ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png']) {
    r.get(`/_icons/${name}`, (ctx) => serveFile(ctx.req, ctx.res, path.join(publicDir, 'icons', name)));
  }

  // A game's players page (catalog.js): everybody's scores and trophies for
  // one game, at an underscore path no game file can shadow. The board and
  // the personal bests are left out entirely while the game's scoreboard is
  // off — a moderated board is not public in either direction, the same rule
  // as both _scores routes — and the trophies stay, because earned is forever.
  // The viewer's own rows are marked, which is the only thing the player
  // cookie does here. Removed accounts are joined out. Everybody is their
  // alias, never their name (alias.js).
  r.get('/:slug/_players', async (ctx) => {
    const game = gameForSlug(ctx.params.slug);
    const player = currentPlayer(ctx);
    const on = game.scores_on === 1;
    const board = on
      ? db.prepare(
        `SELECT name, score, user_id FROM scores WHERE project_id = ?
          ORDER BY score DESC, id LIMIT ?`,
      ).all(game.id, MAX_SCORE_ROWS)
      : [];
    const bests = on
      ? db.prepare(
        `SELECT b.user_id, b.score, u.alias AS name
           FROM personal_bests b JOIN users u ON u.id = b.user_id
          WHERE b.project_id = ? AND u.deleted = 0
          ORDER BY b.score DESC, b.created_at LIMIT 500`,
      ).all(game.id)
      : [];
    const holders = db.prepare(
      `SELECT a.achievement, a.user_id, u.alias AS name
         FROM achievements a JOIN users u ON u.id = a.user_id
        WHERE a.project_id = ? AND u.deleted = 0
        ORDER BY a.created_at LIMIT 2000`,
    ).all(game.id);
    const joy = joyOn(db, game.id);
    const achievements = (await definedAchievements(path.join(root, game.slug))).map((a) => ({
      ...a,
      names: holders.filter((h) => h.achievement === a.id).map((h) => h.name),
      mine: Boolean(player) && holders.some((h) => h.achievement === a.id && h.user_id === player.id),
      joy: joy.get(a.id) ?? 0,
    }));
    return sendPage(ctx, playersPage({
      game, player, board, bests, achievements,
    }));
  });

  // Who is signed in, for game code: {user: {name}} or {user: null}, never
  // an error — a game asking is how it decides whether to offer the sign-in
  // link or post the score. ⚠️ `name` carries the alias: every game and the
  // screens library read that key, so the key stays and its value changed.
  r.get('/_me', (ctx) => {
    const player = currentPlayer(ctx);
    ctx.res.setHeader('Cache-Control', 'no-store');
    json(ctx.res, 200, { user: player ? { name: player.alias } : null });
  });

  // The same accounts as the studio, deliberately not the same session: what
  // this mints is a `player` cookie backed by player_sessions, which the
  // studio never reads and which opens nothing there. Any account still in
  // signs in — studio access is about the other origin. Same lockouts, same
  // dummy-hash path, same refusal for every kind of miss as /api/login: which
  // kind of account an address carries is not said here either (spec.md §11).
  r.post('/_login', async (ctx) => {
    const body = await readJson(ctx.req, MAX_AUTH_BODY_BYTES);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = clientIp(ctx);

    ipLockout.check(ip);
    if (email) emailLockout.check(email);

    if (!email || email.length > MAX_EMAIL_CHARS || !password) {
      throw new HttpError(400, 'email and password are required');
    }

    const user = db
      .prepare('SELECT id, alias, password_hash FROM users WHERE email = ? AND deleted = 0')
      .get(email);
    const ok = user
      ? verifyPassword(password, user.password_hash)
      : verifyAgainstDummy(password);

    if (!ok) {
      emailLockout.fail(email);
      ipLockout.fail(ip);
      throw new HttpError(401, 'incorrect email or password');
    }

    emailLockout.succeed(email);
    const token = createPlayerSession(db, user.id);
    ctx.res.setHeader('Set-Cookie', playerCookie(token, { secure: secureCookies }));
    json(ctx.res, 200, { user: { name: user.alias } });
  });

  r.post('/_logout', (ctx) => {
    deletePlayerSession(db, parseCookies(ctx.req.headers.cookie)[PLAYER_COOKIE]);
    ctx.res.setHeader('Set-Cookie', clearedPlayerCookie({ secure: secureCookies }));
    noContent(ctx.res);
  });

  // The waiting list (spec.md §11). Nobody gets in from here: an admin
  // approves the row into an account with game access only, from Studio
  // settings. The answer is the same whether a row was made or the address
  // was already spoken for — a public form does not say what an email is to
  // this studio — so 202 is honest either way: accepted, decided later.
  r.post('/_signup', async (ctx) => {
    limitSignups(clientIp(ctx));
    const body = await readJson(ctx.req, MAX_AUTH_BODY_BYTES);
    createSignup(db, {
      email: body.email, displayName: body.name, password: body.password,
    });
    json(ctx.res, 202, { waiting: true });
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
    const head = await currentSha(dir).catch(() => '');
    // HEAD, or the saves on top of it while a pending commit is open, so a
    // problem is filed against the bytes the game is actually running.
    const version = head && pending ? pending.stampOf(project.slug, head) : head;
    const html = await readFileAt(path.join(dir, ENTRY_FILE));
    if (html === null) throw new HttpError(404, 'not found');
    // The robot's teacher, when the game has one (reporter.js).
    const robot = await fs.promises.stat(path.join(dir, ROBOT_FILE))
      .then((s) => s.isFile(), () => false);

    ctx.res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    if (ctx.req.method === 'HEAD') return ctx.res.end();
    return ctx.res.end(wrapHtml(html.toString('utf8'), version, { robot }));
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
    // Signed in, or the score does not count: the name on the board is the
    // account's, so there is nothing an anonymous post could honestly say.
    // The 401's message is written for the player a game shows it to.
    const player = currentPlayer(ctx);
    if (!player) throw new HttpError(401, 'sign in to get on the board');
    // The limit is checked before the body is read, so a flood costs headers.
    // Per player rather than per address: every post has an account behind
    // it now, and a household shares one address — siblings on one wifi were
    // sharing one ration. A signed-in flood is still a flood, and it is still
    // ten a minute; they are just that player's ten. The sign-up route below
    // stays per address, because nobody asking to join has an account yet.
    limitScores(player.id);
    const body = await readJson(ctx.req, MAX_SCORE_BODY_BYTES);
    const rank = submitScore(db, game.id, player, body);
    ctx.res.setHeader('Cache-Control', 'no-store');
    json(ctx.res, 201, { rank });
  });

  // Achievements (spec.md §6): the origin's third write, in the scoreboard's
  // posture — a plain 404 for anything that is not a game's, signed in or the
  // unlock does not count, its own rate limit per player. The definitions are
  // read from the game's own config/achievements.js on every request rather
  // than kept in a table, so a helper's edit is live at once and a fork
  // carries its achievements with it (achievements.js). Reading is
  // everybody's, and says `got` only for whoever is signed in. Archived games
  // stay playable, so they keep taking unlocks too.
  r.get('/_achievements/:slug', async (ctx) => {
    const game = gameForSlug(ctx.params.slug);
    const player = currentPlayer(ctx);
    const achievements = await listAchievements(
      db, game, path.join(root, game.slug), player ? player.id : null,
    );
    ctx.res.setHeader('Cache-Control', 'no-store');
    json(ctx.res, 200, { achievements });
  });

  r.post('/_achievements/:slug', async (ctx) => {
    const game = gameForSlug(ctx.params.slug);
    // Earned is per player, so with nobody signed in there is nobody to give
    // it to. The 401's message is what the library's toast says too.
    const player = currentPlayer(ctx);
    if (!player) throw new HttpError(401, 'sign in on the front page to keep it');
    limitUnlocks(player.id);
    const body = await readJson(ctx.req, MAX_UNLOCK_BODY_BYTES);
    const result = await unlockAchievement(
      db, game, path.join(root, game.slug), player.id, body,
    );
    ctx.res.setHeader('Cache-Control', 'no-store');
    json(ctx.res, 201, result);
  });

  // What a game has in assets/, live from disk, so a game can find its own
  // pictures and sounds without a hand-kept list (spec.md §6). Paths under
  // assets/ only: the rest of the tree is code, and code knows itself. A
  // chat's slug is a 404 like everything else here, and no-store like the
  // game's own files, because "live" is the point.
  r.get('/:slug/_assets', async (ctx) => {
    const game = gameForSlug(ctx.params.slug);
    const { files } = await listTree(path.join(root, game.slug));
    ctx.res.setHeader('Cache-Control', 'no-store');
    json(ctx.res, 200, {
      files: files
        .filter((f) => f.path.startsWith('assets/') && !f.unreachable)
        .map((f) => ({ path: f.path, size: f.size, mime: f.mime })),
    });
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

    // A play is a load of the game itself, not each asset it then fetches —
    // counted here rather than at the catalog, which only ever reads it.
    if (requested === ENTRY_FILE) {
      db.prepare('UPDATE projects SET play_count = play_count + 1 WHERE id = ?').run(project.id);
    }

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
