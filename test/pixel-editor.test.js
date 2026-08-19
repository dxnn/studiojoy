// The drawing tools, which are arithmetic over bytes and need no canvas. What
// a canvas does with the result — showing it, and turning it into a PNG — is
// the browser's job and is checked there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, SIZES, BRUSHES, MAX_SIDE, UNDO_BYTES, CLEAR,
  blankPicture, copyPicture, pixelAt, setPixel, stamp, drawLine, floodFill,
  rgbaOf, hexOf, isBlank, clampSide,
} from '../public/pixel-editor.js';

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

// Every pixel that is not transparent, as "x,y" — the shape of a drawing
// without caring what colour it came out.
const marks = (picture) => {
  const out = [];
  for (let y = 0; y < picture.height; y += 1) {
    for (let x = 0; x < picture.width; x += 1) if (pixelAt(picture, x, y)[3] !== 0) out.push(`${x},${y}`);
  }
  return out;
};

test('a new picture is the size asked for and completely see-through', () => {
  const picture = blankPicture(8, 5);
  assert.equal(picture.data.length, 8 * 5 * 4);
  assert.equal(isBlank(picture), true);
  assert.deepEqual(pixelAt(picture, 3, 3), [0, 0, 0, 0]);
});

test('a pixel outside the picture is nothing, and drawing there changes nothing', () => {
  const picture = blankPicture(4, 4);
  assert.equal(pixelAt(picture, 4, 0), null);
  assert.equal(pixelAt(picture, -1, 0), null);
  assert.equal(setPixel(picture, 4, 0, RED), false);
  assert.equal(isBlank(picture), true);
});

test('drawing the colour that is already there is not a change', () => {
  const picture = blankPicture(4, 4);
  assert.equal(setPixel(picture, 1, 1, RED), true);
  assert.equal(setPixel(picture, 1, 1, RED), false);
  assert.equal(setPixel(picture, 1, 1, BLUE), true);
});

// Two transparent pixels look the same whatever colour is behind them, so
// rubbing out an already-empty pixel must not count as a change.
test('rubbing out an empty pixel is not a change', () => {
  const picture = blankPicture(4, 4);
  assert.equal(setPixel(picture, 1, 1, CLEAR), false);
  setPixel(picture, 1, 1, RED);
  assert.equal(setPixel(picture, 1, 1, CLEAR), true);
  assert.equal(setPixel(picture, 1, 1, [9, 9, 9, 0]), false);
});

test('a line joins up the dots a fast hand skips', () => {
  const picture = blankPicture(5, 5);
  const changed = drawLine(picture, 0, 0, 4, 4, RED);
  assert.equal(changed, 5);
  assert.deepEqual(marks(picture), ['0,0', '1,1', '2,2', '3,3', '4,4']);
});

test('a line that goes nowhere is one pixel', () => {
  const picture = blankPicture(5, 5);
  assert.equal(drawLine(picture, 2, 3, 2, 3, RED), 1);
  assert.deepEqual(marks(picture), ['2,3']);
});

test('a line has no gaps whichever way it runs', () => {
  for (const [x0, y0, x1, y1] of [[0, 0, 4, 1], [4, 1, 0, 0], [0, 4, 3, 0], [2, 0, 2, 4]]) {
    const picture = blankPicture(5, 5);
    drawLine(picture, x0, y0, x1, y1, RED);
    const drawn = marks(picture).map((m) => m.split(',').map(Number));
    for (let i = 1; i < drawn.length; i += 1) {
      const step = Math.max(
        Math.abs(drawn[i][0] - drawn[i - 1][0]),
        Math.abs(drawn[i][1] - drawn[i - 1][1]),
      );
      assert.equal(step <= 1, true, `gap between ${drawn[i - 1]} and ${drawn[i]}`);
    }
    assert.deepEqual(pixelAt(picture, x0, y0).slice(0, 3), RED.slice(0, 3));
    assert.deepEqual(pixelAt(picture, x1, y1).slice(0, 3), RED.slice(0, 3));
  }
});

test('a fill stops at a wall', () => {
  const picture = blankPicture(5, 5);
  for (let y = 0; y < 5; y += 1) setPixel(picture, 2, y, BLUE);
  const changed = floodFill(picture, 0, 0, RED);
  assert.equal(changed, 10, 'the two columns left of the wall');
  assert.deepEqual(pixelAt(picture, 1, 4), RED);
  assert.deepEqual(pixelAt(picture, 3, 0), [0, 0, 0, 0], 'the far side is untouched');
});

test('a fill of a see-through picture fills all of it', () => {
  const picture = blankPicture(6, 6);
  assert.equal(floodFill(picture, 3, 3, RED), 36);
  assert.equal(isBlank(picture), false);
});

test('filling with the colour already there does nothing at all', () => {
  const picture = blankPicture(6, 6);
  floodFill(picture, 0, 0, RED);
  const before = copyPicture(picture);
  assert.equal(floodFill(picture, 0, 0, RED), 0);
  assert.deepEqual([...picture.data], [...before.data]);
});

test('a fill outside the picture is not a crash', () => {
  const picture = blankPicture(4, 4);
  assert.equal(floodFill(picture, 9, 9, RED), 0);
});

test('a copy is a copy, not the same bytes under a new name', () => {
  const picture = blankPicture(4, 4);
  const before = copyPicture(picture);
  setPixel(picture, 0, 0, RED);
  assert.equal(isBlank(before), true);
});

test('colours survive the trip to text and back', () => {
  assert.deepEqual(rgbaOf('#ff8a3d'), [255, 138, 61, 255]);
  assert.deepEqual(rgbaOf('#abc'), [170, 187, 204, 255]);
  assert.deepEqual(rgbaOf('#00000000'), [0, 0, 0, 0]);
  assert.equal(hexOf([255, 138, 61, 255]), '#ff8a3d');
  assert.equal(hexOf([0, 0, 0, 255]), '#000000');
  for (const hex of PALETTE) assert.equal(hexOf(rgbaOf(hex)), hex);
});

test('a size is brought back to one a picture can be', () => {
  assert.equal(clampSide(0), 1);
  assert.equal(clampSide(-30), 1);
  assert.equal(clampSide(MAX_SIDE + 1), MAX_SIDE);
  assert.equal(clampSide(99999), MAX_SIDE);
  assert.equal(clampSide('32'), 32);
  assert.equal(clampSide('what'), 1);
  assert.equal(clampSide(16.4), 16);
  for (const size of SIZES) assert.equal(clampSide(size), size);
  assert.equal(SIZES.every((n) => n <= MAX_SIDE), true, 'every offered size fits');
});

test('a wide brush paints a square, and one pixel paints one pixel', () => {
  const picture = blankPicture(9, 9);
  assert.equal(stamp(picture, 4, 4, RED), 1);
  assert.deepEqual(marks(picture), ['4,4']);

  const wide = blankPicture(9, 9);
  assert.equal(stamp(wide, 4, 4, RED, 3), 9);
  assert.deepEqual(marks(wide), [
    '3,3', '4,3', '5,3',
    '3,4', '4,4', '5,4',
    '3,5', '4,5', '5,5',
  ]);
});

test('every brush on offer paints its own size', () => {
  for (const size of BRUSHES) {
    const picture = blankPicture(MAX_SIDE > 64 ? 80 : MAX_SIDE, 80);
    const painted = stamp(picture, 40, 40, RED, size);
    assert.equal(painted, size * size, `brush ${size}`);
  }
});

test('a brush at the edge paints only what is on the picture', () => {
  const picture = blankPicture(4, 4);
  assert.equal(stamp(picture, 0, 0, RED, 3), 4, 'the quarter of it that is inside');
  assert.deepEqual(marks(picture), ['0,0', '1,0', '0,1', '1,1']);
});

test('a wide line is a wide line, not a wide dot', () => {
  const picture = blankPicture(12, 12);
  drawLine(picture, 2, 6, 9, 6, RED, 3);
  // Three rows deep for its whole length, and nothing outside them.
  for (const y of [5, 6, 7]) {
    for (let x = 1; x <= 10; x += 1) assert.equal(pixelAt(picture, x, y)[3], 255, `${x},${y}`);
  }
  assert.equal(pixelAt(picture, 6, 4)[3], 0);
  assert.equal(pixelAt(picture, 6, 8)[3], 0);
});

// A step back is a whole copy of the picture, so a fixed number of steps
// would be a fixed multiple of however big that happens to be.
test('the undo budget is bytes, so a big picture gets fewer steps', () => {
  const stepsFor = (side) => Math.floor(UNDO_BYTES / (side * side * 4));
  assert.equal(stepsFor(32) > 1000, true, 'a sprite gets more steps than anyone will use');
  assert.equal(stepsFor(MAX_SIDE) >= 8, true, 'the biggest picture still gets a usable stack');
});
