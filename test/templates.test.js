// The contract every game template keeps, whatever its genre — held here once
// for every entry in game-templates/index.json, so a new template is tested
// the day it is listed. Each <key>-template.test.js keeps only what is that
// template's alone. What a template promises: it is registered with a heart it
// ships; every script its page loads is one it ships or a library it holds
// installs; each library's own scripts load in the library's order; the game's
// own code comes last; every config file is one the form can read; and every
// achievement it ships is over a moment its code says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseConfigFile } from '../public/config-file.js';

const root = path.resolve(import.meta.dirname, '..', 'public');
const json = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
const { templates } = json('game-templates', 'index.json');
const { libraries } = json('studio-lib', 'index.json');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function tree(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const sub = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? tree(dir, sub) : [sub];
  });
}

for (const [key, t] of Object.entries(templates)) {
  const dir = path.join(root, 'game-templates', key);
  const files = tree(dir);
  const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const held = Object.entries(libraries)
    .filter(([name, l]) => l.core || (t.libraries ?? []).includes(name));
  const installs = new Set(held.flatMap(([, l]) => [
    ...l.files.map((f) => `studio/${f}`), ...(l.seeds ?? []).map((s) => s.to),
  ]));

  test(`${key}: registered, with words for New game and a heart it ships`, () => {
    assert.ok(t.title && t.what, 'title and what');
    assert.ok(files.includes(t.heart), `${t.heart} is in the tree`);
    assert.ok(files.includes('index.html'), 'a page');
    assert.ok(files.includes('BRIEF.md'), 'a brief');
  });

  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

  test(`${key}: every script on the page is shipped or installed`, () => {
    for (const src of scripts) {
      assert.ok(files.includes(src) || installs.has(src), `${src}`);
    }
    // The tag is the page-writer's job, so a library the game holds and never
    // loads is the one thing no install can fix.
    for (const name of t.libraries ?? []) {
      for (const src of libraries[name].scripts ?? []) assert.ok(scripts.includes(src), `${name}: ${src}`);
    }
  });

  test(`${key}: each library's scripts in the library's order, and the game's own last`, () => {
    for (const [name, l] of held) {
      const at = (l.scripts ?? []).map((s) => scripts.indexOf(s)).filter((i) => i >= 0);
      assert.deepEqual(at, [...at].sort((a, b) => a - b), `${name} in order`);
    }
    const last = scripts[scripts.length - 1];
    assert.ok(last && !last.startsWith('studio/') && !last.startsWith('config/'), `${last} is the game's own code`);
    assert.doesNotMatch(html, /id="hud/, 'the HUD is the screens library\'s');
  });

  test(`${key}: every config file is one the form can read`, () => {
    for (const rel of files.filter((f) => f.startsWith('config/') && f.endsWith('.js'))) {
      const parsed = parseConfigFile(read(rel));
      assert.equal(parsed.ok, true, `${rel}: ${parsed.reason}`);
    }
  });

  test(`${key}: every achievement it ships is over a moment its code says`, () => {
    if (!files.includes('config/achievements.js')) return;
    const game = files.filter((f) => f.startsWith('js/') && f.endsWith('.js')).map((f) => code(read(f))).join('\n');
    const said = new Set([...game.matchAll(/Moments\.say\(\s*"([\w-]+)"/g)].map((m) => m[1]));
    for (const [, moment] of code(read('config/achievements.js')).matchAll(/moment: "([\w-]+)"/g)) {
      assert.ok(said.has(moment), `the game says "${moment}"`);
    }
  });
}
