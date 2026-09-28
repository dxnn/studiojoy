// The level editor's model: config/level.js read without running it, written
// back byte for byte, the checks only a whole level can make, the list of
// levels, and the kinds of square a game makes up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelModel, levelText, levelChecks, levelShape, paint, addRow, removeRow,
  addColumn, removeColumn, reachable, find, isLevelPath, addLevel, duplicateLevel,
  moveLevel, deleteLevel, addSquare, deleteSquare, usesOf, MAX_SIDE, MIN_SIDE,
} from '../public/level-editor.js';

const grid = (lines) => ({ rows: lines.map((l) => [...l]) });
const text = (levels, squares = {}) => levelText({ levels: levels.map(grid), squares });
const model = (levels, squares = {}) => levelModel(text(levels, squares));
const one = (lines, squares = {}) => {
  const m = model([lines], squares);
  return [m.levels[0], m.squares];
};

const BOMB = { name: 'Bomb', colour: '#ff5533', solid: false };
const CRATE = { name: 'Crate', colour: '#aa7744', solid: true };

test('the file is its own path and nothing else', () => {
  assert.equal(isLevelPath('config/level.js'), true);
  assert.equal(isLevelPath('config/world.js'), false);
});

test('levels and made-up squares read and write back byte for byte', () => {
  const src = text([['#####', '#S G#', '#.o.#', '#####'], ['#####', '#SbG#', '#####']], { b: BOMB });
  const m = levelModel(src);
  assert.equal(m.ok, true, m.reason);
  assert.equal(m.levels.length, 2);
  assert.equal(m.levels[0].rows[1][2], ' ', 'a space is a hole');
  assert.deepEqual(m.squares, { b: BOMB });
  assert.equal(levelText(m), src);
  assert.match(src, /const SQUARES = \{\n {2}b: \{ name: "Bomb", colour: "#ff5533", solid: false \},\n\};/);
  assert.match(text([['#S.G#']]), /const SQUARES = \{\};/, 'none made up is an empty legend, still there');
});

test('a short row is padded with holes, as a trimmed line would be', () => {
  const m = levelModel('const LEVELS = [\n  [\n    "####",\n    "#S",\n  ],\n];\n');
  assert.equal(m.ok, true, m.reason);
  assert.deepEqual(m.levels[0].rows[1], ['#', 'S', ' ', ' ']);
  assert.deepEqual(m.squares, {}, 'SQUARES may be left out');
});

test('anything past the shape declines', () => {
  const grown = (s) => assert.equal(levelModel(s).ok, false, s);
  grown('const LEVEL = ["#S.G#"];\n');
  grown('const LEVELS = [["#x#"]];\n');
  grown('const LEVELS = ["###"];\n');
  grown('const LEVELS = [[1, 2]];\n');
  grown('const LEVELS = [];\n');
  grown('const LEVELS = [[]];\n');
  grown('const LEVELS = [[""]];\n');
  grown('const LEVELS = [["###"]];\nconst MORE = 1;\n');
  grown('const SQUARES = {};\nconst LEVELS = [["###"]];\n');
  const legend = (entry) => `const LEVELS = [["#Sb#"]];\nconst SQUARES = { ${entry} };\n`;
  assert.equal(levelModel(legend('b: { name: "Bomb", colour: "#ff5533", solid: false }')).ok, true);
  grown(legend('b: { name: "Bomb", colour: "#ff5533", solid: false, hurts: 2 }'));
  grown(legend('b: { name: "Bomb", colour: "#ff5533" }'));
  grown(legend('b: { name: "Bomb", colour: "red", solid: false }'));
  grown(legend('b: { name: "", colour: "#ff5533", solid: false }'));
  grown(legend('b: { name: "Bomb", colour: "#ff5533", solid: "no" }'));
  grown('const LEVELS = [["#So#"]];\nconst SQUARES = { o: { name: "Orb", colour: "#ff5533", solid: false } };\n');
  grown('const LEVELS = [["#S1#"]];\nconst SQUARES = { "1": { name: "One", colour: "#ff5533", solid: false } };\n');
});

test('reachable rolls four ways, never through a wall, a solid square or over a hole', () => {
  const [level, squares] = one(['######', '#S# .#', '#.  ##', '#o..##', '######']);
  const can = reachable(level, squares);
  assert.ok(can.has('3,1'), 'down the side');
  assert.ok(can.has('3,3'));
  assert.ok(!can.has('1,3'), 'a hole is never a way on');
  assert.ok(!can.has('1,4'), 'so the floor past it, walled in, is out of reach');
  const [made, legend] = one(['#######', '#SbcG.#', '#######'], { b: BOMB, c: CRATE });
  const across = reachable(made, legend);
  assert.ok(across.has('1,2'), 'a made-up square the ball rolls over');
  assert.ok(!across.has('1,3') && !across.has('1,4'), 'a solid one is a wall');
});

test('the checks say what only the whole level can', () => {
  const say = (lines, squares = {}) => levelChecks(...one(lines, squares)).join('\n');
  assert.equal(say(['#####', '#S.G#', '#####']), '');
  assert.match(say(['#####', '#..G#', '#####']), /nowhere for the ball to start/);
  assert.match(say(['#####', '#S..#', '#####']), /no goal/);
  assert.match(say(['#####', '#S#G#', '#####']), /cannot roll from the start to the goal/);
  assert.match(say(['#####', '#S G#', '#####']), /cannot roll from the start to the goal/, 'a hole is in the way too');
  assert.match(say(['#####', '#ScG#', '#####'], { c: CRATE }), /cannot roll from the start to the goal/, 'and a solid square');
  assert.equal(say(['#####', '#SbG#', '#####'], { b: BOMB }), '', 'a square it rolls over is not in the way');
  assert.match(say(['######', '#S.G#o', '######']), /A coin is where the ball cannot roll/);
  const wide = '#'.repeat(MAX_SIDE + 1);
  assert.match(say([wide, `#S.G${'.'.repeat(MAX_SIDE - 4)}#`, wide]), /phone starts to crawl/);
});

test('painting keeps one start and one goal, and the grid stays in bounds', () => {
  const [m, squares] = one(['#####', '#S.G#', '#####'], { b: BOMB });
  assert.equal(paint(m, 1, 2, 'S', squares), true);
  assert.deepEqual(find(m, 'S'), [[1, 2]], 'the start moved');
  assert.equal(m.rows[1][1], '.', 'and left floor behind');
  assert.equal(paint(m, 1, 2, 'S', squares), false, 'painting what is there changes nothing');
  assert.equal(paint(m, 9, 9, '#', squares), false, 'off the grid');
  assert.equal(paint(m, 1, 1, 'x', squares), false, 'not a kind of square this game has');
  assert.equal(paint(m, 1, 1, 'b', squares), true, 'a made-up kind is painted like the six');
  assert.equal(addRow(m), true);
  assert.deepEqual(levelShape(m), { rows: 4, cols: 5, coins: 0 });
  assert.equal(m.rows[3].join(''), '.....', 'a new row is floor');
  assert.equal(addColumn(m), true);
  assert.equal(m.rows[0].length, 6);
  assert.equal(removeColumn(m), true);
  assert.equal(removeRow(m), true);
  const [small] = one(['###', '#S#', '###']);
  assert.equal(removeRow(small), false, `never below ${MIN_SIDE}`);
  assert.equal(removeColumn(small), false);
});

test('a new level is one the ball can already finish, and the list is never empty', () => {
  const m = model([['#####', '#S.G#', '#####']]);
  assert.equal(addLevel(m, 0), 1);
  assert.deepEqual(levelChecks(m.levels[1], m.squares), []);
  assert.equal(duplicateLevel(m, 0), 1, 'a copy lands right after');
  m.levels[1].rows[1][2] = '#';
  assert.equal(m.levels[0].rows[1][2], '.', 'and is its own grid, not the same one');
  assert.equal(m.levels.length, 3);
  assert.equal(moveLevel(m, 2, -1), 1);
  assert.equal(moveLevel(m, 0, -1), null, 'nothing before the first');
  assert.equal(deleteLevel(m, 2), 1, 'the one before it is next');
  assert.equal(deleteLevel(m, 0), 0);
  assert.equal(deleteLevel(m, 0), null, 'the last one stays');
  assert.equal(m.levels.length, 1);
});

test('a made-up kind takes the next free letter, and goes only when nothing is painted with it', () => {
  const m = model([['#####', '#SaG#', '#####']], { a: BOMB });
  const ch = addSquare(m);
  assert.equal(ch, 'b', 'a is taken');
  assert.equal(m.squares.b.solid, false);
  assert.equal(usesOf(m, 'a'), 1);
  assert.equal(deleteSquare(m, 'a'), false, 'painted on a square');
  assert.equal(deleteSquare(m, 'b'), true);
  assert.equal('b' in m.squares, false);
  const full = model([['#S.G#']]);
  let added = 0;
  while (addSquare(full)) added += 1;
  assert.equal(added, 49, 'every letter but o, S and G');
  assert.equal(levelModel(levelText(full)).ok, true, 'and every one of them reads back');
});
