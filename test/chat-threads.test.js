// Several conversations in one game, and the one that keeps helpers out.
//
// The rules under test: a project is born with two chats, the first is human
// only and refuses helpers at the door, messages and helpers belong to a chat
// rather than to the project, and a database written before any of this
// existed comes forward with its history intact.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  setup, signIn, openStream, putInChat, workChat, scratchDir,
} from './helpers.js';
import { createFakeLlm, says } from './fake-llm.js';
import { openDb } from '../server/db.js';

async function studio(t, opts = {}) {
  const app = await setup(opts);
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return app;
}

test('a game is born with a human-only chat and one that takes helpers', async (t) => {
  const app = await studio(t);
  const detail = await app.client.json('GET', '/api/projects/tank');

  assert.deepEqual(
    detail.body.chats.map((c) => [c.name, c.bots]),
    [['Just us', false], ['Building', true]],
  );
  // The one it opens on when nothing says otherwise is the human-only one.
  assert.equal(detail.body.chat.name, 'Just us');
  assert.equal(detail.body.chat.bots, false);
});

test('messages belong to the chat they were sent in', async (t) => {
  const app = await studio(t);
  const work = await workChat(app, 'tank');

  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: 'in the home one' } });
  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'in the building one', chat_id: work },
  });

  const home = await app.client.json('GET', '/api/projects/tank');
  assert.deepEqual(home.body.messages.map((m) => m.body), ['in the home one']);
  assert.equal(home.body.messages[0].chat_id, home.body.chat.id);

  const building = await app.client.json('GET', `/api/projects/tank?chat=${work}`);
  assert.deepEqual(building.body.messages.map((m) => m.body), ['in the building one']);

  // And the paged read is the same conversation, not the project's.
  const paged = await app.client.json('GET', `/api/projects/tank/messages?chat=${work}`);
  assert.deepEqual(paged.body.messages.map((m) => m.body), ['in the building one']);
});

test('a chat is made, renamed, and capped', async (t) => {
  const app = await studio(t);
  const made = await app.client.json('POST', '/api/projects/tank/chats', {
    body: { name: 'Art' },
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.bots, true, 'a chat you make takes helpers');

  const renamed = await app.client.json('PATCH', `/api/projects/tank/chats/${made.body.id}`, {
    body: { name: 'Pictures' },
  });
  assert.equal(renamed.body.name, 'Pictures');

  const list = await app.client.json('GET', '/api/projects/tank/chats');
  assert.deepEqual(list.body.chats.map((c) => c.name), ['Just us', 'Building', 'Pictures']);

  for (let i = 0; i < 17; i += 1) {
    const res = await app.client.json('POST', '/api/projects/tank/chats', {
      body: { name: `Chat ${i}` },
    });
    assert.equal(res.status, 201, `chat ${i}`);
  }
  const extra = await app.client.json('POST', '/api/projects/tank/chats', {
    body: { name: 'One too many' },
  });
  assert.equal(extra.status, 409);
  assert.match(extra.body.error, /20 chats/);
});

test("a chat id from another game is not this game's chat", async (t) => {
  const app = await studio(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Snake', slug: 'snake' } });
  const elsewhere = await workChat(app, 'snake');

  const res = await app.client.json('GET', `/api/projects/tank?chat=${elsewhere}`);
  assert.equal(res.status, 404);
  const posted = await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'sneaky', chat_id: elsewhere },
  });
  assert.equal(posted.status, 404);
});

// ⚠️ The point of the whole feature: the room that says nobody is listening.
test('nobody answers in the human-only chat', async (t) => {
  const llm = createFakeLlm([says('I would never.')]);
  const app = await studio(t, { llm });
  const agent = await app.client.json('POST', '/api/agents', {
    body: { name: 'Designer', description: 'You design games.' },
  });
  const work = await workChat(app, 'tank');
  await putInChat(app, 'tank', agent.body.id, { chatty: true, chat_id: work });

  const stream = await openStream(app.client);
  t.after(() => stream.close());

  // A chatty helper, mentioned by name, in the chat it is not in.
  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'anyone there @Designer?' },
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(llm.calls.length, 0, 'no fire from the human-only chat');

  // The same helper answers in its own chat, so it was the room and not the
  // helper that was quiet.
  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'over here @Designer', chat_id: work },
  });
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(reply.data.chat_id, work, 'the reply lands in the chat it was asked in');
  assert.equal(llm.calls.length, 1);
});

test('a helper only sees the conversation it is in', async (t) => {
  const llm = createFakeLlm([says('Only this one.')]);
  const app = await studio(t, { llm });
  const agent = await app.client.json('POST', '/api/agents', {
    body: { name: 'Designer', description: 'You design games.' },
  });
  const work = await workChat(app, 'tank');
  await putInChat(app, 'tank', agent.body.id, { chatty: true, chat_id: work });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'a secret in the human-only chat' },
  });
  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'what shall we build', chat_id: work },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const sent = llm.lastCall().messages.map((m) => m.content).join('\n');
  assert.match(sent, /what shall we build/);
  assert.doesNotMatch(sent, /a secret in the human-only chat/);
});

// The upgrade the real database will take: one thread per project, helpers on
// the project. Built by hand in the old shape in a file, then opened for real.
test('a database from before chats comes forward with its history', (t) => {
  const dir = scratchDir('old-db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT,
      password_hash TEXT, created_at TEXT);
    CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT, description TEXT,
      model TEXT, reasoning INTEGER DEFAULT 0, file_tools INTEGER DEFAULT 1,
      deleted INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT,
      archived INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT);
    CREATE TABLE project_agents (id INTEGER PRIMARY KEY, project_id INTEGER,
      agent_id INTEGER, chatty INTEGER DEFAULT 0, cooldown_until TEXT,
      response_pending INTEGER DEFAULT 0, attached_by INTEGER, attached_at TEXT,
      UNIQUE (project_id, agent_id));
    CREATE TABLE messages (id INTEGER PRIMARY KEY, project_id INTEGER,
      user_id INTEGER, agent_id INTEGER, kind TEXT, body TEXT, created_at TEXT);
    INSERT INTO users (id, email, display_name, password_hash, created_at)
      VALUES (1, 'a@b.c', 'Dann', 'x', '2026-01-01T00:00:00.000Z');
    INSERT INTO agents (id, name, description, created_by, created_at)
      VALUES (1, 'Alice', 'builds', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO projects (id, slug, name, created_by, created_at)
      VALUES (1, 'old', 'Old Game', 1, '2026-01-01T00:00:00.000Z'),
             (2, 'quiet', 'Never Used', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO project_agents (project_id, agent_id, chatty, attached_by, attached_at)
      VALUES (1, 1, 1, 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO messages (project_id, user_id, body, created_at)
      VALUES (1, 1, 'make it faster', '2026-01-02T00:00:00.000Z');
    INSERT INTO messages (project_id, agent_id, body, created_at)
      VALUES (1, 1, 'done', '2026-01-02T00:01:00.000Z');
  `);
  db.close();

  const up = openDb(file);
  const chats = up.prepare('SELECT * FROM chats ORDER BY id').all();

  // The game with a history gets two: the human-only one it now opens on, and
  // Building, which is where the conversation actually was.
  const old = chats.filter((c) => c.project_id === 1);
  assert.deepEqual(old.map((c) => [c.name, c.bots]), [['Just us', 0], ['Building', 1]]);
  const building = old[1];

  // Every message moved with it, and nothing was left without a home.
  const moved = up.prepare('SELECT body, chat_id FROM messages ORDER BY id').all();
  assert.deepEqual(moved.map((m) => m.chat_id), [building.id, building.id]);
  assert.deepEqual(moved.map((m) => m.body), ['make it faster', 'done']);

  // The helper moved into the same chat, keeping its chatty switch, and the
  // old table is gone rather than left to disagree with the new one.
  const joined = up.prepare('SELECT * FROM chat_agents').all();
  assert.deepEqual(joined.map((r) => [r.chat_id, r.agent_id, r.chatty]), [[building.id, 1, 1]]);
  assert.equal(
    up.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name = 'project_agents'").get().c,
    0,
    'the old table is dropped, not left behind',
  );

  // A project nobody ever talked in needs no Building chat.
  assert.deepEqual(
    chats.filter((c) => c.project_id === 2).map((c) => c.name),
    ['Just us'],
  );

  // Opening it again changes nothing: the upgrade is not a thing that runs
  // twice.
  up.close();
  const again = openDb(file);
  assert.equal(again.prepare('SELECT COUNT(*) c FROM chats').get().c, chats.length);
  again.close();
});
