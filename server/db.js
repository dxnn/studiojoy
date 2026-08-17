import { DatabaseSync } from 'node:sqlite';
import { nextUtcMidnight } from './util/time.js';

export const PROJECT_KINDS = ['game', 'chat'];

// Schema as an ordered list of idempotent statements, the same pattern new-y
// uses. Columns added after the initial release go through
// addColumnIfMissing rather than being edited into a CREATE TABLE string, so
// an existing database upgrades cleanly.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,

  // Agents are studio-global: no owner column, because any account may edit
  // any agent (spec.md §3). created_by is provenance for the UI only.
  `CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
    reasoning INTEGER NOT NULL DEFAULT 1,
    file_tools INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  // Unique among the living only, so a name frees up on soft delete and an
  // @mention always resolves to exactly one agent.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name
     ON agents (name) WHERE deleted = 0`,

  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users,
    created_at TEXT NOT NULL
  )`,

  // Hard delete on detach is safe here: nothing references these rows, and
  // the cooldown state they carry is disposable.
  `CREATE TABLE IF NOT EXISTS project_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects,
    agent_id INTEGER NOT NULL REFERENCES agents,
    chatty INTEGER NOT NULL DEFAULT 0,
    cooldown_until TEXT,
    response_pending INTEGER NOT NULL DEFAULT 0,
    attached_by INTEGER NOT NULL REFERENCES users,
    attached_at TEXT NOT NULL,
    UNIQUE (project_id, agent_id)
  )`,

  // No participant indirection: humans are implicit members of every
  // project, so a message points straight at a user or an agent. A 'system'
  // banner has neither, or an agent_id naming the agent it concerns.
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects,
    user_id INTEGER REFERENCES users,
    agent_id INTEGER REFERENCES agents,
    kind TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (NOT (user_id IS NOT NULL AND agent_id IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_project ON messages (project_id, id)`,

  `CREATE TABLE IF NOT EXISTS message_context (
    message_id INTEGER NOT NULL REFERENCES messages,
    path TEXT NOT NULL,
    PRIMARY KEY (message_id, path)
  )`,

  `CREATE TABLE IF NOT EXISTS message_writes (
    message_id INTEGER NOT NULL REFERENCES messages,
    path TEXT NOT NULL,
    action TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    PRIMARY KEY (message_id, path)
  )`,

  // What the game said while it was running, posted back by the reporter
  // inside it. Keyed to the commit it happened on, so a fix retires it
  // without anything having to clear the table (spec.md §8).
  `CREATE TABLE IF NOT EXISTS runtime_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects,
    commit_sha TEXT NOT NULL,
    message TEXT NOT NULL,
    location TEXT NOT NULL,
    times INTEGER NOT NULL DEFAULT 1,
    at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_errors_project
     ON runtime_errors (project_id, commit_sha)`,

  // Single row. One studio-wide daily budget, because agents have no owner
  // to bill (spec.md §3).
  `CREATE TABLE IF NOT EXISTS studio_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tokens_used_today INTEGER NOT NULL DEFAULT 0,
    budget_reset_at TEXT NOT NULL
  )`,
];

export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  // WAL only makes sense for a file-backed database.
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of MIGRATIONS) db.exec(sql);
  // A chat is a project with no working tree: same thread, same agents, no
  // files and nothing on disk (spec.md §3).
  addColumnIfMissing(db, 'projects', 'kind', "TEXT NOT NULL DEFAULT 'game'");
  // Off by default: a game becomes publicly listed only when someone says so.
  // It was always publicly *playable* — this is about the index, not access.
  addColumnIfMissing(db, 'projects', 'published', 'INTEGER NOT NULL DEFAULT 0');
  // What one agent turn cost, charged the same way the daily budget is. Null
  // on a human or system row, which cost nothing.
  addColumnIfMissing(db, 'messages', 'tokens', 'INTEGER');
  db.prepare(
    `INSERT OR IGNORE INTO studio_state (id, tokens_used_today, budget_reset_at)
     VALUES (1, 0, ?)`,
  ).run(nextUtcMidnight());
  return db;
}

// node:sqlite has no transaction() helper and rejects a nested BEGIN, so the
// depth guard turns what would be an opaque SQLite error into a clear one.
const inTx = new WeakSet();

export function tx(db, fn) {
  if (inTx.has(db)) {
    throw new Error('tx() cannot be nested; pass the open transaction down instead');
  }
  inTx.add(db);
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A failed rollback means the transaction was already gone; the
      // original error is the one worth propagating.
    }
    throw err;
  } finally {
    inTx.delete(db);
  }
}

export function addColumnIfMissing(db, table, column, spec, onAdded) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
  onAdded?.(db);
}
