// Whether a chat holds a message from somebody else since you last read it —
// the generic "something happened" flag underneath @mentions' "you were
// named" one (server/reads.js).
//
// The rules under test: unread is per chat, never set by your own message,
// opening the chat clears it, one person's reading is never another's, and a
// mention still leaves the generic flag too — clearing one clears both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';

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

const unread = async (client) => (await client.json('GET', '/api/projects/tank')).body.unread;

test('a message from somebody else leaves the game unread; your own does not', async (t) => {
  const { app, theirs } = await two(t);

  assert.equal(await unread(theirs), false);
  await say(app.client, 'the tank looks great');
  assert.equal(await unread(theirs), true, 'Robin has not read Dann\'s message');
  assert.equal(await unread(app.client), false, 'writing it is reading it');
});

test('a message naming nobody still leaves the generic flag', async (t) => {
  const { app, theirs } = await two(t);
  await say(app.client, 'no names in this one');
  const before = (await theirs.json('GET', '/api/projects/tank')).body;
  assert.equal(before.mentions, 0);
  assert.equal(before.unread, true);
});

test('unread says which conversation, and reading that one clears it', async (t) => {
  const { app, theirs } = await two(t);
  // A third room: a chat added to a game is another of the builder's.
  const work = (await app.client.json('POST', '/api/projects/tank/chats', {
    body: { name: 'Art' },
  })).body.id;

  await say(app.client, 'over here');
  await say(app.client, 'and here too', work);

  const before = (await theirs.json('GET', '/api/projects/tank')).body;
  assert.equal(before.unread, true);
  assert.deepEqual(
    before.chats.map((c) => c.unread),
    [true, false, true],
    'Humans only and Art each hold one; Building does not',
  );

  const seen = await theirs.json('POST', `/api/projects/tank/chats/${work}/seen`);
  assert.equal(seen.status, 204);

  const after = (await theirs.json('GET', '/api/projects/tank')).body;
  assert.equal(after.unread, true, 'Humans only is still unread');
  assert.deepEqual(after.chats.map((c) => c.unread), [true, false, false]);
});

test('reading is yours alone', async (t) => {
  const { app, theirs } = await two(t);
  await say(app.client, 'hello');
  const home = (await app.client.json('GET', '/api/projects/tank')).body.chats[0].id;
  assert.equal((await app.client.json('POST', `/api/projects/tank/chats/${home}/seen`)).status, 204);
  assert.equal(await unread(theirs), true, 'Dann reading it changes nothing for Robin');
});

test('a mention also leaves the generic flag, and reading clears both', async (t) => {
  const { app, theirs } = await two(t);
  await say(app.client, '@Robin look at this');

  const before = (await theirs.json('GET', '/api/projects/tank')).body;
  assert.equal(before.mentions, 1);
  assert.equal(before.unread, true);

  assert.equal((await theirs.json('POST', `/api/projects/tank/chats/${before.chats[0].id}/seen`)).status, 204);
  const after = (await theirs.json('GET', '/api/projects/tank')).body;
  assert.equal(after.mentions, 0);
  assert.equal(after.unread, false);
});

test('the sidebar list carries each person their own unread flag', async (t) => {
  const { app, theirs } = await two(t);
  await say(app.client, 'take a look');

  // The studio's announcements are in every list, pinned apart.
  const mine = (await app.client.json('GET', '/api/projects')).body.filter((p) => !p.announce);
  const yours = (await theirs.json('GET', '/api/projects')).body.filter((p) => !p.announce);
  assert.deepEqual(mine.map((p) => p.unread), [false]);
  assert.deepEqual(yours.map((p) => p.unread), [true]);
});
