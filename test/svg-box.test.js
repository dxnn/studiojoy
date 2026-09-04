// `svgBox`: how big a silhouette is drawn when somebody picks it off the
// shelf. The *big set*'s svgsilh half is kept as vectors — 2 KB rather than
// 40, and sharp at any size — so this is the arithmetic between an SVG in the
// repository and the PNG that lands in `assets/sprites/`.
//
// The rasterising itself needs a canvas and belongs in a browser; this is the
// half that decides the numbers, and every rule in it was paid for elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { svgBox } = await import('../public/story-guide.js');

const FIT = [256, 256];
const box = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path/></svg>`;

test('a square silhouette fills the fit', () => {
  assert.deepEqual(svgBox(box(64, 64), FIT), [256, 256]);
});

// Unlike asPng, which never scales up: a vector has no size of its own, so a
// 24-unit viewBox drawn at 24 pixels would be a speck.
test('a small viewBox is drawn big, not at its own numbers', () => {
  assert.deepEqual(svgBox(box(24, 24), FIT), [256, 256]);
});

test('a wide silhouette keeps its shape inside the fit', () => {
  assert.deepEqual(svgBox(box(600, 300), FIT), [255, 128]);
  assert.deepEqual(svgBox(box(300, 600), FIT), [128, 256]);
});

// ⚠️ The rule with teeth. 600x300 above is exactly 2:1, which the sprites
// library reads as a *strip* of square frames once the file is in
// assets/sprites/ — so it comes back one pixel narrower, and 255x128 is not
// a whole multiple of anything.
test('a shape that would animate is made one pixel narrower', () => {
  const [width, height] = svgBox(box(900, 300), FIT);
  assert.ok(!(width > height && width % height === 0), `${width}x${height} is not a strip`);
  // Taller than wide is never a strip, so nothing is shaved off one.
  assert.deepEqual(svgBox(box(300, 900), FIT), [85, 256]);
});

test('a viewBox written the other legal ways is still read', () => {
  // Commas rather than spaces, single quotes, and a leading offset that is
  // not the origin — all of which real files use.
  assert.deepEqual(svgBox("<svg viewBox='10,10,600,300'/>", FIT), [255, 128]);
  assert.deepEqual(svgBox('<svg viewBox = " -5 -5 64 64 "/>', FIT), [256, 256]);
});

// Wrong, but a picture — which beats an SVG with no size drawing as nothing,
// the trap the drawn stand-in already met.
test('an SVG with no viewBox comes out square rather than empty', () => {
  assert.deepEqual(svgBox('<svg><path/></svg>', FIT), [256, 256]);
  assert.deepEqual(svgBox('', FIT), [256, 256]);
});
