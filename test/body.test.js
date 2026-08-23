import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../server/http/router.js';
import { readJson } from '../server/http/body.js';
import { json } from '../server/http/respond.js';
import { withServer } from './helpers.js';

// One route that echoes what readJson gave it, and a flag saying whether the
// handler ran at all — the guard is supposed to refuse before that.
function appWith() {
  const state = { ran: false };
  const r = createRouter();
  r.post('/echo', async (ctx) => {
    state.ran = true;
    json(ctx.res, 200, await readJson(ctx.req));
  });
  return { handler: (req, res) => r.handle(req, res, {}), state };
}

// ⚠️ The point of the guard: a text/plain POST is CORS-safelisted, so a game
// on the same hostname could send one cross-origin with the operator's cookie
// and no preflight. It must bounce before the handler runs, even when the
// body is perfectly good JSON.
test('a text/plain POST is refused before the handler runs', async () => {
  const { handler, state } = appWith();
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ name: 'sneak' }),
    });
    assert.equal(res.status, 415);
    assert.equal((await res.json()).error, 'expected content-type: application/json');
    assert.equal(state.ran, true, 'the route matched');
  });
});

test('a POST with no content-type at all is refused too', async () => {
  const { handler } = appWith();
  await withServer(handler, async (base) => {
    // fetch invents a content-type when given a body, so send none.
    const res = await fetch(`${base}/echo`, { method: 'POST' });
    assert.equal(res.status, 415);
    await res.text();
  });
});

test('parameters and case on the declared type are tolerated', async () => {
  const { handler } = appWith();
  await withServer(handler, async (base) => {
    for (const declared of [
      'application/json',
      'application/json; charset=utf-8',
      'Application/JSON',
    ]) {
      const res = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': declared },
        body: JSON.stringify({ ok: 1 }),
      });
      assert.equal(res.status, 200, declared);
      assert.deepEqual(await res.json(), { ok: 1 });
    }
  });
});

test('behind the header, an empty body is still an empty object', async () => {
  const { handler } = appWith();
  await withServer(handler, async (base) => {
    const res = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {});
  });
});

test('behind the header, bad JSON and non-objects are still 400s', async () => {
  const { handler } = appWith();
  await withServer(handler, async (base) => {
    for (const [body, error] of [
      ['{nope', 'invalid json'],
      ['[1,2]', 'body must be a json object'],
      ['"hi"', 'body must be a json object'],
    ]) {
      const res = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      assert.equal(res.status, 400, body);
      assert.equal((await res.json()).error, error);
    }
  });
});
