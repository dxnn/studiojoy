// Who gets told, and the three routes a browser uses to say where it is
// (server/notify.js, server/routes/push.js, spec/ §6). The crypto is
// test/push.test.js; this is the deciding, which is where a mistake would be
// somebody hearing about a conversation they are not in — or not hearing at
// all, which is worse and quieter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';
import { createUser, removeAccount } from '../server/auth.js';
import { makeKeys } from '../server/push.js';
import {
  subscribe, unsubscribe, audience, messageText, tell,
} from '../server/notify.js';

const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};
const sub = (endpoint) => ({ endpoint, ...KEYS });
const person = (db, name) => createUser(db, {
  email: `${name.toLowerCase()}@example.com`, password: 'hunter2', displayName: name,
});
const vapid = async () => ({ ...await makeKeys(), subject: 'mailto:s@example.com' });

/* Who hears -------------------------------------------------------------- */

test('everybody who asked, except whoever spoke', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const robin = person(app.db, 'Robin');
  const sam = person(app.db, 'Sam');
  subscribe(app.db, robin.id, sub('https://push.test/robin'));
  subscribe(app.db, sam.id, sub('https://push.test/sam'));

  assert.deepEqual(
    audience(app.db, robin.id).map((r) => r.endpoint),
    ['https://push.test/sam'],
  );
  // A helper's reply has no user_id at all, so nobody is left out of it.
  assert.equal(audience(app.db, null).length, 2);
});

// Every studio account can see every project (§3) — the broker says the same
// thing — so there is no membership to narrow to. What narrows it is having
// asked, which is what a row means.
test('somebody who never pressed the bell hears nothing', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  person(app.db, 'Robin');
  const sam = person(app.db, 'Sam');
  subscribe(app.db, sam.id, sub('https://push.test/sam'));
  assert.equal(audience(app.db, sam.id).length, 0);
});

test('a player and a removed account are not in the studio to tell', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const robin = person(app.db, 'Robin');
  const player = person(app.db, 'Player');
  const gone = person(app.db, 'Gone');
  subscribe(app.db, player.id, sub('https://push.test/player'));
  subscribe(app.db, gone.id, sub('https://push.test/gone'));
  app.db.prepare('UPDATE users SET studio_access = 0 WHERE id = ?').run(player.id);
  app.db.prepare('UPDATE users SET deleted = 1 WHERE id = ?').run(gone.id);
  assert.deepEqual(audience(app.db, robin.id), []);
});

// ⚠️ Removal drops the rows outright, unlike everything else about an
// account: a push reaches a browser rather than a session, so a row left
// behind keeps telling somebody who has been taken out what was said here.
test('taking somebody out of the studio takes their notifications', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const gone = person(app.db, 'Gone');
  subscribe(app.db, gone.id, sub('https://push.test/gone'));
  removeAccount(app.db, gone.id);
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0,
  );
});

/* One browser, one subscription ------------------------------------------ */

test('a second person on the same browser takes the row over', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const robin = person(app.db, 'Robin');
  const sam = person(app.db, 'Sam');
  subscribe(app.db, robin.id, sub('https://push.test/shared'));
  subscribe(app.db, sam.id, sub('https://push.test/shared'));
  const rows = app.db.prepare('SELECT user_id FROM push_subscriptions').all();
  assert.deepEqual(rows.map((r) => r.user_id), [sam.id], 'one row, and it is the newer person');
});

test('unsubscribing is yours alone', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const robin = person(app.db, 'Robin');
  const sam = person(app.db, 'Sam');
  subscribe(app.db, robin.id, sub('https://push.test/robin'));
  // Sam knows Robin's endpoint and it does them no good.
  assert.equal(unsubscribe(app.db, sam.id, 'https://push.test/robin'), 0);
  assert.equal(unsubscribe(app.db, robin.id, 'https://push.test/robin'), 1);
});

/* What it says ----------------------------------------------------------- */

test('the words are the game, then who said what', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const robin = await signIn(app, { email: 'robin@example.com', displayName: 'Robin' });
  await app.client.post('/api/projects', { name: 'Tank' });
  const said = messageText(app.db, {
    project_slug: 'tank', chat_id: 3, user_id: robin.id, user_name: 'Robin',
    agent_id: null, body: 'look   at\nthe new level',
  });
  assert.deepEqual(said, {
    title: 'Tank', body: 'Robin: look at the new level', slug: 'tank', chat: 3,
  });
});

test('a long message is one line, and a helper is named', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.post('/api/agents', { name: 'Steve', description: 'builds' });
  const { id } = app.db.prepare('SELECT id FROM agents WHERE name = ?').get('Steve');
  const said = messageText(app.db, {
    project_slug: 'nothing-here', chat_id: null, user_id: null, user_name: null,
    agent_id: id, body: 'ha'.repeat(200),
  });
  // Cut at a count of characters and not at a word, so it can land mid-"ha".
  assert.match(said.body, /^Steve: [ah]+…$/);
  assert.ok(said.body.length < 140);
  // A slug that names no project still says something rather than "undefined".
  assert.equal(said.title, 'The studio');
});

/* The routes ------------------------------------------------------------- */

test('with no keys set up, push is a 404 rather than a complaint', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  assert.equal((await app.client.get('/api/push/key')).status, 404);
  const res = await app.client.post('/api/push/subscribe', {
    endpoint: 'https://push.test/x', keys: KEYS,
  });
  assert.equal(res.status, 404);
});

test('a browser subscribes, and gets the key it needs to', async (t) => {
  const push = await vapid();
  const app = await setup({ push });
  t.after(() => app.close());
  const robin = await signIn(app, { email: 'robin@example.com', displayName: 'Robin' });

  const key = await app.client.json('GET', '/api/push/key');
  assert.equal(key.body.public_key, push.publicKey);

  const res = await app.client.post('/api/push/subscribe', {
    endpoint: 'https://push.test/robin', keys: KEYS,
  });
  assert.equal(res.status, 204);
  const row = app.db.prepare('SELECT * FROM push_subscriptions').get();
  assert.equal(row.user_id, robin.id);
  assert.equal(row.p256dh, KEYS.p256dh);

  const off = await app.client.post('/api/push/unsubscribe', {
    endpoint: 'https://push.test/robin',
  });
  assert.equal(off.status, 204);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
});

test('a subscription without its keys is refused', async (t) => {
  const app = await setup({ push: await vapid() });
  t.after(() => app.close());
  await signIn(app);
  for (const body of [
    {},
    { endpoint: 'https://push.test/x' },
    { endpoint: 'https://push.test/x', keys: { p256dh: KEYS.p256dh } },
    { endpoint: `https://push.test/${'x'.repeat(3000)}`, keys: KEYS },
  ]) {
    assert.equal(
      (await app.client.post('/api/push/subscribe', body)).status, 400,
      JSON.stringify(body).slice(0, 60),
    );
  }
});

test('signed out, none of it answers', async (t) => {
  const app = await setup({ push: await vapid() });
  t.after(() => app.close());
  const stranger = app.newClient();
  assert.equal((await stranger.get('/api/push/key')).status, 401);
  assert.equal((await stranger.post('/api/push/subscribe', {
    endpoint: 'https://push.test/x', keys: KEYS,
  })).status, 401);
});

/* The whole way out ------------------------------------------------------ */

test('one message, one encrypted request per browser that asked', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const robin = person(app.db, 'Robin');
  const sam = person(app.db, 'Sam');
  subscribe(app.db, robin.id, sub('https://push.test/robin'));
  subscribe(app.db, sam.id, sub('https://push.test/sam-phone'));
  subscribe(app.db, sam.id, sub('https://push.test/sam-laptop'));

  const seen = [];
  const sent = await tell(app.db, await vapid(), {
    project_slug: 'tank', chat_id: 2, user_id: robin.id, user_name: 'Robin',
    agent_id: null, body: 'look at the new level',
  }, async (url, options) => { seen.push({ url, options }); return { status: 201 }; });

  assert.equal(sent, 2, 'both of Sam’s browsers, and not the person who spoke');
  assert.deepEqual(
    seen.map((r) => r.url).sort(),
    ['https://push.test/sam-laptop', 'https://push.test/sam-phone'],
  );
  // ⚠️ The words never travel in the clear. A push service carries the body
  // and cannot read it, which is why the encryption is worth hand-rolling.
  for (const { options } of seen) {
    assert.equal(options.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(!Buffer.from(options.body).includes('new level'));
  }
});

test('a browser the push service says is gone loses its row', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const sam = person(app.db, 'Sam');
  subscribe(app.db, sam.id, sub('https://push.test/gone'));
  subscribe(app.db, sam.id, sub('https://push.test/here'));

  await tell(app.db, await vapid(), {
    project_slug: 'tank', chat_id: 2, user_id: null, agent_id: null, body: 'hi',
  }, async (url) => ({ status: url.endsWith('/gone') ? 410 : 201 }));

  assert.deepEqual(
    app.db.prepare('SELECT endpoint FROM push_subscriptions').all().map((r) => r.endpoint),
    ['https://push.test/here'],
  );
});

// A push service that is down, or a studio behind a proxy that will not let it
// out, must not cost anybody the message — which is in the thread either way.
test('a push service that will not answer costs nothing', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const sam = person(app.db, 'Sam');
  subscribe(app.db, sam.id, sub('https://push.test/sam'));
  const sent = await tell(app.db, await vapid(), {
    project_slug: 'tank', chat_id: 2, user_id: null, agent_id: null, body: 'hi',
  }, async () => { throw new Error('ENOTFOUND'); });
  assert.equal(sent, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 1);
});

/* Every message, wherever it was made ------------------------------------ */

// ⚠️ Hung on the broker rather than beside each `message.new`, because there
// are three of those and the fourth is the one that would forget.
test('a message broadcast from anywhere is one somebody is told about', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const told = [];
  app.broker.watchMessages((message) => told.push(message));
  app.broker.broadcast('message.new', { project_slug: 'tank', body: 'hello' });
  app.broker.broadcast('version.new', { project_slug: 'tank', sha: 'abc' });
  assert.deepEqual(told, [{ project_slug: 'tank', body: 'hello' }]);
});

test('a person posting really does reach it', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app, { email: 'robin@example.com', displayName: 'Robin' });
  const told = [];
  app.broker.watchMessages((message) => told.push(message));
  const made = await app.client.json('POST', '/api/projects', { body: { name: 'Tank' } });
  const chat = made.body.chats[0].id;
  const said = await app.client.post('/api/projects/tank/messages', {
    chat_id: chat, body: 'hello',
  });
  assert.equal(said.status, 201);
  assert.equal(told.length, 1);
  assert.equal(told[0].body, 'hello');
  assert.equal(told[0].project_slug, 'tank');
});
