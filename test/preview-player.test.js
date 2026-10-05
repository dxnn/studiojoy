// The preview player as it runs inside the preview (server/preview-player.js):
// run in a vm with the window it expects faked — a real frame the test fires
// by hand, a real clock the test moves, a fetch that records what reached it.
// It owns the game's time and answers the boards itself, and both are held
// here, because a game in the preview can see neither happening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PREVIEW_PLAYER_JS } from '../server/preview-player.js';

const ORIGIN = 'http://games.test';

// An event the page makes — a key, a pointer, a click — as a plain object.
class FakeEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
}

function boot({ framed = true, stored = {}, doc = {}, extra = {} } = {}) {
  const posts = [];
  const handlers = new Map();
  const reached = [];
  const storage = new Map(Object.entries(stored));
  const loads = [];
  let real = 1000;
  let frame = null;
  const sandbox = {
    location: { pathname: '/tank/_studio.html', href: `${ORIGIN}/tank/_studio.html`, origin: ORIGIN },
    requestAnimationFrame: (fn) => { frame = fn; return 1; },
    cancelAnimationFrame: () => {},
    performance: { now: () => real },
    addEventListener: (type, fn) => { handlers.set(type, fn); },
    fetch: (input, init) => {
      reached.push({ url: String(input), method: init?.method ?? 'GET' });
      const body = String(input).includes('/_achievements/')
        ? { achievements: [{ id: 'first', got: '2026-10-01T00:00:00.000Z' }] }
        : { scores: [] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    },
    navigator: { sendBeacon: (url) => { reached.push({ url: String(url), method: 'BEACON' }); return true; } },
    document: {
      readyState: 'complete',
      addEventListener: (type, fn) => { if (type === 'load') loads.push(fn); },
      ...doc,
    },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    Response,
    URL,
    KeyboardEvent: FakeEvent,
    MouseEvent: FakeEvent,
    ...extra,
  };
  sandbox.window = sandbox;
  sandbox.parent = framed ? { postMessage: (msg) => posts.push(JSON.parse(JSON.stringify(msg))) } : sandbox;
  vm.createContext(sandbox);
  const originalRandom = vm.runInContext('Math.random', sandbox);
  vm.runInContext(PREVIEW_PLAYER_JS, sandbox);
  return {
    sandbox,
    posts,
    reached,
    originalRandom,
    // A real frame, `ms` after the last one.
    frame: (ms) => { real += ms; frame(real); },
    studio: (data) => handlers.get('message')?.({ source: sandbox.parent, data: { gamestudio: 'player', ...data } }),
    run: (code) => vm.runInContext(code, sandbox),
    // Something happening on the page that the player listens for.
    fire: (type, event) => handlers.get(type)?.(event),
    storage,
    // A script of the page's having run: its load event, as the page fires it.
    ran: (path) => { for (const fn of loads) fn({ target: { tagName: 'SCRIPT', src: `${ORIGIN}/tank/${path}` } }); },
  };
}

// A game's loop: asks for a frame, and is handed the clock's time.
function loop(p) {
  const seen = [];
  p.sandbox.seen = seen;
  p.run('(function go(t) { if (t !== undefined) seen.push(t); requestAnimationFrame(go); })()');
  return seen;
}

// Every speed goes in whole frames of exactly 1/60 s (decided 2026-10-05): a
// 60 Hz screen's frame is one game frame, and slow is the same frames further
// apart, never smaller ones.
test('the game runs on the player\'s clock, which pauses, steps and slows', () => {
  const step = 1000 / 60;
  const p = boot();
  const seen = loop(p);
  const start = p.run('performance.now()');
  p.frame(step);
  assert.deepEqual(seen, [start + step], 'a 60 Hz frame is one whole frame of the game');

  p.studio({ paused: true });
  p.frame(100);
  p.frame(100);
  assert.equal(seen.length, 1, 'paused, the game is not called');
  assert.equal(p.run('performance.now()'), start + step, 'and its time stands still');

  p.studio({ step: true });
  p.frame(100);
  assert.equal(seen.length, 2);
  assert.ok(Math.abs(seen[1] - (start + 2 * step)) < 1e-9, 'one step is one frame, however long the real one');

  p.studio({ paused: false, speed: 0.5 });
  p.frame(step);
  assert.equal(seen.length, 2, 'at half speed, half a frame owed is not a frame yet');
  p.frame(step);
  assert.equal(seen.length, 3);
  assert.ok(Math.abs(seen[2] - seen[1] - step) < 1e-9, 'and the game still sees a whole 1/60 s');
  p.studio({ speed: 7 });
  p.frame(step);
  p.frame(step);
  assert.equal(seen.length, 4, 'a speed it does not offer is ignored');
});

// Off Play the page loads paused, and the builder's shot is taken from it: a
// game never called has drawn nothing, so it gets one frame with no time in it.
test('a page paused before its first frame still draws one, without moving', () => {
  const p = boot();
  p.studio({ paused: true });
  const start = p.run('performance.now()');
  p.frame(100);
  const seen = loop(p);
  p.frame(100);
  assert.deepEqual(seen, [start], 'called once, the moment it asked, at the time it loaded');
  p.frame(100);
  p.frame(100);
  assert.equal(seen.length, 1, 'and once is all: paused is paused');
});

// What Asteriskoids met: a game counting per frame counted four times as fast
// in slow motion while its rocks moved at a quarter. Whole frames, further
// apart, and the frame and the second agree again.
test('at ¼× the game gets a whole frame every fourth screen frame', () => {
  const step = 1000 / 60;
  const p = boot();
  const seen = loop(p);
  p.studio({ speed: 0.25 });
  for (let i = 0; i < 8; i += 1) p.frame(step);
  assert.equal(seen.length, 2);
  assert.ok(Math.abs(seen[1] - seen[0] - step) < 1e-9);
});

test('a 120 Hz screen runs one every other frame, and jitter still runs one a frame', () => {
  const step = 1000 / 60;
  const fast = boot();
  const seenFast = loop(fast);
  for (let i = 0; i < 4; i += 1) fast.frame(step / 2);
  assert.equal(seenFast.length, 2, 'the game is a 60 Hz machine whatever the screen');

  const p = boot();
  const seen = loop(p);
  for (const ms of [16.2, 17.1, 16.4, 16.9, 16]) p.frame(ms);
  assert.equal(seen.length, 5, 'a frame a hair short of 1/60 s still runs one');
});

test('a game whose frame throws stops nothing but itself', () => {
  const p = boot();
  p.run('requestAnimationFrame(function () { throw new Error("boom"); })');
  assert.throws(() => p.frame(16), /boom/, 'the game\'s own error, for the reporter to file');
  const seen = loop(p);
  p.frame(16);
  assert.equal(seen.length, 1, 'the next frame still comes');
});

test('chance is the player\'s own stream', () => {
  const p = boot();
  assert.notEqual(p.run('Math.random'), p.originalRandom);
  const draws = p.run('[Math.random(), Math.random(), Math.random()]');
  assert.ok(draws.every((n) => n >= 0 && n < 1));
  assert.equal(new Set(draws).size, 3);
});

test('the preview is never on a board, and is a player called Preview', async (t) => {
  const p = boot();
  const json = async (code) => {
    const res = await p.run(code);
    return { status: res.status, body: await res.json() };
  };
  assert.deepEqual(
    await json('fetch("/_scores/tank", { method: "POST", body: "{}" })'),
    { status: 201, body: { rank: null, preview: true } },
  );
  assert.deepEqual(
    await json('fetch("/_achievements/tank", { method: "POST", body: "{}" })'),
    { status: 201, body: { new: true, preview: true } },
  );
  assert.deepEqual(await json('fetch("/_me")'), { status: 200, body: { user: { name: 'Preview' } } });
  assert.equal(p.reached.length, 0, 'none of those left the page');

  // What this player has earned: the definitions, and nothing yet.
  const earned = await json('fetch("/_achievements/tank")');
  assert.equal(earned.body.achievements[0].got, null);
  // The board itself is read as it is, and anything else passes.
  await p.run('fetch("/_scores/tank?limit=10")');
  await p.run('fetch("https://elsewhere.test/_scores/tank", { method: "POST" })');
  assert.deepEqual(p.reached.map((r) => r.url), [
    '/_achievements/tank', '/_scores/tank?limit=10', 'https://elsewhere.test/_scores/tank',
  ]);

  assert.equal(p.run('navigator.sendBeacon("/_scores/tank", "{}")'), true);
  assert.equal(p.reached.length, 3, 'a beacon to the board is swallowed too');
});

const STATE = fs.readFileSync(new URL('../public/studio-lib/state/state.js', import.meta.url), 'utf8');

test('a pin is the game\'s State and its chance; back puts both back, and shows it', () => {
  const p = boot();
  p.run(STATE);
  p.run('State.reset({ score: 1 }); var drawn = 0;'
    + '(function go(t) { if (t !== undefined) drawn += 1; requestAnimationFrame(go); })();');
  p.studio({ pin: true });
  const pinned = p.posts.find((m) => m.gamestudio === 'player-pinned');
  assert.equal(typeof pinned.savepoint.file, 'string');
  assert.equal(typeof pinned.savepoint.seed, 'number');
  const chance = p.run('JSON.stringify([Math.random(), Math.random()])');

  p.run('State.score = 50');
  p.studio({ paused: true });
  p.frame(16);
  const drawn = p.run('drawn');
  const time = p.run('performance.now()');
  p.studio({ back: pinned.savepoint });
  assert.equal(p.run('State.score'), 1);
  assert.equal(p.run('JSON.stringify([Math.random(), Math.random()])'), chance, 'the same meteors fall again');
  p.frame(16);
  assert.equal(p.run('drawn'), drawn + 1, 'paused, the moment put back is drawn once');
  assert.equal(p.run('performance.now()'), time, 'and no time passes for it');
  p.frame(16);
  assert.equal(p.run('drawn'), drawn + 1, 'then it is paused again');
});

test('a game that keeps its run outside State says it cannot be pinned', () => {
  const p = boot();
  p.studio({ pin: true });
  p.studio({ back: { file: '{}', seed: 1 } });
  assert.deepEqual(p.posts.filter((m) => m.gamestudio === 'player-unpinned').map((m) => m.reason), ['no-state', 'no-state']);
});

// Try this scene: not a way in of its own but the savepoint's — the State
// there now with the editor's fields over it, loaded, then kept as the pin.
test('a jump lays the editor\'s fields over State, loads it, and pins it', () => {
  const p = boot();
  p.run(STATE);
  p.run('State.reset({ playing: false, scene: "start", line: 4, switches: ["met"] });'
    + 'var shown = []; State.loaded(function () { shown.push(State.scene); });');
  p.studio({ jump: { playing: true, scene: 'kitchen', line: 0 } });
  assert.equal(p.run('JSON.stringify(Object.assign({}, State))'),
    '{"playing":true,"scene":"kitchen","line":0,"switches":["met"]}', 'what the editor did not say is kept');
  assert.equal(p.run('shown.join()'), 'kitchen', 'and the game was told');
  const pinned = p.posts.find((m) => m.gamestudio === 'player-pinned');
  assert.equal(JSON.parse(pinned.savepoint.file).state.scene, 'kitchen', 'Back comes here too');
});

// Tweaks: numbers tried in the studio go into the live objects the config
// files made — a const is still an object whose insides can change — and are
// kept, so the next page has them the moment that file has run.
test('a tweak goes into the running game, and the next page has it before the game does', () => {
  const p = boot();
  p.run('const PLAY = { SPEED: 4, GROUP: { A: 1, B: 2 }, LIST: [1, 2] }; const PLAIN = 5;');
  const tweaks = { 'config/play.js': { PLAY: { SPEED: 9, GROUP: { A: 3, B: 2 }, LIST: [7] }, PLAIN: 6 } };
  p.studio({ tweaks });
  assert.equal(p.run('JSON.stringify(PLAY)'), '{"SPEED":9,"GROUP":{"A":3,"B":2},"LIST":[7]}');
  assert.equal(p.run('PLAIN'), 5, 'a plain const keeps what the file says');
  assert.deepEqual(JSON.parse(p.storage.get('studio-tweaks:tank')), tweaks);

  const next = boot({ stored: { 'studio-tweaks:tank': JSON.stringify(tweaks) } });
  next.run('const PLAY = { SPEED: 4, GROUP: { A: 1, B: 2 }, LIST: [1, 2] };');
  next.ran('config/look.js');
  assert.equal(next.run('PLAY.SPEED'), 4, 'only the file the tweaks are for');
  next.ran('config/play.js');
  assert.equal(next.run('PLAY.SPEED'), 9, 'in, as that file finishes running');

  next.studio({ tweaks: {} });
  assert.equal(next.storage.get('studio-tweaks:tank'), '{}', 'undone, nothing for the page after');
  assert.equal(next.run('JSON.stringify(PLAY)'), '{"SPEED":4,"GROUP":{"A":1,"B":2},"LIST":[1,2]}',
    'and the game is back to what the file says, at once');
});

// A value put back to what the file says is no tweak at all, so the studio
// stops naming its declaration — and the game has to go back with it, now
// rather than at the next page (decided 2026-10-05).
test('a tweak let go puts the game back at once', () => {
  const p = boot();
  p.run('const PLAY = { SPEED: 4, JUMP: 2 }; const LOOK = { SKY: "#000" };');
  p.studio({ tweaks: { 'config/play.js': { PLAY: { SPEED: 9, JUMP: 2 } }, 'config/look.js': { LOOK: { SKY: "#fff" } } } });
  assert.equal(p.run('PLAY.SPEED'), 9);
  p.studio({ tweaks: { 'config/look.js': { LOOK: { SKY: "#fff" } } } });
  assert.equal(p.run('PLAY.SPEED'), 4, 'the one let go is the file\'s again');
  assert.equal(p.run('LOOK.SKY'), '#fff', 'and the one still tried is left alone');
  p.studio({ tweaks: { 'config/play.js': { PLAY: { SPEED: 7, JUMP: 2 } }, 'config/look.js': { LOOK: { SKY: "#fff" } } } });
  p.studio({ tweaks: { 'config/look.js': { LOOK: { SKY: "#fff" } } } });
  assert.equal(p.run('PLAY.SPEED'), 4, 'tried again and let go again, still the file\'s');
});

test('it asks the studio for its settings, and only when framed', () => {
  assert.deepEqual(boot().posts, [{ what: 'ready', gamestudio: 'player-ready', slug: 'tank' }]);
  const alone = boot({ framed: false });
  assert.deepEqual(alone.posts, []);
  assert.equal(alone.run('Math.random'), alone.originalRandom, 'opened on its own, it changes nothing');
});

const FRAME = 1000 / 60;
// A real frame a hair over one game frame, so rounding never makes one of
// them run none.
const TICK = FRAME + 0.001;
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('timers and Date.now keep the player\'s clock, so Pause pauses them too', () => {
  const p = boot();
  p.run('var fired = []; setTimeout(function (a) { fired.push(a); }, 100, "once");'
    + 'var every = setInterval(function () { fired.push("tick"); }, 50);');
  const date = p.run('Date.now()');
  p.studio({ paused: true });
  p.frame(500);
  const fired = () => JSON.parse(p.run('JSON.stringify(fired)'));
  assert.deepEqual(fired(), [], 'paused, no timer fires, however long it really is');
  p.studio({ paused: false });
  p.frame(50);
  assert.deepEqual(fired(), ['tick']);
  p.frame(50);
  assert.deepEqual(fired(), ['tick', 'once', 'tick'], 'each in the order it came due');
  assert.ok(Math.abs(p.run('Date.now()') - date - 100) <= 1, 'Date.now moved with the clock, not the wall');
  assert.ok(Math.abs(p.run('new Date().getTime()') - date - 100) <= 1, 'and so did new Date()');
  assert.equal(p.run('new Date(0).getTime()'), 0, 'a Date of a given time is that time');
  assert.equal(p.run('new Date() instanceof Date'), true);
  p.run('clearInterval(every)');
  p.frame(500);
  assert.equal(p.run('fired.length'), 3);
});

test('an input event\'s timeStamp is the player\'s clock too', () => {
  class Event {}
  Object.defineProperty(Event.prototype, 'timeStamp', { configurable: true, get: () => -1 });
  const p = boot({ extra: { Event } });
  p.studio({ paused: true });
  p.frame(500);
  assert.equal(p.run('new Event().timeStamp'), p.run('performance.now()'), 'paused, a tap\'s time stands still with the game');
});

test('a timer that throws is the game\'s error, and the frame goes on', () => {
  const thrown = [];
  const p = boot({ extra: { setTimeout: (fn) => { try { fn(); } catch (err) { thrown.push(err.message); } } } });
  const seen = loop(p);
  p.run('setTimeout(function () { throw new Error("late"); }, 0)');
  p.frame(16);
  assert.deepEqual(thrown, ['late'], 'thrown again on a real timer, for the reporter');
  assert.equal(seen.length, 1, 'and the game still had its frame');
});

test('fast, the clock goes in whole frames, as many as are owed, and silently', () => {
  const calls = [];
  class Context {
    suspend() { calls.push('suspend'); return Promise.resolve(); }
    resume() { calls.push('resume'); return Promise.resolve(); }
  }
  const p = boot({ extra: { AudioContext: Context } });
  const seen = loop(p);
  p.run('var sound = new AudioContext()');
  p.studio({ speed: 4 });
  p.frame(51);
  assert.equal(seen.length, 12, '51 ms at 4× is 204 ms of game: twelve whole frames, and some owed');
  for (let i = 1; i < seen.length; i += 1) assert.ok(near(seen[i] - seen[i - 1], FRAME));
  assert.deepEqual(calls, ['suspend'], 'held while fast');
  p.run('sound.resume()');
  assert.deepEqual(calls, ['suspend'], 'a game asking for its sound back does not get it while fast');
  p.studio({ speed: 1 });
  assert.deepEqual(calls, ['suspend', 'resume'], 'and back at 1×, it is let go');
  p.studio({ speed: 16 });
  p.frame(10000);
  assert.equal(seen.length, 12 + 64, 'a machine that cannot keep up lets the rest go');
});

test('2× is a speed it takes, two of the game\'s frames to one of yours', () => {
  const p = boot();
  const seen = loop(p);
  p.studio({ speed: 2 });
  p.frame(51);
  assert.equal(seen.length, 6, '51 ms at 2× is 102 ms of game: six whole frames');
});

// A page with a keyboard and a body to tap, recording what reached it.
function page() {
  const sent = [];
  let start = null;
  const body = { dispatchEvent: (e) => sent.push(e.key === undefined ? e.type : `${e.type} ${e.key}`) };
  const doc = {
    body,
    activeElement: null,
    querySelector: (sel) => (sel.includes('screens-start') ? start : null),
    querySelectorAll: () => [],
    elementFromPoint: () => body,
  };
  // Which keys are down after everything sent so far.
  const held = () => {
    const down = new Set();
    for (const s of sent) {
      const [type, key] = s.split(' ').length > 2 ? [s.split(' ')[0], ' '] : s.split(' ');
      if (type === 'keydown') down.add(key);
      if (type === 'keyup') down.delete(key);
    }
    return [...down].sort().join(',');
  };
  return { sent, doc, held, setStart: (b) => { start = b; } };
}

const CONTROLS = 'const CONTROLS = { player1: { left: "key:left key:a pad:left", right: "key:right",'
  + ' fire: "key:space pad:a", start: "key:enter" } };';

test('the robot plays the game\'s own verbs as keys, never both ways at once', () => {
  const pg = page();
  const p = boot({ doc: pg.doc });
  p.run(CONTROLS);
  const seen = loop(p);
  p.studio({ robot: true });
  const both = [];
  for (let i = 0; i < 600; i += 1) {
    p.frame(TICK);
    if (pg.held().includes('ArrowLeft') && pg.held().includes('ArrowRight')) both.push(i);
  }
  const downs = new Set(pg.sent.filter((s) => s.startsWith('keydown')));
  assert.ok(downs.has('keydown ArrowLeft') && downs.has('keydown ArrowRight') && downs.has('keydown  '),
    'left, right and fire, each as its first key');
  assert.ok(downs.has('keydown Enter'), 'and Start now and then');
  assert.deepEqual(both, []);
  for (let i = 1; i < seen.length; i += 1) assert.ok(near(seen[i] - seen[i - 1], FRAME), 'in whole frames');

  // A person's own key takes over, and the robot lets go of everything.
  p.fire('keydown', { isTrusted: false });
  assert.ok(!p.posts.some((m) => m.gamestudio === 'player-robot'), 'its own keys never stop it');
  p.fire('keydown', { isTrusted: true });
  assert.deepEqual(p.posts.filter((m) => m.gamestudio === 'player-robot').map((m) => m.reason), ['hands']);
  assert.equal(pg.held(), '');
});

test('the robot presses Start on a title screen after a beat', () => {
  const pg = page();
  const p = boot({ doc: pg.doc });
  p.run(CONTROLS);
  loop(p);
  // Half off the bottom of a small preview, where nothing is under its
  // middle: the robot presses the button itself.
  pg.setStart({
    getBoundingClientRect: () => ({ left: 0, top: 300, width: 40, height: 20 }),
    dispatchEvent: (e) => pg.sent.push(`start ${e.type}`),
  });
  p.studio({ robot: true });
  for (let i = 0; i < 89; i += 1) p.frame(TICK);
  assert.ok(!pg.sent.includes('start click'), 'the screen is left up a moment');
  assert.equal(pg.held(), '', 'with nothing held under it');
  p.frame(TICK);
  assert.deepEqual(pg.sent.slice(-5),
    ['start pointerdown', 'start mousedown', 'start pointerup', 'start mouseup', 'start click']);
});

test('a game teaches the robot with Robot.play, handed State each frame', () => {
  const pg = page();
  const p = boot({ doc: pg.doc });
  p.run(CONTROLS);
  p.run(STATE);
  p.run('State.reset({ go: "right" }); Robot.play(function (s) { return s.go === "tap" ? { x: 5, y: 5 } : [s.go]; });');
  loop(p);
  p.studio({ robot: true });
  p.frame(TICK);
  assert.equal(pg.held(), 'ArrowRight');
  p.run('State.go = "tap"');
  p.frame(TICK);
  assert.equal(pg.held(), '', 'a tap lets go of the keys first');
  assert.equal(pg.sent.filter((s) => s === 'click').length, 1);
  for (let i = 0; i < 30; i += 1) p.frame(TICK);
  assert.equal(pg.sent.filter((s) => s === 'click').length, 1, 'and it waits a moment before deciding again');
  assert.ok(p.run('Robot.random()') < 1, 'its own dice');

  p.run('Robot.play(function () { throw new Error("my robot"); })');
  for (let i = 0; i < 10; i += 1) { try { p.frame(TICK); } catch { /* the teacher's error, below */ } }
  assert.equal(p.posts.filter((m) => m.gamestudio === 'player-robot').at(-1).reason, 'taught',
    'a broken teacher stops it, and its error goes on to the reporter');
});

test('when the game breaks, the robot hands over a moment from seconds before', () => {
  const pg = page();
  const p = boot({ doc: pg.doc });
  p.run(CONTROLS);
  p.run(STATE);
  p.run('State.reset({ t: 0 }); (function go() { State.t += 1; requestAnimationFrame(go); })();');
  p.studio({ robot: true });
  for (let i = 0; i < 400; i += 1) p.frame(TICK);
  p.fire('error', { message: 'boom' });
  const told = p.posts.filter((m) => m.gamestudio === 'player-robot').at(-1);
  assert.equal(told.reason, 'broke');
  assert.equal(told.message, 'boom');
  assert.equal(JSON.parse(told.savepoint.file).state.t, 121, 'the oldest of three kept, two seconds apart');
  assert.equal(told.savepoint.robot.frames, 120, 'taken between two frames, like a pin');
  assert.equal(pg.held(), '');
  p.fire('error', { message: 'again' });
  assert.equal(p.posts.filter((m) => m.gamestudio === 'player-robot').length, 1, 'once stopped, it says nothing more');
});

test('a moment put back plays on the same way: the game\'s dice and the robot\'s', () => {
  const pg = page();
  const p = boot({ doc: pg.doc });
  p.run(CONTROLS);
  p.run(STATE);
  p.run('State.reset({ rocks: [] }); (function go() { State.rocks.push(Math.random()); requestAnimationFrame(go); })();');
  p.studio({ robot: true });
  for (let i = 0; i < 50; i += 1) p.frame(TICK);
  p.studio({ pin: true });
  const savepoint = p.posts.find((m) => m.gamestudio === 'player-pinned').savepoint;
  assert.equal(typeof savepoint.robot.seed, 'number', 'the pin holds the robot\'s dice too');
  const play = () => {
    const out = [];
    for (let i = 0; i < 300; i += 1) { p.frame(TICK); out.push(pg.held()); }
    return { held: out, rocks: p.run('JSON.stringify(State.rocks.slice(-300))') };
  };
  const first = play();
  p.studio({ back: savepoint });
  const again = play();
  assert.deepEqual(again.held, first.held, 'the same keys, frame by frame');
  assert.equal(again.rocks, first.rocks, 'and the same rocks');
});
