// The level editor's model: config/level.js read without running it, written
// back byte for byte, and the checks only a whole level can make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelModel, levelText, levelChecks, levelShape, paint, addRow, removeRow,
  addColumn, removeColumn, reachable, find, isLevelPath, MAX_SIDE, MIN_SIDE,
} from '../public/level-editor.js';

const text = (lines) => levelText({ rows: lines.map((l) => [...l]) });
const model = (lines) => levelModel(text(lines));

test('the file is its own path and nothing else', () => {
  assert.equal(isLevelPath('config/level.js'), true);
  assert.equal(isLevelPath('config/world.js'), false);
});

test('a level reads and writes back byte for byte', () => {
  const src = text(['#####', '#S G#', '#.o.#', '#####']);
  const m = levelModel(src);
  assert.equal(m.ok, true, m.reason);
  assert.equal(m.rows[1][2], ' ', 'a space is a hole');
  assert.equal(levelText(m), src);
});

test('a short row is padded with holes, as a trimmed line would be', () => {
  const m = levelModel('const LEVEL = [\n  "####",\n  "#S",\n];\n');
  assert.equal(m.ok, true);
  assert.deepEqual(m.rows[1], ['#', 'S', ' ', ' ']);
});

test('anything past the shape declines', () => {
  const grown = (s) => assert.equal(levelModel(s).ok, false, s);
  grown('const LEVEL = ["#x#"];\n');
  grown('const LEVEL = [1, 2];\n');
  grown('const LEVEL = [];\n');
  grown('const LEVEL = [""];\n');
  grown('const LEVEL = ["###"];\nconst MORE = 1;\n');
  grown('const MAZE = ["###"];\n');
});

test('reachable rolls four ways, never through a wall or over a hole', () => {
  const m = model(['#####', '#S# #', '#.  #', '#o..#', '#####']);
  const can = reachable(m);
  assert.ok(can.has('3,1'), 'down the side');
  assert.ok(can.has('3,3'));
  assert.ok(!can.has('1,3'), 'a hole is never a way on');
  assert.ok(!can.has('0,0'));
});

test('the checks say what only the whole level can', () => {
  assert.deepEqual(levelChecks(model(['#####', '#S.G#', '#####'])), []);
  const say = (lines) => levelChecks(model(lines)).join('\n');
  assert.match(say(['#####', '#..G#', '#####']), /nowhere for the ball to start/);
  assert.match(say(['#####', '#S..#', '#####']), /no goal/);
  assert.match(say(['#####', '#S#G#', '#####']), /cannot roll from the start to the goal/);
  assert.match(say(['#####', '#S G#', '#####']), /cannot roll from the start to the goal/, 'a hole is in the way too');
  assert.match(say(['######', '#S.G#o', '######']), /A coin is where the ball cannot roll/);
  const wide = '#'.repeat(MAX_SIDE + 1);
  assert.match(say([wide, `#S.G${'.'.repeat(MAX_SIDE - 4)}#`, wide]), /phone starts to crawl/);
});

test('painting keeps one start and one goal, and the grid stays in bounds', () => {
  const m = model(['#####', '#S.G#', '#####']);
  assert.equal(paint(m, 1, 2, 'S'), true);
  assert.deepEqual(find(m, 'S'), [[1, 2]], 'the start moved');
  assert.equal(m.rows[1][1], '.', 'and left floor behind');
  assert.equal(paint(m, 1, 2, 'S'), false, 'painting what is there changes nothing');
  assert.equal(paint(m, 9, 9, '#'), false, 'off the grid');
  assert.equal(paint(m, 1, 1, 'x'), false, 'not a kind of square');
  assert.equal(addRow(m), true);
  assert.deepEqual(levelShape(m), { rows: 4, cols: 5, coins: 0 });
  assert.equal(m.rows[3].join(''), '.....', 'a new row is floor');
  assert.equal(addColumn(m), true);
  assert.equal(m.rows[0].length, 6);
  assert.equal(removeColumn(m), true);
  assert.equal(removeRow(m), true);
  const small = model(['###', '#S#', '###']);
  assert.equal(removeRow(small), false, `never below ${MIN_SIDE}`);
  assert.equal(removeColumn(small), false);
});
