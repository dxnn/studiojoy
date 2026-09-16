import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createGamesApp } from './games.js';
import { createBroker } from './broker.js';
import { createMutex } from './files/mutex.js';
import { createPending } from './files/pending.js';
import { reconcileTrees } from './files/reconcile.js';
import { createDeepSeek, DEFAULT_BASE_URL } from './llm/deepseek.js';
import { createOrchestrator } from './agents/orchestrator.js';
import { DEFAULT_DAILY_TOKEN_BUDGET } from './budget.js';
import { pushConfig } from './push.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('DEEPSEEK_API_KEY is required');
  process.exit(1);
}

// 8100/8101 rather than 8090/8091: hyper-y, the project this one is modelled
// on, defaults to 8090, and both are expected to run at once.
const port = Number(process.env.PORT ?? 8100);
const gamesPort = Number(process.env.GAMES_PORT ?? 8101);
// Normally unset: play and preview links then follow whatever hostname the
// studio was reached by, on the games port. Set it when the two listeners sit
// behind separate names rather than separate ports (spec.md §7).
const gamesUrl = process.env.GAMES_URL ?? null;
const dbPath = process.env.DB_PATH ?? 'gamestudio.db';
const gamesDir = path.resolve(process.env.GAMES_DIR ?? 'games');
const dailyTokenBudget = Number(
  process.env.DAILY_TOKEN_BUDGET ?? DEFAULT_DAILY_TOKEN_BUDGET,
);

fs.mkdirSync(gamesDir, { recursive: true });

const db = openDb(dbPath);
const broker = createBroker();
const mutex = createMutex();
// One set of pending commits for the whole process: the studio's routes open
// them, the orchestrator settles them before a fire, and the games listener
// reads them to stamp the preview (spec.md §5).
const pending = createPending({ mutex, db, broker });
const llm = createDeepSeek({
  apiKey,
  baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
});
const orchestrator = createOrchestrator({
  db, broker, mutex, pending, llm, gamesDir, dailyTokenBudget,
});

// Two listeners, one process, deliberately separate origins (spec.md §7):
// game code written by an LLM must not be able to reach the studio's cookie.
const studio = http.createServer(createApp({
  db,
  broker,
  mutex,
  pending,
  gamesDir,
  llm,
  orchestrator,
  gamesUrl,
  gamesPort,
  secureCookies: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  // Null without VAPID_* in the environment, which is a studio that tells
  // people things only while their tab is alive (spec/ §6). `npm run
  // pushkeys` makes the pair.
  push: pushConfig(),
}));
const games = http.createServer(createGamesApp({
  db,
  gamesDir,
  pending,
  trustProxy: process.env.TRUST_PROXY === '1',
  secureCookies: process.env.NODE_ENV === 'production',
}));

// Without these, a port clash surfaces as an unhandled 'error' event and a
// stack trace, which says nothing useful about what to do next.
const listenFailed = (label, envVar) => (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`${label} port ${err.port} is already in use — set ${envVar}`);
  } else if (err.code === 'EACCES') {
    console.error(`${label} port ${err.port} needs privileges — set ${envVar}`);
  } else {
    console.error(`${label} listener failed: ${err.message}`);
  }
  process.exit(1);
};
studio.on('error', listenFailed('studio', 'PORT'));
games.on('error', listenFailed('games', 'GAMES_PORT'));

// ⚠️ Before either listener binds, so nothing is writing while it runs: a tree
// still dirty at this point is work the last run left behind, and no later
// save, turn or sweep would ever name those paths (spec.md §5).
await reconcileTrees({ gamesDir, mutex });

// Both listeners bind every interface, so localhost is one way in rather than
// the address — which is why the games line names a port, not a fixed URL.
studio.listen(port, () => {
  console.log(`studio   http://localhost:${port}`);
  console.log(gamesUrl
    ? `games    ${gamesUrl}`
    : `games    port ${gamesPort}, on whatever hostname reaches the studio`);
  console.log(`db       ${dbPath}`);
  console.log(`worktree ${gamesDir}`);
});
games.listen(gamesPort);

// There is no signup route, so an empty user table means nobody can get in.
if (db.prepare('SELECT COUNT(*) AS c FROM users WHERE deleted = 0').get().c === 0) {
  console.log('\nno accounts yet — create one with:');
  console.log('  npm run adduser -- you@example.com "Your Name"');
}

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) process.exit(1);
    closing = true;
    console.log('\nshutting down');
    studio.closeAllConnections();
    games.closeAllConnections();
    let open = 2;
    const done = () => {
      open -= 1;
      if (open > 0) return;
      // Whatever any game still owes history lands before the door shuts;
      // a save is never lost to a restart, only its commit deferred to here.
      pending.settleAll().finally(() => {
        db.close();
        process.exit(0);
      });
    };
    studio.close(done);
    games.close(done);
  });
}
