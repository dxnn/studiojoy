// The sprite drawer every game gets a copy of. Browser code, so it runs here
// in a vm with a fake Image and a fake 2d context: enough to check what a
// game depends on — that a strip's frames come out in order and on time,
// that a still-loading picture draws nothing rather than throwing, and that
// a missing file is one warning. What it looks like needs a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SPRITES = fs.readFileSync(
  new URL('../public/studio-lib/sprites/sprites.js', import.meta.url), 'utf8',
);

function boot() {
  const made = [];
  const warnings = [];
  class FakeImage {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.handlers = new Map();
      made.push(this);
    }

    addEventListener(name, fn) {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push(fn);
    }

    // Test-side: the file arrived at this size.
    arrive(width, height) {
      this.width = width;
      this.height = height;
      (this.handlers.get('load') ?? []).forEach((fn) => fn());
    }

    fail() { (this.handlers.get('error') ?? []).forEach((fn) => fn()); }
  }

  const draws = [];
  const ops = [];
  const ctx = {
    imageSmoothingEnabled: true,
    drawImage(...args) { draws.push(args); ops.push(['drawImage']); },
    save() { ops.push(['save']); },
    restore() { ops.push(['restore']); },
    translate(x, y) { ops.push(['translate', x, y]); },
    scale(x, y) { ops.push(['scale', x, y]); },
  };

  const sandbox = { Image: FakeImage, console: { warn: (msg) => warnings.push(msg) } };
  sandbox.window = sandbox;
  vm.runInContext(SPRITES, vm.createContext(sandbox));
  return {
    Sprites: sandbox.Sprites, made, warnings, ctx, draws, ops,
  };
}

test('a plain name is a png in assets/, a path is itself', () => {
  const { Sprites, made, ctx } = boot();
  Sprites.draw(ctx, 'hero', 0, 0);
  Sprites.draw(ctx, 'assets/big backdrop.jpeg', 0, 0);
  assert.deepEqual(made.map((i) => i.src), ['assets/hero.png', 'assets/big backdrop.jpeg']);
});

test('a picture still loading draws nothing and never throws', () => {
  const { Sprites, ctx, draws } = boot();
  Sprites.draw(ctx, 'hero', 10, 10);
  assert.equal(draws.length, 0);
});

test('a strip plays its square frames in order, on the shared clock', () => {
  const { Sprites, made, ctx, draws } = boot();
  Sprites.draw(ctx, 'hero', 0, 0); // starts the load
  made[0].arrive(64, 16); // four 16x16 frames

  Sprites.draw(ctx, 'hero', 5, 7);
  // Default 8 fps at sixty ticks a second: frame 1 starts on tick 8.
  for (let i = 0; i < 8; i += 1) Sprites.tick();
  Sprites.draw(ctx, 'hero', 5, 7);

  // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  assert.deepEqual(draws[0].slice(1), [0, 0, 16, 16, 5, 7, 16, 16]);
  assert.deepEqual(draws[1].slice(1), [16, 0, 16, 16, 5, 7, 16, 16]);
  assert.equal(ctx.imageSmoothingEnabled, false, 'pixels stay square');
});

test('frame pins, fps changes speed, and the cycle wraps', () => {
  const { Sprites, made, ctx, draws } = boot();
  Sprites.draw(ctx, 'hero', 0, 0);
  made[0].arrive(64, 16);

  Sprites.draw(ctx, 'hero', 0, 0, { frame: 6 });
  assert.equal(draws[0][1], 32, 'frame 6 of 4 wraps to frame 2');

  for (let i = 0; i < 4; i += 1) Sprites.tick();
  Sprites.draw(ctx, 'hero', 0, 0, { fps: 30 });
  assert.equal(draws[1][1], 32, '4 ticks at 30 fps is frame 2');
});

test('any other shape is one frame drawn whole, unless frames says otherwise', () => {
  const { Sprites, made, ctx, draws } = boot();
  Sprites.draw(ctx, 'backdrop', 0, 0);
  made[0].arrive(320, 180); // wide, not a multiple: a single picture
  for (let i = 0; i < 30; i += 1) Sprites.tick();
  Sprites.draw(ctx, 'backdrop', 0, 0);
  assert.deepEqual(draws[0].slice(1), [0, 0, 320, 180, 0, 0, 320, 180]);

  // A non-square strip declares its count in the call.
  Sprites.draw(ctx, 'tall', 0, 0);
  made[1].arrive(64, 24);
  Sprites.draw(ctx, 'tall', 0, 0, { frames: 4, frame: 1 });
  assert.deepEqual(draws[1].slice(1), [16, 0, 16, 24, 0, 0, 16, 24]);
});

test('scale enlarges the destination, flip mirrors around it', () => {
  const { Sprites, made, ctx, draws, ops } = boot();
  Sprites.draw(ctx, 'hero', 0, 0);
  made[0].arrive(64, 16);

  Sprites.draw(ctx, 'hero', 5, 7, { frame: 0, scale: 2 });
  assert.deepEqual(draws[0].slice(1), [0, 0, 16, 16, 5, 7, 32, 32]);

  ops.length = 0;
  Sprites.draw(ctx, 'hero', 5, 7, { frame: 0, flip: true });
  assert.deepEqual(ops.map((o) => o[0]), ['save', 'translate', 'scale', 'drawImage', 'restore']);
  assert.deepEqual(ops[1], ['translate', 5 + 16, 7]);
  assert.deepEqual(ops[2], ['scale', -1, 1]);
});

test('a file that cannot load warns once and stays silent', () => {
  const { Sprites, made, ctx, draws, warnings } = boot();
  Sprites.draw(ctx, 'ghost', 0, 0);
  made[0].fail();
  made[0].fail();
  Sprites.draw(ctx, 'ghost', 0, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /assets\/ghost\.png/);
  assert.equal(draws.length, 0);
});
