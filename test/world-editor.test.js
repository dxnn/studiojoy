// The world editor's model: config/bodies.js read without running it, written
// back byte for byte, and the checks only a whole world can make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  worldModel, worldText, worldChecks, worldShape, overlap, contains, hitAt, handleOf,
  addBody, moveBody, resizeBody, setAngle, setKind, setSize, removeBody, moveSling,
  isWorldPath, MANY,
} from '../public/world-editor.js';

const text = (bodies, sling = [150, 440]) => worldText({ bodies, sling });
const GROUND = { kind: 'block', at: [480, 580], size: [960, 40], angle: 0 };
const TARGET = { kind: 'target', at: [700, 542], size: 18 };

test('the file is its own path and nothing else', () => {
  assert.equal(isWorldPath('config/bodies.js'), true);
  assert.equal(isWorldPath('config/world.js'), false);
});

test('a world reads and writes back byte for byte', () => {
  const src = text([GROUND, TARGET, { kind: 'box', at: [300, 540], size: [40, 40], angle: -15 }]);
  const model = worldModel(src);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.sling, [150, 440]);
  assert.equal(model.bodies[2].angle, -15);
  assert.equal(worldText(model), src);
});

test('anything past the shape declines, so the file falls back to the form', () => {
  const grown = (s) => assert.equal(worldModel(s).ok, false, s);
  grown(text([GROUND]).replace('angle: 0 }', 'angle: 0, colour: "red" }'));
  grown(text([TARGET]).replace('size: 18 }', 'size: 18, angle: 0 }'), 'a round thing has no angle');
  grown(text([{ ...GROUND, kind: 'plank' }]));
  grown(text([GROUND]).replace('[480, 580]', '[480.5, 580]'));
  grown(`${text([GROUND])}const MORE = 1;\n`);
  grown(text([GROUND]).replace('const SLING = { at: [150, 440] };', 'const SLING = { at: [150, 440], power: 2 };'));
});

test('overlap: touching is not inside, and each pair of shapes is measured', () => {
  const box = (x, y, w = 40, h = 40, angle = 0) => ({ kind: 'box', at: [x, y], size: [w, h], angle });
  const ball = (x, y, r = 10) => ({ kind: 'ball', at: [x, y], size: r });
  assert.equal(overlap(box(100, 100), box(140, 100)), 0, 'side by side');
  assert.ok(overlap(box(100, 100), box(130, 100)) > 9);
  assert.equal(overlap(box(100, 100), box(160, 100, 40, 40, 45)), 0, 'a turned one clear of it');
  assert.ok(overlap(box(100, 100), box(145, 100, 40, 40, 45)) > 1, 'a turned one poking in');
  assert.equal(overlap(ball(100, 100), ball(120, 100)), 0);
  assert.ok(overlap(ball(100, 100), ball(110, 100)) > 9);
  assert.equal(overlap(ball(100, 70), box(100, 100)), 0, 'a ball sitting on a box');
  assert.ok(overlap(ball(100, 85), box(100, 100)) > 4);
  assert.ok(overlap(ball(100, 100, 5), box(100, 100)) > 5, 'a ball right inside');
});

test('contains: a turned box is hit in its own frame', () => {
  const b = { kind: 'box', at: [100, 100], size: [100, 10], angle: 90 };
  assert.equal(contains(b, 100, 140), true);
  assert.equal(contains(b, 140, 100), false);
});

test('the checks say what only the whole world can', () => {
  assert.deepEqual(worldChecks({ bodies: [GROUND, TARGET], sling: [150, 440] }), []);
  const say = (bodies, sling = [150, 440]) => worldChecks({ bodies, sling }).join('\n');
  assert.match(say([GROUND]), /nothing to knock down/);
  assert.match(say([TARGET]), /Nothing is still/);
  assert.match(say([GROUND, TARGET, { kind: 'box', at: [950, 300], size: [40, 40], angle: 0 }]), /past the edge/);
  assert.match(say([GROUND, TARGET, { kind: 'ball', at: [700, 550], size: 16 }]), /start inside each other/);
  assert.match(say([GROUND, TARGET], [480, 580]), /sling is inside something/);
  const crowd = Array.from({ length: MANY }, (_, i) => ({ kind: 'ball', at: [20 + (i % 20) * 44, 100 + Math.floor(i / 20) * 44], size: 20 }));
  assert.match(say([GROUND, TARGET, ...crowd]), /phone starts to crawl/);
  // Two blocks may overlap: neither moves.
  assert.deepEqual(worldChecks({ bodies: [GROUND, TARGET, { kind: 'block', at: [300, 560], size: [100, 20], angle: 0 }], sling: [150, 440] }), []);
});

test('the pointer finds the size handle, then the sling, then the topmost body', () => {
  const model = { bodies: [GROUND, { kind: 'box', at: [480, 540], size: [40, 40], angle: 0 }], sling: [150, 440] };
  assert.deepEqual(hitAt(model, 480, 540), { kind: 'body', index: 1 }, 'the box drawn over the ground');
  assert.deepEqual(hitAt(model, 150, 445), { kind: 'sling' });
  const [hx, hy] = handleOf(model.bodies[1]);
  assert.deepEqual(hitAt(model, hx, hy, 14, 1), { kind: 'size', index: 1 });
  assert.equal(hitAt(model, 480, 100), null);
});

test('changes keep the world whole numbers inside the world', () => {
  const model = { bodies: [], sling: [150, 440] };
  const i = addBody(model, 'box', 300.4, 200.6);
  assert.deepEqual(model.bodies[i], { kind: 'box', at: [300, 201], size: [40, 40], angle: 0 });
  moveBody(model, i, -50, 9999);
  assert.deepEqual(model.bodies[i].at, [0, 600]);
  moveBody(model, i, 300, 200);
  resizeBody(model, i, 330, 210);
  assert.deepEqual(model.bodies[i].size, [60, 20]);
  setAngle(model, i, 270);
  assert.equal(model.bodies[i].angle, -90, 'the short way round');
  setKind(model, i, 'target');
  assert.deepEqual(model.bodies[i], { kind: 'target', at: [300, 200], size: 18 }, 'a round thing gets a round size');
  setSize(model, i, 2);
  assert.equal(model.bodies[i].size, 6, 'never too small to grab');
  moveSling(model, 10.2, 20.7);
  assert.deepEqual(model.sling, [10, 21]);
  removeBody(model, i);
  assert.deepEqual(worldShape(model), { things: 0, targets: 0 });
  assert.equal(addBody(model, 'plank', 0, 0), -1);
});
