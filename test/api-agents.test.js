import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, putInChat, workChat } from './helpers.js';

async function studio(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  return app;
}

const makeAgent = (app, body) => app.client.json('POST', '/api/agents', { body });

test('an agent is created with the verified model defaults', async (t) => {
  const app = await studio(t);
  const res = await makeAgent(app, { name: 'Level Designer', description: 'You design levels.' });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Level Designer');
  // There is one model and it is nobody's to choose, so it is not in the
  // payload at all (spec/ §14).
  assert.equal(res.body.model, undefined);
  // 'low', not 'full': at full effort an ambitious request spends the whole
  // allowance thinking and writes nothing (spec.md §14).
  assert.equal(res.body.thinking, 'low');
  assert.equal(res.body.file_tools, true);
});

test('thinking takes the three levels and nothing else', async (t) => {
  const app = await studio(t);
  for (const thinking of ['full', 'low', 'none']) {
    const res = await makeAgent(app, { name: `T ${thinking}`, description: 'd', thinking });
    assert.equal(res.status, 201, thinking);
    assert.equal(res.body.thinking, thinking);
  }
  for (const thinking of ['lots', 'high', '', true, 1]) {
    const res = await makeAgent(app, { name: `U ${thinking}`, description: 'd', thinking });
    assert.equal(res.status, 400, String(thinking));
    assert.match(res.body.error, /thinking must be one of/);
  }
});

test('a model sent by an old client is ignored, never honoured', async (t) => {
  const app = await studio(t);
  // The field is gone from the interface and from the payload, and a client
  // that still sends one — an open tab from before the change, or anybody
  // with curl — must not be able to put the studio on a different model.
  const sent = ['deepseek-v4-pro', 'deepseek-chat', 'gpt-4', '', 5];
  for (const [i, model] of sent.entries()) {
    const res = await makeAgent(app, { name: `Helper ${i}`, description: 'd', model });
    assert.equal(res.status, 201, String(model));
    assert.equal(res.body.model, undefined);
    const row = app.db.prepare('SELECT model FROM agents WHERE id = ?').get(res.body.id);
    assert.equal(row.model, 'deepseek-flash', String(model));
  }
});

test('a critic can be created with file_tools off', async (t) => {
  const app = await studio(t);
  const res = await makeAgent(app, {
    name: 'Critic', description: 'You critique, you do not edit.', file_tools: false,
    thinking: 'full',
  });
  assert.equal(res.body.file_tools, false);
  assert.equal(res.body.thinking, 'full');
});

test('an empty description is allowed but a name is not', async (t) => {
  const app = await studio(t);
  assert.equal((await makeAgent(app, { name: 'Bare', description: '' })).status, 201);
  for (const body of [
    { description: 'd' }, { name: '', description: 'd' }, { name: '  ', description: 'd' },
    { name: 'x'.repeat(101), description: 'd' },
    { name: 'Ok', description: 'y'.repeat(8 * 1024 + 1) },
  ]) {
    assert.equal((await makeAgent(app, body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
});

test('names are unique, and a delete frees the name', async (t) => {
  const app = await studio(t);
  const first = await makeAgent(app, { name: 'Designer', description: 'd' });
  assert.equal(first.status, 201);

  const clash = await makeAgent(app, { name: 'Designer', description: 'other' });
  assert.equal(clash.status, 409);

  const del = await app.client.request('DELETE', `/api/agents/${first.body.id}`);
  assert.equal(del.status, 204);
  await del.text();

  const reused = await makeAgent(app, { name: 'Designer', description: 'fresh' });
  assert.equal(reused.status, 201);
  assert.notEqual(reused.body.id, first.body.id);
});

test('a deleted agent disappears from the list but keeps its row', async (t) => {
  const app = await studio(t);
  const agent = await makeAgent(app, { name: 'Gone', description: 'd' });
  await (await app.client.request('DELETE', `/api/agents/${agent.body.id}`)).text();

  const list = await app.client.json('GET', '/api/agents');
  assert.deepEqual(list.body, []);
  assert.equal((await app.client.json('GET', `/api/agents/${agent.body.id}`)).status, 404);
  // Soft delete, so history can still resolve the name.
  const row = app.db.prepare('SELECT deleted FROM agents WHERE id = ?').get(agent.body.id);
  assert.equal(row.deleted, 1);
});

test('patching updates only what was sent', async (t) => {
  const app = await studio(t);
  const agent = await makeAgent(app, { name: 'Designer', description: 'first' });
  const res = await app.client.json('PATCH', `/api/agents/${agent.body.id}`, {
    body: { description: 'second' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.description, 'second');
  assert.equal(res.body.name, 'Designer', 'unsent fields are untouched');
  assert.equal(res.body.thinking, 'low');

  // Renaming onto a live name is a conflict; renaming to itself is fine.
  await makeAgent(app, { name: 'Other', description: 'd' });
  assert.equal(
    (await app.client.json('PATCH', `/api/agents/${agent.body.id}`, {
      body: { name: 'Other' },
    })).status,
    409,
  );
  assert.equal(
    (await app.client.json('PATCH', `/api/agents/${agent.body.id}`, {
      body: { name: 'Designer' },
    })).status,
    200,
  );
});

test('an unknown or non-numeric agent id is 404', async (t) => {
  const app = await studio(t);
  for (const id of ['999', 'abc', '1.5', '']) {
    const res = await app.client.json('PATCH', `/api/agents/${id}`, { body: { name: 'x' } });
    assert.equal(res.status, 404, id);
  }
});

test('putting a helper in a chat, and taking it out', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const agent = await makeAgent(app, { name: 'Designer', description: 'd' });
  const chat = await workChat(app, 'tank');

  const attach = await putInChat(app, 'tank', agent.body.id, { chatty: true });
  assert.equal(attach.status, 201);
  assert.equal(attach.body.chatty, true);
  assert.equal(attach.body.chat_id, chat);

  // The helpers on the project detail are that chat's, so the read names it.
  const detail = await app.client.json('GET', `/api/projects/tank?chat=${chat}`);
  assert.equal(detail.body.agents.length, 1);
  assert.equal(detail.body.agents[0].name, 'Designer');
  assert.equal(detail.body.agents[0].chatty, true);
  // And the chat it opens on has none of them.
  assert.deepEqual((await app.client.json('GET', '/api/projects/tank')).body.agents, []);

  // Twice in one chat is a conflict, not a duplicate row.
  assert.equal((await putInChat(app, 'tank', agent.body.id)).status, 409);

  const patched = await app.client.json(
    'PATCH', `/api/projects/tank/chats/${chat}/agents/${agent.body.id}`,
    { body: { chatty: false } },
  );
  assert.equal(patched.body.chatty, false);

  const del = await app.client.request(
    'DELETE', `/api/projects/tank/chats/${chat}/agents/${agent.body.id}`,
  );
  assert.equal(del.status, 204);
  await del.text();
  assert.deepEqual(
    (await app.client.json('GET', `/api/projects/tank?chat=${chat}`)).body.agents, [],
  );
});

// ⚠️ The human-only chat is human-only at the door, not at the point where
// somebody would have answered.
test('no helper can be put in the chat a project opens on', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const agent = await makeAgent(app, { name: 'Designer', description: 'd' });
  const detail = await app.client.json('GET', '/api/projects/tank');
  const home = detail.body.chats.find((c) => !c.bots);

  const res = await putInChat(app, 'tank', agent.body.id, { chat_id: home.id });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /just for the humans/);
  // The builder's own seat in Building is the one row there is.
  assert.equal(app.db.prepare(
    'SELECT COUNT(*) c FROM chat_agents ca JOIN agents a ON a.id = ca.agent_id WHERE a.builtin = 0',
  ).get().c, 0);
});

test('deleting an agent detaches it everywhere', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  await app.client.json('POST', '/api/projects', { body: { name: 'Snake' } });
  const agent = await makeAgent(app, { name: 'Designer', description: 'd' });
  const chats = {};
  for (const slug of ['tank', 'snake']) {
    chats[slug] = await workChat(app, slug);
    await putInChat(app, slug, agent.body.id);
  }
  await (await app.client.request('DELETE', `/api/agents/${agent.body.id}`)).text();

  for (const slug of ['tank', 'snake']) {
    assert.deepEqual(
      (await app.client.json('GET', `/api/projects/${slug}?chat=${chats[slug]}`)).body.agents, [],
    );
  }
  // Only the builder's seats remain, one per game.
  assert.equal(app.db.prepare(
    'SELECT COUNT(*) c FROM chat_agents ca JOIN agents a ON a.id = ca.agent_id WHERE a.builtin = 0',
  ).get().c, 0);
});

test('a chat holds at most ten helpers', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  for (let i = 0; i < 10; i += 1) {
    const agent = await makeAgent(app, { name: `Agent ${i}`, description: 'd' });
    assert.equal((await putInChat(app, 'tank', agent.body.id)).status, 201, `agent ${i}`);
  }
  const extra = await makeAgent(app, { name: 'Eleventh', description: 'd' });
  const res = await putInChat(app, 'tank', extra.body.id);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /10 helpers/);
});

test('an archived project accepts no helper changes', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const agent = await makeAgent(app, { name: 'Designer', description: 'd' });
  const chat = await workChat(app, 'tank');
  await putInChat(app, 'tank', agent.body.id, { chat_id: chat });
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  assert.equal((await putInChat(app, 'tank', agent.body.id, { chat_id: chat })).status, 409);
  assert.equal(
    (await app.client.json(
      'PATCH', `/api/projects/tank/chats/${chat}/agents/${agent.body.id}`,
      { body: { chatty: true } },
    )).status,
    409,
  );
  const del = await app.client.request(
    'DELETE', `/api/projects/tank/chats/${chat}/agents/${agent.body.id}`,
  );
  assert.equal(del.status, 409);
  await del.text();
});

test('taking out a helper that was never in the chat is 404', async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const agent = await makeAgent(app, { name: 'Designer', description: 'd' });
  const chat = await workChat(app, 'tank');
  const del = await app.client.request(
    'DELETE', `/api/projects/tank/chats/${chat}/agents/${agent.body.id}`,
  );
  assert.equal(del.status, 404);
  await del.text();
});
