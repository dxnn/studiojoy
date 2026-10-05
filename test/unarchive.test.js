// `npm run unarchive`: the terminal's half of archiving (spec/ §11). The
// studio unarchives too, but only for the originator — this is the hand that
// is left when that account has been removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { createUser } from '../server/auth.js';
import { scratchDir } from './helpers.js';

const run = promisify(execFile);
const script = path.join(import.meta.dirname, '../bin/unarchive.js');

// A real database on disk, since the script opens it by path: one account and
// one game of theirs that has been put away.
function seededDb(dir) {
  const dbPath = path.join(dir, 'studio.db');
  const db = openDb(dbPath);
  const user = createUser(db, { email: 'kid@example.com', password: 'hunter2', displayName: 'Kid' });
  db.prepare(
    `INSERT INTO projects (slug, name, kind, archived, created_by, created_at)
     VALUES ('tank', 'Tank', 'game', 1, ?, ?)`,
  ).run(user.id, new Date().toISOString());
  db.close();
  return dbPath;
}

const archivedBit = (dbPath) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare("SELECT archived FROM projects WHERE slug = 'tank'").get();
  db.close();
  return row.archived;
};

test('with no slug it lists what is archived', async () => {
  const dbPath = seededDb(scratchDir('unarchive'));
  const { stdout } = await run('node', [script], { env: { ...process.env, DB_PATH: dbPath } });
  assert.match(stdout, /Tank\s+\(tank\)/);
  assert.match(stdout, /npm run unarchive -- tank/);
  assert.equal(archivedBit(dbPath), 1, 'listing changes nothing');
});

test('a slug brings the game back, once', async () => {
  const dbPath = seededDb(scratchDir('unarchive'));
  const env = { ...process.env, DB_PATH: dbPath };
  const { stdout } = await run('node', [script, 'tank'], { env });
  assert.match(stdout, /Tank \(tank\) is back/);
  assert.equal(archivedBit(dbPath), 0);

  // Not archived any more, so there is nothing to do — said, not swallowed.
  await assert.rejects(run('node', [script, 'tank'], { env }), /is not archived/);
  await assert.rejects(run('node', [script, 'nope'], { env }), /no game or chat called nope/);
});

// A chat is never archived (decided 2026-10-05), whatever bit its row kept.
test('a chat with the bit from before is not archived, and is left alone', async () => {
  const dbPath = seededDb(scratchDir('unarchive'));
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE projects SET kind = 'chat' WHERE slug = 'tank'").run();
  db.close();
  await assert.rejects(run('node', [script, 'tank'], { env: { ...process.env, DB_PATH: dbPath } }), /is not archived/);
  assert.equal(archivedBit(dbPath), 1, 'the row keeps its bit; nothing migrates');
});
