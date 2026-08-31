// The starter helper: who joins every new game's Building chat, so a game is
// somewhere you can ask for something the moment it exists.
//
// A studio-wide setting rather than a name in the source — helpers are rows
// people make, rename and delete — so the two things worth pinning down are
// that it is one admin's decision, and that it never lands anywhere a helper
// is not allowed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';

async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const made = await app.client.json('POST', '/api/agents', {
    body: { name: 'Buildermate Steve', description: 'Builds things.' },
  });
  return { app, steve: made.body };
}

const setStarter = (app, id) => app.client.json('PATCH', '/api/admin/studio', {
  body: { daily_token_budget: null, starter_agent_id: id },
});

const newGame = (app, name, slug, kind) => app.client.json('POST', '/api/projects', {
  body: { name, slug, ...(kind ? { kind } : {}) },
});

test('with no starter helper a new game is empty and opens on Humans only', async (t) => {
  const { app } = await studio(t);
  const made = await newGame(app, 'Tank', 'tank');
  assert.equal(made.status, 201);
  assert.equal(made.body.chat.name, 'Humans only');
  assert.equal(made.body.chats.map((c) => c.name).join(', '), 'Humans only, Building');

  const opened = await app.client.json('GET', `/api/projects/tank?chat=${made.body.chat.id}`);
  assert.deepEqual(opened.body.agents, []);
});

test('the starter helper joins the Building chat, and the game opens there', async (t) => {
  const { app, steve } = await studio(t);
  assert.equal((await setStarter(app, steve.id)).body.starter_agent_id, steve.id);

  const made = await newGame(app, 'Tank', 'tank');
  assert.equal(made.body.chat.name, 'Building');

  const opened = await app.client.json('GET', `/api/projects/tank?chat=${made.body.chat.id}`);
  assert.deepEqual(
    opened.body.agents.map((a) => [a.name, a.chatty]),
    [['Buildermate Steve', true]],
    'chatty: a helper that has to be called by name is not company',
  );

  // ⚠️ And nowhere near the room that promises nobody is listening.
  const humans = made.body.chats.find((c) => !c.bots);
  const alone = await app.client.json('GET', `/api/projects/tank?chat=${humans.id}`);
  assert.deepEqual(alone.body.agents, []);
});

// The one room takes helpers — you can call one in by name — but nobody is
// put in it: there is nothing to build, and a chat somebody started to talk in
// should open on the people in it.
test('a chat project has no building to do, so nobody joins it', async (t) => {
  const { app, steve } = await studio(t);
  await setStarter(app, steve.id);

  const made = await newGame(app, 'Silly ideas', 'silly-ideas', 'chat');
  assert.equal(made.body.chats.length, 1);
  assert.equal(made.body.chat.name, 'Silly ideas');
  assert.equal(made.body.chat.bots, true);
  const opened = await app.client.json(
    'GET', `/api/projects/silly-ideas?chat=${made.body.chat.id}`,
  );
  assert.deepEqual(opened.body.agents, []);
});

test('a starter helper that has been taken out of the studio is nobody', async (t) => {
  const { app, steve } = await studio(t);
  await setStarter(app, steve.id);
  await app.client.json('DELETE', `/api/agents/${steve.id}`);

  const panel = await app.client.json('GET', '/api/admin/studio');
  assert.equal(panel.body.starter_agent_id, null);

  const made = await newGame(app, 'Tank', 'tank');
  assert.equal(made.body.chat.name, 'Humans only');
});

test('it is an admin decision, and it has to be a real helper', async (t) => {
  const { app, steve } = await studio(t);
  const theirs = app.newClient();
  await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: theirs,
  });
  assert.equal((await theirs.json('PATCH', '/api/admin/studio', {
    body: { daily_token_budget: null, starter_agent_id: steve.id },
  })).status, 403);

  const nonsense = await setStarter(app, 9999);
  assert.equal(nonsense.status, 400);
  assert.match(nonsense.body.error, /no such helper/);

  // Cleared again, and the budget beside it is untouched either way.
  await setStarter(app, steve.id);
  assert.equal((await setStarter(app, null)).body.starter_agent_id, null);
});
