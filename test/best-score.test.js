// The best score under the preview (scoreboard.js, `bestScore`): the board's
// top, in gold, in the preview's foot — and nothing at all while the board is
// switched off. What is held here is a regression, not a choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S } = await import('../public/main.js');
const { bestScore } = await import('../public/scoreboard.js');

const SCORES = [
  { name: 'Robin', score: 4200, created_at: new Date().toISOString() },
  { name: 'Sam', score: 900, created_at: new Date().toISOString() },
];

function open(scoresOn) {
  S.project = { slug: 'tank', name: 'Tank', scores_on: scoresOn };
  S.slug = 'tank';
  S.scores = SCORES;
}

test('the best is the board\'s top', () => {
  open(true);
  assert.equal(bestScore(), 4200);
});

// ⚠️ The wire sends a boolean and the column is 0/1; both have to read as off,
// which `scores_on !== 0` alone did not — the best score stood under a board
// that had just been switched off.
for (const off of [false, 0]) {
  test(`a board switched off (${JSON.stringify(off)}) has no best`, () => {
    open(off);
    assert.equal(bestScore(), null);
  });
}
