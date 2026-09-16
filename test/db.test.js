import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  openDb, tx, addColumnIfMissing, dropColumnIfPresent,
} from '../server/db.js';
import { nextUtcMidnight } from '../server/util/time.js';
import { scratchDir } from './helpers.js';

function seeded() {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, created_at)
     VALUES (?, 'x', 'Dann', ?)`,
  ).run('dann@example.com', new Date().toISOString());
  db.prepare(
    `INSERT INTO projects (slug, name, created_by, created_at)
     VALUES ('tank', 'Tank Game', 1, ?)`,
  ).run(new Date().toISOString());
  return db;
}

test('migrations create every table the spec names', () => {
  const db = openDb(':memory:');
  const names = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);
  for (const table of [
    'users', 'sessions', 'agents', 'projects', 'chats', 'chat_agents',
    'messages', 'message_context', 'message_writes', 'studio_state',
  ]) {
    assert.ok(names.includes(table), `missing table ${table}`);
  }
  db.close();
});

test('openDb is idempotent', () => {
  const db = openDb(':memory:');
  // Re-running the migrations must not throw or duplicate the seed row.
  const again = openDb(':memory:');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM studio_state').get().c, 1);
  assert.equal(again.prepare('SELECT COUNT(*) c FROM studio_state').get().c, 1);
  db.close();
  again.close();
});

test('studio_state is seeded with a reset time in the future', () => {
  const db = openDb(':memory:');
  const row = db.prepare('SELECT * FROM studio_state WHERE id = 1').get();
  assert.equal(row.tokens_used_today, 0);
  assert.ok(new Date(row.budget_reset_at) > new Date(), 'reset must be in the future');
  assert.equal(row.budget_reset_at, nextUtcMidnight());
  // The CHECK pins it to a single row.
  assert.throws(() =>
    db.prepare('INSERT INTO studio_state (id, budget_reset_at) VALUES (2, ?)')
      .run(nextUtcMidnight()));
  db.close();
});

test('foreign keys are enforced', () => {
  const db = openDb(':memory:');
  assert.throws(
    () => db.prepare(
      `INSERT INTO messages (project_id, user_id, body, created_at)
       VALUES (999, NULL, 'orphan', ?)`,
    ).run(new Date().toISOString()),
    /FOREIGN KEY/,
  );
  db.close();
});

test('a message cannot be from both a user and an agent', () => {
  const db = seeded();
  db.prepare(
    `INSERT INTO agents (name, description, created_by, created_at)
     VALUES ('Critic', 'you critique', 1, ?)`,
  ).run(new Date().toISOString());
  const now = new Date().toISOString();
  // Either alone is fine.
  db.prepare(
    `INSERT INTO messages (project_id, user_id, body, created_at) VALUES (1, 1, 'hi', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO messages (project_id, agent_id, body, created_at) VALUES (1, 1, 'hello', ?)`,
  ).run(now);
  // A system banner with neither is fine.
  db.prepare(
    `INSERT INTO messages (project_id, kind, body, created_at)
     VALUES (1, 'system', 'over budget', ?)`,
  ).run(now);
  // Both at once is not.
  assert.throws(
    () => db.prepare(
      `INSERT INTO messages (project_id, user_id, agent_id, body, created_at)
       VALUES (1, 1, 1, 'both', ?)`,
    ).run(now),
    /CHECK/,
  );
  db.close();
});

test('agent names are unique among the living only', () => {
  const db = seeded();
  const now = new Date().toISOString();
  const insert = (name) => db.prepare(
    `INSERT INTO agents (name, description, created_by, created_at) VALUES (?, 'd', 1, ?)`,
  ).run(name, now);

  insert('Level Designer');
  assert.throws(() => insert('Level Designer'), /UNIQUE/);
  // Soft-deleting frees the name.
  db.prepare(`UPDATE agents SET deleted = 1 WHERE name = 'Level Designer'`).run();
  insert('Level Designer');
  assert.equal(
    db.prepare(`SELECT COUNT(*) c FROM agents WHERE name = 'Level Designer'`).get().c,
    2,
  );
  db.close();
});

test('a helper joins one chat at most once', () => {
  const db = seeded();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (name, description, created_by, created_at) VALUES ('A', 'd', 1, ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO chats (id, project_id, name, bots, created_at) VALUES (1, 1, 'Building', 1, ?)`,
  ).run(now);
  const join = () => db.prepare(
    `INSERT INTO chat_agents (chat_id, agent_id, attached_by, attached_at)
     VALUES (1, 1, 1, ?)`,
  ).run(now);
  join();
  assert.throws(join, /UNIQUE/);
  db.close();
});

test('agent defaults match the verified DeepSeek settings', () => {
  const db = seeded();
  db.prepare(
    `INSERT INTO agents (name, description, created_by, created_at) VALUES ('A', 'd', 1, ?)`,
  ).run(new Date().toISOString());
  const row = db.prepare('SELECT * FROM agents WHERE id = 1').get();
  // There is one model and no column for it (spec.md §3, §14).
  assert.equal(row.model, undefined);
  // 'low' rather than the old boolean's "on": at full effort an ambitious
  // request writes nothing at all (spec.md §14).
  assert.equal(row.thinking, 'low');
  // No file-tools bit either: the tools are the builder's by construction.
  assert.equal(row.file_tools, undefined);
  assert.equal(row.deleted, 0);
  db.close();
});

// A helper somebody already made keeps the behaviour they chose, rather than
// being quietly moved onto the new default.
test('an agent from before three thinking levels keeps what it had', () => {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, created_at)
     VALUES ('a@b.c', 'x', 'Dann', ?)`,
  ).run(new Date().toISOString());
  const now = new Date().toISOString();
  // Put the table back the way a database from before this looked — the old
  // boolean present, the three levels not — then let the migration run again.
  db.exec('ALTER TABLE agents DROP COLUMN thinking');
  db.exec('ALTER TABLE agents ADD COLUMN reasoning INTEGER NOT NULL DEFAULT 1');
  const add = (name, reasoning) => db
    .prepare(
      `INSERT INTO agents (name, description, reasoning, created_by, created_at)
       VALUES (?, 'd', ?, 1, ?)`,
    )
    .run(name, reasoning, now);
  add('Thinker', 1);
  add('Quiet', 0);
  addColumnIfMissing(db, 'agents', 'thinking', "TEXT NOT NULL DEFAULT 'low'", (d) => {
    d.prepare("UPDATE agents SET thinking = CASE reasoning WHEN 1 THEN 'full' ELSE 'none' END")
      .run();
  });
  const thinking = (name) => db
    .prepare('SELECT thinking FROM agents WHERE name = ?').get(name).thinking;
  assert.equal(thinking('Thinker'), 'full');
  assert.equal(thinking('Quiet'), 'none');
  db.close();
});

// The backfill above is the only reader the old column ever had, so the
// migration drops it afterwards. A fresh database never has it at all.
test('the old reasoning column is gone once the migration has run', () => {
  const db = openDb(':memory:');
  const cols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
  assert.ok(!cols.includes('reasoning'));
  assert.ok(cols.includes('thinking'));
  db.close();
});

// A game from before projects.type is marked '' — not yet looked at — so the
// routes can answer its type from its tree once and write it back. A chat is
// left null: it has no tree to ask. Against a file, because the mark is made
// by reopening a database that already has games in it.
test('games from before the type column are marked to be looked at', () => {
  const file = path.join(scratchDir('db'), 'studio.db');
  let db = openDb(file);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, created_at)
     VALUES ('a@b.c', 'x', 'Dann', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO projects (slug, name, kind, created_by, created_at)
     VALUES ('old', 'Old', 'game', 1, ?), ('room', 'Room', 'chat', 1, ?)`,
  ).run(now, now);
  // Put the table back the way a database from before this looked.
  db.exec('ALTER TABLE projects DROP COLUMN type');
  db.close();

  db = openDb(file);
  const typeOf = (slug) => db.prepare('SELECT type FROM projects WHERE slug = ?').get(slug).type;
  assert.equal(typeOf('old'), '');
  assert.equal(typeOf('room'), null);
  db.close();
});

// A reply from before `working` existed is every turn's words in one body —
// the wall. Reopening splits the long ones at their last paragraph, the words
// moving rather than going, and leaves alone what is not a wall: a short
// reply, a person's message however long, and a long reply with no paragraph
// to cut at.
test('long replies from before working existed are split at their last paragraph', () => {
  const file = path.join(scratchDir('db'), 'studio.db');
  let db = openDb(file);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, created_at)
     VALUES ('a@b.c', 'x', 'Dann', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO projects (slug, name, kind, created_by, created_at)
     VALUES ('tank', 'Tank', 'game', 1, ?)`,
  ).run(now);
  db.prepare("INSERT INTO chats (project_id, name, bots, created_at) VALUES (1, 'Building', 1, ?)").run(now);
  db.prepare("INSERT INTO agents (name, description, created_by, created_at) VALUES ('Designer', 'd', 1, ?)").run(now);
  const say = (who, body) => db
    .prepare(`INSERT INTO messages (project_id, chat_id, ${who}, body, created_at) VALUES (1, 1, 1, ?, ?)`)
    .run(body, now);
  const para = (line) => Array(200).fill(line).join(' ');
  const wall = `${para('Now I will write the tanks.')}\n\n${para('Then the walls.')}\n\nDone — press play.`;
  say('agent_id', wall);
  say('agent_id', 'Short.\n\nTwo paragraphs, one breath.');
  say('user_id', `${para('A person can go on.')}\n\nTheir words are theirs.`);
  say('agent_id', para('No paragraph anywhere in this one.'));
  // Put the table back the way a database from before this looked.
  db.exec('ALTER TABLE messages DROP COLUMN working');
  db.close();

  db = openDb(file);
  // Spread: node:sqlite hands back null-prototype rows, which strict deepEqual
  // will not match against a literal.
  const row = (id) => ({ ...db.prepare('SELECT body, working FROM messages WHERE id = ?').get(id) });
  assert.deepEqual(row(1), {
    body: 'Done — press play.',
    working: wall.slice(0, wall.lastIndexOf('\n\n')),
  });
  assert.deepEqual(row(2), { body: 'Short.\n\nTwo paragraphs, one breath.', working: null });
  assert.equal(row(3).working, null);
  assert.equal(row(4).working, null);
  assert.equal(row(4).body.length, para('No paragraph anywhere in this one.').length);
  db.close();
});

test('tx commits on success and rolls back on throw', () => {
  const db = seeded();
  const count = () => db.prepare('SELECT COUNT(*) c FROM messages').get().c;
  const now = new Date().toISOString();

  tx(db, () => {
    db.prepare(
      `INSERT INTO messages (project_id, user_id, body, created_at) VALUES (1, 1, 'kept', ?)`,
    ).run(now);
  });
  assert.equal(count(), 1);

  assert.throws(() => tx(db, () => {
    db.prepare(
      `INSERT INTO messages (project_id, user_id, body, created_at) VALUES (1, 1, 'dropped', ?)`,
    ).run(now);
    throw new Error('abort');
  }), /abort/);
  assert.equal(count(), 1, 'the failed transaction must leave nothing behind');
  db.close();
});

test('tx refuses to nest with a clear message', () => {
  const db = seeded();
  assert.throws(
    () => tx(db, () => tx(db, () => {})),
    /cannot be nested/,
  );
  // The guard must release even after the failure, or every later tx breaks.
  tx(db, () => {});
  db.close();
});

test('tx releases its guard when the body throws', () => {
  const db = seeded();
  assert.throws(() => tx(db, () => { throw new Error('x'); }), /x/);
  tx(db, () => {});
  db.close();
});

test('addColumnIfMissing adds once and runs its callback once', () => {
  const db = openDb(':memory:');
  let calls = 0;
  addColumnIfMissing(db, 'projects', 'tagline', 'TEXT', () => { calls += 1; });
  addColumnIfMissing(db, 'projects', 'tagline', 'TEXT', () => { calls += 1; });
  assert.equal(calls, 1);
  const cols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  assert.ok(cols.includes('tagline'));
  db.close();
});

// A game from before `updated_at` is dated from its newest message, else its
// making (spec/ §3): the migration cannot ask git, and the next change
// corrects it.
test('updated_at is backfilled from the newest message, else the making', () => {
  const dir = scratchDir('updated-at-db');
  let db = openDb(path.join(dir, 'db'));
  db.exec(`
    INSERT INTO users (id, email, password_hash, display_name, created_at)
      VALUES (1, 'a@b.c', 'x', 'Dann', '2026-01-01T00:00:00.000Z');
    INSERT INTO projects (id, slug, name, created_by, created_at) VALUES
      (1, 'tank', 'Tank', 1, '2026-01-01T00:00:00.000Z'),
      (2, 'maze', 'Maze', 1, '2026-01-02T00:00:00.000Z');
    INSERT INTO messages (project_id, user_id, body, created_at) VALUES
      (1, 1, 'first', '2026-01-03T00:00:00.000Z'),
      (1, 1, 'second', '2026-01-04T00:00:00.000Z');
  `);
  dropColumnIfPresent(db, 'projects', 'updated_at');
  db.close();

  db = openDb(path.join(dir, 'db'));
  assert.deepEqual(
    db.prepare('SELECT slug, updated_at FROM projects ORDER BY id').all()
      .map((r) => [r.slug, r.updated_at]),
    [['tank', '2026-01-04T00:00:00.000Z'], ['maze', '2026-01-02T00:00:00.000Z']],
  );
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('run() reports plain numbers, not BigInt', () => {
  const db = seeded();
  const info = db.prepare(
    `INSERT INTO messages (project_id, user_id, body, created_at) VALUES (1, 1, 'x', ?)`,
  ).run(new Date().toISOString());
  assert.equal(typeof info.lastInsertRowid, 'number');
  assert.equal(typeof info.changes, 'number');
  db.close();
});
