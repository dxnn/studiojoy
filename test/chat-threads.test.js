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
    [['Humans only', false], ['Building', true]],
  );
  // The one it opens on when nothing says otherwise is the human-only one.
  assert.equal(detail.body.chat.name, 'Humans only');
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
  assert.deepEqual(list.body.chats.map((c) => c.name), ['Humans only', 'Building', 'Pictures']);

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

  // The game with a history gets three: the human-only one it now opens on;
  // the room the conversation was in, which had a helper of its own in it and
  // so keeps it under `Building with helpers`; and a fresh Building for the
  // builder (server/builder.js, intoBuilderRooms).
  const old = chats.filter((c) => c.project_id === 1);
  assert.deepEqual(
    old.map((c) => [c.name, c.bots, c.builder]),
    [['Humans only', 0, 0], ['Building with helpers', 1, 0], ['Building', 1, 1]],
  );
  const building = old[1];

  // Every message moved with it, and nothing was left without a home.
  const moved = up.prepare('SELECT body, chat_id FROM messages ORDER BY id').all();
  assert.deepEqual(moved.map((m) => m.chat_id), [building.id, building.id]);
  assert.deepEqual(moved.map((m) => m.body), ['make it faster', 'done']);

  // The helper moved into the same chat, keeping its chatty switch, and the
  // old table is gone rather than left to disagree with the new one. The
  // builder sits in the fresh Building, chatty, and nowhere else.
  const joined = up.prepare('SELECT * FROM chat_agents WHERE agent_id = 1').all();
  assert.deepEqual(joined.map((r) => [r.chat_id, r.agent_id, r.chatty]), [[building.id, 1, 1]]);
  const builder = up.prepare('SELECT id FROM agents WHERE builtin = 1').get();
  assert.deepEqual(
    up.prepare('SELECT chat_id, chatty FROM chat_agents WHERE agent_id = ? ORDER BY chat_id')
      .all(builder.id).map((r) => [r.chat_id, r.chatty]),
    [[chats.filter((c) => c.project_id === 2)[1].id, 1], [old[2].id, 1]],
  );
  assert.equal(
    up.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name = 'project_agents'").get().c,
    0,
    'the old table is dropped, not left behind',
  );

  // A project nobody ever talked in gets both as well. It has nothing to
  // carry, so its empty Building becomes the builder's in place.
  assert.deepEqual(
    chats.filter((c) => c.project_id === 2).map((c) => [c.name, c.bots, c.builder]),
    [['Humans only', 0, 0], ['Building', 1, 1]],
  );

  // Opening it again changes nothing: the upgrade is not a thing that runs
  // twice.
  up.close();
  const again = openDb(file);
  assert.equal(again.prepare('SELECT COUNT(*) c FROM chats').get().c, chats.length);
  again.close();
});

// The shape a studio was left in by the first version of the upgrade above: a
// game that had never been talked in came forward with only its human-only
// chat, so there was nowhere in it a helper could ever be put. Reopening the
// database is what fixes it — there is no repair script.
test('a game left without a chat that takes helpers gets one, and Just us is renamed', (t) => {
  const dir = scratchDir('one-chat-db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'db');

  const first = openDb(file);
  first.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, created_at)
     VALUES (1, 'a@b.c', 'x', 'Dann', '2026-01-01T00:00:00.000Z')`,
  ).run();
  first.prepare(
    `INSERT INTO projects (id, slug, name, kind, created_by, created_at)
     VALUES (1, 'quiet', 'Never Used', 'game', 1, '2026-01-01T00:00:00.000Z')`,
  ).run();
  // Exactly what the old upgrade left behind, old name and all.
  first.prepare(
    `INSERT INTO chats (project_id, name, bots, created_at)
     VALUES (1, 'Just us', 0, '2026-01-01T00:00:00.000Z')`,
  ).run();
  first.close();

  const up = openDb(file);
  const chats = up.prepare('SELECT name, bots FROM chats WHERE project_id = 1 ORDER BY id').all();
  assert.deepEqual(
    chats.map((c) => [c.name, c.bots]),
    [['Humans only', 0], ['Building', 1]],
  );
  up.close();

  // And not a second Building on the way back through.
  const again = openDb(file);
  assert.equal(again.prepare('SELECT COUNT(*) c FROM chats WHERE project_id = 1').get().c, 2);
  again.close();
});

/* A chat project is one room ------------------------------------------------
   A game's two chats are a game's shape: a front door for the people and a
   workshop behind it. A project that is only a conversation has no workshop
   to be behind, so it is one room — and helpers are allowed in it, because
   calling one in by name is the point of having a room at all. */

async function room(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const made = await app.client.json('POST', '/api/projects', {
    body: { name: 'Silly ideas', slug: 'silly-ideas', kind: 'chat' },
  });
  return { app, made };
}

test('a chat project is born with one room, named after itself', async (t) => {
  const { app, made } = await room(t);
  assert.deepEqual(made.body.chats.map((c) => [c.name, c.bots]), [['Silly ideas', true]]);
  assert.equal(made.body.chat.name, 'Silly ideas');

  const detail = await app.client.json('GET', '/api/projects/silly-ideas');
  assert.equal(detail.body.chats.length, 1);
  assert.equal(detail.body.chat.bots, true, 'a helper can be called into it');
});

test('a chat project takes no second chat', async (t) => {
  const { app } = await room(t);
  const extra = await app.client.json('POST', '/api/projects/silly-ideas/chats', {
    body: { name: 'Serious ideas' },
  });
  assert.equal(extra.status, 409);
  assert.match(extra.body.error, /one chat/);
  assert.equal(
    (await app.client.json('GET', '/api/projects/silly-ideas/chats')).body.chats.length,
    1,
  );
});

// Nobody named the room separately and nothing shows the two names apart, so
// leaving the old one in the database would only ever be a lie to read later.
test('renaming a chat project renames its room', async (t) => {
  const { app } = await room(t);
  await app.client.json('PATCH', '/api/projects/silly-ideas', {
    body: { name: 'Sillier ideas' },
  });
  const detail = await app.client.json('GET', '/api/projects/silly-ideas');
  assert.equal(detail.body.chat.name, 'Sillier ideas');
});

// The shape every chat project made before this has: the human-only front door
// every project used to get, and Building behind it, which is where everything
// anybody said actually is.
test('a chat project that was born with two chats comes forward as one room', (t) => {
  const dir = scratchDir('one-room-db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'db');

  const first = openDb(file);
  first.exec(`
    INSERT INTO users (id, email, password_hash, display_name, created_at)
      VALUES (1, 'a@b.c', 'x', 'Dann', '2026-01-01T00:00:00.000Z');
    INSERT INTO agents (id, name, description, created_by, created_at)
      VALUES (1, 'Alice', 'builds', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO projects (id, slug, name, kind, created_by, created_at)
      VALUES (1, 'ideas', 'Silly ideas', 'chat', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO chats (id, project_id, name, bots, created_at)
      VALUES (1, 1, 'Humans only', 0, '2026-01-01T00:00:00.000Z'),
             (2, 1, 'Building', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO messages (id, project_id, chat_id, user_id, body, created_at)
      VALUES (1, 1, 1, 1, 'said at the door', '2026-01-02T00:00:00.000Z'),
             (2, 1, 2, 1, 'said inside', '2026-01-02T00:01:00.000Z'),
             (3, 1, 1, 1, 'said at the door again', '2026-01-02T00:02:00.000Z');
    INSERT INTO mentions (message_id, user_id, chat_id, project_id, created_at)
      VALUES (2, 1, 2, 1, '2026-01-02T00:01:00.000Z');
    INSERT INTO chat_agents (chat_id, agent_id, chatty, attached_by, attached_at)
      VALUES (2, 1, 1, 1, '2026-01-02T00:00:00.000Z');
  `);
  first.close();

  const up = openDb(file);
  const chats = up.prepare('SELECT * FROM chats WHERE project_id = 1').all();
  // The oldest is the survivor — it is the one every remembered ?chat= and
  // every prefs entry already points at — and it wears the project's name.
  assert.deepEqual(chats.map((c) => [c.id, c.name, c.bots]), [[1, 'Silly ideas', 1]]);

  // Everything said in either room is in the one room, in the order it was
  // said: ids are global and climb with time.
  assert.deepEqual(
    up.prepare('SELECT body, chat_id FROM messages ORDER BY id').all()
      .map((m) => [m.body, m.chat_id]),
    [['said at the door', 1], ['said inside', 1], ['said at the door again', 1]],
  );
  // The marks and the helpers moved with them; nothing was deleted but the
  // empty room.
  assert.deepEqual(up.prepare('SELECT chat_id FROM mentions').all().map((m) => m.chat_id), [1]);
  assert.deepEqual(
    up.prepare('SELECT chat_id, agent_id, chatty FROM chat_agents').all()
      .map((r) => [r.chat_id, r.agent_id, r.chatty]),
    [[1, 1, 1]],
  );
  up.close();

  // And it does not run twice: intoChats must not put Building back.
  const again = openDb(file);
  assert.equal(again.prepare('SELECT COUNT(*) c FROM chats WHERE project_id = 1').get().c, 1);
  again.close();
});

// A game is untouched by any of it: two chats is the shape a game wants.
test('a game keeps both of its chats through the upgrade', (t) => {
  const dir = scratchDir('game-two-chats-db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'db');

  const first = openDb(file);
  first.exec(`
    INSERT INTO users (id, email, password_hash, display_name, created_at)
      VALUES (1, 'a@b.c', 'x', 'Dann', '2026-01-01T00:00:00.000Z');
    INSERT INTO projects (id, slug, name, kind, created_by, created_at)
      VALUES (1, 'tank', 'Tank', 'game', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO chats (id, project_id, name, bots, created_at)
      VALUES (1, 1, 'Humans only', 0, '2026-01-01T00:00:00.000Z'),
             (2, 1, 'Building', 1, '2026-01-01T00:00:00.000Z');
  `);
  first.close();

  const up = openDb(file);
  assert.deepEqual(
    up.prepare('SELECT name, bots FROM chats WHERE project_id = 1 ORDER BY id').all()
      .map((c) => [c.name, c.bots]),
    [['Humans only', 0], ['Building', 1]],
  );
  up.close();
});
