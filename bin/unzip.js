// Reading a .zip, because `npm run pullart` downloads asset packs and this
// studio has no dependencies. Only the half a pack needs: walk the central
// directory, hand back one entry's bytes. No writing, no zip64, no
// encryption, no spanning — a pack that needs any of those says so and stops.
//
// Build-time only. Nothing on a request path reads a zip, so this lives in
// bin/ rather than server/, and the bytes it parses came from a host the
// pull script names rather than from anybody using the studio.
import zlib from 'node:zlib';

const EOCD = 0x06054b50; // end of central directory
const ENTRY = 0x02014b50; // one central directory entry
const LOCAL = 0x04034b50; // the header in front of the bytes themselves

// The end-of-directory record is last, but a zip may carry a comment after
// it, so it is found by scanning backwards for the signature. The comment is
// 16 bits long at most, which is how far back this ever has to look.
function endRecord(buf) {
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= earliest; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error('not a zip (no end-of-directory record)');
}

// Every entry the directory lists: name, where its bytes are, and how they
// were packed. Sizes come from here rather than from the local header, which
// is allowed to carry zeros and defer to a trailing data descriptor.
export function entries(buf) {
  const end = endRecord(buf);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('zip64 is not read here');

  const found = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== ENTRY) throw new Error(`directory entry ${i} is malformed`);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    found.push({
      name: buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'),
      method: buf.readUInt16LE(at + 10),
      packed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return found;
}

// One entry's bytes. The local header repeats the name and may carry a
// different amount of extra, so its two length fields are read again here
// rather than assumed to match the directory's.
export function read(buf, entry) {
  if (buf.readUInt32LE(entry.offset) !== LOCAL) throw new Error(`${entry.name}: no local header`);
  const start = entry.offset + 30
    + buf.readUInt16LE(entry.offset + 26)
    + buf.readUInt16LE(entry.offset + 28);
  const packed = buf.subarray(start, start + entry.packed);
  if (entry.method === 0) return Buffer.from(packed);
  if (entry.method === 8) return zlib.inflateRawSync(packed);
  throw new Error(`${entry.name}: compression method ${entry.method} is not read here`);
}
