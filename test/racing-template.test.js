// The racing template: the starter tree a lap racer is made from. Like the
// arcade's, it is the *shape of a game* written out — every studio call in
// its place — with one thing more: its heart is drawn, and the game and the
// track editor have to mean the same thing by "on the road".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseConfigFile } from '../public/config-file.js';
import { trackModel, trackChecks } from '../public/track-editor.js';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const HTML = read('game-templates/racing/index.html');
const GAME = read('game-templates/racing/js/race.js');
const CSS = read('game-templates/racing/css/style.css');
const PLAY = read('game-templates/racing/config/play.js');
const WORDS = read('game-templates/racing/config/words.js');
const RULES = read('game-templates/racing/config/achievements.js');
const CONTROLS = read('game-templates/racing/config/controls.js');
const TRACK = read('game-templates/racing/config/track.js');
const INDEX = JSON.parse(read('game-templates/index.json'));

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scripts = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test('the racing template is registered, steered with buttons, with the track as its heart', () => {
  const racing = INDEX.templates.racing;
  assert.ok(racing, 'listed in game-templates/index.json');
  assert.equal(racing.scheme, 'buttons');
  assert.equal(racing.heart, 'config/track.js');
  assert.ok(fs.existsSync(new URL('../public/game-templates/racing/config/track.js', import.meta.url)));
  assert.match(racing.what, /Draw the track/);
});

test('the racing template makes the calls a game is shaped by', () => {
  assert.match(GAME, /Screens\.fit\(/, 'how big the game is');
  assert.match(GAME, /Screens\.chips\(/, 'the HUD strip');
  assert.match(GAME, /Screens\.title\(/, 'title and finish, one call');
  assert.match(GAME, /post: true/, 'and the race goes on the board');
  assert.match(GAME, /board: true/);
  assert.match(GAME, /Input\.update\(\)/, 'every frame begins with it');
  assert.match(GAME, /Sound\.loop\("engine"/, 'the engine while GO is held');
  assert.match(GAME, /Moments\.say\(/, 'it says what happened');
});

test('the racing template leaves its own size alone', () => {
  const rules = code(CSS);
  assert.doesNotMatch(rules, /#wrap\s*{[^}]*width/);
  assert.doesNotMatch(rules, /canvas\s*{[^}]*max-width/);
  assert.match(HTML, /<canvas id="game" width="960" height="600">/);
});

test('the racing template loads its libraries in an order that works', () => {
  const at = (src) => scripts.indexOf(src);
  assert.ok(at('config/controls.js') < at('studio/input.js'), 'controls before input');
  assert.ok(at('config/controls.js') < at('studio/screens.js'), 'controls before screens');
  for (const before of ['config/look.js', 'config/track.js', 'config/play.js', 'config/words.js', 'studio/screens.js']) {
    assert.ok(at(before) >= 0 && at(before) < at('js/race.js'), `${before} before js/race.js`);
  }
  assert.equal(scripts[scripts.length - 1], 'js/race.js');
  assert.doesNotMatch(HTML, /id="hud/);
});

test('the racing template ships its own controls, and plays with their verbs', () => {
  // Unlike the arcade's, this one carries config/controls.js: its buttons are
  // GO and a latching BOOST, which no seed says. It still declares the scheme
  // the registry fixes, so the two never disagree.
  assert.match(CONTROLS, /const SCHEME = "buttons";/);
  assert.match(CONTROLS, /toggle:BOOST/);
  const verbs = new Set([...CONTROLS.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
  for (const verb of [...GAME.matchAll(/Input\.(?:held|pressed|axis)\("(\w+)"(?:, "(\w+)")?\)/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean)) {
    assert.ok(verbs.has(verb), `${verb} is a verb config/controls.js binds`);
  }
});

test('every achievement in the racing template names a moment it says', () => {
  const said = new Set([...code(GAME).matchAll(/Moments\.say\("([\w-]+)"/g)].map((m) => m[1]));
  const wanted = [...code(RULES).matchAll(/moment: "([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(wanted.length >= 3, 'it ships some achievements');
  for (const moment of wanted) assert.ok(said.has(moment), `the game says "${moment}"`);
});

test('the racing template keeps its numbers and its words out of the code', () => {
  for (const key of ['LAPS', 'RIVALS', 'TURN', 'THRUST', 'TOP', 'BOOST_TOP', 'RIVAL_SPEED', 'OFF_ROAD', 'COUNTDOWN', 'PAR']) {
    assert.match(PLAY, new RegExp(`${key}:`), `config/play.js sets ${key}`);
    assert.ok(code(GAME).includes(`PLAY.${key}`), `the game reads PLAY.${key}`);
  }
  for (const key of ['hudLap', 'hudPlace', 'hudTime', 'first', 'placed', 'finished', 'go', 'again']) {
    assert.match(WORDS, new RegExp(`${key}:`), `config/words.js sets ${key}`);
    assert.ok(code(GAME).includes(`WORDS.${key}`), `the game reads WORDS.${key}`);
  }
  assert.ok(code(GAME).includes('TRACK.width'));
  assert.ok(code(GAME).includes('TRACK.points'));
  assert.ok(code(GAME).includes('TRACK.start'));
  assert.ok(code(GAME).includes('THINGS'));
});

test('the shipped track is one the editor reads clean, and its files parse', () => {
  const model = trackModel(TRACK);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(trackChecks(model), []);
  for (const rel of ['config/play.js', 'config/words.js', 'config/look.js', 'config/controls.js', 'config/achievements.js']) {
    const parsed = parseConfigFile(read(`game-templates/racing/${rel}`));
    assert.equal(parsed.ok, true, `${rel}: ${parsed.reason}`);
  }
  // Every kind the editor drops is a kind the game draws.
  for (const kind of ['rock', 'boost', 'puddle']) {
    assert.ok(code(GAME).includes(`"${kind}"`), `the game draws a ${kind}`);
  }
});

test('the racing template ships its four sounds, made by the sound maker', () => {
  for (const name of ['engine', 'bash', 'boost', 'lap']) {
    const file = new URL(`../public/game-templates/racing/assets/sounds/${name}.wav`, import.meta.url);
    assert.ok(fs.existsSync(file), `${name}.wav`);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    // The sound note is what lets it open in the editor to change.
    assert.ok(bytes.includes('"studio":1'), `${name}.wav carries its sound note`);
    assert.ok(code(GAME).includes(`"${name}"`), `the game plays ${name}`);
  }
});
