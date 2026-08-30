// Who may change a game.
//
// Being in the studio lets you read everything and talk to everybody. Changing
// a game takes being one of its authors, or the game being open. The two
// deliberate holes in that rule are tested here too: the human-only chat of
// every game is everyone's, and the author list is authors-only even when the
// game is open to all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, workChat } from './helpers.js';

// Two people: Dann, who makes the game, and Robin, who does not.
async function two(t) {
  const app = await setup();
  t.after(() => app.close());
  const dann = await signIn(app);
  const other = app.newClient();
  const robin = await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: other,
  });
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return { app, dann, robin, theirs: other };
}

const write = (client, path, body = 'hello') => client.put(`/api/projects/tank/files/${path}`, {
  headers: { 'content-type': 'text/plain' }, rawBody: body,
});

test('the person who made a game is its author, and nobody else is', async (t) => {
  const { app, dann } = await two(t);
  const detail = await app.client.json('GET', '/api/projects/tank');
  assert.deepEqual(detail.body.authors.map((a) => a.display_name), ['Dann']);
  assert.equal(detail.body.authors[0].id, dann.id);
  assert.equal(detail.body.mine, true);
  assert.equal(detail.body.can_edit, true);
  assert.equal(detail.body.open_edit, false);
});

test('somebody who is not an author can read everything and change nothing', async (t) => {
  const { app, theirs } = await two(t);

  // Reading is the whole studio's.
  const detail = await theirs.json('GET', '/api/projects/tank');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.mine, false);
  assert.equal(detail.body.can_edit, false);
  assert.equal((await theirs.json('GET', '/api/projects/tank/history')).status, 200);

  // Writing is not.
  const put = await write(theirs, 'index.html');
  assert.equal(put.status, 403);
  assert.match((await put.json()).error, /not yours to change/);

  const renamed = await theirs.json('PATCH', '/api/projects/tank', { body: { name: 'Mine now' } });
  assert.equal(renamed.status, 403);
  const chat = await theirs.json('POST', '/api/projects/tank/chats', { body: { name: 'Mine' } });
  assert.equal(chat.status, 403);
  const published = await theirs.json('POST', '/api/projects/tank/publish', {
    body: { published: true },
  });
  assert.equal(published.status, 403);

  // And the game is untouched by any of it.
  assert.equal((await app.client.json('GET', '/api/projects/tank')).body.name, 'Tank');
});

// ⚠️ The hole in the rule, and the point of it: the studio can always talk.
test('anyone can talk in the human-only chat of any game', async (t) => {
  const { app, theirs } = await two(t);

  const said = await theirs.json('POST', '/api/projects/tank/messages', {
    body: { body: 'this game is great' },
  });
  assert.equal(said.status, 201);
  assert.equal(said.body.user_name, 'Robin');

  // But not in the chat where the work happens.
  const work = await workChat(app, 'tank');
  const nope = await theirs.json('POST', '/api/projects/tank/messages', {
    body: { body: 'let me help', chat_id: work },
  });
  assert.equal(nope.status, 403);
  assert.match(nope.body.error, /Humans only/);
});

test('an author adds somebody, and then they can change it', async (t) => {
  const { app, robin, theirs } = await two(t);

  const added = await app.client.json('POST', '/api/projects/tank/authors', {
    body: { user_id: robin.id },
  });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.authors.map((a) => a.display_name), ['Dann', 'Robin']);

  assert.equal((await write(theirs, 'index.html')).status, 201);
  const work = await workChat(app, 'tank');
  assert.equal(
    (await theirs.json('POST', '/api/projects/tank/messages', {
      body: { body: 'on it', chat_id: work },
    })).status,
    201,
  );
  assert.equal((await theirs.json('GET', '/api/projects/tank')).body.mine, true);
});

test('an open game is everybody’s to change', async (t) => {
  const { app, theirs } = await two(t);
  assert.equal((await write(theirs, 'index.html')).status, 403);

  const opened = await app.client.json('POST', '/api/projects/tank/open', {
    body: { open_edit: true },
  });
  assert.equal(opened.status, 200);

  assert.equal((await write(theirs, 'index.html')).status, 201);
  const detail = await theirs.json('GET', '/api/projects/tank');
  assert.equal(detail.body.can_edit, true);
  assert.equal(detail.body.mine, false, 'editing it does not make it yours');

  // ⚠️ Open is about the work, not about who decides. The author list stays
  // the authors'.
  const grab = await theirs.json('POST', '/api/projects/tank/authors', {
    body: { user_id: 2 },
  });
  assert.equal(grab.status, 403);
  const shut = await theirs.json('POST', '/api/projects/tank/open', {
    body: { open_edit: false },
  });
  assert.equal(shut.status, 403);
});

test('a game keeps at least one author', async (t) => {
  const { app, dann, robin } = await two(t);
  const alone = await app.client.request('DELETE', `/api/projects/tank/authors/${dann.id}`);
  assert.equal(alone.status, 409);
  assert.match((await alone.json()).error, /at least one author/);

  await app.client.json('POST', '/api/projects/tank/authors', { body: { user_id: robin.id } });
  const gone = await app.client.json('DELETE', `/api/projects/tank/authors/${dann.id}`);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.authors.map((a) => a.display_name), ['Robin']);

  // Having removed himself, Dann is now on the outside of it.
  assert.equal((await write(app.client, 'index.html')).status, 403);
});

test('a copy belongs to whoever copied it', async (t) => {
  const { app, robin, theirs } = await two(t);
  await app.client.json('POST', '/api/projects/tank/open', { body: { open_edit: true } });

  const forked = await theirs.json('POST', '/api/projects/tank/fork', {
    body: { name: 'Robin Tank', slug: 'robin-tank' },
  });
  assert.equal(forked.status, 201);
  assert.deepEqual(forked.body.authors.map((a) => a.display_name), ['Robin']);
  assert.equal(forked.body.mine, true);
  assert.equal(forked.body.open_edit, false, 'a copy of an open game is its own game');

  const back = await app.client.json('GET', '/api/projects/robin-tank');
  assert.equal(back.body.can_edit, false, 'and not the original author’s');
  assert.equal(back.body.authors[0].id, robin.id);
});
