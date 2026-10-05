// The phone header (spec/ §17): the game's bar, and under it the view changer
// that stands in for the pills on a phone — ‹, the mode you are on and what it
// is for, ›, and Preview. How it sits on a screen is the browser's to judge; what
// each control says it does, and that nothing in it is greyed, is this file's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install, all, withClass, hasClass } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in. An open menu is
// placed on the next frame, which a stand-in never draws.
install();
globalThis.requestAnimationFrame = () => 0;

const { S } = await import('../public/main.js');
const { renderPhoneHeader } = await import('../public/chat.js');
const { modesFor } = await import('../public/game-types.js');

const GAME = { kind: 'game', type: 'visual-novel' };

function head({ mode = 'chat', pane = 'chat', project = GAME, mentions = 0 } = {}) {
  S.project = {
    slug: 'tale', name: 'A Tale', can_edit: true, archived: false, open_edit: 1,
    published: false, mine: true, originator: true, agents: [], mentions, unread: 0,
    ...project,
  };
  S.slug = 'tale';
  S.mode = mode;
  S.narrowPane = pane;
  S.chats = [];
  return renderPhoneHeader();
}

const steps = (tree) => withClass(tree, 'view-step');
const said = (node) => node.attrs['aria-label'];

test('‹ and › step through every mode and wrap at both ends', () => {
  const modes = modesFor(GAME);
  modes.forEach((mode, i) => {
    const [back, on] = steps(head({ mode: mode.id }));
    const before = modes[(i - 1 + modes.length) % modes.length];
    const after = modes[(i + 1) % modes.length];
    assert.equal(said(back), `Go to ${before.label}`, `‹ from ${mode.label}`);
    assert.equal(said(on), `Go to ${after.label}`, `› from ${mode.label}`);
  });
});

test('the mode on screen says what it is for, which a pill only says on hover', () => {
  for (const mode of modesFor(GAME)) {
    const tree = head({ mode: mode.id });
    assert.equal(withClass(tree, 'view-name')[0].textContent, mode.label);
    assert.equal(withClass(tree, 'view-what')[0].textContent, mode.what);
  }
});

// For a mode further off than a step or two: the name is a button, and its
// list is every mode in the row's order, each saying what it is for — a phone
// has no hover to read a pill's title by — with the one on screen marked.
test('the name opens every mode as a list, the one on screen marked', () => {
  const modes = modesFor(GAME);
  S.menu = null;
  const [shut] = withClass(head({ mode: 'hear' }), 'view-now');
  assert.equal(shut.tag, 'button');
  assert.equal(shut.attrs['aria-haspopup'], 'menu');
  assert.equal(withClass(head({ mode: 'hear' }), 'menu').length, 0, 'shut until pressed');

  S.menu = 'modes';
  let items;
  try { items = withClass(head({ mode: 'hear' }), 'menu-item'); } finally { S.menu = null; }
  assert.deepEqual(items.map((n) => n.textContent), modes.map((m) => m.label));
  assert.deepEqual(items.map((n) => withClass(n, 'menu-sub')[0].textContent), modes.map((m) => m.what));
  assert.deepEqual(items.filter((n) => hasClass(n, 'on')).map((n) => n.textContent), ['Hear']);
});

test('Preview is one button, lit and saying so while the rail is up', () => {
  const [closed] = withClass(head({ pane: 'chat' }), 'view-preview');
  assert.equal(closed.textContent, 'Preview');
  assert.equal(hasClass(closed, 'on'), false);
  const [open] = withClass(head({ pane: 'rail' }), 'view-preview');
  assert.equal(open.textContent, 'Close preview');
  assert.equal(hasClass(open, 'on'), true);
});

test('nothing in the header is greyed out', () => {
  for (const pane of ['chat', 'rail']) {
    for (const node of all(head({ mode: 'story', pane }))) {
      assert.equal(node.disabled, undefined, `${node.tag}.${node.className} is not disabled`);
    }
  }
});

test('a chat project has the bar and no view changer: there is nothing to step to', () => {
  const tree = head({ project: { kind: 'chat', type: null } });
  assert.equal(withClass(tree, 'game-bar').length, 1);
  assert.equal(withClass(tree, 'view-changer').length, 0);
});

test('a call in Speak rides the arrow that reaches Speak sooner, and only one', () => {
  const modes = modesFor(GAME);
  const marks = (tree) => steps(tree).map((s) => withClass(s, 'called').length);
  assert.deepEqual(marks(head({ mode: modes[1].id, mentions: 2 })), [1, 0], 'one step back');
  assert.deepEqual(marks(head({ mode: modes.at(-1).id, mentions: 2 })), [0, 1], 'one step on');
  assert.deepEqual(marks(head({ mode: 'chat', mentions: 2 })), [0, 0], 'none while Speak is up');
});
