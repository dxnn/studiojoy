// The quiz editor's model layer: what it reads, what it declines, and that
// opening the shipped template and saving changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  quizModel, quizText, quizChecks, freshKey, isQuizPath,
} from '../public/quiz-editor.js';

const TEMPLATE = fs.readFileSync(
  new URL('../public/game-templates/quiz/config/questions.js', import.meta.url), 'utf8',
);

test('only config/questions.js is a quiz', () => {
  assert.equal(isQuizPath('config/questions.js'), true);
  assert.equal(isQuizPath('config/words.js'), false);
  assert.equal(isQuizPath('questions.js'), false);
});

test('the shipped template reads, and writing it back changes nothing', () => {
  const model = quizModel(TEMPLATE);
  assert.equal(model.ok, true, model.reason);
  assert.equal(model.questions.length, 3);
  assert.equal(model.questions[0].answers.length, 3);
  assert.deepEqual(model.results.map((r) => r.key), ['dragon', 'owl', 'otter']);
  // Byte-stable: opening the editor and pressing Save is not an edit.
  assert.equal(quizText(model), TEMPLATE);
});

test('edits round-trip, quotes and all', () => {
  const model = quizModel(TEMPLATE);
  model.questions[0].ask = 'What\'s "best"?\ttabs too';
  model.results.push({ key: freshKey(model.results), name: 'A Néw One', tell: '' });
  model.questions[0].answers.push({ say: 'the new one', result: model.results[3].key });
  const text = quizText(model);
  const again = quizModel(text);
  assert.equal(again.ok, true, again.reason);
  assert.deepEqual(again, { ok: true, questions: model.questions, results: model.results });
});

test('freshKey never collides and is never shown anyway', () => {
  const results = [{ key: 'ending_1' }, { key: 'ending_2' }];
  assert.equal(freshKey(results), 'ending_3');
  assert.equal(freshKey([]), 'ending_1');
});

test('anything past the shape declines with the grown reason', () => {
  const grown = /grown past/;
  // An extra declaration.
  assert.match(quizModel(`${TEMPLATE}\nconst EXTRA = 1;\n`).reason, grown);
  // A weight on an answer.
  assert.match(quizModel(TEMPLATE.replace(
    '{ say: "Something spicy", result: "dragon" }',
    '{ say: "Something spicy", result: "dragon", weight: 2 }',
  )).reason, grown);
  // A result key the serializer could not write bare.
  assert.match(quizModel(TEMPLATE.replace('dragon: {', '"dra gon": {')).reason, grown);
  // Code is not the grown reason — it is the reader refusing, passed through.
  const code = quizModel('const QUESTIONS = window.q;\nconst RESULTS = {};\n');
  assert.equal(code.ok, false);
  assert.doesNotMatch(code.reason, grown);
});

test('the checks read the whole quiz, not one row', () => {
  const model = quizModel(TEMPLATE);
  assert.deepEqual(quizChecks(model), [], 'the shipped template is balanced');

  // An ending nothing points at, which is the quiz bug no row can show.
  model.results.push({ key: freshKey(model.results), name: 'A Bear', tell: '' });
  assert.ok(quizChecks(model).some((s) => /Nobody can be A Bear/.test(s)));

  // One answer feeding it is nearly as bad.
  model.questions[0].answers.push({ say: 'Hibernate', result: model.results[3].key });
  assert.ok(quizChecks(model).some((s) => /Only one answer counts toward A Bear/.test(s)));

  // An answer left pointing at an ending that has been removed.
  model.results.splice(3, 1);
  assert.ok(quizChecks(model).some((s) => /counts toward an ending that is gone/.test(s)));

  // A question with one answer is not a question.
  const thin = quizModel(TEMPLATE);
  thin.questions[0].answers.length = 1;
  assert.ok(quizChecks(thin).some((s) => /has one answer/.test(s)));
});
