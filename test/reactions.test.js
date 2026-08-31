import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, openStream } from './helpers.js';

// One project, one message, ready to be reacted to.
async function withMessage(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const posted = await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'lets build a tank game' },
  });
  return { app, messageId: posted.body.id };
}

const toggle = (client, id, emoji) => client.json(
  'POST', `/api/messages/${id}/reactions/toggle`, { body: { emoji } },
);

const listed = async (app, id) => {
  const res = await app.client.json('GET', '/api/projects/tank/messages');
  return res.body.messages.find((m) => m.id === id).reactions;
};

test('a reaction toggles on and off, and rides the message', async (t) => {
  const { app, messageId } = await withMessage(t);

  // A fresh message carries the empty list, not an absent field.
  assert.deepEqual(await listed(app, messageId), []);

  const on = await toggle(app.client, messageId, '🎉');
  assert.equal(on.status, 200);
  assert.equal(on.body.action, 'add');
  assert.deepEqual(await listed(app, messageId), [
    { emoji: '🎉', users: [{ id: 1, name: 'Dann' }] },
  ]);

  const off = await toggle(app.client, messageId, '🎉');
  assert.equal(off.body.action, 'remove');
  assert.deepEqual(await listed(app, messageId), []);
});

test('one emoji from two people is one chip with both names', async (t) => {
  const { app, messageId } = await withMessage(t);
  const other = app.newClient();
  await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: other,
  });

  await toggle(app.client, messageId, '👍');
  await toggle(other, messageId, '👍');
  await toggle(other, messageId, '🚀');

  // Groups stand in the order the first of each landed; names ride along for
  // the tooltip, ids for the "is this mine" test.
  const reactions = await listed(app, messageId);
  assert.deepEqual(reactions.map((r) => r.emoji), ['👍', '🚀']);
  assert.deepEqual(reactions[0].users.map((u) => u.name), ['Dann', 'Robin']);
  assert.deepEqual(reactions[1].users.map((u) => u.name), ['Robin']);

  // One person leaving a shared emoji leaves the other's in place.
  await toggle(app.client, messageId, '👍');
  const after = await listed(app, messageId);
  assert.deepEqual(after[0].users.map((u) => u.name), ['Robin']);
});

test('a multi-codepoint emoji survives the round trip', async (t) => {
  const { app, messageId } = await withMessage(t);
  const family = '👨‍👩‍👧‍👦'; // ZWJ sequence, well over one codepoint, under 32 bytes
  await toggle(app.client, messageId, family);
  assert.deepEqual((await listed(app, messageId)).map((r) => r.emoji), [family]);
});

test('the emoji is required, non-empty, and capped in bytes', async (t) => {
  const { app, messageId } = await withMessage(t);
  for (const body of [{}, { emoji: '' }, { emoji: '   ' }, { emoji: 42 }, { emoji: null }]) {
    const res = await app.client.json(
      'POST', `/api/messages/${messageId}/reactions/toggle`, { body },
    );
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const oversized = await toggle(app.client, messageId, '🤖'.repeat(20));
  assert.equal(oversized.status, 400);
  assert.match(oversized.body.error, /bytes/);
});

test('an unknown message is 404, a bad id 400, signed out 401', async (t) => {
  const { app, messageId } = await withMessage(t);
  assert.equal((await toggle(app.client, 9999, '👍')).status, 404);
  assert.equal((await toggle(app.client, 'abc', '👍')).status, 400);
  const stranger = app.newClient();
  assert.equal((await toggle(stranger, messageId, '👍')).status, 401);
});

// Deliberate: a reaction is talk about the work, not a change to it, so
// neither archiving nor somebody else's authorship stands in the way.
test('reactions are everybody’s, an archived game included', async (t) => {
  const { app, messageId } = await withMessage(t);
  const other = app.newClient();
  await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: other,
  });
  // Robin is not an author; close the game so that matters, then archive it.
  const closed = await app.client.json('POST', '/api/projects/tank/open', {
    body: { open_edit: false },
  });
  assert.equal(closed.status, 200);
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  assert.equal((await toggle(other, messageId, '🎉')).status, 200);
});

test('a toggle broadcasts message.reaction with who and where', async (t) => {
  const { app, messageId } = await withMessage(t);
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await toggle(app.client, messageId, '👋');
  const added = await stream.waitFor(
    (e) => e.event === 'message.reaction' && e.data.action === 'add',
  );
  assert.equal(added.data.project_slug, 'tank');
  assert.equal(typeof added.data.chat_id, 'number');
  assert.equal(added.data.message_id, messageId);
  assert.equal(added.data.user_id, 1);
  assert.equal(added.data.user_name, 'Dann');
  assert.equal(added.data.emoji, '👋');

  await toggle(app.client, messageId, '👋');
  const removed = await stream.waitFor(
    (e) => e.event === 'message.reaction' && e.data.action === 'remove',
  );
  assert.equal(removed.data.emoji, '👋');
});

// A reaction is a row beside the thread, never a message in it: nothing an
// agent is sent is built from message_reactions, and the thread's shape does
// not move when somebody reacts.
test('reacting adds no message to the thread', async (t) => {
  const { app, messageId } = await withMessage(t);
  await toggle(app.client, messageId, '🔥');
  const res = await app.client.json('GET', '/api/projects/tank/messages');
  assert.equal(res.body.messages.length, 1);
  assert.equal(res.body.messages[0].body, 'lets build a tank game');
});
