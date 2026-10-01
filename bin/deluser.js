// ⚠️ The only way somebody leaves the studio. There is no route and no
// button: adding an account is an everyday thing and lives in the panel,
// while taking one out is rare enough to be worth walking to a terminal for
// (spec.md §11).
//
// It is a soft delete: `users.deleted = 1` and their sessions dropped
// (spec.md §3). Nothing else moves — their messages, the games they authored,
// their editor rows and what they spent are all still there, and
// `npm run restoreuser -- <email>` puts the person back exactly as they were.
// Their address stays theirs, so `adduser` will refuse it rather than quietly
// starting a second account for the same person.
import { openDb } from '../server/db.js';
import { normalizeEmail, isLastAdmin, removeAccount } from '../server/auth.js';
import { existingDb } from './env.js';

const [email] = process.argv.slice(2);

if (!email) {
  console.error('usage: npm run deluser -- <email>');
  process.exit(2);
}

const db = openDb(existingDb());
const normalized = normalizeEmail(email);

const user = db
  .prepare('SELECT id, display_name, deleted FROM users WHERE email = ?')
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
if (isLastAdmin(db, user.id)) {
  console.error(`${normalized} is the studio's last admin — make somebody else one first.`);
  process.exit(1);
}

try {
  const sessions = removeAccount(db, user.id);
  console.log(`removed ${user.display_name} <${normalized}> and ${sessions} session(s)`);
  console.log(`  undo: npm run restoreuser -- ${normalized}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  db.close();
}
