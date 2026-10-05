// The games list's groups (spec/ §6): four of them, Archived last, each
// folding away behind its own heading, Archived folded to begin with. The
// four things worth holding are that an archived game leaves the other
// groups whatever else is true of it, that folding is remembered, that a
// filter can never hide a match behind a shut heading, and that within a
// group the game that changed last comes first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install, all, withClass, hasClass, pressable } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` and the stored rail width on the
// way in — and a real store, because what is remembered is half of this.
install();
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
};

const { S } = await import('../public/main.js');
const { renderSidebar, lastSaid } = await import('../public/sidebar.js');

const game = (slug, extra) => ({
  slug, name: slug, kind: 'game', mine: false, open_edit: false, archived: false,
  authors: [], preview: '', unread: false, mentions: 0, ...extra,
});

const GAMES = [
  game('tank', { mine: true }),
  game('kart', { open_edit: true }),
  game('maze'),
  game('old-tank', { mine: true, archived: true }),
  game('old-maze', { archived: true }),
];

function open({ find = '', projects = GAMES } = {}) {
  S.me = { id: 1, display_name: 'Dann', admin: false };
  S.projects = projects;
  S.icons = new Map();
  S.people = [];
  S.agents = [];
  S.sideTab = 'games';
  S.sideFind = find;
  S.sidebar = true;
  S.narrowPane = null;
  S.slug = null;
  S.project = null;
  return renderSidebar();
}

const headings = (tree) => all(tree)
  .filter((n) => hasClass(n, 'section-label'))
  .map((n) => withClass(n, 'glabel')[0]?.textContent ?? n.textContent);

const names = (tree) => withClass(tree, 'iname').map((n) => n.textContent);

test('four groups, Archived last', () => {
  store.clear();
  assert.deepEqual(headings(open()), ['Yours', 'Open to everyone', 'Everyone else’s', 'Archived']);
});

// The three groups above Archived are about what you may do to a game. There
// is nothing you may do to an archived one, so being yours does not keep it
// up there — which is what the italic rows scattered through them were.
test('an archived game is only ever in Archived', () => {
  store.clear();
  assert.deepEqual(names(open()), ['tank', 'kart', 'maze']);
  store.set('gs.group-archived', 'open');
  assert.deepEqual(names(open()), ['tank', 'kart', 'maze', 'old-tank', 'old-maze']);
});

test('Archived is shut to begin with and says how many are in it', () => {
  store.clear();
  const tree = open();
  const heads = withClass(tree, 'group-head');
  assert.equal(heads.length, 4, 'every heading is the control that folds it');
  for (const head of heads) assert.ok(pressable(head), 'a heading can be pressed');
  const archived = heads.at(-1);
  assert.equal(archived.attrs['aria-expanded'], 'false');
  assert.equal(withClass(archived, 'gcount')[0].textContent, '2');
  assert.equal(withClass(archived, 'caret')[0].textContent, '▸');
});

test('a group folded away is remembered, and so is one opened', () => {
  store.clear();
  store.set('gs.group-mine', 'closed');
  const tree = open();
  assert.deepEqual(names(tree), ['kart', 'maze'], 'Yours is folded away');
  // The heading stays: it is how you get the group back, and it still counts.
  assert.deepEqual(headings(tree).slice(0, 1), ['Yours']);
  assert.equal(withClass(withClass(tree, 'group-head')[0], 'gcount')[0].textContent, '1');
});

// A filter that hides a match is a filter that lies, and a control that
// cannot do anything should not be offered.
test('a filter opens every group and takes the folding away', () => {
  store.clear();
  store.set('gs.group-archived', 'closed');
  const tree = open({ find: 'tank' });
  assert.deepEqual(names(tree), ['tank', 'old-tank']);
  assert.deepEqual(headings(tree), ['Yours', 'Archived']);
  assert.equal(withClass(tree, 'group-head').length, 0, 'plain labels while filtering');
});

// The server sends the list newest made first; each group re-sorts it by
// when the game last changed, and only within itself — a busy game of
// somebody else's never climbs into Yours.
test('each group lists the most recently changed first', () => {
  store.clear();
  const at = (day) => `2026-09-0${day}T12:00:00.000Z`;
  const tree = open({
    projects: [
      game('tank', { mine: true, updated_at: at(1) }),
      game('bomb', { mine: true, updated_at: at(3) }),
      game('kart', { open_edit: true, updated_at: at(2) }),
      game('maze', { updated_at: at(2) }),
      game('pipe', { updated_at: at(4) }),
    ],
  });
  assert.deepEqual(names(tree), ['bomb', 'tank', 'kart', 'pipe', 'maze']);
});

// The line under a game of yours says who spoke last: You, as the thread says
// it; a person by name; every helper as Bot; the studio's own notices — a
// paused plan, a fork's first line — as Studio, even when one carries the
// builder's id.
test('the line under a game says who said the last thing', () => {
  S.me = { id: 1, display_name: 'Dann' };
  const from = (extra) => ({ kind: null, user_id: null, user_name: null, agent_id: null, ...extra });
  const line = (previewFrom) => lastSaid({ preview: 'hi', preview_from: previewFrom }, 'No messages yet');
  assert.equal(line(from({ user_id: 1, user_name: 'Dann' })), 'You: hi');
  assert.equal(line(from({ user_id: 2, user_name: 'Robin' })), 'Robin: hi');
  assert.equal(line(from({ agent_id: 7 })), 'Bot: hi');
  assert.equal(line(from({ kind: 'plan', agent_id: 7 })), 'Bot: hi');
  assert.equal(line(from({ kind: 'system', agent_id: 7 })), 'Studio: hi');
  assert.equal(line(from({ kind: 'system' })), 'Studio: hi');
  assert.equal(lastSaid({ preview: '', preview_from: null }, 'No messages yet'), 'No messages yet');
});
