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
const LEGACY = read('templates/controls.js');

function boot({ controls, body = null } = {}) {
  const handlers = new Map();
  const warnings = [];
  const sandbox = {
    navigator: { getGamepads: () => [] },
    document: { body },
    matchMedia: () => ({ matches: false }),
    console: { warn: (...args) => warnings.push(args.join(' ')) },
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
