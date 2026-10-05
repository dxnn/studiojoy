// The undo for Archive, at a terminal. The studio has its own — Unarchive in
// the game's ···, the originator's alone — so this is for the game that has
// nobody left to press it: an originator who was removed leaves a game the
// studio can neither archive nor bring back (spec/ §11).
// It is one bit (`projects.archived`), so putting a game back is clearing it:
// its files, its chats, its scores and its editors were never touched.
//
// With no slug, it lists what is archived.
import { openDb } from '../server/db.js';
import { existingDb } from './env.js';

const [slug] = process.argv.slice(2);
const db = openDb(existingDb());

if (!slug) {
  const rows = db
    // Games only: a chat is never archived, whatever its row says.
    .prepare("SELECT slug, name FROM projects WHERE archived = 1 AND kind != 'chat' ORDER BY name COLLATE NOCASE")
    .all();
  if (rows.length === 0) {
    console.log('nothing is archived');
  } else {
    console.log('archived:');
    for (const r of rows) console.log(`  ${r.name}  (${r.slug})`);
    console.log('\nbring one back with:');
    console.log(`  npm run unarchive -- ${rows[0].slug}`);
  }
  db.close();
  process.exit(0);
}

const row = db.prepare('SELECT id, slug, name, kind, archived FROM projects WHERE slug = ?').get(slug);
if (!row) {
  console.error(`no game or chat called ${slug}`);
  db.close();
  process.exit(1);
}
// A chat is never archived, whatever bit it carries from before (routes/helpers.js).
if (row.archived === 0 || row.kind === 'chat') {
  console.error(`${row.name} is not archived`);
  db.close();
  process.exit(1);
}

db.prepare('UPDATE projects SET archived = 0 WHERE id = ?').run(row.id);
db.close();
// The running studio reads the row per request, so the game takes changes
// again at once; a tab that already has it open shows the tag until it reloads.
console.log(`${row.name} (${row.slug}) is back — anyone with it open sees that when they reload`);
