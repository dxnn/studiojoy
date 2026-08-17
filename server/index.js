import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createGamesApp } from './games.js';
import { createBroker } from './broker.js';
import { createMutex } from './files/mutex.js';
import { createDeepSeek, DEFAULT_BASE_URL } from './llm/deepseek.js';
import { createOrchestrator } from './agents/orchestrator.js';
import { DEFAULT_DAILY_TOKEN_BUDGET } from './budget.js';

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
const llm = createDeepSeek({
  apiKey,
  baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
});
const orchestrator = createOrchestrator({
  db, broker, mutex, llm, gamesDir, dailyTokenBudget,
});

// Two listeners, one process, deliberately separate origins (spec.md §7):
// game code written by an LLM must not be able to reach the studio's cookie.
const studio = http.createServer(createApp({
  db,
  broker,
  mutex,
  gamesDir,
  llm,
  orchestrator,
  gamesUrl,
  gamesPort,
  secureCookies: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
}));
const games = http.createServer(createGamesApp({ db, gamesDir }));

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
if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
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
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending > 0) return;
      db.close();
      process.exit(0);
    };
    studio.close(done);
    games.close(done);
  });
}
