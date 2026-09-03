// Runtime errors: what the game said when it ran.
//
// A reporter inside the game posts problems to the studio (see reporter.js),
// the studio stores them here, and the next fire hands them to the helpers as
// text. That round trip is the only way an agent ever learns its game is
// broken — it cannot be shown a screenshot (spec.md §14).
//
// Every row carries the commit it happened on. A fix moves HEAD, so errors
// from the broken version stop being current the moment it is replaced, and
// nothing has to remember to clear them.

export const MAX_ERRORS_PER_PROJECT = 20;
const MAX_ERROR_MESSAGE = 500;
const MAX_ERROR_LOCATION = 200;

// Built from a string so the pattern stays readable: written as a literal it
// is a range of invisible characters nobody can check by eye.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g');

function clean(value, max) {
  // One problem is one line in the agent's context block, and this text comes
  // from LLM-written game code — so newlines and control characters go.
  return String(value ?? '').replace(CONTROL, ' ').trim().slice(0, max);
}

export function errorPublic(row) {
  return {
    id: row.id,
    message: row.message,
    location: row.location,
    times: row.times,
    at: row.at,
  };
}

// Cheap enough to ask on every fire, which is the point: knowing there is
// nothing to report saves reading HEAD out of git for the common case.
export function hasErrors(db, projectId) {
  return db
    .prepare('SELECT 1 FROM runtime_errors WHERE project_id = ? LIMIT 1')
    .get(projectId) !== undefined;
}

// Errors for the version of the game that is on disk now. Anything older is
// about code that no longer exists.
export function listErrors(db, projectId, sha) {
  return db
    .prepare(
      `SELECT * FROM runtime_errors
        WHERE project_id = ? AND commit_sha = ?
        ORDER BY id`,
    )
    .all(projectId, sha);
}

// A pending commit landed (files/pending.js): the problems filed against the
// saves it covered were about the bytes that have just become this commit.
export function retagErrors(db, projectId, fromStamp, toSha) {
  db.prepare('UPDATE runtime_errors SET commit_sha = ? WHERE project_id = ? AND commit_sha = ?')
    .run(toSha, projectId, fromStamp);
}

// Record a batch and return the project's current list. Identical problems
// collapse into one row with a count: a game that throws inside its animation
// loop would otherwise fill the table in a second and say nothing extra.
export function recordErrors(db, projectId, sha, entries) {
  // The old version's problems are not this version's, and dropping them here
  // means no commit path has to remember to.
  db.prepare('DELETE FROM runtime_errors WHERE project_id = ? AND commit_sha != ?')
    .run(projectId, sha);

  const now = new Date().toISOString();
  for (const entry of entries) {
    const message = clean(entry?.message, MAX_ERROR_MESSAGE);
    if (!message) continue;
    const location = clean(entry?.location, MAX_ERROR_LOCATION);
    const existing = db
      .prepare(
        `SELECT id FROM runtime_errors
          WHERE project_id = ? AND commit_sha = ? AND message = ? AND location = ?`,
      )
      .get(projectId, sha, message, location);
    if (existing) {
      db.prepare('UPDATE runtime_errors SET times = times + 1, at = ? WHERE id = ?')
        .run(now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO runtime_errors (project_id, commit_sha, message, location, times, at)
         VALUES (?, ?, ?, ?, 1, ?)`,
      ).run(projectId, sha, message, location, now);
    }
  }

  // Oldest first out of the door, so the newest problems are the ones kept.
  db.prepare(
    `DELETE FROM runtime_errors
      WHERE project_id = ? AND id NOT IN (
        SELECT id FROM runtime_errors WHERE project_id = ?
         ORDER BY id DESC LIMIT ?
      )`,
  ).run(projectId, projectId, MAX_ERRORS_PER_PROJECT);

  return listErrors(db, projectId, sha);
}
