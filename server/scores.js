import { HttpError } from './http/respond.js';
import { tx } from './db.js';

// The scoreboard: the games origin's one write (spec.md §6). Posting takes
// being signed in now, and the name on the row is the account's — but every
// dimension stays capped and the route keeps its own rate limit, because a
// player session is not the account list.
//
// ⚠️ The *score* is still forgeable by whoever opens devtools: the client is
// the only witness to the run, and signing it would need a secret inside
// LLM-written game code, which is no secret. What signing in ends is the
// name being anybody's — a forged score is an accepted cost, a forged
// person is not (ideas/next-five.md).
const MAX_NAME_CHARS = 24;
export const MAX_SCORE_ROWS = 100; // rows kept per game, best first
const DEFAULT_TOP = 10;
export const SCORE_POSTS_PER_MINUTE = 10;
export const MAX_SCORE_BODY_BYTES = 1024;

export function topScores(db, projectId, rawLimit) {
  // Forgiving on purpose: this is called by kid-written game code, and a bad
  // ?limit= that answered 400 would just be a scoreboard that never appears.
  const n = rawLimit ? Number(rawLimit) : NaN;
  const limit = Number.isFinite(n)
    ? Math.min(Math.max(Math.trunc(n), 1), MAX_SCORE_ROWS)
    : DEFAULT_TOP;
  return db
    .prepare(
      `SELECT name, score FROM scores WHERE project_id = ?
        ORDER BY score DESC, id LIMIT ?`,
    )
    .all(projectId, limit);
}

// Returns the entry's rank, or null when it did not make the board. Bigger
// is always better; a game that counts time down posts the negative.
//
// The name is the player's own and nothing in the body can change it — a
// body that still carries one (every game from before) has it ignored, which
// is kinder than failing the games that already work. It is squeezed to the
// board's width here rather than refused: the account's name was validated
// when it was made, and a scoreboard is no place to bounce somebody for the
// length of their name. Still bounded and control-free on the way out,
// because a game renders it (the preamble says textContent, never innerHTML).
export function submitScore(db, projectId, player, body, now = new Date()) {
  const name = [...player.display_name]
    .filter((ch) => ch.codePointAt(0) >= 0x20 && ch.codePointAt(0) !== 0x7f)
    .join('').trim().slice(0, MAX_NAME_CHARS).trimEnd() || 'Player';
  const { score } = body;
  if (!Number.isSafeInteger(score)) {
    throw new HttpError(400, 'score must be a whole number');
  }

  return tx(db, () => {
    // The personal best first: it survives the pruning below, which is its
    // whole point — the board keeps the best 100 runs, this keeps *your*
    // best whether or not it is one of them. Nothing displays it yet.
    db.prepare(
      `INSERT INTO personal_bests (project_id, user_id, score, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (project_id, user_id) DO UPDATE
         SET score = excluded.score, created_at = excluded.created_at
       WHERE excluded.score > personal_bests.score`,
    ).run(projectId, player.id, score, now.toISOString());
    const { lastInsertRowid: id } = db
      .prepare(
        `INSERT INTO scores (project_id, user_id, name, score, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(projectId, player.id, name, score, now.toISOString());
    // Rank is counted before pruning, so a miss is null rather than a number
    // pointing at a deleted row. Ties go to the earlier post.
    const { ahead } = db
      .prepare(
        `SELECT COUNT(*) AS ahead FROM scores
          WHERE project_id = ? AND (score > ? OR (score = ? AND id < ?))`,
      )
      .get(projectId, score, score, id);
    db.prepare(
      `DELETE FROM scores WHERE project_id = ? AND id NOT IN (
         SELECT id FROM scores WHERE project_id = ?
          ORDER BY score DESC, id LIMIT ?)`,
    ).run(projectId, projectId, MAX_SCORE_ROWS);
    const rank = Number(ahead) + 1;
    return rank <= MAX_SCORE_ROWS ? rank : null;
  });
}

// Sliding window per IP, counting every post rather than failures — which is
// why it is not createLockout from auth.js. In-memory like the login
// lockouts (spec.md §11): a restart clears it. The sweep keeps a stranger
// with many addresses from growing the map without bound. `what` names the
// posts in the 429, because the sign-up form borrows this for its own limit.
export function createScoreLimiter({
  max = SCORE_POSTS_PER_MINUTE,
  windowMs = 60 * 1000,
  what = 'scores',
} = {}) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    if (hits.size >= 10_000) {
      for (const [k, times] of hits) {
        if (now - times[times.length - 1] >= windowMs) hits.delete(k);
      }
    }
    const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (times.length >= max) {
      hits.set(key, times);
      const seconds = Math.ceil((times[0] + windowMs - now) / 1000);
      throw new HttpError(429, `too many ${what}; try again in ${seconds}s`, {
        retry_after: seconds,
      });
    }
    times.push(now);
    hits.set(key, times);
  };
}
