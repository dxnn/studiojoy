// The Controls panel's model layer: config/controls.js in, a model out, and
// one value spliced back. Pure logic, shared with the browser
// (public/controls-editor.js) the way the quiz editor's is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  controlsModel, deadBindings, deadReason, controlsChecks,
  setScheme, setBindings, USABLE,
} from '../public/controls-editor.js';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const SEED = read('templates/controls.js'); // stick-buttons
const NONE = read('templates/controls-none.js');
const BUTTONS = read('templates/controls-buttons.js');
const DUAL_STICK = read('templates/controls-dual-stick.js');
const SWIPE_TAP = read('templates/controls-swipe-tap.js');
const ONE_BUTTON = read('templates/controls-one-button.js');

const PRESETS = {
  'stick-buttons': SEED,
  none: NONE,
  buttons: BUTTONS,
  'dual-stick': DUAL_STICK,
  'swipe-tap': SWIPE_TAP,
  'one-button': ONE_BUTTON,
};

// A controls.js from before schemes existed.
const LEGACY = `// What does what.
const CONTROLS = {
  player1: {
    left: "key:left touch:left", // move left
    fire: "key:space touch:GO",
  },
};
`;

test('every preset opens as a panel, declaring the shape it is for', () => {
  for (const [scheme, text] of Object.entries(PRESETS)) {
    const model = controlsModel(text);
    assert.equal(model.ok, true, `${scheme}: ${model.reason}`);
    assert.equal(model.scheme, scheme);
    assert.equal(model.declared, true);
    assert.ok(model.players.length >= 1, `${scheme} has a player`);
    assert.ok(model.players[0].verbs.length >= 2, `${scheme} has things to do`);
    assert.deepEqual(model.extra, [], `${scheme} holds nothing the panel hides`);
  }
});

// ⚠️ This is what pins the USABLE table to what input.js actually installs:
// a shipped preset binding something its own shape cannot read would be a
// game with a control that never fires, and would say the table is wrong.
test('no preset binds anything its own shape has not got', () => {
  for (const [scheme, text] of Object.entries(PRESETS)) {
    const dead = deadBindings(controlsModel(text));
    assert.deepEqual(dead.map((d) => `${d.verb}:${d.binding.raw} — ${d.why}`), [], scheme);
  }
  // And every shape the panel has a table for is one input.js draws.
  const input = read('studio-lib/input/input.js');
  const known = /const SCHEMES = \[(.*?)\];/.exec(input)[1]
    .split(',').map((s) => s.trim().replace(/"/g, ''));
  for (const shape of Object.keys(USABLE)) {
    if (shape === '') continue; // no SCHEME at all, which draws the buttons shape
    assert.ok(known.includes(shape), `${shape} is a shape input.js knows`);
  }
});

// The one thing about the whole file that no single row shows, and the thing
// picking a shape is most likely to cause: the bindings are left alone on
// purpose, so a stick game turned into a swipe game has nothing a finger can
// reach until somebody says what the swipes do.
test('a shape nothing on the screen answers to is said out loud', () => {
  for (const [scheme, text] of Object.entries(PRESETS)) {
    assert.deepEqual(controlsChecks(controlsModel(text)), [], `${scheme} as it ships`);
  }
  const stranded = controlsChecks(controlsModel(setScheme(SEED, 'swipe-tap')));
  assert.equal(stranded.length, 1);
  assert.match(stranded[0], /cannot be played at all/);
  // The null controller needs nothing on the screen: the game's own buttons
  // are what a finger reaches, and they are not in this file.
  assert.deepEqual(controlsChecks(controlsModel(setScheme(SEED, 'none'))), []);
  // A shape whose drawn things are all dead counts as none of them.
  assert.equal(controlsChecks(controlsModel(SEED), 'dual-stick').length, 0, 'its sticks live');
  assert.equal(controlsChecks(controlsModel(BUTTONS), 'dual-stick').length, 1, 'its buttons do not');
});

test('what a shape has not got, said one binding at a time', () => {
  const why = (shape, raw) => deadReason(shape, {
    kind: raw.slice(0, raw.indexOf(':')), name: raw.slice(raw.indexOf(':') + 1), raw,
  });
  assert.match(why('swipe-tap', 'stick:left'), /no stick/);
  assert.match(why('swipe-tap', 'touch:GO'), /no drawn buttons/);
  assert.match(why('buttons', 'swipe:left'), /no swipes/);
  assert.match(why('none', 'touch:GO'), /draws nothing/);
  assert.match(why('none', 'stick:left'), /no stick/);
  // One stick is not two: the aim stick is only in the dual-stick shape.
  assert.match(why('stick-buttons', 'stick:aim-left'), /one stick/);
  assert.equal(why('dual-stick', 'stick:aim-left'), null);
  // In one-button the whole screen is the button, so a named one is not read.
  assert.match(why('one-button', 'touch:GO'), /only touch:screen/);
  assert.equal(why('one-button', 'touch:screen'), null);
  // Keys and controllers work in every shape, which is the point of them.
  for (const shape of Object.keys(USABLE)) {
    assert.equal(why(shape, 'key:space'), null, shape);
    assert.equal(why(shape, 'pad:a'), null, shape);
  }
  // A word that is no kind of binding at all.
  assert.match(deadReason('buttons', { kind: null, name: 'jump', raw: 'jump' }), /not a kind/);
});

test('a game from before the word plays as the buttons shape', () => {
  const model = controlsModel(LEGACY);
  assert.equal(model.ok, true, model.reason);
  assert.equal(model.scheme, '');
  assert.equal(model.declared, false);
  assert.deepEqual(deadBindings(model), [], 'and its drawn buttons all work');
});

test('changing the shape changes one word and nothing else', () => {
  const next = setScheme(SEED, 'dual-stick');
  assert.match(next, /const SCHEME = "dual-stick";/);
  assert.equal(
    next.replace('const SCHEME = "dual-stick"', 'const SCHEME = "stick-buttons"'),
    SEED, 'byte for byte otherwise — every comment and every space',
  );
  // The bindings are left alone on purpose: the verbs are the game's own
  // words and its code asks for them by name. What the new shape cannot use
  // is said in the panel instead.
  const model = controlsModel(next);
  assert.equal(model.scheme, 'dual-stick');
  assert.deepEqual(
    model.players[0].verbs.map((v) => v.verb),
    controlsModel(SEED).players[0].verbs.map((v) => v.verb),
  );
});

test('a game from before the word gets the declaration written in', () => {
  const next = setScheme(LEGACY, 'one-button');
  assert.match(next, /const SCHEME = "one-button";/);
  const model = controlsModel(next);
  assert.equal(model.scheme, 'one-button');
  assert.equal(model.declared, true);
  // Above the bindings, where every preset keeps it, and the comment the file
  // opens with stays where it was.
  assert.ok(next.indexOf('const SCHEME') < next.indexOf('const CONTROLS'));
  assert.ok(next.startsWith('// What does what.\n'));
  assert.deepEqual(model.players[0].verbs.map((v) => v.verb), ['left', 'fire']);
});

test('taking a binding out rewrites one line and keeps its comment', () => {
  const next = setBindings(SEED, 'player1', 'fire', ['key:space', 'pad:a']);
  assert.match(next, /fire: "key:space pad:a", \/\/ the main button/);
  const model = controlsModel(next);
  const fire = model.players[0].verbs.find((v) => v.verb === 'fire');
  assert.deepEqual(fire.bindings.map((b) => b.raw), ['key:space', 'pad:a']);
  // Every other verb is untouched.
  assert.equal(
    next.replace('fire: "key:space pad:a"', 'fire: "key:space pad:a touch:GO"'), SEED,
  );
});

test('a file the panel will not open says why, and is not refused for nothing', () => {
  const bad = (text) => controlsModel(text).reason;
  assert.match(bad('const CONTROLS = ["left"];'), /not a group of players/);
  assert.match(bad('const CONTROLS = { player1: "key:left" };'), /not a group of things to do/);
  assert.match(
    bad('const CONTROLS = { player1: { left: ["key:left"] } };'),
    /not written as one line/,
  );
  assert.match(bad('const SCHEME = 3;\nconst CONTROLS = { player1: {} };'), /not one word/);
  assert.match(bad('const LOOK = { a: 1 };'), /does not say what the controls are/);
  // Code in the file is the config reader's refusal, passed through as it is.
  assert.match(bad('const CONTROLS = window.x;'), /not a plain value/);
});

test('a declaration the panel does not show is said, not hidden', () => {
  const model = controlsModel(`${SEED}\nconst HIDDEN = ["debug"];\nconst SPEED = 3;\n`);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(model.hidden, ['debug'], 'HIDDEN it knows');
  assert.deepEqual(model.extra, ['SPEED'], 'and says the rest out loud');
});
