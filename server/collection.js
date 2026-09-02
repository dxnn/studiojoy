// The **studio collection**: art people here have added, offered on the same
// shelf as the shipped *standard set* (spec.md §6). The set is files in this
// repo and never changes while the studio runs; this is the half that does.
//
// ⚠️ Nothing here records a licence. Whoever drew a picture keeps their
// copyright, and the studio neither asks for a grant nor implies one — the
// shelf says "Made here by Ada" and that is the whole claim
// (ideas/studio-collection.md). The shipped half still carries `by` and
// `licence`, because that half is other people's CC0 work.
//
// ⚠️ A picked picture is *copied* into a game, so a game that used something
// keeps its copy for good. Taking a row out of the collection stops it being
// offered; it never reaches back into a game.

import { HttpError } from './http/respond.js';

export const KINDS = ['portrait', 'background'];

export const NAME_CHARS = 60;
export const WHO_CHARS = 40;
// Generous for a 128² PNG and mean enough that nobody stores a photograph:
// the shelf shows these at 48 pixels tall and a game draws them small.
export const MAX_BYTES = 2 * 1024 * 1024;
// Per person, and overall. The shelf is one sideways row, so it runs out of
// room long before the database does.
export const PER_PERSON = 100;
export const TOTAL = 500;

// Only what the studio can measure and a game can draw. PNG alone for now:
// the pixel editor writes PNG, the shipped set is PNG, and measuring one is
// eight bytes of header rather than a decoder.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A PNG says its size in the IHDR chunk, which is always the first one.
// Answers null for anything that is not a PNG, which is the refusal.
export function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (buf[i] !== PNG_MAGIC[i]) return null;
  }
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

// ⚠️ The rule with teeth, and the same one test/story-art.test.js holds the
// shipped set to. A portrait is copied into assets/sprites/, where the
// sprites library reads a picture whose width is a whole multiple of its
// height as a *strip* of square frames — so a 2:1 face would animate instead
// of standing still, with nothing in the story saying why.
export const readsAsStrip = (width, height) => width > height && width % height === 0;

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// A key written bare into config/story.js, so it has to be an identifier —
// the same shape freshKey makes in the story editor.
const KEY = /^[a-z][a-z0-9_]*$/;

export function addArt(db, user, { kind, name, who, mood, bytes }) {
  if (!KINDS.includes(kind)) {
    throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
  }
  const label = clip(name, NAME_CHARS);
  if (!label) throw new HttpError(400, 'give it a name');
  if (!bytes?.length) throw new HttpError(400, 'there is nothing to add');
  if (bytes.length > MAX_BYTES) {
    throw new HttpError(413, `a picture can be up to ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
  }

  const size = pngSize(bytes);
  if (!size) throw new HttpError(400, 'the studio can only keep .png pictures here');

  if (kind === 'background' && size.width <= size.height) {
    throw new HttpError(400, 'a background is wider than it is tall');
  }
  if (kind === 'portrait' && readsAsStrip(size.width, size.height)) {
    throw new HttpError(
      400,
      `that picture is ${size.width} by ${size.height}, which games read as an animation `
      + 'rather than a face. Crop or pad it a little and try again',
    );
  }

  // A portrait suggests the file name it lands under when somebody picks it,
  // the way the shipped set's do. Absent, the shelf still offers it.
  const key = clip(who, WHO_CHARS).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const face = clip(mood, WHO_CHARS).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const holdsWho = kind === 'portrait' && KEY.test(key);

  if (count(db) >= TOTAL) {
    throw new HttpError(409, 'the studio\'s collection is full');
  }
  if (countBy(db, user.id) >= PER_PERSON) {
    throw new HttpError(409, `you have added ${PER_PERSON} pictures already`);
  }

  const info = db.prepare(
    `INSERT INTO collection_art
       (kind, name, who, mood, bytes, mime, width, height, added_by, by_name, created_at)
     VALUES (?, ?, ?, ?, ?, 'image/png', ?, ?, ?, ?, ?)`,
  ).run(
    kind,
    label,
    holdsWho ? key : '',
    holdsWho && KEY.test(face) ? face : (holdsWho ? 'normal' : ''),
    bytes,
    size.width,
    size.height,
    user.id,
    user.display_name,
    new Date().toISOString(),
  );
  // Shaped for the person who just added it, so the answer says `mine: true`
  // and the shelf can offer them the way back out without a second read.
  return one(db, Number(info.lastInsertRowid), user);
}

const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM collection_art').get().n;
const countBy = (db, userId) => db
  .prepare('SELECT COUNT(*) AS n FROM collection_art WHERE added_by = ?').get(userId).n;

// Everything but the bytes: the shelf reads this and fetches each picture by
// its own URL, so one row's worth of bytes never rides in the index.
const PUBLIC = `SELECT id, kind, name, who, mood, width, height, added_by, by_name, created_at
                  FROM collection_art`;

const shape = (row, user) => ({
  id: row.id,
  file: `/api/collection/${row.id}`,
  kind: row.kind,
  name: row.name,
  ...(row.who ? { who: row.who, mood: row.mood } : {}),
  // No licence: whoever drew it kept it. `by` is who, and `mine` is whether
  // the person looking may take it out again.
  by: row.by_name,
  made_here: true,
  mine: user ? row.added_by === user.id : false,
  created_at: row.created_at,
});

export function listArt(db, user = null) {
  return db.prepare(`${PUBLIC} ORDER BY id`).all().map((r) => shape(r, user));
}

export function one(db, id, user = null) {
  const row = db.prepare(`${PUBLIC} WHERE id = ?`).get(id);
  return row ? shape(row, user) : null;
}

export function artBytes(db, id) {
  return db.prepare('SELECT bytes, mime FROM collection_art WHERE id = ?').get(id) ?? null;
}

// ⚠️ A real delete: the row is the only copy. Whoever added it, or an admin.
// Games that already picked it keep their copy, because picking copies the
// bytes in — which is what makes this safe to allow at all.
export function removeArt(db, user, id) {
  const row = db.prepare('SELECT added_by FROM collection_art WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'no such picture');
  if (row.added_by !== user.id && !user.admin) {
    throw new HttpError(403, 'that is somebody else\'s picture');
  }
  db.prepare('DELETE FROM collection_art WHERE id = ?').run(id);
}
