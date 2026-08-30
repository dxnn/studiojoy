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

  // Who may change a game. Presence in `users` is still what gets you into
  // the studio; this is what gets you into somebody else's game. The person
  // who made it is its first author, and an author is the only one who can add
  // another — see server/authors.js.
  `CREATE TABLE IF NOT EXISTS project_authors (
    project_id INTEGER NOT NULL REFERENCES projects,
    user_id INTEGER NOT NULL REFERENCES users,
    added_by INTEGER NOT NULL REFERENCES users,
    added_at TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id)
  )`,

  // A conversation inside a project. Every project has at least one, made
  // with it: the human-only chat, which is what "no bots allowed" means as a
  // row rather than as an absence — `bots = 0` is refused at attach time, not
  // only when somebody would have answered.
  `CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects,
    name TEXT NOT NULL,
    bots INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chats_project ON chats (project_id, id)`,

  // Hard delete on detach is safe here: nothing references these rows, and
  // the cooldown state they carry is disposable. Per chat rather than per
  // project: a helper is in a conversation, so its cooldown and its dirty bit
  // belong to that conversation too.
  `CREATE TABLE IF NOT EXISTS chat_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats,
    agent_id INTEGER NOT NULL REFERENCES agents,
    chatty INTEGER NOT NULL DEFAULT 0,
    cooldown_until TEXT,
    response_pending INTEGER NOT NULL DEFAULT 0,
    attached_by INTEGER NOT NULL REFERENCES users,
    attached_at TEXT NOT NULL,
    UNIQUE (chat_id, agent_id)
  )`,

  // No participant indirection: humans are implicit members of every
  // project, so a message points straight at a user or an agent. A 'system'
  // banner has neither, or an agent_id naming the agent it concerns.
  // `chat_id` is which conversation in the project this belongs to. Nullable
  // in the column definition only so a database written before chats existed
  // can be upgraded in place; every row written since has one.
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects,
    chat_id INTEGER REFERENCES chats,
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

  // What one reply was given and what it cost, captured when it fired —
  // none of it can be reconstructed later, files change and trim boundaries
  // move. The breakdown is small and kept on every reply; the prompt is a
  // debugging aid held only for the newest reply in each project, taken with
  // it by the next fire (spec.md §8).
  `CREATE TABLE IF NOT EXISTS message_receipts (
    message_id INTEGER PRIMARY KEY REFERENCES messages,
    project_id INTEGER NOT NULL REFERENCES projects,
    breakdown TEXT NOT NULL,
    prompt TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_project
     ON message_receipts (project_id)`,

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

  // What the public posted from inside a running game — the games origin's
  // one write (spec.md §6). Pruned to the best rows per project on every
  // insert, so the table is bounded by construction.
  `CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scores_project
     ON scores (project_id, score DESC, id)`,

  // What one person's helpers spent on one day, so an allowance can be
  // checked without a rollover column per user: a day that is not today is
  // simply a row nothing reads. Also the only record of who spent what, which
  // the admin panel shows.
  `CREATE TABLE IF NOT EXISTS user_tokens (
    user_id INTEGER NOT NULL REFERENCES users,
    day TEXT NOT NULL,
    tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`,

  // Single row: the studio-wide budget, which is the outer wall around every
  // person's own allowance.
  // One row per person a message called by name, unseen until they open the
  // chat it was said in. A row rather than an event because the mark has to
  // outlive the tab that was open when it landed, and per chat because reading
  // one conversation says nothing about what was said in another.
  `CREATE TABLE IF NOT EXISTS mentions (
    message_id INTEGER NOT NULL REFERENCES messages,
    user_id INTEGER NOT NULL REFERENCES users,
    chat_id INTEGER NOT NULL REFERENCES chats,
    project_id INTEGER NOT NULL REFERENCES projects,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mentions_waiting
     ON mentions (user_id, seen, project_id)`,

  `CREATE TABLE IF NOT EXISTS studio_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tokens_used_today INTEGER NOT NULL DEFAULT 0,
    budget_reset_at TEXT NOT NULL,
    daily_token_budget INTEGER
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
  // On by default: the per-game switch for the public scoreboard. Off, both
  // /_scores routes answer 404 and helpers are not told the board exists;
  // the rows are kept, so turning it back on brings the board back (§6).
  addColumnIfMissing(db, 'projects', 'scores_on', 'INTEGER NOT NULL DEFAULT 1');
  // What one agent turn cost, charged the same way the daily budget is. Null
  // on a human or system row, which cost nothing.
  addColumnIfMissing(db, 'messages', 'tokens', 'INTEGER');
  // How many earlier messages the history budget kept out of this reply's
  // context. Null on anything but an agent reply, and on a reply that saw the
  // whole conversation (spec.md §8).
  addColumnIfMissing(db, 'messages', 'trimmed', 'INTEGER');
  // Which conversation a message is in. A database from before chats existed
  // has one thread per project; the upgrade gives that thread a home rather
  // than leaving it stranded (see intoChats).
  // Who may run the studio: add an account, rename one, set what it may
  // spend, take it away. Exactly one bit, and the first account gets it —
  // somebody has to be able to make the second one.
  addColumnIfMissing(db, 'users', 'admin', 'INTEGER NOT NULL DEFAULT 0', (d) => {
    d.prepare(
      'UPDATE users SET admin = 1 WHERE id = (SELECT MIN(id) FROM users)',
    ).run();
  });
  // What one person's helpers may spend in a day. Null is no allowance of
  // their own — only the studio-wide budget, which is the outer wall either
  // way.
  addColumnIfMissing(db, 'users', 'daily_tokens', 'INTEGER');
  // Off by default: a game is its authors' until they say otherwise. On, any
  // account in the studio may change it — which is a thing you choose, not a
  // thing that happens because nobody got round to adding you.
  addColumnIfMissing(db, 'projects', 'open_edit', 'INTEGER NOT NULL DEFAULT 0');
  // The studio-wide budget, editable in the admin panel rather than a
  // constant in the source. Null means the built-in default still applies.
  addColumnIfMissing(db, 'studio_state', 'daily_token_budget', 'INTEGER');
  addColumnIfMissing(db, 'messages', 'chat_id', 'INTEGER REFERENCES chats');
  // After the column, not with the other CREATEs: on a database written before
  // chats there is nothing to index until the line above has run.
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, id)');
  // The human-only chat used to be called "Just us". Renaming the rows rather
  // than translating the name on the way out: it is a name somebody can change
  // themselves, so there is nowhere else it could honestly live. Anything the
  // studio's people have since renamed keeps its own name — this only moves
  // rows still carrying the old default.
  db.prepare('UPDATE chats SET name = ? WHERE name = ? AND bots = 0')
    .run(HOME_CHAT, OLD_HOME_CHAT);
  intoChats(db);
  // Every project that predates authorship gets the person who made it, which
  // is the only honest answer available: nothing else in the row says who
  // worked on it.
  db.prepare(
    `INSERT OR IGNORE INTO project_authors (project_id, user_id, added_by, added_at)
     SELECT id, created_by, created_by, created_at FROM projects`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO studio_state (id, tokens_used_today, budget_reset_at)
     VALUES (1, 0, ?)`,
  ).run(nextUtcMidnight());
  return db;
}

// The name of the chat every project is born with, and the one no helper can
// be put into. Exported because creation writes it and the client shows it.
export const HOME_CHAT = 'Humans only';
// What it was called before, kept for the one statement that renames it.
const OLD_HOME_CHAT = 'Just us';
// Where a project that predates chats has its conversation put: helpers were
// in it, so it is the chat that allows them.
const CARRIED_CHAT = 'Building';

// Every project has two chats: the human-only one it opens on, and one where
// helpers can be put. A database written before chats existed has one thread
// per project and its helpers attached to the project; this gives both a chat
// to live in without changing what anybody said or who was talking.
//
// ⚠️ Both, unconditionally. The first version of this made `Building` only for
// a project that had something to carry into it, which left a game nobody had
// talked in yet with nowhere a helper could ever be put — the two conditions
// below are about what moves, never about whether the chat exists.
function intoChats(db) {
  const projects = db.prepare(
    `SELECT p.id, p.created_at,
            (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) AS chats,
            (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id AND c.bots = 1) AS bot_chats
       FROM projects p`,
  ).all();
  const old = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_agents'").all();
  const hasOld = old.length > 0;

  for (const project of projects) {
    if (project.chats === 0) {
      db.prepare(
        'INSERT INTO chats (project_id, name, bots, created_at) VALUES (?, ?, 0, ?)',
      ).run(project.id, HOME_CHAT, project.created_at);
    }
    // A chat that allows helpers already exists — under whatever name it has
    // since been given, which is why this counts the flag and not the name.
    if (project.bot_chats > 0) continue;

    const building = db.prepare(
      'INSERT INTO chats (project_id, name, bots, created_at) VALUES (?, ?, 1, ?)',
    ).run(project.id, CARRIED_CHAT, project.created_at);
    // Both no-ops for a project that has nothing from before chats: a thread
    // already in a chat is not stranded, and the old table may not exist.
    db.prepare('UPDATE messages SET chat_id = ? WHERE project_id = ? AND chat_id IS NULL')
      .run(building.lastInsertRowid, project.id);
    if (hasOld) {
      db.prepare(
        `INSERT INTO chat_agents
           (chat_id, agent_id, chatty, cooldown_until, response_pending, attached_by, attached_at)
         SELECT ?, agent_id, chatty, cooldown_until, 0, attached_by, attached_at
           FROM project_agents WHERE project_id = ?`,
      ).run(building.lastInsertRowid, project.id);
    }
  }

  // Dropped rather than left behind: two tables that disagree about who is in
  // a conversation is the kind of thing that reads as a bug for a year.
  if (hasOld) db.exec('DROP TABLE project_agents');
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
