// Taking somebody out of the studio, and putting them back.
//
// ⚠️ Removal has no route and no button. `npm run deluser -- <email>` is the
// only way out, `npm run restoreuser -- <email>` the only way back, and both
// go through `removeAccount`/`restoreAccount` in server/auth.js — which is
// what the in-process tests here call.
//
// Removal is one bit — `users.deleted` — never a DELETE. What it has to close:
// their sessions, the login form, the crew list, being named by an @, being
// added to a game, and the admin panel. What it must not touch: their
// messages, the games they author, their allowance, or what they spent. The
// difference between those two lists is what makes the restore give back the
// same person who left.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { setup, signIn, scratchDir } from './helpers.js';
import { openDb } from '../server/db.js';
import {
  createUser, removeAccount, restoreAccount, isLastAdmin,
} from '../server/auth.js';

const run = promisify(execFile);
const del = path.join(import.meta.dirname, '../bin/deluser.js');
const restore = path.join(import.meta.dirname, '../bin/restoreuser.js');

// Dann runs the studio; Robin is in it and makes a game of their own.
async function two(t) {
  const app = await setup();
  t.after(() => app.close());
  const admin = await signIn(app);
  const other = app.newClient();
  const robin = await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: other,
  });
  return { app, admin, robin, theirs: other };
}

test('there is no route that takes somebody out of the studio', async (t) => {
  const { app, robin } = await two(t);
  const res = await app.client.json('DELETE', `/api/admin/users/${robin.id}`);
  assert.equal(res.status, 404, 'the /api catch-all, not a route that refused');
  assert.match(res.body.error, /no such endpoint/);
  // And they are still in it.
  assert.deepEqual(
    (await app.client.json('GET', '/api/admin/studio')).body.people.map((p) => p.display_name),
    ['Dann', 'Robin'],
  );
});

test('removing somebody closes every door and keeps every row', async (t) => {
  const { app, robin, theirs } = await two(t);
  await theirs.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await theirs.json('POST', '/api/projects/tank/messages', { body: { body: 'my game' } });

  assert.equal(removeAccount(app.db, robin.id), 1, 'their one session went with them');

  // Their session is over and the form will not start another one. ⚠️ The
  // refusal is the one an unknown email gets: the login page does not say
  // whether somebody was taken out.
  assert.equal((await theirs.json('GET', '/api/me')).status, 401);
  const again = app.newClient();
  const denied = await again.json('POST', '/api/login', {
    body: { email: 'kid@example.com', password: 'hunter2' },
  });
  assert.equal(denied.status, 401);
  assert.match(denied.body.error, /incorrect email or password/);

  // Out of the crew list, out of the panel, out of the editors of their own
  // game — and not addable back to one.
  assert.deepEqual(
    (await app.client.json('GET', '/api/users')).body.map((u) => u.display_name),
    ['Dann'],
  );
  assert.deepEqual(
    (await app.client.json('GET', '/api/admin/studio')).body.people.map((p) => p.display_name),
    ['Dann'],
  );
  // ⚠️ Their own game is left with no editors at all: the row is kept so the
  // restore can give it back, and until then nobody can change it.
  const detail = await app.client.json('GET', '/api/projects/tank');
  assert.deepEqual(detail.body.authors, []);
  await app.client.json('POST', '/api/projects', { body: { name: 'Mine', slug: 'mine' } });
  assert.equal(
    (await app.client.json('POST', '/api/projects/mine/authors', { body: { user_id: robin.id } }))
      .status,
    404,
  );

  // And nothing was thrown away: the row, the game, the editor row and the
  // message are all still there.
  const row = app.db.prepare('SELECT deleted FROM users WHERE id = ?').get(robin.id);
  assert.equal(row.deleted, 1);
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM project_authors WHERE user_id = ?').get(robin.id).c,
    1,
  );
  const messages = await app.client.json('GET', '/api/projects/tank/messages');
  assert.deepEqual(messages.body.messages.map((m) => m.user_name), ['Robin']);
});

test('restoring gives back the same person, game and all', async (t) => {
  const { app, robin, theirs } = await two(t);
  await theirs.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('PATCH', `/api/admin/users/${robin.id}`, { body: { daily_tokens: 4242 } });
  removeAccount(app.db, robin.id);

  restoreAccount(app.db, robin.id);

  // Their old password still works — nothing touched the hash.
  const back = app.newClient();
  assert.equal(
    (await back.post('/api/login', { email: 'kid@example.com', password: 'hunter2' })).status,
    200,
  );
  const me = await back.json('GET', '/api/me');
  assert.equal(me.body.display_name, 'Robin');

  // The allowance set before they left, and the game they still author.
  const person = (await app.client.json('GET', '/api/admin/studio')).body.people
    .find((p) => p.id === robin.id);
  assert.equal(person.daily_tokens, 4242);
  const detail = await back.json('GET', '/api/projects/tank');
  assert.deepEqual(detail.body.authors.map((a) => a.display_name), ['Robin']);
  assert.equal(detail.body.mine, true);
});

test('a removed name is not a mention, and is one again on the way back', async (t) => {
  const { app, robin, theirs } = await two(t);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });

  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: '@Robin look' } });
  assert.equal((await theirs.json('GET', '/api/projects/tank')).body.mentions, 1);

  removeAccount(app.db, robin.id);
  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: '@Robin again' } });
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM mentions WHERE user_id = ?').get(robin.id).c,
    1,
    'the second @ left nothing; the first one is still there',
  );

  restoreAccount(app.db, robin.id);
  const back = app.newClient();
  await back.post('/api/login', { email: 'kid@example.com', password: 'hunter2' });
  assert.equal((await back.json('GET', '/api/projects/tank')).body.mentions, 1);
  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: '@Robin once more' } });
  assert.equal((await back.json('GET', '/api/projects/tank')).body.mentions, 2);
});

test('a removed address stays theirs — adding it again points at the restore', async (t) => {
  const { app, robin } = await two(t);
  removeAccount(app.db, robin.id);

  const res = await app.client.json('POST', '/api/admin/users', {
    body: { email: 'kid@example.com', display_name: 'Robin', password: 'hunter2' },
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /restoreuser/);

  // And the panel cannot touch them while they are out.
  assert.equal(
    (await app.client.json('PATCH', `/api/admin/users/${robin.id}`, { body: { display_name: 'R' } }))
      .status,
    404,
  );
});

test('the last admin is counted among the people still in the studio', async (t) => {
  const { app, admin, robin } = await two(t);
  assert.equal(isLastAdmin(app.db, admin.id), true);
  assert.equal(isLastAdmin(app.db, robin.id), false, 'they are not an admin at all');

  await app.client.json('PATCH', `/api/admin/users/${robin.id}`, { body: { admin: true } });
  assert.equal(isLastAdmin(app.db, admin.id), false);

  // ⚠️ Removing the second admin makes the first the last one again: a removed
  // admin cannot run anything, so they do not count.
  removeAccount(app.db, robin.id);
  assert.equal(isLastAdmin(app.db, admin.id), true);
  assert.equal(
    (await app.client.json('PATCH', `/api/admin/users/${admin.id}`, { body: { admin: false } }))
      .status,
    409,
    'and the panel will not demote them either',
  );
});

/* The two scripts ------------------------------------------------------- */

function seededDb(dir) {
  const dbPath = path.join(dir, 'studio.db');
  const db = openDb(dbPath);
  createUser(db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });
  createUser(db, { email: 'kid@example.com', password: 'hunter2', displayName: 'Robin' });
  db.close();
  return dbPath;
}

const script = (file, args, dbPath) => run('node', [file, ...args], {
  env: { ...process.env, DB_PATH: dbPath },
});

test('deluser removes and restoreuser puts back', async () => {
  const dbPath = seededDb(scratchDir('deluser'));

  const out = await script(del, ['Kid@Example.com'], dbPath);
  assert.match(out.stdout, /removed Robin/);
  assert.match(out.stdout, /restoreuser -- kid@example\.com/);

  let db = openDb(dbPath);
  assert.equal(db.prepare('SELECT deleted FROM users WHERE email = ?').get('kid@example.com').deleted, 1);
  db.close();

  // Listing says who is out; naming them puts them back.
  const list = await script(restore, [], dbPath);
  assert.match(list.stdout, /Robin <kid@example\.com>/);
  const backOut = await script(restore, ['kid@example.com'], dbPath);
  assert.match(backOut.stdout, /restored Robin/);

  db = openDb(dbPath);
  assert.equal(db.prepare('SELECT deleted FROM users WHERE email = ?').get('kid@example.com').deleted, 0);
  db.close();
});

test('the scripts refuse the last admin, a second removal, and an unknown address', async () => {
  const dbPath = seededDb(scratchDir('deluser'));

  // Dann is the first account, so the only admin.
  await assert.rejects(script(del, ['dann@example.com'], dbPath), /last admin/);

  await script(del, ['kid@example.com'], dbPath);
  await assert.rejects(script(del, ['kid@example.com'], dbPath), /already removed/);
  await assert.rejects(script(restore, ['dann@example.com'], dbPath), /already in the studio/);
  await assert.rejects(script(restore, ['nobody@example.com'], dbPath), /no account/);
  await assert.rejects(script(del, ['nobody@example.com'], dbPath), /no account/);
});

test('a database from before the column upgrades with everybody still in it', () => {
  const dbPath = path.join(scratchDir('deluser'), 'old.db');
  let db = openDb(dbPath);
  createUser(db, { email: 'dann@example.com', password: 'hunter2', displayName: 'Dann' });
  // Back to the shape a studio had before removals were soft.
  db.exec('ALTER TABLE users DROP COLUMN deleted');
  db.close();

  db = openDb(dbPath);
  const row = db.prepare('SELECT deleted FROM users WHERE email = ?').get('dann@example.com');
  assert.equal(row.deleted, 0, 'an existing account is not removed by the upgrade');
  db.close();
});

test('adduser sends a removed address to the restore instead of making a second row', async () => {
  const dbPath = seededDb(scratchDir('deluser'));
  await script(del, ['kid@example.com'], dbPath);

  const add = path.join(import.meta.dirname, '../bin/adduser.js');
  await assert.rejects(script(add, ['kid@example.com', 'Robin'], dbPath), /restoreuser/);

  const db = openDb(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 2);
  db.close();
});
