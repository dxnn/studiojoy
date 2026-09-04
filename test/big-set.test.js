// The big set: CC0 art mirrored into the repository by `npm run pullart`
// (spec.md §4). Nothing here runs any code — it is files on disk and an index
// the shelf reads at face value — but it is written by a script against six
// hosts nobody here controls, so this is what stops a bad pull from being
// committed: a file that is not there, a picture no game could draw, a name
// nobody could search for, or a licence that is not CC0.
//
// The pull itself is not run here. `npm test` has no network by design; this
// checks what the pull left behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DIR = new URL('../public/big-set/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', DIR), 'utf8'));

const bytes = (file) => fs.readFileSync(new URL(file, DIR));

// The same eight bytes the standard set's test reads, for the same reason:
// enough to check a shape without decoding anything.
function pngSize(buf) {
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'not a PNG',
  );
  assert.equal(buf.subarray(12, 16).toString('latin1'), 'IHDR');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// Mirrors MAX_SIDE and MAX_BYTES in bin/pullart.js. Checked again here
// because the pull is the thing that could be wrong.
const MAX_SIDE = 512;
const MAX_BYTES = 128 * 1024;

test('the set is a set: every entry names a file that is there', () => {
  assert.ok(Array.isArray(index.art) && index.art.length > 0, 'the big set has art in it');
  const seen = new Set();
  for (const a of index.art) {
    for (const key of ['file', 'kind', 'name', 'tags', 'by', 'licence']) {
      assert.equal(typeof a[key], 'string', `${a.file}: ${key} is a string`);
      assert.ok(a[key].length > 0, `${a.file}: ${key} is not empty`);
    }
    // One kind, for now: a thing on a transparent background, landing in
    // assets/sprites/. A background or a portrait belongs in the hand-picked
    // standard set, where somebody chose it.
    assert.equal(a.kind, 'sprite', `${a.file} is a sprite`);
    assert.ok(!seen.has(a.file), `${a.file} is listed once`);
    seen.add(a.file);

    // ⚠️ A path is a path: these are joined onto a URL and onto a project
    // path, and one walking upwards would be the set reaching out of its own
    // folder. The same rule the standard set is held to.
    assert.ok(/^pictures\/[a-z0-9][a-z0-9-]*\.png$/.test(a.file), `${a.file} is a plain name`);
    assert.ok(fs.existsSync(new URL(a.file, DIR)), `${a.file} is on disk`);
  }
});

test('every picture is one a game could draw', () => {
  for (const a of index.art) {
    const buf = bytes(a.file);
    assert.ok(buf.length > 0, `${a.file} is not empty`);
    assert.ok(buf.length <= MAX_BYTES, `${a.file} is ${buf.length} bytes, over the cap`);
    const [width, height] = pngSize(buf);
    assert.ok(
      Math.max(width, height) <= MAX_SIDE,
      `${a.file} is ${width}x${height}, bigger than the set holds`,
    );
    // ⚠️ The rule with teeth, and the third copy of it. A sprite is copied
    // into assets/sprites/, where the sprites library reads a picture whose
    // width is a whole multiple of its height as a *strip* of square frames —
    // so a 2:1 fish would animate instead of sitting still.
    assert.ok(
      !(width > height && width % height === 0),
      `${a.file} is ${width}x${height}, which the sprites library reads as a strip`,
    );
  }
});

// The whole point of the set is that a kid types a word and gets a picture,
// so a picture with no word is not in it. `characterBlue (13)` is the shape
// this catches: one of a run of numbered variants that would bury everything
// else in a filter.
test('every picture has a word somebody could search for', () => {
  for (const a of index.art) {
    assert.ok(
      !/^[a-z]+[^a-z0-9]*\d+[^a-z0-9]*$/i.test(a.name),
      `${a.file} is called "${a.name}", which is a word and a number`,
    );
  }
});

// ⚠️ The set is copied into games people publish. CC0 is the only licence
// that needs nothing of them, and the pull drops everything else — PhyloPic
// is mostly CC BY, so this is the assertion that catches a pull that stopped
// checking.
test('everything is CC0 and says who made it', () => {
  for (const a of index.art) {
    assert.equal(a.licence, 'CC0', `${a.file} is CC0`);
  }
  const licences = fs.readFileSync(new URL('licences.txt', DIR), 'utf8');
  for (const who of new Set(index.art.map((a) => a.by))) {
    assert.ok(licences.includes(who), `licences.txt credits ${who}`);
  }
});

// A picture on disk that the index does not list is one the shelf can never
// offer and nothing will ever delete: the pull writes the folder whole, so
// the two are meant to match exactly.
test('nothing is on disk that the index does not name', () => {
  const listed = new Set(index.art.map((a) => a.file));
  for (const name of fs.readdirSync(new URL('pictures/', DIR))) {
    assert.ok(listed.has(`pictures/${name}`), `pictures/${name} is listed in the index`);
  }
});
