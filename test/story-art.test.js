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
  background: { dir: 'backgrounds', ext: '.png', landscape: true },
  portrait: { dir: 'portraits', ext: '.png', notStrip: true },
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

// Not exact sizes: real art does not arrive at the studio's own 480×270 and
// 128², and the studio scales. What matters is that each one *reads* as its
// kind — which for a portrait is a rule with teeth, below.
test('a picture in the set is the shape its kind is shown at', () => {
  for (const a of index.art.filter((x) => x.kind !== 'sound')) {
    const [width, height] = pngSize(bytes(a.file));
    const { landscape, notStrip } = KINDS[a.kind];
    // A background fills a pane that is wider than it is tall; a portrait
    // one that is not. A portrait taller than wide is normal (a giraffe).
    if (landscape) assert.ok(width > height, `${a.file} is ${width}x${height}, not landscape`);
    // ⚠️ The one with teeth. A portrait is copied into assets/sprites/, and
    // the sprites library reads a picture whose width is a whole multiple of
    // its height as a *strip* of square frames — so a 2:1 portrait would
    // animate instead of standing still, and nothing in the story would say
    // why. Squareness was the old rule and it was too strict: every animal
    // in the set is a little taller or wider than it is square.
    if (notStrip) {
      assert.ok(
        !(width > height && width % height === 0),
        `${a.file} is ${width}x${height}, which the sprites library reads as a strip`,
      );
    }
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

test('every example is a story or an adventure a guide can put in, using art the set lists', () => {
  const listed = new Set(index.art.map((a) => a.file));
  const examples = Object.entries(index.examples ?? {});
  assert.ok(examples.length > 0, 'there is at least one example');
  for (const [key, example] of examples) {
    for (const field of ['title', 'what']) {
      assert.equal(typeof example[field], 'string', `${key}: ${field}`);
    }
    // A story names its story file, an adventure its scenes file: one each.
    const file = example.story ?? example.scenes;
    assert.equal(typeof file, 'string', `${key}: story or scenes`);
    assert.ok(!(example.story && example.scenes), `${key}: one kind, not two`);
    assert.ok(fs.existsSync(new URL(file, DIR)), `${key}: ${file} is on disk`);
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
