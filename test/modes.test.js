// The mode row: what the pills say, and what the code calls them (spec/ §6).
// The two are deliberately different words now, so this is where the split is
// held still — a rename of one half that drags the other along is the bug
// these are here to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from './dom-stand-in.js';

// ⚠️ game-types.js reaches the editors, which reach the client's core.
install();

const { modesFor, editorsFor } = await import('../public/game-types.js');

const game = (type = null) => ({ kind: 'game', type });
const idsOf = (project) => modesFor(project).map((m) => m.id);
const labelsOf = (project) => modesFor(project).map((m) => m.label);

test('the pills are the senses, in the row order the code has always had', () => {
  assert.deepEqual(
    labelsOf(game()),
    ['Speak', 'See', 'Hear', 'Touch', 'Taste', 'Recall', 'Smell'],
  );
});

test('⚠️ the ids are the code\'s own words, whatever the pills say', () => {
  // An id is not a label with a different case: it is in every `?mode=` link
  // anybody has ever sent and in `mode-<slug>` in every browser here, so a
  // label moving must never move one. See spec/ §6.
  assert.deepEqual(
    idsOf(game()),
    ['chat', 'pics', 'hear', 'controls', 'code', 'versions', 'share'],
  );
});

test('a type\'s editors sit after the chat, keeping their plain names', () => {
  assert.deepEqual(labelsOf(game('visual-novel')).slice(0, 2), ['Speak', 'Write']);
  assert.deepEqual(labelsOf(game('quiz')).slice(0, 2), ['Speak', 'Questions']);
  assert.deepEqual(idsOf(game('visual-novel')).slice(0, 2), ['chat', 'story']);
  assert.equal(editorsFor(null).length, 0, 'a free-form game brings none');
});

test('a chat project is one room and no row', () => {
  assert.deepEqual(idsOf({ kind: 'chat' }), ['chat']);
  assert.deepEqual(idsOf(null), ['chat']);
});

test('⚠️ every pill says what is behind it, because three of them do not', () => {
  // Smell is the game's public face and Taste is the tree: the words under the
  // pointer are the whole of the explanation, so an empty or circular `what`
  // leaves a button nobody can read.
  for (const mode of [...modesFor(game('visual-novel')), ...modesFor(game('quiz'))]) {
    assert.ok(mode.what?.length > 20, `${mode.label} says what it holds`);
    assert.ok(
      !mode.what.toLowerCase().startsWith(mode.label.toLowerCase()),
      `${mode.label} explains rather than repeating itself`,
    );
  }
});

test('no two pills read the same', () => {
  const labels = labelsOf(game('visual-novel'));
  assert.equal(new Set(labels).size, labels.length);
});
