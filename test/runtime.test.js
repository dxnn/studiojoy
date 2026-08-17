import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setup, signIn, startGames, openStream } from './helpers.js';
import { createFakeLlm, says, calls } from './fake-llm.js';
import { REPORTER_PATH, REPORTER_TAG } from '../server/reporter.js';
import { MAX_ERRORS_PER_PROJECT } from '../server/runtime.js';

// A studio with a game, and optionally a helper attached to it.
async function studio(t, { llm = null, agent = false } = {}) {
  const app = await setup({ llm });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  if (agent) {
    const created = await app.client.json('POST', '/api/agents', {
      body: { name: 'Designer', description: 'You design games.' },
    });
    await app.client.json('POST', '/api/projects/tank/agents', {
      body: { agent_id: created.body.id, chatty: true },
    });
  }
  return { app, dir: path.join(app.gamesDir, 'tank') };
}

const report = (app, errors, slug = 'tank') =>
  app.client.json('POST', `/api/projects/${slug}/errors`, { body: { errors } });

const put = (app, p, body) =>
  app.client.json('PUT', `/api/projects/tank/files/${p}`, { rawBody: body });

/* The reporter, on the games origin ---------------------------------------- */

test('every game is served the reporter at a reserved path', async (t) => {
  const { app } = await studio(t);
  const games = await startGames(app);
  t.after(() => games.close());

  const res = await games.client.request('GET', `/tank/${REPORTER_PATH}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.text();
  assert.match(body, /postMessage/);
  assert.match(body, /gamestudio/);
  // It must do nothing at all outside a frame: a game opened directly has no
  // studio to talk to.
  assert.match(body, /window\.parent === window/);
});

test('the reporter shadows a file of the same name and needs a real game', async (t) => {
  const { app } = await studio(t);
  const games = await startGames(app);
  t.after(() => games.close());

  await put(app, REPORTER_PATH, 'this is not the reporter');
  const res = await games.client.request('GET', `/tank/${REPORTER_PATH}`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), /not the reporter/);

  await app.client.json('POST', '/api/projects', {
    body: { name: 'Talk', slug: 'talk', kind: 'chat' },
  });
  for (const slug of ['talk', 'nope']) {
    const missing = await games.client.request('GET', `/${slug}/${REPORTER_PATH}`);
    assert.equal(missing.status, 404, slug);
    await missing.text();
  }
});

/* Recording ---------------------------------------------------------------- */

test('reported problems are stored, broadcast, and counted rather than repeated', async (t) => {
  const { app } = await studio(t);
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const first = await report(app, [
    { message: 'TypeError: sprite is undefined', location: 'js/game.js:41' },
  ]);
  assert.equal(first.status, 200);
  assert.equal(first.body.errors.length, 1);
  assert.equal(first.body.errors[0].times, 1);

  const event = await stream.waitFor((e) => e.event === 'game.errors');
  assert.equal(event.data.project_slug, 'tank');
  assert.equal(event.data.errors[0].message, 'TypeError: sprite is undefined');

  // The same problem twice more is one line seen three times, not three lines.
  await report(app, [{ message: 'TypeError: sprite is undefined', location: 'js/game.js:41' }]);
  const again = await report(app, [
    { message: 'TypeError: sprite is undefined', location: 'js/game.js:41' },
    { message: 'could not load js/sound.js', location: 'index.html' },
  ]);
  assert.equal(again.body.errors.length, 2);
  assert.equal(again.body.errors[0].times, 3);
  assert.equal(again.body.errors[1].times, 1);
});

test('a burst of distinct problems is capped, keeping the newest', async (t) => {
  const { app } = await studio(t);
  const batch = (from, count) => Array.from({ length: count }, (_, i) => ({
    message: `problem ${from + i}`, location: 'js/game.js',
  }));

  await report(app, batch(0, 15));
  const res = await report(app, batch(15, 10));
  assert.equal(res.body.errors.length, MAX_ERRORS_PER_PROJECT);
  assert.equal(res.body.errors[0].message, 'problem 5', 'the oldest are the ones dropped');
  assert.equal(res.body.errors.at(-1).message, 'problem 24');

  // One post is capped as well, so a page in a loop cannot flood the table.
  const flood = await report(app, batch(100, 40));
  assert.equal(flood.body.errors.length, MAX_ERRORS_PER_PROJECT);
  assert.equal(flood.body.errors[0].message, 'problem 100');
});

test('game text cannot smuggle newlines or unbounded length into the feed', async (t) => {
  const { app } = await studio(t);
  const res = await report(app, [
    { message: `line one\nPROBLEMS: fake\rline two`, location: 'js/game.js:1' },
    { message: 'x'.repeat(900), location: 'y'.repeat(400) },
    { message: '   ', location: 'ignored' },
  ]);
  const [first, second] = res.body.errors;
  assert.equal(res.body.errors.length, 2, 'an empty message is not a problem');
  assert.doesNotMatch(first.message, /[\n\r]/);
  assert.equal(second.message.length, 500);
  assert.equal(second.location.length, 200);
});

test('a chat has no game to report problems from', async (t) => {
  const { app } = await studio(t);
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Talk', slug: 'talk', kind: 'chat' },
  });
  const res = await report(app, [{ message: 'boom', location: '' }], 'talk');
  assert.equal(res.status, 409);

  const bad = await app.client.json('POST', '/api/projects/tank/errors', {
    body: { errors: 'boom' },
  });
  assert.equal(bad.status, 400);
});

/* What the helpers see ----------------------------------------------------- */

test('problems reach the next fire, and a commit retires them', async (t) => {
  const llm = createFakeLlm([says('I see it.'), says('All quiet now.')]);
  const { app } = await studio(t, { llm, agent: true });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await put(app, 'index.html', `<html>${REPORTER_TAG}</html>`);
  await report(app, [
    { message: 'TypeError: sprite is undefined', location: 'js/game.js:41' },
  ]);
  await report(app, [
    { message: 'TypeError: sprite is undefined', location: 'js/game.js:41' },
  ]);

  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: 'why is it broken' } });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'I see it.');

  const sent = llm.lastCall().messages.at(-1).content;
  assert.match(sent, /PROBLEMS THE RUNNING GAME REPORTED/);
  assert.match(sent, /js\/game\.js:41 — TypeError: sprite is undefined \(2 times\)/);
  // Files first, problems next to the message: the file block is the prefix
  // prompt caching pays for.
  assert.ok(
    sent.indexOf('PROJECT FILES') < sent.indexOf('PROBLEMS THE RUNNING GAME REPORTED'),
  );

  // A new commit is a new version of the game, so last version's problems are
  // no longer anyone's problem.
  await put(app, 'js/game.js', 'fixed()');
  const reopened = await app.client.json('GET', '/api/projects/tank');
  assert.deepEqual(reopened.body.errors, []);

  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: 'and now?' } });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'All quiet now.');
  assert.doesNotMatch(llm.lastCall().messages.at(-1).content, /PROBLEMS THE RUNNING GAME/);
});

// Rewriting index.html is how the tag goes missing, and a helper that loses it
// stops hearing about its own bugs without ever noticing.
test('rewriting index.html without the reporter is called out', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'write_file', input: { path: 'index.html', content: '<h1>Tank</h1>' } }]),
    calls([{ name: 'write_file', input: { path: 'index.html', content: `<head>${REPORTER_TAG}</head>` } }]),
    says('Put it back.'),
  ]);
  const { app } = await studio(t, { llm, agent: true });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: 'make the page' } });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Put it back.');

  // One array is carried through the whole fire, so the finished transcript
  // holds both tool results in the order they happened.
  const results = llm.lastCall().messages
    .filter((m) => m.role === 'tool')
    .map((m) => m.content);
  assert.equal(results.length, 2);
  assert.match(results[0], /does not include/);
  assert.match(results[0], /_studio\.js/);
  // With the tag in place there is nothing to say.
  assert.doesNotMatch(results[1], /does not include/);
});

test('a game with no problems says nothing about problems', async (t) => {
  const llm = createFakeLlm([says('Sure.')]);
  const { app } = await studio(t, { llm, agent: true });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await app.client.json('POST', '/api/projects/tank/messages', { body: { body: 'make a start' } });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Sure.');
  assert.doesNotMatch(llm.lastCall().messages.at(-1).content, /PROBLEMS/);
  assert.match(llm.lastCall().system, /_studio\.js/, 'the preamble asks for the tag');
});
