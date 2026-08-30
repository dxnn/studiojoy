// The control schemes: the physical shape a game declares in
// config/controls.js (ideas/control-schemes.md). Like input-template.test.js
// this runs the browser module in a vm, with pointer events faked as well as
// keys and pads; what is drawn on the screen needs a real browser and is
// checked there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseConfigFile } from '../public/config-file.js';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const INPUT = read('studio-lib/input/input.js');
const ONE_BUTTON = read('templates/controls-one-button.js');
const SWIPE_TAP = read('templates/controls-swipe-tap.js');
const SEED = read('templates/controls.js'); // the default: stick-buttons

// A controls.js from before schemes existed: no SCHEME anywhere.
const LEGACY = `
const CONTROLS = {
  player1: {
    left: "key:left touch:left",
    fire: "key:space touch:GO",
  },
};
`;

function boot({ controls, body = null } = {}) {
  const handlers = new Map();
  const warnings = [];
  const sandbox = {
    navigator: { getGamepads: () => [] },
    document: { body },
    matchMedia: () => ({ matches: false }),
    console: { warn: (...args) => warnings.push(args.join(' ')) },
    innerWidth: 800,
    innerHeight: 600,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (name, fn) => {
    if (!handlers.has(name)) handlers.set(name, []);
    handlers.get(name).push(fn);
  };
  const context = vm.createContext(sandbox);
  if (controls) vm.runInContext(controls, context);
  vm.runInContext(INPUT, context);

  const fire = (name, event) => (handlers.get(name) ?? []).forEach((fn) => fn(event));
  return {
    Input: sandbox.Input,
    warnings,
    pointer(name, { id = 1, type = 'touch', x = 0, y = 0, target = null } = {}) {
      const event = {
        pointerId: id, pointerType: type, clientX: x, clientY: y, target,
        prevented: false, preventDefault() { this.prevented = true; },
      };
      fire(name, event);
      return event;
    },
    key(name, down = true) {
      fire(down ? 'keydown' : 'keyup', { key: name, target: null, preventDefault() {} });
    },
  };
}

// A target that stands in for the game's own <button>.
const gameButton = { closest: (sel) => (sel.includes('button') ? {} : null) };

test('the one-button preset is readable as a config form', () => {
  const parsed = parseConfigFile(ONE_BUTTON);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['SCHEME', 'CONTROLS']);
});

test('one-button: a tap anywhere is the button, and start shares it', () => {
  const g = boot({ controls: ONE_BUTTON });
  g.Input.update();
  const down = g.pointer('pointerdown');
  assert.equal(down.prevented, true, 'the game surface swallows the press');
  g.Input.update();
  assert.equal(g.Input.pressed('action'), true);
  assert.equal(g.Input.pressed('start'), true, 'the same press starts the game');
  g.Input.update();
  assert.equal(g.Input.pressed('action'), false, 'a held press must not fire again');
  assert.equal(g.Input.held('action'), true);
  g.pointer('pointerup');
  g.Input.update();
  assert.equal(g.Input.released('action'), true);
});

test('one-button: held until the last finger lifts', () => {
  const g = boot({ controls: ONE_BUTTON });
  g.Input.update();
  g.pointer('pointerdown', { id: 1 });
  g.pointer('pointerdown', { id: 2 });
  g.pointer('pointerup', { id: 1 });
  g.Input.update();
  assert.equal(g.Input.held('action'), true, 'one finger is still down');
  g.pointer('pointerup', { id: 2 });
  g.Input.update();
  assert.equal(g.Input.held('action'), false);
});

test('one-button: a mouse click counts, a press on a real button does not', () => {
  const g = boot({ controls: ONE_BUTTON });
  g.Input.update();
  g.pointer('pointerdown', { type: 'mouse' });
  g.Input.update();
  assert.equal(g.Input.held('action'), true, 'a click is a tap');
  g.pointer('pointerup', { type: 'mouse' });
  g.Input.update();
  const down = g.pointer('pointerdown', { target: gameButton });
  g.Input.update();
  assert.equal(g.Input.held('action'), false, "the game's own buttons keep their presses");
  assert.equal(down.prevented, false);
});

test('the swipe-tap preset is readable as a config form', () => {
  const parsed = parseConfigFile(SWIPE_TAP);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['SCHEME', 'CONTROLS']);
});

test('swipe-tap: a flick is pressed for one frame and never held after it', () => {
  const g = boot({ controls: SWIPE_TAP });
  g.Input.update();
  g.pointer('pointerdown', { x: 200, y: 200 });
  g.pointer('pointerup', { x: 120, y: 210 });
  g.Input.update();
  assert.equal(g.Input.pressed('left'), true);
  g.Input.update();
  assert.equal(g.Input.pressed('left'), false, 'a flick happens once');
  assert.equal(g.Input.held('left'), false, 'a flick is not a state');
  assert.equal(g.Input.released('left'), true);
});

test('swipe-tap: the tallest travel wins the direction', () => {
  const g = boot({ controls: SWIPE_TAP });
  g.Input.update();
  g.pointer('pointerdown', { x: 100, y: 300 });
  g.pointer('pointerup', { x: 140, y: 180 });
  g.Input.update();
  assert.equal(g.Input.pressed('up'), true);
  assert.equal(g.Input.pressed('right'), false);
});

test('swipe-tap: a press that stays put is a tap, and taps start the game', () => {
  const g = boot({ controls: SWIPE_TAP });
  g.Input.update();
  g.pointer('pointerdown', { x: 100, y: 100 });
  g.pointer('pointerup', { x: 105, y: 108 });
  g.Input.update();
  assert.equal(g.Input.pressed('tap'), true);
  assert.equal(g.Input.pressed('start'), true);
  assert.equal(g.Input.pressed('left'), false);
});

test('swipe-tap: a gesture on a real button belongs to the button', () => {
  const g = boot({ controls: SWIPE_TAP });
  g.Input.update();
  g.pointer('pointerdown', { x: 100, y: 100, target: gameButton });
  g.pointer('pointerup', { x: 100, y: 100 });
  g.Input.update();
  assert.equal(g.Input.pressed('tap'), false);
});

// The default seed is the stick-buttons preset: the left thumb's slice of an
// 800×600 screen is x < 360, below y 240.
test('stick-buttons: the stick is analog, floating, and clamped', () => {
  const g = boot({ controls: SEED });
  g.Input.update();
  g.pointer('pointerdown', { x: 150, y: 500 });
  g.pointer('pointermove', { x: 178, y: 500 });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 0.5, 'half the radius is half the lean');
  assert.equal(g.Input.held('right'), true);
  assert.equal(g.Input.pressed('right'), true);
  g.pointer('pointermove', { x: 400, y: 520 });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 1, 'the lean stops at full tilt');
  g.pointer('pointerup', { x: 400, y: 520 });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 0);
  assert.equal(g.Input.released('right'), true);
});

test('stick-buttons: inside the deadzone the stick reads as resting', () => {
  const g = boot({ controls: SEED });
  g.Input.update();
  g.pointer('pointerdown', { x: 150, y: 500 });
  g.pointer('pointermove', { x: 160, y: 500 });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 0);
  assert.equal(g.Input.held('right'), false);
});

test('stick-buttons: only a thumb in the stick\'s slice takes the stick', () => {
  const g = boot({ controls: SEED });
  g.Input.update();
  g.pointer('pointerdown', { x: 150, y: 500, type: 'mouse' });
  g.pointer('pointermove', { x: 300, y: 500, type: 'mouse' });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 0, 'a mouse is not a stick');
  g.pointer('pointerdown', { x: 600, y: 500, id: 2 });
  g.pointer('pointermove', { x: 700, y: 500, id: 2 });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 0, "the right thumb's side is the buttons'");
  g.pointer('pointerdown', { x: 150, y: 100, id: 3 });
  g.pointer('pointermove', { x: 300, y: 100, id: 3 });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 0, 'the top of the screen is left alone');
});

test('stick-buttons: keys still give the ends, and player 2 never sees the stick', () => {
  const g = boot({ controls: SEED });
  g.Input.update();
  g.key('ArrowRight');
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 1);
  g.key('ArrowRight', false);
  g.pointer('pointerdown', { x: 150, y: 500 });
  g.pointer('pointermove', { x: 200, y: 500 });
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right', 2), 0, "the screen is player 1's");
});

test('a declared scheme owns the screen; the old shape leaves it alone', () => {
  const ownedBody = { style: {} };
  boot({ controls: ONE_BUTTON, body: ownedBody }).Input.update();
  assert.equal(ownedBody.style.touchAction, 'none');
  const legacyBody = { style: {} };
  boot({ controls: LEGACY, body: legacyBody }).Input.update();
  assert.equal(legacyBody.style.touchAction, undefined);
});

test('without a scheme, no whole-screen surface is installed', () => {
  const g = boot({ controls: LEGACY });
  g.Input.update();
  g.pointer('pointerdown');
  g.Input.update();
  assert.equal(g.Input.held('fire'), false);
});

test('an unknown scheme is said once and falls back to the old shape', () => {
  const g = boot({ controls: 'const SCHEME = "zorp";\n' + LEGACY });
  g.Input.update();
  g.Input.update();
  assert.equal(g.warnings.length, 1);
  assert.match(g.warnings[0], /zorp/);
});
