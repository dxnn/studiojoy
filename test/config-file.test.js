import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseConfigFile, literalFor, spliceValue } from '../public/config-file.js';

// The shape the preamble asks agents for, and the shape space-racer's
// settings.js was already written in before anything asked it to.
const SAMPLE = `// How the ship flies.
const TURN_SPEED = 0.025;  // how fast the ship turns
const LAPS_TO_WIN = 3;     // laps to finish the race
const BOOST = true;        // can you boost?

// The tracks.
const TRACKS = [
  { name: "NOVA OVAL", width: 120, rocks: 12 },   // the easy one
  { name: "BUMBLE SPRINT", width: 105, rocks: 20 },
];
const WORDS = {
  win: "YOU WIN!",   // shown when you finish first
  lose: "CRASHED",
};
`;

test('a config file parses into named values with their comments', () => {
  const out = parseConfigFile(SAMPLE);
  assert.ok(out.ok, out.reason);
  assert.deepEqual(out.decls.map((d) => d.name), [
    'TURN_SPEED', 'LAPS_TO_WIN', 'BOOST', 'TRACKS', 'WORDS',
  ]);

  const [turn, laps, boost, tracks, words] = out.decls;
  assert.equal(turn.node.value, 0.025);
  assert.equal(turn.node.comment, 'how fast the ship turns');
  assert.equal(laps.node.kind, 'number');
  assert.equal(boost.node.value, true);

  // Nested values keep their own spans and comments, so a table renders as a
  // table and one cell can be edited on its own.
  assert.deepEqual(tracks.node.value, [
    { name: 'NOVA OVAL', width: 120, rocks: 12 },
    { name: 'BUMBLE SPRINT', width: 105, rocks: 20 },
  ]);
  assert.equal(tracks.node.items[0].comment, 'the easy one');
  assert.equal(words.node.props[0].node.comment, 'shown when you finish first');
});

test('a comment above a value is used when there is none beside it', () => {
  const out = parseConfigFile('// how much gravity pulls\nconst GRAVITY = 0.6;\n');
  assert.ok(out.ok, out.reason);
  assert.equal(out.decls[0].node.comment, 'how much gravity pulls');
});

test('editing a value leaves every other byte alone', () => {
  const out = parseConfigFile(SAMPLE);
  const laps = out.decls.find((d) => d.name === 'LAPS_TO_WIN');
  const next = spliceValue(SAMPLE, laps.node, literalFor('number', '5'));

  assert.match(next, /const LAPS_TO_WIN = 5;\s+\/\/ laps to finish the race/);
  // Comments, alignment and the rest of the file are untouched.
  assert.equal(next.length, SAMPLE.length);
  assert.equal(
    next.replace('LAPS_TO_WIN = 5', 'LAPS_TO_WIN = 3'), SAMPLE,
    'the only difference is the one value',
  );
});

test('a nested value can be edited on its own', () => {
  const out = parseConfigFile(SAMPLE);
  const tracks = out.decls.find((d) => d.name === 'TRACKS');
  const width = tracks.node.items[1].props.find((p) => p.key === 'width').node;
  const next = spliceValue(SAMPLE, width, literalFor('number', '200'));

  const reparsed = parseConfigFile(next);
  assert.ok(reparsed.ok, reparsed.reason);
  assert.equal(
    reparsed.decls.find((d) => d.name === 'TRACKS').node.value[1].width, 200,
  );
  assert.match(next, /"BUMBLE SPRINT", width: 200/);
});

test('a string is quoted so its own quotes cannot break the file', () => {
  const out = parseConfigFile(SAMPLE);
  const words = out.decls.find((d) => d.name === 'WORDS');
  const win = words.node.props.find((p) => p.key === 'win').node;
  const next = spliceValue(SAMPLE, win, literalFor('string', 'IT\'S "YOU" \\o/'));

  const reparsed = parseConfigFile(next);
  assert.ok(reparsed.ok, reparsed.reason);
  assert.equal(
    reparsed.decls.find((d) => d.name === 'WORDS').node.value.win, 'IT\'S "YOU" \\o/',
  );
});

// Refusing the whole file is deliberate: a form showing only the part it
// understood would silently hide the rest.
test('anything that is not a plain value refuses the whole file', () => {
  const cases = {
    'a function': 'const F = function () { return 1; };',
    'an arrow': 'const F = (a) => a + 1;',
    'a sum': 'const N = 60 * 60;',
    'a call': 'const N = Math.random();',
    'a template literal': 'const S = `hi ${name}`;',
    'a name': 'const S = OTHER_THING;',
    'a bare statement': 'let x = 1;',
    'an unclosed string': 'const S = "oops\n',
    'an unclosed comment': 'const N = 1;\n/* nope',
  };
  for (const [label, source] of Object.entries(cases)) {
    const out = parseConfigFile(source);
    assert.equal(out.ok, false, `${label} should be refused`);
    assert.match(out.reason, /line \d+/, `${label} should say where`);
  }
});

test('an empty file and a use-strict prologue are both fine', () => {
  assert.deepEqual(parseConfigFile('').decls, []);
  assert.deepEqual(parseConfigFile('\n// nothing yet\n').decls, []);
  const strict = parseConfigFile('"use strict";\nconst A = 1;\n');
  assert.ok(strict.ok, strict.reason);
  assert.equal(strict.decls[0].name, 'A');
});

test('a number the form could not reopen is rejected rather than written', () => {
  for (const bad of ['fast', '', ' ', '1,5', '0x10', '1 + 1', 'Infinity']) {
    assert.equal(literalFor('number', bad), null, `${bad} should be refused`);
  }
  assert.equal(literalFor('number', '0.50'), '0.50', 'what was typed is kept');
  assert.equal(literalFor('number', '-2e3'), '-2e3');
  assert.equal(literalFor('boolean', false), 'false');
});

// The real thing, once it has been migrated: whatever ships in the repo must
// stay inside the subset the form can open.
test('every config file in the repo parses', () => {
  const games = path.join(import.meta.dirname, '..', 'games');
  if (!fs.existsSync(games)) return;
  let seen = 0;
  for (const slug of fs.readdirSync(games)) {
    const dir = path.join(games, slug, 'config');
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      const out = parseConfigFile(fs.readFileSync(path.join(dir, name), 'utf8'));
      assert.ok(out.ok, `${slug}/config/${name}: ${out.reason}`);
      seen += 1;
    }
  }
  assert.ok(seen > 0, 'no config files found to check');
});
