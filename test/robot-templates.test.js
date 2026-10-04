// Every template teaches the preview's robot to play it (js/robot.js,
// ideas/dreams.md §4). Each file is run here the way the preview runs it —
// after the game, with Robot.play the preview player's — and its answer for a
// moment of the game is checked: the verbs it holds must be the template's
// own, or the robot presses keys nothing listens for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const TEMPLATES = new URL('../public/game-templates/', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, TEMPLATES), 'utf8');

// The template's robot, loaded into a page with `globals`, and its answer
// for each State asked.
function teach(template, globals = {}) {
  let taught = null;
  const sandbox = {
    Robot: { play: (fn) => { taught = fn; }, random: () => 0.1 },
    ...globals,
  };
  vm.createContext(sandbox);
  vm.runInContext(read(`${template}/js/robot.js`), sandbox);
  assert.equal(typeof taught, 'function', `${template} teaches the robot`);
  return (state) => JSON.parse(JSON.stringify(taught(state) ?? null));
}

// Player one's verbs in a controls file.
function verbs(source) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.out = Object.keys(CONTROLS.player1);`, sandbox);
  return sandbox.out;
}

test('every template has a robot', () => {
  const index = JSON.parse(read('index.json'));
  for (const name of Object.keys(index.templates)) {
    assert.ok(fs.existsSync(new URL(`${name}/js/robot.js`, TEMPLATES)), name);
  }
});

test('the arcade robot slides under the lowest meteor and fires', () => {
  const play = teach('arcade');
  const held = play({ ship: { x: 100 }, rocks: [{ x: 300, y: 50 }, { x: 40, y: 200 }] });
  assert.deepEqual(held, ['fire', 'left']);
  const own = verbs(fs.readFileSync(new URL('../public/templates/controls-buttons.js', import.meta.url), 'utf8'));
  for (const verb of held) assert.ok(own.includes(verb), verb);
});

test('the racing robot steers for the road ahead, foot down', () => {
  const Road = { nearest: () => ({ along: 0 }), at: () => ({ x: 100, y: 0 }) };
  const play = teach('racing', { Road });
  assert.deepEqual(play({ car: { x: 0, y: 0, angle: 0 } }), ['go', 'boost'], 'pointed straight at it');
  assert.deepEqual(play({ car: { x: 0, y: 0, angle: 1 } }), ['go', 'left']);
  const own = verbs(read('racing/config/controls.js'));
  for (const verb of ['go', 'boost', 'left', 'right']) assert.ok(own.includes(verb), verb);
});

test('the knock it down robot aims and lets go only while nothing flies', () => {
  const play = teach('knockdown');
  assert.deepEqual(play({ playing: true, flying: true }), []);
  const own = verbs(read('knockdown/config/controls.js'));
  for (const verb of play({ playing: true, flying: false })) assert.ok(own.includes(verb), verb);
});

test('the roll a ball robot heads for the nearest coin by squares it can roll on', () => {
  const LEVELS = [['#######', '#S.#o.#', '#.....#', '#######']];
  const play = teach('rollball', { LEVELS, SQUARES: {} });
  // The ball on S, world (-2, -0.5); the coin behind a wall, so the way is
  // down a row first.
  const coin = { x: 1, z: -0.5, got: false };
  const held = play({ at: 0, x: -2, z: -0.5, vx: 0, vz: 0, coins: [coin], falling: false });
  assert.deepEqual(held, ['down'], 'round the wall, starting down a row');
  const own = verbs(read('rollball/config/controls.js'));
  for (const verb of ['left', 'right', 'up', 'down', 'brake']) assert.ok(own.includes(verb), verb);
  assert.deepEqual(play({ at: 0, x: -2, z: -0.5, vx: 0, vz: 0, coins: [coin], falling: true }), [],
    'nothing while it falls');
});

// The page games: the robot taps their own buttons and boxes.
function pageWith(found) {
  return {
    querySelectorAll: (sel) => found[sel] ?? [],
    querySelector: (sel) => (found[sel] ?? [null])[0] ?? null,
  };
}

test('the quiz robot picks an answer, and starts again from the ending', () => {
  const play = teach('quiz', { document: pageWith({ '#quiz .answer': ['a', 'b', 'c'] }) });
  assert.equal(play({}), 'a', 'the one its dice say');
  const ending = teach('quiz', { document: pageWith({ '#quiz button.big': ['again'] }) });
  assert.equal(ending({}), 'again');
});

test('the story robot reads on, and picks a choice when there is one', () => {
  assert.equal(teach('visual-novel', { document: pageWith({ '#story .box': ['box'] }) })({}), 'box');
  const choosing = teach('visual-novel', {
    document: pageWith({ '#story .choice': ['left', 'right'], '#story .box': ['box'] }),
  });
  assert.equal(choosing({}), 'left');
});

test('the adventure robot reads on, then taps the middle of a spot it can use', () => {
  const box = { hidden: false };
  const reading = teach('adventure', { document: pageWith({ '#adventure .box': [box] }), SCENES: {} });
  assert.deepEqual(reading({}), { hidden: false });

  const SCENES = {
    hall: { spots: [
      { at: [0, 0, 10, 10], take: 'key' }, // already carried, so not usable
      { at: [100, 50, 20, 40], go: 'kitchen' },
    ] },
  };
  const page = pageWith({
    '#adventure .box': [{ hidden: true }],
    '#adventure .spots': [{ getBoundingClientRect: () => ({ left: 10, top: 20, width: 400 }) }],
    '#adventure .picture': [{ naturalWidth: 200 }],
  });
  const spotting = teach('adventure', { document: page, SCENES });
  assert.deepEqual(spotting({ scene: 'hall', switches: [], carried: ['key'] }), { x: 10 + 110 * 2, y: 20 + 70 * 2 });
});
