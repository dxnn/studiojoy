// The studio's announcements (spec/ §3, §6, server/announcements.js): one room
// for the whole studio, pinned over the sidebar, where an admin says things
// and everybody reads and reacts — and hears, even with the bell off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';
import { createUser } from '../server/auth.js';
import { ensureAnnouncements } from '../server/announcements.js';
import { makeKeys } from '../server/push.js';
import { subscribe, audience, tell } from '../server/notify.js';

const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

// Dann is the first account, so the admin; Robin is in the studio and not.
async function two(t) {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  const theirs = app.newClient();
  const robin = await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: theirs,
  });
  const room = (await app.client.json('GET', '/api/projects')).body.find((p) => p.announce);
  return { app, theirs, robin, room };
}

const post = (client, slug, body) => client.json('POST', `/api/projects/${slug}/messages`, { body: { body } });

test('a studio has its announcements from its first account: one room, no helpers', async (t) => {
  const { app, room } = await two(t);
  assert.ok(room, 'in the list, flagged');
  assert.equal(room.kind, 'chat');
  assert.equal(room.name, 'Announcements');
  const open = (await app.client.json('GET', `/api/projects/${room.slug}`)).body;
  assert.deepEqual(open.chats.map((c) => [c.name, c.bots]), [['Announcements', false]]);
  // Made once: asking again, or a game already called Announcements, makes
  // no second one.
  assert.equal(ensureAnnouncements(app.db), null);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE announce = 1').get().n, 1);
});

test('a game somebody called Announcements first keeps its slug', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const db = app.db;
  // A studio from before the room: a person and their game, no announcements.
  db.prepare("INSERT INTO users (email, password_hash, display_name, admin, created_at) VALUES ('a@example.com', 'x', 'A', 1, '2026-01-01')").run();
  db.prepare("INSERT INTO projects (slug, name, created_by, created_at) VALUES ('announcements', 'Announcements', 1, '2026-01-01')").run();
  assert.equal(ensureAnnouncements(db), 'announcements-2');
});

test('only an admin says things in it, and everybody can react', async (t) => {
  const { app, theirs, room } = await two(t);
  const said = await post(app.client, room.slug, 'Pizza on Friday');
  assert.equal(said.status, 201);

  const refused = await post(theirs, room.slug, 'can I come');
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /only an admin/);
  assert.equal((await theirs.json('GET', `/api/projects/${room.slug}`)).body.can_edit, false);

  const reacted = await theirs.json('POST', `/api/messages/${said.body.id}/reactions/toggle`, { body: { emoji: '🍕' } });
  assert.equal(reacted.status, 200);
});

test('nobody puts it away, renames it but an admin, or puts a helper in it', async (t) => {
  const { app, theirs, room } = await two(t);
  assert.equal((await app.client.json('POST', `/api/projects/${room.slug}/archive`)).status, 409);
  assert.equal((await theirs.json('PATCH', `/api/projects/${room.slug}`, { body: { name: 'Mine' } })).status, 403);
  assert.equal((await app.client.json('PATCH', `/api/projects/${room.slug}`, { body: { name: 'News' } })).status, 200);
  const agent = (await app.client.json('POST', '/api/agents', { body: { name: 'Bot', description: 'helps' } })).body;
  const chat = (await app.client.json('GET', `/api/projects/${room.slug}`)).body.chat;
  const put = await app.client.json('POST', `/api/projects/${room.slug}/chats/${chat.id}/agents`, { body: { agent_id: agent.id } });
  assert.ok(put.status >= 400, `no helper goes in (${put.status})`);
});

// ⚠️ The bell off is not silence any more: the browser is kept, marked, and
// told what is said in the announcements and nothing else.
test('a bell that is off hears the announcements and nothing else', async (t) => {
  const { app, robin, room } = await two(t);
  const sam = createUser(app.db, { email: 'sam@example.com', password: 'hunter2', displayName: 'Sam' });
  subscribe(app.db, robin.id, { endpoint: 'https://push.test/robin', ...KEYS, announcementsOnly: true });
  subscribe(app.db, sam.id, { endpoint: 'https://push.test/sam', ...KEYS });

  const ends = (rows) => rows.map((r) => r.endpoint).sort();
  assert.deepEqual(ends(audience(app.db, null)), ['https://push.test/sam']);
  assert.deepEqual(ends(audience(app.db, null, { announcement: true })), ['https://push.test/robin', 'https://push.test/sam']);

  const reached = async (slug) => {
    const urls = [];
    await tell(app.db, { ...await makeKeys(), subject: 'mailto:s@example.com' }, {
      project_slug: slug, chat_id: 1, user_id: null, agent_id: null, body: 'hello',
    }, async (url) => { urls.push(url); return { status: 201 }; });
    return urls.sort();
  };
  assert.deepEqual(await reached(room.slug), ['https://push.test/robin', 'https://push.test/sam']);
  assert.deepEqual(await reached('tank'), ['https://push.test/sam']);

  // Turning the bell back on is the same endpoint, everything again.
  subscribe(app.db, robin.id, { endpoint: 'https://push.test/robin', ...KEYS });
  assert.equal(audience(app.db, null).length, 2);
});
