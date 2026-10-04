// Game Design: the cards a new game is asked before anything is built, and
// what the answers make it (server/design.js, spec/ §6). Pure and shared with
// the tests, like arc.js — the cards, SPEC.md read and written one section a
// card, the next card to ask, and what the studio would make: a table from the
// first answer, with no model anywhere. game-design-form.js is the interface.
//
// The story guide's posture: the next question is read off the file, so the
// cards work on a spec somebody has been editing by hand, and the only state
// is SPEC.md itself. *Not sure yet* is always an answer, so no card is a wall.

export const DESIGN_FILE = 'SPEC.md';
export const NOT_SURE = 'Not sure yet.';

// What you do: every answer names the template that does it.
export const DOING = [
  { say: 'Answer questions and find out what you are', template: 'quiz' },
  { say: 'Read a story and choose what happens', template: 'visual-novel' },
  { say: 'Explore a place and click on things', template: 'adventure' },
  { say: 'Race around a track', template: 'racing' },
  { say: 'Throw things to knock them down', template: 'knockdown' },
  { say: 'Roll a ball through a maze', template: 'rollball' },
  { say: 'Dodge and shoot things', template: 'arcade' },
];

// How you play a game no template makes: the control schemes in a kid's words
// (public/templates/index.json says each in its own).
export const HOLDING = [
  { say: 'Tap or click things on the screen', scheme: 'none' },
  { say: 'A stick and buttons', scheme: 'stick-buttons' },
  { say: 'Buttons only', scheme: 'buttons' },
  { say: 'Two sticks', scheme: 'dual-stick' },
  { say: 'One button', scheme: 'one-button' },
  { say: 'Swipes and taps', scheme: 'swipe-tap' },
];

// In asking order. `heading` is the card's section in SPEC.md; `choices` are
// buttons, and `other` is the example in a box for an answer of your own —
// behind *Something else* on a card with choices, the whole card otherwise.
// `freeOnly` cards are asked only of a game no template makes — a template
// fixes how it is held and which engines it carries.
export const CARDS = [
  {
    id: 'do', heading: 'What you do', ask: 'What do you do in your game?',
    choices: DOING.map((d) => d.say), other: 'You fling pies at dogs',
  },
  { id: 'who', heading: 'Who you are', ask: 'Who are you in it?', other: 'A cat who lives in a tree' },
  { id: 'where', heading: 'Where it happens', ask: 'Where does it happen?', other: 'A garden full of dogs' },
  {
    id: 'goal', heading: 'What you are trying to do', ask: 'What are you trying to do?',
    choices: ['Win', 'Get the most points', 'Reach the end', 'Find out what happens', 'Last as long as you can'],
    other: 'Get every pie into the bucket',
  },
  { id: 'trouble', heading: 'What gets in your way', ask: 'What gets in your way?', other: 'Dogs that bark and chase you' },
  {
    id: 'end', heading: 'How it ends', ask: 'How does it end?',
    choices: ['You win', 'You lose', 'Your score goes on the board', 'One of several endings', 'It never ends'],
    other: 'The dogs make friends with you',
  },
  {
    id: 'hold', heading: 'How you play it', ask: 'How do you play it?',
    choices: HOLDING.map((h) => h.say), freeOnly: true,
  },
  { id: 'look', heading: 'Flat or 3D', ask: 'Is it flat, or 3D?', choices: ['Flat', '3D'], freeOnly: true },
  {
    id: 'bounce', heading: 'Things that fall and bounce',
    ask: 'Do things fall, stack and bounce off each other?', choices: ['Yes', 'No'], freeOnly: true,
  },
];

const fold = (s) => String(s ?? '').trim().toLowerCase().replace(/\.$/, '');
const same = (a, b) => fold(a) === fold(b);

// SPEC.md as the cards read it: whatever comes before the first `## `, then
// each `## ` section in order. A section no card wrote is kept where it is.
export function parseSpec(text) {
  const head = [];
  const sections = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^##\s+(.*?)\s*$/.exec(line);
    if (m) sections.push({ heading: m[1], lines: [] });
    else if (sections.length) sections.at(-1).lines.push(line);
    else head.push(line);
  }
  return {
    head: head.join('\n').trim(),
    sections: sections.map((s) => ({ heading: s.heading, body: s.lines.join('\n').trim() })),
  };
}

const writeSpec = ({ head, sections }) => `${[
  head, ...sections.map((s) => `## ${s.heading}\n\n${s.body}`),
].filter(Boolean).join('\n\n')}\n`;

const cardSection = (sections, card) => sections.find((s) => same(s.heading, card.heading));

// Each card's answer, by id, for the cards whose section has words in it.
export function answersOf(text) {
  const { sections } = parseSpec(text);
  const out = {};
  for (const card of CARDS) {
    const body = cardSection(sections, card)?.body;
    if (body) out[card.id] = body;
  }
  return out;
}

// The spec with one card answered: its section rewritten where it is, or put
// in front of the first section of a later card. An empty spec starts with
// the game's name.
export function withAnswer(text, cardId, answer, name) {
  const spec = parseSpec(text);
  if (!spec.head && spec.sections.length === 0) spec.head = `# ${name}`;
  const card = CARDS.find((c) => c.id === cardId);
  const section = { heading: card.heading, body: String(answer).trim() };
  const at = spec.sections.findIndex((s) => same(s.heading, card.heading));
  if (at >= 0) {
    spec.sections[at] = section;
  } else {
    const rank = (s) => CARDS.findIndex((c) => same(c.heading, s.heading));
    const later = spec.sections.findIndex((s) => rank(s) > CARDS.indexOf(card));
    spec.sections.splice(later >= 0 ? later : spec.sections.length, 0, section);
  }
  return writeSpec(spec);
}

// The template the first answer names, or null: something else, not sure, or
// nothing yet.
export const templateFor = (answers) => DOING.find((d) => same(d.say, answers.do))?.template ?? null;

// The cards this game is asked: the free-form three only once the first
// answer has said no template makes it.
export const cardsFor = (answers) => CARDS.filter(
  (c) => !c.freeOnly || (answers.do !== undefined && templateFor(answers) === null),
);

export const nextCard = (answers) => cardsFor(answers).find((c) => answers[c.id] === undefined) ?? null;

export function progress(answers) {
  const cards = cardsFor(answers);
  return { done: cards.filter((c) => answers[c.id] !== undefined).length, of: cards.length };
}

// What Make it would make: a template, which brings its own scheme and
// engines, or none, whose scheme and engines are the free-form cards'.
export function recommend(answers) {
  const template = templateFor(answers);
  if (template) return { template, scheme: null, libraries: [] };
  return {
    template: null,
    scheme: HOLDING.find((h) => same(h.say, answers.hold))?.scheme ?? null,
    libraries: [
      ...(same(answers.bounce, 'Yes') ? ['physics'] : []),
      ...(same(answers.look, '3D') ? ['render3d'] : []),
    ],
  };
}
