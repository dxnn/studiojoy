import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../server/http/router.js';
import { HttpError, json, text } from '../server/http/respond.js';
import { withServer } from './helpers.js';

function appWith(build) {
  const r = createRouter();
  build(r);
  return (req, res) => r.handle(req, res, { marker: 'from-base-ctx' });
}

test('matches literal segments and rejects near misses', async () => {
  const handler = appWith((r) => {
    r.get('/api/me', ({ res }) => json(res, 200, { ok: true }));
  });
  await withServer(handler, async (base) => {
    assert.equal((await fetch(`${base}/api/me`)).status, 200);
    assert.equal((await fetch(`${base}/api/m`)).status, 404);
    assert.equal((await fetch(`${base}/api/me/extra`)).status, 404);
    assert.equal((await fetch(`${base}/api`)).status, 404);
  });
});

test('captures :params and passes base context through', async () => {
  const handler = appWith((r) => {
    r.get('/api/projects/:slug/agents/:id', ({ res, params, marker }) =>
      json(res, 200, { slug: params.slug, id: params.id, marker }));
  });
  await withServer(handler, async (base) => {
    const body = await (await fetch(`${base}/api/projects/tank/agents/7`)).json();
    assert.deepEqual(body, { slug: 'tank', id: '7', marker: 'from-base-ctx' });
  });
});

test('*rest captures the remainder, including nothing', async () => {
  const handler = appWith((r) => {
    r.get('/files/*path', ({ res, params }) => json(res, 200, { path: params.path }));
  });
  await withServer(handler, async (base) => {
    const deep = await (await fetch(`${base}/files/js/lib/game.js`)).json();
    assert.equal(deep.path, 'js/lib/game.js');
    const bare = await (await fetch(`${base}/files`)).json();
    assert.equal(bare.path, '');
  });
});

// An encoded slash must not silently vanish: it lands inside the captured
// value, and path validation re-splits on '/' so `..%2F..` is still caught.
test('percent-encoded separators survive into the captured value', async () => {
  const handler = appWith((r) => {
    r.get('/files/*path', ({ res, params }) => json(res, 200, { path: params.path }));
  });
  await withServer(handler, async (base) => {
    const body = await (await fetch(`${base}/files/..%2F..%2Fetc%2Fpasswd`)).json();
    assert.equal(body.path, '../../etc/passwd');
  });
});

test('malformed percent-encoding is a 400, not a crash', async () => {
  const handler = appWith((r) => {
    r.get('/files/*path', ({ res }) => json(res, 200, {}));
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/files/%zz`);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'malformed url');
  });
});

test('known path with wrong method is 405 with an Allow header', async () => {
  const handler = appWith((r) => {
    r.get('/api/projects', ({ res }) => json(res, 200, []));
    r.post('/api/projects', ({ res }) => json(res, 201, {}));
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/api/projects`, { method: 'DELETE' });
    assert.equal(res.status, 405);
    const allow = res.headers.get('allow');
    assert.ok(allow.includes('GET'), `Allow was ${allow}`);
    assert.ok(allow.includes('POST'), `Allow was ${allow}`);
  });
});

test('a GET route answers HEAD with headers and no body', async () => {
  const handler = appWith((r) => {
    r.get('/hello', ({ res }) => text(res, 200, 'hello world'));
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/hello`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '11');
    assert.equal(await res.text(), '');
  });
});

test('HttpError becomes its status with the message as the error field', async () => {
  const handler = appWith((r) => {
    r.get('/boom', () => {
      throw new HttpError(409, 'already archived', { slug: 'tank' });
    });
  });
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/boom`);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'already archived', slug: 'tank' });
  });
});

test('an unexpected throw is a 500 that leaks nothing', async () => {
  const handler = appWith((r) => {
    r.get('/oops', () => {
      throw new Error('secret internal detail');
    });
  });
  // The router logs the real error; silence it for the duration of the test.
  const realError = console.error;
  console.error = () => {};
  try {
    await withServer(handler, async (base) => {
      const res = await fetch(`${base}/oops`);
      assert.equal(res.status, 500);
      const body = await res.text();
      assert.equal(body, JSON.stringify({ error: 'internal error' }));
      assert.ok(!body.includes('secret internal detail'));
    });
  } finally {
    console.error = realError;
  }
});

test('async handlers are awaited before the next request is served', async () => {
  const handler = appWith((r) => {
    r.get('/slow', async ({ res }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      json(res, 200, { done: true });
    });
  });
  await withServer(handler, async (base) => {
    const body = await (await fetch(`${base}/slow`)).json();
    assert.deepEqual(body, { done: true });
  });
});

test('first registered route wins on overlap', async () => {
  const handler = appWith((r) => {
    r.get('/api/projects/mine', ({ res }) => json(res, 200, { which: 'literal' }));
    r.get('/api/projects/:slug', ({ res }) => json(res, 200, { which: 'param' }));
  });
  await withServer(handler, async (base) => {
    assert.equal((await (await fetch(`${base}/api/projects/mine`)).json()).which, 'literal');
    assert.equal((await (await fetch(`${base}/api/projects/tank`)).json()).which, 'param');
  });
});

test('compile refuses a wildcard that is not last', () => {
  const r = createRouter();
  assert.throws(() => r.get('/a/*rest/b', () => {}), /must be the last segment/);
  assert.throws(() => r.get('no-leading-slash', () => {}), /must start with/);
});
