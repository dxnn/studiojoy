// A picture as pixels: what the drawing tools do, with nothing browser-shaped
// about it. The canvas, the pointer and the PNG live in main.js; everything
// here is an array of bytes, so a flood fill can be checked without a screen.
//
// Colours are four bytes, red green blue alpha, exactly as a canvas stores
// them — there is no palette to map through. That keeps an uploaded picture
// lossless when it is opened for drawing: whatever an artist or a phone
// camera put in the file is still there afterwards, apart from the pixels
// somebody meant to change.

// The biggest picture the editor will *open* at all. Big enough for a
// background or a photo somebody dropped in. The cost is bytes: a picture
// this size is 4 MB, and a step back is another copy of it, which is why undo
// is bounded by bytes below.
export const MAX_SIDE = 1024;

// The biggest one it will *make* — and the biggest one *frame* of a film
// strip, whose whole width is still held to MAX_SIDE. This is a smaller
// number on purpose: past 256 the editor stops blocking the pixels up
// (`chunky` in drawing.js), a one-pixel brush is thinner than the pane can
// show, and what comes out is a photograph drawn by hand rather than pixel
// art. Something bigger that arrives by upload still opens to be drawn on.
export const MAX_DRAWN = 256;

// Square, because a sprite usually is. Anything rectangular arrives by being
// opened rather than by being made here.
export const SIZES = [16, 32, 64, 128, 256];

// How many pixels across the pencil paints. One is right for a 32-square
// sprite and useless on a 700-wide picture, where a single pixel is smaller
// than the pane can show.
export const BRUSHES = [1, 2, 4, 8, 16, 32];

// Both history stacks together, in bytes. A step holds the pixels it changed
// rather than a copy of the picture, so this buys thousands of strokes on a
// picture of any size. The bound is here for the one case that is genuinely
// large: flooding a whole 1024-square picture costs twelve bytes a pixel — a
// 4-byte index and 4 bytes of colour on each side of it — which is 12 MB, so
// two of those fit and a third pushes the oldest out.
export const UNDO_BYTES = 32 * 1024 * 1024;

// Thirty-two colours in two rows of sixteen: a grey ramp to draw shapes with,
// a rainbow to colour them in, and a row of the ones that make a game look like
// somebody chose it. What a game actually uses lives in its own
// config/look.js — this is only the set a game starts from.
export const GREYS = [
  '#000000', '#2c2c38', '#4c4c5e', '#6e6e84', '#9494a8', '#bcbcca', '#e2e2ec', '#ffffff',
];

export const RAINBOW = [
  '#e33b3b', '#ea6a2a', '#f0932b', '#f7cf3d', '#c4d92e', '#5cc648',
  '#2fb783', '#28b3c4', '#2f86d4', '#3a5fd0', '#7a4fd0', '#c247c0',
];

export const FUN = [
  '#ff8fbf', '#ffc9a3', '#8a5a3c', '#d2b48c', '#7ee0c0', '#c9b6ff',
  '#e8c34a', '#7a2f4a', '#1f2a5a', '#6b7a2f', '#ff6f5e', '#8e5d9e',
];

// Row one is the greys and the first eight of the rainbow; row two is the rest
// of it and all the fun ones. Sixteen to a row, so the order matters as much as
// the colours.
export const PALETTE = [...GREYS, ...RAINBOW.slice(0, 8), ...RAINBOW.slice(8), ...FUN];

export const PALETTE_COLUMNS = 16;

export const isColour = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

export const CLEAR = [0, 0, 0, 0];

export function rgbaOf(hex) {
  const text = hex.replace('#', '');
  const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    full.length >= 8 ? parseInt(full.slice(6, 8), 16) : 255,
  ];
}

export const hexOf = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export const blankPicture = (width, height) => ({
  width, height, data: new Uint8ClampedArray(width * height * 4),
});

export const pictureFrom = (width, height, data) => ({ width, height, data });

export const copyPicture = (picture) => ({
  width: picture.width, height: picture.height, data: new Uint8ClampedArray(picture.data),
});

// The clip, when set, narrows every tool to one vertical slice of the
// picture — the frame being edited. It lives here, in the one bounds check
// every read and write goes through, so a wide brush at a frame's edge
// cannot spill into the next frame and a fill cannot leak across the strip:
// pixelAt outside the clip reads as "not there", which is what stops the
// flood the same way the picture's own edge does. Undo and redo write
// through applyStep, which takes no positions, so they ignore the clip —
// a step is put back wherever it happened.
//
// The mask is the same idea in any shape: one byte a pixel, 0 where nothing
// may be drawn — gear's circle, shirt and legs (public/gear-shapes.js). Inside
// the check every tool goes through, so a brush, a line and a fill all stop
// at its edge as they do at the picture's.
const inside = (picture, x, y) => {
  if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return false;
  if (picture.mask && !picture.mask[y * picture.width + x]) return false;
  const { clip } = picture;
  return !clip || (x >= clip.left && x < clip.right);
};

export function clipFrame(picture, left, right) {
  picture.clip = { left, right };
}

export function unclip(picture) {
  picture.clip = null;
}

export function pixelAt(picture, x, y) {
  if (!inside(picture, x, y)) return null;
  const at = (y * picture.width + x) * 4;
  return [picture.data[at], picture.data[at + 1], picture.data[at + 2], picture.data[at + 3]];
}

// Returns whether anything actually moved, so a stroke that changes nothing
// does not become a version.
//
// Recording happens here, in the one function every tool goes through, so a
// tool added later gets undo by existing rather than by remembering to.
export function setPixel(picture, x, y, rgba) {
  if (!inside(picture, x, y)) return false;
  const at = (y * picture.width + x) * 4;
  const { data } = picture;
  // A fully transparent pixel is transparent whatever colour is behind it, so
  // comparing the other three would report a change nobody can see.
  const same = rgba[3] === 0
    ? data[at + 3] === 0
    : data[at] === rgba[0] && data[at + 1] === rgba[1]
      && data[at + 2] === rgba[2] && data[at + 3] === rgba[3];
  if (same) return false;
  if (picture.step) {
    picture.step.at.push(at / 4);
    picture.step.before.push(data[at], data[at + 1], data[at + 2], data[at + 3]);
    picture.step.after.push(rgba[0], rgba[1], rgba[2], rgba[3]);
  }
  data[at] = rgba[0];
  data[at + 1] = rgba[1];
  data[at + 2] = rgba[2];
  data[at + 3] = rgba[3];
  return true;
}

/* One step back ----------------------------------------------------------- */

// A step is one gesture — a stroke from putting the pointer down to lifting it,
// or a single fill — held as the pixels it changed and their colour on each
// side of it. That is a few kilobytes for a stroke whatever the picture's size,
// where a copy of the picture would be four megabytes, and it is what makes
// redo possible at all.
export function beginStep(picture) {
  picture.step = { at: [], before: [], after: [] };
}

// Returns the step, or null when the gesture changed nothing — a dab of the
// colour that was already there is not something to undo.
export function endStep(picture) {
  const open = picture.step;
  picture.step = null;
  if (!open || open.at.length === 0) return null;
  return {
    at: Uint32Array.from(open.at),
    before: Uint8ClampedArray.from(open.before),
    after: Uint8ClampedArray.from(open.after),
  };
}

export const stepBytes = (step) => step.at.byteLength + step.before.byteLength + step.after.byteLength;

// ⚠️ Backwards for undo, forwards for redo, and the direction is the whole
// correctness argument. A stroke that crosses itself writes the same pixel
// twice, so that pixel has two entries: the first holding the colour it really
// started as, the second holding the colour the first entry left. Undoing in
// order would stop at the middle colour. Applied last-to-first, the earliest
// entry has the final say, which is the original.
export function applyStep(picture, step, back) {
  const colours = back ? step.before : step.after;
  const { data } = picture;
  const count = step.at.length;
  for (let n = 0; n < count; n += 1) {
    const i = back ? count - 1 - n : n;
    const at = step.at[i] * 4;
    data[at] = colours[i * 4];
    data[at + 1] = colours[i * 4 + 1];
    data[at + 2] = colours[i * 4 + 2];
    data[at + 3] = colours[i * 4 + 3];
  }
}

// A square of pixels centred on one, which is what a brush wider than a pixel
// is. Odd sizes land on the middle; even ones lean up and left, because they
// have to lean somewhere.
export function stamp(picture, x, y, rgba, size = 1) {
  if (size <= 1) return setPixel(picture, x, y, rgba) ? 1 : 0;
  const before = Math.floor((size - 1) / 2);
  let changed = 0;
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      if (setPixel(picture, x - before + dx, y - before + dy, rgba)) changed += 1;
    }
  }
  return changed;
}

// Bresenham, because a pointer moving quickly reports a handful of positions
// across the whole canvas and a game sprite drawn in dots is not a drawing.
// Handed out as points rather than only drawn, because a pixel-perfect stroke
// has to look at three of them at a time.
export function linePoints(x0, y0, x1, y1) {
  const points = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += stepX; }
    if (doubled <= dx) { error += dx; y += stepY; }
  }
}

export function drawLine(picture, x0, y0, x1, y1, rgba, size = 1) {
  let changed = 0;
  for (const [x, y] of linePoints(x0, y0, x1, y1)) changed += stamp(picture, x, y, rgba, size);
  return changed;
}

// Three pixels in a row making an L: the middle one is a corner the hand did
// not mean, and taking it out leaves a clean diagonal step. True when the
// outer two are diagonal neighbours and the middle is one of the two elbows
// between them — which is the whole of pixel-perfect freehand.
//
// ⚠️ It can only be asked once the pixel *after* the middle one has arrived,
// which is why a stroke drawing this way is stamped one pixel behind the
// pointer rather than filtered afterwards. Filtering afterwards would mean
// un-drawing pixels already in the step, and a stroke that crosses itself
// makes that the wrong answer.
export const isCorner = (a, b, c) => Math.abs(c[0] - a[0]) === 1
  && Math.abs(c[1] - a[1]) === 1
  && ((b[0] === a[0] && b[1] === c[1]) || (b[0] === c[0] && b[1] === a[1]));

// The three shapes a hand cannot draw square by square. Each one is dragged
// out from where the pointer went down to where it is now, so both ends are
// given and neither is a centre — a corner-to-corner box is what a person is
// actually doing with their hand, and it is the same box for both of them.
//
// Filled and outline come out of the same arithmetic rather than two, so
// turning Fill it in on cannot change the shape by a pixel: the outline is
// the boundary pixels, and the fill is the span between the boundary's own
// ends on each row.

export function drawRect(picture, x0, y0, x1, y1, rgba, size = 1, filled = false) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  let changed = 0;
  if (filled) {
    for (let y = top; y <= bottom; y += 1) changed += drawLine(picture, left, y, right, y, rgba);
    return changed;
  }
  changed += drawLine(picture, left, top, right, top, rgba, size);
  changed += drawLine(picture, left, bottom, right, bottom, rgba, size);
  changed += drawLine(picture, left, top, left, bottom, rgba, size);
  changed += drawLine(picture, right, top, right, bottom, rgba, size);
  return changed;
}

// Bresenham's ellipse in its bounding-box form (Zingl), which is integers all
// the way down and gets both odd and even diameters right — the two cases a
// midpoint circle walked from a centre cannot both have. It walks one quarter
// and mirrors each pixel into the other three.
function ellipsePoints(x0, y0, x1, y1) {
  let left = Math.min(x0, x1);
  let right = Math.max(x0, x1);
  let top = Math.min(y0, y1);
  const across = right - left;
  const down = Math.max(y0, y1) - top;
  const odd = down & 1;
  let bottom = top + Math.floor((down + 1) / 2);
  top = bottom - odd;
  let dx = 4 * (1 - across) * down * down;
  let dy = 4 * (odd + 1) * across * across;
  let error = dx + dy + odd * across * across;
  const stepY = 8 * across * across;
  const stepX = 8 * down * down;
  const points = [];
  do {
    points.push([right, top], [left, top], [left, bottom], [right, bottom]);
    const twice = 2 * error;
    // ⚠️ The two halves walk apart from the middle row, not together: bottom
    // goes down and top goes up. Swapped, an ellipse closes into a lens.
    if (twice <= dy) { bottom += 1; top -= 1; dy += stepY; error += dy; }
    if (twice >= dx || 2 * error > dy) { left += 1; right -= 1; dx += stepX; error += dx; }
  } while (left <= right);
  // A very flat ellipse stops before its ends are drawn, and the tips are what
  // make it read as an ellipse rather than as a bar.
  while (bottom - top < down) {
    points.push([left - 1, top], [right + 1, top], [left - 1, bottom], [right + 1, bottom]);
    bottom += 1;
    top -= 1;
  }
  return points;
}

export function drawEllipse(picture, x0, y0, x1, y1, rgba, size = 1, filled = false) {
  const points = ellipsePoints(x0, y0, x1, y1);
  let changed = 0;
  if (!filled) {
    for (const [x, y] of points) changed += stamp(picture, x, y, rgba, size);
    return changed;
  }
  // Each row's own two ends, so the fill reaches exactly as far as the outline
  // would have and no further.
  const rows = new Map();
  for (const [x, y] of points) {
    const span = rows.get(y);
    if (!span) rows.set(y, [x, x]);
    else { span[0] = Math.min(span[0], x); span[1] = Math.max(span[1], x); }
  }
  for (const [y, [lo, hi]] of rows) changed += drawLine(picture, lo, y, hi, y, rgba);
  return changed;
}

const matches = (picture, x, y, target) => {
  const here = pixelAt(picture, x, y);
  if (!here) return false;
  if (target[3] === 0) return here[3] === 0;
  return here[0] === target[0] && here[1] === target[1]
    && here[2] === target[2] && here[3] === target[3];
};

// Four-way, over a stack rather than by recursion: 128 by 128 is 16,384
// pixels, and a recursive fill of a blank one is 16,384 frames deep.
export function floodFill(picture, x, y, rgba) {
  const target = pixelAt(picture, x, y);
  if (!target) return 0;
  if (!setPixel(picture, x, y, rgba)) return 0;
  const stack = [[x, y]];
  let changed = 1;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (!matches(picture, nx, ny, target)) continue;
      if (setPixel(picture, nx, ny, rgba)) {
        changed += 1;
        stack.push([nx, ny]);
      }
    }
  }
  return changed;
}

// The fill's other half: every pixel the colour of the one clicked, joined to
// it or not, which is how a green dragon goes purple in one go. Inside the clip
// like every tool, so on one frame of a strip it means that frame and Whole
// strip means all of them — it changes what is on screen and nothing else.
export function replaceColour(picture, x, y, rgba) {
  const target = pixelAt(picture, x, y);
  if (!target) return 0;
  let changed = 0;
  for (let py = 0; py < picture.height; py += 1) {
    for (let px = 0; px < picture.width; px += 1) {
      if (matches(picture, px, py, target) && setPixel(picture, px, py, rgba)) changed += 1;
    }
  }
  return changed;
}

// The lines between the squares as one SVG path in the picture's own units —
// a vertical every `every` columns and a horizontal every `every` rows, the
// outer edge left out because the picture's edge is drawn already. In the
// picture's units, so it scales with the box for nothing and each line sits on
// a square's edge at any zoom, Fit's fractional ones included.
export function gridPath(width, height, every = 1) {
  const parts = [];
  for (let x = every; x < width; x += every) parts.push(`M${x} 0V${height}`);
  for (let y = every; y < height; y += every) parts.push(`M0 ${y}H${width}`);
  return parts.join('');
}

// One frame of a strip, lifted out as bytes — the clipboard behind
// "Copy frame". `fw` is the frame's width; the height is the picture's.
export function copyFrame(picture, fw, frame) {
  const out = new Uint8ClampedArray(fw * picture.height * 4);
  for (let y = 0; y < picture.height; y += 1) {
    const from = (y * picture.width + frame * fw) * 4;
    out.set(picture.data.subarray(from, from + fw * 4), y * fw * 4);
  }
  return out;
}

// Paste goes through setPixel like every tool, so it records into the open
// step and undoes as one gesture, and pasting a frame over itself changes
// nothing and makes no version.
export function pasteFrame(picture, fw, frame, bytes) {
  let changed = 0;
  for (let y = 0; y < picture.height; y += 1) {
    for (let x = 0; x < fw; x += 1) {
      const at = (y * fw + x) * 4;
      const rgba = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
      if (setPixel(picture, frame * fw + x, y, rgba)) changed += 1;
    }
  }
  return changed;
}

export const isBlank = (picture) => picture.data.every((byte) => byte === 0);

// A size somebody typed, brought back into what a picture drawn here can be.
// MAX_DRAWN rather than MAX_SIDE: this is the size of a thing being made.
export const clampSide = (n) => Math.min(MAX_DRAWN, Math.max(1, Math.round(Number(n) || 0) || 1));

/* Changing a picture whole ---------------------------------------------------
   The operations behind the Modify image dialog (spec.md §6). Each hands
   back a new picture and leaves the old one alone. ⚠️ None is an undo step: a
   step is indexes into a picture of one width, so a picture that changes size
   invalidates the whole stack — the caller writes the result and the old size
   is a version. */

const within = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

// The rectangle cut out, clamped to the picture and never empty.
export function cropPicture(picture, x, y, width, height) {
  const x0 = within(x, 0, picture.width - 1);
  const y0 = within(y, 0, picture.height - 1);
  const w = within(width, 1, picture.width - x0);
  const hgt = within(height, 1, picture.height - y0);
  const out = blankPicture(w, hgt);
  for (let row = 0; row < hgt; row += 1) {
    const from = ((y0 + row) * picture.width + x0) * 4;
    out.data.set(picture.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

// The size a picture takes with its longest side brought to `side`: shape
// kept, never grown, at least a pixel each way.
export function fitSide(width, height, side) {
  const scale = Math.min(1, side / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

// The picture brought down to `width` by `height`, each new pixel the average
// of the source pixels it covers — what turns a photograph into pixel art
// without speckling it, which picking one pixel of each box would. Colour is
// averaged over the covered pixels weighted by their alpha, so a see-through
// neighbour lends no darkness; alpha is averaged over all of them. Never up.
export function shrinkPicture(picture, width, height) {
  const w = within(width, 1, picture.width);
  const hgt = within(height, 1, picture.height);
  const out = blankPicture(w, hgt);
  const { data } = picture;
  for (let y = 0; y < hgt; y += 1) {
    const sy0 = Math.floor((y * picture.height) / hgt);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * picture.height) / hgt));
    for (let x = 0; x < w; x += 1) {
      const sx0 = Math.floor((x * picture.width) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * picture.width) / w));
      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const i = (sy * picture.width + sx) * 4;
          const alpha = data[i + 3];
          r += data[i] * alpha;
          g += data[i + 1] * alpha;
          b += data[i + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }
      if (a === 0) continue;
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / a);
      out.data[o + 1] = Math.round(g / a);
      out.data[o + 2] = Math.round(b / a);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// The palette colour nearest a pixel, by distance in RGB. Simple on purpose:
// thirty-two colours sit far enough apart that a perceptual space would move
// few pixels, and the answer is the game's palette either way.
export function nearestColour(rgb, colours) {
  let best = colours[0];
  let least = Infinity;
  for (const c of colours) {
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < least) { least = d; best = c; }
  }
  return best;
}

// Every pixel snapped to the nearest of the palette's colours, and every edge
// made hard — alpha under half goes see-through, the rest solid — because
// pixel art has no soft edges, and the game's palette is what makes a photo
// look like it belongs to the game. `palette` is hex strings, as
// config/look.js keeps them.
export function posterize(picture, palette) {
  const colours = palette.map(rgbaOf);
  const out = copyPicture(picture);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] < 128) {
      out.data.set(CLEAR, i);
      continue;
    }
    const c = nearestColour(out.data.subarray(i, i + 3), colours);
    out.data[i] = c[0];
    out.data[i + 1] = c[1];
    out.data[i + 2] = c[2];
    out.data[i + 3] = 255;
  }
  return out;
}

// The dialog's three steps as one call, each left out by leaving its argument
// out: `box` (x, y, w, h) cuts that rectangle, `side` brings the longest side
// down to it, `palette` snaps the colours and hardens the edges. Nothing asked
// for is a copy of the picture as it is.
export function modifyPicture(picture, { box = null, side = null, palette = null } = {}) {
  let out = box ? cropPicture(picture, box.x, box.y, box.w, box.h) : copyPicture(picture);
  if (side) out = shrinkPicture(out, ...fitSide(out.width, out.height, side));
  if (palette) out = posterize(out, palette);
  return out;
}
