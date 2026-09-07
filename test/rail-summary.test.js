// The rail under the preview when nothing else is selected: every
// achievement, then every score (spec/ §6). Three things are worth holding
// here, and all three were decisions rather than accidents — the order,
// which Share now shares; that a headcount is words a finger can read rather
// than a `title` nobody on a phone will ever see; and that a board switched
// off is silent in both places it could speak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install, all, withClass, hasClass } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S, renderGameSummary } = await import('../public/main.js');
const { bestScore } = await import('../public/scoreboard.js');

const ENTRIES = [
  { id: 'first-flight', name: 'First flight', icon: '🚀' },
  { id: 'no-crash', name: 'Not a scratch', icon: '🛡' },
];

const SCORES = [
  { name: 'Robin', score: 4200, created_at: new Date().toISOString() },
  { name: 'Sam', score: 900, created_at: new Date().toISOString() },
];

// A game open with both lists loaded, which is what opening one does
// (loadScores and loadCounts ride the fetch of the game itself).
function open({ scoresOn = true, entries = ENTRIES, scores = SCORES } = {}) {
  S.project = { slug: 'tank', name: 'Tank', scores_on: scoresOn };
  S.slug = 'tank';
  S.mode = 'chat';
  S.achievements = { model: { entries }, text: '', etag: null, dirty: false };
  S.scores = scores;
  return renderGameSummary();
}

const textsOf = (tree, cls) => withClass(tree, cls).map((n) => n.textContent);

test('achievements come before scores', () => {
  const nodes = all(open());
  const achievements = nodes.findIndex((n) => hasClass(n, 'rail-ach-list'));
  const scores = nodes.findIndex((n) => hasClass(n, 'score-list'));
  assert.ok(achievements >= 0, 'the achievements are there');
  assert.ok(scores >= 0, 'the scores are there');
  assert.ok(achievements < scores, 'achievements are rendered before scores');
});

test('every achievement and every score is shown, not just the best', () => {
  const tree = open();
  assert.deepEqual(textsOf(tree, 'ach-name'), ['First flight', 'Not a scratch']);
  assert.deepEqual(textsOf(tree, 'sname'), ['Robin', 'Sam']);
  assert.deepEqual(textsOf(tree, 'sval'), ['4,200', '900']);
});

// The strip it replaced put the headcount on a `title`, and a touchscreen has
// no way to show one. The words are in the row or they are nowhere.
test('how many people hold an achievement is said in words', () => {
  const held = textsOf(open(), 'ach-held');
  assert.deepEqual(held, ['nobody yet', 'nobody yet']);
  for (const row of withClass(open(), 'rail-ach')) {
    assert.equal(row.attrs.title, undefined, 'nothing is hidden behind a hover');
  }
});

// ⚠️ The wire sends a boolean and the column is 0/1; both have to read as off,
// which `scores_on !== 0` alone did not — the best score stood under a board
// that had just been switched off.
for (const off of [false, 0]) {
  test(`a board switched off (${JSON.stringify(off)}) shows nothing and no best`, () => {
    const tree = open({ scoresOn: off });
    assert.equal(withClass(tree, 'score-list').length, 0);
    assert.equal(bestScore(), null);
    // The achievements are the game's own and are unaffected.
    assert.equal(withClass(tree, 'rail-ach-list').length, 1);
  });
}

test('an empty board and no achievements leave the rail empty rather than headed', () => {
  assert.equal(open({ entries: [], scores: [] }), null);
  // One of the two is enough to render, and only that one appears.
  const onlyScores = open({ entries: [] });
  assert.equal(withClass(onlyScores, 'rail-ach-list').length, 0);
  assert.equal(withClass(onlyScores, 'score-list').length, 1);
});
