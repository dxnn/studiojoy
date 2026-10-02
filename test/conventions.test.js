// The studio's own three conventions, over a rendered tree (CLAUDE.md,
// "Three conventions to keep"). Every one of these was found by eye in a
// browser this week; a browser is the right place to judge how something
// looks and the wrong place to find out whether a row is clickable.
//
// The Controls panel was the first surface held to them. The point is the
// pattern rather than the panel: a second one is a `render` call and the
// same assertions, and `conventionBreaks` reads the ones every surface keeps
// — what lights up, what scrolls, what wears gold — off the stylesheet itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  install, all, withClass, pressable, hasClass, textOf,
  conventionBreaks, litIn, goldIn, press,
} from './dom-stand-in.js';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');
const read = (rel) => fs.readFileSync(path.join(publicDir, rel), 'utf8');

// ⚠️ Before main.js, which reads `document` on the way in.
install();

// Every request a render makes, answered with a 404. Recorded rather than
// refused, so the Controls panel can be held to asking for nothing while
// Share — whose achievements fetch their counts — still renders whole.
const asked = [];
globalThis.fetch = async (url) => {
  asked.push(String(url));
  return {
    ok: false, status: 404, headers: new Headers(), json: async () => ({}), text: async () => '', blob: async () => new Blob(),
  };
};

const { h } = await import('../public/dom.js');
const { S, renderModeBody } = await import('../public/main.js');
const { controlsModel } = await import('../public/controls-editor.js');
const { renderControlsForm } = await import('../public/controls-form.js');
const { renderModes } = await import('../public/chat.js');
const { achievementsModel } = await import('../public/achievements-editor.js');
const { storyModel } = await import('../public/story-editor.js');

const SEED = read('templates/controls.js');
const registry = JSON.parse(read('templates/index.json'));

// A game nobody has dressed, changeable unless said otherwise.
function game(extra = {}) {
  S.project = {
    slug: 'tank', name: 'Tank', kind: 'game', type: null, can_edit: true, archived: false, agents: [],
    mine: true, published: false, scores_on: true, play_url: 'http://games.test/tank/', ...extra,
  };
  S.slug = 'tank';
  S.open = null;
  S.pick = null;
  S.dialog = null;
}

// A game open on config/controls.js, changeable, with the studio's own
// registry loaded — the state the panel renders from.
function open(text = SEED, { canEdit = true, verb = null } = {}) {
  game({ can_edit: canEdit });
  S.files = [{ path: 'config/controls.js', text: true }];
  S.open = {
    path: 'config/controls.js', content: text, etag: 'w/"1"', dirty: false,
  };
  S.schemes = registry;
  S.controlsVerb = verb;
  S.controlsKey = null;
  const model = controlsModel(text);
  assert.equal(model.ok, true, model.reason);
  return renderControlsForm(model);
}

test('the stylesheet is read: rows light up, and a score wears gold', () => {
  // Without this the checks below could pass by finding nothing to ask about.
  const tree = open(SEED, { verb: 'player1/fire' });
  assert.ok(litIn(tree).some((n) => hasClass(n, 'ctl-verb')), 'a verb row lights up');
  assert.ok(goldIn(share()).some((n) => textOf(n).includes('1,200')), 'the score is gold');
});

test('a break is reported: a nameless scroller, and gold over words', () => {
  const nameless = h('div', { class: 'scroll' });
  assert.match(conventionBreaks(nameless).join(), /scrolls with no data-scroll name/);
  const wordy = h('div', { class: 'score-row' }, h('span', { class: 'sval', text: 'Mila' }));
  assert.match(conventionBreaks(wordy).join(), /wears gold and is not a number/);
  const scored = h('div', { class: 'score-row' }, h('span', { class: 'sval', text: '1,200' }));
  assert.deepEqual(conventionBreaks(scored), []);
});

test('the Controls panel keeps the conventions every surface keeps', () => {
  assert.deepEqual(conventionBreaks(open(SEED, { verb: 'player1/fire' })), []);
  assert.deepEqual(conventionBreaks(open(SEED, { canEdit: false })), []);
});

test('what lights up is what can be clicked', () => {
  const tree = open(SEED, { verb: 'player1/fire' });
  // A row that highlights under the pointer says so with a class, and every
  // one of them opens on a click anywhere in it.
  const rows = withClass(tree, 'opens');
  assert.ok(rows.length > 0, 'there are rows that open');
  for (const row of rows) assert.ok(pressable(row), 'a row that lights up is pressable');
  // And the other way: nothing in here lights up without doing anything.
  for (const row of withClass(tree, 'ctl-verb')) {
    assert.equal(hasClass(row, 'opens'), pressable(row), 'lights up if and only if it opens');
  }
});

test('nothing is greyed out where a row would have to explain why', () => {
  // The shape a game already wears is not a button at all — a disabled row is
  // a question, and "why can I not press this" has no answer a row can give.
  const tree = open();
  for (const row of withClass(tree, 'ctl-shape')) {
    assert.equal(row.disabled, undefined, `${row.tag} row is never disabled`);
    assert.equal(hasClass(row, 'on') ? 'div' : 'button', row.tag, 'the one it wears is not a button');
  }
  // In a game you may not change, none of them is a button and none is greyed.
  const frozen = open(SEED, { canEdit: false });
  for (const row of withClass(frozen, 'ctl-shape')) {
    assert.equal(row.tag, 'div');
    assert.equal(row.disabled, undefined);
  }
});

test('one thing open at a time, in the row it belongs to', () => {
  const shut = open();
  assert.equal(withClass(shut, 'ctl-editor').length, 0, 'nothing open to start');

  const tree = open(SEED, { verb: 'player1/fire' });
  const editors = withClass(tree, 'ctl-editor');
  assert.equal(editors.length, 1, 'exactly one');
  assert.equal(withClass(tree, 'ctl-verb on').length, 0, 'the class is not one string');
  assert.equal(all(tree).filter((n) => hasClass(n, 'ctl-verb') && hasClass(n, 'on')).length, 1);
  // In the row it belongs to, not at the foot of the list: the editor's
  // parent holds the row that opened it.
  const [editor] = editors;
  const beside = editor.parent.children.find((kid) => hasClass(kid, 'ctl-verb'));
  assert.ok(beside, 'the open row is its sibling');
  assert.equal(beside.children[0].textContent, 'fire', 'and it is the one that was pressed');
});

test('gold is a number and nothing else', () => {
  // The studio's gold is --num, and nothing in this panel is a number, so
  // nothing in it may wear it — which rules wear it is the stylesheet's say.
  assert.deepEqual(goldIn(open(SEED, { verb: 'player1/fire' })), []);
});

test('a render asks nothing of the network', () => {
  // The panel renders from the state it was given.
  asked.length = 0;
  open(SEED, { verb: 'player1/start' });
  assert.deepEqual(asked, []);
});

/* Hear ----------------------------------------------------------------------- */

const sound = (p) => ({
  path: p, mime: 'audio/wav', size: 2048, text: false,
});
const SOUNDS = [sound('assets/sounds/jump.wav'), sound('assets/sounds/coin.wav'), sound('assets/music/theme.wav')];

function hear(openPath = null) {
  game();
  S.mode = 'hear';
  S.files = SOUNDS;
  S.open = openPath ? { path: openPath, mime: 'audio/wav' } : null;
  S.sound = null;
  return renderModeBody();
}

test('Hear keeps the conventions, with a sound open and without', () => {
  assert.ok(litIn(hear()).some((n) => hasClass(n, 'hear-row')), 'the sound rows light up');
  assert.deepEqual(conventionBreaks(hear()), []);
  assert.deepEqual(conventionBreaks(hear('assets/sounds/coin.wav')), []);
});

test('Hear has one sound open at a time, marked in its own row', () => {
  assert.equal(withClass(hear(), 'hear-row').filter((n) => hasClass(n, 'on')).length, 0);
  const on = withClass(hear('assets/sounds/coin.wav'), 'hear-row').filter((n) => hasClass(n, 'on'));
  assert.equal(on.length, 1);
  assert.match(textOf(on[0]), /coin\.wav/);
});

test('a sound row opens by handing back its promise', async () => {
  const [row] = withClass(hear(), 'hear-row');
  const out = press(row);
  assert.equal(typeof out?.then, 'function', 'returned, not fired');
  await out;
});

/* Share and Versions ------------------------------------------------------------ */

const ACHIEVEMENTS = `
const ACHIEVEMENTS = [
  { id: "first-run", name: "First run", how: "Finish a run", icon: "🚀", when: { moment: "run-over" } },
  { id: "halfway", name: "Halfway there", how: "Reach level 5", when: { moment: "level", atLeast: 5 } },
];
`;

function share() {
  game();
  S.mode = 'share';
  S.files = [{ path: 'config/achievements.js', text: true }];
  const read = achievementsModel(ACHIEVEMENTS);
  assert.equal(read.ok, true, read.reason);
  S.achievements = {
    text: ACHIEVEMENTS, etag: 'w/"1"', model: { entries: read.entries }, dirty: false,
  };
  S.scores = [{ name: 'Mila', score: 1200, created_at: new Date().toISOString() }];
  return renderModeBody();
}

test('Share keeps the conventions: the link, the achievements and the board', () => {
  assert.deepEqual(conventionBreaks(share()), []);
});

test('Versions keeps the conventions', () => {
  game();
  S.mode = 'versions';
  S.files = [];
  S.historyPath = null;
  S.history = [
    { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', short: 'a1b2c3d', subject: 'Draw a dragon', author: 'Mila', at: '2026-10-02T10:00:00Z', paths: ['assets/sprites/dragon.png'] },
    { sha: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890', short: 'b2c3d4e', subject: 'Make a jump', author: 'Mila', at: '2026-10-01T10:00:00Z', paths: ['assets/sounds/jump.wav'] },
  ];
  S.diff = null;
  assert.deepEqual(conventionBreaks(renderModeBody()), []);
  // The sha is the one thing on the list that is gold.
  assert.ok(goldIn(renderModeBody()).length >= 2, 'each version’s sha is gold');
});

/* The story editor ---------------------------------------------------------------- */

// The example story the guide puts in, as the editor would have read it.
function story({ canEdit = true } = {}) {
  game({ type: 'visual-novel', can_edit: canEdit });
  S.mode = 'story';
  const text = read('story-art/examples/mila-story.js');
  const parsed = storyModel(text);
  assert.equal(parsed.ok, true, parsed.reason);
  S.files = [{ path: 'config/story.js', text: true }];
  S.story = {
    text, etag: 'w/"1"', model: { cast: parsed.cast, scenes: parsed.scenes }, words: null,
    dirty: false, scene: parsed.scenes[0].key, step: 'scene', person: null,
  };
  return renderModeBody();
}

test('the story editor keeps the conventions, changeable and not', () => {
  const tree = story();
  assert.ok(litIn(tree).some((n) => hasClass(n, 'strip-row')), 'the scene rows light up');
  assert.deepEqual(conventionBreaks(tree), []);
  assert.deepEqual(conventionBreaks(story({ canEdit: false })), []);
  // One scene is the one being looked at, marked in its own row.
  const on = withClass(story(), 'strip-row').filter((n) => hasClass(n, 'on'));
  assert.equal(on.length, 1);
});

/* The mode row ------------------------------------------------------------------- */

test('the mode row keeps the conventions and opens by handing back its promise', async () => {
  game();
  S.mode = 'chat';
  S.files = [];
  const row = renderModes(S.project);
  assert.deepEqual(conventionBreaks(row), []);
  assert.equal(withClass(row, 'mode').filter((n) => hasClass(n, 'on')).length, 1, 'one mode is on');
  const pics = withClass(row, 'mode').find((n) => !hasClass(n, 'on') && n.attrs.title && /picture/i.test(n.attrs.title));
  assert.ok(pics, 'there is a Pics pill');
  const out = press(pics);
  assert.equal(typeof out?.then, 'function', 'returned, not fired');
  await out;
  assert.equal(S.mode, 'pics');
});
