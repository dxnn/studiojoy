// Code: the file list, and what happens to it when a file is open.
//
// On a phone an open file takes the whole pane — five rows of list and a
// header over the keyboard left about four lines of the file. That is one
// media query in code-tree.css keyed on `short`, and `short` has to be on
// both halves of the list or the buttons stay behind after the rows go.
// This is the seam between the two files, which is the part nothing else
// would notice breaking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { install, all, withClass, hasClass } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { S } = await import('../public/main.js');
const { renderFilesTab } = await import('../public/files-tab.js');

const css = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', 'public', 'css', 'code-tree.css'), 'utf8',
);

function open(file = null) {
  S.project = {
    kind: 'game', slug: 'tank', can_edit: true, archived: false, agents: [],
  };
  S.slug = 'tank';
  S.mode = 'code';
  S.pinned = new Set();
  S.files = [
    { path: 'index.html', size: 120 },
    { path: 'js/game.js', size: 900 },
  ];
  S.open = file
    ? { path: file, content: 'let a = 1;\n', etag: 'w/"1"', dirty: false }
    : null;
  return renderFilesTab();
}

test('with nothing open the list fills the pane', () => {
  const tree = open();
  assert.equal(withClass(tree, 'tree').length, 1);
  assert.equal(withClass(tree, 'short').length, 0, 'nothing is shortened');
  assert.equal(withClass(tree, 'editor').length, 0, 'and no editor is up');
});

test('⚠️ an open file marks the list and the row over it the same way', () => {
  const tree = open('js/game.js');
  const list = withClass(tree, 'tree')[0];
  const top = withClass(tree, 'tree-top')[0];
  assert.ok(list && top, 'the list and its buttons are both there');
  assert.ok(hasClass(list, 'short'), 'the rows are shortened');
  assert.ok(hasClass(top, 'short'), 'and so is the row of buttons over them');
  assert.equal(withClass(tree, 'editor').length, 1, 'the editor is up');
});

test('⚠️ the narrow rule hides both halves, or the buttons outlive the rows', () => {
  // Everything from the narrow @media to the end of the file. Code's narrow
  // shape is its own, so it is the last thing in here (CLAUDE.md) — good
  // enough to read without counting braces, and a second @media after it
  // would be the thing to notice anyway.
  const at = css.indexOf('@media (max-width: 860px)');
  assert.ok(at > 0, 'code-tree.css has a narrow rule of its own');
  const narrow = css.slice(at);
  assert.match(narrow, /\.tree\.short/, 'it hides the rows');
  assert.match(narrow, /\.tree-top\.short/, 'and the buttons over them');
  assert.match(narrow, /display:\s*none/);
});

test('the way back out of a file is in the editor’s own bar', () => {
  // With the list gone on a phone, ✕ is the only way back to it — so it has
  // to be there whatever kind of file is open.
  const tree = open('js/game.js');
  const bar = withClass(tree, 'bar')[0];
  const closer = all(bar).find((n) => n.textContent === '✕');
  assert.ok(closer, 'the editor closes itself');
  assert.ok(closer.handlers?.get('click'), 'and pressing it does something');
});
