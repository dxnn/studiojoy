import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  setup, signIn, openStream, putInChat, workChat, builderChat,
} from './helpers.js';
import {
  createFakeLlm, createFailingLlm, says, calls, answers, truncated, thinksOnly,
} from './fake-llm.js';
import { logCommits } from '../server/files/git.js';
import { budgetState } from '../server/budget.js';
import { NOTE_BYTES, weigh } from '../server/agents/orchestrator.js';
import { tokensForChars } from '../server/llm/deepseek.js';
import { arcFor } from '../public/arc.js';

// A studio with one game and the builder in its Building — the one kind of
// helper a game has, and the one with tools (spec.md §3, §8). The fake answers
// every sizing call with nothing unless a test scripts one, and nothing reads
// as a reply: the plain tooled fire at the builder's level, under its small
// budget, extending the sizing's exchange. So `llm.calls[0].messages` ends
// `…person's message + trigger, the sizing's answer, "[studio] Go ahead."`.
async function studio(t, { llm, ...opts } = {}) {
  const app = await setup({ llm, ...opts });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const chatId = await builderChat(app, 'tank');
  app.chatId = chatId;
  app.slug = 'tank';
  const agentId = app.db.prepare('SELECT id FROM agents WHERE builtin = 1').get().id;
  return { app, dir: path.join(app.gamesDir, 'tank'), agentId, chatId };
}

// A chat project with one helper of the test's own in its one room: blind —
// no tree, no tools, no preamble — and whatever its description says, at the
// thinking level it was given. Where eligibility, mentions and a plain
// conversation are tested.
async function chatStudio(t, { llm, chatty = true, agent = {}, ...opts } = {}) {
  const app = await setup({ llm, ...opts });
  t.after(() => app.close());
  await signIn(app);
  const created = await app.client.json('POST', '/api/agents', {
    body: { name: 'Designer', description: 'You design games.', ...agent },
  });
  const chatId = await workChat(app, 'talk');
  await putInChat(app, 'talk', created.body.id, { chatty, chat_id: chatId });
  app.chatId = chatId;
  app.slug = 'talk';
  return { app, agentId: created.body.id, chatId };
}

const send = (app, body, contextPaths) =>
  app.client.json('POST', `/api/projects/${app.slug}/messages`, {
    body: {
      body, chat_id: app.chatId,
      ...(contextPaths ? { context_paths: contextPaths } : {}),
    },
  });

test('a chatty agent answers a human message', async (t) => {
  const llm = createFakeLlm([says('Nice idea. I would start with movement.')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'Lets build a tank game');

  const started = await stream.waitFor((e) => e.event === 'agent.stream.start');
  assert.equal(started.data.project_slug, 'tank');

  const chunk = await stream.waitFor((e) => e.event === 'agent.stream.chunk');
  assert.match(chunk.data.delta, /Nice idea/);

  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.match(reply.data.body, /Nice idea/);
  assert.equal(reply.data.user_id, null);
  await stream.waitFor((e) => e.event === 'agent.stream.end');
});

test('a quiet agent waits to be mentioned', async (t) => {
  const llm = createFakeLlm([says('You rang?')]);
  const { app } = await chatStudio(t, { llm, chatty: false });

  await send(app, 'just thinking out loud');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(llm.calls.length, 0, 'no mention, no fire');

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await send(app, 'what do you think @Designer?');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(llm.calls.length, 1);
});

test('a mention matches a prefix of the name', async (t) => {
  const llm = createFakeLlm([says('here'), says('here again')]);
  const { app } = await chatStudio(t, {
    llm, chatty: false, agent: { name: 'Level Designer' },
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'hey @level take a look');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(llm.calls.length, 1);

  // Wait on something unique to the second reply: waitFor also matches events
  // that already arrived, so reusing a generic predicate would pass instantly.
  await send(app, 'and @leveldesigner again');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'here again');
  assert.equal(llm.calls.length, 2);
});

// Bot-to-bot dampening: an agent's own reply must not wake anything.
test('an agent reply does not trigger another round', async (t) => {
  const llm = createFakeLlm([says('First and only.')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  await stream.waitFor((e) => e.event === 'agent.stream.end');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(llm.calls.length, 1, 'the agent must not answer itself');
});

// A reply is what the helper said once it stopped calling tools — the last
// turn's words. Everything it said on the way is the reply's working: kept on
// the row, opened on a click, and never replayed into a later fire, since
// twenty-four turns of "now I'll write…" joined into one body was the wall of
// text a real receipt traced here — and the next fire paid for it every time.
test('a reply is the last thing said; the rest is its working, kept but never replayed', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'read_file', input: { path: 'index.html' } }],
      { text: 'Let me read the page first.' }),
    calls([{ name: 'write_file', input: { path: 'js/game.js', content: 'go()' } }],
      { text: 'Now the loop.' }),
    says('Done: the loop runs. Press play.'),
    says('Glad it works.'),
  ]);
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'make a start');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(reply.data.body, 'Done: the loop runs. Press play.');
  assert.equal(reply.data.working, true, 'a flag, like the receipt: the text is fetched');
  const working = await app.client.request('GET', `/api/messages/${reply.data.id}/working`);
  assert.equal(working.status, 200);
  assert.equal(await working.text(), 'Let me read the page first.\n\nNow the loop.');
  // The commit is headed by the reply, not by the first thing muttered.
  const [head] = await logCommits(dir, { limit: 1 });
  assert.equal(head.subject, 'Builder: Done: the loop runs. Press play.');

  // The next fire is given the reply and none of the working.
  await send(app, 'nice');
  const again = await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Glad it works.');
  assert.equal(again.data.working, false, 'said in one breath: nothing to open');
  assert.equal((await app.client.request('GET', `/api/messages/${again.data.id}/working`)).status, 404);
  const history = JSON.stringify(llm.calls[3].messages);
  assert.ok(history.includes('Done: the loop runs.'));
  assert.ok(!history.includes('Let me read the page first'));
});

test('write_file lands on disk, in a commit, and in the message', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'write_file', input: { path: 'index.html', content: '<h1>Tank</h1>' } }],
      { text: 'Scaffolding the page.' }),
    says('Done — index.html is up.'),
  ]);
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'make a start');

  // The sizing announces itself the same way first (spec.md §9).
  const toolEvent = await stream.waitFor((e) => e.event === 'agent.tool' && e.data.tool !== 'size');
  assert.equal(toolEvent.data.tool, 'write_file');
  assert.equal(toolEvent.data.path, 'index.html');

  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>Tank</h1>');

  // One commit for the turn, authored by the agent.
  const [head] = await logCommits(dir, { limit: 1 });
  assert.match(head.subject, /^Builder: /);
  assert.equal(head.author, 'Builder');
  assert.equal(head.email, 'tank@agent.gamestudio.local');

  assert.deepEqual(reply.data.writes.map((w) => [w.path, w.action]), [['index.html', 'create']]);
  assert.equal(reply.data.writes[0].commit_sha, head.sha);
  // The body is the last thing said; what the first turn said on the way is
  // the reply's working, behind a flag.
  assert.match(reply.data.body, /index\.html is up/);
  assert.ok(!reply.data.body.includes('Scaffolding'));
  assert.equal(reply.data.working, true);

  const changed = await stream.waitFor((e) => e.event === 'files.changed');
  assert.deepEqual(changed.data.paths, ['index.html']);
});

test('a reply leaves a receipt, and the newest reply holds the prompt', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'write_file', input: { path: 'index.html', content: '<h1>Tank</h1>' } }],
      { text: 'Scaffolding the page.' }),
    says('Done.'),
    says('Again.'),
  ]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const posted = await send(app, 'make a start');
  assert.equal(posted.body.receipt, false, 'a human message has no receipt');

  const first = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(first.data.receipt, true);

  const r1 = await app.client.json('GET', `/api/messages/${first.data.id}/receipt`);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.prompt_held, true);
  const b = r1.body.breakdown;
  assert.ok(b.system.preamble > 0, 'the preamble was measured');
  assert.ok(b.system.files.bytes > 0, 'the file block was measured');
  // The person's message, the sizing's answer and the turn on top: the fire
  // extends the sizing's exchange, and the receipt counts what was sent.
  assert.equal(b.transcript.messages, 3);
  assert.equal(b.loop.turns, 2);
  assert.equal(b.loop.tool_calls, 1);
  // The loop's two. The sizing ahead of them is billed and shown on no row
  // (spec.md §8).
  assert.equal(b.requests.length, 2, 'one usage entry per request');
  // The receipt's arithmetic reaches the number under the bubble.
  const charged = b.requests
    .reduce((n, u) => n + u.miss + Math.ceil(u.hit / 50) + u.out * 4, 0);
  assert.equal(charged, first.data.tokens);

  // The prompt is the last request as sent: the first turn's tool call is in
  // it, labelled, with the system prompt and the human's message.
  const p1 = await app.client.request('GET', `/api/messages/${first.data.id}/prompt`);
  assert.equal(p1.status, 200);
  const prompt = await p1.text();
  assert.match(prompt, /^\[system\]\n/);
  assert.ok(prompt.includes('\nSIZING\n'), 'the sizing rules ride the builder\'s prompt');
  // The transcript names its speakers, so the human turn carries one.
  assert.match(prompt, /\[user\]\n\[\w+\] make a start/);
  assert.match(prompt, /\[tool call call_0: write_file\]/);

  // The next fire takes the prompt with it; the breakdown stays.
  await send(app, 'carry on');
  const second = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null
      && e.data.id > first.data.id,
  );
  assert.equal((await app.client.request('GET', `/api/messages/${first.data.id}/prompt`)).status, 404);
  assert.equal((await app.client.request('GET', `/api/messages/${second.data.id}/prompt`)).status, 200);
  const again = await app.client.json('GET', `/api/messages/${first.data.id}/receipt`);
  assert.equal(again.status, 200);
  assert.equal(again.body.prompt_held, false);

  // A message with no receipt, and a thing that is not a message id.
  assert.equal((await app.client.json('GET', `/api/messages/${posted.body.id}/receipt`)).status, 404);
  assert.equal((await app.client.json('GET', '/api/messages/potato/receipt')).status, 400);
});

test('several files written in one turn become one commit', async (t) => {
  const llm = createFakeLlm([
    calls([
      { name: 'write_file', input: { path: 'index.html', content: '<html>' } },
      { name: 'write_file', input: { path: 'js/game.js', content: 'go()' } },
      { name: 'write_file', input: { path: 'css/style.css', content: 'body{}' } },
    ]),
    says('Three files in.'),
  ]);
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'scaffold it');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.deepEqual(
    reply.data.writes.map((w) => w.path).sort(),
    ['css/style.css', 'index.html', 'js/game.js'],
  );
  // Initial commit plus exactly one for the turn.
  assert.equal((await logCommits(dir, { limit: 50 })).length, 2);
});

test('patch_file edits in place and reports the delta', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'write_file', input: { path: 'game.js', content: 'let speed = 1;\n' } }]),
    calls([{
      name: 'patch_file',
      input: { path: 'game.js', old_text: 'speed = 1', new_text: 'speed = 5' },
    }]),
    says('Faster now.'),
  ]);
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'speed it up');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(fs.readFileSync(path.join(dir, 'game.js'), 'utf8'), 'let speed = 5;\n');
});

test('a tool refusal comes back to the model as text it can act on', async (t) => {
  const seen = [];
  const llm = createFakeLlm((opts, turn) => {
    const toolResults = opts.messages.filter((m) => m.role === 'tool');
    if (toolResults.length > 0) seen.push(toolResults.at(-1).content);
    if (turn === 0) {
      return calls([{ name: 'write_file', input: { path: '../escape.txt', content: 'no' } }]);
    }
    if (turn === 1) {
      return calls([{ name: 'patch_file', input: { path: 'nope.js', old_text: 'a', new_text: 'b' } }]);
    }
    return says('Understood, I will stay inside the project.');
  });
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'try something silly');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  assert.match(seen[0], /invalid path/);
  assert.match(seen[1], /no such file/);
  assert.equal(fs.existsSync(path.join(dir, '..', 'escape.txt')), false);
  // A refusal is not a write, so there is nothing to commit.
  assert.equal((await logCommits(dir, { limit: 50 })).length, 1);
});

// ⚠️ The rule that makes studio/ a library rather than a folder. A helper that
// could write it would fork a shared engine into one game, and the drift would
// be invisible because nothing else reads that copy.
test('a helper can read the studio library but not write it', async (t) => {
  const seen = [];
  const llm = createFakeLlm((opts, turn) => {
    const results = opts.messages.filter((m) => m.role === 'tool');
    if (results.length > 0) seen.push(results.at(-1).content);
    if (turn === 0) {
      return calls([{ name: 'write_file', input: { path: 'studio/input.js', content: 'mine now' } }]);
    }
    if (turn === 1) {
      return calls([{ name: 'patch_file', input: { path: 'studio/input.js', old_text: 'Input', new_text: 'Nope' } }]);
    }
    if (turn === 2) {
      return calls([{ name: 'delete_file', input: { path: 'studio/input.js' } }]);
    }
    if (turn === 3) return calls([{ name: 'read_file', input: { path: 'studio/input.js' } }]);
    return says('Understood, I will call it rather than change it.');
  });
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await app.client.json('PUT', '/api/projects/tank/files/studio/input.js', { rawBody: 'const Input = 1;' });

  await send(app, 'rewrite the controls library');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  for (const refusal of seen.slice(0, 3)) assert.match(refusal, /studio library/);
  assert.match(seen[3], /const Input = 1;/, 'reading it is allowed');
  // Still exactly what the studio put there.
  assert.equal(fs.readFileSync(path.join(dir, 'studio', 'input.js'), 'utf8'), 'const Input = 1;');
});

// ⚠️ A config file is a form a person tunes, and the form opens only while
// every value is plain. A builder wrote a computed lap count into one in
// production (2026-10-02) and the form closed with nothing saying why, so the
// tools refuse that write, while a plain edit, game code, and a file that was
// already past the form all still go through.
test('a helper cannot turn a config file into one the form cannot open', async (t) => {
  const seen = [];
  const plan = [
    { name: 'patch_file', input: { path: 'config/play.js', old_text: 'const SPEED = 3;', new_text: 'const SPEED = 3 * 2;' } },
    { name: 'write_file', input: { path: 'config/laps.js', content: 'const LAPS = TRACKS.length;\n' } },
    { name: 'patch_file', input: { path: 'config/play.js', old_text: 'const SPEED = 3;', new_text: 'const SPEED = 4;' } },
    { name: 'write_file', input: { path: 'js/laps.js', content: 'const LAPS = TRACKS.length;\n' } },
    { name: 'patch_file', input: { path: 'config/old.js', old_text: 'Math.PI;', new_text: 'Math.PI; // a whole turn, halved' } },
  ];
  const llm = createFakeLlm((opts, turn) => {
    const results = opts.messages.filter((m) => m.role === 'tool');
    if (results.length > 0) seen.push(results.at(-1).content);
    return turn < plan.length ? calls([plan[turn]]) : says('Done.');
  });
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await app.client.json('PUT', '/api/projects/tank/files/config/play.js', { rawBody: '// how fast\nconst SPEED = 3;\n' });
  await app.client.json('PUT', '/api/projects/tank/files/config/old.js', { rawBody: 'const HALF = Math.PI;\n' });

  await send(app, 'make it faster');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  assert.match(seen[0], /refused: config\/play\.js would no longer open as a form/);
  assert.match(seen[0], /js\/ file that reads them/, 'and says where the logic goes');
  assert.match(seen[1], /refused: config\/laps\.js/, 'a new config file is held to it too');
  assert.match(seen[2], /patched config\/play\.js/, 'a plain change is fine');
  assert.match(seen[3], /created js\/laps\.js/, 'game code is not a config file');
  assert.match(seen[4], /patched config\/old\.js/, 'a file already past the form is not frozen');
  assert.equal(fs.readFileSync(path.join(dir, 'config', 'play.js'), 'utf8'), '// how fast\nconst SPEED = 4;\n');
  assert.equal(fs.existsSync(path.join(dir, 'config', 'laps.js')), false);
});

// A library is named and sized, never sent: an engine an agent cannot edit is
// also one it does not need in front of it, and sending it would eat the ambient
// budget the game's own code competes for.
test('the library is named to a helper, not poured into its context', async (t) => {
  const llm = createFakeLlm([says('Seen.')]);
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/studio/input.js', {
    rawBody: `// a library\n${'x'.repeat(4000)}`,
  });
  await app.client.json('PUT', '/api/projects/tank/files/studio/studio.json', { rawBody: '{"input":1}' });
  await app.client.json('PUT', '/api/projects/tank/files/js/game.js', { rawBody: 'let speed = 1;' });

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await send(app, 'what is in this game?');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.match(system, /STUDIO LIBRARY/);
  assert.match(system, /studio\/input\.js/, 'named');
  assert.match(system, /studio\/studio\.json/);
  assert.equal(system.includes('x'.repeat(4000)), false, 'not sent');
  // The game's own code still is.
  assert.match(system, /let speed = 1;/);
  // And it is listed once, as a library — not again among the game's own files.
  // (The preamble names the path too, which is why this looks at the listing
  // rather than counting matches in the whole prompt.)
  const listing = system.split('\n\n').find((part) => part.startsWith('PROJECT FILES'));
  assert.match(listing, /js\/game\.js/);
  assert.equal(listing.includes('studio/'), false, 'the library is not among the game files');
});

// A library documents itself with the comment block at the top of its file,
// and a block past the cap is cut with a "// (cut)" and nothing said. Screens
// and input both run close to it, so the fleet is held against the number
// here rather than discovered by a helper missing the tail of an API.
test('every library API note fits the cap it is sent under', () => {
  const dir = new URL('../public/studio-lib/', import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
  for (const [name, library] of Object.entries(index.libraries)) {
    const source = fs.readFileSync(new URL(`${name}/${name}.js`, dir), 'utf8');
    const note = [];
    for (const line of source.split('\n')) {
      if (!line.startsWith('//')) break;
      note.push(line);
    }
    const bytes = Buffer.byteLength(note.join('\n'), 'utf8');
    assert.ok(bytes > 0, `${name} documents itself`);
    assert.ok(bytes <= NOTE_BYTES, `${name}: ${bytes} bytes against a ${NOTE_BYTES} cap`);
    assert.ok(library.version >= 1);
  }
});

test('read_file reaches a file that was left out of context', async (t) => {
  const observed = [];
  const llm = createFakeLlm((opts, turn) => {
    observed.push(opts.messages.filter((m) => m.role === 'tool').map((m) => m.content));
    if (turn === 0) return calls([{ name: 'read_file', input: { path: 'notes.md' } }]);
    return says('Read it.');
  });
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/notes.md', { rawBody: 'design notes here' });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'check the notes');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.match(observed.at(-1).at(-1), /design notes here/);
});

// ⚠️ The shape is the API's, measured 2026-09-12 (spec/ §14): a picture rides
// a tool result as content parts, because an image on a system message is a
// 400 and the ambient file block lives there.
test('look_at hands back the picture itself, labelled', async (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
  const observed = [];
  const llm = createFakeLlm((opts, turn) => {
    observed.push(opts.messages.filter((m) => m.role === 'tool').map((m) => m.content));
    if (turn === 0) {
      return calls([{ name: 'look_at', input: { path: 'assets/sprites/hero.png' } }]);
    }
    return says('Green, mostly.');
  });
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/assets/sprites/hero.png', {
    rawBody: png,
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'what colour is the hero?');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );

  const result = observed.at(-1).at(-1);
  assert.ok(Array.isArray(result), 'a picture is content parts, not a sentence');
  assert.deepEqual(result[0], {
    type: 'text', text: `assets/sprites/hero.png (${png.length} bytes)`,
  });
  assert.equal(result[1].type, 'image_url');
  assert.equal(
    result[1].image_url.url,
    `data:image/png;base64,${png.toString('base64')}`,
  );

  // ⚠️ The receipt keeps a note of the picture, never the picture: it is a row
  // in SQLite that npm run backup copies, and the bytes are already on disk.
  const kept = await (await app.client.request(
    'GET', `/api/messages/${reply.data.id}/prompt`,
  )).text();
  assert.match(kept, /assets\/sprites\/hero\.png \(7 bytes\)/);
  assert.match(kept, /\[picture: \d+ KB, not kept\]/);
  assert.ok(!kept.includes('base64'), 'no data URI in the receipt');
});

test('look_at refuses what the API would refuse, with a reason', async (t) => {
  const asked = ['js/game.js', 'BRIEF.md', 'assets/sounds/laser.wav', 'nope.png', '../escape.png'];
  const observed = [];
  const llm = createFakeLlm((opts, turn) => {
    observed.push(opts.messages.filter((m) => m.role === 'tool').map((m) => m.content));
    if (turn < asked.length) return calls([{ name: 'look_at', input: { path: asked[turn] } }]);
    return says('None of those, then.');
  });
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/assets/sounds/laser.wav', {
    rawBody: Buffer.from([0x52, 0x49, 0x46, 0x46]),
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'look at everything');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const results = observed.at(-1);
  // Text says so and points at the tool that does work on it; a sound says
  // what can be looked at; a missing file and a bad path say what they are.
  assert.match(results[0], /js\/game\.js is text.*read_file/);
  assert.match(results[1], /BRIEF\.md is text.*read_file/);
  assert.match(results[2], /only PNG, JPEG, GIF and WebP/);
  assert.match(results[3], /no such file: nope\.png/);
  assert.match(results[4], /invalid path/);
  for (const r of results) assert.equal(typeof r, 'string', 'a refusal is a sentence');
});

// The debugging loop: the frame somebody was watching when they typed, taken
// by the reporter inside the preview and stored as one row (spec/ §8).
test('look_at_game shows the last frame, or says there is none', async (t) => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const observed = [];
  // Two fires, each one look and one word: the turn counter runs across both.
  const llm = createFakeLlm((opts, turn) => {
    observed.push(opts.messages.filter((m) => m.role === 'tool').map((m) => m.content));
    if (turn % 2 === 0) return calls([{ name: 'look_at_game', input: {} }]);
    return says(turn === 1 ? 'Nothing to see.' : 'I see it.');
  });
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  // Nobody watching: the honest answer, and a sentence rather than a fault.
  await send(app, 'does it look right?');
  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.body === 'Nothing to see.',
  );
  const none = observed.at(-1).at(-1);
  assert.equal(typeof none, 'string');
  assert.match(none, /nobody has the game open/);

  await app.client.json('PUT', '/api/projects/tank/shot', {
    body: { data: `data:image/jpeg;base64,${jpeg.toString('base64')}`, version: 'abc' },
  });
  await send(app, 'now?');
  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null && e.data.body === 'I see it.',
  );

  const shown = observed.at(-1).at(-1);
  assert.ok(Array.isArray(shown), 'the game is content parts, not a sentence');
  assert.match(shown[0].text, /^the game as it looked \d+ seconds ago$/);
  assert.equal(shown[1].image_url.url, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
});

// The growth limit stands for context, and a picture is at most 1,024 tokens
// of it however many kilobytes of base64 it is (§14). Counted by its bytes, a
// second look would end the fire.
test('a picture weighs what it costs, not what it measures', async () => {
  const url = `data:image/png;base64,${'A'.repeat(400 * 1024)}`;
  const asPicture = weigh({
    role: 'tool',
    tool_call_id: 'c1',
    content: [{ type: 'text', text: 'a.png (300000 bytes)' }, { type: 'image_url', image_url: { url } }],
  });
  assert.ok(asPicture < 8 * 1024, `${asPicture} bytes for a 400 KB data URI`);
  // A plain result is still weighed verbatim.
  const asText = weigh({ role: 'tool', tool_call_id: 'c1', content: 'x'.repeat(1000) });
  assert.ok(asText > 1000 && asText < 1100, asText);
});

test('delete_file removes the file and the deletion is recorded', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'delete_file', input: { path: 'old.txt' } }]),
    says('Removed it.'),
  ]);
  const { app, dir } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/old.txt', { rawBody: 'bye' });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'drop old.txt');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(fs.existsSync(path.join(dir, 'old.txt')), false);
  assert.deepEqual(reply.data.writes.map((w) => w.action), ['delete']);
});

test('a reasoning trace streams but is never persisted', async (t) => {
  const llm = createFakeLlm([
    says('Movement first.', { reasoning: 'The user wants a tank game. Think about physics.' }),
  ]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'where do we start?');
  const trace = await stream.waitFor((e) => e.event === 'agent.stream.reasoning');
  assert.match(trace.data.delta, /Think about physics/);

  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(reply.data.body, 'Movement first.');
  assert.ok(!reply.data.body.includes('physics'), 'the trace must not reach the message');

  const stored = app.db.prepare('SELECT body FROM messages WHERE agent_id IS NOT NULL').all();
  for (const row of stored) {
    assert.ok(!row.body.includes('physics'), 'and must not reach the database');
  }
});

test('a reasoning trace is not replayed on the next turn', async (t) => {
  const llm = createFakeLlm([
    says('First.', { reasoning: 'secret deliberation' }),
    says('Second.'),
  ]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'one');
  await stream.waitFor((e) => e.event === 'agent.stream.end' && e.data.message_id);
  await send(app, 'two');
  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.body === 'Second.',
  );

  const secondCall = llm.calls[1];
  const serialized = JSON.stringify(secondCall.messages);
  assert.ok(!serialized.includes('secret deliberation'));
  assert.ok(serialized.includes('First.'), 'but the reply itself is replayed');
});

test('the context carries the tree and the brief, and the pin rides the last message', async (t) => {
  const llm = createFakeLlm([says('Seen.')]);
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/BRIEF.md', {
    rawBody: 'Keep it under 200KB and playable with one hand.',
  });
  await app.client.json('PUT', '/api/projects/tank/files/js/game.js', { rawBody: 'let a = 1;' });
  await app.client.json('PUT', '/api/projects/tank/files/sprite.png', {
    rawBody: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  // The suite's games are born empty, so install the real input library by
  // hand: its API note in the preamble is asserted below against the real
  // header, the same bytes a scaffolded game holds.
  await app.client.json('PUT', '/api/projects/tank/files/studio/studio.json', {
    rawBody: '{\n  "input": 2\n}\n',
  });
  await app.client.json('PUT', '/api/projects/tank/files/studio/input.js', {
    rawBody: fs.readFileSync(path.join('public', 'studio-lib', 'input', 'input.js')),
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'look at this', ['js/game.js']);
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system, messages } = llm.lastCall();
  assert.match(system, /Keep it under 200KB/, 'the brief is injected');
  assert.match(system, /You are the Builder/, 'the agent description is injected');
  assert.match(system, /prefer patch_file/i);
  // ⚠️ A capability an agent is not told about may as well not exist, and
  // seeing is the newest one (spec/ §14).
  assert.match(system, /You can see\. look_at shows you any \.png/);
  assert.match(system, /look_at_game shows you the game itself/);
  // The robot is the preview's, but only the builder can teach it.
  assert.match(system, /js\/robot\.js teaches it this game/);
  assert.match(system, /Robot\.play\(\(s\) =>/);

  // The studio asks for many small files, a config/ directory, and the three
  // project documents.
  assert.match(system, /many small files/);
  // Doki Doki repainted up to three full-screen gradients a frame, each ~35
  // times a plain fill on a processor-painted canvas (2026-09-29); nothing
  // had told the builder what a frame costs.
  assert.match(system, /Never fill the whole screen with a gradient every frame/);
  assert.match(system, /config\/play\.js/);
  assert.match(system, /config\/words\.js/);
  assert.match(system, /`const NAME = value;`/);
  // The rule, not only the shape: told what a config file looks like and not
  // that every constant belongs in one, the builder left them in js/.
  assert.match(system, /lives here and nowhere else/, 'every number and word is a config value');
  assert.match(system, /BRIEF\.md — the file map/);
  assert.match(system, /SPEC\.md — what the game is/);
  assert.match(system, /TODO\.md — one task per line/);

  // How to work, as opposed to what to build. Both were paid for by a fire
  // that spent twenty-odd turns patching a file it had just written and never
  // read back, and shipped a game with a doubled line in it.
  assert.match(system, /comes back to you on your next turn/, 'the error feed is named');
  assert.match(system, /Until somebody presses play/, 'and that nothing is tested until then');
  assert.match(system, /Settle the design before you write/);
  assert.match(system, /read it back/);

  // Everything the studio can do that an agent cannot do for itself has to be
  // named here, or it may as well not exist: an agent that does not know a
  // person can draw a sprite in one click writes the game without one.
  // The input module documents itself: the note at the top of the game's own
  // copy is in the preamble, and the not-held fallback is not.
  assert.match(system, /^studio\/input\.js:$/m);
  assert.match(system, /Input\.update\(\)/);
  assert.match(system, /Input\.axis\("left", "right"\)/);
  assert.match(system, /config\/controls\.js/);
  assert.match(system, /SCHEME/, 'the note teaches the control scheme declaration');
  assert.ok(!system.includes('rather than writing key handling'), 'no fallback when held');
  // The shape is gated the same way the notes are: this game holds input and
  // nothing else, so nothing here names a call it does not have.
  assert.ok(!system.includes('Screens.title'), 'no shape for a library it lacks');
  // By the words on the buttons over the pictures and the sounds — the
  // Code-only "Add a file" dialog is not where a kid goes for either.
  assert.match(system, /"Draw a picture"/);
  assert.match(system, /up to 256 a side/, 'what the editor draws, not the 1024 it opens');
  assert.match(system, /"Add from the studio"/, 'the shelf, big set and all');
  assert.match(system, /"Make a sound"/);
  assert.match(system, /"Upload a picture" and "Upload a sound"/);
  assert.match(system, /"Add dressing"/);
  // The three reserved images, by their exact names: a helper that has not
  // heard of them files a wallpaper under assets/images/ where nothing looks.
  // hero.png alone would match the sprite example above, so the bar rides in.
  assert.match(system, /chat\.png/);
  assert.match(system, /hero\.png backs the bar/);
  assert.match(system, /icon\.png/);
  assert.match(system, /an \.svg is text/, 'the one picture an agent can make itself');
  // The four config files that are somebody's whole editing surface, named so
  // a helper knows what a stray extra key costs them — and each by the words
  // on the button, so renaming one in the interface fails here.
  assert.match(system, /"quiz editor"/);
  assert.match(system, /"story editor"/);
  assert.match(system, /"achievements editor", the Achievements part of/);
  assert.match(system, /config\/controls\.js as "Controls"/);
  assert.match(system, /config\/story\.js/);
  assert.match(system, /config\/achievements\.js/);
  // Where to say a moment is the moments library's to teach, gated on the
  // game holding it like every other library (the shape test, below): this
  // game holds input alone, so Moments goes unnamed.
  assert.ok(!system.includes('Moments.say'), 'no call into a library it lacks');
  // Where the game is on its arc, so a helper's suggestions fit the stamp the
  // person is working towards. A blank game's first stamp is the question a
  // template would have answered — held as `what`, and its words read from
  // public/arc.js rather than repeated here, so rewording a stamp never means
  // editing a test. What this holds is the sentence's shape and which stamp
  // it names.
  const blank = arcFor(null);
  assert.equal(blank[0].id, 'what', 'a blank game starts at the question');
  assert.ok(
    system.includes(
      `This game holds 0 of ${blank.length} stamps on its arc `
      + `and is working towards "${blank[0].name}": ${blank[0].principle}`,
    ),
    'the arc line names the stamp and its principle',
  );
  // A free-form game gets no type section: nothing here is a visual novel.
  assert.ok(!system.includes('This game is a visual novel'), 'no type section without a type');
  assert.match(system, /POST \/_scores\/<slug>/, 'the scoreboard is named');
  assert.match(system, /GET \/_me/, 'and the way a game learns who is signed in');
  assert.match(system, /sign in to get on the board/, 'and what to offer when nobody is');
  assert.match(system, /textContent, never innerHTML/, 'and so is the safe way to show it');
  assert.match(system, /GET _assets/, 'and how a game finds its own pictures and sounds');

  // The files sit in the system prompt, ahead of the transcript, so the prefix
  // a second fire matches on includes them (spec.md §8).
  assert.match(system, /PROJECT FILES/);
  assert.match(system, /js\/game\.js \(10 bytes\)/);
  assert.match(system, /\[binary: sprite\.png, 4 bytes\]/, 'binaries are named, not sent');
  // The tree carries every file's size, so it changes on every edit — it
  // trails the contents rather than leading them, or each commit would
  // re-bill the whole block as a cache miss.
  assert.ok(
    system.lastIndexOf('--- END FILE ---') < system.indexOf('PROJECT FILES'),
    'the tree follows the file contents',
  );

  // The pin is named on the person's message, next to the volatile things —
  // never inside the file block, where it would move with every human turn.
  // In the builder's room that message also carries the sizing trigger, and
  // is followed by the sizing's answer and the turn the fire adds (spec.md §8).
  assert.ok(!system.includes('pinned'), 'no pin label in the system prompt');
  assert.equal(
    messages.at(-3).content,
    '(the user pinned these files: js/game.js)\n\n[Dann] look at this\n\n[studio] Size this request.',
  );
  assert.equal(messages.at(-1).content, '[studio] Go ahead.');
});

// A game with a type is briefed about it: what the story file is, that the
// person works in the "story editor" tab, and how a picture is asked for by
// the name the story gives it. Named by the words on the tab, so renaming the
// tab without updating the prompt fails here.
test('a visual novel tells its helpers what the story file is', async (t) => {
  const llm = createFakeLlm([says('ok')]);
  const { app } = await studio(t, { llm });
  // The fixture's public/ has no templates, so the type is set by hand.
  app.db.prepare("UPDATE projects SET type = 'visual-novel' WHERE slug = 'tank'").run();
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'make the cat say more');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.match(system, /This game is a visual novel/);
  assert.match(system, /"story editor" — Write, in the row of modes over this chat/);
  assert.match(system, /assets\/sprites\/<who>-<mood>\.png/);
  assert.match(system, /a request about what happens is config\/story\.js alone/);
  // The guide's two buttons, by the words on them: a person stuck for words
  // or for art has one, and a helper that has not been told cannot offer it.
  assert.match(system, /"Fill it in for me"/);
  assert.match(system, /"Make one for me"/);
  // Music belongs to a scene and a noise is a step among the lines. A helper
  // told neither would put a door slam on the scene and it would play at the
  // wrong moment, or not at all.
  assert.match(system, /"music" is a whole path under assets\/music\//);
  assert.match(system, /\{ sound: "page" \} between two spoken lines/);
});

// An adventure's helpers are told what a spot is and, above all, never to
// write one's box: a helper can look at a picture but cannot measure it, so
// the numbers come from the person dragging a box in the editor.
test('an adventure tells its helpers what a spot is and not to type its box', async (t) => {
  const llm = createFakeLlm([says('ok')]);
  const { app } = await studio(t, { llm });
  app.db.prepare("UPDATE projects SET type = 'adventure' WHERE slug = 'tank'").run();
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'add a key');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.match(system, /This game is a point-and-click adventure/);
  assert.match(system, /"adventure editor" — Scenes, in the row of modes over this chat/);
  assert.match(system, /at: \[x, y, width, height\] in the picture's own pixels/);
  assert.match(system, /Never write or change an "at"/);
  assert.match(system, /assets\/sprites\/<thing>\.png/);
  assert.match(system, /A scene with no spots is the\s+end/);
  assert.match(system, /a request about\s+what happens is config\/scenes\.js alone/);
  assert.ok(!system.includes('This game is a visual novel'), 'one type section, not two');
});

// A racing game's helpers are told the track is drawn and never to type its
// points, and where the feel of the race lives.
test('a racing game tells its helpers the track is drawn, not typed', async (t) => {
  const llm = createFakeLlm([says('ok')]);
  const { app } = await studio(t, { llm });
  app.db.prepare("UPDATE projects SET type = 'racing' WHERE slug = 'tank'").run();
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'make the rivals faster');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.match(system, /This game is a racing game/);
  assert.match(system, /"track editor" — Track, in the row of modes over this chat/);
  assert.match(system, /Never\s+type or change the points/);
  assert.match(system, /config\/play\.js — turn, thrust, drag/);
  assert.match(system, /assets\/sprites\/car\.png replaces the triangle/);
});

// The four asset folders, by name: a helper that has not been told about
// assets/music/ has nowhere to put a track. That a track is named by its path
// is the sound library's note to say, and the shape test holds it there.
test('the preamble names all four asset folders', async (t) => {
  const llm = createFakeLlm([says('ok')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'add some music');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.match(system, /assets\/sprites\/ \(pictures that move/);
  assert.match(system, /assets\/images\/ \(ones that do not\)/);
  assert.match(system, /assets\/sounds\/ \(short noises\)/);
  assert.match(system, /assets\/music\/ \(whole\s+tracks\)/);
});

// The shape a game takes, after the API notes and gated on the manifest. A
// note says what a call does and never that a game is expected to make it,
// which is how a helper reads six notes and still hand-rolls a title screen,
// a game-over banner and a controls hint onto its canvas.
test('the preamble says how a game is shaped, for the libraries it holds', async (t) => {
  const llm = createFakeLlm([says('ok')]);
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/studio/studio.json', {
    rawBody: '{\n  "input": 5,\n  "screens": 11,\n  "moments": 1\n}\n',
  });
  for (const name of ['input', 'screens', 'moments']) {
    await app.client.json('PUT', `/api/projects/tank/files/studio/${name}.js`, {
      rawBody: fs.readFileSync(path.join('public', 'studio-lib', name, `${name}.js`)),
    });
  }
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'build the game');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  // Everything about one library in one place: its name, its shape, its note.
  const at = (s) => system.indexOf(s);
  assert.ok(at('studio/screens.js:\n') >= 0, 'each library has its heading');
  assert.ok(at('studio/screens.js:\n') < at('- It opens on Screens.title'), 'the shape under it');
  assert.ok(at('- It opens on Screens.title') < at('// The furniture around the game'), 'then the note');
  // Both screens are the same call, and the score is the difference — a
  // helper that misses that writes its own game-over overlay.
  assert.match(system, /Screens\.title\(\{ onStart: start \}\)/);
  assert.match(system, /Screens\.title\(\{ score, post: true,/);
  assert.match(system, /there is no Screens\.close/, 'the one call it invents');
  assert.match(system, /Screens\.chips\(\{ Score: 12, Lives: 3 \}/);
  // How big the game is on the screen is the studio's answer too. Left to the
  // game it was written as width alone twice, and both came off the bottom of
  // a phone held sideways.
  assert.match(system, /Screens\.fit\(el\)/);
  assert.match(system, /not width css of your own/);
  // A meter and a node of the game's own are what a hand-rolled HUD was for.
  assert.match(system, /a meter or a node of your own included/);
  assert.match(system, /Every frame begins with Input\.update\(\)/);
  assert.match(system, /SCHEME says what a touchscreen gets/, 'and where the shape is declared');
  // Picking it is the person's, since New game asks and the choice can be
  // changed afterwards; an agent that rewrites the word unasked has undone a
  // decision somebody made.
  assert.match(system, /Change it only if you are asked to/, 'and whose choice it is');
  assert.match(system, /Moments\.say goes on the line where the thing happens/);
  // Not held is not named: this game has neither sprites nor sound, and a
  // shape line for a library that is not in the tree is a call into nothing.
  // Gated one library at a time, so a game with sound and no sprites is not
  // told about Sprites on sound's coat-tails.
  assert.ok(!system.includes('Every picture is Sprites.draw'), 'nothing for a library it lacks');
  assert.ok(!system.includes('Every noise and every track is Sound'), 'and each is gated on its own');
});

// A type's paragraph is its template's `brief` (game-templates/index.json),
// so a type the studio grows is briefed with no orchestrator edit. A game of
// each type hears its own and nobody else's.
test("each type's brief rides a game of that type and no other", async (t) => {
  const { templates } = JSON.parse(fs.readFileSync(path.join('public', 'game-templates', 'index.json'), 'utf8'));
  const types = Object.keys(templates);
  const llm = createFakeLlm(types.map(() => says('ok')));
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());
  const replies = () => stream.events.filter(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  ).length;
  for (const [i, type] of types.entries()) {
    app.db.prepare('UPDATE projects SET type = ? WHERE slug = ?').run(type, 'tank');
    await send(app, `build the ${type}`);
    await stream.waitFor(() => replies() > i);
    const { system } = llm.lastCall();
    if (templates[type].brief) assert.ok(system.includes(templates[type].brief.join('\n')), type);
    for (const other of types) {
      if (other === type || !templates[other].brief) continue;
      assert.ok(!system.includes(templates[other].brief[0]), `${type}: nothing of ${other}'s`);
    }
  }
});

// The shape lines are the index's (`shape` beside `what`), so a library the
// studio grows is taught with no orchestrator edit. Held alone, each library
// brings its own lines and nobody else's.
test("each library's shape lines ride its own manifest entry and no other", async (t) => {
  const index = JSON.parse(fs.readFileSync(path.join('public', 'studio-lib', 'index.json'), 'utf8'));
  const names = Object.keys(index.libraries);
  const llm = createFakeLlm(names.map(() => says('ok')));
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const replies = () => stream.events.filter(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  ).length;
  for (const [i, name] of names.entries()) {
    await app.client.json('PUT', '/api/projects/tank/files/studio/studio.json', {
      rawBody: JSON.stringify({ [name]: index.libraries[name].version }),
    });
    await app.client.json('PUT', `/api/projects/tank/files/studio/${name}.js`, {
      rawBody: fs.readFileSync(path.join('public', 'studio-lib', name, `${name}.js`)),
    });
    await send(app, `build it with ${name}`);
    await stream.waitFor(() => replies() > i);
    const { system } = llm.lastCall();
    assert.ok(system.includes(index.libraries[name].shape.join('\n')), `${name}'s shape`);
    // A track is named by its path; a helper that thinks a plain name
    // resolves to assets/music/ writes one that never loads.
    if (name === 'sound') assert.match(system, /Sound\.loop\("assets\/music\/theme\.mp3", 0\.4\)/);
    for (const other of names) {
      if (other === name) continue;
      assert.ok(!system.includes(index.libraries[other].shape[0]), `${name} alone: nothing of ${other}'s`);
    }
    await app.client.json('DELETE', `/api/projects/tank/files/studio/${name}.js`);
  }
});

// DeepSeek re-bills the chain's accumulated reasoning on every continuation
// (spec.md §14); a user-role note sheds it once carrying costs more than the
// note does.
test('a heavy chain sheds its reasoning pile with a studio note', async (t) => {
  // 5k of reasoning per round: past the 8k floor after round two, and far
  // past 2.5× the few hundred visible bytes the loop has appended.
  const round = (p) => calls(
    [{ name: 'write_file', input: { path: p, content: 'x' } }],
    { reasoningTokens: 5000 },
  );
  const turns = [round('a.js'), round('b.js'), round('c.js'), says('Done.')];
  // Counted at call time: the orchestrator mutates one messages array, so
  // what llm.calls holds afterwards is the final state, not what was sent.
  const notes = [];
  const llm = createFakeLlm((opts, turn) => {
    notes.push(opts.messages
      .filter((m) => m.role === 'user' && /\[studio\] Housekeeping/.test(m.content)).length);
    return turns[turn];
  });
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'build it');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );

  // The note reached the model as a user turn — after round two and not
  // before — and never reached anything persistent.
  assert.deepEqual(notes, [0, 0, 1, 1], 'shed once, between rounds two and three');
  assert.ok(!reply.data.body.includes('Housekeeping'));
  const receipt = await app.client.json('GET', `/api/messages/${reply.data.id}/receipt`);
  assert.equal(receipt.body.breakdown.loop.sheds, 1);
});

// A capability an agent is told about may as well exist: a helper told about
// routes that answer 404 would happily build a broken board.
test('a switched-off scoreboard leaves the preamble', async (t) => {
  const llm = createFakeLlm([says('Quiet board.')]);
  const { app } = await studio(t, { llm });
  await app.client.json('PATCH', '/api/projects/tank', { body: { scores_on: false } });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'no scores please');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.ok(!system.includes('/_scores/'), 'the scoreboard is not named');
  assert.ok(!system.includes('scoreboard'), 'not even in passing');
  // The paragraphs around it are intact.
  assert.match(system, /"Draw a picture"/);
  assert.match(system, /BRIEF\.md — the file map/);
});

// The note assembly's other half: no held library, no note. There is nothing
// to point at either — a game is born holding the library and there is no way
// to add one from the studio, so the preamble stops at the folder itself.
test('a game without the input library gets no note about it', async (t) => {
  const llm = createFakeLlm([says('Noted.')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'controller support please');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.ok(!/^studio\/input\.js:$/m.test(system), 'no note without a library');
  assert.ok(!system.includes('+ Controls'), 'and no button to point at');
  // The tags are the one thing a helper has to get right on its own, so they
  // are said whether or not this game holds anything yet.
  assert.match(system, /needs its <script> tag in index\.html before the game's own scripts/);
});

// The brief is the one project file that goes into the system prompt whole, so
// it is the one an agent can grow until it crowds out everything else.
test('an oversized brief is cut, and says where', async (t) => {
  const llm = createFakeLlm([says('Seen.')]);
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/BRIEF.md', {
    rawBody: `${'a brief line\n'.repeat(4000)}the last line`,
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  // Only the system-prompt copy is cut. The file block carries BRIEF.md like
  // any other file, so the tail is still reachable — it is kept out of the
  // preamble, not withheld.
  const { system } = llm.lastCall();
  const briefSection = system.slice(
    system.indexOf('Project brief'), system.indexOf('You are the Builder'),
  );
  assert.match(briefSection, /cut here: BRIEF\.md is 52013 bytes/);
  assert.ok(!briefSection.includes('the last line'), 'the tail is not in that copy');
  assert.ok(briefSection.length < 34 * 1024, `the brief section is ${briefSection.length} bytes`);
});

test('pinning takes priority but does not exempt a file from the cap', async (t) => {
  const llm = createFakeLlm([says('Seen.')]);
  const { app } = await studio(t, { llm });
  // 460 KB pinned against the 400 KB ambient cap. A pin used to bypass the cap
  // outright, so 50 paths a turn across three turns could carry 10 MB each.
  const sizes = [90, 91, 92, 93, 94];
  for (const kb of sizes) {
    await app.client.json('PUT', `/api/projects/tank/files/js/f${kb}.js`, {
      rawBody: `// ${'x'.repeat(kb * 1000 - 4)}\n`,
    });
  }
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'look at all of these', sizes.map((kb) => `js/f${kb}.js`));
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system, messages } = llm.lastCall();
  // Smallest-first, so the largest pinned file is the one left out — named, as
  // a dropped file always is.
  assert.match(system, /--- FILE: js\/f90\.js \(90000 bytes\) ---/);
  assert.ok(!system.includes('--- FILE: js/f94.js'), 'the largest is not sent');
  assert.match(system, /left out for size[^\n]*js\/f94\.js/);
  // The dropped pin is still what the human is pointing at, so the person's
  // message names it with the rest.
  assert.match(
    messages.at(-3).content,
    /the user pinned these files: js\/f90\.js, js\/f91\.js, js\/f92\.js, js\/f93\.js, js\/f94\.js/,
  );
});

// The block's internal order is what the prompt cache pays for: contents
// least-recently-modified first, so an edit only re-bills the block from the
// file it touched onward; the tree, which changes on every edit because it
// carries every size, comes last.
test('the file block is emitted coldest-first with the tree at the end', async (t) => {
  const llm = createFakeLlm([says('Seen.')]);
  const { app, dir } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/js/new.js', { rawBody: 'let hot = 1;' });
  await app.client.json('PUT', '/api/projects/tank/files/js/old.js', { rawBody: 'let cold = 1;' });
  // Age one file well past the other; the clock decides, not name or size.
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, 'js/old.js'), past, past);

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await send(app, 'have a look');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  const at = (s) => system.indexOf(s);
  assert.ok(at('--- FILE: js/old.js') !== -1 && at('--- FILE: js/new.js') !== -1);
  assert.ok(at('--- FILE: js/old.js') < at('--- FILE: js/new.js'), 'oldest first');
  assert.ok(at('--- FILE: js/new.js') < at('PROJECT FILES'), 'the tree trails the contents');
});

test('a file the validator refuses is listed but never opened', async (t) => {
  const llm = createFakeLlm([says('Seen.')]);
  const { app, dir } = await studio(t, { llm });
  // A trailing space is legal on disk and refused by path validation, so no
  // tool can touch it and the games origin will not serve it either.
  fs.writeFileSync(path.join(dir, 'stray.js '), 'let a = 1;');
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'what is in here?');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system } = llm.lastCall();
  assert.match(system, /stray\.js {2}\(10 bytes\) \[cannot be opened/);
  assert.ok(!system.includes('--- FILE: stray.js'), 'and its bytes are not sent');
});

test('a trimmed transcript says where it was trimmed', async (t) => {
  const llm = createFakeLlm([says('Caught up.')]);
  const { app } = await chatStudio(t, { llm, chatty: false });
  // Nine messages of 31 KB is over the 200 KB history budget. A quiet agent
  // means none of them fires, so the whole pile is there when one does.
  // Trimming cuts back to half the budget, not to the line — that is what
  // lets the seam hold still for the fires that follow instead of moving one
  // message at a time, re-billing the transcript as a cache miss each fire.
  const long = 'w'.repeat(31 * 1024);
  for (let i = 0; i < 9; i += 1) {
    await send(app, `${i} ${long}`);
  }
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'catch up @Designer');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );

  // The marker sits where the seam is: right before the oldest surviving turn.
  const first = llm.lastCall().messages[0].content;
  assert.match(first, /\[studio\] Earlier messages are not shown \(6 trimmed to fit\)\.\n\n\[Dann\] 6 /);
  assert.ok(!first.includes('[Dann] 5 '), 'and the trimmed ones are gone');

  // And the person is told too, on the reply that could not see them.
  assert.equal(reply.data.trimmed, 6);
});

test('the trim seam holds still while the next fires fit their budget', async (t) => {
  const llm = createFakeLlm((opts, i) => says(i === 0 ? 'Noted.' : 'Again.'));
  const { app } = await chatStudio(t, { llm, chatty: false });
  const long = 'w'.repeat(31 * 1024);
  for (let i = 0; i < 9; i += 1) {
    await send(app, `${i} ${long}`);
  }
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'catch up @Designer');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Noted.');
  const firstSeam = llm.lastCall().messages[0].content.match(/\((\d+) trimmed/)[1];

  // A small follow-up fits the halved transcript, so the boundary must not
  // move: the same turns survive and the seam line is byte-identical, which
  // is what the prompt cache needs to hit on the whole prefix.
  await send(app, 'and again @Designer');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.body === 'Again.');
  const secondSeam = llm.lastCall().messages[0].content.match(/\((\d+) trimmed/)[1];
  assert.equal(secondSeam, firstSeam, 'the seam did not move');
});

test('a reply that saw the whole conversation says nothing about trimming', async (t) => {
  const llm = createFakeLlm([says('All of it.')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'hello');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  // Null rather than 0: the field reports something having happened.
  assert.equal(reply.data.trimmed, null);
});

test('a fire that grows too big stops instead of walking the window', async (t) => {
  // 200 KB of file content echoed back per turn, against a 512 KB loop budget.
  const big = 'x'.repeat(200_000);
  const llm = createFakeLlm((opts, turn) => calls([
    { name: 'write_file', input: { path: `js/part${turn}.js`, content: big } },
  ]));
  const { app } = await studio(t, { llm, maxContinuations: 0 });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'write the whole engine');
  // In the builder's room a reply that hits a wall first says it turned out
  // bigger than one go and asks the sizing what is left; sized small again
  // with no continuation to spend, the wall itself is named (spec.md §8).
  const banner = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /too much to hold in one reply/.test(e.data.body),
  );
  assert.match(banner.data.body, /too much to hold in one reply/);
  assert.equal(llm.calls.length, 3, 'three turns of growth, not twenty-four');
});

test('the studio budget stops a fire before the API is called', async (t) => {
  const llm = createFakeLlm([says('should never run')]);
  const { app } = await studio(t, { llm, dailyTokenBudget: 10 });
  app.db.prepare('UPDATE studio_state SET tokens_used_today = 999 WHERE id = 1').run();

  const stream = await openStream(app.client);
  t.after(() => stream.close());
  await send(app, 'hello');

  const banner = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system',
  );
  assert.match(banner.data.body, /out of tokens/);
  assert.equal(llm.calls.length, 0, 'no request is made when the budget is gone');
});

// ⚠️ A chat project's helper is having a conversation: no tools, no judge, no
// sizing — one call at the level it was given, and its thinking is all the
// answer is made of.
test('a chat helper fires once, at its own level, with nothing in front', async (t) => {
  const llm = createFakeLlm([says('I would start with movement.')]);
  const { app } = await chatStudio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'make the ship turn a bit faster');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(llm.asked.length, 0, 'no call ahead of the fire');
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].thinking, 'low', 'the level it was set to');
  assert.equal(llm.calls[0].tools, null);
});

test('a reply charges the budget with the cache discount applied', async (t) => {
  const llm = createFakeLlm([says('Charged.', { tokens: 40 })], [answers('{"size":"reply"}')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  await stream.waitFor((e) => e.event === 'agent.stream.end' && e.data.message_id);

  const state = budgetState(app.db);
  // The sizing ahead of the fire (spec.md §8), at the fake's complete defaults
  // of 200 + 40×4; then the fire: 100 prompt tokens, all misses, plus 40
  // completion at four times a miss.
  assert.equal(state.used, (200 + 40 * 4) + (100 + 40 * 4));
});

// The same number the budget was charged, kept on the reply that spent it, so
// a turn that carried on from itself is visibly more expensive than one that
// did not.
test('what a reply cost is recorded on the reply', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'write_file', input: { path: 'index.html', content: '<h1>Tank</h1>' } }],
      { tokens: 25 }),
    says('Built it.', { tokens: 40 }),
  ], [answers('{"size":"reply"}')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );

  // Both turns of the one fire, output at four: (100 + 25×4) + (100 + 40×4).
  // The sizing ahead of it (200 + 40×4) is billed and shown on no row
  // (spec.md §8), so the budget carries it and the reply does not.
  assert.equal(reply.data.tokens, 460);
  assert.equal(budgetState(app.db).used, 360 + 460);

  // Nothing a person or the studio wrote costs anything.
  const posted = await app.client.json('GET', `/api/projects/tank/messages?chat=${app.chatId}`);
  const human = posted.body.messages.find((m) => m.user_id !== null);
  assert.equal(human.tokens, null);
});

test('a truncated tool call is explained rather than silently dropped', async (t) => {
  // Cut off every turn, so no retry can succeed and the banner is the outcome.
  const llm = createFakeLlm(() => truncated({ text: 'Writing the game...' }));
  const { app } = await studio(t, { llm, maxAssistantTurns: 2, maxContinuations: 0 });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'build the whole thing at once');
  const banner = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /ran out of output budget/.test(e.data.body),
  );
  assert.match(banner.data.body, /a file may be missing/);
});

test('a cut-off write is retried instead of ending the turn empty-handed', async (t) => {
  // Turn 1 is cut mid-write_file; turn 2 writes the file properly. Before the
  // fix the empty call list ended the loop and the file never existed.
  const sent = [];
  const llm = createFakeLlm((opts, turn) => {
    sent.push(opts.messages.map((m) => ({ role: m.role, content: m.content })));
    if (turn === 0) return truncated({ text: 'Writing the game...' });
    if (turn === 1) {
      return calls(
        [{ name: 'write_file', input: { path: 'index.html', content: '<h1>tank</h1>' } }],
        { text: 'Wrote it in smaller pieces.' },
      );
    }
    return says('All done.');
  });
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'build the whole thing at once');
  await stream.waitFor((e) => e.event === 'files.changed');

  const file = await app.client.get('/api/projects/tank/files/index.html');
  assert.equal(file.status, 200, 'the file the model was cut off writing exists');
  assert.equal(await file.text(), '<h1>tank</h1>');

  // The model was told what happened, in terms it can act on.
  const retry = sent[1];
  const last = retry[retry.length - 1];
  assert.equal(last.role, 'user');
  assert.match(last.content, /was NOT written/);
});

test('a cut-off call that a later turn rewrote is not reported as missing', async (t) => {
  const llm = createFakeLlm((opts, turn) => {
    if (turn === 0) return truncated({ text: 'Writing...' });
    if (turn === 1) {
      return calls([{ name: 'write_file', input: { path: 'index.html', content: 'ok' } }]);
    }
    return says('All done.');
  });
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'build it');
  const done = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(done.data.kind, null, 'the reply lands as an ordinary message');

  const history = await app.client.json('GET', '/api/projects/tank/messages');
  const banners = history.body.messages.filter((m) => m.kind === 'system');
  assert.deepEqual(banners, [], 'no scary banner for a hole that got filled');
});

test('the tool call limit stops the loop and says so', async (t) => {
  // Every turn asks for another write, so only the limit ends it.
  const llm = createFakeLlm((opts, turn) =>
    calls([{ name: 'write_file', input: { path: `f${turn}.txt`, content: `${turn}` } }]));
  // The builder's reply runs under its small budget (spec.md §8), and with no
  // continuation to spend the wall is named once what is left has been sized.
  const { app } = await studio(t, {
    llm, smallToolCalls: 3, smallTurns: 8, maxContinuations: 0,
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go forever');
  const banner = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /stopped after/.test(e.data.body),
  );
  assert.match(banner.data.body, /stopped after 3 tool calls/);
  const listing = await app.client.json('GET', '/api/projects/tank/files');
  assert.equal(listing.body.count, 3, 'exactly the allowance was spent');
});

test('running out of turns carries on rather than needing a nudge', async (t) => {
  const llm = createFakeLlm((opts, turn) =>
    calls([{ name: 'read_file', input: { path: `nope${turn}.txt` } }]));
  const { app } = await studio(t, {
    llm, smallTurns: 3, smallToolCalls: 50, maxContinuations: 1,
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'loop please');
  const carrying = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /carrying on/.test(e.data.body),
  );
  assert.match(carrying.data.body, /not finished yet/);

  // One continuation was allowed, so the second exhaustion is the last word.
  const stopped = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /stopped after/.test(e.data.body),
  );
  assert.match(stopped.data.body, /stopped after 3 turns without finishing/);
  assert.equal(llm.calls.length, 6, 'three turns, then three more');
});

test('a continuation is answerable — the agent sees a turn to reply to', async (t) => {
  // The orchestrator pushes onto the same messages array all fire long, and
  // the fake keeps it by reference, so what was *sent* has to be copied here.
  const sent = [];
  const llm = createFakeLlm((opts, turn) => {
    sent.push(opts.messages.map((m) => ({ role: m.role, content: m.content })));
    return calls([{ name: 'read_file', input: { path: `nope${turn}.txt` } }]);
  });
  const { app } = await studio(t, {
    llm, smallTurns: 2, smallToolCalls: 50, maxContinuations: 1,
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'loop please');
  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /stopped after/.test(e.data.body),
  );

  // Two turns per fire, so the continuation's first request is the third.
  // It reached the model at all only because buildContext found a user-role
  // turn to answer — the studio note is what supplies one; in the builder's
  // room the sizing then rides that note and the fire adds its own turn.
  const continuation = sent[2];
  assert.ok(continuation, 'the continuation reached the model');
  const last = continuation[continuation.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(
    continuation.some((m) => m.role === 'user' && /carrying on/.test(m.content)),
    'the note is what it answers',
  );
});

test('a new human message refills the continuation allowance', async (t) => {
  const llm = createFakeLlm((opts, turn) =>
    calls([{ name: 'read_file', input: { path: `nope${turn}.txt` } }]));
  const { app } = await studio(t, {
    llm, maxAssistantTurns: 2, maxToolCalls: 50, maxContinuations: 1,
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'first');
  const exhausted = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /stopped after/.test(e.data.body),
  );
  const spent = llm.calls.length;

  // waitFor also matches events that already arrived, so the second round has
  // to be identified by id rather than by body.
  await send(app, 'second');
  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /carrying on/.test(e.data.body) && e.data.id > exhausted.data.id,
  );
  assert.ok(llm.calls.length > spent, 'the allowance came back');
});

// The orchestrator logs the upstream error on purpose; quiet it so a passing
// run has clean output.
function quietErrors(t) {
  const realError = console.error;
  console.error = () => {};
  t.after(() => { console.error = realError; });
}

test('a failed stream keeps what the agent had already said', async (t) => {
  quietErrors(t);
  const { app } = await studio(t, { llm: createFailingLlm() });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(reply.data.body, 'partial');

  // A message landed, so the end event says so rather than error: an error
  // after message.new would leave a ghost live entry in the client.
  const ended = await stream.waitFor((e) => e.event === 'agent.stream.end');
  assert.equal(ended.data.message_id, reply.data.id);
  assert.equal(ended.data.error, undefined);

  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /cut off mid-reply/.test(e.data.body),
  );
});

test('a stream that dies before saying anything ends with an error and no message', async (t) => {
  quietErrors(t);
  const { app } = await studio(t, { llm: createFailingLlm('boom', { partial: '' }) });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const before = app.db.prepare('SELECT COUNT(*) c FROM messages').get().c;
  await send(app, 'go');
  const ended = await stream.waitFor((e) => e.event === 'agent.stream.end');
  assert.equal(ended.data.error, true);

  await new Promise((resolve) => setTimeout(resolve, 80));
  // Only the human's own message was stored.
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM messages').get().c, before + 1);
});

test('a failed stream still commits the files earlier turns wrote', async (t) => {
  quietErrors(t);
  // Turn one writes a file and finishes cleanly; turn two dies mid-sentence.
  const llm = {
    calls: [],
    stream(opts) {
      llm.calls.push(opts);
      const events = llm.calls.length === 1
        ? calls([{ name: 'write_file', input: { path: 'js/game.js', content: 'go()' } }],
          { text: 'Working on it.' })
        : null;
      return (async function* generate() {
        if (events) {
          for (const event of events) yield event;
        } else {
          yield { type: 'delta', text: 'And then' };
          throw new Error('boom');
        }
      })();
    },
  };
  const { app, dir } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'make a start');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  // The dying turn's words are the last thing said, so they are the reply;
  // the first turn's are its working, kept the way any reply's are.
  assert.equal(reply.data.body, 'And then');
  assert.equal(reply.data.working, true);

  // The write is committed and credited, not stranded dirty in the tree.
  const [head] = await logCommits(dir, { limit: 1 });
  assert.match(head.subject, /^Builder: And then/);
  assert.deepEqual(reply.data.writes.map((w) => [w.path, w.commit_sha]), [['js/game.js', head.sha]]);
  const changed = await stream.waitFor((e) => e.event === 'files.changed');
  assert.deepEqual(changed.data.paths, ['js/game.js']);

  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /cut off mid-reply/.test(e.data.body),
  );
});

// Not the stream failing — the studio failing. A git lock, a database that
// will not write, a full disk: none of them reach the salvage path above, and
// all of them used to end as a console line with the browser still saying
// "Thinking…", because the start event had gone out and nothing answered it.
test('a fault after the stream starts still ends the stream and says so', async (t) => {
  quietErrors(t);
  const llm = createFakeLlm([says('All done.')]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  // The reply's own broadcast is the easiest thing to break from out here.
  // Once only, and not the human's message, which the fire needs to happen.
  const real = app.broker.broadcast.bind(app.broker);
  let broken = false;
  app.broker.broadcast = (event, data) => {
    if (!broken && event === 'message.new' && data.agent_id !== null) {
      broken = true;
      throw new Error('boom');
    }
    return real(event, data);
  };
  t.after(() => { app.broker.broadcast = real; });

  await send(app, 'go');
  const ended = await stream.waitFor((e) => e.event === 'agent.stream.end');
  assert.equal(ended.data.error, true);
  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /ran into a problem/.test(e.data.body),
  );
});

// ⚠️ The whole point of the cap: a turn that runs away thinking is asked
// again with thinking off, so the reply is an answer rather than nine minutes
// of nothing (spec.md §14). In the builder's room a first-turn cap goes to
// the sizing instead (test/builder.test.js); this is the retry a chat
// project's helper gets.
test('a runaway trace is retried with thinking off, and says so', async (t) => {
  const llm = {
    calls: [],
    stream(opts) {
      llm.calls.push(opts);
      const nth = llm.calls.length;
      return (async function* generate() {
        if (nth === 1) {
          yield { type: 'reasoning', text: 'and another thing. ' };
          const err = new Error('thought too long');
          err.code = 'thinking_cap';
          err.reasoningChars = 35_000;
          throw err;
        }
        for (const event of says('Started on movement.')) yield event;
      })();
    },
  };
  const { app } = await chatStudio(t, { llm, agent: { thinking: 'full' } });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'build me a tank game');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null && e.data.kind !== 'system',
  );
  assert.equal(reply.data.body, 'Started on movement.');

  // The runaway turn, then the same turn again with thinking off.
  assert.equal(llm.calls[0].thinking, 'full');
  assert.equal(llm.calls[1].thinking, 'none');
  // The retry carries what the runaway turn had worked out, as notes on the
  // user turn: dropped, it under-delivers; handed, it follows the design
  // (spec.md §14). Once, in this fire, and never to the next one — the test
  // below this one holds that line.
  const handed = llm.calls[1].messages
    .find((m) => m.role === 'user' && /your notes so far/.test(m.content));
  assert.ok(handed, 'the trace is handed to the retry');
  assert.match(handed.content, /and another thing/);

  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /stop planning and start working/.test(e.data.body),
  );

  // ⚠️ The abandoned attempt is charged from an estimate of its trace. No
  // usage frame arrives for a stream nobody let finish, but the tokens were
  // generated and the key is paying for them, so the reply's cost carries
  // 35,000 characters' worth on top of what the two real turns reported.
  assert.ok(
    reply.data.tokens >= tokensForChars(35_000),
    `${reply.data.tokens} should include the abandoned trace`,
  );
});

test('a reply that was all thinking says that, not that a file was cut', async (t) => {
  const { app } = await studio(t, { llm: createFakeLlm([thinksOnly()]) });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'build me a tank game');
  const banner = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system',
  );
  // Nothing was started, so nothing was cut in half: the old wording sent
  // somebody looking for a half-written file that was never begun.
  assert.match(banner.data.body, /never got as far as writing/);
  assert.doesNotMatch(banner.data.body, /missing or incomplete/);
});

test('a reply that produces nothing at all says so', async (t) => {
  // No prose, no files, no limit reached: the end event takes the live entry
  // away, so without a word the row simply vanishes.
  const { app } = await studio(t, { llm: createFakeLlm([says('')]) });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  const ended = await stream.waitFor((e) => e.event === 'agent.stream.end');
  assert.equal(ended.data.message_id, undefined);
  assert.equal(ended.data.error, undefined);
  await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system'
      && /without saying anything/.test(e.data.body),
  );
});

test('an archived project never fires an agent', async (t) => {
  const llm = createFakeLlm([says('should not run')]);
  const { app } = await studio(t, { llm });
  await app.client.json('POST', '/api/projects/tank/archive', { body: {} });

  const res = await send(app, 'anyone there?');
  assert.equal(res.status, 409, 'the message itself is refused');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(llm.calls.length, 0);
});

test('a detached agent stops answering', async (t) => {
  const llm = createFakeLlm([says('one'), says('two')]);
  const { app, agentId } = await chatStudio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'first');
  await stream.waitFor((e) => e.event === 'agent.stream.end' && e.data.message_id);
  await (await app.client.request(
    'DELETE', `/api/projects/talk/chats/${app.chatId}/agents/${agentId}`,
  )).text();

  await send(app, 'second');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(llm.calls.length, 1);
});

// ⚠️ The builder's seat is the room's: the same route refuses, and the room
// keeps answering.
test('the builder cannot be taken out of its room', async (t) => {
  const llm = createFakeLlm([says('Still here.')]);
  const { app, agentId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  const taken = await app.client.request(
    'DELETE', `/api/projects/tank/chats/${app.chatId}/agents/${agentId}`,
  );
  assert.equal(taken.status, 409);
  await taken.text();

  await send(app, 'anyone?');
  const reply = await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(reply.data.body, 'Still here.');
});

test('two agents both answer the same message', async (t) => {
  const llm = createFakeLlm([says('From one.'), says('From two.')]);
  const { app } = await chatStudio(t, { llm });
  const second = await app.client.json('POST', '/api/agents', {
    body: { name: 'Critic', description: 'You critique.' },
  });
  await putInChat(app, 'talk', second.body.id, { chatty: true, chat_id: app.chatId });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'thoughts, everyone?');
  await stream.waitFor((e) => e.event === 'message.new' && /From one/.test(e.data.body ?? ''));
  await stream.waitFor((e) => e.event === 'message.new' && /From two/.test(e.data.body ?? ''));
  assert.equal(llm.calls.length, 2);
});

test('a message posted mid-fire is picked up afterwards', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let turn = 0;
  const llm = {
    calls: [],
    stream(opts) {
      llm.calls.push(opts);
      const mine = turn;
      turn += 1;
      return (async function* generate() {
        // Hold the first fire open so the second message arrives while it runs.
        if (mine === 0) await gate;
        yield { type: 'delta', text: `reply ${mine}` };
        yield {
          type: 'end',
          text: `reply ${mine}`,
          finish_reason: 'stop',
          usage: { prompt_tokens: 10, prompt_cache_miss_tokens: 10, completion_tokens: 1 },
        };
      })();
    },
  };

  const { app, agentId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'first');
  await stream.waitFor((e) => e.event === 'agent.stream.start');
  await send(app, 'second');
  // Still one fire in flight; the dirty bit is set for the next.
  assert.equal(llm.calls.length, 1);
  assert.equal(
    app.db.prepare('SELECT response_pending FROM chat_agents WHERE agent_id = ?')
      .get(agentId).response_pending,
    1,
  );

  release();
  await stream.waitFor((e) => e.event === 'message.new' && /reply 1/.test(e.data.body ?? ''));
  assert.equal(llm.calls.length, 2, 'the pending flag produced exactly one more fire');
});
