import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import {
  hasBudget, consumeBudget, budgetState, DEFAULT_DAILY_TOKEN_BUDGET,
} from '../server/budget.js';
import { nextUtcMidnight } from '../server/util/time.js';

test('a fresh studio has its whole budget', () => {
  const db = openDb(':memory:');
  const state = budgetState(db);
  assert.equal(state.used, 0);
  assert.equal(state.limit, DEFAULT_DAILY_TOKEN_BUDGET);
  assert.equal(state.remaining, DEFAULT_DAILY_TOKEN_BUDGET);
  assert.equal(hasBudget(db), true);
  db.close();
});

test('consumption accumulates and is monotone within a day', () => {
  const db = openDb(':memory:');
  consumeBudget(db, 100);
  consumeBudget(db, 250);
  assert.equal(budgetState(db).used, 350);
  // Nonsense inputs cannot decrease the counter.
  consumeBudget(db, -50);
  consumeBudget(db, NaN);
  consumeBudget(db, undefined);
  consumeBudget(db, 'abc');
  assert.equal(budgetState(db).used, 350);
  // Fractional charges round rather than truncating to zero.
  consumeBudget(db, 0.6);
  assert.equal(budgetState(db).used, 351);
  db.close();
});

test('hasBudget flips exactly at the limit', () => {
  const db = openDb(':memory:');
  consumeBudget(db, 99);
  assert.equal(hasBudget(db, 100), true);
  consumeBudget(db, 1);
  assert.equal(hasBudget(db, 100), false, 'at the limit is over');
  db.close();
});

test('the counter resets lazily once the reset time passes', () => {
  const db = openDb(':memory:');
  consumeBudget(db, 5000);
  assert.equal(budgetState(db).used, 5000);

  // Move the reset marker into the past, as a rollover would leave it.
  db.prepare('UPDATE studio_state SET budget_reset_at = ? WHERE id = 1')
    .run('2020-01-01T00:00:00.000Z');

  const state = budgetState(db);
  assert.equal(state.used, 0, 'the first read after the deadline clears it');
  assert.equal(hasBudget(db, 1), true);
  // And the new marker is in the future.
  assert.ok(new Date(state.resets_at) > new Date());
  assert.equal(state.resets_at, nextUtcMidnight());
  db.close();
});

test('the reset marker is always strictly ahead of the moment that set it', () => {
  const db = openDb(':memory:');
  // A moment just before midnight must still roll forward, not sideways.
  const nearMidnight = new Date('2026-08-12T23:59:59.500Z');
  db.prepare('UPDATE studio_state SET budget_reset_at = ? WHERE id = 1')
    .run('2026-08-12T00:00:00.000Z');
  const state = budgetState(db, 100, nearMidnight);
  assert.equal(state.resets_at, '2026-08-13T00:00:00.000Z');
  assert.ok(new Date(state.resets_at) > nearMidnight);
  db.close();
});

test('a rollover does not lose a charge made in the same call sequence', () => {
  const db = openDb(':memory:');
  consumeBudget(db, 1000);
  db.prepare('UPDATE studio_state SET budget_reset_at = ? WHERE id = 1')
    .run('2020-01-01T00:00:00.000Z');
  // The rollover happens inside consumeBudget, then the charge applies on top.
  consumeBudget(db, 42);
  assert.equal(budgetState(db).used, 42);
  db.close();
});
