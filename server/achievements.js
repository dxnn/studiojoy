import path from 'node:path';
import { HttpError } from './http/respond.js';
import { readFileAt } from './files/tree.js';
// ⚠️ The first server imports from public/. parseConfigFile is the client's
// own reader — pure, no eval, no new Function — and the shape module beside
// it is what the achievements editor reads with too, so the server and the
// form cannot disagree about which entries exist (spec.md §16).
import { parseConfigFile } from '../public/config-file.js';
import { readAchievements } from '../public/achievement-shape.js';
import { tx } from './db.js';
import { joyOn, payJoy } from './joy.js';

// Achievements: the games origin's third write (spec.md §3, §6). The
// definitions are the game's own file, config/achievements.js, read from the
// working tree on every request rather than kept in a table — versioned,
// forked with the game, in front of every helper, and live the moment a
// helper or the editor changes it. What the studio keeps is who earned which:
// one row per (game, player, id), INSERT OR IGNORE, never lowered, never
// deleted by any route.
//
// ⚠️ Forgeable exactly as a score is: the rule was met in the browser, and the
// browser is the only witness. The server never sees a moment — only the
// unlock a rule produced — and accepts it for the same reason it accepts a
// score (ideas/achievements.md).
export const ACHIEVEMENTS_FILE = 'config/achievements.js';
export const UNLOCKS_PER_MINUTE = 20;
export const MAX_UNLOCK_BODY_BYTES = 1024;
// Fifty entries at a few hundred bytes each is well under this; a file past
// it is not a list of achievements, and is not parsed on a public route.
export const MAX_ACHIEVEMENTS_FILE_BYTES = 64 * 1024;

// The definitions a text of the file says, in file order: [{id, name, how,
// icon}]. Missing, unreadable, too big or misshapen is an empty list — the
// same answer the library gives itself in the browser.
function definedIn(buffer) {
  if (buffer === null || buffer.length > MAX_ACHIEVEMENTS_FILE_BYTES) return [];
  const parsed = parseConfigFile(buffer.toString('utf8'));
  if (!parsed.ok) return [];
  const decl = parsed.decls.find((d) => d.name === 'ACHIEVEMENTS');
  if (!decl) return [];
  return readAchievements(decl.node.value).ok
    .map(({ id, name, how, icon }) => ({ id, name, how, icon }));
}

// The definitions as the game's file says them right now.
export const definedAchievements = async (dir) => definedIn(await readFileAt(path.join(dir, ACHIEVEMENTS_FILE)));

// ⚠️ An achievement with joy on it stays (Dann, 2026-10-05): the chips went on
// it for good and somebody may be playing for it, so a write that would take
// it out of the file — a person's save, a helper's write, a delete, a move, a
// version brought back — is refused, and this says why; null when it may go
// ahead. `before` and `after` are the file's bytes, null where there is none.
// Only what the file defines now can be lost, so a file already past reading
// stays writable, to be mended. The editor hides Delete on these as well; this
// is the rule, that is the courtesy.
export function joyRefusal(db, projectId, rel, before, after) {
  if (rel !== ACHIEVEMENTS_FILE || before === null) return null;
  const joy = joyOn(db, projectId);
  if (joy.size === 0) return null;
  const kept = new Set(definedIn(after).map((a) => a.id));
  const lost = definedIn(before).filter((a) => joy.has(a.id) && !kept.has(a.id));
  if (lost.length === 0) return null;
  const names = lost.map((a) => `“${a.name}”`).join(', ');
  return lost.length === 1
    ? `${names} gives joy, so it stays in ${ACHIEVEMENTS_FILE}`
    : `${names} give joy, so they stay in ${ACHIEVEMENTS_FILE}`;
}

// What this player holds in this game: id -> when they earned it.
function heldBy(db, projectId, userId) {
  if (!userId) return new Map();
  const rows = db
    .prepare(
      `SELECT achievement, created_at FROM achievements
        WHERE project_id = ? AND user_id = ?`,
    )
    .all(projectId, userId);
  return new Map(rows.map((r) => [r.achievement, r.created_at]));
}

// The list for a game page: every definition with `got` — when the signed-in
// player earned it, or null; null throughout when nobody is signed in — and
// the `joy` it gives whoever earns it (server/joy.js).
export async function listAchievements(db, project, dir, userId) {
  const defined = await definedAchievements(dir);
  const held = heldBy(db, project.id, userId);
  const joy = joyOn(db, project.id);
  return defined.map((a) => ({ ...a, got: held.get(a.id) ?? null, joy: joy.get(a.id) ?? 0 }));
}

// One unlock. 404 for an id the file does not define — the file is the truth,
// so a rule a helper removed is refused from then on, and the rows it left
// are simply shown nowhere. `new` says whether this was the first time, and
// `joy` what it paid — only ever on the first time, in the same transaction;
// later chips reach a holder through settleJoy (server/joy.js).
export async function unlockAchievement(db, project, dir, userId, body, now = new Date()) {
  const id = body?.id;
  if (typeof id !== 'string') throw new HttpError(400, 'id must be text');
  const defined = await definedAchievements(dir);
  if (!defined.some((a) => a.id === id)) throw new HttpError(404, 'no such achievement');
  return tx(db, () => {
    const { changes } = db
      .prepare(
        `INSERT OR IGNORE INTO achievements (project_id, user_id, achievement, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(project.id, userId, id, now.toISOString());
    const first = Number(changes) === 1;
    return { new: first, joy: first ? payJoy(db, project, userId, id, now) : 0 };
  });
}

// The studio side: each definition with how many players hold it and the joy
// it gives, in file order — the editor's structural read. Rows whose id the
// file no longer defines are not counted anywhere until the id comes back.
export async function achievementCounts(db, project, dir) {
  const defined = await definedAchievements(dir);
  const rows = db
    .prepare(
      `SELECT achievement, COUNT(*) AS players FROM achievements
        WHERE project_id = ? GROUP BY achievement`,
    )
    .all(project.id);
  const counts = new Map(rows.map((r) => [r.achievement, Number(r.players)]));
  const joy = joyOn(db, project.id);
  return defined.map((a) => ({ ...a, players: counts.get(a.id) ?? 0, joy: joy.get(a.id) ?? 0 }));
}
