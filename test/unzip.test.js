// Reading a .zip (bin/unzip.js), which is what `npm run pullart` does to an
// asset pack. Only the parser is tested — nothing here reaches the network.
//
// The fixtures are built here rather than committed, so what the parser reads
// is a zip this file wrote byte by byte: a committed one would hide a wrong
// offset behind whatever a real zipper happened to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { entries, read } from '../bin/unzip.js';

// A zip of one file each, in the two forms a pack uses: stored (method 0) and
// deflated (method 8). Written the long way — local header, then the central
// directory, then the end record — because that is exactly what the parser
// walks backwards through.
function zipOf(files) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const { name, body, method } of files) {
    const raw = Buffer.from(body);
    const packed = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(at, 42);
    central.push(entry, nameBytes);

    at += local.length + nameBytes.length + packed.length;
  }

  const body = Buffer.concat(locals);
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dir, end]);
}

const PACK = [
  { name: 'PNG/fish.png', body: 'a fish, deflated'.repeat(20), method: 8 },
  { name: 'License.txt', body: 'CC0', method: 0 },
];

test('every entry the directory lists comes back, in order', () => {
  const found = entries(zipOf(PACK));
  assert.deepEqual(found.map((e) => e.name), ['PNG/fish.png', 'License.txt']);
  assert.equal(found[0].method, 8);
  assert.equal(found[1].method, 0);
});

test('a deflated entry and a stored one both read back whole', () => {
  const zip = zipOf(PACK);
  for (const [i, expected] of PACK.entries()) {
    assert.equal(read(zip, entries(zip)[i]).toString(), expected.body);
  }
});

// A pack may carry a comment after its end record, so the parser scans
// backwards for the signature rather than assuming the last 22 bytes.
test('a zip with a comment after its end record still reads', () => {
  const zip = Buffer.concat([zipOf(PACK), Buffer.from('made by somebody')]);
  // ⚠️ The end record's own comment-length field is left at zero here on
  // purpose: a zipper that writes a trailing comment and forgets to say so is
  // the case the backwards scan exists for.
  assert.equal(entries(zip).length, 2);
});

test('something that is not a zip says so rather than reading rubbish', () => {
  assert.throws(() => entries(Buffer.alloc(200)), /not a zip/);
});

test('a compression method nobody here reads is named, not guessed at', () => {
  const zip = zipOf([{ name: 'odd.png', body: 'x', method: 0 }]);
  // 14 is LZMA: a real method, and one this parser does not have.
  const entry = { ...entries(zip)[0], method: 14 };
  assert.throws(() => read(zip, entry), /method 14/);
});
