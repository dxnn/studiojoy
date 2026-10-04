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
import vm from 'node:vm';
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
const STATE = read('studio-lib/state/state.js');

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the template is registered, held by a stick, born holding render3d', () => {
  const t = INDEX.templates.rollball;
  assert.equal(t.heart, 'config/level.js');
  assert.equal(t.scheme, 'stick-buttons');
  assert.deepEqual(t.libraries, ['render3d']);
  assert.match(t.what, /Paint each level/);
  // What the builder is told is what the level editor and the game hold to.
  const brief = t.brief.join(' ');
  for (const words of [/LEVELS/, /SQUARES/, /\{ name, colour, solid \}/, /ON_SQUARE/, /level editor/]) {
    assert.match(brief, words);
  }
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
  for (const key of ['hudLevel', 'hudCoins', 'hudTime', 'finished', 'finishedHow', 'start', 'again']) {
    assert.match(WORDS, new RegExp(`${key}:`), `config/words.js sets ${key}`);
    assert.ok(code(GAME).includes(`WORDS.${key}`), `the game reads WORDS.${key}`);
  }
});

test('the shipped levels read clean, write back byte for byte, and the game knows every square', () => {
  const model = levelModel(LEVEL);
  assert.equal(model.ok, true, model.reason);
  assert.ok(model.levels.length > 1, 'it ships more than one, so the list is there to be seen');
  for (const level of model.levels) assert.deepEqual(levelChecks(level, model.squares), []);
  assert.deepEqual(model.squares, {}, 'no kind of square made up: that is the game\'s to do');
  assert.equal(levelText(model), LEVEL);
  // Floor is whatever is not the others, so it needs no name in the game.
  for (const ch of CHARS.filter((x) => x !== '.')) {
    assert.ok(code(GAME).includes(`"${ch}"`), `the game knows "${ch}"`);
  }
  assert.match(code(GAME), /const ON_SQUARE = \{\};/, 'the one place a made-up square is given something to do');
});

// The game's own rolling, run for real: js/roll.js in a sandbox with a
// stand-in 3D library, input and screens, driven frame by frame. It imports
// nothing, so it runs as the script it reads like. `levels` is LEVELS,
// `game` rewrites the source first — how a test puts something in ON_SQUARE.
function roll({
  levels, squares = {}, search = '', play = {}, push = [1, 0], frames = 60, fps = 20, game = (s) => s,
}) {
  const meshes = [];
  const mesh = (o) => {
    const m = {
      o, position: { set(x, y, z) { Object.assign(this, { x, y, z }); } }, rotation: { x: 0, y: 0, z: 0 }, visible: true,
    };
    meshes.push(m);
    return m;
  };
  let frame = null;
  let started = null;
  let followed = null;
  const said = [];
  const ctx = vm.createContext({
    console,
    Math,
    URLSearchParams,
    location: { search },
    document: { getElementById: () => ({ tagName: 'CANVAS' }) },
    requestAnimationFrame: (fn) => { frame = fn; },
    Render3D: {
      start() {}, boxes() {}, box: mesh, ball: mesh, follow(t) { followed = t; }, draw() {}, remove() {}, clear() {},
    },
    Screens: { fit() {}, chips() {}, title(o) { started = o.onStart; } },
    Input: { update() {}, held: () => false, axis: (a) => (a === 'left' ? push[0] : push[1]) },
    Sound: { play() {} },
    Moments: { say: (name, value) => said.push([name, value]) },
  });
  ctx.window = ctx;
  const config = (src) => src.replace(/^const (\w+) =/gm, 'var $1 =');
  // The run is State, as on the page: the library is a script ahead of the game.
  vm.runInContext(STATE, ctx);
  vm.runInContext(`var LEVELS = ${JSON.stringify(levels)}; var SQUARES = ${JSON.stringify(squares)};`, ctx);
  vm.runInContext(config(PLAY), ctx);
  Object.assign(ctx.PLAY, play);
  vm.runInContext(config(LOOK), ctx);
  vm.runInContext(config(WORDS), ctx);
  vm.runInContext(game(GAME), ctx);
  started();
  let at = 0;
  const more = (n) => { for (let i = 0; i < n; i += 1) { at += 1; frame((at * 1000) / fps); } };
  more(frames);
  // The ball the camera is on: every level makes its own. `more` runs on.
  return {
    ball: followed, said, meshes, more,
    // A `const` on the page is reached by name, the way the preview reaches it.
    State: vm.runInContext('State', ctx),
    coins: () => meshes.filter((m) => m.o?.colour === ctx.LOOK.COIN),
  };
}

test('a fast ball, or a small one, never rolls through a wall', () => {
  // One wall square between the start and the far side, rolled at hard.
  const level = ['#######', '#S.#..#', '#######'];
  const wallFace = 0 - 0.5; // the wall at column 3 is x 0, so its near face is -0.5
  for (const play of [{}, { TOP: 10 }, { BALL_SIZE: 0.15, TOP: 10 }, { BALL_SIZE: 0.1, TOP: 20 }]) {
    for (const fps of [20, 30, 60]) {
      const { ball } = roll({ levels: [level], play, fps });
      const r = play.BALL_SIZE ?? 0.3;
      const { x } = ball.position;
      assert.ok(x <= wallFace - r + 1e-6, `${JSON.stringify(play)} at ${fps} fps: stopped at ${x.toFixed(3)}`);
    }
  }
});

test('a hole drops the ball and the goal ends the run', () => {
  const fell = roll({ levels: [['#####', '#S. #', '#####']], frames: 40 });
  assert.ok(fell.said.some(([name]) => name === 'fall'), 'it fell');
  const won = roll({ levels: [['######', '#S.oG#', '######']], frames: 40 });
  assert.deepEqual(won.said.map(([name]) => name), ['coin', 'goal', 'score']);
  assert.equal(won.said[0][1], 1, 'coin says the count this run');
});

test('a goal takes the ball on to the next level, and the last one ends the run', () => {
  const room = ['######', '#S.oG#', '######'];
  const { said } = roll({ levels: [room, room], frames: 80 });
  assert.deepEqual(said.map(([name]) => name), ['coin', 'level', 'coin', 'goal', 'score']);
  assert.equal(said[1][1], 1, 'level says the one just finished');
  assert.equal(said[2][1], 2, 'the coins count on across the levels');
});

test('?level= starts the run on the level asked for', () => {
  const trap = ['#####', '#S. #', '#####'];
  const room = ['#####', '#S.G#', '#####'];
  const { said } = roll({ levels: [trap, room], search: '?v=3&level=2', frames: 40 });
  assert.deepEqual(said.map(([name]) => name), ['goal', 'score'], 'the second, never the first');
  const odd = roll({ levels: [room], search: '?level=9', frames: 40 });
  assert.ok(odd.said.some(([name]) => name === 'goal'), 'one past the end is the first');
});

test('a made-up square is drawn before it does anything, and does what ON_SQUARE says', () => {
  const crate = { name: 'Crate', colour: '#aa7744', solid: true };
  const bomb = { name: 'Bomb', colour: '#ff5533', solid: false };
  // A solid one is a wall: the ball stops at it.
  const { ball } = roll({ levels: [['#######', '#S.c..#', '#######']], squares: { c: crate } });
  assert.ok(ball.position.x <= -0.5 - 0.3 + 1e-6, `stopped at ${ball.position.x.toFixed(3)}`);
  // One the ball rolls over is a marker in its colour, and nothing more.
  const level = ['######', '#Sb.G#', '######'];
  const quiet = roll({ levels: [level], squares: { b: bomb }, frames: 40 });
  assert.ok(quiet.meshes.some((m) => m.o?.colour === bomb.colour), 'a marker in its colour');
  assert.deepEqual(quiet.said.map(([name]) => name), ['goal', 'score']);
  const loud = roll({
    levels: [level], squares: { b: bomb }, frames: 40,
    game: (s) => s.replace('const ON_SQUARE = {};', 'const ON_SQUARE = { b: (square) => { Moments.say("bomb", square.c); fall(); } };'),
  });
  assert.deepEqual(loud.said.slice(0, 2), [['bomb', 2], ['fall', undefined]]);
});

// What the preview's Pin is: State.save(), then State.load() — and the level
// is drawn again from State, the coin picked up since gone again from it.
test('a pinned moment comes back whole: where the ball was, and the coin it had not got yet', () => {
  const game = roll({ levels: [['########', '#S..o.G#', '########']], frames: 4, push: [0.4, 0] });
  const pinned = game.State.save();
  const x = game.State.x;
  game.more(30);
  assert.equal(game.State.got, 1, 'the coin was picked up after the pin');
  assert.equal(game.State.load(pinned), true);
  assert.equal(game.State.got, 0);
  assert.equal(game.State.x, x);
  const shown = game.coins().at(-1);
  assert.equal(shown.visible, true, 'drawn again, there to be picked up');
});

test('a level with no start puts the ball on its first floor, not in a wall', () => {
  const { said } = roll({ levels: [['#####', '#..G#', '#####']], frames: 40 });
  assert.ok(said.some(([name]) => name === 'goal'));
});

test('what the achievements promise is something one run can do', () => {
  const rules = read('game-templates/rollball/config/achievements.js');
  const coins = levelModel(LEVEL).levels.flatMap((level) => level.rows.flat()).filter((ch) => ch === 'o').length;
  const collector = Number(rules.match(/moment: "coin", atLeast: (\d+)/)?.[1]);
  assert.ok(collector > 0 && collector <= coins, `${collector} coins asked, ${coins} in the level`);
  assert.doesNotMatch(rules, /moment: "coin", times:/, 'coin counts this run; times would count every run');
  const quick = Number(rules.match(/moment: "goal", atMost: (\d+)/)?.[1]);
  assert.ok(quick < Number(PLAY.match(/PAR: (\d+)/)[1]), 'speedy is under par');
});

test('it ships its three sounds, made by the sound maker', () => {
  for (const name of ['coin', 'fall', 'goal']) {
    const bytes = fs.readFileSync(new URL(`../public/game-templates/rollball/assets/sounds/${name}.wav`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.ok(bytes.includes('"studio":1'), `${name}.wav carries its sound note`);
    assert.ok(code(GAME).includes(`"${name}"`), `the game plays ${name}`);
  }
});
