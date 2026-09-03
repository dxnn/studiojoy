import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn, startGames } from './helpers.js';

// A studio plus its public listener, sharing one db and games directory.
async function bothOrigins(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const games = await startGames(app);
  t.after(() => games.close());
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return { app, games, dir: path.join(app.gamesDir, 'tank') };
}

const put = (app, p, body) =>
  app.client.json('PUT', `/api/projects/tank/files/${p}`, { rawBody: body });

test('a game is playable without any credentials', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', '<h1>Tank</h1>');

  for (const url of ['/tank', '/tank/', '/tank/index.html']) {
    const res = await games.client.request('GET', url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(await res.text(), '<h1>Tank</h1>');
  }
});

test('nested game assets are served with their own content types', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'js/game.js', 'console.log(1)');
  await put(app, 'css/style.css', 'body{}');
  await put(app, 'assets/sprite.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const js = await games.client.request('GET', '/tank/js/game.js');
  assert.match(js.headers.get('content-type'), /text\/javascript/);
  assert.equal(await js.text(), 'console.log(1)');

  const png = await games.client.request('GET', '/tank/assets/sprite.png');
  assert.equal(png.headers.get('content-type'), 'image/png');
  await png.arrayBuffer();
});

// ⚠️ The load-bearing property. A game's JavaScript must not be able to
// reach the studio API, and this listener is what guarantees it.
test('the games origin has no api surface at all', async (t) => {
  const { games } = await bothOrigins(t);
  const paths = [
    '/api/projects', '/api/me', '/api/agents', '/api/stream',
    '/api/projects/tank', '/api/projects/tank/files',
  ];
  for (const p of paths) {
    const res = await games.client.request('GET', p);
    assert.equal(res.status, 404, `GET ${p}`);
    const body = await res.text();
    assert.ok(!body.includes('display_name'), `${p} leaked studio data`);
  }
});

test('the games origin never issues or honours a session cookie', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', 'game');

  // Replay the studio's own session cookie at the games origin. It must
  // neither be honoured nor echoed back.
  const withStudioCookie = games.client;
  withStudioCookie.use(app.client.peek());
  const res = await withStudioCookie.request('GET', '/tank/index.html');
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers.getSetCookie(), []);
  await res.text();

  // And it still cannot reach anything but static files.
  const api = await withStudioCookie.request('GET', '/api/me');
  assert.equal(api.status, 404);
  await api.text();
});

test('the games origin is framable and the studio is not', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', 'game');

  const game = await games.client.request('GET', '/tank/index.html');
  assert.equal(game.headers.get('x-frame-options'), null, 'the preview iframe needs this');
  assert.equal(game.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(game.headers.get('referrer-policy'), 'no-referrer');
  await game.text();

  const studio = await app.client.request('GET', '/');
  assert.equal(studio.headers.get('x-frame-options'), 'DENY');
  await studio.text();
});

test('game responses are never cached', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', 'first');
  const before = await games.client.request('GET', '/tank/index.html');
  assert.equal(before.headers.get('cache-control'), 'no-store');
  assert.equal(await before.text(), 'first');

  await put(app, 'index.html', 'second');
  const after = await games.client.request('GET', '/tank/index.html');
  assert.equal(await after.text(), 'second');
});

// ⚠️ Path traversal, from the side of the boundary that is exposed to
// everybody rather than to signed-in accounts.
test('the games origin refuses every traversal attempt', async (t) => {
  const { app, games, dir } = await bothOrigins(t);
  await put(app, 'index.html', 'game');
  // Something worth stealing, one level up from the project directory.
  fs.writeFileSync(path.join(app.gamesDir, 'secret.txt'), 'SECRET');

  const hostile = [
    '/tank/..%2Fsecret.txt',
    '/tank/..%2F..%2Fetc%2Fpasswd',
    '/tank/%2E%2E%2Fsecret.txt',
    '/tank/.git%2Fconfig',
    '/tank/.GIT%2Fconfig',
    '/tank/assets%2F..%2F..%2Fsecret.txt',
    '/tank/subdir%2F..%2F..%2Fsecret.txt',
  ];
  for (const url of hostile) {
    const res = await games.client.request('GET', url);
    assert.equal(res.status, 404, url);
    const body = await res.text();
    assert.ok(!body.includes('SECRET'), `${url} leaked the sibling file`);
    assert.ok(!body.includes('repositoryformatversion'), `${url} leaked git config`);
  }
  // The repository is present but unreachable.
  assert.equal(fs.existsSync(path.join(dir, '.git', 'config')), true);
});

test('a directory and a missing file are 404', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'js/game.js', 'x');

  for (const url of ['/tank/js', '/tank/js/', '/tank/nope.html', '/tank/js/nope.js']) {
    const res = await games.client.request('GET', url);
    assert.equal(res.status, 404, url);
    await res.text();
  }
});

test('the catalog lists published games and nothing else', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', '<h1>tank</h1>');

  const empty = await games.client.request('GET', '/');
  assert.equal(empty.status, 200, 'the root is a page, not an error');
  assert.match(await empty.text(), /No games yet/);

  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });
  const listed = await games.client.request('GET', '/');
  const html = await listed.text();
  assert.match(html, /href="\/tank\/"/);

  // Unpublishing takes it back out; the game itself stays playable.
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: false } });
  const gone = await games.client.request('GET', '/');
  assert.doesNotMatch(await gone.text(), /href="\/tank\/"/);
  const play = await games.client.request('GET', '/tank/');
  assert.equal(play.status, 200, 'unlisted is not unreachable');
  await play.text();
});

test('a published game wears hero.png on its catalog card', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', '<h1>tank</h1>');
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });

  // No hero.png, no dressing — the card is the plain one.
  const plain = await games.client.request('GET', '/');
  assert.doesNotMatch(await plain.text(), /hero\.png/);

  await put(app, 'hero.png', 'not really a png');
  const dressed = await games.client.request('GET', '/');
  const html = await dressed.text();
  assert.match(html, /class="hero"/);
  assert.match(html, /--hero:url\('\/tank\/hero\.png'\)/);
});

test('a game name cannot inject markup into the catalog', async (t) => {
  const { app, games } = await bothOrigins(t);
  await app.client.json('PATCH', '/api/projects/tank', {
    body: { name: '<script>alert(1)</script>' },
  });
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });

  const res = await games.client.request('GET', '/');
  const html = await res.text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('an unknown project is 404 even when a directory exists', async (t) => {
  const { app, games } = await bothOrigins(t);
  // A stray directory with no project row must not become public.
  const stray = path.join(app.gamesDir, 'stray');
  fs.mkdirSync(stray, { recursive: true });
  fs.writeFileSync(path.join(stray, 'index.html'), 'not yours');

  const res = await games.client.request('GET', '/stray/index.html');
  assert.equal(res.status, 404);
  assert.ok(!(await res.text()).includes('not yours'));

  for (const slug of ['UPPER', 'has%20space', 'nope']) {
    const bad = await games.client.request('GET', `/${slug}/index.html`);
    assert.equal(bad.status, 404, slug);
    await bad.text();
  }
});

test('an archived project stays playable', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', 'still fun');
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  const res = await games.client.request('GET', '/tank/');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'still fun');
});

test('only GET and HEAD are allowed', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', 'game');

  const head = await games.client.request('HEAD', '/tank/index.html');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '4');
  assert.equal(await head.text(), '');

  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await games.client.request(method, '/tank/index.html', {
      rawBody: method === 'DELETE' ? undefined : 'x',
    });
    assert.equal(res.status, 405, method);
    assert.match(res.headers.get('allow'), /GET/);
    await res.text();
  }
});

test('a symlink planted in a working tree is not followed', async (t) => {
  const { app, games, dir } = await bothOrigins(t);
  await put(app, 'index.html', 'game');
  fs.writeFileSync(path.join(app.gamesDir, 'secret.txt'), 'SECRET');
  fs.symlinkSync(path.join(app.gamesDir, 'secret.txt'), path.join(dir, 'leak.txt'));

  const res = await games.client.request('GET', '/tank/leak.txt');
  assert.equal(res.status, 404);
  assert.ok(!(await res.text()).includes('SECRET'));
});

test('the front page is installable as a PWA, distinct from the studio', async (t) => {
  const { games } = await bothOrigins(t);

  const catalog = await games.client.request('GET', '/');
  const html = await catalog.text();
  assert.match(html, /<link rel="manifest" href="\/_manifest\.json">/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/_sw\.js'\)/);

  const manifest = await games.client.request('GET', '/_manifest.json');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /application\/json/);
  const parsed = await manifest.json();
  assert.equal(parsed.display, 'standalone');
  assert.equal(parsed.name, 'Unbridled Joy');
  assert.ok(parsed.icons.length >= 2, 'at least a regular and a maskable icon');

  const sw = await games.client.request('GET', '/_sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /text\/javascript/);

  for (const icon of parsed.icons) {
    const res = await games.client.request('GET', icon.src);
    assert.equal(res.status, 200, icon.src);
    assert.equal(res.headers.get('content-type'), 'image/png');
    await res.arrayBuffer();
  }
});

test('the players page stays scriptless, but still carries the manifest', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'index.html', 'game');

  const res = await games.client.request('GET', '/tank/_players');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<link rel="manifest" href="\/_manifest\.json">/);
  assert.doesNotMatch(html, /<script>/, 'nothing changes on this page without a reload');
});

test('an unknown extension downloads rather than rendering', async (t) => {
  const { app, games } = await bothOrigins(t);
  await put(app, 'save.dat', 'opaque');
  const res = await games.client.request('GET', '/tank/save.dat');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /attachment/);
  await res.text();
});
