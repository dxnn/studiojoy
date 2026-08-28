import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn, startGames, openStream } from './helpers.js';
import { createFakeLlm, says } from './fake-llm.js';

// A chat is a project with no working tree: same thread, same agents, no
// files and nothing on disk (spec.md §3).
async function studio(t, opts = {}) {
  const app = await setup(opts);
  t.after(() => app.close());
  await signIn(app);
  return app;
}

async function makeChat(app, { name = 'Random Thoughts', slug = 'random' } = {}) {
  const res = await app.client.json('POST', '/api/projects', {
    body: { name, slug, kind: 'chat' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test('creating a chat writes nothing to disk', async (t) => {
  const app = await studio(t);
  const chat = await makeChat(app);

  assert.equal(chat.kind, 'chat');
  assert.equal(
    fs.existsSync(path.join(app.gamesDir, 'random')), false,
    'a chat has no working tree',
  );
});

test('a project defaults to a game, and an unknown kind is refused', async (t) => {
  const app = await studio(t);
  const game = await app.client.json('POST', '/api/projects', {
    body: { name: 'Tank' },
  });
  assert.equal(game.body.kind, 'game');
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'tank')), true);

  const bad = await app.client.json('POST', '/api/projects', {
    body: { name: 'Nope', slug: 'nope', kind: 'notebook' },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /kind must be one of/);
  assert.equal(fs.existsSync(path.join(app.gamesDir, 'nope')), false);
});

test('chat detail has no files and nothing to play', async (t) => {
  const app = await studio(t);
  await makeChat(app);

  const res = await app.client.json('GET', '/api/projects/random');
  assert.equal(res.status, 200);
  assert.equal(res.body.kind, 'chat');
  assert.deepEqual(res.body.files, []);
  assert.equal(res.body.play_url, null);
  assert.deepEqual(res.body.messages, []);
});

test('every file route refuses a chat', async (t) => {
  const app = await studio(t);
  await makeChat(app);

  const attempts = [
    ['GET', '/api/projects/random/files'],
    ['GET', '/api/projects/random/files/index.html'],
    ['PUT', '/api/projects/random/files/index.html'],
    ['DELETE', '/api/projects/random/files/index.html'],
    ['POST', '/api/projects/random/files/move'],
    ['POST', '/api/projects/random/files/duplicate'],
  ];
  for (const [method, url] of attempts) {
    const res = await app.client.json(method, url, {
      ...(method === 'PUT' ? { rawBody: 'hi', headers: { 'content-type': 'text/plain' } } : {}),
      ...(method === 'POST' ? { body: { from: 'a.html', to: 'b.html' } } : {}),
    });
    assert.equal(res.status, 409, `${method} ${url}`);
    assert.match(res.body.error, /chat, not a game/);
  }
});

test('every version route refuses a chat', async (t) => {
  const app = await studio(t);
  await makeChat(app);
  const sha = '0'.repeat(40);

  const attempts = [
    ['GET', '/api/projects/random/history'],
    ['GET', `/api/projects/random/history/${sha}/index.html`],
    ['GET', `/api/projects/random/diff/${sha}`],
    ['POST', '/api/projects/random/restore'],
  ];
  for (const [method, url] of attempts) {
    const res = await app.client.json(method, url, {
      ...(method === 'POST' ? { body: { sha, path: 'index.html' } } : {}),
    });
    assert.equal(res.status, 409, `${method} ${url}`);
    assert.match(res.body.error, /chat, not a game/);
  }
});

test('the games origin does not serve a chat slug', async (t) => {
  const app = await studio(t);
  await makeChat(app);
  // A directory planted by hand must not make a chat public either.
  fs.mkdirSync(path.join(app.gamesDir, 'random'), { recursive: true });
  fs.writeFileSync(path.join(app.gamesDir, 'random', 'index.html'), '<h1>hi</h1>');

  const games = await startGames(app);
  t.after(() => games.close());

  for (const url of ['/random/', '/random/index.html']) {
    const res = await games.client.get(url);
    assert.equal(res.status, 404, url);
    await res.text();
  }
});

test('a chat message cannot point at a file', async (t) => {
  const app = await studio(t);
  await makeChat(app);

  const res = await app.client.json('POST', '/api/projects/random/messages', {
    body: { body: 'look at this', context_paths: ['index.html'] },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /no files to point at/);

  const plain = await app.client.json('POST', '/api/projects/random/messages', {
    body: { body: 'hello' },
  });
  assert.equal(plain.status, 201);
  assert.deepEqual(plain.body.context_paths, []);
});

test('an agent in a chat gets no file tools and no file block', async (t) => {
  const llm = createFakeLlm([says('Hello!')]);
  const app = await studio(t, { llm });
  await makeChat(app);
  const agent = await app.client.json('POST', '/api/agents', {
    body: { name: 'Pal', description: 'You are friendly.', file_tools: true },
  });
  await app.client.json('POST', '/api/projects/random/agents', {
    body: { agent_id: agent.body.id, chatty: true },
  });

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await app.client.json('POST', '/api/projects/random/messages', {
    body: { body: 'hi there' },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const call = llm.lastCall();
  assert.equal(call.tools, null, 'file tools are withheld in a chat');
  // No studio preamble in a chat: the agent is exactly what its description
  // says, with nothing layered on top.
  assert.equal(call.system, 'You are friendly.');
  for (const message of call.messages) {
    assert.doesNotMatch(message.content, /PROJECT FILES/);
  }
});

test('a chat agent with no description sends no system prompt at all', async (t) => {
  const llm = createFakeLlm([says('Hi.')]);
  const app = await studio(t, { llm });
  await makeChat(app);
  const agent = await app.client.json('POST', '/api/agents', {
    body: { name: 'Blank', description: '' },
  });
  await app.client.json('POST', '/api/projects/random/agents', {
    body: { agent_id: agent.body.id, chatty: true },
  });

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  const posted = await app.client.json('POST', '/api/projects/random/messages', {
    body: { body: 'hello?' },
  });
  assert.equal(posted.status, 201);
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  // Falsy, which is what keeps the client from sending a system message.
  assert.equal(llm.lastCall().system, '');
});

test('an agent in a game still gets its file tools', async (t) => {
  const llm = createFakeLlm([says('On it.')]);
  const app = await studio(t, { llm });
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const agent = await app.client.json('POST', '/api/agents', {
    body: { name: 'Builder', description: 'You build.', file_tools: true },
  });
  await app.client.json('POST', '/api/projects/tank/agents', {
    body: { agent_id: agent.body.id, chatty: true },
  });

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'make a tank' },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const call = llm.lastCall();
  assert.ok(call.tools?.length, 'a game still offers file tools');
  assert.match(call.system, /PROJECT FILES/);
});
