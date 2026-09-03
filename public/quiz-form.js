// How config/questions.js opens when it still has the quiz shape: the whole
// game as a form — questions, answers, endings — no code in sight. The model
// reading and file writing is quiz-editor.js; this is the form. Field edits
// regenerate the file content in place without a render (the same bargain as
// the config form: a render would replace the field under the fingers);
// adding and removing rows renders, because the shape changed. Every change
// is a valid quiz, so the form saves itself two seconds after the last one
// (spec.md §5) — there is no Save.

import { quizText, quizChecks, freshKey, QUIZ_FILE } from './quiz-editor.js';
import { h } from './dom.js';
import {
  S, render, more, frozen,
} from './main.js';
import { saveOpenFileSoon } from './files.js';
import { renderOpenFile } from './files-tab.js';

function commit(model) {
  S.open.content = quizText(model);
  S.open.dirty = true;
  const status = document.getElementById('cfg-status');
  if (status) status.textContent = 'Saving…';
  saveOpenFileSoon();
}

const field = (value, placeholder, onchange) => {
  const input = h('input', {
    type: 'text', class: 'cfg-text', placeholder, onchange, disabled: frozen(),
  });
  input.value = value;
  return input;
};

// Questions: the quiz editor as a mode of its own (public/game-types.js). The
// mode is the file — arriving opens config/questions.js (main.js, openMode) —
// so the form is the open file's editor with the tree left out.
export function renderQuizEditor() {
  if (S.open?.path === QUIZ_FILE) return renderOpenFile();
  return h('div', { class: 'pad muted' }, h('p', { text: `Opening ${QUIZ_FILE}…` }));
}

export function renderQuizForm(model) {
  const { questions, results } = model;
  const named = (r) => r.name || '(unnamed ending)';
  const checks = quizChecks(model);
  const ro = frozen();

  const questionCard = (q, qi) => {
    const rows = q.answers.map((a, ai) => h('div', { class: 'quiz-answer row' },
      field(a.say, 'An answer', (e) => { a.say = e.currentTarget.value; commit(model); }),
      h('span', { class: 'hint muted', text: 'counts toward' }),
      h('select', {
        disabled: ro,
        onchange: (e) => { a.result = e.currentTarget.value; commit(model); },
      }, results.map((r) => {
        const option = h('option', { value: r.key, text: named(r) });
        if (r.key === a.result) option.selected = true;
        return option;
      })),
      ro ? null : more(`answer:${qi}:${ai}`, [{
        text: 'Delete', danger: true,
        onPick: () => { q.answers.splice(ai, 1); commit(model); render(); },
      }], { label: 'More about this answer' })));

    return h('div', { class: 'quiz-q' },
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: `#${qi + 1}` }),
        field(q.ask, 'The question', (e) => { q.ask = e.currentTarget.value; commit(model); }),
        ro ? null : more(`question:${qi}`, [{
          text: 'Delete', danger: true,
          onPick: () => { questions.splice(qi, 1); commit(model); render(); },
        }], { label: `More about question ${qi + 1}` })),
      ...rows,
      ro ? null : h('button', {
        class: 'quiet tiny', text: '+ Add an answer',
        onclick: () => {
          q.answers.push({ say: '', result: results[0]?.key ?? '' });
          commit(model);
          render();
        },
      }));
  };

  // An ending answers still count toward cannot go, so it has no ··· at all
  // rather than a Delete that refuses.
  const endingRow = (r, ri) => {
    const used = questions.reduce(
      (n, q) => n + q.answers.filter((a) => a.result === r.key).length, 0,
    );
    return h('div', { class: 'quiz-q' },
      h('div', { class: 'row' },
        field(r.name, 'What they are called', (e) => { r.name = e.currentTarget.value; commit(model); }),
        used > 0 ? h('span', {
          class: 'hint muted', text: `${used} answer${used === 1 ? '' : 's'}`,
        }) : null,
        ro || used > 0 ? null : more(`ending:${r.key}`, [{
          text: 'Delete', danger: true,
          onPick: () => { results.splice(ri, 1); commit(model); render(); },
        }], { label: `More about ${named(r)}` })),
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
        : (ro ? null : h('button', {
          class: 'quiet tiny', text: '+ Add a question',
          onclick: () => {
            questions.push({ ask: '', answers: [{ say: '', result: results[0].key }] });
            commit(model);
            render();
          },
        })),
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'The endings' }),
        h('span', { class: 'hint muted', text: 'the one with the most answers wins; a tie goes to the first' })),
      ...results.map(endingRow),
      ro ? null : h('button', {
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
        class: 'hint muted', id: 'cfg-status', text: S.open.dirty ? 'Saving…' : 'Saved',
      }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'link', text: 'Show the text',
        onclick: () => { S.open.asText = true; render(); },
      })),
  ];
}
