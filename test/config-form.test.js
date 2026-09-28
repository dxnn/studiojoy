// The config form, and the quiz form beside it, over the DOM stand-in. A
// write to anybody's game renders the whole studio, these forms included, so
// a field has to survive being rebuilt while somebody types in it: an id for
// render() to put the caret back by, and what was typed already in the open
// file (spec/ §17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { install, all } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S } = await import('../public/main.js');
const { parseConfigFile } = await import('../public/config-file.js');
const { renderConfigForm } = await import('../public/config-form.js');
const { renderQuizForm } = await import('../public/quiz-form.js');
const { quizModel } = await import('../public/quiz-editor.js');

const PLAY = `// How the ball moves.
const SPEED = 300; // how fast it rolls
const NAME = "Zoom"; // what it is called
const SPOTS = [{ x: 1, y: 2 }]; // where things start
`;

// The form as a render would build it from whatever the open file says now.
function form() {
  return renderConfigForm(parseConfigFile(S.open.content).decls);
}

function open(content) {
  S.project = { slug: 'ball', can_edit: true, archived: false, type: null, agents: [] };
  S.open = { path: 'config/play.js', content, dirty: false };
  return form();
}

const field = (nodes, id) => all(nodes).find((n) => n.attrs?.id === id);

function type(input, value) {
  input.value = value;
  input.handlers.get('input')({ currentTarget: input });
}

test('every field carries an id made from where its value sits', () => {
  const nodes = open(PLAY);
  for (const id of ['cfg.SPEED', 'cfg.NAME', 'cfg.SPOTS.0.x', 'cfg.SPOTS.0.y']) {
    assert.ok(field(nodes, id), `${id} is found again after a render`);
  }
});

test('a number is in the file as it is typed, so a rebuilt field still shows it', () => {
  type(field(open(PLAY), 'cfg.SPEED'), '35');
  assert.match(S.open.content, /const SPEED = 35;/);
  assert.equal(S.open.dirty, true);
  assert.equal(field(form(), 'cfg.SPEED').value, '35', 'a background render keeps what was typed');
});

test('a half-typed number writes nothing, and leaving puts the file\'s back', () => {
  const input = field(open(PLAY), 'cfg.SPEED');
  // What a number box reports for "1e" or "-" on the way to a number.
  type(input, '');
  assert.equal(S.open.content, PLAY);
  input.handlers.get('change')({ currentTarget: input });
  assert.equal(input.value, '300');
});

test('words are in the file as they are typed', () => {
  type(field(open(PLAY), 'cfg.NAME'), 'Zoom zoom');
  assert.match(S.open.content, /const NAME = "Zoom zoom";/);
  assert.equal(field(form(), 'cfg.NAME').value, 'Zoom zoom');
});

const QUIZ = fs.readFileSync(new URL('../public/game-templates/quiz/config/questions.js', import.meta.url), 'utf8');

test('a quiz field is in the file as it is typed, found again by its id', (t) => {
  S.project = { slug: 'quiz', can_edit: true, archived: false, type: 'quiz', agents: [] };
  S.open = { path: 'config/questions.js', content: QUIZ, dirty: false };
  // The form saves itself two seconds on; with nothing open by then it does not.
  t.after(() => { S.open = null; });
  const model = quizModel(QUIZ);
  const nodes = renderQuizForm(model);
  for (const id of ['quiz-ask-0', 'quiz-answer-0-0', 'quiz-counts-0-0', 'quiz-ending-0', 'quiz-tell-0']) {
    assert.ok(field(nodes, id), `${id} is found again after a render`);
  }
  type(field(nodes, 'quiz-ask-0'), 'A sunny Sunday?');
  assert.match(S.open.content, /ask: "A sunny Sunday\?"/);
  assert.equal(field(renderQuizForm(model), 'quiz-ask-0').value, 'A sunny Sunday?');
});
