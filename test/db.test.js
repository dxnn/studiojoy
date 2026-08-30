import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, tx, addColumnIfMissing } from '../server/db.js';
import { nextUtcMidnight } from '../server/util/time.js';

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

test('agent defaults match the verified DeepSeek model set', () => {
  const db = seeded();
  db.prepare(
    `INSERT INTO agents (name, description, created_by, created_at) VALUES ('A', 'd', 1, ?)`,
  ).run(new Date().toISOString());
  const row = db.prepare('SELECT * FROM agents WHERE id = 1').get();
  assert.equal(row.model, 'deepseek-v4-flash');
  assert.equal(row.reasoning, 1);
  assert.equal(row.file_tools, 1);
  assert.equal(row.deleted, 0);
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

test('run() reports plain numbers, not BigInt', () => {
  const db = seeded();
  const info = db.prepare(
    `INSERT INTO messages (project_id, user_id, body, created_at) VALUES (1, 1, 'x', ?)`,
  ).run(new Date().toISOString());
  assert.equal(typeof info.lastInsertRowid, 'number');
  assert.equal(typeof info.changes, 'number');
  db.close();
});
