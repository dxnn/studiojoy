import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { createUser } from '../server/auth.js';
import { scratchDir } from './helpers.js';

const run = promisify(execFile);
const script = path.join(import.meta.dirname, '../bin/backup.js');

// A real database on disk, since the script under test opens it by path.
function seededDb(dir) {
  const dbPath = path.join(dir, 'studio.db');
  const db = openDb(dbPath);
  createUser(db, { email: 'kid@example.com', password: 'hunter2', displayName: 'Kid' });
  db.close();
  return dbPath;
}

test('backup writes a working copy of the database', async () => {
  const dir = scratchDir('backup');
  const dbPath = seededDb(dir);
  const dest = path.join(dir, 'copy.db');

  const { stdout } = await run('node', [script, dest], { env: { ...process.env, DB_PATH: dbPath } });
  assert.match(stdout, /backed up/);

  // The copy is a real database holding the same rows, not just a file.
  const copy = new DatabaseSync(dest, { readOnly: true });
  const row = copy.prepare('SELECT email FROM users').get();
  copy.close();
  assert.equal(row.email, 'kid@example.com');
});

test('backup refuses to overwrite and to invent a source', async () => {
  const dir = scratchDir('backup');
  const dbPath = seededDb(dir);
  const dest = path.join(dir, 'copy.db');
  fs.writeFileSync(dest, 'precious');

  await assert.rejects(
    run('node', [script, dest], { env: { ...process.env, DB_PATH: dbPath } }),
    /already exists/,
  );
  assert.equal(fs.readFileSync(dest, 'utf8'), 'precious');

  await assert.rejects(
    run('node', [script], { env: { ...process.env, DB_PATH: path.join(dir, 'nope.db') } }),
    /no database/,
  );
});
