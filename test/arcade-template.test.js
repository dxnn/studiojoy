// The arcade template: the starter tree a canvas game is made from. It exists
// to be the *shape of a game* written out — every studio call in the right
// place — so what is held here is that it still is one. A template that
// quietly stops calling Screens.fit teaches every game made from it to size
// itself, which is the bug the whole thing was built to stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const HTML = read('game-templates/arcade/index.html');
const GAME = read('game-templates/arcade/js/game.js');
const CSS = read('game-templates/arcade/css/style.css');
const PLAY = read('game-templates/arcade/config/play.js');
const WORDS = read('game-templates/arcade/config/words.js');
const RULES = read('game-templates/arcade/config/achievements.js');
const SEED = read('templates/controls-buttons.js');
const INDEX = JSON.parse(read('game-templates/index.json'));

// ⚠️ Comments out first, every time. These files talk *about* their own calls
// — the achievements config lists five example rules, index.html names the
// screens library in a comment before it loads it — and a test that reads the
// prose fails on a file that is perfectly correct.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scripts = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test('the arcade template is registered, with a scheme and a heart', () => {
  const arcade = INDEX.templates.arcade;
  assert.ok(arcade, 'listed in game-templates/index.json');
  // It fixes how it is played, so New game never asks — a canvas game steered
  // with drawn buttons is the whole point of it.
  assert.equal(arcade.scheme, 'buttons');
  // The file the studio opens the new game on: the numbers, not the code.
  assert.equal(arcade.heart, 'config/play.js');
  assert.ok(fs.existsSync(new URL('../public/game-templates/arcade/config/play.js', import.meta.url)));
});

test('the arcade template makes the calls a game is shaped by', () => {
  // ⚠️ Each of these is a thing an agent hand-rolled at least once before the
  // preamble said not to. The template is where it is already done.
  assert.match(GAME, /Screens\.fit\(/, 'how big the game is');
  assert.match(GAME, /Screens\.chips\(/, 'the HUD strip');
  assert.match(GAME, /Screens\.title\(/, 'title and game-over, one call');
  assert.match(GAME, /post: score !== undefined/, 'and the run goes on the board');
  assert.match(GAME, /Input\.update\(\)/, 'every frame begins with it');
  assert.match(GAME, /Moments\.say\(/, 'it says what happened');
  // A meter chip, which is the reason a game would otherwise build its own HUD.
  assert.match(GAME, /value: Run\.charge, max: PLAY\.CHARGE_FULL/);
});

test('the arcade template leaves its own size alone', () => {
  // ⚠️ The trap this template exists to close. A width on either of these
  // beats nothing — fit writes inline — but it is the line somebody copies
  // into the next game, where there is no fit to overrule it.
  const rules = code(CSS); // its comments talk about width on purpose
  assert.doesNotMatch(rules, /#wrap\s*{[^}]*width/);
  assert.doesNotMatch(rules, /canvas\s*{[^}]*max-width/);
  assert.match(rules, /#wrap\s*{\s*position: relative;\s*}/);
  // And the canvas keeps its own pixels, which is what fit needs to work the
  // shape out from.
  assert.match(HTML, /<canvas id="game" width="960" height="600">/);
});

test('the arcade template loads its libraries in an order that works', () => {
  const at = (src) => scripts.indexOf(src);
  assert.ok(at('js/game.js') >= 0, 'the game is loaded at all');
  // config/controls.js is what input and screens both read.
  assert.ok(at('config/controls.js') < at('studio/input.js'), 'controls before input');
  assert.ok(at('config/controls.js') < at('studio/screens.js'), 'controls before screens');
  // The game itself last, after every config it reads at load.
  for (const before of ['config/look.js', 'config/play.js', 'config/words.js', 'studio/screens.js']) {
    assert.ok(at(before) >= 0 && at(before) < at('js/game.js'), `${before} before js/game.js`);
  }
  assert.equal(scripts[scripts.length - 1], 'js/game.js');
  // No HUD markup: the strip is the library's.
  assert.doesNotMatch(HTML, /id="hud/);
});

test('the arcade template plays with the verbs its scheme actually seeds', () => {
  // The template ships no config/controls.js — the scheme's seed writes it at
  // creation — so ⚠️ the words the game asks Input for have to be that seed's
  // words, or a new game is unplayable in a way nothing else would catch.
  assert.equal(
    fs.existsSync(new URL('../public/game-templates/arcade/config/controls.js', import.meta.url)),
    false,
    'the seed writes it, so the template must not',
  );
  const seeded = new Set([...SEED.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
  for (const verb of [...GAME.matchAll(/Input\.(?:held|pressed)\("(\w+)"\)/g)].map((m) => m[1])) {
    assert.ok(seeded.has(verb), `${verb} is a verb controls-buttons.js seeds`);
  }
});

test('every achievement in the arcade template names a moment it says', () => {
  const said = new Set([...code(GAME).matchAll(/Moments\.say\("([\w-]+)"/g)].map((m) => m[1]));
  const wanted = [...code(RULES).matchAll(/moment: "([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(wanted.length >= 3, 'it ships some achievements');
  for (const moment of wanted) {
    assert.ok(said.has(moment), `the game says "${moment}"`);
  }
});

test('the arcade template keeps its numbers and its words out of the code', () => {
  // Both files exist to be edited by somebody who will not open js/game.js.
  for (const key of ['LIVES', 'SHIP_SPEED', 'ROCK_GAP', 'CHARGE_FULL', 'ROCK_POINTS']) {
    assert.match(PLAY, new RegExp(`${key}:`), `config/play.js sets ${key}`);
  }
  for (const key of ['title', 'tagline', 'hudScore', 'hudCharge']) {
    assert.match(WORDS, new RegExp(`${key}:`), `config/words.js sets ${key}`);
  }
  // ⚠️ A number written into the game instead of into play.js is a knob
  // nobody can find. These are the ones most likely to drift back in.
  assert.match(GAME, /PLAY\.SHIP_SPEED/);
  assert.match(GAME, /PLAY\.CHARGE_FULL/);
  assert.match(GAME, /WORDS\.hudScore/);
});
