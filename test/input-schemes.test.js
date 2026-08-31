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
const DUAL_STICK = read('templates/controls-dual-stick.js');
const BUTTONS = read('templates/controls-buttons.js');

// A controls.js from before schemes existed: no SCHEME anywhere.
const LEGACY = `
const CONTROLS = {
  player1: {
    left: "key:left touch:left",
    fire: "key:space touch:GO",
  },
};
`;

// Enough of a DOM for the drawn buttons: elements that hold children and
// style properties, and a body with a classList for the screens-open mark.
// The hit-testing itself is arithmetic in input.js, so a fake this small
// exercises the real thumb behaviour; what it looks like needs a browser.
function fakeElement(tag) {
  const node = {
    tag,
    textContent: '',
    children: [],
    style: {},
    append(...kids) { node.children.push(...kids); },
    setAttribute() {},
    addEventListener() {},
    remove() {},
  };
  return node;
}

function fakeBody() {
  const classes = new Set();
  const body = fakeElement('body');
  body.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
  return body;
}

function boot({ controls, body = null, coarse = false } = {}) {
  const handlers = new Map();
  const warnings = [];
  const sandbox = {
    navigator: { getGamepads: () => [] },
    document: { body, createElement: fakeElement },
    matchMedia: (q) => ({ matches: coarse && q === '(pointer: coarse)' }),
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
    event: (name, data = {}) => fire(name, data),
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

test('the dual-stick preset is readable as a config form', () => {
  const parsed = parseConfigFile(DUAL_STICK);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['SCHEME', 'CONTROLS', 'STICK_DEADZONE']);
});

test('dual-stick: the right thumb aims, and pushing the aim stick fires', () => {
  const g = boot({ controls: DUAL_STICK });
  g.Input.update();
  g.pointer('pointerdown', { x: 600, y: 500 });
  g.pointer('pointermove', { x: 628, y: 500 });
  g.Input.update();
  assert.equal(g.Input.axis('aim-left', 'aim-right'), 0.5);
  assert.equal(g.Input.axis('left', 'right'), 0, 'the move stick is resting');
  assert.equal(g.Input.held('fire'), true, 'a pushed aim stick fires');
  assert.equal(g.Input.pressed('start'), true, 'and starts');
  g.pointer('pointermove', { x: 610, y: 500 });
  g.Input.update();
  assert.equal(g.Input.held('fire'), false, 'inside the deadzone nothing fires');
});

test('dual-stick: two thumbs work the two sticks at once', () => {
  const g = boot({ controls: DUAL_STICK });
  g.Input.update();
  g.pointer('pointerdown', { x: 150, y: 500, id: 1 });
  g.pointer('pointermove', { x: 150, y: 444, id: 1 });
  g.pointer('pointerdown', { x: 600, y: 500, id: 2 });
  g.pointer('pointermove', { x: 656, y: 500, id: 2 });
  g.Input.update();
  assert.equal(g.Input.axis('up', 'down'), -1, 'the left thumb moves');
  assert.equal(g.Input.axis('aim-left', 'aim-right'), 1, 'the right thumb aims');
  g.pointer('pointerup', { x: 150, y: 444, id: 1 });
  g.Input.update();
  assert.equal(g.Input.axis('up', 'down'), 0);
  assert.equal(g.Input.axis('aim-left', 'aim-right'), 1, 'the other thumb stays');
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

test('an unknown scheme is said once and falls back to the buttons shape', () => {
  const g = boot({ controls: 'const SCHEME = "zorp";\n' + LEGACY });
  g.Input.update();
  g.Input.update();
  assert.equal(g.warnings.length, 1);
  assert.match(g.warnings[0], /zorp/);
});

// The buttons shape on an 800×600 screen with the preset: the turn pair's
// centres are (66,534) and (174,534); the action diagonal climbs from the
// right corner — THRUST at (734,534), FIRE above it at (678,458).
const bootButtons = (controls = BUTTONS) => {
  const body = fakeBody();
  const g = boot({ controls, body, coarse: true });
  g.body = body;
  g.overlay = () => body.children.find((el) => el.id === 'touch-controls');
  return g;
};

test('the buttons preset is readable as a config form', () => {
  const parsed = parseConfigFile(BUTTONS);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['SCHEME', 'CONTROLS', 'BUTTON_SIDE']);
});

test('buttons: a drawn button is held while a thumb is on it, halo included', () => {
  const g = bootButtons();
  g.Input.update();
  const down = g.pointer('pointerdown', { x: 66, y: 534 });
  assert.equal(down.prevented, true, 'a press on a control is not a scroll');
  g.Input.update();
  assert.equal(g.Input.held('left'), true);
  g.pointer('pointerup', { x: 66, y: 534 });
  g.Input.update();
  assert.equal(g.Input.released('left'), true);
  g.pointer('pointerdown', { x: 66, y: 589, id: 2 });
  g.Input.update();
  assert.equal(g.Input.held('left'), true, 'the halo catches a near miss');
  const off = g.pointer('pointerdown', { x: 400, y: 300, id: 3 });
  assert.equal(off.prevented, false, 'the rest of the screen stays the game\'s');
});

test('buttons: a thumb rocks between neighbours without lifting', () => {
  const g = bootButtons();
  g.Input.update();
  g.pointer('pointerdown', { x: 66, y: 534 });
  g.Input.update();
  assert.equal(g.Input.held('left'), true);
  g.pointer('pointermove', { x: 174, y: 534 });
  g.Input.update();
  assert.equal(g.Input.held('left'), false, 'the thumb left the first button');
  assert.equal(g.Input.held('right'), true, 'and pressed the next without a lift');
  g.pointer('pointermove', { x: 400, y: 300 });
  g.Input.update();
  assert.equal(g.Input.held('right'), false, 'sliding off everything releases');
  g.pointer('pointermove', { x: 174, y: 534 });
  g.Input.update();
  assert.equal(g.Input.held('right'), true, 'and sliding back on presses again');
});

test('buttons: two thumbs hold two buttons, and one lift releases one', () => {
  const g = bootButtons();
  g.Input.update();
  g.pointer('pointerdown', { x: 66, y: 534, id: 1 });
  g.pointer('pointerdown', { x: 734, y: 534, id: 2 });
  g.Input.update();
  assert.equal(g.Input.held('left'), true);
  assert.equal(g.Input.held('thrust'), true);
  g.pointer('pointerup', { x: 66, y: 534, id: 1 });
  g.Input.update();
  assert.equal(g.Input.held('left'), false);
  assert.equal(g.Input.held('thrust'), true, 'the other thumb is still down');
});

test('toggle: a tap latches, held() stays on, a second tap unlatches', () => {
  const g = bootButtons();
  g.Input.update();
  g.pointer('pointerdown', { x: 678, y: 458 });
  g.pointer('pointerup', { x: 678, y: 458 });
  g.Input.update();
  assert.equal(g.Input.pressed('fire'), true);
  g.Input.update();
  assert.equal(g.Input.held('fire'), true, 'latched after the finger lifted');
  assert.equal(g.Input.pressed('fire'), false);
  g.pointer('pointerdown', { x: 678, y: 458 });
  g.pointer('pointerup', { x: 678, y: 458 });
  g.Input.update();
  assert.equal(g.Input.released('fire'), true);
  assert.equal(g.Input.held('fire'), false);
});

test('toggle: sliding onto it changes nothing, and off it drops the old button', () => {
  const g = bootButtons();
  g.Input.update();
  g.pointer('pointerdown', { x: 734, y: 534 });
  g.Input.update();
  assert.equal(g.Input.held('thrust'), true);
  g.pointer('pointermove', { x: 678, y: 458 });
  g.Input.update();
  assert.equal(g.Input.held('thrust'), false, 'the thumb left the thrust button');
  assert.equal(g.Input.held('fire'), false, 'a slide never flips a latch');
});

test('toggle: latches drop when the window loses focus', () => {
  const g = bootButtons();
  g.Input.update();
  g.pointer('pointerdown', { x: 678, y: 458 });
  g.pointer('pointerup', { x: 678, y: 458 });
  g.Input.update();
  assert.equal(g.Input.held('fire'), true);
  g.event('blur');
  g.Input.update();
  assert.equal(g.Input.held('fire'), false);
});

test('BUTTON_SIDE = "left" mirrors the whole layout', () => {
  const g = bootButtons(BUTTONS.replace('const BUTTON_SIDE = "right"', 'const BUTTON_SIDE = "left"'));
  g.Input.update();
  g.pointer('pointerdown', { x: 66, y: 534, id: 1 });
  g.Input.update();
  assert.equal(g.Input.held('thrust'), true, 'the action diagonal moved left');
  g.pointer('pointerdown', { x: 626, y: 534, id: 2 });
  g.Input.update();
  assert.equal(g.Input.held('left'), true, 'the turn pair moved right, ← still left of →');
  g.pointer('pointerdown', { x: 734, y: 534, id: 3 });
  g.Input.update();
  assert.equal(g.Input.held('right'), true);
});

test('a Screens screen hides the controls, drops thumbs and latches', () => {
  const g = bootButtons();
  g.Input.update();
  g.pointer('pointerdown', { x: 678, y: 458 });
  g.pointer('pointerup', { x: 678, y: 458 });
  g.pointer('pointerdown', { x: 66, y: 534, id: 2 });
  g.Input.update();
  assert.equal(g.Input.held('fire'), true);
  assert.equal(g.Input.held('left'), true);
  g.body.classList.add('screens-open');
  g.Input.update();
  assert.equal(g.overlay().style.display, 'none');
  assert.equal(g.Input.held('fire'), false, 'the latch dropped');
  assert.equal(g.Input.held('left'), false, 'the thumb was released');
  const down = g.pointer('pointerdown', { x: 66, y: 534, id: 3 });
  g.Input.update();
  assert.equal(g.Input.held('left'), false, 'hidden buttons take no presses');
  assert.equal(down.prevented, false);
  g.body.classList.remove('screens-open');
  g.Input.update();
  assert.equal(g.overlay().style.display, '', 'the controls come back with the game');
});

test("the Screens start button reaches the game as one frame of start", () => {
  const g = bootButtons();
  g.Input.update();
  g.event('studio:start');
  g.Input.update();
  assert.equal(g.Input.pressed('start'), true);
  g.Input.update();
  assert.equal(g.Input.pressed('start'), false);
  assert.equal(g.Input.held('start'), false);
});

test('no SCHEME draws the same buttons shape: the arrow and GO still work', () => {
  const body = fakeBody();
  const g = boot({ controls: LEGACY, body, coarse: true });
  g.Input.update();
  g.pointer('pointerdown', { x: 734, y: 534, id: 1 });
  g.pointer('pointerdown', { x: 66, y: 534, id: 2 });
  g.Input.update();
  assert.equal(g.Input.held('fire'), true, 'GO is the primary action button');
  assert.equal(g.Input.held('left'), true);
});
