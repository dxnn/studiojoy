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

function boot({ framed = true, stored = {} } = {}) {
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
    document: { readyState: 'complete', addEventListener: (type, fn) => { if (type === 'load') loads.push(fn); } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    Response,
    URL,
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

test('the game runs on the player\'s clock, which pauses, steps and slows', () => {
  const p = boot();
  const seen = loop(p);
  const start = p.run('performance.now()');
  p.frame(100);
  assert.deepEqual(seen, [start + 100], 'a real frame moves the clock by what really passed');

  p.studio({ paused: true });
  p.frame(100);
  p.frame(100);
  assert.equal(seen.length, 1, 'paused, the game is not called');
  assert.equal(p.run('performance.now()'), start + 100, 'and its time stands still');

  p.studio({ step: true });
  p.frame(100);
  assert.equal(seen.length, 2);
  assert.ok(Math.abs(seen[1] - (start + 100 + 1000 / 60)) < 1e-9, 'one step is one frame, however long the real one');

  p.studio({ paused: false, speed: 0.5 });
  p.frame(100);
  assert.ok(Math.abs(seen[2] - (seen[1] + 50)) < 1e-9, 'at half speed, half the time');
  p.studio({ speed: 7 });
  p.frame(100);
  assert.ok(Math.abs(seen[3] - (seen[2] + 50)) < 1e-9, 'a speed it does not offer is ignored');
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
});

test('it asks the studio for its settings, and only when framed', () => {
  assert.deepEqual(boot().posts, [{ what: 'ready', gamestudio: 'player-ready', slug: 'tank' }]);
  const alone = boot({ framed: false });
  assert.deepEqual(alone.posts, []);
  assert.equal(alone.run('Math.random'), alone.originalRandom, 'opened on its own, it changes nothing');
});
