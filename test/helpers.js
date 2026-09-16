import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createBroker } from '../server/broker.js';
import { createMutex } from '../server/files/mutex.js';
import { createPending } from '../server/files/pending.js';
import { createUser } from '../server/auth.js';

// Fixtures live in the OS temp directory, not the repo. Two reasons: a test
// run shouldn't leave anything in the working tree, and the development
// sandbox refuses writes to any `.git` directory beneath the project root —
// which every git test needs to create. Nothing here is ever deleted; the OS
// reclaims it.
const SCRATCH_ROOT = path.join(
  process.env.TMPDIR ?? os.tmpdir(), 'gamestudio-test',
);

export function scratchDir(label = 'case') {
  const dir = path.join(
    SCRATCH_ROOT, `${label}-${crypto.randomBytes(4).toString('hex')}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Bind a handler to an ephemeral port and hand its base URL to `fn`.
// 127.0.0.1 is in NO_PROXY, so fetch reaches it without proxy configuration.
export async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    // fetch leaves the socket in its keep-alive pool, and close() waits for
    // idle connections — without this each server costs the keep-alive
    // timeout (~3s) before the test finishes.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// Cookie-aware client. Returns the raw Response so a test can assert on
// status and headers as well as the body. The jar holds both cookies the
// studio mints — `session` on its own origin, `player` on the games one —
// because one browser would hold both too.
function makeClient(base) {
  const jar = new Map();

  async function request(method, pathname, { body, headers = {}, rawBody } = {}) {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload;
    if (rawBody !== undefined) {
      payload = rawBody;
    } else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + pathname, {
      method, headers: h, body: payload, redirect: 'manual',
    });
    for (const setCookie of res.headers.getSetCookie?.() ?? []) {
      const pair = setCookie.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq);
      if (name !== 'session' && name !== 'player') continue;
      const value = pair.slice(eq + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return res;
  }

  return {
    request,
    get: (p, o) => request('GET', p, o),
    post: (p, body, o) => request('POST', p, { ...o, body }),
    patch: (p, body, o) => request('PATCH', p, { ...o, body }),
    put: (p, o) => request('PUT', p, o),
    del: (p, o) => request('DELETE', p, o),
    // Read the body as JSON alongside the status, which is most of what the
    // API tests want.
    async json(method, p, opts) {
      const res = await request(method, p, opts);
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : null,
      };
    },
    forget() { jar.clear(); },
    use(cookie) {
      jar.clear();
      if (!cookie) return;
      for (const pair of cookie.split(';')) {
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    peek() {
      return jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : null;
    },
  };
}

// A whole app on an ephemeral port, against in-memory SQLite and a temp
// games directory. Passing an `llm` wires a real orchestrator around it;
// cooldown defaults to 0 so a test doesn't wait five seconds between fires.
export async function setup({
  llm = null,
  gamesUrl = 'http://games.test',
  cooldownMs = 0,
  dailyTokenBudget = undefined,
  maxAssistantTurns = undefined,
  maxToolCalls = undefined,
  maxContinuations = undefined,
  smallTurns = undefined,
  smallToolCalls = undefined,
  publicDir = undefined,
  // A VAPID pair, for a test about web push. Left out, the studio is one
  // where nobody set push up: the routes are 404 and no message is told to
  // anybody — which is every other test in the suite.
  push = null,
} = {}) {
  const db = openDb(':memory:');
  const gamesDir = scratchDir('games');
  // A public directory with no libraries in it, so the games tests make are
  // born empty: what creation scaffolds is its own test (against the real
  // public/), and the rest of the suite should not churn every time the
  // studio grows a library.
  if (publicDir === undefined) {
    publicDir = scratchDir('public');
    fs.mkdirSync(path.join(publicDir, 'studio-lib'), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'studio-lib', 'index.json'), '{ "libraries": {} }\n');
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html>\n');
  }
  const broker = createBroker();
  const mutex = createMutex();
  // The idle timer is the real 45 s: a test that wants a save committed says
  // so, through the commit route or `app.pending.settle`.
  const pending = createPending({ mutex, db, broker });
  let orchestrator = null;
  if (llm) {
    const { createOrchestrator } = await import('../server/agents/orchestrator.js');
    orchestrator = createOrchestrator({
      db,
      broker,
      mutex,
      pending,
      llm,
      gamesDir,
      cooldownMs,
      ...(dailyTokenBudget === undefined ? {} : { dailyTokenBudget }),
      ...(maxAssistantTurns === undefined ? {} : { maxAssistantTurns }),
      ...(maxToolCalls === undefined ? {} : { maxToolCalls }),
      ...(maxContinuations === undefined ? {} : { maxContinuations }),
      ...(smallTurns === undefined ? {} : { smallTurns }),
      ...(smallToolCalls === undefined ? {} : { smallToolCalls }),
    });
  }
  const handler = createApp({
    db, broker, mutex, pending, gamesDir, llm, orchestrator, gamesUrl, publicDir, push,
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    db,
    gamesDir,
    broker,
    mutex,
    pending,
    orchestrator,
    base,
    server,
    client: makeClient(base),
    newClient: () => makeClient(base),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

// The public listener, over the same db and games directory as a studio
// fixture. Separate server, separate origin — which is the whole point.
export async function startGames(fixture, opts = {}) {
  const { createGamesApp } = await import('../server/games.js');
  const handler = createGamesApp({
    db: fixture.db, gamesDir: fixture.gamesDir, pending: fixture.pending, ...opts,
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    client: makeClient(base),
    // A second player is a second browser: their own cookie jar.
    newClient: () => makeClient(base),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// The room a test's own helper can be put in: a chat project's one room. A
// game has none — every room there is the humans' or the builder's — so this
// names a chat project, made here when the test has not made it yet, and a
// game's slug is a loud failure rather than a room.
export async function workChat(app, slug = 'talk') {
  let res = await app.client.json('GET', `/api/projects/${slug}`);
  if (res.status === 404) {
    const made = await app.client.json('POST', '/api/projects', {
      body: { name: slug, slug, kind: 'chat' },
    });
    if (made.status !== 201) throw new Error(`could not make the chat project ${slug}: ${made.status}`);
    res = await app.client.json('GET', `/api/projects/${slug}`);
  }
  const room = res.body.chats?.find((c) => c.bots && !c.builder);
  if (!room) throw new Error(`${slug} has no room a helper of your own can be put in`);
  return room.id;
}

// The builder's room in a game: where the studio's own helper answers.
export async function builderChat(app, slug = 'tank') {
  const res = await app.client.json('GET', `/api/projects/${slug}`);
  const chat = res.body.chats?.find((c) => c.builder);
  if (!chat) throw new Error(`no builder room in ${slug}`);
  return chat.id;
}

// Put an agent in that chat. The route is per chat, so this is the two calls
// every test that wants a helper answering has to make.
export async function putInChat(app, slug, agentId, body = {}) {
  const chatId = body.chat_id ?? await workChat(app, slug);
  return app.client.json('POST', `/api/projects/${slug}/chats/${chatId}/agents`, {
    body: { agent_id: agentId, ...body },
  });
}

export async function signIn(fixture, {
  email = 'dann@example.com', password = 'hunter2', displayName = 'Dann',
  client = fixture.client,
} = {}) {
  const user = createUser(fixture.db, { email, password, displayName });
  const res = await client.post('/api/login', { email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  await res.text();
  return user;
}

// A player signed in on the games origin. Makes the account when the address
// is new; pass `client: games.newClient()` for a second player on their own
// cookie jar. The account is a studio one — the games origin takes any kind.
export async function playerSignIn(fixture, games, {
  email = 'pat@example.com', password = 'hunter2', displayName = 'Pat',
  client = games.client,
} = {}) {
  if (!fixture.db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    createUser(fixture.db, { email, password, displayName });
  }
  const res = await client.post('/_login', { email, password });
  if (res.status !== 200) throw new Error(`player login failed: ${res.status}`);
  await res.text();
  return client;
}

function parseFrame(chunk) {
  let event = 'message';
  const data = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith(':')) return null; // comment / heartbeat
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return { event, data: data.join('\n') };
  }
}

// Attach to /api/stream and collect events. `waitFor` resolves with the first
// event matching a predicate, including ones that arrived before it was
// called, so a test can post first and assert afterwards without racing.
export async function openStream(client) {
  const res = await client.get('/api/stream');
  if (res.status !== 200) throw new Error(`stream failed: ${res.status}`);
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;

  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const split = buffer.indexOf('\n\n');
          if (split === -1) break;
          const frame = parseFrame(buffer.slice(0, split));
          buffer = buffer.slice(split + 2);
          if (frame) events.push(frame);
        }
      }
    } catch {
      // Cancelled, or the server went away. Either way we're done reading.
    }
  })();

  return {
    events,
    async waitFor(predicate, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = events.find(predicate);
        if (hit) return hit;
        if (closed) throw new Error('stream closed while waiting');
        if (Date.now() > deadline) {
          const seen = events.map((e) => e.event).join(', ') || 'nothing';
          throw new Error(`timed out waiting for an event; saw: ${seen}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    async close() {
      closed = true;
      await reader.cancel().catch(() => {});
      await pump;
    },
  };
}
