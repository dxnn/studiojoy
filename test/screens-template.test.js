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
const NONE = read('templates/controls-none.js');

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
      // What the library asks an element for when it is deciding whether
      // something handed to it is a node at all, and what kind.
      nodeType: 1,
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      children: [],
      parent: null,
      styleProps: {},
      style: { setProperty: (k, v) => { node.styleProps[k] = v; } },
      handlers: new Map(),
      focused: false,
      // Nothing here lays anything out. A test that cares where something
      // landed says where the game is — rect and offsetHeight are given, not
      // measured — and then asks what the library did with that.
      attrs: {},
      rect: { top: 0, left: 0, width: 0, height: 0 },
      offsetHeight: 0,
      get parentNode() { return node.parent; },
      setAttribute(name, value) { node.attrs[name] = String(value); },
      getAttribute(name) { return name in node.attrs ? node.attrs[name] : null; },
      getBoundingClientRect() { return node.rect; },
      querySelector(sel) {
        for (const kid of node.children) {
          if (kid.tag === sel) return kid;
          const deeper = kid.querySelector ? kid.querySelector(sel) : null;
          if (deeper) return deeper;
        }
        return null;
      },
      append(...kids) {
        // Appending a node that is already somewhere *moves* it, which is how
        // a real one behaves and how the chips row keeps the hint last.
        for (const kid of kids) {
          if (kid.parent) kid.remove();
          kid.parent = node;
          node.children.push(kid);
        }
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
    documentElement: element('html'),
    body,
    createElement: element,
    querySelector(sel) { return body.querySelector(sel); },
  };
}

// A fetch that answers from a table of path-prefix to { status, body }, and
// records what was asked. The studio's two game-origin routes are all this
// library ever calls: /_me and /_scores/<slug>. An entry may be a function of
// the call instead, for an answer that depends on what was asked before it.
function fakeNet(table) {
  const calls = [];
  function fetch(url, init) {
    calls.push({ url: String(url), init: init || null });
    // Longest prefix wins, so '/_scores/<slug>?' can be the board and
    // '/_scores/<slug>' the post without one shadowing the other.
    let hit = null;
    let best = -1;
    for (const key of Object.keys(table)) {
      if (String(url).startsWith(key) && key.length > best) {
        hit = table[key];
        best = key.length;
      }
    }
    if (!hit) return Promise.reject(new Error(`no route for ${url}`));
    if (typeof hit === 'function') hit = hit(String(url), init || null);
    const status = hit.status === undefined ? 200 : hit.status;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(hit.body),
    });
  }
  return { fetch, calls };
}

// A board of n entries, best first, so a bracket has something to bracket.
const madeUpScores = (n) => Array.from(
  { length: n }, (_, i) => ({ name: `P${i + 1}`, score: 1000 - i * 10 }),
);

// The library answers over promises, so a test waits for the microtasks its
// fetches queued before reading the DOM.
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

// Depth-first, so "the .screens-name" is one line in a test.
// A node wearing a class among others, where find() wants the whole attribute.
function withClass(node, className) {
  for (const kid of node.children) {
    if (String(kid.className).split(' ').includes(className)) return kid;
    const deeper = withClass(kid, className);
    if (deeper) return deeper;
  }
  return null;
}

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
  // screen puts up can be fired and checked for being taken away again, and
  // an "achievement" can be said the way the achievements library says one.
  const listeners = new Set();
  const heard = new Map();
  // The page a game is served from, which is where the slug comes from. A
  // test that gives no routes gets no fetch at all — the shape of a game
  // opened straight off the filesystem, where every call here is a no-op.
  const net = opts.routes ? fakeNet(opts.routes) : null;
  const sandbox = {
    navigator: { getGamepads: () => (opts.pads || []) },
    matchMedia: (q) => ({ matches: !!opts.coarse && q === '(pointer: coarse)' }),
    console,
    // The page's own padding and the game's own frame, both of which fit()
    // measures rather than assumes — and which are not the same box, so this
    // answers for the body and for anything else separately.
    getComputedStyle: (el) => (el === sandbox.document.body
      ? { paddingTop: opts.pad || '0px', paddingBottom: opts.pad || '0px', marginTop: '0px', marginBottom: '0px' }
      : {
        paddingTop: '0px',
        paddingBottom: '0px',
        marginTop: el.marginY || '0px',
        marginBottom: el.marginY || '0px',
        borderTopWidth: el.tag === 'canvas' ? (opts.border || '0px') : '0px',
        borderBottomWidth: el.tag === 'canvas' ? (opts.border || '0px') : '0px',
        display: el.display || 'block',
        position: el.position || 'static',
      }),
    innerWidth: opts.innerWidth || 1440,
    innerHeight: opts.innerHeight || 900,
    document: fakeDom(),
    location: { pathname: opts.pathname || '/asteriskoids/' },
    Event: function Event(type) { this.type = type; },
    dispatchEvent: (e) => dispatched.push(e.type),
    addEventListener: (name, fn) => {
      if (name === 'keydown') listeners.add(fn);
      else heard.set(name, [...(heard.get(name) ?? []), fn]);
    },
    removeEventListener: (name, fn) => { listeners.delete(fn); },
  };
  if (net) sandbox.fetch = net.fetch;
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
  // An event on the window other than a key: what the achievements library
  // dispatches when it awards one.
  const fire = (name, detail) => { for (const fn of heard.get(name) ?? []) fn({ type: name, detail }); };
  return {
    Screens: sandbox.window.Screens,
    document: sandbox.document,
    dispatched,
    press,
    fire,
    keyHandlers: listeners,
    calls: net ? net.calls : [],
  };
}

// Every className a node in this subtree wears, depth-first — enough to say
// "these rows, in this order" in one line.
function all(node, className) {
  const out = [];
  for (const kid of node.children) {
    if (String(kid.className).split(' ').indexOf(className) >= 0) out.push(kid);
    for (const deeper of all(kid, className)) out.push(deeper);
  }
  return out;
}

// A board row read back as [rank, name, score].
const rowOf = (node) => node.children.map((c) => c.textContent);

// An object the library made, brought back into this realm: it was built
// inside the vm, so it carries the vm's Object.prototype and a strict deep
// compare would reject it on that alone.
const here = async (promise) => {
  const value = await promise;
  return value === null || value === undefined ? value : { ...value };
};

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

// A game of buttons explains itself: the buttons are on the screen with
// their own words on them. Before this the seeded scheme was stick-buttons,
// so a visual novel's title screen offered "Enter to start" over a Start
// button that only ever took a click.
test('the null controller says nothing, on either device', () => {
  assert.equal(boot({ controls: NONE }).hint(), '', 'nothing for a keyboard');
  assert.equal(boot({ controls: NONE, coarse: true }).hint(), '', 'nothing for a touchscreen');
  const words = 'const WORDS = { howToPlay: "pick an answer" };';
  assert.equal(
    boot({ controls: NONE, words }).hint(), 'pick an answer',
    'a game with its own line still gets to say it',
  );
});

test('a renamed verb renames the hint', () => {
  const controls = 'const CONTROLS = { player1: { plant: "key:e touch:DIG" } };';
  assert.equal(boot({ controls }).hint(), 'E to plant');
  assert.equal(boot({ controls, coarse: true }).hint(), 'DIG to plant');
});

// A key that draws the hitboxes is for making the game, not playing it, and
// "Alt to debug" on a kid's title screen is noise with a keyboard shortcut in
// it. HIDDEN sits in config/controls.js beside the verb it names, so every
// call gets it right — title() asks for the hint itself.
test('HIDDEN keeps the making-the-game verbs out of the hint', () => {
  const controls = `
    const HIDDEN = ["debug"];
    const CONTROLS = { player1: {
      left: "key:left", right: "key:right",
      fire: "key:space",
      debug: "key:alt",
    } };
  `;
  assert.equal(boot({ controls }).hint(), 'Arrows to move · Space to fire');
  // Without it the verb is said like any other, which is the old behaviour.
  assert.equal(
    boot({ controls: controls.replace('const HIDDEN = ["debug"];', '') }).hint(),
    'Arrows to move · Space to fire · Alt to debug',
  );
  // A HIDDEN that is not a list is ignored rather than thrown over.
  assert.equal(
    boot({ controls: controls.replace('["debug"]', '"debug"') }).hint(),
    'Arrows to move · Space to fire · Alt to debug',
  );
});

// ⚠️ input 8 lends a controller to a game that names none, and the hint has
// to name what the controller really does — so screens reads the bindings
// through Input when it can, and the file as written when it is older.
test('a controller the input library lends is in the hint too', () => {
  const controls = 'const CONTROLS = { player1: { left: "key:left", right: "key:right", fire: "key:space" } };';
  const pads = [{ axes: [0, 0, 0, 0], buttons: [] }];
  assert.equal(boot({ controls, pads }).hint(), 'Arrows to move · Space to fire', 'without input 8, as before');
  const sandbox = {
    navigator: { getGamepads: () => pads },
    matchMedia: () => ({ matches: false }),
    document: { body: null },
    addEventListener() {},
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${controls}\n${read('studio-lib/input/input.js')}\n${SCREENS}`, sandbox);
  assert.equal(sandbox.window.Screens.hint(), 'Arrows or the stick to move · Space or A to fire');
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

// The studio's preview reloads the game on every write, and a frame that
// focuses its button takes the keyboard from the field being typed in beside
// it — measured in Chromium, 2026-09-28.
test('title() takes the focus only from a game that already has it', () => {
  const { Screens, document } = bootDom({ controls: SEED });
  document.hasFocus = () => false;
  Screens.title({});
  assert.equal(find(document.body.children[0], 'screens-start').focused, false, 'a preview beside a field');
  document.hasFocus = () => true;
  Screens.title({});
  assert.equal(find(document.body.children[0], 'screens-start').focused, true, 'a game being played');
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

// How big the game is on the screen. The arithmetic is CSS and the browser
// does it; what is checked here is that the right sum is written, on the right
// element, from the canvas's own shape — and ⚠️ that the vh line goes in
// before the dvh one, since a browser too old for dvh drops the second and
// keeps the first.
test('fit() sizes the game by the window\'s height as well as its width', () => {
  const { Screens, document } = bootDom({ pad: '12px' });
  const wrap = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('width', 960);
  canvas.setAttribute('height', 600);
  wrap.append(canvas);
  document.body.append(wrap);
  wrap.rect = { top: 12, left: 175, width: 590, height: 369 };

  const written = [];
  wrap.style.setProperty = (k, v) => { written.push([k, v]); wrap.styleProps[k] = v; };
  Screens.fit(wrap);

  assert.deepEqual(written.map(([k]) => k), ['width', 'width'], 'one line, then its better half');
  assert.match(written[0][1], /min\(960px, 100%, \(100vh - 24px\) \* 1\.6\)/);
  assert.match(written[1][1], /min\(960px, 100%, \(100dvh - 24px\) \* 1\.6\)/);
});

// What the game does not get is everything else on the page, not just the
// page's padding: a game with a title over it and a caption under it was
// sized to the whole window, and the words then pushed it off the bottom.
test('fit() counts the words sharing the window with the game', () => {
  const { Screens, document } = bootDom({ pad: '10px', border: '4px' });
  const heading = document.createElement('h1');
  heading.offsetHeight = 45;
  heading.marginY = '8px';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('width', 960);
  canvas.setAttribute('height', 480);
  canvas.offsetHeight = 488; // 480 of picture in a 4px frame
  const caption = document.createElement('div');
  caption.offsetHeight = 51;
  // Over the game rather than beside it, so it takes no room from it.
  const overlay = document.createElement('div');
  overlay.offsetHeight = 400;
  overlay.position = 'absolute';
  document.body.append(heading, canvas, caption, overlay);

  const written = [];
  canvas.style.setProperty = (k, v) => { written.push(v); canvas.styleProps[k] = v; };
  Screens.fit(canvas);
  // 20 of page padding, 8 of frame, 45 + 16 of heading and 51 of caption.
  assert.match(written[1], /\(100dvh - 140px\) \* 2\b/, 'the words and the frame, not the overlay');
});

test('fit() with nothing beside the game is the page\'s padding and no more', () => {
  const { Screens, document } = bootDom({ pad: '10px' });
  const bare = document.createElement('canvas');
  bare.setAttribute('width', 800);
  bare.setAttribute('height', 400);
  document.body.append(bare);
  Screens.fit(bare);
  assert.match(bare.styleProps.width, /\(100dvh - 20px\) \* 2\b/);
});

test('fit() publishes where the game landed, for anything drawn over it', () => {
  const { Screens, document } = bootDom({});
  const canvas = document.createElement('canvas');
  canvas.setAttribute('width', 800);
  canvas.setAttribute('height', 400);
  document.body.append(canvas);
  canvas.rect = { top: 40, left: 20, width: 760, height: 380 };
  Screens.fit();
  assert.equal(document.documentElement.styleProps['--screens-fit-top'], '40px');
  assert.equal(document.documentElement.styleProps['--screens-fit-left'], '20px');
  assert.equal(document.documentElement.styleProps['--screens-fit-width'], '760px');
  assert.equal(document.documentElement.styleProps['--screens-fit-height'], '380px');
  // Nothing to size a game by is not an error, it is a game that keeps its
  // own css: no canvas, no attributes, nothing written.
  const bare = bootDom({});
  assert.equal(bare.Screens.fit(), null);
});

// iOS hides its toolbars only when the page scrolls, and a page that fits the
// small window to the pixel never does — so fit leaves the root one toolbar
// taller than the window, as padding under the body. lvh − dvh, not svh: the
// slack has to be gone the moment the bars are, or the game scrolls off the
// top by the same amount. The arithmetic is the browser's; this checks the
// right two lines land on the right element.
test('fit() leaves the page one toolbar scrollable, so iOS can be asked to hide its bars', () => {
  const { Screens, document } = bootDom({});
  const canvas = document.createElement('canvas');
  canvas.setAttribute('width', 800);
  canvas.setAttribute('height', 400);
  document.body.append(canvas);
  Screens.fit();
  const root = document.documentElement.styleProps;
  assert.equal(root['padding-bottom'], 'calc(100lvh - 100dvh)');
  // Under every game's border-box reset the padding would come out of the
  // page's own `height: 100%` instead of going under it.
  assert.equal(root['box-sizing'], 'content-box');
});

// Where the HUD goes once fit() has said where the game is: in the letterbox
// band above it when the band can hold the row, over the top of the game when
// it cannot — which is the desktop case, where the game has the window.
test('the chips row sits in the band above the game when there is one', () => {
  const { Screens, document } = bootDom({});
  const canvas = document.createElement('canvas');
  canvas.setAttribute('width', 960);
  canvas.setAttribute('height', 600);
  document.body.append(canvas);
  canvas.rect = { top: 220, left: 12, width: 369, height: 231 };
  Screens.fit(canvas);
  Screens.chips({ Score: 1 });
  const root = find(document.body, 'screens-chips');
  root.offsetHeight = 20;
  Screens.chips({ Score: 1, Lives: 3 }); // a chip arriving is what re-places the row
  assert.equal(root.styleProps.left, '12px');
  assert.equal(root.styleProps.width, '369px');
  assert.equal(root.styleProps.top, '192px', '20 tall, 8 clear of a game at 220');

  // The same game with the window's height: no band, so the row goes over it.
  canvas.rect = { top: 12, left: 240, width: 960, height: 600 };
  Screens.fit(canvas);
  assert.equal(root.styleProps.top, '20px', 'over the top of the game, not above it');
});

test('a chip can be a meter, and the fill only moves when the number does', () => {
  const { Screens, document } = bootDom({});
  Screens.chips({ Risk: { value: 43, max: 100, text: '43/100 ×1.4' } });
  const chip = find(document.body, 'screens-chip');
  assert.equal(find(chip, 'screens-chip-label').textContent, 'Risk');
  assert.equal(find(chip, 'screens-chip-value').textContent, '43/100 ×1.4');
  const fill = find(chip, 'screens-chip-fill');
  assert.equal(fill.style.width, '43.0%');
  Screens.chips({ Risk: { value: 43, max: 100, text: '43/100 ×1.4' } });
  assert.equal(find(document.body, 'screens-chips').children.length, 1, 'not rebuilt');
  Screens.chips({ Risk: { value: 200, max: 100, text: 'over' } });
  assert.equal(fill.style.width, '100.0%', 'past the top is the top');
  Screens.chips({ Risk: { value: -5, max: 100, text: 'under' } });
  assert.equal(fill.style.width, '0.0%');
  // Text where a number was expected, and a max of nothing: quiet, not broken.
  Screens.chips({ Risk: { value: 1, max: 0 } });
  assert.equal(fill.style.width, '100.0%');
});

// ⚠️ The highlight is a number's colour and nothing else. A chip's value is
// not always a number — a weapon name in gold is the colour losing its
// meaning — so a value with no digit in it wears the reading ink instead.
test('only a number in a chip is gold', () => {
  const { Screens, document } = bootDom({});
  Screens.chips({ Score: 1204, Guns: 'Cannon', Risk: { value: 1, max: 2, text: '1/2' } });
  const row = find(document.body, 'screens-chips');
  const valueOf = (chip) => chip.children[1].className;
  assert.equal(valueOf(row.children[0]), 'screens-chip-value', 'a number is');
  assert.equal(valueOf(row.children[1]), 'screens-chip-value screens-chip-words', 'a word is not');
  assert.equal(valueOf(row.children[2]), 'screens-chip-value', 'and a meter is');
  Screens.chips({ Score: 1204, Guns: 'Cannon x2', Risk: { value: 1, max: 2, text: '1/2' } });
  assert.equal(valueOf(row.children[1]), 'screens-chip-value', 'a count in it makes it one');
});

test('a chip holds a node the game made, in the place its key sits', () => {
  const { Screens, document } = bootDom({});
  const own = document.createElement('div');
  own.className = 'my-own-thing';
  Screens.chips({ Score: 1, Fuel: own, Lives: 3 });
  const root = find(document.body, 'screens-chips');
  assert.equal(root.children.length, 3);
  assert.equal(root.children[1].children[1], own, 'after its label, second in the row');
  own.textContent = 'the game changed this';
  Screens.chips({ Score: 2, Fuel: own, Lives: 3 });
  assert.equal(own.textContent, 'the game changed this', 'never touched again');
  assert.equal(root.children[1].children[1], own, 'and never replaced');
});

test('{ hint: true } ends the row, and stands down when the game is narrow', () => {
  const wide = bootDom({ controls: SEED });
  wide.Screens.chips({ Score: 1 }, { hint: true });
  const row = find(wide.document.body, 'screens-chips');
  const hint = row.children[row.children.length - 1];
  assert.equal(hint.className, 'screens-chip screens-chip-hint');
  assert.ok(hint.textContent.length > 0, 'the how-to-play line itself');
  assert.equal(hint.style.display, '', 'a 1440 window has room for it');
  wide.Screens.chips({ Score: 2, Combo: 'x3' }, { hint: true });
  assert.equal(row.children[row.children.length - 1], hint, 'still last');
  wide.Screens.chips({ Score: 3 });
  assert.equal(withClass(row, 'screens-chip-hint'), null, 'and gone when not asked for');

  const narrow = bootDom({ controls: SEED, innerWidth: 393 });
  narrow.Screens.chips({ Score: 1 }, { hint: true });
  const small = withClass(narrow.document.body, 'screens-chip-hint');
  assert.equal(small.style.display, 'none', 'no room on a phone');
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

// ---------- the stylesheet ----------

// ⚠️ Why every rule is written `body :where(…)`. injectStyle() appends to
// <head>, after the game's own <link>, so the sheet wins every tie it is
// allowed to enter — the weight it carries is the whole design:
//
//   .screens-name { … }   a game means it   0-1-0  the game wins
//   button { … }          the page's style  0-0-1  a tie, and we are later
//   * { margin: 0 }       a reset           0-0-0  we win
//
// Two wrong answers came first, both found in a browser on asteriskoids.
// `@layer screens` is worse than nothing — an unlayered rule beats a layered
// one at ANY specificity, and a game opens with `* { margin: 0; padding: 0 }`,
// which flattened every margin on the screen and left the panel against the
// left edge. Bare :where() is 0-0-0 and then lost the Start button to the
// game's own `button { … }`. One element selector is the weight that works.
test("the library's css weighs one element selector, so a game's own wins", () => {
  const { Screens, document } = bootDom({});
  Screens.title({});
  const css = document.head.children[0].textContent;
  assert.ok(css.startsWith('@font-face{'), 'the faces come first');
  assert.equal(css.includes('@layer'), false, 'never a layer — a game reset would beat it');
  assert.equal(css.includes('!important'), false, 'nothing outranks a game by force');

  // Every rule past the faces, and every one of them carrying that weight:
  // one selector written any other way is one thing a game silently cannot
  // restyle, or one default a stray `p { margin: 0 }` silently wipes out.
  const selectors = css
    .slice(css.indexOf(':where('))
    .split('}')
    .map((chunk) => chunk.split('{')[0].trim())
    .filter((selector) => selector !== '' && selector !== ':where(:root)');
  assert.ok(selectors.length >= 25, `${selectors.length} rules`);
  for (const selector of selectors) {
    assert.ok(
      selector.startsWith('body :where(') || selector.startsWith('body:where('),
      selector,
    );
    // Nothing outside a :where() but that one body and, on the hairline, a
    // pseudo-element — which cannot go inside one. So the weight is 0-0-1,
    // or 0-0-2 for the hairline, and both stay under a game's class.
    const bare = selector.replace(/:where\([^)]*\)/g, '').replace('body', '').trim();
    assert.ok(bare === '' || bare === '::before', selector);
  }
  // The variables are the exception and are meant to be: 0-0-0, so a game's
  // own :root — 0-1-0 — replaces a default rather than fighting it.
  assert.ok(css.includes(':where(:root){--screens-font:'));
  for (const rule of ['body :where(.screens-title-screen){', 'body :where(.screens-panel){',
    'body :where(.screens-place){', 'body :where(.screens-row){', 'body :where(.screens-chip){',
    // The HUD steps aside under a screen the way the drawn controls do: the
    // screen is not quite opaque, and a score showing through it reads as a
    // mistake. Same weight as the rest, so a game can bring it back.
    'body:where(.screens-open) :where(.screens-chips){']) {
    assert.ok(css.includes(rule), rule);
  }
});

test('the typefaces are files beside the library, asked for from where it lives', () => {
  const { Screens, document } = bootDom({});
  Screens.title({});
  const css = document.head.children[0].textContent;
  const named = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(named.length, 4, 'two subsets of Grotesk, two weights of Mono');
  const held = JSON.parse(read('studio-lib/index.json')).libraries.screens.files;
  for (const ref of named) {
    // No currentScript in the fake DOM, so the fallback is the studio
    // directory — which is where the library lives in a game.
    assert.ok(ref.startsWith('studio/'), ref);
    const file = ref.slice('studio/'.length);
    assert.ok(fs.existsSync(new URL(`../public/studio-lib/screens/${file}`, import.meta.url)), ref);
    assert.ok(held.includes(file), `${file} is shipped`);
  }
});

// ---------- the scoreboard snippet ----------

test('board() renders the rows it is given, best first', async () => {
  const { Screens } = bootDom({});
  const node = Screens.board({ scores: madeUpScores(30), limit: 10, title: 'Top 10' });
  await settle();
  assert.equal(find(node, 'screens-board-title').textContent, 'Top 10');
  const places = all(node, 'screens-place');
  assert.equal(places.length, 10);
  assert.deepEqual(rowOf(places[0]), ['1', 'P1', '1000']);
  assert.deepEqual(rowOf(places[9]), ['10', 'P10', '910']);
  assert.equal(all(node, 'screens-mine').length, 0, 'no run to point at');
});

test('board() says so when nobody has played', async () => {
  const { Screens } = bootDom({});
  const node = Screens.board({ scores: [] });
  await settle();
  assert.equal(all(node, 'screens-place').length, 0);
  assert.equal(find(node, 'screens-empty').textContent, 'No scores yet.');

  const own = bootDom({ words: 'const WORDS = { noScores: "Be the first" };' });
  const mine = own.Screens.board({ scores: [] });
  await settle();
  assert.equal(find(mine, 'screens-empty').textContent, 'Be the first');
});

// The lesson asteriskoids' own board taught: a run that placed below the shown
// rows still wants to see itself, with the four either side and the ranks they
// really hold — it is a window into the middle of the board, not a list
// starting at 1.
test('board() brackets a rank that landed past the list', async () => {
  const { Screens } = bootDom({});
  const node = Screens.board({ scores: madeUpScores(30), limit: 10, around: 20 });
  await settle();
  const places = all(node, 'screens-place');
  assert.equal(places.length, 19, 'ten, then the nine around the twentieth');
  assert.deepEqual(rowOf(places[10]), ['16', 'P16', '850']);
  assert.deepEqual(rowOf(places[14]), ['20', 'P20', '810']);
  assert.deepEqual(rowOf(places[18]), ['24', 'P24', '770']);
  const mine = all(node, 'screens-mine');
  assert.equal(mine.length, 1);
  assert.deepEqual(rowOf(mine[0]), ['20', 'P20', '810']);
  assert.equal(find(node, 'screens-gap').textContent, '···');
});

test('board() marks a rank inside the list, and never shows a row twice', async () => {
  const inside = bootDom({}).Screens.board({ scores: madeUpScores(30), limit: 10, around: 4 });
  await settle();
  assert.equal(all(inside, 'screens-place').length, 10, 'no bracket needed');
  assert.equal(find(inside, 'screens-gap'), null);
  assert.deepEqual(rowOf(all(inside, 'screens-mine')[0]), ['4', 'P4', '970']);

  // Just past the shown rows: the bracket starts where they stopped rather
  // than repeating four of them, and nothing was skipped so nothing is marked.
  const edge = bootDom({}).Screens.board({ scores: madeUpScores(30), limit: 10, around: 12 });
  await settle();
  assert.equal(find(edge, 'screens-gap'), null);
  assert.deepEqual(
    all(edge, 'screens-place').map((p) => rowOf(p)[0]),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'],
  );

  // A rank nobody can point at — the board is shorter than it claims — is
  // simply not marked.
  const beyond = bootDom({}).Screens.board({ scores: madeUpScores(12), limit: 10, around: 40 });
  await settle();
  assert.equal(all(beyond, 'screens-place').length, 10);
  assert.equal(all(beyond, 'screens-mine').length, 0);
});

test('board() asks the studio itself, and for all of it when bracketing', async () => {
  const plain = bootDom({
    routes: { '/_scores/asteriskoids': { body: { scores: madeUpScores(3) } } },
  });
  const node = plain.Screens.board({ limit: 5 });
  await settle();
  assert.deepEqual(plain.calls.map((c) => c.url), ['/_scores/asteriskoids?limit=5']);
  assert.equal(all(node, 'screens-place').length, 3);

  const bracket = bootDom({
    routes: { '/_scores/asteriskoids': { body: { scores: madeUpScores(30) } } },
  });
  bracket.Screens.board({ limit: 10, around: 20 });
  await settle();
  assert.deepEqual(bracket.calls.map((c) => c.url), ['/_scores/asteriskoids?limit=100']);
});

test('a board with no slug and a board with no network are both quiet', async () => {
  const nowhere = bootDom({
    pathname: '/', routes: { '/_scores/': { body: { scores: madeUpScores(3) } } },
  });
  const node = nowhere.Screens.board({});
  await settle();
  assert.deepEqual(nowhere.calls, [], 'nothing asked without a slug');
  assert.equal(find(node, 'screens-empty').textContent, 'No scores yet.');

  const offline = bootDom({});
  const quiet = offline.Screens.board({});
  await settle();
  assert.equal(find(quiet, 'screens-empty').textContent, 'No scores yet.');
});

// ---------- posting, and who is playing ----------

test('post() reports the rank, the sign-in, or nothing at all', async () => {
  const ok = bootDom({ routes: { '/_scores/asteriskoids': { status: 201, body: { rank: 3 } } } });
  assert.deepEqual(await here(ok.Screens.post(120)), { rank: 3 });
  assert.equal(ok.calls[0].init.method, 'POST');
  assert.deepEqual(
    JSON.parse(ok.calls[0].init.body), { score: 120 },
    "the score and nothing else — the name on the row is the account's",
  );

  const rounded = bootDom({
    routes: { '/_scores/asteriskoids': { status: 201, body: { rank: 1 } } },
  });
  await rounded.Screens.post(12.7);
  assert.deepEqual(
    JSON.parse(rounded.calls[0].init.body), { score: 13 },
    'the studio takes whole numbers only',
  );

  const out = bootDom({ routes: { '/_scores/asteriskoids': { status: 401, body: {} } } });
  assert.deepEqual(await here(out.Screens.post(120)), { signin: true });

  const missed = bootDom({
    routes: { '/_scores/asteriskoids': { status: 201, body: { rank: null } } },
  });
  assert.deepEqual(await here(missed.Screens.post(1)), { rank: null }, 'it missed the board');

  const broken = bootDom({ routes: { '/_scores/asteriskoids': { status: 500, body: {} } } });
  assert.deepEqual(await here(broken.Screens.post(1)), {});
  assert.deepEqual(await here(bootDom({}).Screens.post(1)), {}, 'no fetch, no throw');
  assert.deepEqual(
    await here(bootDom({ pathname: '/' }).Screens.post(1)), {}, 'no slug, no post',
  );
});

test('me() is asked once a page, and is null for every kind of miss', async () => {
  const inn = bootDom({ routes: { '/_me': { body: { user: { name: 'Pat' } } } } });
  assert.deepEqual(await here(inn.Screens.me()), { name: 'Pat' });
  assert.deepEqual(await here(inn.Screens.me()), { name: 'Pat' });
  assert.equal(inn.calls.length, 1);

  assert.equal(await bootDom({ routes: { '/_me': { body: { user: null } } } }).Screens.me(), null);
  assert.equal(await bootDom({ routes: { '/_me': { status: 500, body: {} } } }).Screens.me(), null);
  assert.equal(await bootDom({}).Screens.me(), null, 'no fetch, no throw');
});

test('signin() says who is playing, or offers the way to be somebody', async () => {
  const inn = bootDom({ routes: { '/_me': { body: { user: { name: 'Pat' } } } } });
  const named = inn.Screens.signin();
  await settle();
  assert.equal(named.textContent, 'Playing as Pat');
  assert.deepEqual(named.children, [], 'nothing to sign into');

  const out = bootDom({ routes: { '/_me': { body: { user: null } } } });
  const offer = out.Screens.signin();
  await settle();
  assert.equal(offer.children.length, 1);
  assert.equal(offer.children[0].tag, 'a');
  assert.equal(offer.children[0].href, '/');
  assert.equal(offer.children[0].textContent, 'Sign in to get on the board');
});

// ---------- the label-and-value list ----------

test('rows() is a label-and-value list, in the order it was given', () => {
  const { Screens } = bootDom({});
  const node = Screens.rows({ Rocks: 42, Level: 7, Best: 'none yet' });
  assert.equal(node.className, 'screens-rows');
  assert.deepEqual(
    node.children.map((r) => r.children.map((c) => c.textContent)),
    [['Rocks', '42'], ['Level', '7'], ['Best', 'none yet']],
  );
  assert.deepEqual(Screens.rows({}).children, [], 'nothing to say, nothing drawn');
  assert.deepEqual(Screens.rows().children, []);
});

// ---------- the screens composing them ----------

test('title({score, post, board}) posts the run and shows where it landed', async () => {
  const { Screens, document, calls } = bootDom({
    routes: {
      '/_me': { body: { user: { name: 'Pat' } } },
      '/_scores/asteriskoids?': { body: { scores: madeUpScores(30) } },
      '/_scores/asteriskoids': { status: 201, body: { rank: 20 } },
    },
  });
  Screens.title({ score: 810, post: true, board: true });
  await settle();
  const root = document.body.children[0];
  assert.equal(root.className, 'screens-title-screen screens-over');
  assert.equal(find(root, 'screens-score').textContent, '810');
  assert.deepEqual(rowOf(all(root, 'screens-mine')[0]), ['20', 'P20', '810']);
  assert.equal(find(root, 'screens-signin').textContent, 'Playing as Pat');
  assert.deepEqual(
    calls.map((c) => c.url).sort(),
    ['/_me', '/_scores/asteriskoids', '/_scores/asteriskoids?limit=100'],
  );
});

// The board is read after the post has landed, so the run is on it. Asked for
// alongside, it came back as the board before this run — and a new number one
// saw the old one, marked as theirs.
test('title({post, board}) reads the board only once the run is on it', async () => {
  const scores = madeUpScores(3);
  const { Screens, document, calls } = bootDom({
    routes: {
      '/_me': { body: { user: { name: 'Pat' } } },
      '/_scores/asteriskoids?': () => ({ body: { scores: scores.slice() } }),
      '/_scores/asteriskoids': (url, init) => {
        scores.unshift({ name: 'Pat', score: JSON.parse(init.body).score });
        return { status: 201, body: { rank: 1 } };
      },
    },
  });
  Screens.title({ score: 5000, post: true, board: true });
  await settle();
  const root = document.body.children[0];
  const places = all(root, 'screens-place');
  assert.equal(places.length, 4);
  assert.deepEqual(rowOf(places[0]), ['1', 'Pat', '5000']);
  assert.deepEqual(rowOf(all(root, 'screens-mine')[0]), ['1', 'Pat', '5000']);
  const urls = calls.map((c) => c.url);
  assert.ok(
    urls.indexOf('/_scores/asteriskoids?limit=100') > urls.indexOf('/_scores/asteriskoids'),
    'the board was asked for after the post',
  );
});

test('a title screen can carry the top ten and the sign-in offer', async () => {
  const { Screens, document, calls } = bootDom({
    routes: {
      '/_me': { body: { user: null } },
      '/_scores/asteriskoids?': { body: { scores: madeUpScores(3) } },
    },
  });
  Screens.title({ board: true });
  await settle();
  const root = document.body.children[0];
  assert.equal(root.className, 'screens-title-screen', 'not game over');
  assert.equal(all(root, 'screens-place').length, 3);
  assert.equal(all(root, 'screens-mine').length, 0, 'no run to point at');
  assert.equal(
    find(root, 'screens-signin').children[0].textContent, 'Sign in to get on the board',
  );
  assert.deepEqual(calls.map((c) => c.url).sort(), ['/_me', '/_scores/asteriskoids?limit=10']);
});

test("extra puts the game's own nodes in the panel, above the board", async () => {
  const { Screens, document } = bootDom({});
  const mine = Screens.rows({ Rocks: 42 });
  const note = { tag: 'p', className: 'my-note', textContent: 'hi', children: [] };
  Screens.title({ score: 3, extra: [mine, note], board: { scores: [] } });
  await settle();
  const panel = find(document.body.children[0], 'screens-panel');
  const order = panel.children.map((c) => c.className);
  assert.deepEqual(order, [
    'screens-name', 'screens-score', 'screens-won', 'screens-start',
    'screens-rows', 'my-note', 'screens-board', 'screens-signin',
  ]);

  // One node rather than a list, and nothing at all, both work.
  const single = bootDom({});
  single.Screens.title({ extra: single.Screens.rows({ A: 1 }) });
  assert.ok(find(single.document.body.children[0], 'screens-rows'));
  const none = bootDom({});
  none.Screens.title({ extra: null });
  assert.equal(find(none.document.body.children[0], 'screens-rows'), null);
});

// The run's trophies on the game-over screen: the ones the achievements
// library awarded since the last game over, under the score — and one awarded
// while the screen is up lands on it, because the award for the last hit
// usually arrives a beat after the game says the moment.
test('the game-over screen lists what the run won, as it lands', async () => {
  const { Screens, document, fire } = bootDom({});
  const first = { id: 'first', name: 'First run', how: 'Finish a run', icon: '🚀' };
  const ten = { id: 'ten', name: 'Ten', how: 'Reach level 10', icon: null };

  // A title screen is not a run over: nothing listed, whatever was won.
  fire('achievement', first);
  Screens.title({});
  assert.equal(find(document.body.children[0], 'screens-won'), null);
  find(document.body.children[0], 'screens-start').click();

  Screens.title({ score: 12 });
  const root = document.body.children[0];
  const box = find(root, 'screens-won');
  assert.equal(find(box, 'screens-won-title').textContent, 'Won this run');
  assert.deepEqual(all(box, 'screens-won-row').map(rowOf), [['🚀', 'First run']]);
  // The box sits under the score, before the button.
  const panel = root.children[0];
  const kinds = panel.children.map((c) => c.className);
  assert.ok(kinds.indexOf('screens-score') < kinds.indexOf('screens-won')
    && kinds.indexOf('screens-won') < kinds.indexOf('screens-start'));

  fire('achievement', ten);
  assert.deepEqual(all(box, 'screens-won-row').map(rowOf), [['🚀', 'First run'], ['★', 'Ten']],
    'a late one lands on the screen, with a star for no icon');

  // Play again: the run is done with, and the next game over starts clean.
  find(root, 'screens-start').click();
  Screens.title({ score: 3 });
  const next = find(document.body.children[0], 'screens-won');
  assert.equal(next.children.length, 0, 'no heading over nothing');
  assert.equal(find(next, 'screens-won-title'), null);
});

test('the run\'s trophies take the game\'s own heading, and nothing without a name', () => {
  const own = bootDom({ words: 'const WORDS = { won: "You got" };' });
  own.fire('achievement', { id: 'x', name: 'X' });
  own.fire('achievement', { id: 'nameless' });
  own.Screens.title({ score: 1 });
  const box = find(own.document.body.children[0], 'screens-won');
  assert.equal(find(box, 'screens-won-title').textContent, 'You got');
  assert.equal(all(box, 'screens-won-row').length, 1);
});

test('a screen that was not asked for a board asks the studio for nothing', async () => {
  const { Screens, calls } = bootDom({ routes: { '/_me': { body: { user: null } } } });
  Screens.title({ score: 12 });
  Screens.chips({ Score: 12 });
  await settle();
  assert.deepEqual(calls, []);
});
