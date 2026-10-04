// Chips and joy: the studio's own currency (ideas/dreams.md §5, spec.md §3).
//
// Everybody with studio access — the people who author games — is given
// CHIPS_A_WEEK chips every week, into a stash that holds STASH_MOST: a week
// that would overfill it adds only what fits, and the weeks nobody looked are
// added the next time anything asks, like the daily budget's rollover. Chips
// are put on an achievement of a published game the person authors, and stay
// there for good. An achievement gives as much joy as it has chips, to
// everybody who earns it — a bounty, so the joy in the studio grows with play,
// which is the point (Dann, 2026-10-04). Joy is a person's to keep, and to
// spend once avatars come.
//
// Nobody earns joy from a game they author, nor from one that is not
// published, nor for an achievement earned before its chips were put on: joy
// is paid once, in the same moment as the earned row.
//
// ⚠️ An unlock is the browser's word, as a score is, so a forged one now makes
// joy. Accountable rather than prevented: every earn is a ledger row with a
// name on it, and undoing one is one more row.

import { HttpError } from './http/respond.js';
import { tx } from './db.js';
import { isAuthor } from './authors.js';

export const CHIPS_A_WEEK = 10;
export const STASH_MOST = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

// The Monday (UTC) a moment falls in, as YYYY-MM-DD: which week it is.
export function weekOf(now) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  return new Date(day - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

const weeksBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / (7 * DAY_MS));

const balance = (db, userId, currency) => Number(db
  .prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM ledger WHERE user_id = ? AND currency = ?')
  .get(userId, currency).n);

function write(db, { userId, currency, delta, why, projectId = null, achievement = null, now }) {
  db.prepare(
    `INSERT INTO ledger (user_id, currency, delta, why, project_id, achievement, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, currency, delta, why, projectId, achievement, now.toISOString());
}

// The weeks this person is owed, added; their stash after. Inside a
// transaction the caller holds.
function grant(db, userId, now) {
  const have = balance(db, userId, 'chips');
  const user = db
    .prepare('SELECT studio_access, deleted, chips_week FROM users WHERE id = ?')
    .get(userId);
  if (!user || user.studio_access !== 1 || user.deleted === 1) return have;
  const week = weekOf(now);
  const owed = user.chips_week === null ? 1 : weeksBetween(user.chips_week, week);
  if (owed <= 0) return have;
  db.prepare('UPDATE users SET chips_week = ? WHERE id = ?').run(week, userId);
  const add = Math.min(owed * CHIPS_A_WEEK, Math.max(0, STASH_MOST - have));
  if (add > 0) write(db, { userId, currency: 'chips', delta: add, why: 'week', now });
  return have + add;
}

// A person's chips, with any weeks they are owed added first.
export const stashOf = (db, userId, now = new Date()) => tx(db, () => grant(db, userId, now));

export const joyOf = (db, userId) => balance(db, userId, 'joy');

// How much joy each achievement of a game gives — the chips put on it — by id.
// Ids with none are not in the map.
export function joyOn(db, projectId) {
  const rows = db
    .prepare(
      `SELECT achievement, -SUM(delta) AS joy FROM ledger
        WHERE project_id = ? AND currency = 'chips' AND why = 'put'
        GROUP BY achievement`,
    )
    .all(projectId);
  return new Map(rows.map((r) => [r.achievement, Number(r.joy)]));
}

// Chips from somebody's stash onto one achievement of a game they author, for
// good. The caller has checked the achievement is one the game defines.
export function putChips(db, project, user, achievement, chips, now = new Date()) {
  if (!Number.isInteger(chips) || chips < 1) {
    throw new HttpError(400, 'chips must be a whole number, at least 1');
  }
  if (!isAuthor(db, project.id, user.id)) {
    throw new HttpError(403, `only ${project.name}'s editors can put chips on its achievements`);
  }
  if (project.published !== 1) {
    throw new HttpError(409, 'chips go on a published game — publish it first');
  }
  return tx(db, () => {
    const have = grant(db, user.id, now);
    if (chips > have) {
      throw new HttpError(409, `there ${have === 1 ? 'is 1 chip' : `are ${have} chips`} in your stash`);
    }
    write(db, {
      userId: user.id, currency: 'chips', delta: -chips, why: 'put',
      projectId: project.id, achievement, now,
    });
    return { joy: joyOn(db, project.id).get(achievement), stash: have - chips };
  });
}

// Joy for the first time somebody earns an achievement, inside the
// transaction that writes the earned row; how much was paid.
export function payJoy(db, project, userId, achievement, now) {
  if (project.published !== 1 || isAuthor(db, project.id, userId)) return 0;
  const joy = joyOn(db, project.id).get(achievement) ?? 0;
  if (joy > 0) {
    write(db, {
      userId, currency: 'joy', delta: joy, why: 'earned', projectId: project.id, achievement, now,
    });
  }
  return joy;
}
