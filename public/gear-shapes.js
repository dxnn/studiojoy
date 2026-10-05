// The three pieces of gear an avatar is made of, and the shape each has to fit
// (ideas/dreams.md §6). A head is drawn inside a circle, a body inside a
// T-shirt, legs inside two legs with feet — the pixel editor's gear mode will
// not paint outside the shape, so every head sits on every body and every
// body on every pair of legs. Stacked, they are one figure 32 wide.
//
// Pure, so the studio, the games origin and the tests read the same shapes.

export const SLOTS = ['head', 'body', 'legs'];

export const SIZES = {
  head: { width: 32, height: 32 },
  body: { width: 32, height: 28 },
  legs: { width: 32, height: 24 },
};

// Whether a pixel is inside a slot's shape.
const SHAPES = {
  head: (x, y) => (x + 0.5 - 16) ** 2 + (y + 0.5 - 16) ** 2 <= 16 * 16,
  body: (x, y) => (x >= 6 && x <= 25)
    || (y <= 3 && x >= 3 && x <= 28)
    || (y >= 2 && y <= 23 && ((x >= 1 && x <= 5) || (x >= 26 && x <= 30))),
  legs: (x, y) => (y <= 5 && x >= 7 && x <= 24)
    || (y >= 21 && ((x >= 5 && x <= 14) || (x >= 17 && x <= 26)))
    || (x >= 7 && x <= 14) || (x >= 17 && x <= 24),
};

export const isSlot = (slot) => SLOTS.includes(slot);

export const insideShape = (slot, x, y) => SHAPES[slot](x, y);

// The shape as one byte a pixel, 1 inside: what the pixel editor's mask is.
export function maskFor(slot) {
  const { width, height } = SIZES[slot];
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) mask[y * width + x] = SHAPES[slot](x, y) ? 1 : 0;
  }
  return mask;
}

// The bare shape, filled with one colour, as an SVG data address: what an
// avatar shows in a slot with nothing worn, and under the gear being drawn.
export function shapeSvg(slot, colour) {
  const { width, height } = SIZES[slot];
  const rects = [];
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (!SHAPES[slot](x, y)) { x += 1; continue; }
      const from = x;
      while (x < width && SHAPES[slot](x, y)) x += 1;
      rects.push(`<rect x="${from}" y="${y}" width="${x - from}" height="1"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" `
    + `width="${width}" height="${height}" shape-rendering="crispEdges" fill="${colour}">${rects.join('')}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
