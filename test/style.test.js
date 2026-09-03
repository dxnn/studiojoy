// The studio's own rules over its own front end, as text: the two that can be
// checked without rendering anything (spec.md §17, CLAUDE.md). The rest of
// them — a row that highlights opens on a click, nothing greyed in a bar, one
// thing open at a time — want a rendered tree, and a render function cannot
// be imported yet because main.js reads `document` at import; that is a TODO
// line, and these two do not have to wait for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');
const read = (rel) => fs.readFileSync(path.join(publicDir, rel), 'utf8');

// Every .js the studio serves itself. Not studio-lib/, which is a game's.
const clientFiles = fs.readdirSync(publicDir)
  .filter((name) => name.endsWith('.js'));

// The stylesheet is one file per surface under public/css/ (index.html says
// which order they load in). Every check below is over all of them at once:
// a property is set in one file and read in another by design.
const styleFiles = fs.readdirSync(path.join(publicDir, 'css'))
  .filter((name) => name.endsWith('.css'))
  .sort();
const allCss = styleFiles.map((name) => read(path.join('css', name))).join('\n');

// The order they are actually loaded in, which is the only thing that makes
// the cascade come out the same as it did in one file.
const linked = [...read('index.html').matchAll(/href="\/css\/([^"]+)"/g)].map((m) => m[1]);

// ⚠️ A `var(--x)` with no fallback and no definition is not a colour that
// falls back: the whole declaration is invalid at computed-value time and the
// property takes its inherited or initial value instead. A background goes
// transparent and nobody sees anything — which is how four rules referencing
// an undefined --primary left two clickable rows with no hover highlight at
// all, unnoticed for weeks, because a missing highlight looks like nothing
// rather than like a mistake.
test('every custom property the stylesheet reads is one somebody sets', () => {
  const css = allCss;
  // A var() with a comma has a fallback and is fine however it is set.
  const read4 = [...css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)].map((m) => m[1]);
  const defined = new Set([...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
  // The ones written as an inline style or through setProperty. Any mention
  // in the client's own source counts, comments included: this is here to
  // catch a name nothing sets anywhere, not to police where it is set.
  const fromJs = new Set(clientFiles.flatMap(
    (name) => [...read(name).matchAll(/(--[a-z0-9-]+)/g)].map((m) => m[1]),
  ));
  const orphans = [...new Set(read4)].filter((n) => !defined.has(n) && !fromJs.has(n));
  assert.deepEqual(orphans, [], 'referenced in the stylesheet and set nowhere');
});

// ⚠️ The one new way to break a stylesheet in pieces: add a piece and forget
// to link it. It is served, it parses, nothing errors — the rules simply never
// arrive, and what they styled comes out unstyled. Both directions are wrong,
// so both are checked: a file nobody links, and a link to no file.
test('every css file is linked, and every link is a file', () => {
  assert.deepEqual([...linked].sort(), styleFiles, 'public/css/ against index.html');
});

// base.css sets the custom properties the others read and narrow.css overrides
// rules of its own specificity, so those two positions are load-bearing; the
// rest of the order is for reading.
test('base.css loads first and narrow.css last', () => {
  assert.equal(linked[0], 'base.css');
  assert.equal(linked.at(-1), 'narrow.css');
});

// `send()` is the one place that names fetch, so a request that never reached
// the studio can set the not-connected state from one place (spec.md §17).
test('nothing in the client calls fetch but send()', () => {
  const callers = clientFiles.filter((name) => /\bfetch\(/.test(read(name)));
  assert.deepEqual(callers, ['main.js'], 'only the file send() lives in');
  const calls = [...read('main.js').matchAll(/\bfetch\(/g)];
  assert.equal(calls.length, 1, 'and once, inside send()');
});
