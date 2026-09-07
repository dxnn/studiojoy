// The shelf as a dialog (spec.md §6): what *Add from the studio* puts in its
// grid, given the three halves. The stand-in refuses the network on purpose;
// here it is handed the halves instead, because what the shelf shows *given*
// an index is the whole question. Two rules, each paid for once: the shelf is
// pictures only, though the standard set's index lists a sound beside them;
// and what people here made comes first, because in index order it sat
// behind the big set's 1,775 and past the cap, so it never showed until its
// name was typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install, all, withClass } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

const { h } = await import('../public/dom.js');
const { renderShelfDialog, artShelf, dropArtIndex } = await import('../public/story-guide.js');

const STANDARD = {
  art: [
    { file: 'portraits/mila-happy.png', kind: 'portrait', name: 'Mila, happy', by: 'Unbridled Joy', licence: 'CC0' },
    { file: 'backgrounds/forest.png', kind: 'background', name: 'A forest', by: 'Stealthix', licence: 'CC0' },
    { file: 'sounds/page.wav', kind: 'sound', name: 'A page turning', by: 'Unbridled Joy', licence: 'CC0' },
  ],
};
// More than the grid draws at once, so the collection would be past the cap.
const BIG = {
  art: Array.from({ length: 150 }, (_, i) => ({
    file: `kenney/thing-${i}.png`, kind: 'sprite', name: `Thing ${i}`, by: 'Kenney', licence: 'CC0', tags: 'things',
  })),
};
const OURS = {
  art: [{
    id: 7, file: '/api/collection/7', kind: 'portrait', name: 'Dad as a dragon', by: 'Ada', made_here: true, mine: false,
  }],
};

const answers = { '/story-art/index.json': STANDARD, '/big-set/index.json': BIG };
globalThis.fetch = async (url) => ({ ok: true, json: async () => answers[url] });

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

async function shelf({ art = null, ours = OURS, title } = {}) {
  answers['/api/collection'] = ours;
  dropArtIndex();
  const node = renderShelfDialog({
    kind: 'pick-picture', art, title, place: async () => {},
  }, {
    wide: (title, ...body) => h('div', { class: 'dialog wide' }, h('h2', { text: title }), ...body),
    cancel: h('button', { text: 'Cancel' }),
    close: () => {},
  });
  // A browser's search box starts empty; the stand-in's starts with nothing.
  const filter = all(node).find((n) => n.tag === 'input');
  filter.value = '';
  await settle();
  return { node, filter, grid: withClass(node, 'shelf-grid')[0] };
}

// The grid, top to bottom: a label in brackets, a picture by its name.
const rows = (grid) => grid.children.map((n) => (n.className === 'section-label' ? `[${n.textContent}]` : n.children[1].textContent));
const names = (node) => withClass(node, 'art-name').map((n) => n.textContent);
const note = (node) => all(node).find((n) => n.tag === 'p').textContent;

test('the shelf from Pics is pictures only', async () => {
  const { node } = await shelf();
  const shown = names(node);
  assert.ok(shown.includes('Mila, happy'), 'a face is on it');
  assert.ok(shown.includes('A forest'), 'a place is on it');
  assert.ok(shown.includes('Thing 0'), 'a thing is on it');
  assert.ok(!shown.includes('A page turning'), 'the index\'s sound is not');
});

test('what people here made comes first, under its own label, past any cap', async () => {
  const { grid, node } = await shelf();
  const seen = rows(grid);
  assert.deepEqual(seen.slice(0, 3), ['[Made here]', 'Dad as a dragon', '[Everything else]']);
  assert.equal(seen.length, 3 + 120, 'the cap is on everything else');
  // 152 shipped, 120 drawn: the count under the grid is of what was held back.
  assert.equal(note(node), '32 more — type a word to narrow it down.');
});

test('with nothing made here the shelf is one grid', async () => {
  const { node } = await shelf({ ours: { art: [] } });
  assert.equal(withClass(node, 'section-label').length, 0);
  assert.equal(names(node).length, 120);
});

test('a kind asked for narrows both halves alike', async () => {
  const { grid } = await shelf({ art: 'portrait' });
  assert.deepEqual(rows(grid), ['[Made here]', 'Dad as a dragon', '[Everything else]', 'Mila, happy']);
});

test('a thing made here is on the things shelf, first', async () => {
  const ours = {
    art: [{
      id: 8, file: '/api/collection/8', kind: 'sprite', name: 'Our rocket', by: 'Ada', made_here: true, mine: false,
    }],
  };
  const { grid } = await shelf({ art: 'sprite', ours });
  assert.deepEqual(rows(grid).slice(0, 4), ['[Made here]', 'Our rocket', '[Everything else]', 'Thing 0']);
});

test('the dialog is titled for its kind unless the opener says otherwise', async () => {
  const title = (node) => all(node).find((n) => n.tag === 'h2').textContent;
  assert.equal(title((await shelf({ art: 'portrait' })).node), 'Pick a character');
  assert.equal(title((await shelf({ art: 'portrait', title: 'Pick a face' })).node), 'Pick a face');
  assert.equal(title((await shelf()).node), 'Add from the studio');
});

// The guide's strip has no labels and no cap, so order is all it has.
test('the guide\'s strip puts what people here made first', async () => {
  answers['/api/collection'] = OURS;
  dropArtIndex();
  const strip = artShelf('portrait', async () => {});
  await settle();
  assert.deepEqual(withClass(strip, 'art').map((b) => b.children[0].attrs.alt), ['Dad as a dragon', 'Mila, happy']);
});

test('the filter reaches both halves, and a label with nothing under it goes', async () => {
  const { grid, filter } = await shelf();
  filter.value = 'dragon';
  filter.handlers.get('input')();
  assert.deepEqual(rows(grid), ['[Made here]', 'Dad as a dragon']);
  filter.value = 'forest';
  filter.handlers.get('input')();
  assert.deepEqual(rows(grid), ['A forest']);
});
