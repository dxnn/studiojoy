// How a *config file* opens: a field per value with its comment beside it,
// parsed without being executed and saved by splicing one value at a time.
// The reading and splicing itself is config-file.js; this is the form.

import { parseConfigFile, literalFor, spliceValue } from './config-file.js';
import { h } from './dom.js';
import { S, render, frozen } from './main.js';
import { saveOpenFile } from './files.js';

/* Config form -------------------------------------------------------------- */

export { isConfigPath } from './config-file.js';

const looksLikeColour = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v);

// Where a value sits in the file: the declaration's name, then keys and list
// positions down to it — ['TRACKS', 1, 'width'].
export function nodeAt(decls, path) {
  let node = decls.find((d) => d.name === path[0])?.node;
  for (const step of path.slice(1)) {
    if (!node) return null;
    node = typeof step === 'number'
      ? node.items?.[step]
      : node.props?.find((p) => p.key === step)?.node;
  }
  return node ?? null;
}

// One value changed. The file is re-read here rather than the nodes being kept
// from the last render for two reasons: a splice moves every offset after it,
// so a second edit against stale nodes would land in the wrong place; and
// re-rendering the pane on each change would replace the Save button under the
// pointer, so clicking Save right after typing would do nothing.
//
// The file is spliced, never regenerated, so comments and alignment survive.
function setConfigValue(path, kind, raw, input) {
  const parsed = parseConfigFile(S.open.content);
  const node = parsed.ok ? nodeAt(parsed.decls, path) : null;
  const literal = node === null ? null : literalFor(kind, raw);
  if (literal === null) {
    // A number left empty or filled with words changes nothing; put the field
    // back to what the file still says.
    if (input && node) input.value = String(node.value);
    return;
  }
  S.open.content = spliceValue(S.open.content, node, literal);
  markUnsaved();
}

// The first keystroke is already unsaved work, even a half-typed number that
// cannot be written yet — without this the Save button stayed grey while you
// typed, and a click on it did nothing until you had clicked somewhere else
// first. Patched directly, like setConfigValue: a render here would replace
// the field mid-keystroke.
function markUnsaved() {
  S.open.dirty = true;
  const save = document.getElementById('save-btn');
  if (save) save.disabled = false;
  const status = document.getElementById('cfg-status');
  if (status) status.textContent = 'Not saved yet';
}

// The id is how render() finds the field again and puts the caret back: a
// write to anybody's game rebuilds the whole tree, this form included.
const fieldId = (path) => `cfg.${path.join('.')}`;

// What a field does with a value, and what it is called. The form's own
// writes into the open file; the tweaks under the preview (tweaks.js) write
// into the running game and nowhere else, under ids of their own so the two
// can be on screen at once.
const FORM = {
  set: setConfigValue,
  typing: () => markUnsaved(),
  id: fieldId,
  marked: () => false,
};

// Fields write into the open file as they are typed, so a background render
// rebuilds them with what was typed rather than what the file said before.
// A half-typed number is never written: it waits for the next keystroke, and
// is put back to what the file says if focus leaves it half-typed.
function configField(node, path, how) {
  if (node.kind === 'boolean') {
    return h('input', {
      type: 'checkbox', id: how.id(path),
      checked: node.value === true,
      onchange: (e) => how.set(path, 'boolean', e.currentTarget.checked),
    });
  }
  if (node.kind === 'number') {
    const input = h('input', {
      type: 'number', step: 'any', class: 'cfg-num', id: how.id(path),
      oninput: (e) => { how.typing(); how.set(path, 'number', e.currentTarget.value); },
      onchange: (e) => how.set(path, 'number', e.currentTarget.value, e.currentTarget),
    });
    input.value = String(node.value);
    return input;
  }
  if (node.kind === 'string' && looksLikeColour(node.value)) {
    const shown = h('span', { class: 'mono hint', text: node.value });
    const input = h('input', {
      type: 'color', id: how.id(path),
      oninput: (e) => {
        how.set(path, 'string', e.currentTarget.value);
        shown.textContent = e.currentTarget.value;
      },
    });
    // <input type="color"> only speaks #rrggbb, so #fc0 is doubled up to show
    // it; that is only written back if a colour is actually picked.
    input.value = node.value.length === 4
      ? `#${node.value.slice(1).split('').map((c) => c + c).join('')}`
      : node.value;
    return h('span', { class: 'row' }, input, shown);
  }
  if (node.kind === 'string') {
    // A line with a newline in it is a paragraph, so it gets a box that shape.
    const multiline = node.value.includes('\n');
    const input = h(multiline ? 'textarea' : 'input', {
      class: 'cfg-text', id: how.id(path),
      ...(multiline ? { rows: 2 } : { type: 'text' }),
      oninput: (e) => how.set(path, 'string', e.currentTarget.value),
    });
    input.value = node.value;
    return input;
  }
  // null, and anything else the reader allows but has no field for.
  return h('span', { class: 'mono hint muted', text: String(node.value) });
}

// A row per value, nesting for lists and groups. A list of groups — the tracks
// in a racing game, the levels in a platformer — comes out as one block per
// item, which is how it reads in the file too.
export function configRows(label, node, path, how = FORM) {
  const comment = node.comment;
  if (node.kind === 'array' || node.kind === 'object') {
    const kids = node.kind === 'array'
      ? node.items.map((item, i) => configRows(`#${i + 1}`, item, [...path, i], how))
      : node.props.map((p) => configRows(p.key, p.node, [...path, p.key], how));
    return h('div', { class: 'cfg-group' },
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: label }),
        comment ? h('span', { class: 'hint muted', text: comment }) : null),
      h('div', { class: 'cfg-group-body' }, kids));
  }
  return h('label', { class: `cfg-row${how.marked(path) ? ' tweaked' : ''}` },
    h('span', { class: 'cfg-name mono', text: label }),
    configField(node, path, how),
    comment ? h('span', { class: 'hint muted', text: comment }) : null);
}

export function renderConfigForm(decls) {
  const body = decls.length
    ? decls.map((d) => configRows(d.name, d.node, [d.name]))
    : [h('div', { class: 'pad muted', text: 'Nothing to change in here yet.' })];

  return [
    h('div', { class: 'scroll cfg', 'data-scroll': 'cfg' }, body),
    h('div', { class: 'editor-bar row' },
      h('span', {
        class: 'hint muted', id: 'cfg-status', text: S.open.dirty ? 'Not saved yet' : 'Saved',
      }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'link', text: 'Show the text',
        onclick: () => { S.open.asText = true; render(); },
      }),
      h('button', {
        class: 'filled', id: 'save-btn', text: 'Save',
        disabled: !S.open.dirty || frozen(),
        onclick: () => saveOpenFile(),
      })),
  ];
}
