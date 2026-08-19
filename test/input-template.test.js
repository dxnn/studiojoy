// The input module every game gets a copy of. It is browser code, so it runs
// here in a vm with the few globals it touches faked: enough to check what a
// game actually depends on — that held/pressed/released mean what they say,
// that a controller and a keyboard land on the same action, and that player
// two reads its own bindings. The on-screen buttons need a real browser and
// are checked there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseConfigFile } from '../public/config-file.js';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
// The module is a studio library; the bindings are the game's own, seeded once.
const INPUT = read('studio-lib/input/input.js');
const CONTROLS = read('templates/controls.js');

const button = (pressed) => ({ pressed, value: pressed ? 1 : 0 });

// A controller in the standard layout with nothing pressed.
const pad = (over = {}) => ({
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 16 }, () => button(false)),
  ...over,
});

function boot({ controls = CONTROLS, pads = [] } = {}) {
  const handlers = new Map();
  const state = { pads };
  const sandbox = {
    navigator: { getGamepads: () => state.pads },
    // No body, and no coarse pointer, so the touch overlay is never built.
    document: { body: null },
    matchMedia: () => ({ matches: false }),
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
    setPads(next) { state.pads = next; },
    key(name, down = true) {
      const event = { key: name, target: null, prevented: false, preventDefault() { this.prevented = true; } };
      fire(down ? 'keydown' : 'keyup', event);
      return event;
    },
    type(name) {
      const event = { key: name, target: { tagName: 'INPUT' }, prevented: false, preventDefault() { this.prevented = true; } };
      fire('keydown', event);
      return event;
    },
    blur() { fire('blur', {}); },
  };
}

test('the controls template is readable as a config form', () => {
  const parsed = parseConfigFile(CONTROLS);
  assert.equal(parsed.ok, true, parsed.reason);
  const names = parsed.decls.map((d) => d.name);
  assert.deepEqual(names, ['CONTROLS', 'STICK_DEADZONE']);
  // The comment beside each action is the whole point of the file.
  const player1 = parsed.decls[0].node.props.find((p) => p.key === 'player1').node;
  assert.equal(player1.props.find((p) => p.key === 'fire').node.comment, 'the main button');
});

test('a held key is held until it is let go', () => {
  const g = boot();
  g.key('ArrowLeft');
  g.Input.update();
  assert.equal(g.Input.held('left'), true);
  g.Input.update();
  assert.equal(g.Input.held('left'), true);
  g.key('ArrowLeft', false);
  g.Input.update();
  assert.equal(g.Input.held('left'), false);
});

test('pressed is true on one frame only, and released on the frame it goes up', () => {
  const g = boot();
  g.key(' ');
  g.Input.update();
  assert.equal(g.Input.pressed('fire'), true);
  g.Input.update();
  assert.equal(g.Input.pressed('fire'), false, 'a held key must not fire again');
  assert.equal(g.Input.held('fire'), true);
  g.key(' ', false);
  g.Input.update();
  assert.equal(g.Input.released('fire'), true);
  g.Input.update();
  assert.equal(g.Input.released('fire'), false);
});

test('player two reads its own keys and leaves player one alone', () => {
  const g = boot();
  g.key('j');
  g.Input.update();
  assert.equal(g.Input.held('left', 2), true);
  assert.equal(g.Input.held('left'), false);
  assert.equal(g.Input.held('left', 1), false);
});

test('a controller button reaches the same action as the key', () => {
  const g = boot();
  const one = pad();
  one.buttons[0] = button(true); // pad:a — fire
  g.setPads([one]);
  g.Input.update();
  assert.equal(g.Input.held('fire'), true);
  assert.equal(g.Input.pressed('fire'), true);
});

test('the second controller is player two, whichever socket it is in', () => {
  const g = boot();
  const two = pad();
  two.buttons[14] = button(true); // pad:left
  g.setPads([pad(), two]);
  g.Input.update();
  assert.equal(g.Input.held('left', 2), true);
  assert.equal(g.Input.held('left', 1), false);
});

test('a stick past the deadzone gives an analog axis, and inside it gives nothing', () => {
  const g = boot();
  const one = pad({ axes: [0.6, 0, 0, 0] });
  g.setPads([one]);
  g.Input.update();
  assert.equal(Math.abs(g.Input.axis('left', 'right') - 0.6) < 1e-9, true);
  assert.equal(g.Input.held('right'), true);

  one.axes[0] = 0.2; // resting drift, under STICK_DEADZONE
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 0);
  assert.equal(g.Input.held('right'), false);

  one.axes[0] = -0.9;
  g.Input.update();
  assert.equal(Math.abs(g.Input.axis('left', 'right') + 0.9) < 1e-9, true);
  assert.equal(g.Input.held('left'), true);
});

test('the axis falls back to the ends when it comes from a key', () => {
  const g = boot();
  g.key('d');
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), 1);
  g.key('d', false);
  g.key('a');
  g.Input.update();
  assert.equal(g.Input.axis('left', 'right'), -1);
});

test('losing the window lets go of everything', () => {
  const g = boot();
  g.key('ArrowLeft');
  g.Input.update();
  assert.equal(g.Input.held('left'), true);
  g.blur();
  g.Input.update();
  assert.equal(g.Input.held('left'), false);
});

test('a bound key stops the page scrolling, and an unbound one is left alone', () => {
  const g = boot();
  assert.equal(g.key('ArrowLeft').prevented, true);
  assert.equal(g.key(' ').prevented, true);
  assert.equal(g.key('q').prevented, false);
});

test('typing in a box is not playing the game', () => {
  const g = boot();
  const event = g.type('ArrowLeft');
  assert.equal(event.prevented, false);
  g.Input.update();
  assert.equal(g.Input.held('left'), false);
});

// The template writes one line per action because the config form shows that
// as one field. A helper writing the file by hand is as likely to reach for a
// list, and a game that stopped taking input over that would be a bad trade.
test('bindings written as a list work as well as a line', () => {
  const g = boot({
    controls: 'const CONTROLS = { player1: { fire: ["key:z", "pad:a"], left: "key:q" } };',
  });
  g.key('z');
  g.Input.update();
  assert.equal(g.Input.held('fire'), true);
  g.key('z', false);
  g.key('q');
  g.Input.update();
  assert.equal(g.Input.held('left'), true);
});

test('a game with no controls file still plays', () => {
  const g = boot({ controls: null });
  g.key('w');
  g.Input.update();
  assert.equal(g.Input.held('up'), true);
  assert.equal(g.Input.pads(), 0);
});
