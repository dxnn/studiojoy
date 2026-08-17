import path from 'node:path';
import { createRouter } from './http/router.js';
import { serveFile } from './http/static.js';
import { HttpError } from './http/respond.js';
import { gamesUrlFrom } from './http/origin.js';
import { resolveInside } from './files/paths.js';
import { createBroker } from './broker.js';
import { createMutex } from './files/mutex.js';
import { createLockout, DEFAULT_EMAIL_LOCKOUT, DEFAULT_IP_LOCKOUT } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { agentRoutes } from './routes/agents.js';
import { fileRoutes } from './routes/files.js';
import { historyRoutes } from './routes/history.js';
import { messageRoutes } from './routes/messages.js';
import { errorRoutes } from './routes/errors.js';
import { streamRoutes } from './routes/stream.js';

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
}) {
  if (!db) throw new Error('createApp requires a db');

  const r = createRouter();

  // API first: the static catch-all below matches every GET path, so route
  // order is what keeps `/api/...` from being read as a filename.
  authRoutes(r);
  projectRoutes(r);
  agentRoutes(r);
  fileRoutes(r);
  historyRoutes(r);
  messageRoutes(r);
  errorRoutes(r);
  streamRoutes(r);

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

  // Client-side routing: both entry points serve the same shell.
  r.get('/', sendIndex);
  r.get('/p/:slug', sendIndex);

  r.get('/*path', async (ctx) => {
    const rel = ctx.params.path;
    if (!rel) return sendIndex(ctx);
    const abs = resolveInside(publicDir, rel);
    if (abs === null) throw new HttpError(404, 'not found');
    await serveFile(ctx.req, ctx.res, abs);
  });

  const base = {
    db, broker, mutex, gamesDir, llm, orchestrator,
    secureCookies, trustProxy, emailLockout, ipLockout,
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
