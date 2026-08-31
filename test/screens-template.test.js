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
  return {
    title: 'Page Title',
    head: element('head'),
    body: element('body'),
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

// title() needs the fake DOM; hands back the document beside the library.
function bootDom(opts = {}) {
  const sandbox = {
    navigator: { getGamepads: () => (opts.pads || []) },
    matchMedia: (q) => ({ matches: !!opts.coarse && q === '(pointer: coarse)' }),
    console,
    document: fakeDom(),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${opts.controls || ''}\n${opts.words || ''}\n${opts.look || ''}\n${SCREENS}`, sandbox);
  return { Screens: sandbox.window.Screens, document: sandbox.document };
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
