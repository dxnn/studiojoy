// The adventure template: the starter tree a point-and-click game is made
// from. What is held here is that it stays the shape the adventure editor
// reads and the preamble describes — a template that quietly grows a key the
// editor does not know costs every game made from it its editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const HTML = read('game-templates/adventure/index.html');
const GAME = read('game-templates/adventure/js/adventure.js');
const CSS = read('game-templates/adventure/css/style.css');
const WORDS = read('game-templates/adventure/config/words.js');
const BRIEF = read('game-templates/adventure/BRIEF.md');
const INDEX = JSON.parse(read('game-templates/index.json'));

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scripts = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test('the adventure template is registered, pressed not steered, with its heart', () => {
  const adventure = INDEX.templates.adventure;
  assert.ok(adventure, 'listed in game-templates/index.json');
  // The pointer is the control: nothing is drawn over the picture.
  assert.equal(adventure.scheme, 'none');
  assert.equal(adventure.heart, 'config/scenes.js');
  assert.ok(fs.existsSync(new URL('../public/game-templates/adventure/config/scenes.js', import.meta.url)));
  // The dialog's words say the one thing that makes it different: the box.
  assert.match(adventure.what, /Draw a box/);
});

test('the adventure template ships no controls file and no art', () => {
  // The seed writes config/controls.js at creation, and the pictures come
  // from the guide — the shelf, a drawing, an upload — one commit each.
  assert.equal(fs.existsSync(new URL('../public/game-templates/adventure/config/controls.js', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../public/game-templates/adventure/assets', import.meta.url)), false);
});

test('the adventure template loads its libraries in an order that works', () => {
  const at = (src) => scripts.indexOf(src);
  assert.ok(at('config/controls.js') < at('studio/input.js'), 'controls before input');
  assert.ok(at('config/controls.js') < at('studio/screens.js'), 'controls before screens');
  for (const before of ['config/look.js', 'config/words.js', 'config/scenes.js', 'studio/screens.js', 'studio/moments.js', 'studio/sound.js']) {
    assert.ok(at(before) >= 0 && at(before) < at('js/adventure.js'), `${before} before js/adventure.js`);
  }
  assert.equal(scripts[scripts.length - 1], 'js/adventure.js');
});

test('the adventure plays the shape the editor writes', () => {
  const game = code(GAME);
  // The first usable spot the point is in, top to bottom: the locked door and
  // the open one are two spots on one box.
  assert.match(game, /spotsOf\(\)\.find\(/);
  // The three things a spot does, and the two switches and the noise.
  for (const key of ['spot.go', 'spot.say', 'spot.take', 'spot.need', 'spot.set', 'spot.sound', 'spot.keep']) {
    assert.ok(game.includes(key), `${key} is read`);
  }
  // Taking a thing remembers a switch of its own name.
  assert.match(game, /switches\.add\(spot\.take\)/);
  // A scene with nothing to click on is the end, and the end is the library's
  // screen with Start again on it.
  assert.match(game, /if \(!spotsOf\(\)\.length\) \{ finish\(\); return; \}/);
  assert.match(game, /Screens\.title\(\{\s*name: WORDS\.theEnd/);
  // The four moments the achievements editor can write rules over.
  for (const name of ['scene', 'item', 'switch', 'ending']) {
    assert.match(game, new RegExp(`moment\\("${name}"`), `it says "${name}"`);
  }
  // A click is mapped back into the picture's own pixels through the box the
  // browser drew it in — the same pixels the editor's boxes are in.
  assert.match(game, /naturalWidth/);
  assert.match(game, /getBoundingClientRect/);
  // Try this scene.
  assert.match(game, /get\("scene"\)/);
  // Its own input, never the library's: the pointer is the control.
  assert.doesNotMatch(game, /Input\./);
});

test('the adventure keeps its words out of its code and its picture whole', () => {
  for (const key of ['title', 'tagline', 'howToPlay', 'start', 'theEnd', 'again', 'nothing', 'carrying']) {
    assert.match(WORDS, new RegExp(`${key}:`), `config/words.js sets ${key}`);
  }
  // The title screen's three are the screens library's to read; these five
  // the game reads itself.
  for (const key of ['start', 'theEnd', 'again', 'nothing', 'carrying']) {
    assert.ok(code(GAME).includes(`WORDS.${key}`), `the game reads WORDS.${key}`);
  }
  // contain, never cover: a cropped picture puts every spot somewhere else.
  assert.match(code(CSS), /\.picture\s*{[^}]*object-fit: contain/);
  assert.doesNotMatch(code(CSS), /object-fit: cover/);
  assert.match(code(CSS), /image-rendering: pixelated/);
});

test('the brief says what the box is and that nobody types it', () => {
  assert.match(BRIEF, /adventure editor/);
  assert.match(BRIEF, /nobody types those/);
  assert.match(BRIEF, /assets\/sprites\//);
  assert.match(BRIEF, /"none"/);
});
