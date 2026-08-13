import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, openStream } from './helpers.js';

test('a tab receives project events over SSE', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);

  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await app.client.json('POST', '/api/projects', { body: { name: 'Tank Game' } });
  const created = await stream.waitFor((e) => e.event === 'project.new');
  assert.equal(created.data.slug, 'tank-game');
  assert.equal(created.data.name, 'Tank Game');

  await app.client.json('PATCH', '/api/projects/tank-game', { body: { name: 'Renamed' } });
  const updated = await stream.waitFor(
    (e) => e.event === 'project.updated' && e.data.name === 'Renamed',
  );
  assert.equal(updated.data.slug, 'tank-game');
  assert.equal(updated.data.archived, false);
});

// Everyone sees everything, so there is no membership to filter on and a
// second account's tab gets the same events (spec.md §9).
test('every connected tab receives every event', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);

  const other = app.newClient();
  await signIn(app, {
    email: 'sam@example.com', password: 'pw', displayName: 'Sam', client: other,
  });

  const mine = await openStream(app.client);
  const theirs = await openStream(other);
  t.after(() => Promise.all([mine.close(), theirs.close()]));
  assert.equal(app.broker.count(), 2);

  await app.client.json('POST', '/api/projects', { body: { name: 'Shared' } });
  for (const stream of [mine, theirs]) {
    const event = await stream.waitFor((e) => e.event === 'project.new');
    assert.equal(event.data.slug, 'shared');
  }
});

test('two tabs for one account both get events', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const secondTab = app.newClient();
  secondTab.use(app.client.peek());

  const a = await openStream(app.client);
  const b = await openStream(secondTab);
  t.after(() => Promise.all([a.close(), b.close()]));

  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  await a.waitFor((e) => e.event === 'project.new');
  await b.waitFor((e) => e.event === 'project.new');
  assert.deepEqual(app.broker.userIds().length, 1, 'both tabs belong to one user');
});

test('the stream refuses an anonymous caller', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const res = await app.client.request('GET', '/api/stream');
  assert.equal(res.status, 401);
  await res.text();
});

test('the stream announces itself with the right headers', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const res = await app.client.request('GET', '/api/stream');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.match(res.headers.get('cache-control'), /no-cache/);
  assert.equal(res.headers.get('x-accel-buffering'), 'no');
  await res.body.cancel();
});

test('closing a tab unsubscribes it', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);

  const stream = await openStream(app.client);
  assert.equal(app.broker.count(), 1);
  await stream.close();

  // The unsubscribe runs on the socket close event, so give it a moment.
  for (let i = 0; i < 50 && app.broker.count() !== 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(app.broker.count(), 0);
});

test('a broadcast to a dropped client does not break the others', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const live = await openStream(app.client);
  t.after(() => live.close());

  // A subscriber whose write always throws stands in for a socket that died
  // between the broadcast starting and reaching it.
  app.broker.subscribe(999, () => {
    throw new Error('socket gone');
  });
  assert.equal(app.broker.count(), 2);

  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const event = await live.waitFor((e) => e.event === 'project.new');
  assert.equal(event.data.slug, 'tank');
  assert.equal(app.broker.count(), 1, 'the broken client was forgotten');
});
