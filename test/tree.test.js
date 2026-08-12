import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  listTree, etagFor, readFileAt, writeFileAt, removeFileAt, assertCapacity,
  MAX_FILE_BYTES, MAX_PROJECT_FILES,
} from '../server/files/tree.js';
import { scratchDir } from './helpers.js';

const write = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

test('listTree walks recursively, sorted, with sizes and mime', async () => {
  const dir = scratchDir('tree-list');
  write(dir, 'index.html', '<h1>Tank</h1>');
  write(dir, 'js/game.js', 'let a = 1;');
  write(dir, 'assets/sprites/hero.png', Buffer.from([0x89, 0x50]));

  const { files, totalBytes, count } = await listTree(dir);
  assert.deepEqual(files.map((f) => f.path), [
    'assets/sprites/hero.png', 'index.html', 'js/game.js',
  ]);
  assert.equal(count, 3);
  assert.equal(totalBytes, 13 + 10 + 2);

  const html = files.find((f) => f.path === 'index.html');
  assert.equal(html.size, 13);
  assert.equal(html.mime, 'text/html; charset=utf-8');
  assert.equal(html.text, true);
  assert.ok(!Number.isNaN(Date.parse(html.modified_at)));

  const png = files.find((f) => f.path === 'assets/sprites/hero.png');
  assert.equal(png.mime, 'image/png');
  assert.equal(png.text, false);
});

test('listTree never reports the repository metadata', async () => {
  const dir = scratchDir('tree-skip-git');
  write(dir, '.git/config', '[core]');
  write(dir, '.git/objects/ab/cdef', 'blob');
  write(dir, '.gitignore', '*.log');
  write(dir, 'index.html', 'x');

  const { files } = await listTree(dir);
  assert.deepEqual(files.map((f) => f.path), ['.gitignore', 'index.html']);
  assert.ok(!files.some((f) => f.path.includes('.git/')));
});

test('listTree flags a file the validator would refuse', async () => {
  const dir = scratchDir('tree-unreachable');
  write(dir, 'ok.txt', 'a');
  // A trailing space in the segment: legal on disk, refused by the validator,
  // so the UI should show it and no tool should be able to touch it.
  fs.writeFileSync(path.join(dir, 'bad.txt '), 'b');

  const { files } = await listTree(dir);
  const bad = files.find((f) => f.path === 'bad.txt ');
  const ok = files.find((f) => f.path === 'ok.txt');
  assert.equal(bad.unreachable, true);
  assert.equal(ok.unreachable, undefined);
});

test('listTree does not follow symlinks', async () => {
  const dir = scratchDir('tree-symlink');
  write(dir, 'real.txt', 'contents');
  fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
  const outside = scratchDir('tree-symlink-target');
  write(outside, 'secret.txt', 'secret');
  fs.symlinkSync(outside, path.join(dir, 'escape'));

  const { files } = await listTree(dir);
  assert.deepEqual(files.map((f) => f.path), ['real.txt']);
});

test('listTree is empty rather than throwing for a missing directory', async () => {
  const { files, count, totalBytes } = await listTree(
    path.join(scratchDir('tree-missing'), 'nope'),
  );
  assert.deepEqual(files, []);
  assert.equal(count, 0);
  assert.equal(totalBytes, 0);
});

test('etagFor is stable for equal bytes and differs otherwise', () => {
  assert.equal(etagFor(Buffer.from('abc')), etagFor(Buffer.from('abc')));
  assert.notEqual(etagFor(Buffer.from('abc')), etagFor(Buffer.from('abd')));
  assert.match(etagFor(Buffer.from('abc')), /^"[0-9a-f]{64}"$/);
});

test('readFileAt returns bytes, or null for anything that is not a file', async () => {
  const dir = scratchDir('tree-read');
  write(dir, 'a.txt', 'hello');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.symlinkSync(path.join(dir, 'a.txt'), path.join(dir, 'link.txt'));

  assert.equal((await readFileAt(path.join(dir, 'a.txt'))).toString('utf8'), 'hello');
  assert.equal(await readFileAt(path.join(dir, 'missing.txt')), null);
  assert.equal(await readFileAt(path.join(dir, 'sub')), null);
  assert.equal(await readFileAt(path.join(dir, 'link.txt')), null);
});

test('writeFileAt creates missing parent directories', async () => {
  const dir = scratchDir('tree-write');
  await writeFileAt(path.join(dir, 'a/b/c/deep.txt'), Buffer.from('deep'));
  assert.equal(fs.readFileSync(path.join(dir, 'a/b/c/deep.txt'), 'utf8'), 'deep');
});

test('removeFileAt prunes the directories it empties, stopping at the root', async () => {
  const dir = scratchDir('tree-remove');
  write(dir, 'assets/sprites/hero.png', 'x');
  write(dir, 'assets/keep.txt', 'y');

  await removeFileAt(dir, 'assets/sprites/hero.png');
  assert.equal(fs.existsSync(path.join(dir, 'assets/sprites')), false, 'emptied dir pruned');
  assert.equal(fs.existsSync(path.join(dir, 'assets')), true, 'non-empty dir kept');

  await removeFileAt(dir, 'assets/keep.txt');
  assert.equal(fs.existsSync(path.join(dir, 'assets')), false);
  assert.equal(fs.existsSync(dir), true, 'the project root itself survives');
});

test('removeFileAt refuses a path outside the project', async () => {
  const dir = scratchDir('tree-remove-escape');
  await assert.rejects(
    () => removeFileAt(dir, '../escape.txt'),
    (err) => err.status === 400,
  );
});

test('removeFileAt is a no-op for a file that is already gone', async () => {
  const dir = scratchDir('tree-remove-missing');
  await removeFileAt(dir, 'never-existed.txt');
});

test('assertCapacity refuses an oversized single file', async () => {
  const dir = scratchDir('cap-file');
  await assert.rejects(
    () => assertCapacity(dir, { addingBytes: MAX_FILE_BYTES + 1, isNewFile: true }),
    (err) => err.status === 413,
  );
  // At the limit exactly is fine.
  await assertCapacity(dir, { addingBytes: MAX_FILE_BYTES, isNewFile: true });
});

test('assertCapacity refuses a new file past the project file count', async () => {
  const dir = scratchDir('cap-count');
  for (let i = 0; i < MAX_PROJECT_FILES; i += 1) write(dir, `f${i}.txt`, 'x');

  await assert.rejects(
    () => assertCapacity(dir, { addingBytes: 1, isNewFile: true }),
    (err) => err.status === 409,
  );
  // Overwriting an existing file does not add to the count, so it passes.
  await assertCapacity(dir, { addingBytes: 1, isNewFile: false });
});
