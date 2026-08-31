// Calling a helper into the room by name. The same @ that makes a helper
// eligible to answer puts it in the chat when it was not there — an @ is how
// you reach somebody, and having to fetch them from a list first is the studio
// asking you to do its filing.
//
// The rules under test: a named helper joins waiting-to-be-called rather than
// chatty, the room's cap still holds, a helper already in the room is left
// exactly as it is, ⚠️ a human-only chat lets nobody in this way either, and
// the message says who came.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, workChat, openStream } from './helpers.js';

async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return app;
}

const makeHelper = async (app, name) => (await app.client.json('POST', '/api/agents', {
  body: { name, description: 'builds things' },
})).body.id;

const say = (app, body, chatId) => app.client.json('POST', '/api/projects/tank/messages', {
  body: { body, chat_id: chatId },
});

const inChat = async (app, chatId) => (
  await app.client.json('GET', `/api/projects/tank?chat=${chatId}`)
).body.agents;

test('naming a helper who is not in the room puts them in it', async (t) => {
  const app = await studio(t);
  const work = await workChat(app, 'tank');
  await makeHelper(app, 'Alice');

  assert.deepEqual(await inChat(app, work), []);
  const sent = await say(app, '@Alice can you make the tank turn?', work);
  assert.equal(sent.status, 201);

  const there = await inChat(app, work);
  assert.deepEqual(there.map((a) => a.name), ['Alice']);
  // Waiting to be called, not chatty: you asked this one thing of them.
  assert.equal(there[0].chatty, false);
});

test('a prefix reaches them the same way it reaches a person', async (t) => {
  const app = await studio(t);
  const work = await workChat(app, 'tank');
  await makeHelper(app, 'Level Designer');

  await say(app, 'over to you @level', work);
  assert.deepEqual((await inChat(app, work)).map((a) => a.name), ['Level Designer']);
});

test('a helper already in the room is left exactly as they are', async (t) => {
  const app = await studio(t);
  const work = await workChat(app, 'tank');
  const alice = await makeHelper(app, 'Alice');
  await app.client.json(`POST`, `/api/projects/tank/chats/${work}/agents`, {
    body: { agent_id: alice, chatty: true },
  });

  await say(app, '@Alice again please', work);
  const there = await inChat(app, work);
  assert.equal(there.length, 1);
  // Still chatty: being named does not take somebody's switch away.
  assert.equal(there[0].chatty, true);
});

// ⚠️ The promise the human-only chat makes is kept at the door, and an @ is a
// knock like any other.
test('a human-only chat lets nobody in by name', async (t) => {
  const app = await studio(t);
  const home = (await app.client.json('GET', '/api/projects/tank')).body.chat;
  assert.equal(home.bots, false);
  await makeHelper(app, 'Alice');

  const sent = await say(app, '@Alice are you listening?', home.id);
  assert.equal(sent.status, 201, 'the message still goes');
  assert.deepEqual(await inChat(app, home.id), []);
});

test('a name nobody has, and a helper that has been deleted, call nobody', async (t) => {
  const app = await studio(t);
  const work = await workChat(app, 'tank');
  const alice = await makeHelper(app, 'Alice');
  await app.client.json('DELETE', `/api/agents/${alice}`);

  await say(app, '@Alice? @nobodyatall?', work);
  assert.deepEqual(await inChat(app, work), []);
});

test('the room’s cap holds against a message naming everybody', async (t) => {
  const app = await studio(t);
  const work = await workChat(app, 'tank');
  const names = [];
  for (let i = 0; i < 12; i += 1) {
    const name = `Helper${String(i).padStart(2, '0')}`;
    names.push(name);
    // eslint-disable-next-line no-await-in-loop
    await makeHelper(app, name);
  }

  const sent = await say(app, names.map((n) => `@${n}`).join(' '), work);
  // The message stands: refusing words somebody has already written because
  // a room is full would lose them.
  assert.equal(sent.status, 201);
  const there = await inChat(app, work);
  assert.equal(there.length, 10);
  // The first ten by name, so which ten is not a matter of luck.
  assert.deepEqual(there.map((a) => a.name), names.slice(0, 10));
});

test('the message says who it called in, so every tab can show them', async (t) => {
  const app = await studio(t);
  const work = await workChat(app, 'tank');
  await makeHelper(app, 'Alice');

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await say(app, '@Alice hello', work);

  const landed = await stream.waitFor((e) => e.event === 'message.new');
  assert.deepEqual(landed.data.joined.map((a) => a.name), ['Alice']);
});
