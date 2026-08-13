import { nextUtcMidnight } from './util/time.js';

// One studio-wide daily budget rather than per-user accounting: agents have
// no owner to bill, and the purpose is narrower than new-y's — stop a runaway
// tool loop from draining the API key (spec.md §3).
export const DEFAULT_DAILY_TOKEN_BUDGET = 5_000_000;

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
