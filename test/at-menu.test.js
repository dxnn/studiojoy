// The @ menu over the composer (chats.js): who it offers, what narrows it,
// and the one key that has to be taken from the composer — Enter, which picks
// a name rather than sending half a sentence.
//
// The rules it filters by are the server's, so they are checked against the
// same shapes server/mentions.js parses: an @ after a letter is an email
// address, not a mention, and a name is compared as its letters and digits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install, withClass } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S, composerBox } = await import('../public/main.js');
const { followAt, closeAtMenu } = await import('../public/chats.js');

// The menu is one node on the body, never in the tree — the same place the
// preview frame lives, and for the same reason.
const menu = () => document.body.children
  .find((n) => typeof n?.className === 'string' && n.className.split(' ')[0] === 'at-menu');
const open = () => menu().className.split(' ').includes('on');
const offered = () => withClass(menu(), 'at-name').map((n) => n.textContent);

function room({ bots = true, builder = false, canEdit = true } = {}) {
  S.me = { id: 1 };
  S.people = [
    { id: 1, display_name: 'Dann' },
    { id: 2, display_name: 'Robin Fox' },
    { id: 3, display_name: 'Rosa' },
  ];
  S.agents = [{ id: 10, name: 'Level Designer' }, { id: 11, name: 'Rocket Critic' }];
  S.project = {
    slug: 'tank',
    can_edit: canEdit,
    archived: false,
    agents: [{ agent_id: 10, name: 'Level Designer', chatty: false }],
  };
  S.chat = { id: 1, bots, builder };
  S.slug = 'tank';
  closeAtMenu();
}

// Typing, as far as this is concerned: the words in the box and the caret at
// the end of them.
function type(text) {
  composerBox.value = text;
  composerBox.selectionStart = text.length;
  composerBox.disabled = false;
  followAt();
}

// ⚠️ Through the composer's own keydown handler rather than straight into
// keyAt: the whole point of the menu taking Enter is that the composer's
// handler does not get it, and a test that called keyAt itself would pass
// with the two never wired together.
function press(key) {
  const event = { key, shiftKey: false, prevented: false };
  event.preventDefault = () => { event.prevented = true; };
  composerBox.handlers.get('keydown')(event);
  return event;
}

test('an @ offers everybody it could reach, and never yourself', () => {
  room();
  type('@');
  assert.ok(open());
  assert.deepEqual(offered(), ['Robin Fox', 'Rosa', 'Level Designer', 'Rocket Critic']);
});

test('what has been typed narrows it', () => {
  room();
  type('can you help @ro');
  assert.deepEqual(offered(), ['Robin Fox', 'Rosa', 'Rocket Critic']);
  type('can you help @rob');
  assert.deepEqual(offered(), ['Robin Fox']);
  type('can you help @nobody');
  assert.equal(open(), false, 'nothing to offer is a shut menu, not an empty one');
});

test('an email address is not a mention', () => {
  room();
  // The server's own rule: an @ counts at the start of the message or after
  // something that is not a letter or a digit.
  type('write to rosa@ro');
  assert.equal(open(), false);
});

test('Enter picks the name rather than sending the message', () => {
  room();
  type('ask @ro');
  press('Enter');
  // Sending would have emptied the box on its way out (main.js, sendComposer).
  assert.equal(composerBox.value, 'ask @Robin ');
  assert.equal(open(), false);
});

test('with the menu shut, Enter still sends', () => {
  room();
  type('no names in this one');
  assert.equal(open(), false);
  press('Enter');
  assert.equal(composerBox.value, '', 'the composer emptied it on the way out');
});

test('the arrows walk the list, and wrap', () => {
  room();
  type('@ro');
  press('ArrowDown');
  press('ArrowDown');
  press('Enter');
  assert.equal(composerBox.value, '@Rocket ');
  type('@ro');
  press('ArrowUp');
  press('Enter');
  assert.equal(composerBox.value, '@Rocket ');
});

test('the name lands where the @ was, with the rest of the sentence kept', () => {
  room();
  composerBox.value = 'ask @ro to help';
  composerBox.selectionStart = 7;
  composerBox.disabled = false;
  followAt();
  press('Enter');
  assert.equal(composerBox.value, 'ask @Robin to help');
  assert.equal(composerBox.selectionStart, 10, 'the caret is after the name');
});

test('a room that takes no helpers offers none', () => {
  room({ bots: false });
  type('@');
  assert.deepEqual(offered(), ['Robin Fox', 'Rosa']);
});

test('the builder’s room offers nobody who is not already in it', () => {
  // One seat, no +, and naming a second helper would be refused at the same
  // door (spec.md §3, §8) — so the menu does not offer one.
  room({ builder: true });
  type('@');
  assert.deepEqual(offered(), ['Robin Fox', 'Rosa', 'Level Designer']);
});

test('a game nobody here may change calls nobody new in', () => {
  room({ canEdit: false });
  type('@');
  assert.deepEqual(offered(), ['Robin Fox', 'Rosa', 'Level Designer']);
});

test('Escape shuts it and leaves the words alone', () => {
  room();
  type('ask @ro');
  press('Escape');
  assert.equal(open(), false);
  assert.equal(composerBox.value, 'ask @ro');
});
