// Calling a person by name. The same @ that wakes a helper leaves a mark on
// the game in that person's sidebar, and the mark stays until they open the
// chat it was said in.
//
// The rules under test: a mark is one row per person per message, it is per
// chat rather than per project, it is never left for the person who wrote it,
// opening the chat clears it, and one person's marks are never another's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, openStream } from './helpers.js';

// Dann makes the game; Robin Fox is in the studio and is not an author.
async function two(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const other = app.newClient();
  const robin = await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin Fox', client: other,
  });
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return { app, robin, theirs: other };
}

const say = (client, body, chatId) => client.json('POST', '/api/projects/tank/messages', {
  body: chatId === undefined ? { body } : { body, chat_id: chatId },
});

const marks = async (client) => (await client.json('GET', '/api/projects/tank')).body.mentions;

test('an @ leaves a mark for the person it names and for nobody else', async (t) => {
  const { app, theirs } = await two(t);

  assert.equal(await marks(theirs), 0);
  assert.equal(await say(app.client, '@Robin can you draw the tank?').then((r) => r.status), 201);

  // The first word of the name is what reaches them: a mention is one token.
  assert.equal(await marks(theirs), 1);
  // Never the person who said it.
  assert.equal(await marks(app.client), 0);
});

test('a message naming nobody leaves nothing, and an address is not a mention', async (t) => {
  const { app, theirs } = await two(t);
  await say(app.client, 'the tank looks great');
  await say(app.client, 'mail robin@example.com about it');
  assert.equal(await marks(theirs), 0);
});

test('the mark says which conversation, and reading that one clears it', async (t) => {
  const { app, theirs } = await two(t);
  // A third room: a chat added to a game is another of the builder's.
  const work = (await app.client.json('POST', '/api/projects/tank/chats', {
    body: { name: 'Art' },
  })).body.id;

  // One in each of two rooms: the human-only one, which is everybody's, and Art.
  await say(app.client, '@Robin over here');
  await say(app.client, '@Robin and here too', work);

  const before = (await theirs.json('GET', '/api/projects/tank')).body;
  assert.equal(before.mentions, 2, 'the game says two');
  assert.deepEqual(
    before.chats.map((c) => c.mentions),
    [1, 0, 1],
    'and each conversation says its own — Humans only, Building, Art',
  );

  // Reading one clears that one and leaves the other standing.
  const seen = await theirs.json('POST', `/api/projects/tank/chats/${work}/seen`);
  assert.equal(seen.status, 204);

  const after = (await theirs.json('GET', '/api/projects/tank')).body;
  assert.equal(after.mentions, 1);
  assert.deepEqual(after.chats.map((c) => c.mentions), [1, 0, 0]);

  // And it is Robin's to clear: Dann reading it changes nothing over there.
  await app.client.json('POST', '/api/projects/tank/chats/1/seen');
  assert.equal(await marks(theirs), 1);
});

test('the same message twice over does not mark twice', async (t) => {
  const { app, theirs } = await two(t);
  await say(app.client, '@Robin @robin @ROBIN');
  assert.equal(await marks(theirs), 1, 'one message, one mark');
});

test('somebody who cannot change the game is still named in its human-only chat', async (t) => {
  const { app, theirs } = await two(t);
  // Robin talks in the one chat that is everyone's, naming Dann.
  const said = await say(theirs, '@Dann I finished the sprite');
  assert.equal(said.status, 201);
  assert.equal(await marks(app.client), 1);
});

test('the mark rides the message event, for the tab that is not looking', async (t) => {
  const { app, theirs } = await two(t);
  const stream = await openStream(theirs);
  t.after(() => stream.close());

  await say(app.client, '@Robin look at this');
  const event = await stream.waitFor((e) => e.event === 'message.new');
  assert.deepEqual(event.data.mentions, [(await theirs.json('GET', '/api/me')).body.id]);
});

test('the sidebar list carries each person their own marks', async (t) => {
  const { app, theirs } = await two(t);
  await say(app.client, '@Robin have a look');

  const mine = (await app.client.json('GET', '/api/projects')).body;
  const yours = (await theirs.json('GET', '/api/projects')).body;
  assert.deepEqual(mine.map((p) => p.mentions), [0]);
  assert.deepEqual(yours.map((p) => p.mentions), [1]);
});
