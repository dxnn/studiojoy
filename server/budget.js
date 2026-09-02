import { nextUtcMidnight } from './util/time.js';

// Two walls. The studio-wide budget is the outer one — it stops a runaway tool
// loop draining the API key, whoever set it off — and a person's own daily
// allowance is the inner one, so one person cannot spend everybody's day.
//
// A reply is billed to whoever asked for it: the newest human message in the
// chat when the fire started. An agent has no owner to bill, and the person
// whose turn it is is the one who wanted the answer.
export const DEFAULT_DAILY_TOKEN_BUDGET = 5_000_000;

// What a new account may spend in a day. Stated at creation rather than being
// the column's default, because `daily_tokens` already exists in every live
// database and SQLite will not change a default afterwards. Null still means
// no allowance of one's own, and an admin can set that from the panel — this
// is only where somebody starts. A measured reply averages ~40 K tokens, so
// this is ~25 of them: an afternoon's work, not a wall anybody meets by
// accident.
export const DEFAULT_DAILY_TOKENS = 1_000_000;

// UTC, like the studio-wide reset, so both walls fall on the same midnight.
const dayKey = (now = new Date()) => now.toISOString().slice(0, 10);

// What the studio's budget actually is: the number in the row if somebody has
// set one, else the built-in.
export function studioLimit(db, fallback = DEFAULT_DAILY_TOKEN_BUDGET) {
  const row = db.prepare('SELECT daily_token_budget FROM studio_state WHERE id = 1').get();
  return row?.daily_token_budget ?? fallback;
}

export function userSpentToday(db, userId, now = new Date()) {
  const row = db
    .prepare('SELECT tokens FROM user_tokens WHERE user_id = ? AND day = ?')
    .get(userId, dayKey(now));
  return row?.tokens ?? 0;
}

// Null allowance is no allowance of their own: the studio-wide wall still
// applies, and that is the whole of it.
export function userHasBudget(db, user, now = new Date()) {
  if (!user || user.daily_tokens === null || user.daily_tokens === undefined) return true;
  return userSpentToday(db, user.id, now) < user.daily_tokens;
}

export function chargeUser(db, userId, tokens, now = new Date()) {
  const amount = Math.max(0, Math.round(Number(tokens) || 0));
  if (!userId || amount === 0) return;
  db.prepare(
    `INSERT INTO user_tokens (user_id, day, tokens) VALUES (?, ?, ?)
     ON CONFLICT (user_id, day) DO UPDATE SET tokens = tokens + excluded.tokens`,
  ).run(userId, dayKey(now), amount);
}

// Rollover is lazy: the counter resets on the first read or write after the
// stored reset time passes, so nothing has to run at midnight.
function rollover(db, now) {
  const state = db.prepare('SELECT * FROM studio_state WHERE id = 1').get();
  if (new Date(state.budget_reset_at) > now) return state;
  const reset = nextUtcMidnight(now);
  db.prepare(
    'UPDATE studio_state SET tokens_used_today = 0, budget_reset_at = ? WHERE id = 1',
  ).run(reset);
  return { ...state, tokens_used_today: 0, budget_reset_at: reset };
}

export function budgetState(db, limit = DEFAULT_DAILY_TOKEN_BUDGET, now = new Date()) {
  const state = rollover(db, now);
  return {
    used: state.tokens_used_today,
    limit,
    remaining: Math.max(0, limit - state.tokens_used_today),
    resets_at: state.budget_reset_at,
  };
}

export function hasBudget(db, limit = DEFAULT_DAILY_TOKEN_BUDGET, now = new Date()) {
  return rollover(db, now).tokens_used_today < limit;
}

export function consumeBudget(db, tokens, now = new Date()) {
  rollover(db, now);
  const amount = Math.max(0, Math.round(Number(tokens) || 0));
  if (amount === 0) return;
  db.prepare(
    'UPDATE studio_state SET tokens_used_today = tokens_used_today + ? WHERE id = 1',
  ).run(amount);
}
