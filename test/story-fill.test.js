// The story's two small asks: lines from a sentence, and a flat SVG the
// browser turns into the PNG the story expects. Neither is a fire — no
// message row, no receipt, no cooldown — but both go through the same two
// walls and are billed to whoever pressed the button (spec.md §6, §10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn } from './helpers.js';
import { createFakeLlm, answers } from './fake-llm.js';
import { SVG_BYTES } from '../server/story.js';

const CAST = [
  { key: 'mila', name: 'Mila', about: 'nine, curious' },
  { key: 'cat', name: 'The cat', about: '' },
];

const FILL_BODY = {
  sentence: 'she finds the cat under the table',
  scene: { key: 'hall', about: 'a warm hallway that smells of toast' },
  cast: CAST,
  lines: [{ who: 'mila', say: 'Hello?' }],
};

const svg = (body = '<rect width="480" height="270" fill="#123"/>') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">${body}</svg>`;

const PICTURE_BODY = { kind: 'background', name: 'hall', about: 'a warm hallway' };

// A studio with a game to ask about, and a scripted answer per ask. The
// close is registered before anything can fail, or a broken assertion leaves
// a listener open and the runner never exits.
async function studio(t, completions) {
  const llm = createFakeLlm([], completions);
  const app = await setup({ llm });
  t.after(() => app.close());
  const user = await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Story', slug: 'story' } });
  return { app, user, llm };
}

const fill = (app, body = FILL_BODY, slug = 'story') => app.client.json('POST', `/api/projects/${slug}/story/fill`, { body });
const picture = (app, body = PICTURE_BODY, slug = 'story') => app.client.json('POST', `/api/projects/${slug}/story/picture`, { body });

/* The fill ----------------------------------------------------------------- */

test('a sentence comes back as lines in the story\'s own keys', async (t) => {
  const { app, user, llm } = await studio(t, [answers(JSON.stringify({
    lines: [
      { who: 'mila', say: 'There you are!' },
      { who: '', say: 'The cat did not move.' },
    ],
  }), { tokens: 60, prompt: 300 })]);

  const res = await fill(app);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.lines, [
    { who: 'mila', say: 'There you are!' },
    { who: '', say: 'The cat did not move.' },
  ]);

  // The prompt is built from the story: the cast with what is known about
  // them, the place, what has been said, and the sentence.
  const asked = llm.lastAsked();
  const prompt = asked.messages[0].content;
  assert.match(prompt, /mila \(Mila\): nine, curious/);
  assert.match(prompt, /The scene is called hall\. a warm hallway that smells of toast/);
  assert.match(prompt, /- mila: Hello\?/);
  assert.match(prompt, /What happens: she finds the cat under the table/);
  // No tools, no trace, and a small ceiling: this is a paragraph, not a game.
  assert.equal(asked.tools, undefined);
  assert.equal(asked.maxTokens, 1024);

  // Billed like a fire, to whoever pressed. 300 miss + 60 out.
  const spent = app.db
    .prepare('SELECT tokens FROM user_tokens WHERE user_id = ?').get(user.id);
  assert.equal(spent.tokens, 360);
  assert.equal(res.body.tokens, 360);
  assert.equal(
    app.db.prepare('SELECT tokens_used_today AS n FROM studio_state WHERE id = 1').get().n,
    360,
  );

  // ⚠️ Not a fire: nothing said, nothing kept.
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
});

test('a speaker the cast does not hold becomes the story narrating', async (t) => {
  const { app } = await studio(t, [answers(JSON.stringify({
    lines: [{ who: 'gandalf', say: 'You shall not pass.' }],
  }))]);
  const res = await fill(app);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.lines, [{ who: '', say: 'You shall not pass.' }]);
});

test('JSON behind a fence, or after a sentence, still reads', async (t) => {
  const { app } = await studio(t, [
    answers('```json\n{"lines": [{"who": "mila", "say": "Oh!"}]}\n```'),
    answers('Here you go:\n{"lines": [{"who": "", "say": "It was quiet."}]}\nHope that helps.'),
  ]);
  const fenced = await fill(app);
  assert.deepEqual(fenced.body.lines, [{ who: 'mila', say: 'Oh!' }]);
  const chatty = await fill(app);
  assert.deepEqual(chatty.body.lines, [{ who: '', say: 'It was quiet.' }]);
});

test('nothing usable back is a 502 and not an empty answer', async (t) => {
  const { app } = await studio(t, [
    answers('I would rather not.'),
    answers('{"lines": []}'),
  ]);
  assert.equal((await fill(app)).status, 502);
  assert.equal((await fill(app)).status, 502);
});

test('an ask with no sentence never reaches the model', async (t) => {
  const { app, llm } = await studio(t, [answers('{"lines":[{"who":"","say":"x"}]}')]);
  const res = await fill(app, { ...FILL_BODY, sentence: '   ' });
  assert.equal(res.status, 400);
  assert.equal(llm.asked.length, 0);
});

test('upstream failing is a 502, and costs nobody anything', async (t) => {
  const { app, user } = await studio(t, [new Error('deepseek exploded')]);
  const res = await fill(app);
  assert.equal(res.status, 502);
  assert.match(res.body.error, /deepseek exploded/);
  assert.equal(
    app.db.prepare('SELECT tokens FROM user_tokens WHERE user_id = ?').get(user.id),
    undefined,
  );
});

/* The walls ---------------------------------------------------------------- */

test('the studio being out of tokens refuses before the model is asked', async (t) => {
  const { app, llm } = await studio(t, [answers('{"lines":[{"who":"","say":"x"}]}')]);
  app.db.prepare('UPDATE studio_state SET daily_token_budget = 100, tokens_used_today = 100 WHERE id = 1').run();
  const res = await fill(app);
  assert.equal(res.status, 429);
  assert.match(res.body.error, /out of tokens/);
  assert.equal(llm.asked.length, 0, 'the wall is checked before the request');
});

test('one person\'s allowance stops their own asks and nobody else\'s', async (t) => {
  const { app, user, llm } = await studio(t, [answers('{"lines":[{"who":"","say":"x"}]}')]);
  app.db.prepare('UPDATE users SET daily_tokens = 10 WHERE id = ?').run(user.id);
  app.db.prepare('INSERT INTO user_tokens (user_id, day, tokens) VALUES (?, ?, ?)')
    .run(user.id, new Date().toISOString().slice(0, 10), 10);

  const res = await fill(app);
  assert.equal(res.status, 429);
  assert.match(res.body.error, /used up today's tokens/);
  assert.equal(llm.asked.length, 0);

  // Somebody else's day is untouched — and this game is open, so they may ask.
  const other = app.newClient();
  await signIn(app, { email: 'sam@example.com', displayName: 'Sam', client: other });
  const theirs = await other.json('POST', '/api/projects/story/story/fill', { body: FILL_BODY });
  assert.equal(theirs.status, 200);
});

/* Who may ask -------------------------------------------------------------- */

test('a game that is not yours and not open refuses, and costs nothing', async (t) => {
  const { app, llm } = await studio(t, [answers('{"lines":[{"who":"","say":"x"}]}')]);
  const shut = await app.client.json('POST', '/api/projects/story/open', { body: { open_edit: false } });
  assert.equal(shut.status, 200);

  const other = app.newClient();
  await signIn(app, { email: 'sam@example.com', displayName: 'Sam', client: other });
  const res = await other.json('POST', '/api/projects/story/story/fill', { body: FILL_BODY });
  assert.equal(res.status, 403);
  assert.equal(llm.asked.length, 0);
});

test('a chat has no story to ask about, and an archived game takes no more', async (t) => {
  const { app, llm } = await studio(t, [answers('{"lines":[{"who":"","say":"x"}]}')]);
  await app.client.json('POST', '/api/projects', { body: { name: 'Talk', slug: 'talk', kind: 'chat' } });
  assert.equal((await fill(app, FILL_BODY, 'talk')).status, 409);

  const shelved = await app.client.json('POST', '/api/projects/story/archive', { body: { archived: true } });
  assert.equal(shelved.status, 200);
  assert.equal((await fill(app)).status, 409);
  assert.equal((await picture(app)).status, 409);
  assert.equal(llm.asked.length, 0);
});

test('signed out, neither ask is answered', async (t) => {
  const { app } = await studio(t, [answers('{"lines":[{"who":"","say":"x"}]}')]);
  app.client.forget();
  assert.equal((await fill(app)).status, 401);
  assert.equal((await picture(app)).status, 401);
});

/* The stand-in ------------------------------------------------------------- */

test('a picture comes back as an SVG with the size its kind wants', async (t) => {
  const { app, user, llm } = await studio(t, [answers(JSON.stringify({ svg: svg() }))]);
  const res = await picture(app, {
    ...PICTURE_BODY,
    colours: ['#ff8800', 'oklch(0.7 0.2 20)', 'javascript:alert(1)'],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.svg, svg());
  assert.equal(res.body.width, 480);
  assert.equal(res.body.height, 270);

  const prompt = llm.lastAsked().messages[0].content;
  assert.match(prompt, /a place, with nobody in it/);
  assert.match(prompt, /The viewBox is 0 0 480 270\./);
  assert.match(prompt, /#ff8800, oklch\(0\.7 0\.2 20\)/);
  // ⚠️ A colour is a colour: whatever a config file said, it does not get to
  // put a sentence of its own into the prompt.
  assert.doesNotMatch(prompt, /javascript/);

  assert.equal(
    app.db.prepare('SELECT tokens FROM user_tokens WHERE user_id = ?').get(user.id).tokens,
    240,
  );
});

test('a portrait is square and asks for one person', async (t) => {
  const { app, llm } = await studio(t, [answers(JSON.stringify({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle r="40"/></svg>',
  }))]);
  const res = await picture(app, { kind: 'portrait', name: 'Mila', about: 'curious' });
  assert.equal(res.status, 200);
  assert.equal(res.body.width, 128);
  assert.equal(res.body.height, 128);
  assert.match(llm.lastAsked().messages[0].content, /a portrait of one person/);
});

test('an answer that is not a picture, or too big to be one, is a 502', async (t) => {
  const { app } = await studio(t, [
    answers('{"svg": "sorry, I cannot draw"}'),
    answers(JSON.stringify({ svg: svg(`<rect fill="#000" width="${'0'.repeat(SVG_BYTES)}"/>`) })),
    answers('no json here at all'),
  ]);
  assert.equal((await picture(app)).status, 502);
  assert.equal((await picture(app)).status, 502);
  assert.equal((await picture(app)).status, 502);
});

test('a kind the studio does not draw, and an ask with nothing to draw, never reach the model', async (t) => {
  const { app, llm } = await studio(t, [answers(JSON.stringify({ svg: svg() }))]);
  assert.equal((await picture(app, { kind: 'mural', about: 'a wall' })).status, 400);
  assert.equal((await picture(app, { kind: 'portrait', about: '', name: '' })).status, 400);
  assert.equal(llm.asked.length, 0);
});

test('a studio with no model configured says so rather than failing', async (t) => {
  const app = await setup();
  t.after(() => app.close());
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Story', slug: 'story' } });
  assert.equal((await fill(app)).status, 503);
  assert.equal((await picture(app)).status, 503);
});
