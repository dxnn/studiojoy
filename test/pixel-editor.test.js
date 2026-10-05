// The drawing tools, which are arithmetic over bytes and need no canvas. What
// a canvas does with the result — showing it, and turning it into a PNG — is
// the browser's job and is checked there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, PALETTE_COLUMNS, GREYS, RAINBOW, FUN, isColour,
  SIZES, BRUSHES, MAX_SIDE, MAX_DRAWN, UNDO_BYTES, CLEAR,
  blankPicture, copyPicture, pixelAt, setPixel, stamp, drawLine, linePoints, isCorner,
  drawRect, drawEllipse, floodFill, replaceColour, gridPath,
  beginStep, endStep, applyStep, stepBytes,
  clipFrame, unclip, copyFrame, pasteFrame,
  rgbaOf, hexOf, isBlank, clampSide,
  cropPicture, fitSide, shrinkPicture, nearestColour, posterize, modifyPicture,
} from '../public/pixel-editor.js';

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const GREEN = [0, 200, 0, 255];

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

// Pixel-perfect: the client stamps a stroke one pixel behind the pointer and
// drops the middle of any three that make an L. The rule itself is isCorner,
// and running a whole path through it here is the same arithmetic the editor
// does — without a pointer.
const perfect = (path) => {
  const kept = [];
  let held = null;
  for (const point of path) {
    if (!held) { held = point; continue; }
    if (kept.length && isCorner(kept[kept.length - 1], held, point)) { held = point; continue; }
    kept.push(held);
    held = point;
  }
  if (held) kept.push(held);
  return kept.map((p) => p.join(','));
};

test('the middle of three pixels making an L is a corner, and a straight run is not', () => {
  // Right then down: the elbow at (1,0) is between two diagonal neighbours.
  assert.equal(isCorner([0, 0], [1, 0], [1, 1]), true);
  assert.equal(isCorner([0, 0], [0, 1], [1, 1]), true, 'the other elbow');
  // Three in a line, and a run that is already diagonal, bend nothing.
  assert.equal(isCorner([0, 0], [1, 0], [2, 0]), false);
  assert.equal(isCorner([0, 0], [1, 1], [2, 2]), false);
  // Two pixels apart is a gap, not a corner — nothing to drop.
  assert.equal(isCorner([0, 0], [1, 0], [2, 1]), false);
});

test('a hand-drawn staircase loses its corners and keeps its ends', () => {
  const path = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]];
  assert.deepEqual(perfect(path), ['0,0', '1,1', '2,2', '3,2']);
});

test('pixel-perfect never drops a pixel a straight line needs', () => {
  const straight = linePoints(0, 0, 6, 0).map((p) => p.join(','));
  assert.deepEqual(perfect(linePoints(0, 0, 6, 0)), straight);
  const diagonal = linePoints(0, 0, 5, 5).map((p) => p.join(','));
  assert.deepEqual(perfect(linePoints(0, 0, 5, 5)), diagonal);
});

test('a line hands out the same pixels it draws', () => {
  const points = linePoints(1, 1, 5, 3);
  const picture = blankPicture(8, 8);
  drawLine(picture, 1, 1, 5, 3, RED);
  assert.deepEqual(marks(picture).sort(), points.map((p) => p.join(',')).sort());
});

test('a rectangle is its four sides, and dragging it backwards is the same one', () => {
  const forwards = blankPicture(6, 6);
  drawRect(forwards, 1, 1, 4, 3, RED);
  assert.deepEqual(marks(forwards), [
    '1,1', '2,1', '3,1', '4,1',
    '1,2', '4,2',
    '1,3', '2,3', '3,3', '4,3',
  ]);
  const backwards = blankPicture(6, 6);
  drawRect(backwards, 4, 3, 1, 1, RED);
  assert.deepEqual(marks(backwards), marks(forwards));
});

test('a filled rectangle is every pixel the outline encloses, and no more', () => {
  const filled = blankPicture(6, 6);
  drawRect(filled, 1, 1, 4, 3, RED, 1, true);
  assert.equal(marks(filled).length, 4 * 3);
  const outline = blankPicture(6, 6);
  drawRect(outline, 1, 1, 4, 3, RED);
  // Every pixel of the outline is in the fill: turning Fill it in on can only
  // add to the shape, never move its edge.
  for (const mark of marks(outline)) assert.equal(marks(filled).includes(mark), true, mark);
});

test('a rectangle with no width is a line, and one of no size is a pixel', () => {
  const line = blankPicture(5, 5);
  drawRect(line, 2, 0, 2, 4, RED);
  assert.deepEqual(marks(line), ['2,0', '2,1', '2,2', '2,3', '2,4']);
  const dot = blankPicture(5, 5);
  assert.equal(drawRect(dot, 3, 3, 3, 3, RED), 1);
  assert.deepEqual(marks(dot), ['3,3']);
});

// The ellipse is the one shape with real arithmetic behind it, so it is
// checked as a shape rather than against a remembered list of pixels: it
// touches all four sides of the box it was dragged out in, stays inside it,
// and is symmetric both ways.
const bounds = (picture) => {
  const drawn = marks(picture).map((m) => m.split(',').map(Number));
  return {
    left: Math.min(...drawn.map((p) => p[0])),
    right: Math.max(...drawn.map((p) => p[0])),
    top: Math.min(...drawn.map((p) => p[1])),
    bottom: Math.max(...drawn.map((p) => p[1])),
  };
};

test('an ellipse fills the box it was dragged out in, both diameters', () => {
  // Odd and even across and down, because the two cases are what a circle
  // walked from a centre point cannot both get right.
  for (const [w, h] of [[8, 8], [9, 9], [9, 6], [6, 9], [2, 2], [12, 3]]) {
    const picture = blankPicture(16, 16);
    drawEllipse(picture, 1, 1, w, h, RED);
    assert.deepEqual(
      bounds(picture),
      { left: 1, right: w, top: 1, bottom: h },
      `${w + 1} by ${h + 1} ellipse`,
    );
  }
});

test('an ellipse is the same on both sides and the same top to bottom', () => {
  const picture = blankPicture(16, 16);
  drawEllipse(picture, 2, 2, 12, 9, RED);
  const drawn = new Set(marks(picture));
  for (const mark of drawn) {
    const [x, y] = mark.split(',').map(Number);
    assert.equal(drawn.has(`${2 + 12 - x},${y}`), true, `no mirror across for ${mark}`);
    assert.equal(drawn.has(`${x},${2 + 9 - y}`), true, `no mirror down for ${mark}`);
  }
});

test('a filled ellipse reaches exactly as far as its outline on every row', () => {
  const outline = blankPicture(16, 16);
  drawEllipse(outline, 1, 1, 13, 10, RED);
  const filled = blankPicture(16, 16);
  drawEllipse(filled, 1, 1, 13, 10, RED, 1, true);
  assert.deepEqual(bounds(filled), bounds(outline));
  const inFill = new Set(marks(filled));
  for (const mark of marks(outline)) assert.equal(inFill.has(mark), true, mark);
  // A fill is solid: no see-through pixel between the two ends of a row.
  for (let y = 1; y <= 10; y += 1) {
    const row = marks(filled).filter((m) => Number(m.split(',')[1]) === y).map((m) => Number(m.split(',')[0]));
    assert.equal(row.length, row[row.length - 1] - row[0] + 1, `row ${y} has a hole`);
  }
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

test('replacing a colour reaches past a wall, and leaves the others alone', () => {
  // Two blue patches with a red wall between them: a fill gets one, replacing
  // gets both, and neither touches the wall or the see-through corner.
  const picture = blankPicture(5, 2);
  for (const x of [0, 1, 3, 4]) setPixel(picture, x, 0, BLUE);
  setPixel(picture, 2, 0, RED);
  beginStep(picture);
  assert.equal(replaceColour(picture, 0, 0, GREEN), 4);
  const step = endStep(picture);
  assert.deepEqual(pixelAt(picture, 4, 0), GREEN, 'the far side of the wall');
  assert.deepEqual(pixelAt(picture, 2, 0), RED, 'the wall itself');
  assert.deepEqual(pixelAt(picture, 0, 1), [0, 0, 0, 0], 'a different colour');
  // One gesture, so one Undo puts all four back.
  applyStep(picture, step, true);
  assert.deepEqual(pixelAt(picture, 4, 0), BLUE);
  assert.equal(replaceColour(picture, 9, 9, GREEN), 0, 'outside is not a crash');
});

test('replacing a colour on one frame of a strip leaves the others alone', () => {
  const strip = blankPicture(16, 8);
  setPixel(strip, 1, 1, RED);
  setPixel(strip, 9, 1, RED);
  clipFrame(strip, 0, 8);
  assert.equal(replaceColour(strip, 1, 1, BLUE), 1);
  unclip(strip);
  assert.deepEqual(pixelAt(strip, 9, 1), RED, 'the next frame keeps its red');
  // And with nothing clipped — Whole strip — it reaches every frame.
  assert.equal(replaceColour(strip, 9, 1, BLUE), 1);
  assert.deepEqual(pixelAt(strip, 9, 1), BLUE);
});

test('the grid is the lines between squares, without the outer edge', () => {
  assert.equal(gridPath(3, 2), 'M1 0V2M2 0V2M0 1H3');
  assert.equal(gridPath(1, 1), '', 'one square has nothing between');
  // Every eighth: a 16-wide picture has one, down the middle, and an 8-tall
  // one has none across.
  assert.equal(gridPath(16, 8, 8), 'M8 0V8');
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

// The studio's starting colours are what a game's config/look.js gets written
// with, so a duplicate or a malformed one would land in a game's history.
test('the starting palette is two full rows of usable colours', () => {
  assert.equal(PALETTE.length, PALETTE_COLUMNS * 2);
  assert.deepEqual(PALETTE, [...GREYS, ...RAINBOW, ...FUN]);
  assert.equal(GREYS.length + RAINBOW.length + FUN.length, PALETTE.length);
  for (const hex of PALETTE) assert.equal(isColour(hex), true, `${hex} is not a colour`);
  assert.equal(new Set(PALETTE).size, PALETTE.length, 'no colour appears twice');
  assert.equal(GREYS[0], '#000000');
  assert.equal(GREYS.at(-1), '#ffffff');
});

test('isColour accepts what the palette holds and nothing else', () => {
  assert.equal(isColour('#ff8fbf'), true);
  assert.equal(isColour('#FF8FBF'), true);
  assert.equal(isColour('#abc'), false, 'short form is not written by the studio');
  assert.equal(isColour('red'), false);
  assert.equal(isColour('#ff8fbf88'), false);
  assert.equal(isColour(null), false);
  assert.equal(isColour(16), false);
});

test('a size is brought back to one a picture can be drawn at', () => {
  assert.equal(clampSide(0), 1);
  assert.equal(clampSide(-30), 1);
  assert.equal(clampSide(MAX_DRAWN + 1), MAX_DRAWN);
  assert.equal(clampSide(99999), MAX_DRAWN);
  assert.equal(clampSide('32'), 32);
  assert.equal(clampSide('what'), 1);
  assert.equal(clampSide(16.4), 16);
  for (const size of SIZES) assert.equal(clampSide(size), size);
  assert.equal(SIZES.every((n) => n <= MAX_DRAWN), true, 'every offered size fits');
});

// ⚠️ Two numbers, and mixing them up is how a picture gets made that the
// editor will not open again. MAX_DRAWN is the size of a thing being made;
// MAX_SIDE is the size of a thing being opened, which includes whatever
// somebody uploaded.
test('the studio draws smaller than it opens', () => {
  assert.equal(MAX_DRAWN, 256);
  assert.ok(MAX_DRAWN < MAX_SIDE, 'a drawn picture is smaller than the biggest one');
  assert.equal(SIZES.at(-1), MAX_DRAWN, 'the biggest size offered is the cap itself');
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

/* One step back ----------------------------------------------------------- */

// Recorded in setPixel, which every tool goes through, so this holds for tools
// that do not exist yet.
test('a step remembers only the pixels it changed, both sides of them', () => {
  const picture = blankPicture(8, 8);
  beginStep(picture);
  drawLine(picture, 1, 1, 3, 1, RED);
  const step = endStep(picture);
  assert.equal(step.at.length, 3);
  assert.deepEqual([...step.at], [1 * 8 + 1, 1 * 8 + 2, 1 * 8 + 3]);
  assert.deepEqual([...step.before.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual([...step.after.slice(0, 4)], RED);
  assert.equal(picture.step, null, 'the step is closed');
});

test('a gesture that changed nothing is not a step', () => {
  const picture = blankPicture(8, 8);
  beginStep(picture);
  drawLine(picture, 1, 1, 3, 1, CLEAR);
  assert.equal(endStep(picture), null);

  drawLine(picture, 1, 1, 3, 1, RED);
  beginStep(picture);
  drawLine(picture, 1, 1, 3, 1, RED);
  assert.equal(endStep(picture), null, 'painting the colour already there');
});

test('a step goes back and comes forward again', () => {
  const picture = blankPicture(8, 8);
  drawLine(picture, 0, 0, 7, 0, BLUE);
  const original = [...picture.data];

  beginStep(picture);
  drawLine(picture, 0, 0, 7, 0, RED);
  const step = endStep(picture);
  const painted = [...picture.data];

  applyStep(picture, step, true);
  assert.deepEqual([...picture.data], original, 'back to the blue line');
  applyStep(picture, step, false);
  assert.deepEqual([...picture.data], painted, 'forward to the red one');
  applyStep(picture, step, true);
  assert.deepEqual([...picture.data], original, 'and back again');
});

// ⚠️ The case the direction of the loop exists for. A stroke that crosses
// itself records the same pixel twice: the first entry holds the colour it
// really started as, the second holds what the first left behind. Undone in
// order, that pixel would stop at the middle colour.
test('a stroke that crosses itself still undoes to what was there before', () => {
  const picture = blankPicture(8, 8);
  floodFill(picture, 0, 0, BLUE);
  const original = [...picture.data];

  beginStep(picture);
  drawLine(picture, 1, 4, 6, 4, RED);       // across
  drawLine(picture, 4, 1, 4, 6, GREEN);     // down through it, over 4,4
  const step = endStep(picture);
  assert.deepEqual(pixelAt(picture, 4, 4), GREEN);
  const crossings = [...step.at].filter((n) => n === 4 * 8 + 4).length;
  assert.equal(crossings, 2, 'the crossing point really was written twice');

  applyStep(picture, step, true);
  assert.deepEqual([...picture.data], original);
  assert.deepEqual(pixelAt(picture, 4, 4), BLUE, 'not the red it was mid-stroke');

  applyStep(picture, step, false);
  assert.deepEqual(pixelAt(picture, 4, 4), GREEN, 'redo ends where the gesture did');
});

test('a step costs what it touched, not what the picture costs', () => {
  const small = blankPicture(16, 16);
  const huge = blankPicture(MAX_SIDE, MAX_SIDE);
  const strokeOn = (picture) => {
    beginStep(picture);
    drawLine(picture, 1, 1, 12, 1, RED);
    return stepBytes(endStep(picture));
  };
  // Once each: drawing the same red line twice changes nothing the second
  // time, so there would be no second step to measure.
  const onSmall = strokeOn(small);
  const onHuge = strokeOn(huge);
  assert.equal(onSmall, onHuge, 'the same stroke costs the same either way');
  assert.equal(onHuge < 1000, true, 'and it is nothing like a copy of the picture');

  // The one genuinely large step: filling a whole big picture. Twelve bytes a
  // pixel — a 4-byte index, and 4 bytes of colour on each side of it — so the
  // budget has to be able to hold at least one of them.
  const blank = blankPicture(MAX_SIDE, MAX_SIDE);
  beginStep(blank);
  floodFill(blank, 0, 0, BLUE);
  const fill = stepBytes(endStep(blank));
  assert.equal(fill, MAX_SIDE * MAX_SIDE * 12);
  assert.equal(fill < UNDO_BYTES, true, 'a whole-picture fill fits in the budget');
});

// One frame at a time: the clip narrows every tool to a vertical slice, so a
// brush at the frame's edge and a fill on an empty frame stay in the frame.
test('the clip keeps the brush and the fill inside one frame', () => {
  // A 4-frame strip of 8x8 cells, editing frame 1 (pixels 8..15).
  const strip = blankPicture(32, 8);
  clipFrame(strip, 8, 16);

  // A wide brush at the frame's left edge would spill into frame 0.
  stamp(strip, 8, 4, RED, 4);
  assert.equal(pixelAt(strip, 7, 4), null, 'outside the clip reads as not there');
  unclip(strip);
  assert.deepEqual(pixelAt(strip, 7, 4), [0, 0, 0, 0], 'and was never painted');
  assert.deepEqual(pixelAt(strip, 8, 4), RED);

  // A fill of the empty frame floods the frame, not the strip.
  clipFrame(strip, 8, 16);
  floodFill(strip, 12, 1, BLUE);
  unclip(strip);
  assert.deepEqual(pixelAt(strip, 15, 7), BLUE, 'the frame is filled to its edge');
  assert.deepEqual(pixelAt(strip, 16, 7), [0, 0, 0, 0], 'the next frame is untouched');
  assert.deepEqual(pixelAt(strip, 0, 0), [0, 0, 0, 0]);
});

// Gear's shapes (public/gear-shapes.js): a mask is a clip of any shape, so a
// fill floods the circle and stops at its rim, and nothing lands outside it.
test('a mask keeps every tool inside its shape', async () => {
  const { maskFor } = await import('../public/gear-shapes.js');
  const head = blankPicture(32, 32);
  head.mask = maskFor('head');
  floodFill(head, 16, 16, BLUE);
  stamp(head, 0, 0, RED, 4);
  head.mask = null;
  assert.deepEqual(pixelAt(head, 16, 16), BLUE);
  assert.deepEqual(pixelAt(head, 0, 0), [0, 0, 0, 0], 'the corner is outside the circle: nothing there');
  assert.deepEqual(pixelAt(head, 31, 31), [0, 0, 0, 0], 'the fill stopped at the rim');
});

test('a copied frame pastes as one undoable gesture', () => {
  const strip = blankPicture(32, 8);
  drawLine(strip, 0, 0, 7, 7, RED); // a mark on frame 0
  const copied = copyFrame(strip, 8, 0);

  beginStep(strip);
  assert.equal(pasteFrame(strip, 8, 2, copied) > 0, true);
  const step = endStep(strip);
  assert.deepEqual(pixelAt(strip, 16, 0), RED, 'the mark arrived on frame 2');
  assert.deepEqual(pixelAt(strip, 23, 7), RED);

  // Pasting the same frame again changes nothing and makes no step.
  beginStep(strip);
  pasteFrame(strip, 8, 2, copied);
  assert.equal(endStep(strip), null);

  // One undo takes the paste back whole.
  applyStep(strip, step, true);
  assert.deepEqual(pixelAt(strip, 16, 0), [0, 0, 0, 0]);
});

/* Changing a picture whole (spec.md §6) ------------------------------------ */

test('a crop is the rectangle asked for, clamped to the picture, never empty', () => {
  const picture = blankPicture(4, 3);
  setPixel(picture, 1, 1, RED);
  setPixel(picture, 3, 2, BLUE);

  const cut = cropPicture(picture, 1, 1, 2, 2);
  assert.equal(cut.width, 2);
  assert.equal(cut.height, 2);
  assert.deepEqual(pixelAt(cut, 0, 0), RED, 'the mark moved with the corner');
  assert.deepEqual(marks(cut), ['0,0']);
  assert.deepEqual(pixelAt(picture, 1, 1), RED, 'the original is untouched');

  // Past the edge is the edge; nothing is never the answer.
  const edge = cropPicture(picture, 3, 2, 10, 10);
  assert.deepEqual([edge.width, edge.height], [1, 1]);
  assert.deepEqual(pixelAt(edge, 0, 0), BLUE);
  const none = cropPicture(picture, 9, 9, 0, 0);
  assert.deepEqual([none.width, none.height], [1, 1]);
});

test('fitSide brings the longest side down, keeps the shape and never grows', () => {
  assert.deepEqual(fitSide(400, 200, 64), [64, 32]);
  assert.deepEqual(fitSide(200, 400, 64), [32, 64]);
  assert.deepEqual(fitSide(30, 20, 64), [30, 20], 'a small picture stays');
  assert.deepEqual(fitSide(1000, 1, 16), [16, 1], 'never a side of nothing');
});

test('shrinking averages the pixels each new one covers, weighted by alpha', () => {
  const picture = blankPicture(4, 4);
  // Top-left box solid red; top-right half red, half blue; bottom-left one
  // red pixel in four; bottom-right empty.
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) setPixel(picture, x, y, RED);
  setPixel(picture, 2, 0, RED); setPixel(picture, 3, 0, RED);
  setPixel(picture, 2, 1, BLUE); setPixel(picture, 3, 1, BLUE);
  setPixel(picture, 0, 2, RED);

  const small = shrinkPicture(picture, 2, 2);
  assert.deepEqual([small.width, small.height], [2, 2]);
  assert.deepEqual(pixelAt(small, 0, 0), RED);
  assert.deepEqual(pixelAt(small, 1, 0), [128, 0, 128, 255], 'red and blue make purple');
  // The colour is the one pixel's, at a quarter of its alpha — a see-through
  // neighbour lends no darkness.
  assert.deepEqual(pixelAt(small, 0, 1), [255, 0, 0, 64]);
  assert.deepEqual(pixelAt(small, 1, 1), [0, 0, 0, 0]);
  assert.deepEqual(pixelAt(picture, 2, 1), BLUE, 'the original is untouched');

  // Never up, and never empty.
  const same = shrinkPicture(picture, 40, 40);
  assert.deepEqual([same.width, same.height], [4, 4]);
  assert.deepEqual(marks(same), marks(picture));
});

test('posterize snaps every pixel to the palette and every edge hard', () => {
  const palette = ['#ff0000', '#0000ff', '#ffffff'];
  assert.deepEqual(nearestColour([200, 30, 30], palette.map(rgbaOf)), rgbaOf('#ff0000'));
  assert.deepEqual(nearestColour([230, 230, 250], palette.map(rgbaOf)), rgbaOf('#ffffff'));

  const picture = blankPicture(3, 1);
  setPixel(picture, 0, 0, [200, 30, 30, 255]);
  setPixel(picture, 1, 0, [10, 10, 220, 200]);
  setPixel(picture, 2, 0, [255, 255, 255, 100]);
  const snapped = posterize(picture, palette);
  assert.deepEqual(pixelAt(snapped, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixelAt(snapped, 1, 0), [0, 0, 255, 255], 'a mostly-solid pixel goes solid');
  assert.deepEqual(pixelAt(snapped, 2, 0), [0, 0, 0, 0], 'a mostly-clear one goes clear');
  assert.deepEqual(pixelAt(picture, 1, 0), [10, 10, 220, 200], 'the original is untouched');
});

test('modifyPicture does only the steps asked for, each on its own or together', () => {
  // An 8×4 picture: the left half a near-red, the right half see-through.
  const picture = blankPicture(8, 4);
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) setPixel(picture, x, y, [200, 30, 30, 255]);
  const palette = ['#ff0000', '#0000ff'];

  const asIs = modifyPicture(picture);
  assert.deepEqual([asIs.width, asIs.height], [8, 4]);
  assert.deepEqual(asIs.data, picture.data, 'nothing asked for is the picture as it is');
  assert.notEqual(asIs, picture, 'and still its own copy');

  const cut = modifyPicture(picture, { box: { x: 2, y: 0, w: 4, h: 4 } });
  assert.deepEqual([cut.width, cut.height], [4, 4]);
  assert.deepEqual(marks(cut).length, 8, 'the crop straddles the edge of the red half');
  assert.deepEqual(pixelAt(cut, 0, 0), [200, 30, 30, 255], 'a crop alone changes no colour');

  const small = modifyPicture(picture, { side: 4 });
  assert.deepEqual([small.width, small.height], [4, 2], 'the shape is kept');
  assert.deepEqual(pixelAt(small, 0, 0), [200, 30, 30, 255]);

  const snapped = modifyPicture(picture, { palette });
  assert.deepEqual([snapped.width, snapped.height], [8, 4], 'a recolour alone keeps the size');
  assert.deepEqual(pixelAt(snapped, 0, 0), [255, 0, 0, 255]);

  const all3 = modifyPicture(picture, { box: { x: 0, y: 0, w: 4, h: 4 }, side: 2, palette });
  assert.deepEqual([all3.width, all3.height], [2, 2]);
  assert.deepEqual(marks(all3), ['0,0', '1,0', '0,1', '1,1']);
  assert.deepEqual(pixelAt(all3, 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixelAt(picture, 0, 0), [200, 30, 30, 255], 'the original is untouched');
});
