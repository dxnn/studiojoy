// ⚠️ Taking somebody out of the studio is a soft delete: `users.deleted = 1`
// and their sessions dropped (spec.md §3). Nothing else moves — their
// messages, the games they authored, their editor rows and what they spent
// are all still there, and `npm run restoreuser -- <email>` puts the person
// back exactly as they were. Their address stays theirs, so `adduser` will
// refuse it rather than quietly starting a second account for the same person.
import { openDb, tx } from '../server/db.js';
import { normalizeEmail } from '../server/auth.js';

const [email] = process.argv.slice(2);

if (!email) {
  console.error('usage: npm run deluser -- <email>');
  process.exit(2);
}

const dbPath = process.env.DB_PATH ?? 'gamestudio.db';
const db = openDb(dbPath);
const normalized = normalizeEmail(email);

const user = db
  .prepare('SELECT id, display_name, admin, deleted FROM users WHERE email = ?')
  .get(normalized);
if (!user) {
  console.error(`no account for ${normalized}`);
  process.exit(1);
}
if (user.deleted === 1) {
  console.error(`${normalized} is already removed — bring them back with:`);
  console.error(`  npm run restoreuser -- ${normalized}`);
  process.exit(1);
}

// The same wall the admin panel keeps: a studio nobody can run is one nobody
// can add an account to either, and there is no way back in.
if (user.admin === 1) {
  const admins = db
    .prepare('SELECT COUNT(*) AS c FROM users WHERE admin = 1 AND deleted = 0')
    .get().c;
  if (admins <= 1) {
    console.error(
      `${normalized} is the studio's last admin — make somebody else one first.`,
    );
    process.exit(1);
  }
}

try {
  const sessions = tx(db, () => {
    const dropped = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
    db.prepare('UPDATE users SET deleted = 1 WHERE id = ?').run(user.id);
    return dropped;
  });
  console.log(`removed ${user.display_name} <${normalized}> and ${sessions} session(s)`);
  console.log(`  undo: npm run restoreuser -- ${normalized}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  db.close();
}
