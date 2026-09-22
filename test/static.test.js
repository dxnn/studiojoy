import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  mimeForPath, isTextPath, serveFile, OCTET_STREAM,
} from '../server/http/static.js';
import { createRouter } from '../server/http/router.js';
import { withServer, scratchDir } from './helpers.js';

test('mime comes from the extension, case-insensitively', () => {
  assert.equal(mimeForPath('game.html'), 'text/html; charset=utf-8');
  assert.equal(mimeForPath('GAME.HTML'), 'text/html; charset=utf-8');
  assert.equal(mimeForPath('a/b/sprite.PNG'), 'image/png');
  assert.equal(mimeForPath('mod.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(mimeForPath('assets/models/ship.GLB'), 'model/gltf-binary');
  assert.equal(mimeForPath('assets/models/ship.gltf'), 'model/gltf+json');
  assert.equal(mimeForPath('save.dat'), null);
  assert.equal(mimeForPath('noextension'), null);
});

test('isTextPath tracks what an agent can read as text', () => {
  for (const p of ['a.html', 'a.css', 'a.js', 'a.json', 'a.md', 'a.txt', 'a.csv', 'a.svg']) {
    assert.equal(isTextPath(p), true, p);
  }
  for (const p of ['a.png', 'a.mp3', 'a.woff2', 'a.dat', 'noext']) {
    assert.equal(isTextPath(p), false, p);
  }
});

function fileServer(root) {
  const r = createRouter();
  r.get('/*path', async (ctx) => {
    await serveFile(ctx.req, ctx.res, path.join(root, ctx.params.path));
  });
  return (req, res) => r.handle(req, res);
}

test('serveFile sends bytes, type, and length', async () => {
  const dir = scratchDir('static-ok');
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>Hi</h1>');
  await withServer(fileServer(dir), async (base) => {
    const res = await fetch(`${base}/index.html`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('content-length'), '11');
    assert.equal(await res.text(), '<h1>Hi</h1>');
  });
});

test('serveFile answers HEAD with headers and no body', async () => {
  const dir = scratchDir('static-head');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'abcdef');
  await withServer(fileServer(dir), async (base) => {
    const res = await fetch(`${base}/a.txt`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '6');
    assert.equal(await res.text(), '');
  });
});

test('an unknown extension downloads instead of rendering', async () => {
  const dir = scratchDir('static-unknown');
  fs.writeFileSync(path.join(dir, 'save.dat'), 'binary-ish');
  await withServer(fileServer(dir), async (base) => {
    const res = await fetch(`${base}/save.dat`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), OCTET_STREAM);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="save\.dat"$/);
  });
});

test('a missing file is 404', async () => {
  const dir = scratchDir('static-missing');
  await withServer(fileServer(dir), async (base) => {
    assert.equal((await fetch(`${base}/nope.txt`)).status, 404);
  });
});

test('a directory is 404, not a listing', async () => {
  const dir = scratchDir('static-dir');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'a.txt'), 'x');
  await withServer(fileServer(dir), async (base) => {
    assert.equal((await fetch(`${base}/assets`)).status, 404);
    assert.equal((await fetch(`${base}/assets/`)).status, 404);
  });
});

// The app never creates a symlink, so one present in a working tree was put
// there by hand and could point anywhere. lstat refuses to follow it.
test('a symlink is 404 even when its target is readable', async () => {
  const dir = scratchDir('static-symlink');
  const secret = path.join(dir, 'real.txt');
  fs.writeFileSync(secret, 'target contents');
  fs.symlinkSync(secret, path.join(dir, 'link.txt'));
  await withServer(fileServer(dir), async (base) => {
    assert.equal((await fetch(`${base}/real.txt`)).status, 200);
    const res = await fetch(`${base}/link.txt`);
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes('target contents'));
  });
});

test('a filename with a quote cannot break out of the disposition header', async () => {
  const dir = scratchDir('static-quote');
  const nasty = 'we"ird.dat';
  fs.writeFileSync(path.join(dir, nasty), 'x');
  await withServer(fileServer(dir), async (base) => {
    const res = await fetch(`${base}/${encodeURIComponent(nasty)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="weird.dat"');
  });
});
