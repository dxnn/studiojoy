// The standard set: pictures and sounds an author can put into a visual novel
// without drawing (spec.md §6). Nothing here runs any code — the set is data
// and files on disk — but it is data the guide's shelf and the example both
// read at face value, so this is what stops a growing set from shipping an
// entry that names a file nobody added, a kind nothing offers, or a portrait
// that is not square.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = new URL('../public/story-art/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', DIR), 'utf8'));

const bytes = (file) => fs.readFileSync(new URL(file, DIR));

// Where each kind lands in a game, and the folder it is kept in here. The
// guide's `landing` does the same walk from the other end, so a set that puts
// a portrait under backgrounds/ would file it in assets/images/ and the story
// would never find it.
const KINDS = {
  background: { dir: 'backgrounds', ext: '.png', size: [480, 270] },
  portrait: { dir: 'portraits', ext: '.png', square: true },
  sound: { dir: 'sounds', ext: '.wav' },
};

// A PNG says its size in the IHDR chunk, which is always the first one: an
// 8-byte signature, 4 of length, 4 of type, then width and height. Enough to
// check a shape without decoding anything.
function pngSize(buf) {
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'not a PNG',
  );
  assert.equal(buf.subarray(12, 16).toString('latin1'), 'IHDR');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('every entry in the set names a file that is there, of a kind something offers', () => {
  assert.ok(Array.isArray(index.art) && index.art.length > 0, 'the set has art in it');
  const seen = new Set();
  for (const a of index.art) {
    // The licence and who made it are not decoration: the set is other
    // people's work and the studio copies it into games people publish.
    for (const key of ['file', 'kind', 'name', 'by', 'licence']) {
      assert.equal(typeof a[key], 'string', `${a.file}: ${key} is a string`);
      assert.ok(a[key].length > 0, `${a.file}: ${key} is not empty`);
    }
    assert.ok(KINDS[a.kind], `${a.file}: ${a.kind} is a kind the studio knows`);
    assert.ok(!seen.has(a.file), `${a.file} is listed once`);
    seen.add(a.file);

    const { dir, ext } = KINDS[a.kind];
    assert.equal(path.dirname(a.file), dir, `${a.file} is under ${dir}/`);
    assert.equal(path.extname(a.file), ext, `${a.file} is a ${ext}`);
    // ⚠️ A path is a path: these are joined onto a URL and onto a project
    // path, and one of them walking upwards would be the set reaching out of
    // its own folder.
    assert.ok(/^[a-z0-9]+\/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/.test(a.file), `${a.file} is a plain name`);
    assert.ok(fs.existsSync(new URL(a.file, DIR)), `${a.file} is on disk`);
    assert.ok(bytes(a.file).length > 0, `${a.file} is not empty`);
  }
});

test('a picture in the set is the shape its kind is drawn at', () => {
  for (const a of index.art.filter((x) => x.kind !== 'sound')) {
    const [width, height] = pngSize(bytes(a.file));
    const { size, square } = KINDS[a.kind];
    if (size) assert.deepEqual([width, height], size, `${a.file} is ${size.join('x')}`);
    // A portrait is drawn at 128 square and shown square everywhere. It need
    // not be exactly 128 — the studio scales — but a wide one would either
    // squash or read as a strip to the sprites library.
    if (square) assert.equal(width, height, `${a.file} is square`);
  }
});

test('a portrait says who it is and what mood, and nothing else does', () => {
  for (const a of index.art) {
    if (a.kind === 'portrait') {
      // The example story finds its faces by these, so a portrait without
      // them can be picked from the shelf but never used by an example.
      assert.equal(typeof a.who, 'string', `${a.file}: who`);
      assert.equal(typeof a.mood, 'string', `${a.file}: mood`);
      assert.equal(a.file, `portraits/${a.who}-${a.mood}.png`, `${a.file} is named for its who and mood`);
    } else {
      assert.equal(a.who, undefined, `${a.file}: only a portrait has a who`);
      assert.equal(a.mood, undefined, `${a.file}: only a portrait has a mood`);
    }
  }
});

test('every example is a story the guide can put in, using art the set lists', () => {
  const listed = new Set(index.art.map((a) => a.file));
  const examples = Object.entries(index.examples ?? {});
  assert.ok(examples.length > 0, 'there is at least one example');
  for (const [key, example] of examples) {
    for (const field of ['title', 'what', 'story']) {
      assert.equal(typeof example[field], 'string', `${key}: ${field}`);
    }
    assert.ok(fs.existsSync(new URL(example.story, DIR)), `${key}: ${example.story} is on disk`);
    assert.ok(Array.isArray(example.uses) && example.uses.length > 0, `${key}: uses art`);
    for (const file of example.uses) {
      // Listed as well as present: the guide copies an example's files by
      // name, but the shelf only ever offers what `art` names — art an
      // example uses and the set does not list could never be picked again
      // once it had been deleted from a game.
      assert.ok(listed.has(file), `${key}: ${file} is listed in the set`);
    }
  }
});
