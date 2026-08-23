// One consistent copy of the database, made while the studio runs. The game
// trees are git repositories and recover themselves; the chats, accounts and
// token counts live only in this file, so this is the one backup that matters.
//
// `VACUUM INTO` reads a stable snapshot even mid-write (it is safe against a
// live WAL), and the connection is read-only so a backup can never touch the
// source — not even to run a migration.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.DB_PATH ?? 'gamestudio.db';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dest = process.argv[2] ?? `${dbPath}.backup-${stamp}`;

if (!fs.existsSync(dbPath)) {
  console.error(`no database at ${dbPath} (set DB_PATH, or run from the studio's directory)`);
  process.exit(1);
}
// VACUUM INTO refuses an existing file too; checking first gives the reason
// in words rather than as an SQLite error code.
if (fs.existsSync(dest)) {
  console.error(`${dest} already exists — a backup never overwrites`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  db.prepare('VACUUM INTO ?').run(dest);
  const { size } = fs.statSync(dest);
  console.log(`backed up ${dbPath} to ${dest} (${size} bytes)`);
} finally {
  db.close();
}
