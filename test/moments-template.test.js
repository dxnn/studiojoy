// The moments library every game gets a copy of: Moments.say() as one
// CustomEvent on the window, and the validation in front of it. Browser code,
// so it runs here in a vm with the window's event bus faked — enough to check
// that what is said is what is heard, that anything outside the shape is one
// warning and nothing else, and that on() filters by name and can be undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const MOMENTS = fs.readFileSync(
  new URL('../public/studio-lib/moments/moments.js', import.meta.url), 'utf8',
);

// A window with nothing but events: listeners by type, dispatch to each, and
// a CustomEvent that carries its detail.
function boot({ events = true } = {}) {
  const warnings = [];
  const heard = [];
  const listeners = new Map();
  const sandbox = { console: { warn: (msg) => warnings.push(msg) } };
  if (events) {
    sandbox.CustomEvent = function CustomEvent(type, init) {
      this.type = type;
      this.detail = init ? init.detail : undefined;
    };
    sandbox.addEventListener = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    };
    sandbox.removeEventListener = (type, fn) => { listeners.get(type)?.delete(fn); };
    sandbox.dispatchEvent = (event) => {
      heard.push({ type: event.type, ...event.detail });
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
    };
  }
  sandbox.window = sandbox;
  vm.runInContext(MOMENTS, vm.createContext(sandbox));
  return { Moments: sandbox.Moments, heard, warnings, listeners };
}

test('a moment is one event on the window carrying its name and value', () => {
  const { Moments, heard } = boot();
  Moments.say('level', 3);
  Moments.say('ending', 'good');
  Moments.say('run-over');
  assert.deepEqual(heard, [
    { type: 'moment', name: 'level', value: 3 },
    { type: 'moment', name: 'ending', value: 'good' },
    { type: 'moment', name: 'run-over', value: true },
  ]);
});

test('nothing, null and true are all heard as true; zero and "" are themselves', () => {
  const { Moments, heard, warnings } = boot();
  Moments.say('a', null);
  Moments.say('a', true);
  Moments.say('a', 0);
  Moments.say('a', '');
  assert.deepEqual(heard.map((h) => h.value), [true, true, 0, '']);
  assert.deepEqual(warnings, []);
});

test('a name outside the shape is dropped with one warning', () => {
  const { Moments, heard, warnings } = boot();
  Moments.say('Level', 1); // uppercase
  Moments.say('run over'); // a space
  Moments.say(''); // nothing
  Moments.say('x'.repeat(41)); // too long
  Moments.say(7); // not text
  Moments.say(undefined);
  assert.deepEqual(heard, []);
  assert.equal(warnings.length, 6);
  for (const w of warnings) assert.match(w, /^Moments: .* is not a moment name/);
  // The whole alphabet the shape allows, at its longest.
  Moments.say('abc-123-' + 'z'.repeat(32));
  assert.equal(heard.length, 1);
});

test('a value outside the shape is dropped with one warning per name', () => {
  const { Moments, heard, warnings } = boot();
  Moments.say('bad', {});
  Moments.say('bad', NaN);
  Moments.say('bad', Infinity);
  Moments.say('bad', false);
  Moments.say('bad', 'x'.repeat(101));
  Moments.say('bad', () => {});
  assert.deepEqual(heard, []);
  assert.equal(warnings.length, 1, 'a bad value every frame is not a warning every frame');
  assert.match(warnings[0], /"bad" was said with a value/);
  // A hundred characters is the last one allowed.
  Moments.say('bad', 'x'.repeat(100));
  assert.equal(heard.length, 1);
  // Another name is its own warning.
  Moments.say('other', {});
  assert.equal(warnings.length, 2);
});

test('on() hears one name, gets the value, and its return stops it', () => {
  const { Moments } = boot();
  const levels = [];
  const off = Moments.on('level', (v) => levels.push(v));
  Moments.say('level', 1);
  Moments.say('score', 99);
  Moments.say('level', 2);
  assert.deepEqual(levels, [1, 2]);
  off();
  Moments.say('level', 3);
  assert.deepEqual(levels, [1, 2], 'nothing after off()');
  assert.equal(typeof Moments.on('level', 'not a function'), 'function', 'a bad listener is a no-op');
});

test('a window without events keeps quiet rather than throwing', () => {
  const { Moments, heard, warnings } = boot({ events: false });
  Moments.say('level', 1);
  Moments.on('level', () => {})();
  assert.deepEqual(heard, []);
  assert.deepEqual(warnings, []);
});
