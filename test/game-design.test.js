// Game Design (spec/ §6): the cards' model over SPEC.md, and Make it — the
// one place a game's type changes after it is made, and only once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, signIn, scratchDir } from './helpers.js';
import { logCommits } from '../server/files/git.js';
import { openDb } from '../server/db.js';
import {
  CARDS, NOT_SURE, parseSpec, answersOf, withAnswer, cardsFor, nextCard, progress, recommend,
} from '../public/game-design.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const readIndex = (...parts) => JSON.parse(fs.readFileSync(path.join(PUBLIC, ...parts), 'utf8'));
const SIX = ['do', 'who', 'where', 'goal', 'trouble', 'end'];

/* The cards ------------------------------------------------------------------ */

test('an answer is a section of SPEC.md, and an empty spec starts with the name', () => {
  const spec = withAnswer('', 'who', 'A cat in a tree', 'Pie Fight');
  assert.equal(spec, '# Pie Fight\n\n## Who you are\n\nA cat in a tree\n');
  assert.deepEqual(answersOf(spec), { who: 'A cat in a tree' });
});

test('answers land in asking order and in place, around what nobody asked', () => {
  let spec = '# Pie Fight\n\nNotes of my own.\n\n## Secret level\n\nUnder the shed.\n';
  spec = withAnswer(spec, 'where', 'A garden', 'unused');
  spec = withAnswer(spec, 'do', 'Throw things to knock them down', 'unused');
  spec = withAnswer(spec, 'where', 'A garden full of dogs', 'unused');
  const { head, sections } = parseSpec(spec);
  assert.equal(head, '# Pie Fight\n\nNotes of my own.');
  assert.deepEqual(sections.map((s) => s.heading), ['Secret level', 'What you do', 'Where it happens']);
  assert.deepEqual(answersOf(spec), {
    do: 'Throw things to knock them down', where: 'A garden full of dogs',
  });
});

test('the free-form cards are asked only once no template makes the game', () => {
  const ids = (answers) => cardsFor(answers).map((c) => c.id);
  assert.deepEqual(ids({}), SIX);
  assert.deepEqual(ids({ do: 'Race around a track' }), SIX);
  assert.deepEqual(ids({ do: 'Fling pies at dogs' }), [...SIX, 'hold', 'look', 'bounce']);
  assert.deepEqual(ids({ do: NOT_SURE }), [...SIX, 'hold', 'look', 'bounce']);
  assert.equal(nextCard({}).id, 'do');
  assert.equal(nextCard({ do: 'x', who: NOT_SURE }).id, 'where', 'not sure is an answer');
  assert.deepEqual(progress({ do: 'Race around a track', who: 'Me' }), { done: 2, of: 6 });
  assert.equal(nextCard(Object.fromEntries(SIX.map((id) => [id, 'x']))).id, 'hold',
    'six answered, and the first said no template');
});

test('the first answer names a template; without one, the free-form cards decide', () => {
  assert.deepEqual(recommend({ do: 'race around a track.' }), { template: 'racing', scheme: null, libraries: [] });
  assert.deepEqual(recommend({}), { template: null, scheme: null, libraries: [] });
  assert.deepEqual(
    recommend({ do: 'Fling pies', hold: 'One button', look: '3D', bounce: 'Yes' }),
    { template: null, scheme: 'one-button', libraries: ['physics', 'render3d'] },
  );
});

// The two tables against the studio's own indexes: a template added without a
// card answer, or a card answer naming a template that went, is a game nobody
// can start or a press that refuses.
test('the first card reaches every template, and how it is held every scheme', () => {
  const { templates } = readIndex('game-templates', 'index.json');
  const named = CARDS.find((c) => c.id === 'do').choices.map((say) => recommend({ do: say }).template);
  assert.deepEqual(named.sort(), Object.keys(templates).sort());
  const { schemes } = readIndex('templates', 'index.json');
  const held = CARDS.find((c) => c.id === 'hold').choices.map((say) => recommend({ do: 'x', hold: say }).scheme);
  assert.deepEqual(held.sort(), Object.keys(schemes).sort());
});

/* Make it --------------------------------------------------------------------- */

async function designing(t) {
  const app = await setup({ publicDir: PUBLIC });
  t.after(() => app.close());
  await signIn(app);
  const res = await app.client.json('POST', '/api/projects', {
    body: { name: 'Pie Fight', slug: 'pie', design: true },
  });
  return { app, res, dir: path.join(app.gamesDir, 'pie') };
}

const make = (app, body = {}, slug = 'pie') => app.client.json('POST', `/api/projects/${slug}/design`, { body });

test('a game born in Game Design has its human-only room and nothing to build in', async (t) => {
  const { app, res, dir } = await designing(t);
  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'design');
  assert.deepEqual(res.body.chats.map((c) => c.name), ['Humans only']);
  assert.equal(res.body.chat.name, 'Humans only');
  assert.ok(fs.existsSync(path.join(dir, 'index.html')), 'the blank page, so it plays');
  // What the cards decide is not sent beside them.
  for (const extra of [{ template: 'quiz' }, { scheme: 'buttons' }, { kind: 'chat' }]) {
    const bad = await app.client.json('POST', '/api/projects', {
      body: { name: 'Nope', slug: 'nope', design: true, ...extra },
    });
    assert.equal(bad.status, 400, JSON.stringify(extra));
  }
});

test('Make it starts the game from a template, the answers over its spec, and opens Building', async (t) => {
  const { app, dir } = await designing(t);
  const answers = withAnswer('', 'do', 'Answer questions and find out what you are', 'Pie Fight');
  await app.client.json('PUT', '/api/projects/pie/files/SPEC.md', {
    rawBody: answers, headers: { 'content-type': 'text/plain' },
  });

  const made = await make(app, { template: 'quiz' });
  assert.equal(made.status, 200);
  assert.equal(made.body.type, 'quiz');
  assert.deepEqual(made.body.chats.map((c) => c.name), ['Humans only', 'Building']);
  assert.equal(made.body.chat.name, 'Building', 'the room it opens on');
  assert.deepEqual(
    fs.readFileSync(path.join(dir, 'config/questions.js')),
    fs.readFileSync(path.join(PUBLIC, 'game-templates/quiz/config/questions.js')),
  );
  assert.match(fs.readFileSync(path.join(dir, 'config/controls.js'), 'utf8'), /const SCHEME = "none";/,
    'the template\'s own scheme');

  const spec = fs.readFileSync(path.join(dir, 'SPEC.md'), 'utf8');
  assert.ok(spec.startsWith(answers.trimEnd()), 'the answers first, as they were');
  assert.match(spec, /^## The quiz$/m, 'then the template\'s spec, one level down');
  assert.doesNotMatch(spec, /^# The quiz$/m);

  // The answer's save landed first, then all of Make it as one version.
  const commits = await logCommits(dir);
  assert.equal(commits[0].subject, 'make it: A quiz');
  assert.ok(commits.slice(1).some((c) => /SPEC\.md/.test(c.subject)), 'the answer is its own version');

  assert.equal((await make(app)).status, 409, 'once');
});

test('Make it without a template takes the scheme and engines it is given', async (t) => {
  const { app, dir } = await designing(t);
  const made = await make(app, { scheme: 'one-button', libraries: ['physics'] });
  assert.equal(made.status, 200);
  assert.equal(made.body.type, null, 'a free-form game');
  assert.deepEqual(made.body.chats.map((c) => c.name), ['Humans only', 'Building']);
  assert.match(fs.readFileSync(path.join(dir, 'config/controls.js'), 'utf8'), /const SCHEME = "one-button";/);
  assert.ok(fs.existsSync(path.join(dir, 'studio/physics.js')), 'the extra');
  assert.ok(fs.existsSync(path.join(dir, 'index.html')), 'the blank page stays');
});

test('Make it refuses what is not there, and a game that was never in Game Design', async (t) => {
  const { app } = await designing(t);
  for (const body of [{ template: 'zorp' }, { scheme: 'zorp' }, { libraries: ['zorp'] }, { libraries: ['input'] }]) {
    assert.equal((await make(app, body)).status, 400, JSON.stringify(body));
  }
  await app.client.json('POST', '/api/projects', { body: { name: 'Old', slug: 'old' } });
  assert.equal((await make(app, {}, 'old')).status, 409);
});

test('a copy of a game in Game Design is still in it', async (t) => {
  const { app } = await designing(t);
  const copy = await app.client.json('POST', '/api/projects/pie/fork', {
    body: { name: 'Pie Two', slug: 'pie-two' },
  });
  assert.equal(copy.body.type, 'design');
  const read = await app.client.json('GET', '/api/projects/pie-two');
  assert.deepEqual(read.body.chats.map((c) => c.name), ['Humans only']);
});

// ⚠️ The boot migration that gives every game a room for helpers runs on every
// start; a game in Game Design must come through it with only its own.
test('a restart gives a game in Game Design no Building', () => {
  const file = path.join(scratchDir('db'), 'studio.db');
  let db = openDb(file);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, created_at)
     VALUES ('a@b.c', 'x', 'Dann', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO projects (slug, name, kind, type, created_by, created_at)
     VALUES ('pie', 'Pie', 'game', 'design', 1, ?)`,
  ).run(now);
  db.prepare("INSERT INTO chats (project_id, name, bots, created_at) VALUES (1, 'Humans only', 0, ?)").run(now);
  db.close();

  db = openDb(file);
  assert.deepEqual(db.prepare('SELECT name FROM chats WHERE project_id = 1').all().map((r) => r.name), ['Humans only']);
  db.close();
});
