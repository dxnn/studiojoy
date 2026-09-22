// Core libraries and extras (spec.md §4): every game holds the core set; an
// extra lands only where a template names it or a person adds it, and the
// sweep raises one a game holds without ever handing it to one that does not.
// Against a small public/ of its own, since the real index has no extra yet —
// the last test holds the real manifests to the same rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { initRepo, commitPaths, logCommits } from '../server/files/git.js';
import { writeFileAt } from '../server/files/tree.js';
import { sweepLibraries } from '../server/files/library.js';
import { setup, signIn, scratchDir } from './helpers.js';

const STUDIO = { name: 'Unbridled Joy', email: 'studio@gamestudio.local' };

function fixture() {
  const dir = scratchDir('public-extras');
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put('studio-lib/index.json', JSON.stringify({
    libraries: {
      tick: { version: 1, core: true, what: 'A core one.', files: ['tick.js'], seeds: [] },
      boom: { version: 2, what: 'An extra.', files: ['boom.js', 'boom-license.txt'], seeds: [] },
    },
  }));
  put('studio-lib/tick/tick.js', '// tick\n');
  put('studio-lib/boom/boom.js', '// boom 2\n');
  put('studio-lib/boom/boom-license.txt', 'MIT\n');
  put('game-templates/index.json', JSON.stringify({
    templates: {
      bang: { title: 'Bang', what: 'x', heart: 'config/bang.js', libraries: ['boom'] },
      plain: { title: 'Plain', what: 'x', heart: 'config/plain.js' },
    },
  }));
  put('game-templates/bang/config/bang.js', 'const BANG = 1;\n');
  put('game-templates/plain/config/plain.js', 'const PLAIN = 1;\n');
  put('index.html', '<!doctype html>\n');
  return dir;
}

const held = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'studio/studio.json'), 'utf8'));

test('the sweep adds a core library and never an extra', async () => {
  const publicDir = fixture();
  const dir = path.join(scratchDir('extras'), 'old');
  await initRepo(dir, { author: STUDIO, slug: 'old' });
  await writeFileAt(path.join(dir, 'index.html'), 'x');
  await commitPaths(dir, ['index.html'], 'as it was', STUDIO);

  const result = await sweepLibraries(dir, publicDir, STUDIO);
  assert.deepEqual(result.added, ['tick']);
  assert.deepEqual(held(dir), { tick: 1 });
  assert.equal(fs.existsSync(path.join(dir, 'studio/boom.js')), false);
});

test('the sweep raises an extra a game already holds', async () => {
  const publicDir = fixture();
  const dir = path.join(scratchDir('extras'), 'holds');
  await initRepo(dir, { author: STUDIO, slug: 'holds' });
  await writeFileAt(path.join(dir, 'studio/studio.json'), JSON.stringify({ tick: 1, boom: 1 }));
  await writeFileAt(path.join(dir, 'studio/boom.js'), '// boom 1\n');
  await commitPaths(dir, ['studio/studio.json', 'studio/boom.js'], 'as it was', STUDIO);

  const result = await sweepLibraries(dir, publicDir, STUDIO);
  assert.deepEqual(result.updated, [{ name: 'boom', from: 1, to: 2 }]);
  assert.equal(fs.readFileSync(path.join(dir, 'studio/boom.js'), 'utf8'), '// boom 2\n');
  assert.ok(fs.existsSync(path.join(dir, 'studio/boom-license.txt')), 'the licence rides along');
});

test("a template's extras land at creation, and nobody else's game gets them", async (t) => {
  const app = await setup({ publicDir: fixture() });
  t.after(() => app.close());
  await signIn(app);

  await app.client.json('POST', '/api/projects', { body: { name: 'Bang', template: 'bang' } });
  assert.deepEqual(held(path.join(app.gamesDir, 'bang')), { tick: 1, boom: 2 });

  await app.client.json('POST', '/api/projects', { body: { name: 'Plain', template: 'plain' } });
  assert.deepEqual(held(path.join(app.gamesDir, 'plain')), { tick: 1 });

  await app.client.json('POST', '/api/projects', { body: { name: 'Empty' } });
  assert.deepEqual(held(path.join(app.gamesDir, 'empty')), { tick: 1 });
});

test('a person adds an extra, once, as one commit', async (t) => {
  const app = await setup({ publicDir: fixture() });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const dir = path.join(app.gamesDir, 'tank');

  const res = await app.client.json('POST', '/api/projects/tank/libraries', { body: { name: 'boom' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.added, ['boom']);
  assert.deepEqual(held(dir), { tick: 1, boom: 2 });
  assert.equal((await logCommits(dir))[0].subject, 'added the boom library');

  const again = await app.client.json('POST', '/api/projects/tank/libraries', { body: { name: 'boom' } });
  assert.equal(again.status, 409);

  // A core library is not an extra, and a name the studio does not offer is
  // nothing to add — the bytes are only ever the studio's own.
  for (const name of ['tick', 'nope', '../tick']) {
    const bad = await app.client.json('POST', '/api/projects/tank/libraries', { body: { name } });
    assert.equal(bad.status, 400, name);
  }
});

// What makes a directory under studio-lib/ a library, for any library the
// studio grows: its files are there, its note-bearing file carries its name
// (buildLibraryNotes finds it by that convention), every script it asks a page
// to load is one it installs, it says how a game uses it, and bytes written
// somewhere else carry their licence beside them — the fonts' precedent, and
// a vendored engine's.
test('every library is whole: files, note, scripts, shape and licences', () => {
  const root = path.resolve(import.meta.dirname, '..', 'public', 'studio-lib');
  const { libraries } = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  for (const [name, l] of Object.entries(libraries)) {
    assert.ok(Number.isInteger(l.version) && l.version >= 1, `${name} version`);
    assert.ok(l.what, `${name} says what it is`);
    for (const file of l.files) {
      assert.ok(fs.existsSync(path.join(root, name, file)), `${name}/${file}`);
    }
    assert.ok(l.files.includes(`${name}.js`), `${name}.js carries the note`);
    const installs = new Set([...l.files.map((f) => `studio/${f}`), ...(l.seeds ?? []).map((s) => s.to)]);
    for (const src of l.scripts ?? []) assert.ok(installs.has(src), `${name} installs ${src}`);
    assert.ok(Array.isArray(l.shape) && l.shape.length > 0, `${name} has a shape`);
    assert.ok(l.shape[0].startsWith('- '), `${name}'s shape is a list item`);
    for (const line of l.shape) {
      assert.ok(line.startsWith('- ') || line.startsWith('  '), `${name}: ${line}`);
    }
    // Not the studio's own bytes: a font, or a minified engine.
    const carried = l.files.filter((f) => /\.(woff2?|ttf|otf)$|\.min\.js$/.test(f));
    if (carried.length > 0) {
      assert.ok(l.files.some((f) => /licen[cs]e/i.test(f)), `${name} carries a licence for ${carried}`);
    }
  }
});

test("every template's extras are libraries the studio offers as extras", () => {
  const publicDir = path.resolve(import.meta.dirname, '..', 'public');
  const read = (...p) => JSON.parse(fs.readFileSync(path.join(publicDir, ...p), 'utf8'));
  const libraries = read('studio-lib', 'index.json').libraries;
  for (const [name, l] of Object.entries(libraries)) {
    assert.equal(typeof l.core, 'boolean', `${name} says whether it is core`);
  }
  for (const [key, t] of Object.entries(read('game-templates', 'index.json').templates)) {
    for (const name of t.libraries ?? []) {
      assert.ok(libraries[name], `${key} names ${name}, which exists`);
      assert.equal(libraries[name].core, false, `${key} names ${name}, which is an extra`);
    }
  }
});
