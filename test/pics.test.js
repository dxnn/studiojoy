// Pics, over the DOM stand-in: the studio's own conventions on a second
// surface (spec.md §17), and the two things that changed about the pane —
// a picture opens on one click, and the studio's dressing is offered to a
// game wearing none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  install, all, withClass, pressable, hasClass, conventionBreaks, goldIn, press,
} from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
install();

// ⚠️ A picture card fetches its own thumbnail — the one render in the studio
// that reaches the network on purpose. Answered with a 404 rather than left
// to reject: a rejection lands after the test as a dropped connection and a
// render nobody asked for.
const asked = [];
globalThis.fetch = async (url) => {
  asked.push(String(url));
  return {
    ok: false, status: 404, headers: new Headers(), blob: async () => new Blob(), text: async () => '',
  };
};

const { S } = await import('../public/main.js');
const { renderPicsMode, renderHearMode } = await import('../public/pics-hear.js');
const { renderOpenFile } = await import('../public/files-tab.js');
const { dialogFor } = await import('../public/dialogs.js');
const { RESERVED_IMAGES, DRESSING, HERO_IMAGE } = await import('../public/files.js');

const picture = (path, size = 900) => ({
  path, mime: 'image/png', size, text: false,
});

// A game open on Pics with these files in it, and nothing open.
function pics(files, { canEdit = true } = {}) {
  S.project = {
    slug: 'tank', can_edit: canEdit, archived: false, type: null, agents: [],
  };
  S.slug = 'tank';
  S.mode = 'pics';
  S.files = files;
  S.open = null;
  S.pick = null;
  S.story = null;
  return renderPicsMode();
}

const labels = (tree) => withClass(tree, 'section-label').map((n) => n.textContent);
const texts = (tree) => all(tree).map((n) => n.textContent).filter(Boolean);

test('what lights up is what can be clicked', () => {
  const tree = pics([picture('assets/images/tree.png'), picture('hero.png')]);
  const cards = withClass(tree, 'card');
  assert.ok(cards.length > 0, 'there are cards');
  for (const card of cards) assert.ok(pressable(card), 'a card that lights up is pressable');
});

test('a picture opens on one click, with nothing selected on the way', async () => {
  const tree = pics([picture('assets/images/tree.png')]);
  const card = withClass(tree, 'card')[0];
  asked.length = 0;
  // The card guards against a click that landed on its ···, so the event has
  // to answer closest().
  await card.handlers.get('click')({ target: { closest: () => null } });
  assert.equal(S.pick, null, 'nothing is selected into the rail on the way');
  assert.ok(
    asked.some((url) => url.includes('tree.png')),
    'the file itself is asked for — one click, not two',
  );
});

test('studio dressing is offered to a game wearing none', () => {
  const tree = pics([picture('assets/images/tree.png')]);
  assert.ok(labels(tree).includes('Studio dressing'), 'the section is there with nothing in it');
  const add = all(tree).find((n) => n.textContent === 'Add dressing');
  assert.ok(add && pressable(add), 'and a way in');
});

test('nothing is offered where it could not be taken up', () => {
  // An archived game, or somebody else's: an empty section here would be an
  // offer with no button under it.
  const tree = pics([picture('assets/images/tree.png')], { canEdit: false });
  assert.equal(labels(tree).includes('Studio dressing'), false);
  const worn = pics([picture('hero.png')], { canEdit: false });
  assert.ok(labels(worn).includes('Studio dressing'), 'dressing already worn still shows');
  assert.equal(all(worn).some((n) => n.textContent === 'Add dressing'), false);
});

test('the dressing a game already wears says what it dresses', () => {
  const tree = pics([picture(HERO_IMAGE)]);
  assert.ok(texts(tree).includes(DRESSING[HERO_IMAGE].what));
});

test('the dressing dialog names all three and says what each is for', () => {
  S.files = [];
  const dialog = dialogFor({ kind: 'add-dressing' });
  const choices = withClass(dialog, 'choice');
  assert.equal(choices.length, RESERVED_IMAGES.length);
  for (const choice of choices) assert.ok(pressable(choice));
  const names = withClass(dialog, 'cname').map((n) => n.textContent);
  const said = withClass(dialog, 'cwhat').map((n) => n.textContent);
  for (const path of RESERVED_IMAGES) {
    assert.ok(names.includes(DRESSING[path].name), `${path} is named`);
    assert.ok(said.some((s) => s.includes(DRESSING[path].hint)), `${path} says what it is for`);
  }
});

test('a dialog’s box is a named scroller, so a background render does not send it to the top', () => {
  // main.js keeps the dialog node and re-appends it on every render, and
  // leaving the document is enough to lose where it was scrolled to — the
  // scroll snapshot puts back what has a name (spec.md §17).
  const dialog = dialogFor({ kind: 'add-dressing' });
  const box = withClass(dialog, 'dialog')[0];
  assert.ok(box, 'the box is there');
  assert.equal(box.attrs['data-scroll'], 'dialog');
});

test('a dressing already there says so before it is replaced', () => {
  S.files = [picture(HERO_IMAGE)];
  const dialog = dialogFor({ kind: 'add-dressing' });
  const said = withClass(dialog, 'cwhat').map((n) => n.textContent);
  assert.equal(said.filter((s) => s.includes('replaces it')).length, 1);
});

test('a dressing is drawn here, brought from the device, or picked off the shelf', () => {
  const dialog = dialogFor({ kind: 'dressing', path: HERO_IMAGE });
  const choices = withClass(dialog, 'choice');
  assert.equal(choices.length, 3);
  for (const choice of choices) assert.ok(pressable(choice));
  // The name is the whole reason the dialog exists: nothing else in the studio
  // would ever tell you that a file called hero.png is the one that shows.
  assert.ok(texts(dialog).some((t) => t.includes(HERO_IMAGE)));
  // The shelf, by the words Pics' own button uses, and every kind on it: a
  // tile, a banner and a little square are three shelves to nobody. What sets
  // it apart is where a pick lands — under the reserved name, not its own.
  const shelf = choices.find((c) => withClass(c, 'cname')[0].textContent === '+ Add from the studio');
  assert.ok(shelf, 'the shelf is offered');
  shelf.click();
  assert.equal(S.dialog.kind, 'pick-picture');
  assert.equal(S.dialog.art, null, 'no kind named');
  assert.equal(typeof S.dialog.place, 'function', 'the dressing names where the pick lands');
  S.dialog = null;
});

// The open picture's own bar says what it is and where; a picture the studio
// wears says, under it, what it dresses (spec/ §6: no rail).
test('an open dressing says what it dresses, under its bar', () => {
  pics([picture(HERO_IMAGE, 2048)]);
  S.open = { path: HERO_IMAGE, mime: 'image/png', content: null };
  S.draw = null;
  const said = texts(renderOpenFile()).join(' ');
  assert.ok(said.includes(HERO_IMAGE));
  assert.ok(said.includes(DRESSING[HERO_IMAGE].what));
  S.open = null;
});

// In place: a character's fields under the cards, and the same card closes
// them again — one open at a time, nothing a pane away.
test('a character opens under the cards, and the same card closes them', () => {
  pics([]);
  S.project.type = 'visual-novel';
  S.story = { model: { cast: [{ key: 'ada', name: 'Ada', moods: ['happy'] }], scenes: [] } };
  const card = () => withClass(renderPicsMode(), 'face')[0];
  press(card());
  assert.deepEqual(S.pick, { kind: 'person', key: 'ada' });
  const open = withClass(renderPicsMode(), 'in-place');
  assert.equal(open.length, 1);
  assert.ok(texts(open[0]).includes('Character'));
  press(card());
  assert.equal(S.pick, null);
  assert.equal(withClass(renderPicsMode(), 'in-place').length, 0);
  S.story = null;
});

test('a sound opens under its own row', () => {
  pics([]);
  S.mode = 'hear';
  const sound = { path: 'assets/sounds/jump.wav', mime: 'audio/wav', size: 400 };
  S.files = [sound, { path: 'assets/sounds/coin.wav', mime: 'audio/wav', size: 300 }];
  S.open = { ...sound, content: null };
  S.sound = null;
  const kids = withClass(renderHearMode(), 'hear')[0].children.filter(Boolean);
  const at = kids.findIndex((n) => hasClass(n, 'hear-row') && hasClass(n, 'on'));
  assert.ok(at >= 0, 'the open row is lit');
  assert.ok(hasClass(kids[at + 1], 'in-place'), 'and what it opened is the next thing under it');
  S.open = null;
  S.mode = 'pics';
});

test('gold is a number and nothing else', () => {
  // Which rules wear gold is the stylesheet's say (dom-stand-in.js), and
  // nothing in Pics is a number.
  const tree = pics([picture('assets/images/tree.png'), picture(HERO_IMAGE)]);
  assert.deepEqual(goldIn(tree), []);
});

test('Pics keeps the conventions every surface keeps', () => {
  const files = [picture('assets/images/tree.png'), picture('assets/sprites/ship.png'), picture(HERO_IMAGE)];
  assert.deepEqual(conventionBreaks(pics(files)), []);
  assert.deepEqual(conventionBreaks(pics(files, { canEdit: false })), []);
});

test('a picture card opens by handing back its promise', async () => {
  const [card] = withClass(pics([picture('assets/images/tree.png')]), 'card');
  const out = press(card);
  assert.equal(typeof out?.then, 'function', 'returned, not fired');
  await out;
});
