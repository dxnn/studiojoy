// The control scheme registry: public/templates/index.json, which says what
// New game offers and which config/controls.js each scheme starts from
// (spec.md §4, ideas/control-schemes.md). Against the real public/, because
// the point of these is that the shipped file and the shipped library agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  listSchemes, defaultScheme, schemeSeed, CONTROLS_FILE,
} from '../server/files/schemes.js';
import { parseConfigFile } from '../public/config-file.js';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');
const readJson = (...parts) => JSON.parse(
  fs.readFileSync(path.join(publicDir, ...parts), 'utf8'),
);
const index = readJson('templates', 'index.json');
const libraries = readJson('studio-lib', 'index.json');

// The names input.js will actually draw for. A registry naming a sixth shape
// the library has never heard of is a game with no controls and no error.
const SCHEMES = (() => {
  const input = fs.readFileSync(path.join(publicDir, 'studio-lib/input/input.js'), 'utf8');
  const line = /const SCHEMES = \[(.*?)\];/.exec(input);
  return line[1].split(',').map((s) => s.trim().replace(/"/g, ''));
})();

test('every scheme names a shape input.js knows and a seed that declares it', () => {
  const schemes = listSchemes(publicDir);
  assert.ok(Object.keys(schemes).length > 0, 'the registry was read at all');
  for (const [key, scheme] of Object.entries(schemes)) {
    assert.ok(SCHEMES.includes(key), `${key} is a shape input.js draws`);
    assert.ok(scheme.title, `${key} has words for the dialog`);
    assert.ok(scheme.what, `${key} says what it is`);
    const seed = fs.readFileSync(path.join(publicDir, 'templates', scheme.seed), 'utf8');
    // The seed must declare the scheme it is the seed for, or picking one
    // writes a file claiming to be another.
    const parsed = parseConfigFile(seed);
    assert.equal(parsed.ok, true, `${scheme.seed}: ${parsed.reason}`);
    const declared = parsed.decls.find((d) => d.name === 'SCHEME');
    assert.equal(declared?.node.value, key, `${scheme.seed} declares SCHEME = "${key}"`);
  }
});

// ⚠️ Two files could say what an unchosen game is seeded with: this registry
// and the input library's own seed. The library's is what an install with no
// choice writes, so they must be the same file.
test('the default scheme is the input library seed', () => {
  const fallback = defaultScheme(publicDir);
  assert.equal(fallback, 'none', 'the null controller, which draws nothing');
  assert.deepEqual(
    schemeSeed(publicDir, fallback),
    { [CONTROLS_FILE]: libraries.libraries.input.seeds[0].from },
  );
  assert.equal(libraries.libraries.input.seeds[0].to, CONTROLS_FILE);
});

test('what New game offers resolves to a scheme, family or not', () => {
  const schemes = listSchemes(publicDir);
  assert.ok(index.offer.length > 1, 'there is a choice to make');
  for (const key of index.offer) {
    const family = index.families?.[key];
    if (!family) {
      assert.ok(schemes[key], `${key} is a scheme`);
      continue;
    }
    assert.ok(family.title && family.what, `${key} has its own words`);
    assert.ok(family.of.length > 1, 'a family of one is a scheme');
    for (const manner of family.of) assert.ok(schemes[manner], `${manner} is a scheme`);
    // The family stands for its first manner in the dialog, so that one has
    // to be a shape a game can start as.
    assert.ok(schemes[family.of[0]], 'the family starts as its first manner');
  }
  // Every scheme is reachable: offered on its own, or as a manner of a
  // family. One that is neither is a seed nobody can ever pick.
  const reachable = new Set(index.offer.flatMap((k) => index.families?.[k]?.of ?? [k]));
  assert.deepEqual([...Object.keys(schemes)].sort(), [...reachable].sort());
});

test('a made-up scheme names no path at all', () => {
  assert.deepEqual(schemeSeed(publicDir, 'zorp'), {});
  assert.deepEqual(schemeSeed(publicDir, '../../etc/passwd'), {});
  assert.deepEqual(schemeSeed(publicDir, ''), {});
  // And a public/ without the registry leaves the library's own seed to it.
  assert.deepEqual(schemeSeed(path.join(publicDir, 'nope'), 'none'), {});
  assert.equal(defaultScheme(path.join(publicDir, 'nope')), null);
  assert.deepEqual(listSchemes(path.join(publicDir, 'nope')), {});
});

test('a template that fixes its scheme names a real one', () => {
  const schemes = listSchemes(publicDir);
  const templates = readJson('game-templates', 'index.json').templates;
  for (const [key, t] of Object.entries(templates)) {
    if (t.scheme === undefined) continue;
    assert.ok(schemes[t.scheme], `${key} fixes a scheme that exists`);
  }
  // Both templates that ship are made of buttons, so both fix the null
  // controller: a quiz drawing an analog stick over its answers was the bug
  // that made the picker worth building.
  assert.equal(templates.quiz.scheme, 'none');
  assert.equal(templates['visual-novel'].scheme, 'none');
});
