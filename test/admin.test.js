// Running the studio, and what one person's helpers may spend.
//
// The admin bit is the studio's only role: the first account has it, an admin
// hands it out, and the studio keeps at least one. The daily allowance is the
// inner wall — one person running out stops their helpers and nobody else's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, openStream, putInChat, workChat } from './helpers.js';
import { createFakeLlm, says } from './fake-llm.js';
import { userSpentToday } from '../server/budget.js';

async function studio(t, opts = {}) {
  const app = await setup(opts);
  t.after(() => app.close());
  const admin = await signIn(app);
  const other = app.newClient();
  const robin = await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: other,
  });
  return { app, admin, robin, theirs: other };
}

test('the first account is the admin, and the next one is not', async (t) => {
  const { app, admin, robin, theirs } = await two(t);
  assert.equal(admin.admin, 1);

  const panel = await app.client.json('GET', '/api/admin/studio');
  assert.equal(panel.status, 200);
  assert.deepEqual(
    panel.body.people.map((p) => [p.display_name, p.admin]),
    [['Dann', true], ['Robin', false]],
  );
  assert.equal(panel.body.budget.limit > 0, true);

  // Everybody else has no panel at all.
  assert.equal((await theirs.json('GET', '/api/admin/studio')).status, 403);
  assert.equal(
    (await theirs.json('POST', '/api/admin/users', {
      body: { email: 'x@y.z', display_name: 'X', password: 'hunter2' },
    })).status,
    403,
  );
  assert.equal(robin.admin, 0);
});

// `two` is `studio` under the name the tests read better with.
const two = studio;

test('an admin adds somebody, renames them, and takes them out', async (t) => {
  const { app } = await two(t);
  const made = await app.client.json('POST', '/api/admin/users', {
    body: { email: 'Sam@Example.com', display_name: 'Sam', password: 'hunter2', daily_tokens: 5000 },
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.email, 'sam@example.com', 'the address is normalised');
  assert.equal(made.body.admin, false);
  assert.equal(made.body.daily_tokens, 5000);

  // The new account can sign in, which is the whole point of adding one.
  const sam = app.newClient();
  assert.equal((await sam.post('/api/login', { email: 'sam@example.com', password: 'hunter2' })).status, 200);

  const renamed = await app.client.json('PATCH', `/api/admin/users/${made.body.id}`, {
    body: { display_name: 'Samantha', daily_tokens: null },
  });
  assert.equal(renamed.body.display_name, 'Samantha');
  assert.equal(renamed.body.daily_tokens, null);

  const gone = await app.client.request('DELETE', `/api/admin/users/${made.body.id}`);
  assert.equal(gone.status, 204);
  await gone.text();
  const panel = await app.client.json('GET', '/api/admin/studio');
  assert.deepEqual(panel.body.people.map((p) => p.display_name), ['Dann', 'Robin']);
});

test('a password an admin sets works, and ends the old sessions', async (t) => {
  const { app, robin, theirs } = await two(t);
  assert.equal((await theirs.json('GET', '/api/me')).status, 200);

  const res = await app.client.json('PATCH', `/api/admin/users/${robin.id}`, {
    body: { password: 'newpassword' },
  });
  assert.equal(res.status, 200);
  assert.equal((await theirs.json('GET', '/api/me')).status, 401, 'the old session is gone');

  const again = app.newClient();
  assert.equal(
    (await again.post('/api/login', { email: 'kid@example.com', password: 'newpassword' })).status,
    200,
  );
});

test('the studio keeps at least one admin, and nobody removes themselves', async (t) => {
  const { app, admin, robin } = await two(t);
  const demote = await app.client.json('PATCH', `/api/admin/users/${admin.id}`, {
    body: { admin: false },
  });
  assert.equal(demote.status, 409);
  assert.match(demote.body.error, /at least one admin/);

  const self = await app.client.json('DELETE', `/api/admin/users/${admin.id}`);
  assert.equal(self.status, 409);

  // With a second admin, standing down is allowed.
  await app.client.json('PATCH', `/api/admin/users/${robin.id}`, { body: { admin: true } });
  const ok = await app.client.json('PATCH', `/api/admin/users/${admin.id}`, {
    body: { admin: false },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.admin, false);
  assert.equal((await app.client.json('GET', '/api/admin/studio')).status, 403, 'and it takes effect');
});

test('the studio-wide budget is a number in the panel, not in the source', async (t) => {
  const { app } = await two(t);
  const set = await app.client.json('PATCH', '/api/admin/studio', {
    body: { daily_token_budget: 1234 },
  });
  assert.equal(set.status, 200);
  assert.equal(set.body.budget.limit, 1234);
  assert.equal((await app.client.json('GET', '/api/admin/studio')).body.budget.limit, 1234);
});

// ⚠️ The point of the allowance: one person's day runs out, and the studio
// carries on.
test('a reply is billed to whoever asked, and their allowance stops them alone', async (t) => {
  const llm = createFakeLlm([says('First.'), says('Second.'), says('Third.')]);
  const { app, robin, theirs } = await two(t, { llm });

  // Robin's game, Robin's helper, Robin's allowance — a small one.
  await theirs.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const agent = await app.client.json('POST', '/api/agents', {
    body: { name: 'Designer', description: 'You design games.' },
  });
  const chat = await workChat(app, 'tank');
  await theirs.json('POST', `/api/projects/tank/chats/${chat}/agents`, {
    body: { agent_id: agent.body.id, chatty: true },
  });
  // Small enough that one reply uses it up: a fired reply costs ~110 here.
  await app.client.json('PATCH', `/api/admin/users/${robin.id}`, { body: { daily_tokens: 50 } });

  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await theirs.json('POST', '/api/projects/tank/messages', {
    body: { body: 'make a start', chat_id: chat },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'First.');

  const spent = userSpentToday(app.db, robin.id);
  assert.ok(spent > 0, 'the reply was billed to the person who asked');
  assert.equal(userSpentToday(app.db, 1), 0, 'and to nobody else');

  // Over the allowance now: the next ask gets a note rather than a reply.
  await theirs.json('POST', '/api/projects/tank/messages', {
    body: { body: 'and again', chat_id: chat },
  });
  const note = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system',
  );
  assert.match(note.data.body, /Robin has used up today's tokens/);
  assert.equal(llm.calls.length, 1, 'no second fire');

  // The admin, who has no allowance of their own, is unaffected in their own
  // game with the same helper.
  await app.client.json('POST', '/api/projects', { body: { name: 'Mine', slug: 'mine' } });
  const otherChat = await workChat(app, 'mine');
  await app.client.json('POST', `/api/projects/mine/chats/${otherChat}/agents`, {
    body: { agent_id: agent.body.id, chatty: true },
  });
  await app.client.json('POST', '/api/projects/mine/messages', {
    body: { body: 'my turn', chat_id: otherChat },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Second.');
  assert.equal(llm.calls.length, 2, 'somebody else’s day is their own');
});
