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
import { openDb } from '../server/db.js';

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

test('a small ask is sized first, then answered as one fire', async (t) => {
  const llm = createFakeLlm([says('Done — faster now.')], [sized({ size: 'small' })]);
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
    { role: 'assistant', content: '{"size":"small"}' },
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
  ], [sized({ size: 'small' }), sized({ size: 'big', pieces: rest })]);
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
  assert.match(card.data.body, /here's the rest in 2 pieces/);
  // The second sizing was told what was done, ahead of its ask.
  assert.equal(llm.asked.length, 2);
  const ask = llm.asked[1].messages.at(-1).content;
  assert.match(ask, /Files it changed: .*index\.html/);
  assert.match(ask, /Files it changed: .*js\/tank\.js/);
  assert.match(ask, /Page first\.\n\nNow the tanks\./);
  assert.ok(ask.indexOf('what it said while working') < ask.indexOf('Size this request'));
  assert.match(ask, /Size what is left, not the whole/);

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
  ], [sized({ size: 'small' }), sized({ size: 'small' }), sized({ size: 'small' })]);
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

test('a big ask becomes a plan card and one fire per piece', async (t) => {
  const llm = createFakeLlm([
    calls([write('index.html', '<h1>Tank</h1>'), write('css/style.css', 'body{}')]),
    says(''),
    calls([write('js/tank.js', 'drive()'), write('js/game.js', 'loop()')], { text: 'Tanks drive.' }),
    says(''),
  ], [sized({ size: 'big', pieces: PIECES })]);
  const { app, chatId, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');

  // The card first: the builder's own words in the thread, the checklist
  // beside them.
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  assert.match(card.data.body, /2 pieces/);
  assert.equal(card.data.plan.status, 'running');
  assert.deepEqual(card.data.plan.pieces.map((p) => [p.title, p.status]),
    [['The page', 'todo'], ['Tanks that drive', 'todo']]);

  // Then a row per piece, each with its own files and its own commit.
  const first = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null
    && e.data.kind === null && (e.data.writes ?? []).some((w) => w.path === 'index.html'));
  assert.equal(first.data.body, 'Piece 1 of 2: The page', 'a piece with nothing to say still gets its row');
  const second = await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Tanks drive.');
  assert.deepEqual(second.data.writes.map((w) => w.path), ['js/game.js', 'js/tank.js']);
  const done = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
  assert.equal(done.data.message_id, card.data.id);
  assert.deepEqual(done.data.plan.pieces.map((p) => [p.status, p.message_id]),
    [['done', first.data.id], ['done', second.data.id]]);

  const commits = await logCommits(dir);
  assert.deepEqual(commits.slice(0, 2).map((c) => c.subject), [
    'Builder: piece 2 of 2 — Tanks that drive',
    'Builder: piece 1 of 2 — The page',
  ]);
  assert.equal(fs.readFileSync(path.join(dir, 'js', 'tank.js'), 'utf8'), 'drive()');

  // Each piece's fire: thinking off, on the sizing's own system prompt and its
  // exchange — one cache prefix for the whole plan — with one turn on top
  // naming the request, the plan and this piece alone; for the second, what
  // the first left behind.
  assert.equal(llm.calls.length, 4);
  for (const call of llm.calls) assert.equal(call.thinking, 'none');
  const sizing = llm.asked[0];
  assert.equal(llm.calls[0].system, sizing.system);
  assert.equal(llm.calls[2].system, sizing.system, 'the block is the sizing\'s for every piece');
  // The fake keeps the array the loop went on appending to: the exchange, the
  // piece turn, then the tool exchange.
  const n = sizing.messages.length;
  const first1 = llm.calls[0].messages;
  assert.deepEqual(first1.slice(0, n), sizing.messages);
  assert.equal(first1[n].role, 'assistant');
  const turn1 = first1[n + 1];
  assert.equal(turn1.role, 'user');
  assert.match(turn1.content, /piece 1 of 2: The page/);
  assert.match(turn1.content, /Do only this piece/);
  assert.match(turn1.content, /"build me a tank game"/);
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

  // The card on a fresh read carries the finished checklist.
  const detail = await app.client.json('GET', `/api/projects/tank?chat=${chatId}`);
  const kept = detail.body.messages.find((m) => m.kind === 'plan');
  assert.equal(kept.plan.status, 'done');
  assert.equal(detail.body.messages.filter((m) => m.kind === 'system').length, 0, 'no banners: nothing went wrong');
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
  ], [sized({ size: 'big', pieces: PIECES }), sized({ size: 'small', resume: true })]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
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
  assert.equal(llm.asked.length, 2);
  const ask = llm.asked[1].messages.at(-1).content;
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
    sized({ size: 'big', pieces: PIECES }),
    sized({ size: 'big', pieces: [{ title: 'Walls that break', files: ['js/walls.js'], what: 'Walls.' }, PIECES[1]] }),
  ]);
  const { app, chatId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, chatId, 'build me a tank game');
  const card = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan');
  await first.started;
  await send(app, chatId, 'actually, walls that break first');
  first.release();

  const dropped = await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'dropped');
  assert.equal(dropped.data.message_id, card.data.id);
  const second = await stream.waitFor((e) => e.event === 'message.new' && e.data.kind === 'plan'
    && e.data.id !== card.data.id);
  assert.deepEqual(second.data.plan.pieces.map((p) => p.title), ['Walls that break', 'Tanks that drive']);
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Walls break.');
});

// A stream that caps on its first turn: the trace goes to the sizing call,
// not to a retry — a request that thought that long wanted splitting.
test('a first-turn cap in Building hands the trace to the sizing call', async (t) => {
  const llm = scriptedLlm(
    [capped, calls([write('index.html')]), says(''), calls([write('js/tank.js')], { text: 'Tanks drive.' }), says('')],
    [sized({ size: 'small' }), sized({ size: 'big', pieces: PIECES })],
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
  await stream.waitFor((e) => e.event === 'plan.update' && e.data.plan.status === 'done');
});

test('still small after the cap, the retry carries the trace and the receipt does not', async (t) => {
  const llm = scriptedLlm(
    [capped, calls([write('js/tank.js', 'drive()')], { text: 'Started on movement.' }), says('')],
    [sized({ size: 'small' }), sized({ size: 'small' })],
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
