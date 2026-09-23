// The roll-a-ball template: the starter tree a 3D game is made from. Like the
// others it is the *shape of a game* written out — every studio call in its
// place — with the 3D library as the one thing more, and the one page here
// whose own code is a module. test/templates.test.js holds the contract every
// template keeps, module order included; this is what is this one's alone.
// The game itself needs WebGL, so it was played through the Playwright MCP
// browser when it was built; what is held here is its shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { levelModel, levelChecks, levelText, CHARS } from '../public/level-editor.js';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const HTML = read('game-templates/rollball/index.html');
const GAME = read('game-templates/rollball/js/roll.js');
const CSS = read('game-templates/rollball/css/style.css');
const PLAY = read('game-templates/rollball/config/play.js');
const LOOK = read('game-templates/rollball/config/look.js');
const WORDS = read('game-templates/rollball/config/words.js');
const CONTROLS = read('game-templates/rollball/config/controls.js');
const LEVEL = read('game-templates/rollball/config/level.js');
const INDEX = JSON.parse(read('game-templates/index.json'));

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the template is registered, held by a stick, born holding render3d', () => {
  const t = INDEX.templates.rollball;
  assert.equal(t.heart, 'config/level.js');
  assert.equal(t.scheme, 'stick-buttons');
  assert.deepEqual(t.libraries, ['render3d']);
  assert.match(t.what, /Paint the maze/);
});

test('its own code is a module after the 3D library, which is after every classic script', () => {
  assert.match(HTML, /<script type="module" src="studio\/render3d\.js"><\/script>\s*<script type="module" src="js\/roll\.js"><\/script>\s*<\/body>/);
  assert.doesNotMatch(GAME, /^\s*import\b/m, 'it reads the globals, it imports nothing');
  assert.match(GAME, /window\.Render3D/);
});

test('it makes the calls a game is shaped by, fit before the 3D starts', () => {
  for (const call of [/Screens\.fit\(/, /Screens\.chips\(/, /Screens\.title\(/, /post: true/, /board: true/, /Input\.update\(\)/, /Moments\.say\(/]) {
    assert.match(GAME, call);
  }
  const body = code(GAME);
  assert.ok(body.indexOf('Screens.fit(') < body.indexOf('R.start('), 'fit reads 960 × 600 first');
  assert.match(body, /R\.boxes\(floor/, 'the floor is one call');
  assert.match(body, /R\.boxes\(walls/);
  assert.match(body, /R\.draw\(dt\)/);
  assert.doesNotMatch(body, /new THREE\./, 'no renderer, camera or light of its own');
});

test('it leaves its own size alone', () => {
  assert.doesNotMatch(code(CSS), /#wrap\s*{[^}]*width/);
  assert.match(HTML, /<canvas id="game" width="960" height="600">/);
});

test('it plays with the verbs its controls bind', () => {
  assert.match(CONTROLS, /const SCHEME = "stick-buttons";/);
  const verbs = new Set([...CONTROLS.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
  for (const verb of [...GAME.matchAll(/Input\.(?:held|pressed|axis)\("(\w+)"(?:, "(\w+)")?\)/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean)) {
    assert.ok(verbs.has(verb), `${verb} is a verb config/controls.js binds`);
  }
  assert.match(CONTROLS, /stick:up/, 'the stick rolls it');
});

test('it keeps its numbers and its words out of the code', () => {
  for (const key of ['BALL_SIZE', 'ROLL', 'TOP', 'FRICTION', 'BRAKE', 'BOUNCE', 'GRAVITY', 'COIN_REACH', 'RESPAWN', 'COIN_POINTS', 'PAR', 'TIME_POINTS']) {
    assert.match(PLAY, new RegExp(`${key}:`), `config/play.js sets ${key}`);
    assert.ok(code(GAME).includes(`PLAY.${key}`), `the game reads PLAY.${key}`);
  }
  for (const key of ['SKY', 'FLOOR', 'WALL', 'WALL_HEIGHT', 'BALL', 'COIN', 'GOAL', 'CAMERA_BACK', 'CAMERA_UP']) {
    assert.match(LOOK, new RegExp(`${key}:`), `config/look.js sets ${key}`);
    assert.ok(code(GAME).includes(`LOOK.${key}`), `the game reads LOOK.${key}`);
  }
  for (const key of ['hudCoins', 'hudTime', 'finished', 'finishedHow', 'start', 'again']) {
    assert.match(WORDS, new RegExp(`${key}:`), `config/words.js sets ${key}`);
    assert.ok(code(GAME).includes(`WORDS.${key}`), `the game reads WORDS.${key}`);
  }
});

test('the shipped level reads clean, writes back byte for byte, and the game knows every square', () => {
  const model = levelModel(LEVEL);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(levelChecks(model), []);
  assert.equal(levelText(model), LEVEL);
  // Floor is whatever is not the others, so it needs no name in the game.
  for (const ch of CHARS.filter((x) => x !== '.')) {
    assert.ok(code(GAME).includes(`"${ch}"`), `the game knows "${ch}"`);
  }
});

test('it ships its three sounds, made by the sound maker', () => {
  for (const name of ['coin', 'fall', 'goal']) {
    const bytes = fs.readFileSync(new URL(`../public/game-templates/rollball/assets/sounds/${name}.wav`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.ok(bytes.includes('"studio":1'), `${name}.wav carries its sound note`);
    assert.ok(code(GAME).includes(`"${name}"`), `the game plays ${name}`);
  }
});
