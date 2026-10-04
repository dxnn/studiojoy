// The achievements library every game gets a copy of, and the seed it reads.
// Browser code, so it runs here in a vm beside the moments library, with the
// window's events, a fake fetch and enough of a DOM for the toast — enough to
// check the rules: each test on a moment, once per page, never for something
// already held, the sign-in line when nobody is signed in, and that anything
// outside the shape is skipped with one warning and nothing else. What the
// toast looks like needs a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseConfigFile } from '../public/config-file.js';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const MOMENTS = read('studio-lib/moments/moments.js');
const ACHIEVEMENTS = read('studio-lib/achievements/achievements.js');
const SEED = read('templates/achievements.js');

// A file in the shape, covering every kind of rule.
const RULES = `
const ACHIEVEMENTS = [
  { id: "first-run", name: "First run", how: "Finish a run", icon: "🚀", when: { moment: "run-over" } },
  { id: "halfway", name: "Halfway there", how: "Reach level 5", icon: "🪜", when: { moment: "level", atLeast: 5 } },
  { id: "quick", name: "Quick", how: "Finish in 30 seconds", when: { moment: "time", atMost: 30 } },
  { id: "good-end", name: "Happily ever after", how: "Find the good ending", when: { moment: "ending", is: "good" } },
  { id: "lucky", name: "Lucky seven", how: "Land on 7", when: { moment: "roll", is: 7 } },
  { id: "chatty", name: "Chatty", how: "Answer ten questions", when: { moment: "answered", times: 3 } },
  { id: "secret", name: "Secret room", how: "Find it" },
];
`;

// Enough of a DOM for the toast: elements that hold their children and their
// style properties, under a document with a head and a body.
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
      append(...kids) {
        for (const kid of kids) { kid.parent = node; node.children.push(kid); }
      },
      remove() {
        if (!node.parent) return;
        const at = node.parent.children.indexOf(node);
        if (at >= 0) node.parent.children.splice(at, 1);
        node.parent = null;
      },
    };
    return node;
  }
  return { head: element('head'), body: element('body'), createElement: element };
}

// A fetch that answers from a table of url to { status, body } and records
// what was asked; a url not in the table is a dead network. `pending` holds
// a request open until the test lets it go.
function fakeNet(table) {
  const calls = [];
  const open = [];
  function fetch(url, init) {
    const call = { url: String(url), init: init || null };
    calls.push(call);
    const hit = table[call.url];
    if (!hit) return Promise.reject(new Error(`no route for ${url}`));
    const answer = () => {
      const status = hit.status === undefined ? 200 : hit.status;
      return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(hit.body) };
    };
    if (hit.pending) return new Promise((resolve) => { open.push(() => resolve(answer())); });
    return Promise.resolve(answer());
  }
  return { fetch, calls, release: () => { for (const go of open.splice(0)) go(); } };
}

function boot({ rules = RULES, look = '', routes = null, pathname = '/rocks/', dom = true } = {}) {
  const warnings = [];
  const timers = [];
  const listeners = new Map();
  const net = routes ? fakeNet(routes) : null;
  const sandbox = {
    console: { warn: (msg) => warnings.push(msg) },
    location: { pathname },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init ? init.detail : undefined; },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
    dispatchEvent: (event) => { for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event); },
  };
  if (dom) sandbox.document = fakeDom();
  if (net) sandbox.fetch = net.fetch;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${rules}\n${look}\n${MOMENTS}\n${ACHIEVEMENTS}`, sandbox);
  return {
    Moments: sandbox.Moments,
    Achievements: sandbox.Achievements,
    document: sandbox.document,
    // A listener on the window, the way the screens library or a game has one.
    listen: (type, fn) => sandbox.addEventListener(type, fn),
    warnings,
    calls: net ? net.calls : [],
    release: net ? net.release : () => {},
    // Every timer set so far, fired in order — the toast's own leaving, and
    // the wait an award gives the studio before going ahead anyway.
    fireTimers: () => { for (const t of timers.splice(0)) t.fn(); },
    timers,
  };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const toasts = (g) => (g.document.body.children[0]?.children ?? []);
const textOf = (toast, className) => {
  const find = (node) => {
    for (const kid of node.children) {
      if (kid.className === className) return kid;
      const deeper = find(kid);
      if (deeper) return deeper;
    }
    return null;
  };
  return find(toast)?.textContent ?? null;
};
const names = (g) => toasts(g).map((t) => textOf(t, 'achievements-name'));
const posts = (g) => g.calls.filter((c) => c.init?.method === 'POST').map((c) => JSON.parse(c.init.body).id);

// The fake net answers a url one way, so the GET's answer doubles as the
// POST's: a 200 with an empty list is "nothing held" and "kept" at once, and
// a 401 or a 500 refuses both.
const ROCKS = '/_achievements/rocks';
const nobodyHeld = { [ROCKS]: { body: { achievements: [] } } };

test('the seed is an empty list a config form can open', () => {
  const parsed = parseConfigFile(SEED);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.deepEqual(parsed.decls.map((d) => d.name), ['ACHIEVEMENTS']);
  assert.deepEqual(parsed.decls[0].node.value, []);
  assert.match(SEED, /id, name, how, icon, when/, 'the shape is spelled out for whoever edits it');
});

test('a rule with no test is met the first time the moment is said, once', async () => {
  const g = boot({ routes: nobodyHeld });
  await settle();
  g.Moments.say('run-over');
  g.Moments.say('run-over');
  await settle();
  assert.deepEqual(names(g), ['First run']);
  assert.deepEqual(posts(g), ['first-run']);
  const toast = toasts(g)[0];
  assert.equal(toast.className, 'achievements-toast');
  assert.equal(textOf(toast, 'achievements-icon'), '🚀');
  assert.equal(textOf(toast, 'achievements-how'), 'Finish a run');
  assert.equal(textOf(toast, 'achievements-keep'), null, 'signed in: nothing to add');
  assert.equal(g.calls[0].url, ROCKS, 'what is held is asked first');
  assert.equal(g.calls[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(g.calls[1].init.body), { id: 'first-run' }, 'the id and nothing else');
});

// The joy the studio paid for it (server/joy.js): a gold line on the toast,
// and none when it paid nothing.
test('a toast says the joy it paid, when it paid some', async () => {
  const g = boot({ routes: { [ROCKS]: { body: { achievements: [], joy: 5 } } } });
  await settle();
  g.Moments.say('run-over');
  await settle();
  assert.equal(textOf(toasts(g)[0], 'achievements-joy'), '+5 joy');

  const none = boot({ routes: nobodyHeld });
  await settle();
  none.Moments.say('run-over');
  await settle();
  assert.equal(textOf(toasts(none)[0], 'achievements-joy'), null);
});

// The award said on the window, for the screens library's game-over list and
// for a game that wants to know: the rule's four public parts, once per award,
// and said whether or not the studio kept it.
test('an award is said on the window as an "achievement", kept or not', async () => {
  const g = boot({ routes: nobodyHeld });
  const said = [];
  // Spread: the detail was built inside the vm and carries its prototype.
  g.listen('achievement', (e) => said.push({ ...e.detail }));
  await settle();
  g.Moments.say('run-over');
  g.Moments.say('run-over');
  g.Moments.say('level', 5);
  await settle();
  assert.deepEqual(said, [
    { id: 'first-run', name: 'First run', how: 'Finish a run', icon: '🚀' },
    { id: 'halfway', name: 'Halfway there', how: 'Reach level 5', icon: '🪜' },
  ]);

  const out = boot({ routes: { [ROCKS]: { status: 401, body: {} } } });
  const unkept = [];
  out.listen('achievement', (e) => unkept.push(e.detail.id));
  await settle();
  out.Moments.say('run-over');
  await settle();
  assert.deepEqual(unkept, ['first-run'], 'the player saw the toast, so the screen agrees with it');
});

test('atLeast and atMost read a number, and never a word', async () => {
  const g = boot({ routes: nobodyHeld });
  await settle();
  g.Moments.say('level', 4);
  g.Moments.say('level', 'five');
  g.Moments.say('time', 31);
  await settle();
  assert.deepEqual(names(g), []);
  g.Moments.say('level', 5);
  g.Moments.say('time', 30);
  g.Moments.say('level', 9);
  await settle();
  assert.deepEqual(names(g), ['Halfway there', 'Quick']);
  assert.deepEqual(posts(g), ['halfway', 'quick']);
});

test('is compares as text, so 7 and "7" are the same answer', async () => {
  const g = boot({ routes: nobodyHeld });
  await settle();
  g.Moments.say('ending', 'bad');
  g.Moments.say('roll', 6);
  await settle();
  assert.deepEqual(names(g), []);
  g.Moments.say('ending', 'good');
  g.Moments.say('roll', '7');
  await settle();
  assert.deepEqual(names(g), ['Happily ever after', 'Lucky seven']);
});

test('times counts how often the moment has been said on this page', async () => {
  const g = boot({ routes: nobodyHeld });
  await settle();
  g.Moments.say('answered', 'a');
  g.Moments.say('answered', 'b');
  await settle();
  assert.deepEqual(names(g), []);
  g.Moments.say('answered', 'c');
  g.Moments.say('answered', 'd');
  await settle();
  assert.deepEqual(names(g), ['Chatty']);
});

test('what the player already holds is never toasted or posted again', async () => {
  const g = boot({
    routes: {
      [ROCKS]: {
        body: {
          achievements: [
            { id: 'first-run', name: 'First run', how: '', icon: null, got: '2026-09-01T10:00:00Z' },
            { id: 'halfway', name: 'Halfway there', how: '', icon: null, got: null },
          ],
        },
      },
    },
  });
  await settle();
  g.Moments.say('run-over');
  g.Moments.say('level', 5);
  await settle();
  assert.deepEqual(names(g), ['Halfway there']);
  assert.deepEqual(posts(g), ['halfway']);
});

test('an award waits for the studio to say what is held — up to a point', async () => {
  const g = boot({ routes: { [ROCKS]: { pending: true, body: { achievements: [] } } } });
  g.Moments.say('run-over');
  await settle();
  assert.deepEqual(names(g), [], 'not yet: the answer is still coming');
  g.release();
  await settle();
  assert.deepEqual(names(g), ['First run']);

  // A studio that never answers: the wait runs out and the toast shows.
  const slow = boot({ routes: { [ROCKS]: { pending: true, body: { achievements: [] } } } });
  slow.Moments.say('run-over');
  await settle();
  assert.deepEqual(names(slow), []);
  assert.equal(slow.timers[0].ms, 3000, 'the wait is a few seconds, not the browser\'s');
  slow.fireTimers();
  await settle();
  assert.deepEqual(names(slow), ['First run']);
});

test('no when means only unlock(), and an unknown id is one warning', async () => {
  const g = boot({ routes: nobodyHeld });
  await settle();
  g.Moments.say('secret');
  await settle();
  assert.deepEqual(names(g), [], 'no moment grants it');
  g.Achievements.unlock('secret');
  g.Achievements.unlock('secret');
  g.Achievements.unlock('nope');
  g.Achievements.unlock('nope');
  await settle();
  assert.deepEqual(names(g), ['Secret room']);
  assert.deepEqual(posts(g), ['secret']);
  assert.equal(g.warnings.length, 1);
  assert.match(g.warnings[0], /unlock\("nope"\): no achievement with that id/);
});

test('signed out, the toast shows with the line about keeping it, and nothing is kept', async () => {
  const g = boot({ routes: { [ROCKS]: { status: 401, body: {} } } });
  await settle();
  g.Moments.say('run-over');
  await settle();
  assert.deepEqual(names(g), ['First run']);
  assert.equal(textOf(toasts(g)[0], 'achievements-keep'), 'Sign in on the front page to keep it');
  assert.equal(g.warnings.length, 1, 'the GET was refused too, and that is worth one line');
});

test('a studio that will not keep it is one warning, and the toast still shows', async () => {
  const g = boot({ routes: { [ROCKS]: { status: 500, body: {} } } });
  await settle();
  g.Moments.say('run-over');
  g.Moments.say('level', 5);
  await settle();
  assert.deepEqual(names(g), ['First run', 'Halfway there']);
  assert.equal(g.warnings.length, 2, 'one for the read, one for the save, however many awards');
  assert.match(g.warnings[0], /could not say what you have earned/);
  assert.match(g.warnings[1], /did not keep "first-run" \(500\)/);

  const dead = boot({ routes: {} });
  await settle();
  dead.Moments.say('run-over');
  await settle();
  assert.deepEqual(names(dead), ['First run'], 'a dead network is not a dead game');
  assert.equal(dead.warnings.length, 2);
});

test('off a game origin, or with no fetch, toasts show and nobody is asked', async () => {
  const nowhere = boot({ pathname: '/', routes: nobodyHeld });
  nowhere.Moments.say('run-over');
  await settle();
  assert.deepEqual(names(nowhere), ['First run']);
  assert.deepEqual(nowhere.calls, []);
  assert.equal(textOf(toasts(nowhere)[0], 'achievements-keep'), null);

  const offline = boot();
  offline.Moments.say('run-over');
  await settle();
  assert.deepEqual(names(offline), ['First run']);
  assert.deepEqual(offline.warnings, []);
});

test('a toast leaves after its time; the stack is built once and wears the look', async () => {
  const g = boot({ look: 'const LOOK = { primary: "#0ff", accent: "#f0f", highlight: "#fd6", deep: "#101" };' });
  g.Moments.say('run-over');
  g.Moments.say('level', 5);
  await settle();
  assert.equal(g.document.body.children.length, 1, 'one stack');
  const stack = g.document.body.children[0];
  assert.equal(stack.className, 'achievements-toasts');
  assert.equal(stack.children.length, 2);
  assert.equal(stack.styleProps['--achievements-primary'], '#0ff');
  assert.equal(stack.styleProps['--achievements-accent'], '#f0f');
  assert.equal('--achievements-highlight' in stack.styleProps, false, 'gold is a number, not a name');
  assert.equal(g.document.head.children.length, 1, 'one stylesheet');
  assert.equal(g.timers.filter((t) => t.ms === 4500).length, 2, 'each toast has its own leaving');
  g.fireTimers();
  assert.equal(stack.children.length, 0);
});

test('unlock() without a document is quiet, and still tells the studio', async () => {
  const g = boot({ dom: false, routes: nobodyHeld });
  await settle();
  g.Achievements.unlock('secret');
  await settle();
  assert.deepEqual(posts(g), ['secret']);
  assert.deepEqual(g.warnings, []);
});

test('entries outside the shape are skipped with one warning each, the rest kept', async () => {
  const many = Array.from({ length: 52 }, (_, i) => `{ id: "a${i}", name: "A${i}", when: { moment: "other" } }`);
  const g = boot({
    rules: `const ACHIEVEMENTS = [
      { id: "Bad Id", name: "x", when: { moment: "m" } },
      { id: "no-name", when: { moment: "m" } },
      { id: "long-name", name: "${'n'.repeat(61)}", when: { moment: "m" } },
      { id: "long-how", name: "x", how: "${'h'.repeat(201)}", when: { moment: "m" } },
      { id: "big-icon", name: "x", icon: "🚀🚀🚀🚀🚀🚀🚀🚀🚀", when: { moment: "m" } },
      { id: "bad-moment", name: "x", when: { moment: "Not A Slug" } },
      { id: "bad-test", name: "x", when: { moment: "m", atLeast: "five" } },
      { id: "bad-is", name: "x", when: { moment: "m", is: {} } },
      { id: "twice", name: "x", when: { moment: "other" } },
      { id: "twice", name: "y", when: { moment: "other" } },
      "not an object",
      { id: "fine", name: "Fine", how: "", icon: "", when: { moment: "m", atLeast: 1, atMost: 3 } },
      ${many.join(',\n')}
    ];`,
  });
  assert.equal(g.warnings.length, 11, `${g.warnings.join('\n')}`);
  assert.match(g.warnings[0], /"Bad Id" .* is skipped: its id is not a short slug/);
  assert.match(g.warnings[1], /"no-name" .* its name is missing/);
  assert.match(g.warnings[2], /"long-name" .* longer than 60/);
  assert.match(g.warnings[3], /"long-how" .* up to 200/);
  assert.match(g.warnings[4], /"big-icon" .* not one emoji/);
  assert.match(g.warnings[5], /"bad-moment" .* does not name a moment/);
  assert.match(g.warnings[6], /"bad-test" .* does not name a moment and one test/);
  assert.match(g.warnings[7], /"bad-is"/);
  assert.match(g.warnings[8], /"twice" .* already used/);
  assert.match(g.warnings[9], /entry 11 .* not an object/);
  assert.match(g.warnings[10], /more than 50: the rest are skipped/);

  // Two tests both have to hold; a blank how and icon are simply absent.
  g.Moments.say('m', 4);
  await settle();
  assert.deepEqual(names(g), []);
  g.Moments.say('m', 2);
  await settle();
  assert.deepEqual(names(g), ['Fine']);
  const toast = toasts(g)[0];
  assert.equal(textOf(toast, 'achievements-how'), null);
  assert.equal(textOf(toast, 'achievements-icon'), '');
  const mine = await g.Achievements.mine();
  assert.equal(mine.length, 50, 'the first fifty in the shape, "twice" once');
  assert.equal(mine[0].id, 'twice');
  assert.equal(mine[1].id, 'fine');
});

test('a missing or misshapen file is one warning, and unlock() another', () => {
  const missing = boot({ rules: '' });
  assert.equal(missing.warnings.length, 1);
  assert.match(missing.warnings[0], /config\/achievements\.js is missing/);
  missing.Moments.say('run-over');
  missing.Achievements.unlock('first-run');
  assert.equal(missing.warnings.length, 2);
  assert.deepEqual(names(missing), []);

  const notList = boot({ rules: 'const ACHIEVEMENTS = { id: "x" };' });
  assert.equal(notList.warnings.length, 1);
  assert.match(notList.warnings[0], /is not a list/);
});

test('mine() is the studio\'s list, or the file\'s own with nothing got', async () => {
  const served = [
    { id: 'first-run', name: 'First run', how: 'Finish a run', icon: '🚀', got: '2026-09-01T10:00:00Z' },
  ];
  const inn = boot({ routes: { [ROCKS]: { body: { achievements: served } } } });
  const mine = await inn.Achievements.mine();
  assert.deepEqual(mine.map((a) => ({ ...a })), served);
  assert.equal(inn.calls.filter((c) => c.url === ROCKS && !c.init).length, 2, 'asked on load, and asked again');

  const out = boot();
  const own = await out.Achievements.mine();
  assert.equal(own.length, 7);
  assert.deepEqual({ ...own[0] }, { id: 'first-run', name: 'First run', how: 'Finish a run', icon: '🚀', got: null });
  assert.deepEqual({ ...own[2] }, { id: 'quick', name: 'Quick', how: 'Finish in 30 seconds', icon: null, got: null });

  const broken = boot({ routes: { [ROCKS]: { status: 500, body: {} } } });
  await settle();
  assert.equal((await broken.Achievements.mine()).length, 7, 'the file\'s own when the studio cannot answer');
});

// ⚠️ Why every rule is `body :where(…)`: the sheet is appended after the game's
// own <link>, so it wins every tie at equal weight, and a layer loses to any
// unlayered reset. One element selector — 0-0-1 — is the weight under which a
// game's `.achievements-name { … }` wins and its `* { margin: 0 }` does not.
test('the toast\'s css weighs one element selector, so a game\'s own wins', async () => {
  const g = boot();
  g.Achievements.unlock('secret');
  await settle();
  const css = g.document.head.children[0].textContent;
  assert.equal(css.includes('@layer'), false);
  assert.equal(css.includes('!important'), false);
  assert.ok(css.startsWith(':where(:root){--achievements-font:'), 'the variables are 0-0-0 defaults');
  assert.ok(css.includes('z-index:9999'), 'over the title screen, under nothing');
  const rules = css.slice(css.indexOf('}') + 1).split('}').map((c) => c.split('{')[0].trim()).filter(Boolean);
  assert.ok(rules.length >= 7, `${rules.length} rules`);
  for (const selector of rules) {
    if (selector.startsWith('@keyframes') || selector === 'from' || selector === 'to') continue;
    assert.ok(selector.startsWith('body :where('), selector);
    assert.equal(selector.replace(/:where\([^)]*\)/g, '').replace('body', '').trim(), '', selector);
  }
});
