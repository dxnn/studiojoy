// The knock-it-down template: the starter tree a physics game is made from.
// Like the racing one, it is the *shape of a game* written out — every studio
// call in its place — with the physics library as the one thing more: the
// world is built from its heart, and the game and the world editor have to
// mean the same thing by where a body is. test/templates.test.js holds the
// contract every template keeps; this is what is this one's alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { worldModel, worldChecks, worldText, KINDS } from '../public/world-editor.js';

const read = (rel) => fs.readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const HTML = read('game-templates/knockdown/index.html');
const GAME = read('game-templates/knockdown/js/knock.js');
const CSS = read('game-templates/knockdown/css/style.css');
const PLAY = read('game-templates/knockdown/config/play.js');
const WORDS = read('game-templates/knockdown/config/words.js');
const CONTROLS = read('game-templates/knockdown/config/controls.js');
const BODIES = read('game-templates/knockdown/config/bodies.js');
const INDEX = JSON.parse(read('game-templates/index.json'));

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scripts = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

test('the template is registered, pressed not steered, born holding physics', () => {
  const t = INDEX.templates.knockdown;
  assert.equal(t.heart, 'config/bodies.js');
  assert.equal(t.scheme, 'none', 'the sling is the control');
  assert.deepEqual(t.libraries, ['physics']);
  assert.match(t.what, /Build the pile/);
});

test('it makes the calls a game is shaped by, and the physics does the moving', () => {
  assert.match(GAME, /Screens\.fit\(/);
  assert.match(GAME, /Screens\.chips\(/);
  assert.match(GAME, /Screens\.title\(/);
  assert.match(GAME, /post: true/);
  assert.match(GAME, /board: true/);
  assert.match(GAME, /Input\.update\(\)/);
  assert.match(GAME, /Moments\.say\(/);
  assert.match(GAME, /Physics\.build\(BODIES/, 'the world is the heart');
  assert.match(GAME, /Physics\.step\(dt\)/);
  assert.match(GAME, /Physics\.onHit\(/);
  // ⚠️ The one rule the library cannot keep for the game: a block never moves.
  assert.match(GAME, /still: b\.kind === "block"/);
});

test('it leaves its own size alone, and a finger pulls rather than scrolls', () => {
  assert.doesNotMatch(code(CSS), /#wrap\s*{[^}]*width/);
  assert.match(CSS, /touch-action: none/);
  assert.match(HTML, /<canvas id="game" width="960" height="600">/);
});

test('planck loads before the façade, and both before the game', () => {
  const at = (src) => scripts.indexOf(src);
  assert.ok(at('studio/planck.min.js') < at('studio/physics.js'));
  for (const before of ['studio/physics.js', 'config/bodies.js', 'config/play.js', 'config/look.js', 'config/words.js']) {
    assert.ok(at(before) >= 0 && at(before) < at('js/knock.js'), `${before} before js/knock.js`);
  }
});

test('it plays with the verbs its controls bind', () => {
  assert.match(CONTROLS, /const SCHEME = "none";/);
  const verbs = new Set([...CONTROLS.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]));
  for (const verb of [...GAME.matchAll(/Input\.(?:held|pressed|axis)\("(\w+)"(?:, "(\w+)")?\)/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean)) {
    assert.ok(verbs.has(verb), `${verb} is a verb config/controls.js binds`);
  }
});

test('it keeps its numbers and its words out of the code', () => {
  for (const key of ['SHOTS', 'GRAVITY', 'BOUNCE', 'FRICTION', 'SHOT_SIZE', 'SHOT_WEIGHT', 'PULL', 'MAX_SPEED', 'REACH', 'AIM_DOTS', 'POP', 'SETTLE', 'TARGET_POINTS', 'SHOT_POINTS']) {
    assert.match(PLAY, new RegExp(`${key}:`), `config/play.js sets ${key}`);
    assert.ok(code(GAME).includes(`PLAY.${key}`), `the game reads PLAY.${key}`);
  }
  for (const key of ['hudShots', 'hudTargets', 'hudScore', 'cleared', 'clearedHow', 'missed', 'missedHow', 'start', 'again']) {
    assert.match(WORDS, new RegExp(`${key}:`), `config/words.js sets ${key}`);
    assert.ok(code(GAME).includes(`WORDS.${key}`), `the game reads WORDS.${key}`);
  }
  assert.ok(code(GAME).includes('SLING.at'));
});

test('the shipped world is one the editor reads clean and writes back byte for byte', () => {
  const model = worldModel(BODIES);
  assert.equal(model.ok, true, model.reason);
  assert.deepEqual(worldChecks(model), []);
  assert.equal(worldText(model), BODIES);
  // Two kinds mean something to the game — a block never moves, a target is
  // what counts — and a box and a ball are drawn by their shape.
  assert.deepEqual(KINDS, ['box', 'block', 'ball', 'target']);
  for (const kind of ['block', 'target']) assert.ok(code(GAME).includes(`"${kind}"`), `the game knows a ${kind}`);
});

// The one thing only the real physics can say: the pile the template ships
// stands up on its own. A tower that falls before the first shot is a game
// that plays itself.
test('the shipped world stands still until something hits it', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(read('studio-lib/physics/planck.min.js'), ctx);
  vm.runInContext(`${read('studio-lib/physics/physics.js')}\n${BODIES}\n${PLAY}\nthis.Physics = Physics; this.BODIES = BODIES; this.PLAY = PLAY;`, ctx);
  const { Physics } = ctx;
  Physics.world({ gravity: ctx.PLAY.GRAVITY, bounce: ctx.PLAY.BOUNCE, friction: ctx.PLAY.FRICTION });
  const bodies = Physics.build(ctx.BODIES.map((b) => ({ ...b, still: b.kind === 'block' })));
  const hard = [];
  Physics.onHit((a, b, speed) => { if (speed >= ctx.PLAY.POP) hard.push([a.kind, b.kind]); });
  for (let i = 0; i < 180; i += 1) Physics.step(1 / 60);
  for (const b of bodies) {
    const [x, y] = b.thing.at;
    assert.ok(Math.hypot(b.x - x, b.y - y) < 3, `the ${b.kind} at ${x}, ${y} stayed put (now ${Math.round(b.x)}, ${Math.round(b.y)})`);
  }
  assert.equal(hard.length, 0, 'and nothing knocked anything down');
  assert.equal(Physics.moving(), false);
});

test('it ships its three sounds, made by the sound maker', () => {
  for (const name of ['hit', 'pop', 'fling']) {
    const bytes = fs.readFileSync(new URL(`../public/game-templates/knockdown/assets/sounds/${name}.wav`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.ok(bytes.includes('"studio":1'), `${name}.wav carries its sound note`);
    assert.ok(code(GAME).includes(`"${name}"`), `the game plays ${name}`);
  }
});
