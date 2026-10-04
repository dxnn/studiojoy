// Game Design: the editor a game born in Game Design opens on (game-design.js,
// server/design.js). The cards answered so far, each one a click from being
// asked again; the card being asked; and under them *How it's made* — what
// the answers would make, a way to pick something else, and Make it, or Skip
// to it before the cards are done.

import { h } from './dom.js';
import {
  S, send, api, say, render, frozen, urlAs, openProject, encodePath,
} from './main.js';
import { openFile } from './files.js';
import { editorsFor } from './game-types.js';
import {
  DESIGN_FILE, NOT_SURE, CARDS, answersOf, withAnswer, nextCard, progress, recommend,
} from './game-design.js';

// The words for what a pick brings, read once from the studio's own indexes.
let templates = null;
let schemes = null;
const ENGINES = { physics: 'things that fall and bounce', render3d: '3D' };

async function loadIndexes() {
  if (templates && schemes) return;
  const [t, s] = await Promise.all([
    send('/game-templates/index.json'), send('/templates/index.json'),
  ]);
  templates = t.ok ? (await t.json()).templates ?? {} : {};
  schemes = s.ok ? (await s.json()).schemes ?? {} : {};
}

async function readSpec() {
  if (!S.files.some((f) => f.path === DESIGN_FILE)) return '';
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(DESIGN_FILE)}`);
  return res.ok ? res.text() : null;
}

export async function loadDesign() {
  const slug = S.slug;
  await loadIndexes();
  const text = await readSpec();
  if (S.slug !== slug) return;
  // `asking` is a card being changed, `other` a card showing its own box,
  // `start` a pick that overrules the answers.
  S.design = { text: text ?? '', asking: null, other: false, start: '' };
}

// SPEC.md changed under the cards — another tab's answer, or a hand edit.
export async function designChanged() {
  if (!S.design || S.design.busy) return;
  const text = await readSpec();
  if (text !== null && S.design) S.design.text = text;
  render();
}

// One card answered: the spec read again first, so somebody else's answer a
// moment ago is kept, then written back whole.
async function answer(card, value) {
  if (!value.trim()) return;
  S.design.busy = true;
  render();
  const fresh = await readSpec();
  const text = withAnswer(fresh ?? S.design.text, card.id, value, S.project.name);
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(DESIGN_FILE)}`, {
    method: 'PUT', headers: { 'content-type': 'text/plain' }, body: text,
  });
  S.design.busy = false;
  if (!res.ok) {
    say('Could not save that answer.', true);
  } else {
    Object.assign(S.design, { text, asking: null, other: false, draft: null });
  }
  render();
}

// What Make it will make: the answers', unless a pick overrules them.
function picked(answers) {
  const rec = recommend(answers);
  const { start } = S.design;
  if (!start) return rec;
  if (start === 'blank') return { ...rec, template: null };
  return { template: start, scheme: null, libraries: [] };
}

async function makeIt() {
  const pick = picked(answersOf(S.design.text));
  S.design.making = true;
  const res = await api('POST', `/api/projects/${S.slug}/design`, pick);
  if (!res.ok) {
    S.design.making = false;
    say(res.body?.error ?? 'Could not make it.', true);
    render();
    return;
  }
  // Where a new game of this kind opens: its editor, else Building — with a
  // template's heart open under Code when it has no editor, as New game did.
  const editor = editorsFor(res.body.type)[0]?.id ?? null;
  const heart = editor ? null : templates?.[res.body.type]?.heart;
  await urlAs('replace', async () => {
    await openProject(S.slug, { view: { chat: res.body.chat?.id, mode: editor } });
    if (heart) await openFile(heart);
  });
  render();
}

const onEnter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

// The box for an answer of your own. What is typed lives in `draft`, and the
// id is how render() gives the caret back: a write anywhere in the studio
// redraws this pane, and must not take the half-typed answer with it.
function box(card, current) {
  const input = h('input', {
    type: 'text', class: 'cfg-text', id: 'design-box', placeholder: card.other,
    oninput: () => { S.design.draft = input.value; },
  });
  input.value = S.design.draft ?? (current && current !== NOT_SURE ? current : '');
  const go = () => answer(card, input.value);
  input.addEventListener('keydown', onEnter(go));
  // Straight into the box, unless somebody is already typing somewhere else.
  requestAnimationFrame(() => {
    if (input.isConnected && document.activeElement === document.body) input.focus();
  });
  return h('div', { class: 'guide-row' },
    input, h('button', { class: 'filled tiny', text: 'Next', onclick: go }));
}

function cardFor(card, answers) {
  const current = answers[card.id];
  const open = !card.choices || S.design.other;
  return h('div', { class: 'guide' },
    h('div', { class: 'guide-ask', text: card.ask }),
    card.choices ? h('div', { class: 'guide-row design-choices' }, ...card.choices.map((choice) => h('button', {
      class: `quiet tiny${choice === current ? ' on' : ''}`, text: choice, onclick: () => answer(card, choice),
    })), card.other && !S.design.other ? h('button', {
      class: 'quiet tiny', text: 'Something else…',
      onclick: () => { S.design.other = true; render(); },
    }) : null) : null,
    open && card.other ? box(card, current) : null,
    h('div', { class: 'row' },
      h('button', { class: 'quiet tiny', text: 'Not sure yet', onclick: () => answer(card, NOT_SURE) }),
      S.design.asking ? h('button', {
        class: 'link tiny', text: 'Keep what it said',
        onclick: () => { Object.assign(S.design, { asking: null, other: false, draft: null }); render(); },
      }) : null));
}

// The cards answered so far, in asking order, each one a click from being
// asked again.
function answered(answers) {
  const rows = CARDS.filter((c) => answers[c.id] !== undefined && c.id !== S.design.asking);
  if (rows.length === 0) return null;
  return h('div', { class: 'design-answers' }, ...rows.map((c) => h('div', { class: 'design-answer' },
    h('span', { class: 'design-q', text: c.heading }),
    h('span', { class: 'design-a', text: answers[c.id] }),
    frozen() ? null : h('button', {
      class: 'link tiny', text: 'Change',
      onclick: () => { Object.assign(S.design, { asking: c.id, other: false, draft: null }); render(); },
    }))));
}

function howItsMade(answers) {
  const pick = picked(answers);
  const t = pick.template ? templates?.[pick.template] : null;
  const engines = (t ? t.libraries ?? [] : pick.libraries).map((l) => ENGINES[l] ?? l);
  const { done, of } = progress(answers);
  const finished = done === of;
  const start = h('select', {
    onchange: () => { S.design.start = start.value; render(); },
  },
  h('option', { value: '', text: 'What the answers say' }),
  ...Object.entries(templates ?? {}).map(([key, x]) => h('option', { value: key, text: x.title })),
  h('option', { value: 'blank', text: 'A blank page' }));
  start.value = S.design.start;
  return h('div', { class: 'guide design-make' },
    h('div', { class: 'guide-ask', text: 'How it’s made' }),
    h('div', { class: 'design-pick' },
      h('strong', { text: t ? t.title : 'A blank page' }),
      h('span', {
        text: t ? ` — ${t.what}` : ' — a page and the studio’s libraries, and the builder writes the rest with you.',
      })),
    // How it is held only for a game no template makes, which chose it on a
    // card: a template's own words already say, and its scheme can mislead —
    // Knock it down is `none` and played by dragging the sling.
    h('div', {
      class: 'hint muted',
      text: [
        engines.length ? `With ${engines.join(' and ')}.` : null,
        !t && pick.scheme && schemes?.[pick.scheme]
          ? `Played with: ${schemes[pick.scheme].title.toLowerCase()}.` : null,
      ].filter(Boolean).join(' '),
    }),
    frozen() ? null : h('div', { class: 'guide-row' },
      h('span', { class: 'hint muted', text: 'Start from' }), start),
    h('div', { class: 'row' },
      h('span', { class: 'hint muted', text: `${done} of ${of} answered` }),
      h('div', { class: 'spacer' }),
      frozen() ? null : h('button', {
        class: finished ? 'filled tiny' : 'quiet tiny',
        text: finished ? 'Make it' : 'Skip to making it',
        title: 'Start the game from this, with the builder in Building',
        disabled: S.design.making,
        onclick: makeIt,
      })));
}

export function renderGameDesign() {
  if (!S.design) return h('div', { class: 'pad muted', text: 'Reading…' });
  const answers = answersOf(S.design.text);
  const card = S.design.asking ? CARDS.find((c) => c.id === S.design.asking) : nextCard(answers);
  return h('div', { class: 'scroll design', 'data-scroll': 'design' },
    h('p', {
      class: 'pad hint muted',
      text: 'A few questions before anything is built. Every answer goes into SPEC.md, where anybody working on the game can read it.',
    }),
    answered(answers),
    card && !frozen() ? cardFor(card, answers) : null,
    howItsMade(answers));
}
