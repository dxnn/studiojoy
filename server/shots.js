// A shot: the last frame of a game somebody was watching, so a helper can be
// shown what they were looking at when they typed (spec.md §8, §14).
//
// One row per project, replaced every time — not a history, not a file, and
// never a commit. A shot is like a score: it happens while somebody plays, it
// enters no version and it restarts no preview.
//
// ⚠️ The bytes arrive from inside the preview frame, which runs LLM-written
// game code on another origin, so nothing about them is believed: the data
// URI's own words about its type are checked against the three types the API
// will look at (§14), the base64 is decoded here rather than passed on, and
// what comes out is capped. What is stored is bytes and a media type, and the
// only thing that ever reads them is the tool that hands one to DeepSeek.

// A 768px JPEG of a game screen is 30–80 KB. The cap is the room above that,
// not a target: anything larger is a game drawing something pathological, and
// a picture costs at most ~1,024 tokens however many bytes it is.
export const MAX_SHOT_BYTES = 512 * 1024;

// What DeepSeek will look at, of what a canvas can export. GIF is absent on
// purpose: `toDataURL` never makes one.
const SHOT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const DATA_URI = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/;

// Hex and the one colon a pending commit's stamp carries (files/pending.js),
// and never longer than one — the same cleaning the reporter's own version
// mark gets, for the same reason: it is a value from the frame.
export const safeVersion = (version) => String(version ?? '')
  .replace(/[^0-9a-f:]/g, '')
  .slice(0, 49);

// The data URI the reporter posted, as bytes and a type, or a reason it is
// not being kept. Reasons are for the route to turn into a 400; a shot is
// nobody's emergency, but a silent drop would be a mystery.
export function readShot(dataUri) {
  if (typeof dataUri !== 'string') return { error: 'data must be a data: URI' };
  const found = DATA_URI.exec(dataUri);
  if (!found) return { error: 'data must be a base64 image data: URI' };
  const [, mime, base64] = found;
  if (!SHOT_TYPES.has(mime)) return { error: `${mime} is not a picture that can be looked at` };
  // Decoding is the real check: base64 the regex accepts can still be
  // malformed, and Buffer.from ignores what it cannot read rather than
  // throwing, so what comes out is what is measured.
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) return { error: 'the picture decoded to nothing' };
  if (bytes.length > MAX_SHOT_BYTES) {
    return { error: `the picture is ${bytes.length} bytes, over the ${MAX_SHOT_BYTES} byte limit` };
  }
  return { mime, bytes };
}

export function saveShot(db, projectId, { mime, bytes, version }, now = new Date().toISOString()) {
  db.prepare(
    `INSERT INTO project_shots (project_id, mime, bytes, version, at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE
       SET mime = excluded.mime, bytes = excluded.bytes,
           version = excluded.version, at = excluded.at`,
  ).run(projectId, mime, bytes, safeVersion(version), now);
}

export const latestShot = (db, projectId) => db
  .prepare('SELECT mime, bytes, version, at FROM project_shots WHERE project_id = ?')
  .get(projectId) ?? null;
