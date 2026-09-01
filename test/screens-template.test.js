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

// Enough of a DOM for title(): elements that hold their children, style
// properties, handlers and focus, under a document with a head, a body and
// a page title. What the screen looks like needs a real browser.
function fakeDom() {
  function element(tag) {
    const node = {
      tag,
      className: '',
      textContent: '',
      children: [],
      parent: null,
      styleProps: {},
      style: { setProperty: (k, v) => { node.styleProps[k] = v; } },
      handlers: new Map(),
      focused: false,
      append(...kids) {
        for (const kid of kids) { kid.parent = node; node.children.push(kid); }
      },
      remove() {
        if (!node.parent) return;
        const at = node.parent.children.indexOf(node);
        if (at >= 0) node.parent.children.splice(at, 1);
        node.parent = null;
      },
      addEventListener(name, fn) { node.handlers.set(name, fn); },
      click() { if (node.handlers.has('click')) node.handlers.get('click')(); },
      focus() { node.focused = true; },
    };
    return node;
  }
  const body = element('body');
  const classes = new Set();
  body.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
  return {
    title: 'Page Title',
    head: element('head'),
    body,
    createElement: element,
  };
}

// Depth-first, so "the .screens-name" is one line in a test.
function find(node, className) {
  for (const kid of node.children) {
    if (kid.className === className) return kid;
    const deeper = find(kid, className);
    if (deeper) return deeper;
  }
  return null;
}

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

// title() needs the fake DOM; hands back the document beside the library,
// and what the library dispatched on the window (the start relay).
function bootDom(opts = {}) {
  const dispatched = [];
  // The window's own listeners, so the capture-phase key handler the title
  // screen puts up can be fired and checked for being taken away again.
  const listeners = new Set();
  const sandbox = {
    navigator: { getGamepads: () => (opts.pads || []) },
    matchMedia: (q) => ({ matches: !!opts.coarse && q === '(pointer: coarse)' }),
    console,
    document: fakeDom(),
    Event: function Event(type) { this.type = type; },
    dispatchEvent: (e) => dispatched.push(e.type),
    addEventListener: (name, fn) => { if (name === 'keydown') listeners.add(fn); },
    removeEventListener: (name, fn) => { listeners.delete(fn); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${opts.controls || ''}\n${opts.words || ''}\n${opts.look || ''}\n${SCREENS}`, sandbox);
  // One keydown as the browser would deliver it, with the two things the
  // handler is allowed to call on it recorded.
  const press = (key) => {
    const event = {
      key,
      prevented: false,
      stopped: false,
      preventDefault() { event.prevented = true; },
      stopPropagation() { event.stopped = true; },
    };
    for (const fn of [...listeners]) fn(event);
    return event;
  };
  return {
    Screens: sandbox.window.Screens,
    document: sandbox.document,
    dispatched,
    press,
    keyHandlers: listeners,
  };
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

test('title() builds the screen from config: name, tagline, button, hint', () => {
  const { Screens, document } = bootDom({
    controls: SEED,
    words: 'const WORDS = { title: "Asteriskoids", tagline: "pew pew", start: "Go" };',
  });
  Screens.title({});
  assert.equal(document.body.children.length, 1);
  const root = document.body.children[0];
  assert.equal(root.className, 'screens-title-screen');
  assert.equal(find(root, 'screens-name').textContent, 'Asteriskoids');
  assert.equal(find(root, 'screens-name').tag, 'h1');
  assert.equal(find(root, 'screens-tagline').textContent, 'pew pew');
  assert.equal(find(root, 'screens-start').textContent, 'Go');
  assert.equal(
    find(root, 'screens-hint').textContent,
    'Arrows / WASD to move · Space to fire · Shift to boost',
  );
  assert.equal(find(root, 'screens-score'), null, 'no score row without a score');
  assert.equal(find(root, 'screens-start').focused, true, 'Enter starts on a keyboard');
  assert.equal(document.head.children.length, 1, 'the stylesheet is injected');
  assert.equal(document.head.children[0].tag, 'style');
});

test('title() falls back to the page title and a plain Start', () => {
  const { Screens, document } = bootDom({});
  Screens.title({});
  const root = document.body.children[0];
  assert.equal(find(root, 'screens-name').textContent, 'Page Title');
  assert.equal(find(root, 'screens-start').textContent, 'Start');
  assert.equal(find(root, 'screens-tagline'), null);
  assert.equal(find(root, 'screens-hint'), null, 'no controls.js, no hint row');
});

test('a score makes it game over: the number big, the button Play again', () => {
  const { Screens, document } = bootDom({});
  Screens.title({ score: 420 });
  const root = document.body.children[0];
  assert.equal(find(root, 'screens-score').textContent, '420');
  assert.equal(find(root, 'screens-start').textContent, 'Play again');
  const again = bootDom({ words: 'const WORDS = { again: "Once more" };' });
  again.Screens.title({ score: 0 });
  assert.equal(find(again.document.body.children[0], 'screens-start').textContent, 'Once more');
});

test('arguments beat config, and an empty hint hides the row', () => {
  const { Screens, document } = bootDom({
    controls: SEED,
    words: 'const WORDS = { title: "Config", tagline: "config", start: "Config" };',
  });
  Screens.title({ name: 'Passed', tagline: 'passed', start: 'Passed', hint: '' });
  const root = document.body.children[0];
  assert.equal(find(root, 'screens-name').textContent, 'Passed');
  assert.equal(find(root, 'screens-tagline').textContent, 'passed');
  assert.equal(find(root, 'screens-start').textContent, 'Passed');
  assert.equal(find(root, 'screens-hint'), null);
});

test('the button closes the screen first, then calls onStart', () => {
  const { Screens, document } = bootDom({});
  let bodyWhenStarted = null;
  Screens.title({ onStart: () => { bodyWhenStarted = document.body.children.length; } });
  find(document.body.children[0], 'screens-start').click();
  assert.equal(bodyWhenStarted, 0, 'gone before onStart runs');
  assert.equal(document.body.children.length, 0);
});

test('one title screen at a time, and close() is safe to call twice', () => {
  const { Screens, document } = bootDom({});
  const first = Screens.title({ name: 'One' });
  Screens.title({ name: 'Two' });
  assert.equal(document.body.children.length, 1, 'the new call replaced the old screen');
  assert.equal(find(document.body.children[0], 'screens-name').textContent, 'Two');
  first.close();
  assert.equal(document.body.children.length, 1, 'a stale handle cannot close the new screen');
  assert.equal(document.head.children.length, 1, 'the stylesheet is injected once');
  const second = Screens.title({ name: 'Three' });
  second.close();
  second.close();
  assert.equal(document.body.children.length, 0);
});

test('LOOK colours the screen through custom properties', () => {
  const { Screens, document } = bootDom({
    look: 'const LOOK = { primary: "#0ff", highlight: "#fd6", deep: "#101", accent: 7 };',
  });
  Screens.title({});
  const root = document.body.children[0];
  assert.equal(root.styleProps['--screens-primary'], '#0ff');
  assert.equal(root.styleProps['--screens-highlight'], '#fd6');
  assert.equal(root.styleProps['--screens-deep'], '#101');
  assert.equal('--screens-accent' in root.styleProps, false, 'a non-string is left alone');
});

test('title() without a document is quiet', () => {
  const Screens = boot({ controls: SEED });
  const handle = Screens.title({ onStart: () => {} });
  handle.close();
  assert.equal(typeof handle.close, 'function');
});

test('chips() builds the strip once and touches only changed text', () => {
  const { Screens, document } = bootDom({});
  Screens.chips({ Score: 0, Lives: 3 });
  assert.equal(document.body.children.length, 1);
  const root = document.body.children[0];
  assert.equal(root.className, 'screens-chips');
  assert.equal(root.children.length, 2);
  const score = root.children[0];
  assert.equal(find(score, 'screens-chip-label').textContent, 'Score');
  assert.equal(find(score, 'screens-chip-value').textContent, '0');
  Screens.chips({ Score: 150, Lives: 3 });
  assert.equal(document.body.children.length, 1, 'the strip is not rebuilt');
  assert.equal(root.children[0], score, 'the same chip node is kept');
  assert.equal(find(score, 'screens-chip-value').textContent, '150');
  assert.equal(document.head.children.length, 1, 'one stylesheet, shared with title()');
});

test('each chips() call says the whole strip', () => {
  const { Screens, document } = bootDom({});
  Screens.chips({ Score: 1 });
  Screens.chips({ Score: 2, Combo: 'x3' });
  const root = document.body.children[0];
  assert.equal(root.children.length, 2, 'a new key grows a chip');
  assert.equal(find(root, 'screens-chip-value').textContent, '2');
  Screens.chips({ Score: 2 });
  assert.equal(root.children.length, 1, 'a key not named again is removed');
  Screens.chips({});
  assert.equal(document.body.children.length, 0, 'chips({}) clears the strip');
  Screens.chips({ Score: 9 });
  assert.equal(document.body.children.length, 1, 'and it comes back on the next call');
});

test('chips wear the look, and without a document stay quiet', () => {
  const withLook = bootDom({ look: 'const LOOK = { highlight: "#fd6" };' });
  withLook.Screens.chips({ Score: 1 });
  assert.equal(
    withLook.document.body.children[0].styleProps['--screens-highlight'], '#fd6',
  );
  const bare = boot({ controls: SEED });
  bare.chips({ Score: 1 });
  bare.chips({});
});

test('a title screen marks the body, so the drawn controls step aside', () => {
  const { Screens, document } = bootDom({});
  const first = Screens.title({});
  assert.equal(document.body.classList.contains('screens-open'), true);
  Screens.title({ score: 3 });
  assert.equal(document.body.classList.contains('screens-open'), true,
    'replacing one screen with another never unmarks');
  first.close();
  assert.equal(document.body.classList.contains('screens-open'), true,
    'a stale handle cannot unmark the new screen');
  Screens.title({}).close();
  assert.equal(document.body.classList.contains('screens-open'), false);
});

test('the Start button says start to the input library, after closing', () => {
  const { Screens, document, dispatched } = bootDom({});
  let startsWhenCalled = null;
  Screens.title({ onStart: () => { startsWhenCalled = dispatched.length; } });
  find(document.body.children[0], 'screens-start').click();
  assert.deepEqual(dispatched, ['studio:start']);
  assert.equal(startsWhenCalled, 1, 'the relay is out before onStart runs');
  assert.equal(document.body.classList.contains('screens-open'), false);
});

test('a toggle: binding is a drawn button in the hint too', () => {
  const controls = 'const CONTROLS = { player1: { thrust: "key:up toggle:BURN" } };';
  assert.equal(boot({ controls, coarse: true }).hint(), 'BURN to thrust');
});

test('a button wearing its own verb is not spelled twice', () => {
  const controls = 'const CONTROLS = { player1: { fire: "key:space toggle:FIRE" } };';
  assert.equal(boot({ controls, coarse: true }).hint(), 'FIRE');
});

test('the buttons preset on a touchscreen', () => {
  assert.equal(
    boot({ controls: read('templates/controls-buttons.js'), coarse: true }).hint(),
    'Arrows to move · THRUST · FIRE',
  );
});

// ⚠️ The reason this is a listener at all rather than the focused button doing
// its own job: the input library binds key:enter to start and key:space to
// fire, and calls preventDefault on every bound key from a bubble-phase
// listener on the window — so a focused button never saw the key that was
// meant to press it, and the title screen was mouse-only in every game that
// loads input.js.
test('Enter and Space press the Start button, and let go with the screen', () => {
  const { Screens, press, keyHandlers } = bootDom();
  let started = 0;
  const handle = Screens.title({ onStart: () => { started += 1; } });
  assert.equal(keyHandlers.size, 1, 'one handler while a screen is up');

  const enter = press('Enter');
  assert.equal(started, 1);
  assert.ok(enter.prevented, 'and takes the default, so a button is not pressed twice');
  assert.ok(enter.stopped);
  assert.equal(keyHandlers.size, 0, 'the screen closed and took its handler away');

  // Nothing else reaches it.
  const again = bootDom();
  let count = 0;
  again.Screens.title({ onStart: () => { count += 1; } });
  const other = again.press('a');
  assert.equal(count, 0);
  assert.ok(!other.prevented, 'a key the screen does not want is left alone');
  again.press(' ');
  assert.equal(count, 1, 'Space presses it too');

  // Closing by hand takes the handler with it.
  const third = bootDom();
  let never = 0;
  third.Screens.title({ onStart: () => { never += 1; } }).close();
  third.press('Enter');
  assert.equal(never, 0);
  assert.equal(third.keyHandlers.size, 0);
  assert.equal(handle.close(), undefined, 'closing twice is quiet');
});
