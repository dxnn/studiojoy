// A field that commits when it is left (public/typed.js, spec/ §17): what is
// typed survives a render, a render's own change and blur commit nothing, and
// leaving commits once. Chrome fires change and blur on a field a render takes
// away, which is how a new mood kept coming back as "mood".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S } = await import('../public/main.js');
const { typedField } = await import('../public/typed.js');

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const event = (value, { connected = true } = {}) => ({ currentTarget: { value, isConnected: connected } });

function field(from = 'mood', id = 'story-mood-0') {
  const commits = [];
  const typed = typedField(id, from, (text) => commits.push(text));
  return { ...typed, commits };
}

test('what is typed comes back in the rebuilt field, not the old name', async () => {
  S.slug = 'tale';
  const before = field();
  assert.equal(before.value, 'mood');
  before.on.oninput(event('hap'));
  assert.equal(field().value, 'hap');
  // Leave it, so the next test starts clean.
  document.activeElement = null;
  before.on.onchange(event('hap'));
  await tick();
  assert.deepEqual(before.commits, ['hap']);
});

test('a render taking the field away commits nothing', async () => {
  S.slug = 'tale';
  const old = field();
  old.on.oninput(event(''));
  // The render: change and blur on the old node, gone from the page, and the
  // field with the same id back under the fingers.
  document.activeElement = { id: 'story-mood-0' };
  old.on.onchange(event('', { connected: false }));
  old.on.onblur(event('', { connected: false }));
  await tick();
  assert.deepEqual(old.commits, [], 'nothing committed, so no "mood" again');
  assert.equal(field().value, '', 'and the emptied field is still empty');
});

test('leaving commits once, even from a field nobody typed in since a render', async () => {
  S.slug = 'tale';
  const rebuilt = field();
  document.activeElement = { id: 'somewhere-else' };
  // A rebuilt field sends no change when it is left, only a blur.
  rebuilt.on.onblur(event(''));
  await tick();
  assert.equal(rebuilt.commits.length, 1);
  const again = field();
  again.on.oninput(event('sad'));
  again.on.onchange(event('sad'));
  again.on.onblur(event('sad'));
  await tick();
  assert.deepEqual(again.commits, ['sad'], 'change then blur is one commit');
  assert.equal(field('mood').value, 'mood', 'and nothing is held afterwards');
});

test('a draft stays with its game and with the name it was typed over', async () => {
  S.slug = 'tale';
  const one = field();
  one.on.oninput(event('angry'));
  S.slug = 'other';
  assert.equal(field().value, 'mood', 'another game with the same field never sees it');
  S.slug = 'tale';
  assert.equal(field('normal').value, 'normal', 'nor does a field standing for another name');
  assert.equal(field().value, 'angry');
  document.activeElement = null;
  one.on.onblur(event('angry'));
  await tick();
  assert.deepEqual(one.commits, ['angry']);
});
