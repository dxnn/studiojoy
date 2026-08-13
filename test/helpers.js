import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createBroker } from '../server/broker.js';
import { createMutex } from '../server/files/mutex.js';
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
// status and headers as well as the body.
function makeClient(base) {
  let jar = null;

  async function request(method, pathname, { body, headers = {}, rawBody } = {}) {
    const h = { ...headers };
    if (jar) h.cookie = jar;
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
      if (!pair.startsWith('session=')) continue;
      jar = pair === 'session=' ? null : pair;
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
    forget() { jar = null; },
    use(cookie) { jar = cookie; },
    peek() { return jar; },
  };
}

// A whole app on an ephemeral port, against in-memory SQLite and a temp
// games directory.
export async function setup({ llm = null, orchestrator = null, gamesUrl = 'http://games.test' } = {}) {
  const db = openDb(':memory:');
  const gamesDir = scratchDir('games');
  const broker = createBroker();
  const mutex = createMutex();
  const handler = createApp({
    db, broker, mutex, gamesDir, llm, orchestrator, gamesUrl,
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    db,
    gamesDir,
    broker,
    mutex,
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
export async function startGames(fixture) {
  const { createGamesApp } = await import('../server/games.js');
  const handler = createGamesApp({ db: fixture.db, gamesDir: fixture.gamesDir });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    client: makeClient(base),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
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
