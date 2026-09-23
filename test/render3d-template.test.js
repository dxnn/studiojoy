// The 3D library: the studio's façade over three.js. The drawing itself needs
// WebGL, which Node has not got, so what is held here is the shape the
// studio depends on — checked in a browser through the Playwright MCP tools
// when it was built (spec/ §4). The vendored pair is whole: the façade
// imports only three.module.js, which imports only three.core.js, both
// shipped. It sizes the drawing buffer and never the canvas's CSS, which is
// Screens.fit's. It keeps the picture after each frame, or look_at_game
// hands a helper a black square. And it is loaded as the module it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../public/studio-lib/render3d/${rel}`, import.meta.url), 'utf8');
const FACADE = read('render3d.js');
const INDEX = JSON.parse(fs.readFileSync(new URL('../public/studio-lib/index.json', import.meta.url), 'utf8'));
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsOf = (src) => [...src.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

test('the vendored pair is whole: façade to module to core, and nothing else', () => {
  assert.deepEqual(importsOf(FACADE), ['./three.module.js']);
  assert.deepEqual([...new Set(importsOf(read('three.module.js')))], ['./three.core.js']);
  assert.deepEqual(importsOf(read('three.core.js')), []);
  const lib = INDEX.libraries.render3d;
  assert.equal(lib.core, false, 'an extra');
  assert.equal(lib.module, true);
  assert.deepEqual(lib.scripts, ['studio/render3d.js'], 'one tag: the engine comes by import');
  assert.match(read('three-license.txt'), /The MIT License/);
});

test('it sizes the buffer, never the canvas, and keeps each frame for the shot', () => {
  const body = code(FACADE);
  assert.match(body, /preserveDrawingBuffer: true/);
  assert.match(body, /setSize\(w, h, false\)/, 'false: the buffer only');
  assert.doesNotMatch(body, /\.style\./, 'no CSS of its own');
  assert.match(body, /Math\.min\(MAX_RATIO, window\.devicePixelRatio/);
  assert.match(body, /new ResizeObserver\(fitBuffer\)/);
});

test('the note says it is a module, and so is the code that uses it', () => {
  const note = FACADE.split('\n').filter((l) => l.startsWith('//')).join('\n');
  assert.match(note, /<script type="module" src="studio\/render3d\.js">/);
  assert.match(note, /Screens\.fit\(/, 'fit before start');
  // ⚠️ The buffer is the canvas's width and height, which fit reads: a second
  // fit after start would shrink the game to whatever the buffer was.
  assert.match(note, /call fit once, before\n\/\/ start, and never again/);
  for (const call of ['start', 'box', 'ball', 'boxes', 'remove', 'clear', 'follow', 'look', 'draw']) {
    assert.match(note, new RegExp(`\\b${call}\\(`), `the note names ${call}`);
    assert.match(code(FACADE), new RegExp(`\\b${call}: `), `and the façade offers it`);
  }
  assert.match(code(FACADE), /window\.Render3D = Render3D;/);
});
