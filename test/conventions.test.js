// The studio's own three conventions, over a rendered tree (CLAUDE.md,
// "Three conventions to keep"). Every one of these was found by eye in a
// browser this week; a browser is the right place to judge how something
// looks and the wrong place to find out whether a row is clickable.
//
// The Controls panel is the first surface held to them. The point is the
// pattern rather than the panel: a second one is a `render` call and the same
// three assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { install, all, withClass, pressable, hasClass } from './dom-stand-in.js';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');
const read = (rel) => fs.readFileSync(path.join(publicDir, rel), 'utf8');

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S } = await import('../public/main.js');
const { controlsModel } = await import('../public/controls-editor.js');
const { renderControlsForm } = await import('../public/controls-form.js');

const SEED = read('templates/controls.js');
const registry = JSON.parse(read('templates/index.json'));

// A game open on config/controls.js, changeable, with the studio's own
// registry loaded — the state the panel renders from.
function open(text = SEED, { canEdit = true, verb = null } = {}) {
  S.project = { slug: 'tank', can_edit: canEdit, archived: false };
  S.slug = 'tank';
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
  // The one colour rule a tree can check: the studio's gold is --highlight,
  // and the classes that wear it are for a score or a version. Nothing in
  // this panel is either, so nothing in it may claim one.
  const tree = open(SEED, { verb: 'player1/fire' });
  for (const node of all(tree)) {
    for (const name of ['gold', 'score', 'version']) {
      assert.equal(hasClass(node, name), false, `${name} on a ${node.tag} that is not a number`);
    }
  }
});

test('a render asks nothing of the network', () => {
  // The stand-in's fetch rejects, so this passing at all is the assertion:
  // the panel renders from the state it was given.
  assert.doesNotThrow(() => open(SEED, { verb: 'player1/start' }));
});
