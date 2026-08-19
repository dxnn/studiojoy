// A picture as pixels: what the drawing tools do, with nothing browser-shaped
// about it. The canvas, the pointer and the PNG live in main.js; everything
// here is an array of bytes, so a flood fill can be checked without a screen.
//
// Colours are four bytes, red green blue alpha, exactly as a canvas stores
// them — there is no palette to map through. That keeps an uploaded picture
// lossless when it is opened for drawing: whatever an artist or a phone
// camera put in the file is still there afterwards, apart from the pixels
// somebody meant to change.

export const MAX_SIDE = 128;

// Square by default, and every one of these is a size a game sprite is
// actually drawn at.
export const SIZES = [8, 16, 24, 32, 48, 64, 96, 128];

// Sixteen colours: a grey ramp, then warm, then cool. Enough to draw with and
// few enough to pick from without a colour wheel — there is a colour well for
// anything else.
export const PALETTE = [
  '#000000', '#3c3c50', '#6a6a80', '#a0a0b4', '#e6e6f0', '#ffffff',
  '#7a2f2f', '#d63a3a', '#ff8a3d', '#ffd23f',
  '#2f7a3c', '#4ec25a', '#2f5f9e', '#4aa8e8',
  '#6b3fa0', '#e05fb0',
];

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

const inside = ({ width, height }, x, y) => x >= 0 && y >= 0 && x < width && y < height;

export function pixelAt(picture, x, y) {
  if (!inside(picture, x, y)) return null;
  const at = (y * picture.width + x) * 4;
  return [picture.data[at], picture.data[at + 1], picture.data[at + 2], picture.data[at + 3]];
}

// Returns whether anything actually moved, so a stroke that changes nothing
// does not become a version.
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
  data[at] = rgba[0];
  data[at + 1] = rgba[1];
  data[at + 2] = rgba[2];
  data[at + 3] = rgba[3];
  return true;
}

// Bresenham, because a pointer moving quickly reports a handful of positions
// across the whole canvas and a game sprite drawn in dots is not a drawing.
export function drawLine(picture, x0, y0, x1, y1, rgba) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let changed = 0;
  for (;;) {
    if (setPixel(picture, x, y, rgba)) changed += 1;
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

export const isBlank = (picture) => picture.data.every((byte) => byte === 0);

// A size somebody typed, brought back into what a sprite can be.
export const clampSide = (n) => Math.min(MAX_SIDE, Math.max(1, Math.round(Number(n) || 0) || 1));
