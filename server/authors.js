// Who may change a game.
//
// Being in `users` gets you into the studio and lets you read everything in
// it: every game, every version, every conversation. What it does not get you
// is the right to change somebody else's game. That comes from being one of
// its **authors** — the person who made it, plus anyone an author has added —
// or from the game being **open**, which its authors set when they want the
// whole studio in it.
//
// Two things are deliberately outside the rule:
//
// - **The human-only chat of any game is everyone's.** Talking to the people
//   in the studio is not editing their game, and a game you cannot say
//   anything about is a strange thing to be able to see.
// - **The author list itself is authors-only, even when the game is open.**
//   Open means anybody may work on it, not that anybody may decide who does.

import { HttpError } from './http/respond.js';

export const isAuthor = (db, projectId, userId) => Boolean(db
  .prepare('SELECT 1 FROM project_authors WHERE project_id = ? AND user_id = ?')
  .get(projectId, userId));

export const canEdit = (db, project, user) => project.open_edit === 1
  || isAuthor(db, project.id, user.id);

export const listAuthors = (db, projectId) => db
  .prepare(
    `SELECT u.id, u.display_name
       FROM project_authors pa JOIN users u ON u.id = pa.user_id
      WHERE pa.project_id = ?
      ORDER BY pa.added_at, u.display_name COLLATE NOCASE`,
  )
  .all(projectId);

export function addAuthor(db, projectId, userId, addedBy, now = new Date().toISOString()) {
  db.prepare(
    `INSERT OR IGNORE INTO project_authors (project_id, user_id, added_by, added_at)
     VALUES (?, ?, ?, ?)`,
  ).run(projectId, userId, addedBy, now);
}

// ⚠️ Never the last one. A game with no authors could be changed by nobody
// except by opening it, and nobody could open it either.
export function removeAuthor(db, projectId, userId) {
  const count = db
    .prepare('SELECT COUNT(*) AS c FROM project_authors WHERE project_id = ?')
    .get(projectId).c;
  if (count <= 1) {
    throw new HttpError(409, 'a game keeps at least one editor — add somebody else first');
  }
  const gone = db
    .prepare('DELETE FROM project_authors WHERE project_id = ? AND user_id = ?')
    .run(projectId, userId).changes;
  if (gone === 0) throw new HttpError(404, 'not an editor of this game');
}

export function requireAuthor(db, project, user) {
  if (!isAuthor(db, project.id, user.id)) {
    throw new HttpError(403, `only ${project.name}'s editors can do that`);
  }
}
