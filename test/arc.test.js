// The arc of a game (public/arc.js, spec.md §6): the stamps per type and the
// checks the studio ticks from names alone. Pure, so held here without a
// screen — what the card and the preamble both read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCS, arcFor, checks } from '../public/arc.js';

const facts = (paths, project = {}) => ({ files: paths.map((path) => ({ path })), project });

test('every arc is whole stamps in a fixed order, ending with somebody else and out', () => {
  for (const [type, arc] of Object.entries(ARCS)) {
    assert.ok(arc.length >= 5, `${type} has an arc worth walking`);
    for (const s of arc) {
      assert.ok(s.id && s.name && s.principle && s.makers, `${type}/${s.id} says what it is`);
      assert.ok(Array.isArray(s.checks) && Array.isArray(s.asks), `${type}/${s.id} has checks and asks`);
      for (const a of s.asks) assert.ok(a.label && a.text, `${type}/${s.id} asks in words`);
    }
    assert.deepEqual(arc.slice(-2).map((s) => s.id), ['played', 'out'], `${type} ends the same way`);
    assert.equal(new Set(arc.map((s) => s.id)).size, arc.length, `${type} repeats no stamp`);
  }
});

test('a game with no type takes the arcade’s arc with "What is it?" in front', () => {
  const blank = arcFor(null);
  assert.equal(blank[0].id, 'what');
  assert.deepEqual(blank.slice(1), ARCS.arcade);
  assert.equal(arcFor('quiz'), ARCS.quiz);
  assert.equal(arcFor('no-such-type')[0].id, 'what');
});

test('checks tick from the tree and the row, and nothing else', () => {
  const [moves, loops, looks] = ARCS.arcade;
  assert.deepEqual(checks(moves, facts([])), [
    { text: 'a script in js/', ok: false },
    { text: 'the controls in config/controls.js', ok: false },
  ]);
  assert.deepEqual(
    checks(moves, facts(['js/game.js', 'config/controls.js'])).map((c) => c.ok),
    [true, true],
  );
  assert.deepEqual(checks(loops, facts(['config/play.js'])).map((c) => c.ok), [true]);
  assert.deepEqual(
    checks(looks, facts(['config/words.js', 'icon.png'])).map((c) => c.ok),
    [true, false, true, false],
  );
  // Plain paths work too — the server hands the tree as strings.
  assert.equal(checks(loops, { files: ['config/play.js'], project: {} })[0].ok, true);
  const out = ARCS.arcade.at(-1);
  assert.deepEqual(
    checks(out, facts([], { published: true, scores_on: false })).map((c) => c.ok),
    [true, false],
  );
});

test('a stamp with nothing to tick says so by having no checks', () => {
  const fair = ARCS.arcade.find((s) => s.id === 'fair');
  assert.deepEqual(checks(fair, facts([])), []);
  assert.ok(fair.asks.length > 0, 'and still has something to ask for');
});
