// The reporter as it runs inside a framed game: the script wrapHtml injects,
// run in a vm with the window it expects faked — a parent to post to, a
// location with a slug, the listeners it adds. What it forwards is what the
// studio paints, so the shape of each message is held here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { wrapHtml } from '../server/reporter.js';

function boot({ framed = true } = {}) {
  const posts = [];
  const handlers = new Map();
  const timers = [];
  const html = wrapHtml('<!doctype html><html><head></head><body></body></html>', 'abc123');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const sandbox = {
    location: { pathname: '/tank/index.html' },
    console: { error() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    addEventListener: (type, fn) => { handlers.set(type, fn); },
    Array,
    String,
  };
  sandbox.window = sandbox;
  // Cloned into this realm the way postMessage structured-clones, so a strict
  // deep compare is not tripped by the vm's own Object.prototype.
  sandbox.parent = framed ? { postMessage: (msg) => posts.push(JSON.parse(JSON.stringify(msg))) } : sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return {
    posts,
    say: (name, value) => handlers.get('moment')?.({ detail: { name, value } }),
    fire: () => { for (const t of timers.splice(0)) t.fn(); },
    timers,
    handlers,
  };
}

test('moments are forwarded in one batch: the latest value per name, and how often', () => {
  const g = boot();
  g.say('level', 1);
  g.say('level', 2);
  g.say('score', 40);
  g.say('run-over');
  g.say('level', 3);
  assert.deepEqual(g.posts, [], 'nothing until the throttle fires');
  assert.equal(g.timers.length, 1, 'one timer for the burst');
  assert.equal(g.timers[0].ms, 250);
  g.fire();
  assert.deepEqual(g.posts, [{
    gamestudio: 'moment',
    slug: 'tank',
    version: 'abc123',
    moments: [
      { name: 'level', value: 3, times: 3 },
      { name: 'score', value: 40, times: 1 },
      { name: 'run-over', value: true, times: 1 },
    ],
  }]);
  // The next burst is its own batch.
  g.say('level', 4);
  g.fire();
  assert.equal(g.posts.length, 2);
  assert.deepEqual(g.posts[1].moments, [{ name: 'level', value: 4, times: 1 }]);
});

test('what a game dispatches itself is bounded before it leaves the frame', () => {
  const g = boot();
  g.say('x'.repeat(60), 'y'.repeat(200));
  g.say('odd', { not: 'a value' });
  g.say(7, 1);
  g.handlers.get('moment')({ detail: null });
  g.handlers.get('moment')(null);
  for (let i = 0; i < 80; i++) g.say(`m${i}`);
  g.fire();
  const { moments } = g.posts[0];
  assert.equal(moments[0].name.length, 40);
  assert.equal(moments[0].value.length, 100);
  assert.equal(moments[1].value, true, 'anything but a number or text is heard as true');
  assert.equal(moments.length, 50, 'fifty names a batch');
});

test('opened outside the studio, the reporter does nothing at all', () => {
  const g = boot({ framed: false });
  assert.equal(g.handlers.size, 0);
  assert.equal(g.say('level', 1), undefined);
  assert.deepEqual(g.posts, []);
});

test('an error still posts as it did, keyed to the version', () => {
  const g = boot();
  g.handlers.get('error')({ message: 'boom', filename: 'http://x/tank/js/game.js', lineno: 12 });
  assert.deepEqual(g.posts, [{
    gamestudio: 'error', slug: 'tank', version: 'abc123', message: 'boom', location: 'js/game.js:12',
  }]);
});
