import { DatabaseSync } from 'node:sqlite';
import { nextUtcMidnight } from './util/time.js';
import { intoBuilderRooms } from './builder.js';
import { pauseRunningPlans } from './plans.js';

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
    model TEXT NOT NULL DEFAULT 'deepseek-flash',
    thinking TEXT NOT NULL DEFAULT 'low',
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

  // The last frame of the game somebody was looking at, one per project,
  // replaced rather than kept: what `look_at_game` shows a helper (spec.md
  // §8). A row and not a file, for the same reason a score is one — a shot
  // commits nothing, restarts no preview and enters no history.
  `CREATE TABLE IF NOT EXISTS project_shots (
    project_id INTEGER PRIMARY KEY REFERENCES projects,
    mime TEXT NOT NULL,
    bytes BLOB NOT NULL,
    version TEXT NOT NULL,
    at TEXT NOT NULL
  )`,

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

  // The newest message id one person has read in one chat — the generic
  // "something is unread here" flag, independent of `mentions`, which is
  // only "you were named". A row per (user, chat) for the same reason a
  // mention is: the mark has to outlive the tab that was open when it
  // landed, and per chat because reading one conversation says nothing
  // about another. Absent is nothing read yet.
  `CREATE TABLE IF NOT EXISTS chat_reads (
    user_id INTEGER NOT NULL REFERENCES users,
    chat_id INTEGER NOT NULL REFERENCES chats,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, chat_id)
  )`,

  `CREATE TABLE IF NOT EXISTS studio_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tokens_used_today INTEGER NOT NULL DEFAULT 0,
    budget_reset_at TEXT NOT NULL,
    daily_token_budget INTEGER
  )`,

  // An emoji a person put on a message. The composite key is the whole
  // toggle: adding the same one twice is a conflict, so taking one back is a
  // DELETE and nothing ever counts double — the pattern proved in new-y.
  // People only; an agent never reacts, so there is no agent column.
  `CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL REFERENCES messages,
    user_id INTEGER NOT NULL REFERENCES users,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reactions_message
     ON message_reactions (message_id)`,

  // The waiting list: what the games origin's public sign-up form writes.
  // Never an account by itself — an admin approves a row into `users` (with
  // game access only) or refuses it. Decided rows are kept for the audit
  // trail, which is also what UNIQUE buys: one story per address, however it
  // ended. The password arrives hashed and rides along so approval does not
  // need the person present.
  `CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    approved_by INTEGER REFERENCES users,
    approved_at TEXT,
    approved_user_id INTEGER REFERENCES users,
    refused_by INTEGER REFERENCES users,
    refused_at TEXT
  )`,

  // A signed-in player on the games origin: same accounts, separate sessions.
  // ⚠️ Never the `sessions` table — a games-origin token must not open the
  // studio, and in development the two listeners share a hostname, so the
  // separation has to live in the token itself (spec.md §7). These expire
  // (PLAYER_SESSION_DAYS in players.js) where studio sessions do not: the
  // public is not the account list.
  `CREATE TABLE IF NOT EXISTS player_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_player_sessions_user
     ON player_sessions (user_id)`,

  // One row per person per game: their best score ever, kept even after the
  // top-100 board has pruned the run that set it. Written beside `scores` on
  // every signed-in post; nothing displays it yet (TODO.md).
  `CREATE TABLE IF NOT EXISTS personal_bests (
    project_id INTEGER NOT NULL REFERENCES projects,
    user_id INTEGER NOT NULL REFERENCES users,
    score INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id)
  )`,

  // What a player earned in a game, keyed by the id the game's own
  // config/achievements.js gives it — the definitions live in that file, never
  // here. INSERT OR IGNORE, so earning one twice is a no-op. ⚠️ Permanent: no
  // route deletes a row, and a definition taken out of the file only hides its
  // rows until the id comes back (spec.md §3).
  `CREATE TABLE IF NOT EXISTS achievements (
    project_id INTEGER NOT NULL REFERENCES projects,
    user_id INTEGER NOT NULL REFERENCES users,
    achievement TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id, achievement)
  )`,

  // Art people here have added to the studio's collection, offered on the
  // same shelf as the shipped standard set (spec.md §6).
  //
  // ⚠️ The bytes are in the row rather than in a directory, and that is the
  // whole point: a game's tree recovers itself from git and the shipped set
  // is in this repo, but a picture somebody drew here exists nowhere else.
  // `npm run backup` is a VACUUM INTO of this database and nothing else, so
  // in a row it is already protected and on disk it would not be.
  //
  // ⚠️ No licence column, on purpose (ideas/studio-collection.md): whoever
  // drew it keeps their copyright, and the studio neither asks for nor
  // records a grant. `by_name` is copied rather than resolved through
  // users — unlike a message's author, a credit on a picture is a statement
  // about who drew it, not about what that person is called today.
  `CREATE TABLE IF NOT EXISTS collection_art (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    who TEXT NOT NULL DEFAULT '',
    mood TEXT NOT NULL DEFAULT '',
    bytes BLOB NOT NULL,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    added_by INTEGER NOT NULL REFERENCES users,
    by_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collection_kind ON collection_art (kind, id)`,

  // What the builder's sizing call split a big request into, and how far it
  // has got: one row per plan card, the `messages` row of kind 'plan' the chat
  // shows as a checklist (server/plans.js, spec.md §8). The pieces are JSON
  // because a piece is read and written whole and nothing queries inside one.
  `CREATE TABLE IF NOT EXISTS plans (
    message_id INTEGER PRIMARY KEY REFERENCES messages,
    project_id INTEGER NOT NULL REFERENCES projects,
    chat_id INTEGER NOT NULL REFERENCES chats,
    request TEXT NOT NULL,
    pieces TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plans_chat ON plans (chat_id, status)`,

  // One row per browser that has said yes to being told things while the
  // studio is closed (spec/ §6, server/push.js). `endpoint` is the address
  // the push service gave that browser; `p256dh` and `auth` are its own keys,
  // which is what makes a message unreadable to everything between here and
  // it.
  //
  // ⚠️ `endpoint` is UNIQUE and not `(user_id, endpoint)`: a browser has one
  // subscription, so a second person signing in on the same one takes the row
  // over. That is right — the first can no longer be reached there, and two
  // rows would send them somebody else's messages.
  //
  // ⚠️ Deliberately not ON DELETE CASCADE-shaped, because nothing here ever
  // deletes a user (`users.deleted` is the door): a removed account's rows go
  // when `bin/deluser.js` takes their sessions.
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id)`,
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
  // What a helper said on the way to its reply — every turn's words but the
  // last — kept beside the body and never in it, so the thread shows the
  // reply and a later fire replays only that (spec.md §3, §8). Added with the
  // walls already in the database split the same way, once (splitLongReplies).
  addColumnIfMissing(db, 'messages', 'working', 'TEXT', splitLongReplies);
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
  // How hard a helper thinks: 'full', 'low' or 'none', where the old boolean
  // had only the two ends. A helper that already exists keeps what it had —
  // on became 'full', off became 'none' — because that is the behaviour
  // somebody chose. New ones start on 'low', which is the column default and
  // the measurement's answer (spec.md §14).
  //
  addColumnIfMissing(db, 'agents', 'thinking', "TEXT NOT NULL DEFAULT 'low'", (d) => {
    d.prepare("UPDATE agents SET thinking = CASE reasoning WHEN 1 THEN 'full' ELSE 'none' END")
      .run();
  });
  // The boolean `thinking` replaced, gone now that three levels have stuck.
  // It was kept written-but-never-read so a rollback would find something
  // true in it, and that never quite worked: one bit cannot hold three
  // states, so 'low' — the default every new helper gets, and the level that
  // writes files where full effort writes nothing (spec.md §14) — came back
  // as 'full'. The net caught 'none' and inverted the case worth catching.
  //
  // ⚠️ After the backfill above, never before it: an old database is still
  // reading this column to learn what its helpers were set to.
  dropColumnIfPresent(db, 'agents', 'reasoning');
  // There is one model now (llm/deepseek.js) and nothing reads this column any
  // more. Still written, and brought forward here, for the same reason the
  // boolean above was kept for a while: a rollback finds something true in it.
  // Idempotent, so it costs one statement a start and nothing else. ⚠️ SQLite
  // will not change a column default afterwards, which is why the writers pass
  // the value rather than leaning on the CREATE TABLE above.
  db.prepare("UPDATE agents SET model = 'deepseek-flash' WHERE model != 'deepseek-flash'").run();
  // What one person's helpers may spend in a day. Null is no allowance of
  // their own — only the studio-wide budget, which is the outer wall either
  // way.
  addColumnIfMissing(db, 'users', 'daily_tokens', 'INTEGER');
  // ⚠️ Taking somebody out of the studio is this bit, never a DELETE. Their
  // messages, their games, their editor rows and their spending are all live
  // foreign keys, and a studio that loses a person should not lose the record
  // of what they made. Set, it closes every door — login, the crew list,
  // mentions, being added to a game — and nothing else moves, which is what
  // makes `npm run restoreuser` a one-word undo. `email` stays UNIQUE across
  // removed rows too (SQLite cannot narrow a table constraint to a partial
  // index afterwards), so the address stays theirs and adding it again is
  // refused with a pointer at the restore.
  addColumnIfMissing(db, 'users', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
  // Off, an account is a player only: the games origin signs them in and the
  // scoreboard knows their name, and every studio door — login, the crew
  // list, mentions, authorship — is shut. The default is 1 because every
  // account that existed before the bit was a studio account; what the
  // waiting list approves states 0 at the INSERT (players.js), the same
  // pattern as projects.open_edit.
  addColumnIfMissing(db, 'users', 'studio_access', 'INTEGER NOT NULL DEFAULT 1');
  // Who posted a score, now that posting takes being signed in. Null on every
  // row from before — those names were typed and are kept as typed.
  addColumnIfMissing(db, 'scores', 'user_id', 'INTEGER REFERENCES users');
  // On, any account in the studio may change this project; off, only its
  // authors. The column's default is the safe one, and every game a person
  // makes overrides it to open at the INSERT — a database written before this
  // already has the column, and SQLite cannot change a default afterwards, so
  // the value has to be stated where the row is made (see projects.js).
  addColumnIfMissing(db, 'projects', 'open_edit', 'INTEGER NOT NULL DEFAULT 0');
  // What kind of game this is — a template's key, 'visual-novel' or 'quiz' —
  // which decides the editors the centre pane offers and how helpers are
  // briefed (spec.md §3). Null is a free-form game, and stays the default.
  // Set at creation from the template and copied by a fork; a column rather
  // than a file in the tree, so no write_file can change which editors
  // somebody sees. ⚠️ Every game from before the column is marked '' — not yet
  // looked at — and projectPublic answers that once from the game's own tree
  // and writes the answer back, null included.
  addColumnIfMissing(db, 'projects', 'type', 'TEXT', (d) => {
    d.prepare("UPDATE projects SET type = '' WHERE kind = 'game'").run();
  });
  // The studio-wide budget, editable in the admin panel rather than a
  // constant in the source. Null means the built-in default still applies.
  addColumnIfMissing(db, 'studio_state', 'daily_token_budget', 'INTEGER');
  // The starter helper that used to join every new game's Building chat.
  // Written and read by nothing since the builder took that room; kept so a
  // rollback lands on its feet, like agents.reasoning was.
  addColumnIfMissing(db, 'studio_state', 'default_agent_id', 'INTEGER REFERENCES agents');
  // The builder (server/builder.js): the one `agents` row the studio owns —
  // never listed for editing, deleting or putting in a chat.
  addColumnIfMissing(db, 'agents', 'builtin', 'INTEGER NOT NULL DEFAULT 0');
  // The builder's room, one per game: `bots = 1` and this, and the door
  // refuses every other helper (chats.js, assertBotsAllowed).
  addColumnIfMissing(db, 'chats', 'builder', 'INTEGER NOT NULL DEFAULT 0');
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
  // After intoChats, never before: that one hands every project both chats,
  // and this takes the second one back off the projects that are only a room.
  intoOneRoom(db);
  // And after both: every game's Building becomes the builder's, or gets a
  // fresh one beside it when people's helpers were already in it.
  intoBuilderRooms(db);
  // A plan the last process was mid-way through is nobody's now; the next
  // message in its chat picks up the rest.
  pauseRunningPlans(db);
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
  // How many times a game's entry file has been served on the games origin —
  // a running counter, not a log, so it stays bounded without pruning. Used
  // only to order the catalog; never shown as a number (server/catalog.js).
  addColumnIfMissing(db, 'projects', 'play_count', 'INTEGER NOT NULL DEFAULT 0');
  // When the game last changed — a write to its tree or to its row, never a
  // message (spec/ §3): what the sidebar sorts on. Stamped from a hook on the
  // broker (app.js), so every route that tells the tabs a game changed counts
  // it. A game from before the column is dated from its newest message, else
  // its making: a migration cannot ask git, and the next change corrects it.
  // How many stamps the game holds on its arc (spec/ §6, public/arc.js): a
  // person's judgement, moved one at a time from the card at the top of
  // Building. A column and never a file, so no write_file can move it. Every
  // game starts at the first stamp — an old game with everything in it
  // collects them in a minute, which is its own small pleasure.
  addColumnIfMissing(db, 'projects', 'stage', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'projects', 'updated_at', 'TEXT', (d) => {
    d.prepare(
      `UPDATE projects SET updated_at = COALESCE(
         (SELECT MAX(m.created_at) FROM messages m WHERE m.project_id = projects.id),
         created_at)`,
    ).run();
  });
  // A piece's row lives behind its plan card rather than in the thread (spec/
  // §3, §8): the column names the card. Rows from before it are filed under
  // theirs from the plan, which already knew them.
  addColumnIfMissing(db, 'messages', 'plan_message_id', 'INTEGER', filePieceRows);
  // The plan's words beyond its pieces (spec/ §3, §8): the summary and the
  // assumptions a person reads and changes on a draft; `begun` for the head
  // of a plan for the rest of something; `edited` so Build knows to size the
  // person's words again; `built_by`, whose day the build is charged to.
  addColumnIfMissing(db, 'plans', 'summary', 'TEXT');
  addColumnIfMissing(db, 'plans', 'assumptions', 'TEXT');
  addColumnIfMissing(db, 'plans', 'begun', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'plans', 'edited', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'plans', 'built_by', 'INTEGER');
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

// A reply from before `working` existed is every turn's words joined into one
// body — up to 160 KB of it, replayed into every later fire in that chat. The
// loop splits at the last turn; here there is no turn boundary left, so a long
// reply keeps its last paragraph and moves the rest into `working`. A turn's
// closing note is a paragraph, so that is the nearest cut to the loop's own,
// and nothing is lost: the words move, they do not go. Short replies are left
// whole — a two-paragraph answer said in one breath is not a wall — and a long
// one with no paragraph break has nowhere to cut and stays as it is.
const LONG_REPLY_CHARS = 4096;
function splitLongReplies(db) {
  const rows = db.prepare(
    `SELECT id, body FROM messages
      WHERE agent_id IS NOT NULL AND kind IS NULL AND length(body) > ?`,
  ).all(LONG_REPLY_CHARS);
  const update = db.prepare('UPDATE messages SET body = ?, working = ? WHERE id = ?');
  for (const row of rows) {
    const text = row.body.trim();
    const cut = text.lastIndexOf('\n\n');
    if (cut <= 0) continue;
    update.run(text.slice(cut + 2).trim(), text.slice(0, cut).trim(), row.id);
  }
}

// Every piece row a plan already names is filed under that plan's card.
function filePieceRows(db) {
  const file = db.prepare('UPDATE messages SET plan_message_id = ? WHERE id = ?');
  for (const plan of db.prepare('SELECT message_id, pieces FROM plans').all()) {
    for (const piece of JSON.parse(plan.pieces)) {
      if (piece.message_id) file.run(plan.message_id, piece.message_id);
    }
  }
}

// A chat project is one room. It used to be born with two — the human-only
// front door every project got, and `Building` behind it — which was a game's
// shape put on a thing that is only a conversation: the studio opened it on an
// empty room and everything anybody had said was one click further in.
//
// The oldest chat is the survivor, because it is the one every remembered
// `?chat=` and every prefs entry already points at. Everything said in the
// others moves into it, in the order it was said — message ids are global and
// climb with time, so one chat's worth of rows reads back chronologically
// whatever chat it came from. ⚠️ Nothing is deleted but empty rooms: the
// messages, the marks and the helpers all move first.
function intoOneRoom(db) {
  const projects = db.prepare(
    `SELECT p.id, p.name FROM projects p
      WHERE p.kind = 'chat'
        AND (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) > 1`,
  ).all();

  for (const project of projects) {
    const [keep, ...rest] = db
      .prepare('SELECT id FROM chats WHERE project_id = ? ORDER BY id')
      .all(project.id);
    // The front door never allowed helpers, and the room that is the whole
    // project has to.
    db.prepare('UPDATE chats SET bots = 1, name = ? WHERE id = ?').run(project.name, keep.id);
    for (const chat of rest) {
      db.prepare('UPDATE messages SET chat_id = ? WHERE chat_id = ?').run(keep.id, chat.id);
      db.prepare('UPDATE mentions SET chat_id = ? WHERE chat_id = ?').run(keep.id, chat.id);
      // OR IGNORE for the one collision there is: a helper in both rooms.
      // The surviving row is the one already in the room being kept, which is
      // the honest answer — it is where they were listening.
      db.prepare('UPDATE OR IGNORE chat_agents SET chat_id = ? WHERE chat_id = ?')
        .run(keep.id, chat.id);
      db.prepare('DELETE FROM chat_agents WHERE chat_id = ?').run(chat.id);
      db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
    }
  }
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

// The other direction, for a column whose replacement has settled. Only safe
// for one nothing reads: SQLite rewrites the table, so an index or a
// constraint naming the column would go with it.
export function dropColumnIfPresent(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}
