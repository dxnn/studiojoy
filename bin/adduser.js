// Studio accounts are created by hand — there is no signup route
// (spec.md §2). Presence in `users` is the whole permission model.
import { openDb } from '../server/db.js';
import { createUser, normalizeEmail } from '../server/auth.js';
import { promptHidden } from './prompt.js';
import { paths } from './env.js';

const [email, displayName] = process.argv.slice(2);

if (!email || !displayName) {
  console.error('usage: npm run adduser -- <email> "<Display Name>"');
  process.exit(2);
}

// Allowed to make the database: on a laptop the first account comes before
// the first `npm start`.
const { dbPath } = paths();
const db = openDb(dbPath);

const normalized = normalizeEmail(email);
// An address stays with the account that had it even after a removal, so a
// second row for the same person is never what was wanted here.
const existing = db.prepare('SELECT id, deleted FROM users WHERE email = ?').get(normalized);
if (existing) {
  if (existing.deleted === 1) {
    console.error(`${normalized} was removed from the studio — bring them back with:`);
    console.error(`  npm run restoreuser -- ${normalized}`);
  } else {
    console.error(`${normalized} already has an account (id ${existing.id})`);
  }
  process.exit(1);
}

let password;
try {
  password = await promptHidden(`password for ${normalized}: `);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (!password) {
  console.error('password must not be empty');
  process.exit(1);
}

try {
  const user = createUser(db, { email: normalized, password, displayName });
  console.log(`created ${user.display_name} <${user.email}> (id ${user.id}) in ${dbPath}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  db.close();
}
