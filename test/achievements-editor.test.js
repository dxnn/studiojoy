// The achievements editor's model layer: what it reads, what it declines,
// that the shipped seed reads and writes back byte for byte, and what the
// whole list says that one row cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  achievementsModel, achievementsText, achievementChecks, freshId, isAchievementsPath, TESTS,
} from '../public/achievements-editor.js';

const SEED = fs.readFileSync(
  new URL('../public/templates/achievements.js', import.meta.url), 'utf8',
);

const FULL = `
const ACHIEVEMENTS = [
  { id: "first-run", name: "First run", how: "Finish a run", icon: "🚀", when: { moment: "run-over" } },
  { id: "halfway", name: "Halfway there", how: "Reach level 5", when: { moment: "level", atLeast: 5 } },
  { id: "quick", name: "Quick", how: "", when: { moment: "time", atMost: 30 } },
  { id: "good-end", name: "Happily ever after", how: "Find it", when: { moment: "ending", is: "good" } },
  { id: "lucky", name: "Lucky", how: "Roll a 7", when: { moment: "roll", is: 7 } },
  { id: "chatty", name: "Chatty", how: "Answer ten", when: { moment: "answered", times: 10 } },
  { id: "secret", name: "Secret room", how: "Find it" },
];
`;

test('only config/achievements.js is the achievements file', () => {
  assert.equal(isAchievementsPath('config/achievements.js'), true);
  assert.equal(isAchievementsPath('config/words.js'), false);
  assert.equal(isAchievementsPath('achievements.js'), false);
});

test('the seed reads as an empty list, and writing it back changes nothing', () => {
  const model = achievementsModel(SEED);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.entries, []);
  assert.equal(achievementsText(model), SEED, 'opening the editor and pressing Save is not an edit');
});

test('every kind of rule reads, and round-trips through the text', () => {
  const model = achievementsModel(FULL);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.entries.map((a) => a.when), [
    { moment: 'run-over', test: 'any', value: undefined },
    { moment: 'level', test: 'atLeast', value: 5 },
    { moment: 'time', test: 'atMost', value: 30 },
    { moment: 'ending', test: 'is', value: 'good' },
    { moment: 'roll', test: 'is', value: 7 },
    { moment: 'answered', test: 'times', value: 10 },
    null,
  ]);
  assert.deepEqual(model.entries[0], {
    id: 'first-run', name: 'First run', how: 'Finish a run', icon: '🚀',
    when: { moment: 'run-over', test: 'any', value: undefined },
  });
  assert.equal(model.entries[1].icon, '', 'no icon is an empty string in the form');

  const text = achievementsText(model);
  assert.ok(text.startsWith('// What a player can earn in this game.'), 'the seed\'s header rides along');
  assert.match(text, /when: \{ moment: "level", atLeast: 5 \},/);
  assert.match(text, /when: \{ moment: "roll", is: 7 \},/);
  assert.match(text, /when: \{ moment: "ending", is: "good" \},/);
  assert.doesNotMatch(text, /icon: ""/, 'an empty icon is left out');
  const again = achievementsModel(text);
  assert.equal(again.ok, true, again.reason);
  assert.deepEqual(again.entries, model.entries);

  // Quotes and odd characters survive a round trip too.
  model.entries[0].name = 'What\'s "best"?\ttabs';
  model.entries[0].when = { moment: 'ending', test: 'is', value: 'the "good" one' };
  assert.deepEqual(achievementsModel(achievementsText(model)).entries[0], model.entries[0]);
});

test('anything outside the shape makes the editor decline with a reason', () => {
  const grown = /grown past what the achievements editor understands/;
  for (const text of [
    'const ACHIEVEMENTS = []; const OTHER = 1;',
    'const ACHIEVEMENTS = { id: "x" };',
    'const ACHIEVEMENTS = [1];',
    'const ACHIEVEMENTS = [{ id: "x", name: "X", extra: 1 }];',
    'const ACHIEVEMENTS = [{ name: "X" }];',
    'const ACHIEVEMENTS = [{ id: 7, name: "X" }];',
    'const ACHIEVEMENTS = [{ id: "x", name: "X", when: "run-over" }];',
    'const ACHIEVEMENTS = [{ id: "x", name: "X", when: { atLeast: 5 } }];',
    'const ACHIEVEMENTS = [{ id: "x", name: "X", when: { moment: "l", atLeast: 1, atMost: 3 } }];',
    'const ACHIEVEMENTS = [{ id: "x", name: "X", when: { moment: "l", atLeast: "5" } }];',
    'const ACHIEVEMENTS = [{ id: "x", name: "X", when: { moment: "l", is: true } }];',
    'const ACHIEVEMENTS = [{ id: "x", name: "X", when: { moment: "l", sometimes: 1 } }];',
  ]) {
    const model = achievementsModel(text);
    assert.equal(model.ok, false, text);
    assert.match(model.reason, grown, text);
  }
  const code = achievementsModel('const ACHIEVEMENTS = [1 + 1];');
  assert.equal(code.ok, false);
  assert.doesNotMatch(code.reason, grown, 'a file the reader refuses says the reader\'s reason');
});

test('the checks say what the game will not count, and what it has not been heard to say', () => {
  const model = achievementsModel(FULL);
  assert.deepEqual(achievementChecks(model), [], 'nothing heard yet: nothing to say about moments');

  const heard = new Map([['run-over', {}], ['level', {}], ['ending', {}], ['roll', {}]]);
  assert.deepEqual(achievementChecks(model, heard), [
    '“Quick” waits for “time”, which the game has not been heard to say.',
    '“Chatty” waits for “answered”, which the game has not been heard to say.',
  ]);

  // A real player already holding it proves the rule fires — the warning is
  // moot and drops, even though the game still has not been heard to say it.
  const counts = new Map([['quick', 1]]);
  assert.deepEqual(achievementChecks(model, heard, counts), [
    '“Chatty” waits for “answered”, which the game has not been heard to say.',
  ]);

  // A row being written, a duplicate id and an icon that is not one emoji
  // are flagged with the shape module's own words.
  model.entries.push({ id: '', name: '', how: '', icon: '', when: null });
  model.entries.push({ id: 'secret', name: 'Twice', how: '', icon: '', when: null });
  model.entries.push({ id: 'shiny', name: 'Shiny', how: '', icon: '🚀🚀🚀🚀🚀🚀🚀🚀🚀', when: null });
  const checks = achievementChecks(model);
  assert.deepEqual(checks, [
    'An achievement with no name yet is not in the game until it has one.',
    '“Twice” is not in the game: that id is already used.',
    '“Shiny” is not in the game: its icon is not one emoji.',
  ]);
});

test('freshId comes from the name, once, and never collides', () => {
  const entries = achievementsModel(FULL).entries;
  assert.equal(freshId('First Run!', []), 'first-run');
  assert.equal(freshId('First Run!', entries), 'first-run-2');
  assert.equal(freshId('  Héllo, wörld  ', []), 'h-llo-w-rld');
  assert.equal(freshId('', []), 'achievement');
  assert.equal(freshId('!!!', []), 'achievement');
  assert.equal(freshId('x'.repeat(80), []).length, 36);
  assert.deepEqual(TESTS.map(([k]) => k), ['any', 'atLeast', 'atMost', 'is', 'times']);
});
