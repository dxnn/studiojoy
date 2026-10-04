// The physics library: the studio's façade over planck.js, loaded the way a
// game page loads it — two classic scripts in one global scope — and run
// here under Node, since nothing in it touches the page. What is held: it
// speaks the game's pixels and degrees, a tower stands and comes to rest, the
// clock is fixed whatever the frame rate, and a hit is reported after the step
// with how hard it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(new URL(`../public/studio-lib/physics/${rel}`, import.meta.url), 'utf8');
const PLANCK = read('planck.min.js');
const PHYSICS = read('physics.js');

function load() {
  const warnings = [];
  const ctx = vm.createContext({ console: { warn: (...a) => warnings.push(a.join(' ')) } });
  vm.runInContext(PLANCK, ctx);
  vm.runInContext(`${PHYSICS}\nthis.Physics = Physics;`, ctx);
  return { Physics: ctx.Physics, warnings };
}

// The page with State on it too (studio/state.js), as every game has now.
function loadWithState() {
  const ctx = vm.createContext({ console: { warn() {} } });
  vm.runInContext(PLANCK, ctx);
  vm.runInContext(fs.readFileSync(new URL('../public/studio-lib/state/state.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(`${PHYSICS}\nthis.Physics = Physics; this.State = State;`, ctx);
  return { Physics: ctx.Physics, State: ctx.State };
}

const settle = (Physics, seconds, dt = 1 / 60) => {
  for (let i = Math.round(seconds / dt); i > 0; i -= 1) Physics.step(dt);
};

const GROUND = { kind: 'block', at: [480, 590], size: [960, 20], still: true };

test('a body is built from a config entry, in pixels and degrees, keeping its own keys', () => {
  const { Physics } = load();
  Physics.world({});
  const [ground, box, ball] = Physics.build([
    GROUND,
    { kind: 'box', at: [300, 200], size: [40, 20], angle: 90, colour: 'red' },
    { kind: 'ball', at: [500, 100], size: 12 },
  ]);
  assert.equal(ground.still, true);
  assert.equal(box.kind, 'box');
  assert.equal(box.thing.colour, 'red', 'the game\'s own keys ride along');
  assert.deepEqual([box.x, box.y, box.w, box.h], [300, 200, 40, 20]);
  assert.ok(Math.abs(box.angle - Math.PI / 2) < 1e-9, 'degrees in, radians out');
  assert.equal(ball.r, 12);
  assert.equal(Physics.at(300, 215), box, 'a turned box, hit in its own frame');
  assert.equal(Physics.at(500, 105), ball);
  assert.equal(Physics.at(10, 10), null);
});

// A pin in the preview is State.save(); the bodies have to come back with it,
// a removed one included, moving the way they were.
test('every body rides in a State save and comes back where it was', () => {
  const { Physics, State } = loadWithState();
  Physics.world({ gravity: 900 });
  Physics.build([GROUND, { kind: 'target', at: [700, 560], size: 14 }]);
  const ball = Physics.add({ kind: 'shot', at: [100, 400], size: 10 });
  Physics.fling(ball, 500, -300);
  settle(Physics, 0.25);
  const file = State.save();
  const was = Physics.all().map((b) => [b.kind, Math.round(b.x), Math.round(b.y)]);

  settle(Physics, 1);
  Physics.remove(Physics.all().find((b) => b.kind === 'target'));
  State.load(file);
  assert.deepEqual(Physics.all().map((b) => [b.kind, Math.round(b.x), Math.round(b.y)]), was);
  const shot = Physics.all().find((b) => b.kind === 'shot');
  assert.ok(shot.vx > 400, `still flying: vx ${shot.vx}`);
  assert.notEqual(shot, ball, 'a new body — the old one is gone with the old world');
});

test('tune changes the world\'s feel live, without building it again', () => {
  const { Physics } = load();
  Physics.world({ gravity: 900 });
  const [ball] = Physics.build([{ kind: 'ball', at: [100, 0], size: 5 }]);
  settle(Physics, 0.5);
  const heavy = ball.y;
  Physics.world({ gravity: 900 });
  const [again] = Physics.build([{ kind: 'ball', at: [100, 0], size: 5 }]);
  Physics.tune({ gravity: 300 });
  settle(Physics, 0.5);
  assert.ok(again.y < heavy / 2, `a third of the gravity falls a third as far: ${again.y} vs ${heavy}`);
});

test('a tower stands, comes to rest, and the world says so', () => {
  const { Physics } = load();
  Physics.world({ gravity: 900 });
  const boxes = Physics.build([GROUND, ...Array.from({ length: 8 }, (_, i) => (
    { kind: 'box', at: [480, 560 - i * 40.5], size: [40, 40] }
  ))]).slice(1);
  assert.equal(Physics.moving(), false, 'nothing has moved yet');
  settle(Physics, 6);
  const top = boxes[boxes.length - 1];
  assert.ok(Math.abs(top.x - 480) < 1, `the top box stayed put: x ${top.x}`);
  assert.ok(boxes.every((b) => b.asleep), 'and everything went to sleep');
  assert.equal(Physics.moving(), false);
});

test('the clock is fixed: one long frame and many short ones fall the same way', () => {
  const drop = (dt) => {
    const { Physics } = load();
    Physics.world({});
    const [, ball] = Physics.build([GROUND, { kind: 'ball', at: [480, 100], size: 10 }]);
    settle(Physics, 0.5, dt);
    return ball.y;
  };
  assert.ok(Math.abs(drop(1 / 60) - drop(1 / 30)) < 0.5);
});

test('a hit is told after the step, with how hard, and may change the world', () => {
  const { Physics } = load();
  Physics.world({});
  const seen = [];
  Physics.onHit((a, b, speed) => {
    seen.push([a.kind, b.kind, speed].sort());
    // Removing inside a step would crash planck; after one it is fine.
    if (a.kind === 'ball') Physics.remove(a);
    if (b.kind === 'ball') Physics.remove(b);
  });
  const [, ball] = Physics.build([GROUND, { kind: 'ball', at: [480, 300], size: 10 }]);
  Physics.fling(ball, 0, 800);
  settle(Physics, 1);
  assert.equal(seen.length, 1, 'one hit');
  const speed = seen[0].find((x) => typeof x === 'number');
  assert.ok(speed > 800, `it met the ground hard: ${speed}`);
  assert.equal(Physics.all().length, 1, 'the ball is gone, the ground stays');
});

test('a still body never moves, and clear empties the world', () => {
  const { Physics } = load();
  Physics.world({});
  const [ground] = Physics.build([GROUND]);
  Physics.fling(ground, 500, 0);
  settle(Physics, 1);
  assert.deepEqual([ground.x, ground.y], [480, 590]);
  Physics.clear();
  assert.equal(Physics.all().length, 0);
});

test('a body without a place is refused with a word, not an error', () => {
  const { Physics, warnings } = load();
  Physics.world({});
  assert.equal(Physics.add({ kind: 'box', size: [10, 10] }), null);
  assert.match(warnings.join('\n'), /needs `at/);
});
