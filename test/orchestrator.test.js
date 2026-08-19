import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn, openStream } from './helpers.js';
import {
  createFakeLlm, createFailingLlm, says, calls, truncated,
} from './fake-llm.js';
import { logCommits } from '../server/files/git.js';
import { budgetState } from '../server/budget.js';

// A studio with one project and one agent attached.
async function studio(t, { llm, chatty = true, agent = {}, ...opts } = {}) {
  const app = await setup({ llm, ...opts });
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const created = await app.client.json('POST', '/api/agents', {
    body: { name: 'Designer', description: 'You design games.', ...agent },
  });
  await app.client.json('POST', '/api/projects/tank/agents', {
    body: { agent_id: created.body.id, chatty },
  });
  return { app, dir: path.join(app.gamesDir, 'tank'), agentId: created.body.id };
}

const send = (app, body, contextPaths) =>
  app.client.json('POST', '/api/projects/tank/messages', {
    body: { body, ...(contextPaths ? { context_paths: contextPaths } : {}) },
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
  const { app } = await studio(t, { llm, chatty: false });

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
  const { app } = await studio(t, {
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

  const toolEvent = await stream.waitFor((e) => e.event === 'agent.tool');
  assert.equal(toolEvent.data.tool, 'write_file');
  assert.equal(toolEvent.data.path, 'index.html');

  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), '<h1>Tank</h1>');

  // One commit for the turn, authored by the agent.
  const [head] = await logCommits(dir, { limit: 1 });
  assert.match(head.subject, /^Designer: /);
  assert.equal(head.author, 'Designer');
  assert.equal(head.email, 'tank@agent.gamestudio.local');

  assert.deepEqual(reply.data.writes.map((w) => [w.path, w.action]), [['index.html', 'create']]);
  assert.equal(reply.data.writes[0].commit_sha, head.sha);
  assert.match(reply.data.body, /Scaffolding the page/);
  assert.match(reply.data.body, /index\.html is up/);

  const changed = await stream.waitFor((e) => e.event === 'files.changed');
  assert.deepEqual(changed.data.paths, ['index.html']);
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

test('an agent without file tools is offered none', async (t) => {
  const llm = createFakeLlm([says('I only have opinions.')]);
  const { app } = await studio(t, {
    llm, agent: { name: 'Critic', description: 'You critique.', file_tools: false },
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'thoughts?');
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);
  assert.equal(llm.lastCall().tools, null);
  assert.match(llm.lastCall().system, /no file tools/);
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

test('the context carries the tree, the brief, and pinned labels', async (t) => {
  const llm = createFakeLlm([says('Seen.')]);
  const { app } = await studio(t, { llm });
  await app.client.json('PUT', '/api/projects/tank/files/BRIEF.md', {
    rawBody: 'Keep it under 200KB and playable with one hand.',
  });
  await app.client.json('PUT', '/api/projects/tank/files/js/game.js', { rawBody: 'let a = 1;' });
  await app.client.json('PUT', '/api/projects/tank/files/sprite.png', {
    rawBody: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'look at this', ['js/game.js']);
  await stream.waitFor((e) => e.event === 'message.new' && e.data.agent_id !== null);

  const { system, messages } = llm.lastCall();
  assert.match(system, /Keep it under 200KB/, 'the brief is injected');
  assert.match(system, /You design games\./, 'the agent description is injected');
  assert.match(system, /prefer patch_file/i);

  // The studio asks for many small files, a config/ directory, and the three
  // project documents.
  assert.match(system, /many small files/);
  assert.match(system, /config\/play\.js/);
  assert.match(system, /config\/words\.js/);
  assert.match(system, /`const NAME = value;`/);
  assert.match(system, /BRIEF\.md — the file map/);
  assert.match(system, /SPEC\.md — what the game is/);
  assert.match(system, /TODO\.md — one task per line/);

  // Everything the studio can do that an agent cannot do for itself has to be
  // named here, or it may as well not exist: an agent that does not know a
  // person can draw a sprite in one click writes the game without one.
  assert.match(system, /Input\.update\(\)/);
  assert.match(system, /Input\.axis\("left", "right"\)/);
  assert.match(system, /config\/controls\.js/);
  assert.match(system, /"\+ Controls"/);
  assert.match(system, /"\+ Draw a picture"/);
  assert.match(system, /"\+ Make a sound"/);
  assert.match(system, /"\+ Upload"/);
  assert.match(system, /an \.svg is text/, 'the one picture an agent can make itself');

  // The files sit in the system prompt, ahead of the transcript, so the prefix
  // a second fire matches on includes them (spec.md §8).
  assert.match(system, /PROJECT FILES/);
  assert.match(system, /js\/game\.js \(10 bytes\)/);
  assert.match(system, /\[pinned by the user\]/);
  assert.match(system, /\[binary: sprite\.png, 4 bytes\]/, 'binaries are named, not sent');

  // The last user message is the human's, and nothing else here.
  assert.equal(messages.at(-1).content, '[Dann] look at this');
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
    system.indexOf('Project brief'), system.indexOf('PROJECT FILES'),
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

  const { system } = llm.lastCall();
  // Smallest-first, so the largest pinned file is the one left out — named, as
  // a dropped file always is.
  assert.match(system, /--- FILE: js\/f90\.js \(90000 bytes\) \[pinned by the user\] ---/);
  assert.ok(!system.includes('--- FILE: js/f94.js'), 'the largest is not sent');
  assert.match(system, /left out for size[^\n]*js\/f94\.js/);
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
  const { app } = await studio(t, { llm, chatty: false });
  // Nine messages of 31 KB is over the 200 KB history budget. A quiet agent
  // means none of them fires, so the whole pile is there when one does.
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
  assert.match(first, /\[studio\] Earlier messages are not shown \(3 trimmed to fit\)\.\n\n\[Dann\] 3 /);
  assert.ok(!first.includes('[Dann] 2 '), 'and the trimmed ones are gone');

  // And the person is told too, on the reply that could not see them.
  assert.equal(reply.data.trimmed, 3);
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
  const banner = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system',
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

test('a reply charges the budget with the cache discount applied', async (t) => {
  const llm = createFakeLlm([says('Charged.', { tokens: 40 })]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  await stream.waitFor((e) => e.event === 'agent.stream.end' && e.data.message_id);

  const state = budgetState(app.db);
  // 100 prompt tokens, all misses, plus 40 completion.
  assert.equal(state.used, 140);
});

// The same number the budget was charged, kept on the reply that spent it, so
// a turn that carried on from itself is visibly more expensive than one that
// did not.
test('what a reply cost is recorded on the reply', async (t) => {
  const llm = createFakeLlm([
    calls([{ name: 'write_file', input: { path: 'index.html', content: '<h1>Tank</h1>' } }],
      { tokens: 25 }),
    says('Built it.', { tokens: 40 }),
  ]);
  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go');
  const reply = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.agent_id !== null,
  );

  // Both turns of the one fire: (100 + 25) + (100 + 40).
  assert.equal(reply.data.tokens, 265);
  assert.equal(budgetState(app.db).used, 265);

  // Nothing a person or the studio wrote costs anything.
  const posted = await app.client.json('GET', '/api/projects/tank/messages');
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
  const { app } = await studio(t, { llm, maxToolCalls: 3, maxAssistantTurns: 8 });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'go forever');
  const banner = await stream.waitFor(
    (e) => e.event === 'message.new' && e.data.kind === 'system',
  );
  assert.match(banner.data.body, /stopped after 3 tool calls/);
  const listing = await app.client.json('GET', '/api/projects/tank/files');
  assert.equal(listing.body.count, 3, 'exactly the allowance was spent');
});

test('running out of turns carries on rather than needing a nudge', async (t) => {
  const llm = createFakeLlm((opts, turn) =>
    calls([{ name: 'read_file', input: { path: `nope${turn}.txt` } }]));
  const { app } = await studio(t, {
    llm, maxAssistantTurns: 3, maxToolCalls: 50, maxContinuations: 1,
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
    llm, maxAssistantTurns: 2, maxToolCalls: 50, maxContinuations: 1,
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
  // turn to answer — the studio note is what supplies one.
  const continuation = sent[2];
  assert.ok(continuation, 'the continuation reached the model');
  const last = continuation[continuation.length - 1];
  assert.equal(last.role, 'user');
  assert.match(last.content, /carrying on/);
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

test('an upstream failure ends the stream without a message', async (t) => {
  // The orchestrator logs the upstream error on purpose; quiet it here so a
  // passing run has clean output.
  const realError = console.error;
  console.error = () => {};
  t.after(() => { console.error = realError; });

  const { app } = await studio(t, { llm: createFailingLlm() });
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
  const { app, agentId } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'first');
  await stream.waitFor((e) => e.event === 'agent.stream.end' && e.data.message_id);
  await (await app.client.request('DELETE', `/api/projects/tank/agents/${agentId}`)).text();

  await send(app, 'second');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(llm.calls.length, 1);
});

test('two agents both answer the same message', async (t) => {
  const llm = createFakeLlm([says('From one.'), says('From two.')]);
  const { app } = await studio(t, { llm });
  const second = await app.client.json('POST', '/api/agents', {
    body: { name: 'Critic', description: 'You critique.' },
  });
  await app.client.json('POST', '/api/projects/tank/agents', {
    body: { agent_id: second.body.id, chatty: true },
  });
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

  const { app } = await studio(t, { llm });
  const stream = await openStream(app.client);
  t.after(() => stream.close());

  await send(app, 'first');
  await stream.waitFor((e) => e.event === 'agent.stream.start');
  await send(app, 'second');
  // Still one fire in flight; the dirty bit is set for the next.
  assert.equal(llm.calls.length, 1);
  assert.equal(
    app.db.prepare('SELECT response_pending FROM project_agents LIMIT 1').get().response_pending,
    1,
  );

  release();
  await stream.waitFor((e) => e.event === 'message.new' && /reply 1/.test(e.data.body ?? ''));
  assert.equal(llm.calls.length, 2, 'the pending flag produced exactly one more fire');
});
