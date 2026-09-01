// How config/questions.js opens when it still has the quiz shape: the whole
// game as a form — questions, answers, endings — no code in sight. The model
// reading and file writing is quiz-editor.js; this is the form. Field edits
// regenerate the file content in place without a render (the same bargain as
// the config form: a render would replace the field under the fingers);
// adding and removing rows renders, because the shape changed.

import { quizText, quizChecks, freshKey } from './quiz-editor.js';
import { h } from './dom.js';
import { S, render, saveOpenFile, frozen } from './main.js';

function commit(model) {
  S.open.content = quizText(model);
  S.open.dirty = true;
  const save = document.getElementById('save-btn');
  if (save) save.disabled = false;
  const status = document.getElementById('cfg-status');
  if (status) status.textContent = 'Not saved yet';
}

const field = (value, placeholder, onchange) => {
  const input = h('input', { type: 'text', class: 'cfg-text', placeholder, onchange });
  input.value = value;
  return input;
};

export function renderQuizForm(model) {
  const { questions, results } = model;
  const named = (r) => r.name || '(unnamed ending)';
  const checks = quizChecks(model);

  const questionCard = (q, qi) => {
    const rows = q.answers.map((a, ai) => h('div', { class: 'quiz-answer row' },
      field(a.say, 'An answer', (e) => { a.say = e.currentTarget.value; commit(model); }),
      h('span', { class: 'hint muted', text: 'counts toward' }),
      h('select', {
        onchange: (e) => { a.result = e.currentTarget.value; commit(model); },
      }, results.map((r) => {
        const option = h('option', { value: r.key, text: named(r) });
        if (r.key === a.result) option.selected = true;
        return option;
      })),
      h('button', {
        class: 'icon tiny', text: '✕', title: 'Remove this answer',
        onclick: () => { q.answers.splice(ai, 1); commit(model); render(); },
      })));

    return h('div', { class: 'quiz-q' },
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: `#${qi + 1}` }),
        field(q.ask, 'The question', (e) => { q.ask = e.currentTarget.value; commit(model); }),
        h('button', {
          class: 'icon tiny', text: '✕', title: 'Remove this question',
          onclick: () => { questions.splice(qi, 1); commit(model); render(); },
        })),
      ...rows,
      h('button', {
        class: 'quiet tiny', text: '+ Add an answer',
        onclick: () => {
          q.answers.push({ say: '', result: results[0]?.key ?? '' });
          commit(model);
          render();
        },
      }));
  };

  const endingRow = (r, ri) => {
    const used = questions.reduce(
      (n, q) => n + q.answers.filter((a) => a.result === r.key).length, 0,
    );
    return h('div', { class: 'quiz-q' },
      h('div', { class: 'row' },
        field(r.name, 'What they are called', (e) => { r.name = e.currentTarget.value; commit(model); }),
        h('button', {
          class: 'icon tiny', text: '✕',
          title: used
            ? `${used} answer${used === 1 ? '' : 's'} still count toward this`
            : 'Remove this ending',
          disabled: used > 0,
          onclick: () => { results.splice(ri, 1); commit(model); render(); },
        })),
      field(r.tell, 'A line about them', (e) => { r.tell = e.currentTarget.value; commit(model); }));
  };

  return [
    h('div', { class: 'scroll cfg', 'data-scroll': 'cfg' },
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'The questions' }),
        h('span', {
          class: 'hint muted',
          text: `asked in order, one screen each · ${questions.length} question`
            + `${questions.length === 1 ? '' : 's'}, ${results.length} ending`
            + `${results.length === 1 ? '' : 's'}`,
        })),
      ...questions.map(questionCard),
      results.length === 0
        ? h('p', { class: 'hint muted', text: 'Add an ending first — answers need something to count toward.' })
        : h('button', {
          class: 'quiet tiny', text: '+ Add a question',
          onclick: () => {
            questions.push({ ask: '', answers: [{ say: '', result: results[0].key }] });
            commit(model);
            render();
          },
        }),
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'The endings' }),
        h('span', { class: 'hint muted', text: 'the one with the most answers wins; a tie goes to the first' })),
      ...results.map(endingRow),
      h('button', {
        class: 'quiet tiny', text: '+ Add an ending',
        onclick: () => {
          results.push({ key: freshKey(results), name: '', tell: '' });
          commit(model);
          render();
        },
      }),
      // What the quiz as a whole says. It goes under the endings because that
      // is where the balance is decided, and every one of these is a thing no
      // single row can show.
      ...checks.map((say) => h('p', { class: 'hint warn', text: `⚠ ${say}` }))),
    h('div', { class: 'editor-bar row' },
      h('span', {
        class: 'hint muted', id: 'cfg-status', text: S.open.dirty ? 'Not saved yet' : 'Saved',
      }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'link', text: 'Show the text',
        onclick: () => { S.open.asText = true; render(); },
      }),
      h('button', {
        class: 'filled', id: 'save-btn', text: 'Save',
        disabled: !S.open.dirty || frozen(),
        onclick: () => saveOpenFile(),
      })),
  ];
}
