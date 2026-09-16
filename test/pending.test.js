// The pending commit (spec.md §5, server/files/pending.js): a save reaches the
// tree at once and history later, as one commit for the run — and always
// before anybody else's commit, a helper's fire, or anything that reads the
// tree into history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  setup, signIn, openStream, startGames, builderChat, scratchDir,
} from './helpers.js';
import { createFakeLlm, calls, says } from './fake-llm.js';
import { createMutex } from '../server/files/mutex.js';
import { createPending } from '../server/files/pending.js';
import { initRepo, logCommits, currentSha } from '../server/files/git.js';
import { WRAPPER_PATH } from '../server/reporter.js';

async function project(t, opts = {}) {
  const app = await setup(opts);
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return { app, dir: path.join(app.gamesDir, 'tank') };
}

const save = (app, p, body, client = app.client) =>
  client.json('PUT', `/api/projects/tank/files/${p}`, { rawBody: body });
const commit = (app) => app.client.json('POST', '/api/projects/tank/commit');
const subjects = async (dir) => (await logCommits(dir)).map((c) => c.subject);

test('a run of saves is one version, in the words of what it did', async (t) => {
  const { app, dir } = await project(t);
  await save(app, 'js/story.js', 'one');
  await save(app, 'js/story.js', 'two');
  await save(app, 'config/words.js', 'title');
  assert.deepEqual(await subjects(dir), ['init tank'], 'nothing has landed');
  assert.equal(fs.readFileSync(path.join(dir, 'js/story.js'), 'utf8'), 'two');

  const landed = await commit(app);
  const [head] = await logCommits(dir);
  assert.equal(head.sha, landed.body.commit);
  assert.equal(head.subject, 'create 2 files');
  assert.deepEqual(head.paths.sort(), ['config/words.js', 'js/story.js']);
  assert.equal(head.author, 'Dann');
});

test('created then edited is still a create; edited alone is an update', async (t) => {
  const { app, dir } = await project(t);
  await save(app, 'a.txt', 'a');
  await save(app, 'a.txt', 'aa');
  await commit(app);
  await save(app, 'a.txt', 'aaa');
  await save(app, 'a.txt', 'aaaa');
  await commit(app);
  assert.deepEqual(await subjects(dir), ['update a.txt', 'create a.txt', 'init tank']);
});

test('the idle timer lands it', async (t) => {
  // Straight at the module with a short clock: the routes keep the real 45 s.
  const dir = scratchDir('pending');
  const author = { name: 'Dann', email: 'dann@example.com' };
  await initRepo(dir, { author, slug: 'tank' });
  const mutex = createMutex();
  const pending = createPending({ mutex, idleMs: 40 });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  await mutex.run('tank', () => pending.note('tank', dir, {
    projectId: 1, path: 'a.txt', action: 'create', author,
  }));
  assert.equal(pending.has('tank'), true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(pending.has('tank'), false);
  assert.equal((await logCommits(dir))[0].subject, 'create a.txt');
});

test("somebody else saving lands the first person's window first", async (t) => {
  const { app, dir } = await project(t);
  // A new game is open, so a second account may write to it.
  const other = app.newClient();
  await signIn(app, { email: 'qiby@example.com', displayName: 'Qiby', client: other });

  await save(app, 'a.txt', 'dann');
  await save(app, 'b.txt', 'qiby', other);
  let commits = await logCommits(dir);
  assert.deepEqual([commits[0].subject, commits[0].author], ['create a.txt', 'Dann']);
  assert.equal(commits.length, 2, "Qiby's is still open");

  await commit(app);
  commits = await logCommits(dir);
  assert.deepEqual([commits[0].subject, commits[0].author], ['create b.txt', 'Qiby']);
});

test("a helper's turn lands the person's saves first, under their name", async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'write_file', input: { path: 'js/game.js', content: 'helper' } }],
      { text: 'Writing.' }),
    says('Done.'),
  ]);
  const { app, dir } = await project(t, { llm });
  const chatId = await builderChat(app, 'tank');
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await save(app, 'js/story.js', 'typed by a person');
  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: 'build it', chat_id: chatId },
  });
  await stream.waitFor((e) => e.event === 'agent.stream.end');

  const commits = await logCommits(dir);
  assert.deepEqual(commits.slice(0, 2).map((c) => [c.subject, c.author]), [
    ['Builder: Done.', 'Builder'],
    ['create js/story.js', 'Dann'],
  ]);
  // And every commit, whoever made it, is announced as a version.
  const versions = stream.events.filter((e) => e.event === 'version.new');
  assert.deepEqual(versions.map((e) => e.data.sha), [commits[1].sha, commits[0].sha]);
});

test('a move, a delete and a fork see the saves that came before them', async (t) => {
  const { app, dir } = await project(t);
  await save(app, 'a.txt', 'a');
  await save(app, 'b.txt', 'b');
  // `git mv` cannot move what history has not seen: the window lands first.
  const moved = await app.client.json('POST', '/api/projects/tank/files/move', {
    body: { from: 'a.txt', to: 'c.txt' },
  });
  assert.equal(moved.status, 200);
  assert.deepEqual(await subjects(dir), ['move a.txt to c.txt', 'create 2 files', 'init tank']);

  await save(app, 'c.txt', 'c2');
  const removed = await app.client.json('DELETE', '/api/projects/tank/files/b.txt');
  assert.equal(removed.status, 200);
  assert.deepEqual((await subjects(dir)).slice(0, 2), ['delete b.txt', 'update c.txt']);

  await save(app, 'c.txt', 'c3');
  const forked = await app.client.json('POST', '/api/projects/tank/fork', {
    body: { name: 'Tank Two', slug: 'tank-two' },
  });
  assert.equal(forked.status, 201);
  assert.equal(
    fs.readFileSync(path.join(app.gamesDir, 'tank-two', 'c.txt'), 'utf8'), 'c3',
    'the fork has the line typed a moment ago',
  );
  assert.equal((await subjects(dir))[0], 'update c.txt');
});

test('a restore and a rollback are undoable back to what was just typed', async (t) => {
  const { app, dir } = await project(t);
  await save(app, 'game.js', 'v1');
  await commit(app);
  await save(app, 'game.js', 'v2 typed a moment ago');
  const [first] = (await logCommits(dir)).filter((c) => c.subject === 'create game.js');

  const res = await app.client.json('POST', '/api/projects/tank/restore', {
    body: { sha: first.sha, path: 'game.js' },
  });
  assert.equal(res.status, 200);
  assert.equal(fs.readFileSync(path.join(dir, 'game.js'), 'utf8'), 'v1');
  const [restore, typed] = await logCommits(dir);
  assert.match(restore.subject, /^restore game\.js/);
  assert.equal(typed.subject, 'update game.js');
  const kept = await app.client.request('GET', `/api/projects/tank/history/${typed.sha}/game.js`);
  assert.equal(await kept.text(), 'v2 typed a moment ago');
});

test('the preview wears the saves it runs, and their problems follow them into the commit', async (t) => {
  const { app, dir } = await project(t);
  const games = await startGames(app);
  t.after(() => games.close());
  await save(app, 'index.html', '<!doctype html><h1>Tank</h1>');
  const head = await currentSha(dir);

  // Stamped as HEAD plus the one save on top of it.
  const wrapper = await (await games.client.request('GET', `/tank/${WRAPPER_PATH}`)).text();
  assert.match(wrapper, new RegExp(`version = '${head}:1'`));

  const report = (version, message) => app.client.json('POST', '/api/projects/tank/errors', {
    body: { version, errors: [{ message, location: 'js/game.js:1' }] },
  });
  // A report from that preview is taken; one from the game as it was before
  // the save is not.
  const filed = await report(`${head}:1`, 'boom');
  assert.deepEqual(filed.body.errors.map((e) => e.message), ['boom']);
  const stale = await report(head, 'old');
  assert.deepEqual(stale.body.errors.map((e) => e.message), ['boom']);
  const opened = await app.client.json('GET', '/api/projects/tank');
  assert.deepEqual(opened.body.errors.map((e) => e.message), ['boom'], 'a reload mid-edit sees it');

  // The save lands: the problem is now the commit's, and the preview — still
  // running those bytes under the old stamp — is still heard.
  const landed = await commit(app);
  const after = await app.client.json('GET', '/api/projects/tank');
  assert.deepEqual(after.body.errors.map((e) => e.message), ['boom']);
  const late = await report(`${head}:1`, 'boom');
  assert.equal(late.body.errors[0].times, 2);
  const rewrapped = await (await games.client.request('GET', `/tank/${WRAPPER_PATH}`)).text();
  assert.match(rewrapped, new RegExp(`version = '${landed.body.commit}'`));

  // A new save opens a new window, and the old stamp is history again.
  await save(app, 'index.html', '<!doctype html><h1>Tank!</h1>');
  const gone = await report(`${head}:1`, 'boom');
  assert.deepEqual(gone.body.errors, [], 'the next save started the list afresh');
});

test('archiving lands what the game owes, and the commit route minds the rules', async (t) => {
  const { app, dir } = await project(t);
  await save(app, 'a.txt', 'a');
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });
  assert.deepEqual(await subjects(dir), ['create a.txt', 'init tank']);
  assert.equal((await commit(app)).status, 409, 'archived: nothing to land, nothing to press');
});
