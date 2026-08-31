// The screens library every game gets a copy of — for now Screens.hint(),
// the how-to-play line derived from config/controls.js and the device.
// Browser code, so like the input tests it runs in a vm, with the device
// faked through matchMedia and getGamepads; that the words fit on a title
// screen needs a real browser and eyes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const SCREENS = read('studio-lib/screens/screens.js');
const SEED = read('templates/controls.js'); // the default: stick-buttons
const ONE_BUTTON = read('templates/controls-one-button.js');
const SWIPE_TAP = read('templates/controls-swipe-tap.js');
const DUAL_STICK = read('templates/controls-dual-stick.js');

// A controls.js from before schemes existed: touch: directions drawn as the
// arrow pad, and no SCHEME anywhere.
const LEGACY = `
const CONTROLS = {
  player1: {
    left: "key:left touch:left",
    right: "key:right touch:right",
    fire: "key:space touch:GO",
  },
};
`;

function boot({ controls = '', words = '', coarse = false, pads = [] } = {}) {
  const sandbox = {
    navigator: { getGamepads: () => pads },
    matchMedia: (q) => ({ matches: coarse && q === '(pointer: coarse)' }),
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${controls}\n${words}\n${SCREENS}`, sandbox);
  return sandbox.window.Screens;
}

test('the seed on a keyboard: arrows, WASD and the named keys', () => {
  assert.equal(
    boot({ controls: SEED }).hint(),
    'Arrows / WASD to move · Space to fire · Shift to boost',
  );
});

test('a plugged-in controller is folded into each clause', () => {
  assert.equal(
    boot({ controls: SEED, pads: [{}] }).hint(),
    'Arrows / WASD or the stick to move · Space or A to fire · Shift or B to boost',
  );
});

test('stick-buttons on a touchscreen: the stick and the drawn button', () => {
  assert.equal(
    boot({ controls: SEED, coarse: true }).hint(),
    'Push the stick to move · GO to fire',
  );
});

test('one-button on a touchscreen: tap anywhere, no verb for "action"', () => {
  assert.equal(boot({ controls: ONE_BUTTON, coarse: true }).hint(), 'Tap anywhere');
});

test('swipe-tap on a touchscreen: swipes and a tap', () => {
  assert.equal(boot({ controls: SWIPE_TAP, coarse: true }).hint(), 'Swipe to move · tap');
});

test('dual-stick on a touchscreen: both sticks, fire folded into aim', () => {
  assert.equal(
    boot({ controls: DUAL_STICK, coarse: true }).hint(),
    'Push the left stick to move · the right stick to aim and fire',
  );
});

test('dual-stick on a keyboard: two direction groups, said apart', () => {
  assert.equal(
    boot({ controls: DUAL_STICK }).hint(),
    'WASD to move · Arrows to aim · Space to fire',
  );
});

test('a controls.js from before schemes: the arrow pad and the button', () => {
  assert.equal(
    boot({ controls: LEGACY, coarse: true }).hint(),
    'Arrows to move · GO to fire',
  );
});

test('a renamed verb renames the hint', () => {
  const controls = 'const CONTROLS = { player1: { plant: "key:e touch:DIG" } };';
  assert.equal(boot({ controls }).hint(), 'E to plant');
  assert.equal(boot({ controls, coarse: true }).hint(), 'DIG to plant');
});

test('WORDS.howToPlay wins as written, on every device', () => {
  const words = 'const WORDS = { howToPlay: "steer with one finger" };';
  assert.equal(boot({ controls: SEED, words }).hint(), 'steer with one finger');
  assert.equal(boot({ controls: SEED, words, coarse: true }).hint(), 'steer with one finger');
});

test('missing pieces are an empty string, never an error', () => {
  assert.equal(boot().hint(), '', 'no controls.js at all');
  assert.equal(
    boot({ controls: 'const CONTROLS = { player1: { fire: "touch:GO" } };' }).hint(),
    '', 'nothing for a keyboard',
  );
  assert.equal(
    boot({ controls: 'const CONTROLS = { player1: { fire: "key:space" } };', coarse: true }).hint(),
    '', 'nothing for a touchscreen',
  );
});
