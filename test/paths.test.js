import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  checkProjectPath,
  resolveInside,
  resolveProjectPath,
  checkSlug,
  slugify,
  MAX_PATH_CHARS,
  MAX_SEGMENTS,
  MAX_SLUG_CHARS,
} from '../server/files/paths.js';

// Codepoints are built from escapes at runtime so this test file contains no
// invisible bytes of its own.
const NUL = String.fromCharCode(0x00);
const US = String.fromCharCode(0x1f);
const DEL = String.fromCharCode(0x7f);
const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const RLO = String.fromCharCode(0x202e);
const SOFT_HYPHEN = String.fromCharCode(0x00ad);

const DENY = [
  ['', 'empty string'],
  ['/etc/passwd', 'absolute path'],
  ['..', 'bare parent'],
  ['.', 'bare dot'],
  ['../secret', 'parent escape'],
  ['a/../../b', 'nested escape'],
  ['./a', 'leading dot segment'],
  ['a/./b', 'inner dot segment'],
  ['a//b', 'empty inner segment'],
  ['a/', 'trailing slash'],
  ['a\\b', 'backslash separator'],
  ['..\\..\\windows', 'windows-style escape'],
  ['.git', 'git directory'],
  ['.git/config', 'git config'],
  ['.GIT/config', 'git directory uppercased'],
  ['.Git/hooks/pre-commit', 'git directory mixed case'],
  ['assets/.git/config', 'nested git directory'],
  [`a${NUL}b`, 'NUL byte'],
  [`a${US}b`, 'C0 control'],
  [`a${DEL}b`, 'DEL'],
  ['a\nb', 'newline'],
  ['a\tb', 'tab'],
  [`.gi${ZWSP}t/config`, 'zero-width spoof of .git'],
  [`${BOM}index.html`, 'byte order mark'],
  [`a${RLO}b.txt`, 'bidi override'],
  [`a${SOFT_HYPHEN}b.txt`, 'soft hyphen'],
  [' lead.txt', 'leading space'],
  ['trail.txt ', 'trailing space'],
  ['a/ b/c.txt', 'leading space in inner segment'],
  ['a/b/c/d/e/f/g/h/i.txt', 'nine segments'],
  ['x'.repeat(MAX_PATH_CHARS + 1), 'over the character cap'],
  [123, 'number'],
  [null, 'null'],
  [undefined, 'undefined'],
  [{}, 'object'],
  [['a'], 'array'],
];

const ALLOW = [
  'index.html',
  'BRIEF.md',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  'js/game.js',
  'assets/sprites/hero.png',
  'a b/c d.txt',
  'weird...name.txt',
  'UPPER.PNG',
  'a/b/c/d/e/f/g/h.txt',
  'x'.repeat(MAX_PATH_CHARS),
];

test('checkProjectPath refuses hostile paths', () => {
  for (const [input, label] of DENY) {
    const res = checkProjectPath(input);
    assert.equal(res.ok, false, `expected refusal for ${label}: ${String(input)}`);
    assert.equal(typeof res.reason, 'string', `${label} must carry a reason`);
    assert.ok(res.reason.length > 0, `${label} reason must be non-empty`);
  }
});

test('checkProjectPath accepts ordinary game files', () => {
  for (const input of ALLOW) {
    const res = checkProjectPath(input);
    assert.equal(res.ok, true, `expected acceptance for ${input}: ${res.reason}`);
    assert.equal(res.path, input);
  }
});

test('exactly MAX_SEGMENTS is allowed, one more is not', () => {
  const ok = Array.from({ length: MAX_SEGMENTS }, (_, i) => `s${i}`).join('/');
  assert.equal(checkProjectPath(ok).ok, true);
  const tooDeep = Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => `s${i}`).join('/');
  assert.equal(checkProjectPath(tooDeep).ok, false);
});

test('.gitignore is allowed but .git never is, in any casing', () => {
  assert.equal(checkProjectPath('.gitignore').ok, true);
  for (const variant of ['.git', '.GIT', '.Git', '.gIt']) {
    assert.equal(
      checkProjectPath(`${variant}/config`).ok, false,
      `${variant} must be refused`,
    );
    assert.equal(checkProjectPath(variant).ok, false, `${variant} must be refused`);
  }
});

// The load-bearing invariant: anything the validator accepts must resolve
// inside the project directory. If these two ever disagree, the validator is
// the bug and this catches it.
test('every accepted path resolves inside the project directory', () => {
  const root = '/srv/games/tank';
  const candidates = [...ALLOW, ...DENY.map(([p]) => p)];
  for (const candidate of candidates) {
    const res = checkProjectPath(candidate);
    if (!res.ok) continue;
    const abs = resolveInside(root, res.path);
    assert.notEqual(abs, null, `${candidate} resolved to null`);
    assert.ok(
      abs.startsWith(root + path.sep),
      `${candidate} escaped to ${abs}`,
    );
  }
});

test('resolveInside independently rejects an escape that skipped validation', () => {
  const root = '/srv/games/tank';
  assert.equal(resolveInside(root, '../other/file'), null);
  assert.equal(resolveInside(root, '../../etc/passwd'), null);
  assert.equal(resolveInside(root, '/etc/passwd'), null);
  assert.equal(resolveInside(root, 'ok.txt'), path.join(root, 'ok.txt'));
});

test('resolveInside is not fooled by a sibling with a shared prefix', () => {
  // /srv/games/tank vs /srv/games/tank-evil — a naive startsWith without the
  // separator would treat the second as inside the first.
  assert.equal(resolveInside('/srv/games/tank', '../tank-evil/x'), null);
});

test('resolveProjectPath throws a 400 rather than returning a reason', () => {
  assert.throws(
    () => resolveProjectPath('/srv/games/tank', '../escape'),
    (err) => err.status === 400 && typeof err.message === 'string',
  );
  const { rel, abs } = resolveProjectPath('/srv/games/tank', 'js/game.js');
  assert.equal(rel, 'js/game.js');
  assert.equal(abs, path.join('/srv/games/tank', 'js/game.js'));
});

test('checkSlug is stricter than checkProjectPath', () => {
  for (const good of ['tank-game', 'a', '0', 'game2', 'x'.repeat(MAX_SLUG_CHARS)]) {
    assert.equal(checkSlug(good).ok, true, `${good} should be a valid slug`);
  }
  const bad = [
    '', 'A', 'Tank', '-lead', '.git', '..', '.', 'a_b', 'a b', 'a/b', 'a.b',
    'x'.repeat(MAX_SLUG_CHARS + 1), 'ünïcode', null, 42,
  ];
  for (const input of bad) {
    assert.equal(checkSlug(input).ok, false, `${String(input)} should be refused`);
  }
});

test('slugify produces valid slugs or nothing', () => {
  const cases = [
    ['Tank Game', 'tank-game'],
    ['  Spaces  ', 'spaces'],
    ['Punctuation!!! Here?', 'punctuation-here'],
    ['ÜberGame', 'ubergame'],
    ['already-fine', 'already-fine'],
    ['2048', '2048'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(slugify(input), expected, `slugify(${input})`);
  }
  // Anything non-empty that comes out must itself be a legal slug.
  for (const input of ['Tank Game', '???', '', 'a'.repeat(80), '---']) {
    const out = slugify(input);
    if (out !== '') assert.equal(checkSlug(out).ok, true, `slugify(${input}) => ${out}`);
  }
});
