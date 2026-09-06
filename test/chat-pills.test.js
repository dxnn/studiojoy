// The row of chat pills over a thread: what a mark on one means.
//
// One rule, and it is the whole file. A pill wears a mark when there is
// something in that room you have not read — a plain dot for "something
// happened", `@n` for "somebody called you n times" — and never otherwise.
// Humans only used to carry a second dot that was always on, meaning "no
// helper is listening in here"; always-on, it said nothing and read as
// unread. That room says so with a dashed edge now (.quiet-room in
// modes.css), which is a class rather than a child.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install, all, withClass, hasClass } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S } = await import('../public/main.js');
const { renderChatTabs } = await import('../public/chat.js');

// A game with three rooms, the way one is born: Humans only, a helpers' room,
// and Building. `chats` is what the server sends for the pills.
function open(chats, { at = 1 } = {}) {
  const here = chats.find((c) => c.id === at);
  S.project = {
    kind: 'game', slug: 'tank', can_edit: true, archived: false, agents: [],
  };
  S.slug = 'tank';
  S.chats = chats;
  S.chat = here;
  return renderChatTabs(S.project);
}

const rooms = () => [
  { id: 1, name: 'Humans only', bots: false, unread: false, mentions: 0 },
  { id: 2, name: 'Sound effects', bots: true, unread: false, mentions: 0 },
  { id: 3, name: 'Building', bots: true, builder: true, unread: false, mentions: 0 },
];

// A pill's words are a text node among its children, so a name is looked for
// rather than read off the button.
const pillFor = (tree, name) => withClass(tree, 'chat-tab')
  .find((p) => all(p).some((n) => n.textContent === name));

test('a room with nothing new in it wears no mark at all', () => {
  const tree = open(rooms());
  assert.equal(withClass(tree, 'unread').length, 0, 'no dots');
  assert.equal(withClass(tree, 'called').length, 0, 'no counts');
  // ⚠️ The one that used to be there whatever happened.
  assert.equal(withClass(tree, 'hush').length, 0, 'Humans only carries no standing dot');
});

test('the human-only room says so with its edge, not with a dot', () => {
  const tree = open(rooms());
  const quiet = withClass(tree, 'quiet-room');
  assert.equal(quiet.length, 1, 'one room takes no helpers');
  assert.equal(quiet[0], pillFor(tree, 'Humans only'), 'and it is that one');
  for (const pill of withClass(tree, 'chat-tab')) {
    if (pill === quiet[0]) continue;
    assert.equal(hasClass(pill, 'quiet-room'), false, 'a room with helpers in it does not');
  }
});

test('something new in a room puts a dot on its pill', () => {
  const chats = rooms();
  chats[0].unread = true;
  const tree = open(chats, { at: 2 });
  const dots = withClass(tree, 'unread');
  assert.equal(dots.length, 1, 'one room, one dot');
  assert.equal(dots[0].parent, pillFor(tree, 'Humans only'), 'on the room it happened in');
});

test('being called by name shows the count instead of the dot', () => {
  const chats = rooms();
  chats[1].unread = true;
  chats[1].mentions = 3;
  const tree = open(chats, { at: 1 });
  assert.equal(withClass(tree, 'unread').length, 0, 'a count already says it is unread');
  const called = withClass(tree, 'called');
  assert.equal(called.length, 1);
  assert.equal(called[0].textContent, '@3');
});
