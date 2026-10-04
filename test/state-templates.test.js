// Every template keeps its run in State (studio/state.js) — so the preview
// player can pin any of them and put it back — and none takes a way in from
// its own address, so a player cannot skip ahead with ?scene= or ?level=. The
// studio's "Try this scene" and "Try it" go through State instead (spec/ §6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../public/game-templates/', import.meta.url);
const { templates } = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));

const gameCode = (key) => {
  const js = new URL(`${key}/js/`, dir);
  return fs.readdirSync(js).map((f) => fs.readFileSync(new URL(f, js), 'utf8')).join('\n')
    .replace(/^\s*\/\/.*$/gm, '');
};

test('every template keeps its run in State and says what a loaded moment means', () => {
  for (const key of Object.keys(templates)) {
    const code = gameCode(key);
    assert.match(code, /State\.reset\(/, `${key} starts its run with State.reset`);
    assert.match(code, /State\.loaded\(/, `${key} shows a moment put back`);
  }
});

test('no template takes a way in from its own address', () => {
  for (const key of Object.keys(templates)) {
    assert.doesNotMatch(gameCode(key), /location\.search|URLSearchParams/, key);
  }
});
