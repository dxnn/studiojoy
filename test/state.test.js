// The state library (studio/state.js): everything that changes while a game is
// played, in one object, with five calls hidden from the data. Run in a vm the
// way a game page runs it — a classic script whose `const State` the rest of
// the page reaches by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../public/studio-lib/state/state.js', import.meta.url), 'utf8');

function page() {
  const warnings = [];
  const sandbox = { console: { warn: (m) => warnings.push(m) } };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  // Out of the page's realm as plain data, so a strict compare is not tripped
  // by the vm's own Array.prototype.
  const run = (code) => {
    const value = vm.runInContext(code, sandbox);
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  };
  return { run, warnings, State: vm.runInContext('State', sandbox) };
}

test('a run is the object itself, and the calls are not part of it', () => {
  const { State, run } = page();
  State.reset({ score: 0, ship: { x: 480 } });
  run('State.score += 10; State.ship.x -= 5;');
  assert.equal(State.score, 10);
  assert.deepEqual(run('Object.keys(State)'), ['score', 'ship']);
  assert.equal(run('JSON.stringify(State)'), '{"score":10,"ship":{"x":475}}');
  State.reset({ lives: 3 });
  assert.deepEqual(run('Object.keys(State)'), ['lives'], 'a new run leaves nothing of the last behind');
});

test('a save is text, and a load puts the whole of it back', () => {
  const { State, run } = page();
  State.reset({ score: 5, rocks: [{ x: 1 }, { x: 2 }] });
  const file = State.save();
  assert.equal(typeof file, 'string');
  run('State.score = 99; State.rocks.pop(); State.extra = true; var kept = State.rocks;');
  assert.equal(State.load(file), true);
  assert.equal(State.score, 5);
  assert.equal(run('State.rocks.length'), 2);
  assert.equal(run('"extra" in State'), false, 'what the save did not hold goes');
  assert.equal(run('State.rocks === kept'), false, 'the pieces are new, so a piece kept aside is left behind');
});

test('whoever asked is told after a load, and a library keeps its part beside the game\'s', () => {
  const { State, run } = page();
  run(`
    var heard = 0, bodies = [{ x: 1 }];
    State.loaded(function () { heard += 1; });
    State.include("physics", function () { return bodies.map(function (b) { return b.x; }); },
      function (xs) { bodies = xs.map(function (x) { return { x: x }; }); });
  `);
  State.reset({ shots: 3 });
  const file = State.save();
  assert.deepEqual(JSON.parse(file), { state: { shots: 3 }, parts: { physics: [1] } });
  run('bodies = []');
  State.load(file);
  assert.deepEqual(run('bodies'), [{ x: 1 }]);
  assert.equal(run('heard'), 1);
});

test('its own names are not fields, and what will not save says so once', () => {
  const { State, run, warnings } = page();
  State.reset({ save: 1, score: 2 });
  assert.deepEqual(run('Object.keys(State)'), ['score']);
  assert.equal(typeof State.save, 'function', 'the call is still the call');
  run('State.loop = {}; State.loop.self = State.loop; 0');
  assert.equal(State.save(), null);
  assert.equal(State.load('not a save'), false);
  assert.equal(warnings.length, 3);
});
