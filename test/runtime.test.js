import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  setup, signIn, startGames, openStream, builderChat,
} from './helpers.js';
import { createFakeLlm, says } from './fake-llm.js';
import { WRAPPER_PATH } from '../server/reporter.js';
import { currentSha } from '../server/files/git.js';
import { MAX_ERRORS_PER_PROJECT } from '../server/runtime.js';

// A studio with a game, and optionally the builder's room to talk in.
async function studio(t, { llm = null, agent = false } = {}) {
  const app = await setup({ llm });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  if (agent) app.chatId = await builderChat(app, 'tank');
  return { app, dir: path.join(app.gamesDir, 'tank') };
}

// The person's message as the builder's fire saw it. The fire extends the
// sizing's exchange (spec.md §8), so the last two turns are the sizing's
// answer and `[studio] Go ahead.`, and the message — with what rode on it —
// is the one before those.
const asked = (call) => call.messages.at(-3).content;

// A report is filed against the commit the game's bytes came from, which for
// a test is simply HEAD unless it says otherwise.
async function report(app, errors, { slug = 'tank', version } = {}) {
  const at = version ?? await currentSha(path.join(app.gamesDir, slug));
  return app.client.json('POST', `/api/projects/${slug}/errors`, {
    body: { version: at, errors },
  });
}

// Committed at once: these tests are about versions, and a save on its own is
// not one yet (files/pending.js — test/pending.test.js covers the stamp a
// preview wears while a save waits).
const put = async (app, p, body) => {
  const res = await app.client.json('PUT', `/api/projects/tank/files/${p}`, { rawBody: body });
  await app.client.json('POST', '/api/projects/tank/commit');
  return res;
};

/* The reporter, on the games origin ---------------------------------------- */

test('the wrapper is the game with the reporter and its commit injected', async (t) => {
  const { app, dir } = await studio(t);
  const games = await startGames(app);
  t.after(() => games.close());
  await put(app, 'index.html', '<!doctype html>\n<head><title>Tank</title></head>\n<h1>Tank</h1>');

  const res = await games.client.request('GET', `/tank/${WRAPPER_PATH}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.text();

  // The game is intact and the reporter runs before its first script.
  assert.match(body, /<h1>Tank<\/h1>/);
  assert.ok(body.indexOf('postMessage') < body.indexOf('<h1>'));
  assert.match(body, /window\.parent === window/, 'it does nothing outside a frame');
  assert.match(body, new RegExp(`version = '${await currentSha(dir)}'`));

  // What the public plays is untouched: no reporter, no injection at all.
  const played = await games.client.request('GET', '/tank/');
  assert.doesNotMatch(await played.text(), /postMessage/);
});

test('the wrapper needs a real game with a page in it', async (t) => {
  const { app } = await studio(t);
  const games = await startGames(app);
  t.after(() => games.close());

  // A game with no index.html has nothing to wrap.
  const empty = await games.client.request('GET', `/tank/${WRAPPER_PATH}`);
  assert.equal(empty.status, 404);
  await empty.text();

  await app.client.json('POST', '/api/projects', {
    body: { name: 'Talk', slug: 'talk', kind: 'chat' },
  });
  for (const slug of ['talk', 'nope']) {
    const missing = await games.client.request('GET', `/${slug}/${WRAPPER_PATH}`);
    assert.equal(missing.status, 404, slug);
    await missing.text();
  }
});

// A page with no head and no doctype still has to get the reporter first.
test('the reporter goes in front of a page however it is written', async (t) => {
  const { app } = await studio(t);
  const games = await startGames(app);
  t.after(() => games.close());
  await put(app, 'index.html', '<h1>Tank</h1><script src="js/game.js"></script>');

  const body = await (await games.client.request('GET', `/tank/${WRAPPER_PATH}`)).text();
  assert.ok(body.indexOf('postMessage') < body.indexOf('<h1>'));
});

// The robot's teacher (ideas/dreams.md §4): last on the page, and only here.
test('a game that teaches the robot has js/robot.js loaded in the preview alone', async (t) => {
  const { app } = await studio(t);
  const games = await startGames(app);
  t.after(() => games.close());
  const tag = 'src="js/robot.js"';
  await put(app, 'index.html', '<!doctype html><head></head><body><script src="js/game.js"></script></body>');
  const untaught = await (await games.client.request('GET', `/tank/${WRAPPER_PATH}`)).text();
  assert.ok(!untaught.includes(tag), 'no teacher, nothing loaded');

  await put(app, 'js/robot.js', 'Robot.play(function () { return []; });');
  const body = await (await games.client.request('GET', `/tank/${WRAPPER_PATH}`)).text();
  assert.ok(body.indexOf('src="js/game.js"') < body.indexOf(tag), 'after the game\'s own scripts');
  assert.ok(body.indexOf(tag) < body.indexOf('</body>'));
  const played = await (await games.client.request('GET', '/tank/')).text();
  assert.ok(!played.includes(tag), 'nobody playing the game loads it');
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
  const res = await app.client.json('POST', '/api/projects/talk/errors', {
    body: { errors: [{ message: 'boom', location: '' }] },
  });
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

  await put(app, 'index.html', '<html><h1>Tank</h1></html>');
  await report(app, [
    { message: 'TypeError: sprite is undefined', location: 'js/game.js:41' },
  ]);
  await report(app, [
    { message: 'TypeError: sprite is undefined', location: 'js/game.js:41' },
  ]);

  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'why is it broken', chat_id: app.chatId },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'I see it.');

  const sent = asked(llm.lastCall());
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

  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'and now?', chat_id: app.chatId },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'All quiet now.');
  assert.doesNotMatch(asked(llm.lastCall()), /PROBLEMS THE RUNNING GAME/);
});

// The whole point of injecting: a problem is filed against the code that
// caused it, so a report that arrives after the fix is not the fix's problem.
test('a report from a version that has been replaced is dropped', async (t) => {
  const { app, dir } = await studio(t);
  await put(app, 'js/game.js', 'broken()');
  const before = await currentSha(dir);

  await put(app, 'js/game.js', 'fixed()');
  const late = await report(app, [
    { message: 'TypeError: sprite is undefined', location: 'js/game.js:41' },
  ], { version: before });
  assert.equal(late.status, 200);
  assert.deepEqual(late.body.errors, [], 'it belongs to code that is gone');

  // A report with no version at all is still taken, at HEAD.
  const plain = await app.client.json('POST', '/api/projects/tank/errors', {
    body: { errors: [{ message: 'still broken', location: 'js/game.js:1' }] },
  });
  assert.equal(plain.body.errors.length, 1);

  // And a version that is not a commit id is not a version.
  const junk = await report(app, [{ message: 'nope', location: '' }], { version: 'HEAD' });
  assert.equal(junk.body.errors.length, 1, 'nothing new was recorded');
});

test('a game with no problems says nothing about problems', async (t) => {
  const llm = createFakeLlm([says('Sure.')]);
  const { app } = await studio(t, { llm, agent: true });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'make a start', chat_id: app.chatId },
  });
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Sure.');
  assert.doesNotMatch(asked(llm.lastCall()), /PROBLEMS/);
  // Nothing about the reporter reaches the model: it is injected by the
  // server, so an agent has nothing to remember and nothing to get wrong.
  assert.doesNotMatch(llm.lastCall().system, /_studio|reporter/i);
});
