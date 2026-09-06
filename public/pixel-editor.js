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
const inside = (picture, x, y) => {
  if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return false;
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
export function drawLine(picture, x0, y0, x1, y1, rgba, size = 1) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let changed = 0;
  for (;;) {
    changed += stamp(picture, x, y, rgba, size);
    if (x === x1 && y === y1) return changed;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += stepX; }
    if (doubled <= dx) { error += dx; y += stepY; }
  }
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
