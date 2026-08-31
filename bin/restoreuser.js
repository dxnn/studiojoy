// The undo for `npm run deluser`. Removal is one bit (`users.deleted`), so
// putting somebody back is clearing it: their password, their allowance, their
// admin bit, the games they author and everything they ever said are all still
// on the row and come back with them. Their sessions do not — they were
// deleted on the way out, so they sign in again.
//
// With no email, it lists who is currently removed.
import { openDb } from '../server/db.js';
import { normalizeEmail, restoreAccount } from '../server/auth.js';

const [email] = process.argv.slice(2);
const dbPath = process.env.DB_PATH ?? 'gamestudio.db';
const db = openDb(dbPath);

if (!email) {
  const removed = db
    .prepare(
      `SELECT email, display_name FROM users
        WHERE deleted = 1 ORDER BY display_name COLLATE NOCASE`,
    )
    .all();
  if (removed.length === 0) {
    console.log('nobody is removed');
  } else {
    console.log('removed accounts:');
    for (const r of removed) console.log(`  ${r.display_name} <${r.email}>`);
    console.log('\nbring one back with:');
    console.log(`  npm run restoreuser -- ${removed[0].email}`);
  }
  db.close();
  process.exit(0);
}

const normalized = normalizeEmail(email);
const user = db
  .prepare('SELECT id, display_name, deleted FROM users WHERE email = ?')
  .get(normalized);

if (!user) {
  console.error(`no account for ${normalized}`);
  process.exit(1);
}
if (user.deleted === 0) {
  console.error(`${normalized} is already in the studio`);
  process.exit(1);
}

try {
  restoreAccount(db, user.id);
  console.log(`restored ${user.display_name} <${normalized}> — they can sign in again`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  db.close();
}
