import path from 'node:path';
import { createRouter } from './http/router.js';
import { serveFile } from './http/static.js';
import { HttpError } from './http/respond.js';
import { gamesUrlFrom } from './http/origin.js';
import { resolveInside } from './files/paths.js';
import { createBroker } from './broker.js';
import { createMutex } from './files/mutex.js';
import { createPending } from './files/pending.js';
import { createLockout, DEFAULT_EMAIL_LOCKOUT, DEFAULT_IP_LOCKOUT } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { agentRoutes } from './routes/agents.js';
import { chatRoutes } from './routes/chats.js';
import { adminRoutes } from './routes/admin.js';
import { fileRoutes } from './routes/files.js';
import { historyRoutes } from './routes/history.js';
import { messageRoutes } from './routes/messages.js';
import { errorRoutes } from './routes/errors.js';
import { streamRoutes } from './routes/stream.js';
import { achievementRoutes } from './routes/achievements.js';
import { storyRoutes } from './routes/story.js';
import { collectionRoutes } from './routes/collection.js';
import { gearRoutes } from './routes/gear.js';
import { pushRoutes } from './routes/push.js';
import { planRoutes } from './routes/plans.js';
import { tell } from './notify.js';
import { ensureAnnouncements } from './announcements.js';

const DEFAULT_PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public');

// Every collaborator is injectable so a test can build a whole app against
// in-memory SQLite, a temp games directory, and a scripted LLM — the pattern
// new-y uses, and the reason the suite needs no network.
export function createApp({
  db,
  broker = createBroker(),
  mutex = createMutex(),
  gamesDir = 'games',
  llm = null,
  orchestrator = null,
  gamesUrl = null,
  gamesPort = 8101,
  secureCookies = false,
  trustProxy = false,
  publicDir = DEFAULT_PUBLIC_DIR,
  emailLockout = createLockout(DEFAULT_EMAIL_LOCKOUT),
  ipLockout = createLockout(DEFAULT_IP_LOCKOUT),
  // Shared with the orchestrator and the games listener when there are any:
  // one window per project, whoever asks about it.
  pending = createPending({ mutex, db, broker }),
  // The VAPID keys, or null where nobody has set push up — a studio without
  // them still tells everybody whose tab is alive (spec/ §6, rung 1). Passed
  // in rather than read from the environment here so a test can hand over a
  // pair without one.
  push = null,
}) {
  if (!db) throw new Error('createApp requires a db');
  // A studio from before the announcements gets its room the first time it
  // starts; a new one, when its first account is made (auth.js).
  ensureAnnouncements(db);

  // ⚠️ Hung on the broker rather than added beside each `message.new`: three
  // places broadcast one, and a push has to reach a browser with no
  // connection at all, so it cannot ride the fan-out. Never awaited — a slow
  // push service must not hold up a reply landing in the thread — and its
  // failures are its own (server/notify.js).
  if (push) {
    broker.watchMessages((message) => {
      tell(db, push, message).catch((err) => {
        console.error('could not tell anybody about a message:', err?.message ?? err);
      });
    });
  }
  // When a game last changed (spec/ §3): every write to its tree and every
  // change to its row is broadcast, so the stamp hangs here rather than on
  // each of the routes that would otherwise have to remember it.
  broker.watchChanges((slug) => {
    db.prepare('UPDATE projects SET updated_at = ? WHERE slug = ?')
      .run(new Date().toISOString(), slug);
  });

  const r = createRouter();

  // API first: the static catch-all below matches every GET path, so route
  // order is what keeps `/api/...` from being read as a filename.
  authRoutes(r);
  adminRoutes(r);
  projectRoutes(r);
  agentRoutes(r);
  chatRoutes(r);
  fileRoutes(r);
  historyRoutes(r);
  messageRoutes(r);
  errorRoutes(r);
  streamRoutes(r);
  achievementRoutes(r);
  storyRoutes(r);
  collectionRoutes(r);
  gearRoutes(r);
  pushRoutes(r);
  planRoutes(r);

  // Unknown /api paths are 404 for every method. Without this the static
  // catch-all below would claim them, and a POST to a nonexistent endpoint
  // would answer 405 with `Allow: GET, HEAD` — implying a GET exists there,
  // and inviting a filesystem read for an API path.
  const apiNotFound = () => {
    throw new HttpError(404, 'no such endpoint');
  };
  r.get('/api/*path', apiNotFound);
  r.post('/api/*path', apiNotFound);
  r.put('/api/*path', apiNotFound);
  r.patch('/api/*path', apiNotFound);
  r.delete('/api/*path', apiNotFound);

  const sendIndex = (ctx) => serveFile(ctx.req, ctx.res, path.join(publicDir, 'index.html'));

  // Client-side routing: every entry point serves the same shell — the studio,
  // a game, and the wardrobe (public/wardrobe.js).
  r.get('/', sendIndex);
  r.get('/p/:slug', sendIndex);
  r.get('/wardrobe', sendIndex);

  r.get('/*path', async (ctx) => {
    const rel = ctx.params.path;
    if (!rel) return sendIndex(ctx);
    const abs = resolveInside(publicDir, rel);
    if (abs === null) throw new HttpError(404, 'not found');
    await serveFile(ctx.req, ctx.res, abs);
  });

  const base = {
    db, broker, mutex, pending, gamesDir, llm, orchestrator, publicDir,
    secureCookies, trustProxy, emailLockout, ipLockout, push,
  };

  return (req, res) => {
    // Set globally rather than per route so a new route can't forget them.
    // X-Frame-Options DENY protects the studio; the games origin
    // deliberately omits it so the studio can embed a preview (spec.md §7).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Resolved per request, not once at startup: an explicit `gamesUrl` wins
    // (separate hostnames in production), and without one the games origin is
    // this request's own hostname on the games port — so the studio answers
    // correctly at every name it can be reached by, with none configured.
    return r.handle(req, res, {
      ...base,
      gamesUrl: gamesUrl ?? gamesUrlFrom(req, gamesPort),
    });
  };
}
