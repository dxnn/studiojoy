// The builder and its room (server/builder.js, spec.md §8, ideas/planner.md):
// the studio's own helper in every game's Building, the sizing call ahead of
// its fires, one fire per piece for a big ask, and a capped trace handed on
// rather than dropped. Against the fake LLM: `completions` answer the sizing
// calls, `script` the fires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  setup, signIn, openStream, putInChat, scratchDir,
} from './helpers.js';
import {
  createFakeLlm, says, calls, answers,
} from './fake-llm.js';
import { logCommits } from '../server/files/git.js';
import { openDb, dropColumnIfPresent } from '../server/db.js';

async function studio(t, { llm = null, ...opts } = {}) {
  const app = await setup({ llm, ...opts });
  t.after(() => app.close());
  await signIn(app);
  const made = await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return {
    app, made: made.body, chatId: made.body.chat.id, dir: path.join(app.gamesDir, 'tank'),
  };
}

const send = (app, chatId, body) => app.client.json('POST', '/api/projects/tank/messages', {
  body: { body, chat_id: chatId },
});
const sized = (answer) => answers(JSON.stringify(answer));
// Build it, pressed: a plan of two or more waits for it (spec.md §8). The
// press costs the builder one short confirmation call before the pieces.
const build = (app, id) => app.client.json('POST', `/api/plans/${id}/build`);
const confirmed = () => answers('{"ok":true}');
const PIECES = [
  { title: 'The page', files: ['index.html', 'css/style.css'], what: 'The page and its styles.' },
  { title: 'Tanks that drive', files: ['js/tank.js', 'js/game.js', 'index.html'], what: 'Two tanks and the loop.' },
];
const write = (p, content = 'x') => ({ name: 'write_file', input: { path: p, content } });
const builderId = (app) => app.db.prepare('SELECT id FROM agents WHERE builtin = 1').get().id;

// The fake, with turns that can be held open or made to fail mid-stream: each
// entry is an array of events, or a function (opts) => async iterable. The
// sizing answers go through createFakeLlm's complete() as they stand.
function scriptedLlm(turns, completions) {
  const llm = createFakeLlm([], completions);
  llm.stream = (opts) => {
    const turn = turns[llm.calls.length] ?? says('');
    llm.calls.push(opts);
    return (async function* generate() {
      if (typeof turn === 'function') yield* turn(opts);
      else for (const event of turn) yield event;
    })();
  };
  return llm;
}

// A turn that waits to be released, and says when it has been reached.
function held(events) {
  let release;
  let reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { reached = resolve; });
  const turn = async function* run() {
    reached();
    await gate;
    yield* events;
  };
  return { turn, release, started };
}

// A turn that thinks past the cap without producing anything.
const capped = async function* run() {
  yield { type: 'reasoning', text: 'design notes: split the screen, walls in a grid. ' };
  const err = new Error('thought too long');
  err.code = 'thinking_cap';
  err.reasoningChars = 35_000;
  throw err;
};

test('a new game is born with the builder in Building, and opens there', async (t) => {
  const { app, made } = await studio(t);
  assert.equal(made.chat.name, 'Building');
  assert.equal(made.chat.builder, true);
  assert.deepEqual(
    made.chats.map((c) => [c.name, c.bots, c.builder]),
    [['Humans only', false, false], ['Building', true, true]],
  );

  const opened = await app.client.json('GET', `/api/projects/tank?chat=${made.chat.id}`);
  assert.deepEqual(
    opened.body.agents.map((a) => [a.name, a.chatty, a.builtin]),
    [['Builder', true, true]],
    'chatty, and marked as the studio\'s so the chip offers nothing',
  );
  // Not on the Crew tab: it is in every Building already and goes nowhere else.
  const crew = await app.client.json('GET', '/api/agents');
  assert.deepEqual(crew.body.map((a) => a.name), []);
  // Humans only is still the one a GET with no ?chat= lands on.
  const home = await app.client.json('GET', '/api/projects/tank');
  assert.equal(home.body.chat.name, 'Humans only');
});

test("the builder's room takes no other helper, and the builder goes nowhere else", async (t) => {
  const { app, chatId } = await studio(t);
  const designer = await app.client.json('POST', '/api/agents', {
    body: { name: 'Designer', description: 'd' },
  });
  const refused = await putInChat(app, 'tank', designer.body.id, { chat_id: chatId });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Builder's/);

  const art = await app.client.json('POST', '/api/projects/tank/chats', { body: { name: 'Art' } });
  const elsewhere = await putInChat(app, 'tank', builderId(app), { chat_id: art.body.id });
  assert.equal(elsewhere.status, 409);
  assert.match(elsewhere.body.error, /only works in Building/);

  // Not by name either: an @ calls people's helpers in, never the studio's.
  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await app.client.json('POST', '/api/projects/tank/messages', {
    body: { body: '@Builder come here', chat_id: art.body.id },
  });
  const posted = await stream.waitFor((e) => e.event === 'message.new' && /come here/.test(e.data.body));
  assert.deepEqual(posted.data.joined ?? [], []);

  // And nothing about it is anybody's to change or take away.
  const changed = await app.client.json('PATCH', `/api/agents/${builderId(app)}`, {
    body: { name: 'Bob' },
  });
  assert.equal(changed.status, 403);
  assert.equal((await app.client.json('DELETE', `/api/agents/${builderId(app)}`)).status, 403);
  assert.equal(app.db.prepare('SELECT name FROM agents WHERE builtin = 1').get().name, 'Builder');
});

test('a helper somebody called Builder is renamed, not removed, when the builder arrives', (t) => {
  const dir = scratchDir('builder-name-db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDb(path.join(dir, 'db'));
  db.exec(`
    INSERT INTO users (id, email, password_hash, display_name, created_at)
      VALUES (1, 'a@b.c', 'x', 'Dann', '2026-01-01T00:00:00.000Z');
    INSERT INTO agents (id, name, description, created_by, created_at)
      VALUES (1, 'Builder', 'theirs', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO projects (id, slug, name, kind, created_by, created_at)
      VALUES (1, 'tank', 'Tank', 'game', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO chats (id, project_id, name, bots, created_at)
      VALUES (1, 1, 'Humans only', 0, '2026-01-01T00:00:00.000Z'),
             (2, 1, 'Level ideas', 1, '2026-01-01T00:00:00.000Z');
  `);
  db.close();

  const up = openDb(path.join(dir, 'db'));
  assert.deepEqual(
    up.prepare('SELECT name, builtin FROM agents ORDER BY id').all().map((a) => [a.name, a.builtin]),
    [['Builder (helper)', 0], ['Builder', 1]],
  );
  // A room the people renamed is theirs and is left alone; the builder gets
  // a fresh Building beside it.
  assert.deepEqual(
    up.prepare('SELECT name, bots, builder FROM chats WHERE project_id = 1 ORDER BY id').all()
      .map((c) => [c.name, c.bots, c.builder]),
    [['Humans only', 0, 0], ['Level ideas', 1, 0], ['Building', 1, 1]],
  );
  up.close();
});

test('a remark is sized as a reply, then answered as one fire', async (t) => {
  const llm = createFakeLlm([says('Done — faster now.')], [sized({ size: 'reply' })]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'make the tanks a bit faster');
  const reply = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(reply.data.body, 'Done — faster now.');

  // One sizing call: the fire's own system prompt with the rules standing in
  // it, no tools, thinking off, JSON asked for, and a short trigger riding the
  // last user message after the words — short because a long last message
  // costs the fire after it half its prompt (spec/ §14).
  assert.equal(llm.asked.length, 1);
  const ask = llm.asked[0];
  assert.equal(ask.thinking, 'none');
  assert.equal(ask.responseFormat, 'json_object');
  assert.equal(ask.tools, undefined);
  assert.match(ask.system, /SIZING\nWhen a \[studio\] message asks you to size the request/);
  const last = ask.messages.at(-1).content;
  assert.ok(last.indexOf('make the tanks a bit faster') < last.indexOf('[studio] Size this request.'));
  assert.ok(!last.includes('JSON only'), 'the rules are in the preamble, not on the message');
  // The fire is the sizing's transcript plus one turn — the same system
  // prompt, the sizing's messages, its answer, a go-ahead — so it extends the
  // sizing's cache prefix instead of diverging from it. The fake keeps the
  // array the loop went on appending to, so only the head is compared.
  const fire = llm.calls[0];
  assert.equal(fire.system, ask.system);
  const n = ask.messages.length;
  assert.deepEqual(fire.messages.slice(0, n), ask.messages);
  assert.deepEqual(fire.messages.slice(n, n + 2), [
    { role: 'assistant', content: '{"size":"reply"}' },
    { role: 'user', content: '[studio] Go ahead.' },
  ]);
  // And thinks at the builder's own level.
  assert.equal(fire.thinking, 'low');
  assert.ok(fire.tools.length > 0, 'file tools, like any fire in a game');
});

// A small ask gets the room for one job, and a real receipt showed why: sized
// small, a fire ran to 24 turns and carried on three times. Past its budget
// what it did is kept and committed, and what is left goes back to the sizing
// with the changed files and its working as notes — a plan for the rest, not
// another twenty-four turns.
test('a small ask that outruns its budget keeps what it did and plans the rest', async (t) => {
  const rest = [
    { title: 'Walls that break', files: ['js/walls.js'], what: 'Walls.' },
    { title: 'The loop', files: ['js/game.js'], what: 'Loop.' },
  ];
  const llm = scriptedLlm([
    calls([write('index.html', '<h1>Tank</h1>')], { text: 'Page first.' }),
    calls([write('js/tank.js', 'drive()')], { text: 'Now the tanks.' }),
    calls([write('js/walls.js', 'walls()')], { text: 'Walls break.' }),
    says(''),
    calls([write('js/game.js', 'loop()')], { text: 'It runs.' }),
    says(''),
  ], [sized({ size: 'reply' }), sized({ size: 'pieces', pieces: rest }), confirmed()]);
  const { app, chatId } = await studio(t, { llm, smallTurns: 2, smallToolCalls: 4 });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  // The small fire, under the small budget its prompt names — the same prompt
  // the sizing shared.
  const reply = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null
    && e.data.kind === null);
  assert.equal(reply.data.body, 'Now the tanks.');
  assert.equal(reply.data.working, true);
  assert.deepEqual(reply.data.writes.map((w) => w.path), ['index.html', 'js/tank.js']);
  assert.match(llm.calls[0].system, /at most 2 turns and 4 tool calls/);
  assert.equal(llm.asked[0].system, llm.calls[0].system);

  await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'system'
    && /bigger than one go/.test(e.data.body));
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  assert.match(card.data.body, /here's the rest in 2 pieces\. Change anything, then press Build it\./);
  assert.equal(card.data.plan.status, 'draft', 'a plan for the rest waits like any plan of two');
  // The second sizing was told what was done, ahead of its ask.
  assert.equal(llm.asked.length, 2);
  const ask = llm.asked[1].messages.at(-1).content;
  assert.match(ask, /Files it changed: .*index\.html/);
  assert.match(ask, /Files it changed: .*js\/tank\.js/);
  assert.match(ask, /Page first\.\n\nNow the tanks\./);
  assert.ok(ask.indexOf('what it said while working') < ask.indexOf('Size this request'));
  assert.match(ask, /Size what is left, not the whole/);

  assert.equal((await build(app, card.data.id)).status, 202);
  await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
  const detail = await app.client.json('GET', `/api/projects/tank?chat=${chatId}`);
  assert.ok(!detail.body.messages.some((m) => m.kind === 'system' && /carrying on/.test(m.body)),
    'the plan is the continuation');
  assert.equal(llm.calls.length, 6);
});

test('still small after an overrun, the builder gets one more go — sized again first', async (t) => {
  const llm = scriptedLlm([
    calls([write('index.html')], { text: 'Page first.' }),
    calls([write('js/tank.js')], { text: 'Now the tanks.' }),
    says('All done — press play.'),
  ], [sized({ size: 'reply' }), sized({ size: 'reply' }), sized({ size: 'reply' })]);
  const { app, chatId } = await studio(t, { llm, smallTurns: 2 });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'system'
    && /bigger than one go/.test(e.data.body));
  await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'system'
    && /carrying on from where they stopped/.test(e.data.body));
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'All done — press play.');
  assert.equal(llm.asked.length, 3, 'the second go was sized too');
  assert.equal(llm.calls.length, 3);
  assert.match(llm.asked[1].messages.at(-1).content, /already began on this/);
  assert.ok(!llm.asked[2].messages.at(-1).content.includes('already began'), 'a fresh fire, a plain ask');
});

test('a sizing answer that will not parse is a small ask', async (t) => {
  const llm = createFakeLlm([says('Here you go.')], [answers('Sure thing, let me build that.')]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await send(app, chatId, 'hello');
  const reply = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(reply.data.body, 'Here you go.');
});

// One change is a plan of one: no draft, no waiting, one fire at the builder's
// own level, and its row behind the card — the card is the reply the thread
// shows, with the piece's headline and the file it changed (spec.md §8).
test('one change is a plan of one piece, run at once behind its card', async (t) => {
  const llm = createFakeLlm([
    calls([write('config/play.js', 'const TANK_SPEED = 200;')], { text: 'Turning it up.' }),
    says('The tanks are faster now.\n\nTry a lap and see if it feels right.'),
  ], [sized({
    size: 'pieces',
    pieces: [{ title: 'Faster tanks', files: ['config/play.js'], what: 'Raise the speed.' }],
  })]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'make the tanks a bit faster');
  // The line under the name names the sizing call first, since it streams
  // nothing of its own (spec.md §9).
  const sizing = await stream.waitFor((e) => e.event === 'agent.tool');
  assert.equal(sizing.data.tool, 'size');
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  assert.equal(card.data.body.split('\n')[0], 'One piece:');
  const row = await stream.waitFor((e) => e.event === 'message.new' && e.data.plan_message_id === card.data.id);
  assert.equal(row.data.body, 'The tanks are faster now.\n\nTry a lap and see if it feels right.');
  const done = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
  // The headline is the closing paragraph; the card's body carries it and the file.
  assert.equal(done.data.plan.pieces[0].note, 'Try a lap and see if it feels right.');
  assert.deepEqual(done.data.plan.pieces[0].writes, ['config/play.js']);
  assert.equal(done.data.body, 'Done:\n1. Faster tanks — config/play.js\n   Try a lap and see if it feels right.');
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[0].thinking, 'low', 'no plan thought for it, so the builder\'s own level');

  // The piece was marked running before its stream began, so the card had a
  // line for the live reply to be born on (spec.md §8); and the write was
  // announced as the file arrived, then again as it ran (§9).
  const running = stream.events.findIndex((e) => e.event === 'plan.update' && e.data.plan.pieces[0].status === 'running');
  const starts = stream.events.map((e, i) => (e.event === 'agent.stream.start' ? i : -1)).filter((i) => i >= 0);
  assert.equal(starts.length, 2, 'the sizing\'s fire, then the piece\'s');
  assert.ok(running > starts[0] && running < starts[1], 'running is told before the piece\'s start');
  const writes = stream.events.filter((e) => e.event === 'agent.tool' && e.data.tool === 'write_file');
  assert.deepEqual(writes.map((w) => w.data.path), ['config/play.js', 'config/play.js']);

  // The card's token note opens its piece's receipt, and its prompt is the
  // piece's: no fire was the card's own.
  const receipt = await app.client.json('GET', `/api/messages/${card.data.id}/receipt`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.breakdown.requests.length, 2);
  assert.equal(receipt.body.breakdown.loop.tool_calls, 1);
  assert.equal(receipt.body.prompt_held, true);
  assert.equal((await app.client.request('GET', `/api/messages/${card.data.id}/prompt`)).status, 200);

  // The thread holds the card and not the row; the row is there by id.
  const detail = await app.client.json('GET', `/api/projects/tank?chat=${chatId}`);
  assert.deepEqual(detail.body.messages.filter((m) => m.agent_id !== null).map((m) => m.kind), ['plan']);
  assert.equal(detail.body.messages.find((m) => m.kind === 'plan').body, done.data.body);
  const opened = await app.client.json('GET', `/api/messages/${row.data.id}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.plan_message_id, card.data.id);
  assert.deepEqual(opened.body.writes.map((w) => w.path), ['config/play.js']);
  assert.equal((await app.client.json('GET', '/api/messages/999999')).status, 404);
});

// The sizing decides how hard the one piece thinks, rather than the person
// deciding a-priori (spec.md §8, §14): a request that names what to change has
// nothing to work out, and `none` and `low` were measured writing the same
// change to the same file. The key only ever turns thinking down — `false`, or
// a sizing that left it off, keeps the builder's own level.
for (const [label, clear, want] of [
  ['clear', true, 'none'],
  ['not clear', false, 'low'],
  ['unsaid', undefined, 'low'],
]) {
  test(`a one-piece ask sized ${label} runs its piece at ${want}`, async (t) => {
    const pieces = [{ title: 'Faster tanks', files: ['config/play.js'], what: 'Raise the speed.' }];
    const llm = createFakeLlm([
      calls([write('config/play.js', 'const TANK_SPEED = 200;')], { text: 'Turning it up.' }),
      says('Done.'),
    ], [sized(clear === undefined
      ? { size: 'pieces', pieces }
      : { size: 'pieces', pieces, clear })]);
    const { app, chatId } = await studio(t, { llm });
    const stream = await openStream(app.client);
    t.after(() => stream.close());

    await send(app, chatId, 'make the tanks a bit faster');
    await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
    assert.equal(llm.calls[0].thinking, want);
  });
}

test('a big ask becomes a plan card and one fire per piece', async (t) => {
  const llm = createFakeLlm([
    calls([write('index.html', '<h1>Tank</h1>'), write('css/style.css', 'body{}')]),
    says(''),
    calls([write('js/tank.js', 'drive()'), write('js/game.js', 'loop()')], { text: 'Tanks drive.' }),
    says(''),
    says('Thanks!'),
  ], [
    sized({
      size: 'pieces', pieces: PIECES,
      summary: 'A tank game for two on one keyboard.', assumptions: ['Arrow keys for one, WASD for the other.'],
    }),
    confirmed(),
    sized({ size: 'reply' }),
  ]);
  const { app, chatId, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');

  // The card first, as a draft: the builder's words, the summary and the
  // assumptions, the checklist — and nothing running until Build it.
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  assert.equal(card.data.body.split('\n')[0], "That's a big one — here's my plan in 2 pieces. Change anything, then press Build it.");
  assert.match(card.data.body, /A tank game for two on one keyboard\./);
  assert.match(card.data.body, /Assuming:\n- Arrow keys for one, WASD for the other\./);
  assert.equal(card.data.plan.status, 'draft');
  assert.equal(card.data.tokens, null, 'nothing has cost anything yet');
  assert.equal((await app.client.json('GET', `/api/messages/${card.data.id}/receipt`)).status, 404,
    'no piece has landed, so nothing to open');
  assert.equal(card.data.plan.summary, 'A tank game for two on one keyboard.');
  assert.deepEqual(card.data.plan.pieces.map((p) => [p.title, p.status]),
    [['The page', 'todo'], ['Tanks that drive', 'todo']]);
  assert.equal(llm.calls.length, 0, 'nothing runs before the press');
  assert.ok(!fs.existsSync(path.join(dir, 'SPEC.md')), 'a blank game has no spec yet');

  // The press: SPEC.md from the plan's words, then one short confirmation the
  // pieces extend — the plan is the card in the transcript already.
  assert.equal((await build(app, card.data.id)).status, 202);
  await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'running');
  const spec = await stream.waitFor((e) => e.event === 'files.changed' && e.data.paths.includes('SPEC.md'));
  assert.deepEqual(spec.data.paths, ['SPEC.md']);

  // Then a row per piece, each with its own files and its own commit, each
  // filed behind the card.
  const first = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null
    && e.data.kind === null && (e.data.writes ?? []).some((w) => w.path === 'index.html'));
  assert.equal(first.data.body, 'Piece 1 of 2: The page', 'a piece with nothing to say still gets its row');
  assert.equal(first.data.plan_message_id, card.data.id);
  const second = await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Tanks drive.');
  assert.deepEqual(second.data.writes.map((w) => w.path), ['js/game.js', 'js/tank.js']);
  const done = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
  assert.equal(done.data.message_id, card.data.id);
  assert.deepEqual(done.data.plan.pieces.map((p) => [p.status, p.message_id, p.note]),
    [['done', first.data.id, 'Piece 1 of 2: The page'], ['done', second.data.id, 'Tanks drive.']]);
  assert.deepEqual(done.data.plan.pieces.map((p) => p.writes),
    [['css/style.css', 'index.html'], ['js/game.js', 'js/tank.js']]);
  // The card's token note is the pieces' cost, summed as each lands: one
  // number for the plan where a reply has one for itself.
  assert.ok(first.data.tokens > 0 && second.data.tokens > 0, 'each piece costs');
  assert.equal(done.data.tokens, first.data.tokens + second.data.tokens);
  // And the note opens the pieces' receipts as one: every request in order,
  // the loop counts summed, the pieces counted; the prompt is the last piece's.
  const receipt = await app.client.json('GET', `/api/messages/${card.data.id}/receipt`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.breakdown.pieces, 2);
  assert.equal(receipt.body.breakdown.requests.length, 4, 'two turns a piece');
  assert.equal(receipt.body.breakdown.loop.tool_calls, 4);
  assert.equal(receipt.body.breakdown.loop.turns, 4);
  assert.equal(receipt.body.prompt_held, true);
  const prompt = await app.client.request('GET', `/api/messages/${card.data.id}/prompt`);
  assert.equal(prompt.status, 200);
  assert.match(await prompt.text(), /piece 2 of 2: Tanks that drive/);
  // The card's body is the reply the thread keeps: its head says it is done,
  // each line a piece's title, the files it changed and its headline.
  assert.equal(done.data.body, [
    'Done, in 2 pieces:',
    'A tank game for two on one keyboard.',
    'Assuming:',
    '- Arrow keys for one, WASD for the other.',
    '1. The page — css/style.css, index.html',
    '   Piece 1 of 2: The page',
    '2. Tanks that drive — js/game.js, js/tank.js',
    '   Tanks drive.',
  ].join('\n'));

  const commits = await logCommits(dir);
  assert.deepEqual(commits.slice(0, 3).map((c) => c.subject), [
    'Builder: piece 2 of 2 — Tanks that drive',
    'Builder: piece 1 of 2 — The page',
    'Builder: SPEC.md from the plan',
  ]);
  assert.equal(fs.readFileSync(path.join(dir, 'js', 'tank.js'), 'utf8'), 'drive()');
  const specText = fs.readFileSync(path.join(dir, 'SPEC.md'), 'utf8');
  assert.match(specText, /^# Tank\n\nA tank game for two on one keyboard\.\n/);
  assert.match(specText, /## Decisions\n\n- Arrow keys for one, WASD for the other\./);
  assert.match(specText, /## Plan\n\n1\. The page — index\.html, css\/style\.css: The page and its styles\./);

  // Each piece's fire: thinking off, on the confirmation's own system prompt
  // and its exchange — one cache prefix for the whole plan — with one turn on
  // top naming the request, the plan's words and this piece alone; for the
  // second, what the first left behind.
  assert.equal(llm.calls.length, 4);
  for (const call of llm.calls) assert.equal(call.thinking, 'none');
  assert.equal(llm.asked.length, 2, 'the sizing and the confirmation');
  const confirm = llm.asked[1];
  assert.equal(confirm.messages.at(-1).content, '[studio] Build the plan above as written. Answer {"ok":true}.');
  assert.equal(confirm.messages.at(-2).role, 'assistant', 'the card is the turn before it');
  assert.match(confirm.system, /--- FILE: SPEC\.md/, 'the block the pieces run on carries the spec');
  assert.match(confirm.system, /names the config\/ file they go in/, 'the planner gives each piece its config file');
  assert.equal(llm.calls[0].system, confirm.system);
  assert.equal(llm.calls[2].system, confirm.system, 'the block is the confirmation\'s for every piece');
  // The fake keeps the array the loop went on appending to: the exchange, the
  // piece turn, then the tool exchange.
  const n = confirm.messages.length;
  const first1 = llm.calls[0].messages;
  assert.deepEqual(first1.slice(0, n), confirm.messages);
  assert.equal(first1[n].role, 'assistant');
  const turn1 = first1[n + 1];
  assert.equal(turn1.role, 'user');
  assert.match(turn1.content, /piece 1 of 2: The page/);
  assert.match(turn1.content, /Do only this piece/);
  assert.match(turn1.content, /go in config\/ with a comment, never in js\//, 'every piece is told where constants live');
  assert.match(turn1.content, /"build me a tank game"/);
  assert.match(turn1.content, /What it is: A tank game for two on one keyboard\./);
  assert.match(turn1.content, /Decided:\n- Arrow keys for one, WASD for the other\./);
  assert.ok(!turn1.content.includes('have changed since'), 'nothing has changed yet');
  const turn2 = llm.calls[2].messages[n + 1].content;
  assert.match(turn2, /piece 2 of 2: Tanks that drive/);
  assert.match(turn2, /Done so far:\n- The page: Piece 1 of 2/);
  // What piece 1 changed rides piece 2's turn as fresh copies: the file this
  // piece names whole and current, the other by name — never in the system
  // prompt, which stays byte-identical.
  assert.match(turn2, /--- FILE: index\.html \(\d+ bytes\) ---\n<h1>Tank<\/h1>\n--- END FILE ---/);
  assert.match(turn2, /Also changed, not shown[^\n]*css\/style\.css/);
  assert.ok(!turn2.includes('body{}'), 'a file the piece does not name is named, not sent');
  assert.ok(!llm.calls[2].system.includes('<h1>Tank</h1>'));

  // The card on a fresh read carries the finished checklist, and the thread
  // holds the card where the piece rows would be.
  const detail = await app.client.json('GET', `/api/projects/tank?chat=${chatId}`);
  const kept = detail.body.messages.find((m) => m.kind === 'plan');
  assert.equal(kept.plan.status, 'done');
  assert.equal(kept.body, done.data.body);
  assert.equal(kept.tokens, done.data.tokens, 'the note survives a reload');
  assert.deepEqual(detail.body.messages.filter((m) => m.agent_id !== null).map((m) => m.id), [card.data.id]);
  assert.equal(detail.body.messages.filter((m) => m.kind === 'system').length, 0, 'no banners: nothing went wrong');
  const paged = await app.client.json('GET', `/api/projects/tank/messages?chat=${chatId}&limit=50`);
  assert.ok(!paged.body.messages.some((m) => m.plan_message_id), 'paging leaves the rows behind the card too');

  // And history replays the card, never a piece's row: the next fire sees one
  // builder turn, the card's body, with the plan's words and both headlines.
  await send(app, chatId, 'nice');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Thanks!');
  const replayed = llm.asked[2].messages.filter((m) => m.role === 'assistant');
  assert.equal(replayed.length, 1);
  assert.match(replayed[0].content, /^Done, in 2 pieces:\nA tank game for two on one keyboard\.\nAssuming:/);
  assert.match(replayed[0].content, /Tanks drive\./);
  assert.ok(!llm.asked[2].messages.some((m) => m.content === 'Tanks drive.'));
});

// The kids asked to change the plan before it runs (ideas/planner.md): the
// words, a piece's title and what it makes, the order, one more or one fewer.
// Build then sizes their words again — the files filled in, a piece too big
// split — rather than running them as written.
test('a person changes a draft, and Build sizes their words again', async (t) => {
  const llm = createFakeLlm([
    calls([write('js/walls.js', 'walls()')], { text: 'Walls break.' }),
    says(''),
    calls([write('index.html', '<h1>Tank</h1>')]),
    says(''),
  ], [
    sized({ size: 'pieces', pieces: PIECES, summary: 'A tank game.', assumptions: ['Two players.'] }),
    // The re-sizing keeps the words and fills in the files.
    sized({
      size: 'pieces',
      pieces: [
        { title: 'Walls that break', files: ['js/walls.js'], what: 'Walls a shot chips away.' },
        { title: 'The page', files: ['index.html'], what: 'The page and its styles.' },
      ],
    }),
  ]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  const id = card.data.id;

  // The words, then a piece renamed and reordered, then one taken out.
  let res = await app.client.json('PATCH', `/api/plans/${id}`, {
    body: { summary: 'A tank game with walls.', assumptions: ['Two players.', 'Walls come back each round.'] },
  });
  assert.equal(res.status, 200);
  let update = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.summary === 'A tank game with walls.');
  assert.deepEqual(update.data.plan.assumptions, ['Two players.', 'Walls come back each round.']);
  assert.equal(update.data.plan.edited, true);
  assert.match(update.data.body, /^That's a big one — here's my plan in 2 pieces\. Change anything, then press Build it\.\nA tank game with walls\.\nAssuming:\n- Two players\.\n- Walls come back each round\./);
  res = await app.client.json('PATCH', `/api/plans/${id}`, {
    body: {
      pieces: [
        { title: 'Walls that break', files: [], what: 'Walls a shot chips away.' },
        { title: 'The page', files: ['index.html', 'css/style.css'], what: 'The page and its styles.' },
      ],
    },
  });
  assert.equal(res.status, 200);
  update = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.pieces[0].title === 'Walls that break');
  assert.deepEqual(update.data.plan.pieces.map((p) => p.title), ['Walls that break', 'The page']);
  // Held to the sizing's own shapes: an empty list is refused. And a plan is
  // the game's editors' to change, like the room it is in: with the game
  // closed, somebody who is not one is refused.
  assert.equal((await app.client.json('PATCH', `/api/plans/${id}`, { body: { pieces: [] } })).status, 400);
  app.db.prepare("UPDATE projects SET open_edit = 0 WHERE slug = 'tank'").run();
  const stranger = app.newClient();
  await signIn(app, { email: 'kid@example.com', password: 'hunter2', displayName: 'Robin', client: stranger });
  assert.equal((await stranger.json('PATCH', `/api/plans/${id}`, { body: { summary: 'mine now' } })).status, 403);
  assert.equal((await stranger.json('POST', `/api/plans/${id}/build`)).status, 403);

  // Build: the second sizing carries the person's words and is told to keep
  // them; its answer is the plan the pieces run.
  assert.equal((await build(app, id)).status, 202);
  const done = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
  assert.equal(llm.asked.length, 2);
  const again = llm.asked[1].messages.at(-1).content;
  assert.match(again, /^\[studio\] The person changed the plan\. Here it is now:/);
  assert.match(again, /What it is: A tank game with walls\./);
  assert.match(again, /1\. Walls that break: Walls a shot chips away\./);
  assert.match(again, /words kept as written/);
  assert.deepEqual(done.data.plan.pieces.map((p) => [p.title, p.files, p.status]), [
    ['Walls that break', ['js/walls.js'], 'done'],
    ['The page', ['index.html'], 'done'],
  ]);
  assert.equal(done.data.plan.edited, false);
  // A finished plan is nobody's to change or build again.
  assert.equal((await app.client.json('PATCH', `/api/plans/${id}`, { body: { summary: 'x' } })).status, 409);
  assert.equal((await build(app, id)).status, 409);
  assert.equal((await build(app, 999999)).status, 404);
});

// Piece rows from before the column existed are filed behind their card on
// open, from the plan, which already named them.
test('piece rows from before the column are filed behind their card', (t) => {
  const dir = scratchDir('piece-rows-db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDb(path.join(dir, 'db'));
  db.exec(`
    INSERT INTO users (id, email, password_hash, display_name, created_at)
      VALUES (1, 'a@b.c', 'x', 'Dann', '2026-01-01T00:00:00.000Z');
    INSERT INTO agents (id, name, description, created_by, created_at)
      VALUES (1, 'Builder', 'b', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO projects (id, slug, name, kind, created_by, created_at)
      VALUES (1, 'tank', 'Tank', 'game', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO chats (id, project_id, name, bots, created_at)
      VALUES (1, 1, 'Building', 1, '2026-01-01T00:00:00.000Z');
    INSERT INTO messages (id, project_id, chat_id, agent_id, kind, body, created_at) VALUES
      (1, 1, 1, 1, 'plan', 'That''s a big one', '2026-01-01T00:00:00.000Z'),
      (2, 1, 1, 1, NULL, 'Piece 1 of 1', '2026-01-01T00:00:01.000Z'),
      (3, 1, 1, 1, NULL, 'A plain reply', '2026-01-01T00:00:02.000Z');
    INSERT INTO plans (message_id, project_id, chat_id, request, pieces, status, created_at, updated_at)
      VALUES (1, 1, 1, 'build it',
        '[{"title":"a","files":[],"what":"","status":"done","message_id":2,"note":null}]',
        'done', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z');
  `);
  dropColumnIfPresent(db, 'messages', 'plan_message_id');
  db.close();

  db = openDb(path.join(dir, 'db'));
  assert.deepEqual(
    db.prepare('SELECT id, plan_message_id FROM messages ORDER BY id').all()
      .map((m) => [m.id, m.plan_message_id]),
    [[1, null], [2, 1], [3, null]],
  );
  db.close();
});

test('a message mid-plan pauses it, and the next ask decides what happens to the rest', async (t) => {
  // Piece 1 is held open so the message lands while it runs.
  const first = held(calls([write('index.html')]));
  const llm = scriptedLlm([
    first.turn,
    says(''),
    // The small answer to the message that interrupted.
    says('Glad you like it!'),
    // Piece 2, carried on after it.
    calls([write('js/tank.js')], { text: 'Tanks drive.' }),
    says(''),
  ], [sized({ size: 'pieces', pieces: PIECES }), confirmed(), sized({ size: 'reply', resume: true })]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  assert.equal((await build(app, card.data.id)).status, 202);
  await first.started;
  await send(app, chatId, 'looks great so far');
  first.release();

  const paused = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'paused');
  assert.deepEqual(paused.data.plan.pieces.map((p) => p.status), ['done', 'todo']);
  await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'system'
    && /paused after piece 1 of 2 to read your message/.test(e.data.body));

  // The sizing of the new message knows what was left to do…
  const answer = await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Glad you like it!');
  assert.equal(answer.data.kind, null);
  assert.equal(llm.asked.length, 3, 'the sizing, the press, the sizing of the message');
  const ask = llm.asked[2].messages.at(-1).content;
  assert.match(ask, /A plan was under way/);
  assert.match(ask, /Tanks that drive/);
  assert.ok(!ask.includes('1. The page'), 'only the pieces still to do');

  // …and "carry on" carries on: the plan finishes without anybody asking.
  const done = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
  assert.deepEqual(done.data.plan.pieces.map((p) => p.status), ['done', 'done']);
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Tanks drive.');
});

test('a big message mid-plan replaces the plan', async (t) => {
  const first = held(calls([write('index.html')]));
  const llm = scriptedLlm([
    first.turn,
    says(''),
    calls([write('js/walls.js')], { text: 'Walls break.' }),
    says(''),
  ], [
    sized({ size: 'pieces', pieces: PIECES }),
    confirmed(),
    sized({ size: 'pieces', pieces: [{ title: 'Walls that break', files: ['js/walls.js'], what: 'Walls.' }, PIECES[1]] }),
    confirmed(),
  ]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  assert.equal((await build(app, card.data.id)).status, 202);
  await first.started;
  await send(app, chatId, 'actually, walls that break first');
  first.release();

  const dropped = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'dropped');
  assert.equal(dropped.data.message_id, card.data.id);
  const second = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan'
    && e.data.id !== card.data.id);
  assert.deepEqual(second.data.plan.pieces.map((p) => p.title), ['Walls that break', 'Tanks that drive']);
  // The new plan waits for its own press, like any plan of two.
  assert.equal(second.data.plan.status, 'draft');
  assert.equal((await build(app, second.data.id)).status, 202);
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Walls break.');
});

// A stream that caps on its first turn: the trace goes to the sizing call,
// not to a retry — a request that thought that long wanted splitting.
test('a first-turn cap in Building hands the trace to the sizing call', async (t) => {
  const llm = scriptedLlm(
    [capped, calls([write('index.html')]), says(''), calls([write('js/tank.js')], { text: 'Tanks drive.' }), says('')],
    [sized({ size: 'reply' }), sized({ size: 'pieces', pieces: PIECES }), confirmed()],
  );
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  assert.equal(card.data.plan.pieces.length, 2);
  // The second sizing carried the notes, ahead of its ask.
  assert.equal(llm.asked.length, 2);
  const ask = llm.asked[1].messages.at(-1).content;
  assert.ok(ask.indexOf('design notes') < ask.indexOf('Size this request'));
  assert.match(ask, /--- notes ---/);
  assert.equal((await build(app, card.data.id)).status, 202);
  await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
});

test('still small after the cap, the retry carries the trace and the receipt does not', async (t) => {
  const llm = scriptedLlm(
    [capped, calls([write('js/tank.js', 'drive()')], { text: 'Started on movement.' }), says('')],
    [sized({ size: 'reply' }), sized({ size: 'reply' })],
  );
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  const reply = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null
    && e.data.kind === null);
  assert.equal(reply.data.body, 'Started on movement.');
  // The retry: thinking off, the trace on the user turn as notes.
  assert.equal(llm.calls[1].thinking, 'none');
  const retry = llm.calls[1].messages;
  const carried = retry.find((m) => m.role === 'user' && /your notes so far/.test(m.content));
  assert.ok(carried, 'the handed trace rides a user turn');
  assert.match(carried.content, /design notes: split the screen/);
  // The request first, in the sizing's messages; the trace on the turn after.
  const asked = retry.findIndex((m) => m.role === 'user' && /build me a tank game/.test(m.content));
  assert.ok(asked >= 0 && asked < retry.indexOf(carried));
  // And never persisted: the receipt's prompt keeps a placeholder where the
  // notes were.
  const prompt = await app.client.request('GET', `/api/messages/${reply.data.id}/prompt`);
  const text = await prompt.text();
  assert.match(text, /a capped trace was handed on here/);
  assert.ok(!text.includes('design notes'));
  await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'system'
    && /stop planning and start working/.test(e.data.body));
});
