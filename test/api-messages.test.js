import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, openStream } from './helpers.js';

async function project(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return app;
}

const send = (app, body) => app.client.json('POST', '/api/projects/tank/messages', { body });

test('posting a message stores it and broadcasts it', async (t) => {
  const app = await project(t);
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const res = await send(app, { body: 'lets build a tank game' });
  assert.equal(res.status, 201);
  assert.equal(res.body.body, 'lets build a tank game');
  assert.equal(res.body.project_slug, 'tank');
  assert.equal(res.body.agent_id, null);
  assert.equal(typeof res.body.user_id, 'number');
  assert.deepEqual(res.body.context_paths, []);
  assert.deepEqual(res.body.writes, []);

  const event = await stream.waitFor((e) => e.event === 'message.new');
  assert.equal(event.data.id, res.body.id);
});

test('a message is trimmed and cannot be empty', async (t) => {
  const app = await project(t);
  const trimmed = await send(app, { body: '  hello  ' });
  assert.equal(trimmed.body.body, 'hello');

  for (const body of [{}, { body: '' }, { body: '   ' }, { body: 42 }, { body: null }]) {
    assert.equal((await send(app, body)).status, 400, JSON.stringify(body));
  }
});

// The cap is on bytes: an emoji costs four, so a character-based check would
// let a message through that the column then has to hold.
test('the length cap counts bytes, not characters', async (t) => {
  const app = await project(t);
  const emoji = String.fromCodePoint(0x1f600);
  const justUnder = emoji.repeat(8 * 1024);
  assert.equal(Buffer.byteLength(justUnder, 'utf8'), 32 * 1024);
  assert.equal((await send(app, { body: justUnder })).status, 201);

  const justOver = `${justUnder}x`;
  const res = await send(app, { body: justOver });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /bytes/);
});

test('context paths are validated, deduplicated, and returned', async (t) => {
  const app = await project(t);
  const res = await send(app, {
    body: 'look at these',
    context_paths: ['js/game.js', 'index.html', 'js/game.js'],
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.context_paths, ['index.html', 'js/game.js']);

  // A pinned path need not exist yet — you can point at a file you are asking
  // an agent to create.
  assert.equal((await send(app, {
    body: 'make this', context_paths: ['not/created/yet.js'],
  })).status, 201);

  for (const paths of [
    ['../escape.txt'], ['.git/config'], [''], [42], 'not-an-array',
    Array.from({ length: 51 }, (_, i) => `f${i}.txt`),
  ]) {
    const bad = await send(app, { body: 'x', context_paths: paths });
    assert.equal(bad.status, 400, JSON.stringify(paths).slice(0, 50));
  }
});

test('messages come back in order with the project detail', async (t) => {
  const app = await project(t);
  for (const text of ['first', 'second', 'third']) {
    await send(app, { body: text });
  }
  const detail = await app.client.json('GET', '/api/projects/tank');
  assert.deepEqual(detail.body.messages.map((m) => m.body), ['first', 'second', 'third']);
  assert.equal(detail.body.preview, 'third');
});

test('history pages backwards and reports whether more remain', async (t) => {
  const app = await project(t);
  const ids = [];
  for (let i = 0; i < 10; i += 1) {
    ids.push((await send(app, { body: `message ${i}` })).body.id);
  }

  const newest = await app.client.json('GET', '/api/projects/tank/messages?limit=4');
  assert.deepEqual(newest.body.messages.map((m) => m.body), [
    'message 6', 'message 7', 'message 8', 'message 9',
  ]);
  assert.equal(newest.body.has_more, true);

  const older = await app.client.json(
    'GET', `/api/projects/tank/messages?limit=4&before=${newest.body.messages[0].id}`,
  );
  assert.deepEqual(older.body.messages.map((m) => m.body), [
    'message 2', 'message 3', 'message 4', 'message 5',
  ]);

  const oldest = await app.client.json(
    'GET', `/api/projects/tank/messages?limit=4&before=${older.body.messages[0].id}`,
  );
  assert.deepEqual(oldest.body.messages.map((m) => m.body), ['message 0', 'message 1']);
  assert.equal(oldest.body.has_more, false);
});

test('a bad pagination cursor is refused', async (t) => {
  const app = await project(t);
  await send(app, { body: 'x' });
  assert.equal(
    (await app.client.json('GET', '/api/projects/tank/messages?before=abc')).status, 400,
  );
  // A nonsense limit falls back to the default rather than erroring.
  assert.equal(
    (await app.client.json('GET', '/api/projects/tank/messages?limit=abc')).status, 200,
  );
});

test('an archived project accepts no messages but still serves them', async (t) => {
  const app = await project(t);
  await send(app, { body: 'before archiving' });
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  const refused = await send(app, { body: 'after archiving' });
  assert.equal(refused.status, 409);

  const read = await app.client.json('GET', '/api/projects/tank/messages');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.messages.map((m) => m.body), ['before archiving']);
});

test('messages on an unknown project are 404', async (t) => {
  const app = await project(t);
  assert.equal((await app.client.json('GET', '/api/projects/nope/messages')).status, 404);
  assert.equal(
    (await app.client.json('POST', '/api/projects/nope/messages', { body: { body: 'x' } })).status,
    404,
  );
});

test('with no orchestrator wired, a message is simply stored', async (t) => {
  // setup() without an llm leaves ctx.orchestrator null; posting must not
  // throw on the optional call.
  const app = await project(t);
  const res = await send(app, { body: 'nobody is listening' });
  assert.equal(res.status, 201);
});
