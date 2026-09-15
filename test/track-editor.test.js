// The track editor's model layer: what it reads, what it declines, that
// opening the shipped template and saving changes nothing, the geometry the
// editor and the game agree on, the pointer's hit test, and the things only
// the whole track can say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  trackModel, trackText, trackChecks, trackShape, isTrackPath, TRACK_FILE,
  segments, trackLength, nearestOnTrack, crossings, shortSegments, onRoad,
  movePoint, insertPoint, removePoint, setStart, setWidth, addThing, moveThing, removeThing,
  hitAt, WORLD, SIZES, MIN_POINTS,
} from '../public/track-editor.js';

const TEMPLATE = fs.readFileSync(new URL('../public/game-templates/racing/config/track.js', import.meta.url), 'utf8');

const shipped = () => {
  const m = trackModel(TEMPLATE);
  assert.equal(m.ok, true, m.reason);
  return {
    width: m.width, points: m.points, start: m.start, things: m.things,
  };
};

test('only config/track.js is a track', () => {
  assert.equal(isTrackPath(TRACK_FILE), true);
  assert.equal(isTrackPath('config/play.js'), false);
});

test('the template reads, has nothing to look at, and writes back byte for byte', () => {
  const model = shipped();
  assert.equal(model.width, 90);
  assert.equal(model.points.length, 6);
  assert.equal(model.start, 0);
  assert.deepEqual(model.things.map((t) => t.kind), ['rock', 'boost', 'puddle']);
  assert.equal(trackText(model), TEMPLATE);
  assert.deepEqual(trackChecks(model), []);
  assert.deepEqual(trackChecks(model, { RIVAL_SPEED: 230, COUNTDOWN: 3 }), []);
  assert.deepEqual(trackShape(model), { points: 6, things: 3, length: Math.round(trackLength(model.points)) });
  // The world it is drawn in is the game's canvas.
  for (const [x, y] of model.points) {
    assert.ok(x >= 0 && x <= WORLD.width && y >= 0 && y <= WORLD.height);
  }
});

test('edits round-trip', () => {
  const model = shipped();
  model.width = 120;
  model.start = 3;
  model.points.push([10, 590]);
  model.things.push({ kind: 'puddle', at: [0, 0], size: 50 });
  const again = trackModel(trackText(model));
  assert.equal(again.ok, true, again.reason);
  assert.deepEqual(again, { ok: true, ...model });
});

test('the shape is held: anything else declines with a reason', () => {
  const grown = (text) => {
    const m = trackModel(text);
    assert.equal(m.ok, false);
    return m.reason;
  };
  const track = (body, things = '') => `const TRACK = {\n${body}\n};\nconst THINGS = [${things}];\n`;
  // A point is two whole numbers.
  assert.match(grown(track('  width: 90,\n  points: [[1, 2, 3]],\n  start: 0,')), /grown/);
  assert.match(grown(track('  width: 90,\n  points: [[1.5, 2]],\n  start: 0,')), /grown/);
  // The start names a point that exists.
  assert.match(grown(track('  width: 90,\n  points: [[1, 2], [3, 4], [5, 6]],\n  start: 3,')), /grown/);
  // A key the shape does not know, on the track or on a thing.
  assert.match(grown(track('  width: 90,\n  points: [[1, 2]],\n  start: 0,\n  laps: 3,')), /grown/);
  assert.match(grown(track('  width: 90,\n  points: [[1, 2]],\n  start: 0,', '{ kind: "rock", at: [1, 2], size: 3, speed: 1 }')), /grown/);
  // A thing of a kind the game does not draw.
  assert.match(grown(track('  width: 90,\n  points: [[1, 2]],\n  start: 0,', '{ kind: "tree", at: [1, 2], size: 3 }')), /grown/);
  // A second track is somebody else's file.
  assert.match(grown('const TRACK = { width: 90, points: [], start: 0 };\nconst THINGS = [];\nconst TRACKS = [];\n'), /grown/);
});

test('the geometry: a closed loop, measured once', () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const segs = segments(square);
  assert.equal(segs.length, 4);
  assert.equal(segs[3].bx, 0, 'the last segment closes back to the first point');
  assert.equal(trackLength(square), 400);
  // The nearest point on the road, and how far round the loop it sits.
  const near = nearestOnTrack(square, 50, -10);
  assert.equal(near.seg, 0);
  assert.equal(near.dist, 10);
  assert.equal(near.along, 50);
  const later = nearestOnTrack(square, 110, 60);
  assert.equal(later.seg, 1);
  assert.equal(later.along, 160);
  // Crossings: a figure of eight crosses once; a square never.
  assert.deepEqual(crossings(square), []);
  assert.deepEqual(crossings([[0, 0], [100, 100], [100, 0], [0, 100]]), [[0, 2]]);
  // A kink: a segment shorter than the road is wide.
  assert.deepEqual(shortSegments([[0, 0], [10, 0], [100, 100], [0, 100]], 40), [0]);
  // On the road is within half the width of the middle line.
  const model = { width: 40, points: square };
  assert.equal(onRoad({ at: [50, 15] }, model), true);
  assert.equal(onRoad({ at: [50, 25] }, model), false);
});

test('moving, adding and removing points keeps the start where it was', () => {
  const model = shipped();
  setStart(model, 4);
  movePoint(model, 0, -50, 700);
  assert.deepEqual(model.points[0], [0, 600], 'clamped to the world and rounded');
  // A point inserted on segment 1 lands after point 1 and the start follows.
  const at = insertPoint(model, 1, 500.4, 118.6);
  assert.equal(at, 2);
  assert.deepEqual(model.points[2], [500, 119]);
  assert.equal(model.start, 5);
  assert.equal(removePoint(model, 2), true);
  assert.equal(model.start, 4);
  // Removing the start point puts the line back on the first.
  assert.equal(removePoint(model, 4), true);
  assert.equal(model.start, 0);
  // Never below three.
  const tiny = { width: 90, points: [[0, 0], [100, 0], [50, 100]], start: 0, things: [] };
  assert.equal(removePoint(tiny, 0), false);
  assert.equal(tiny.points.length, MIN_POINTS);
  setWidth(model, 5);
  assert.equal(model.width, 30, 'no thinner than a car');
  setWidth(model, 'lots');
  assert.equal(model.width, 30);
});

test('things are dropped at their kind\'s size and moved whole', () => {
  const model = shipped();
  assert.equal(addThing(model, 'tree', 0, 0), -1);
  const i = addThing(model, 'rock', 100.6, 200.2);
  assert.deepEqual(model.things[i], { kind: 'rock', at: [101, 200], size: SIZES.rock });
  moveThing(model, i, 300, 120);
  assert.deepEqual(model.things[i].at, [300, 120]);
  removeThing(model, i);
  assert.equal(model.things.length, 3);
});

test('the pointer finds a handle first, then a thing, then the road', () => {
  const model = shipped();
  assert.deepEqual(hitAt(model, 122, 298), { kind: 'point', index: 0 });
  assert.deepEqual(hitAt(model, 500, 140), { kind: 'thing', index: 0 });
  const road = hitAt(model, 450, 470);
  assert.equal(road.kind, 'road');
  assert.equal(road.seg, 4);
  assert.deepEqual(hitAt(model, 500, 470), { kind: 'thing', index: 1 }, 'the edge of the boost pad is the pad');
  assert.equal(hitAt(model, 480, 300), null, 'the middle of the loop is grass');
});

test('the checks say what one field cannot', () => {
  const model = shipped();
  // Drag a point across the loop: the road crosses itself.
  movePoint(model, 1, 700, 520);
  const crossed = trackChecks(model);
  assert.ok(crossed.some((s) => /crosses itself, between points 1 and 5/.test(s)), crossed.join(' | '));
  // A kink, a thing on the grass, and a very short track.
  // Three points a car's length apart: 239 pixels round, where a rival at
  // 230 a second covers 690 during a three-second countdown.
  const small = {
    width: 90, points: [[100, 100], [130, 100], [200, 160]], start: 0,
    things: [{ kind: 'rock', at: [800, 550], size: 22 }],
  };
  const said = trackChecks(small, { RIVAL_SPEED: 230, COUNTDOWN: 3 });
  assert.ok(said.some((s) => /Points 1 and 2 are closer together/.test(s)));
  assert.ok(said.some((s) => /The rock at 800, 550 is off the road/.test(s)));
  assert.ok(said.some((s) => /lap it before the countdown/.test(s)));
  // Without the game's numbers the last one cannot be said, and is not.
  assert.ok(!trackChecks(small).some((s) => /countdown/.test(s)));
  assert.ok(trackChecks({ ...small, points: small.points.slice(0, 2) }).some((s) => /at least 3 points/.test(s)));
});
