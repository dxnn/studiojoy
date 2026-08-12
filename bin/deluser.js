// Revoking studio access is deleting the row and its sessions — there is no
// disabled flag to set (spec.md §3). Projects, messages, and agents the user
// touched are left alone: history keeps rendering, since messages reference
// users by id and the UI falls back to a placeholder name.
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

const user = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(normalized);
if (!user) {
  console.error(`no account for ${normalized}`);
  process.exit(1);
}

const authored = db
  .prepare('SELECT COUNT(*) AS c FROM messages WHERE user_id = ?')
  .get(user.id).c;

if (authored > 0) {
  // A user_id on messages, projects, and agents is a live foreign key, so a
  // hard delete would fail anyway. Say so plainly rather than leaving the
  // operator to read a constraint error.
  console.error(
    `${normalized} has authored ${authored} message(s); deleting the row would ` +
    'break those references. Delete their sessions instead to revoke access:\n' +
    `  DELETE FROM sessions WHERE user_id = ${user.id};`,
  );
  process.exit(1);
}

try {
  const removed = tx(db, () => {
    const sessions = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    return sessions;
  });
  console.log(`deleted ${user.display_name} <${normalized}> and ${removed} session(s)`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  db.close();
}
