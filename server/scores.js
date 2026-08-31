import { HttpError } from './http/respond.js';
import { tx } from './db.js';

// The scoreboard: the games origin's one write (spec.md §6). Anyone who can
// play a game can post a score to it, so every dimension is capped and the
// route carries its own rate limit — the first one outside login.
//
// ⚠️ Scores are forgeable by whoever opens devtools: the client is the only
// witness. Signing them would need a secret inside LLM-written game code,
// which is no secret. For this studio a forged score is an accepted cost;
// an unbounded table is not (ideas/next-five.md).
const MAX_NAME_CHARS = 24;
export const MAX_SCORE_ROWS = 100; // rows kept per game, best first
const DEFAULT_TOP = 10;
export const SCORE_POSTS_PER_MINUTE = 10;
export const MAX_SCORE_BODY_BYTES = 1024;

const hasControlChars = (s) =>
  [...s].some((ch) => ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f);

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
export function submitScore(db, projectId, body, now = new Date()) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(400, 'a name is required');
  if (name.length > MAX_NAME_CHARS) {
    throw new HttpError(400, `name is over ${MAX_NAME_CHARS} characters`);
  }
  // The name comes back out through JSON into markup a game renders itself;
  // length and control characters are bounded here, angle brackets are the
  // game's job (the preamble says textContent, never innerHTML).
  if (hasControlChars(name)) {
    throw new HttpError(400, 'name contains control characters');
  }
  const { score } = body;
  if (!Number.isSafeInteger(score)) {
    throw new HttpError(400, 'score must be a whole number');
  }

  return tx(db, () => {
    const { lastInsertRowid: id } = db
      .prepare(
        `INSERT INTO scores (project_id, name, score, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(projectId, name, score, now.toISOString());
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
// with many addresses from growing the map without bound.
export function createScoreLimiter({
  max = SCORE_POSTS_PER_MINUTE,
  windowMs = 60 * 1000,
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
      throw new HttpError(429, `too many scores; try again in ${seconds}s`, {
        retry_after: seconds,
      });
    }
    times.push(now);
    hits.set(key, times);
  };
}
