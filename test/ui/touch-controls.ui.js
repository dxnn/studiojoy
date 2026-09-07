// A thumb slides between neighbouring buttons without lifting.
//
// That sentence is in the input library's own API note and in every game's
// `config/controls.js`, and nothing has ever checked it: it needs a coarse
// pointer (the buttons are not drawn at all without one), real coordinates,
// and a pointer that goes down on one button and arrives at another while
// still down. A DOM stand-in has none of those.
//
// The library rather than a game: `studio/input.js` is what draws the buttons
// and decides what is held, every game gets the same copy from the sweep, and
// a game on top would only be a second thing to go wrong. The drawn controls
// are DOM buttons — position:fixed, `aria-label` the touch name — not canvas
// painting, which is why a real pointer can be aimed at one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import { openStudio, pageFor, assertCoarse } from './browser.js';

// The buttons shape, as a game would declare it: two directions under one
// thumb, a named button under the other. `left` and `right` are neighbours,
// which is the pair the slide is about.
const CONTROLS = {
  player1: {
    left: 'key:left touch:left',
    right: 'key:right touch:right',
    thrust: 'key:up touch:THRUST',
  },
};

// A page on the studio's origin with the library loaded over a game's config,
// the way `index.html` loads them: config first, then the library, both as
// classic scripts. Nothing of the studio's own is left on the page.
async function controlsPage(t) {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  const page = await pageFor(browser, app, app.client, { touch: true });
  await page.goto(`${app.base}/`);
  await assertCoarse(page);

  await page.evaluate(async (controls) => {
    document.body.replaceChildren();
    window.CONTROLS = controls;
    window.SCHEME = 'buttons';
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/studio-lib/input/input.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('studio/input.js did not load'));
      document.head.append(s);
    });
  }, CONTROLS);

  // Drawn only under a coarse pointer, and only once the library has run.
  await page.locator('button[aria-label="left"]').waitFor();
  return page;
}

// What the game would ask, after the update() the API note insists on.
const held = (page, verb) => page.evaluate(
  (v) => { Input.update(); return Input.held(v); },
  verb,
);

const centreOf = async (page, name) => {
  const box = await page.locator(`button[aria-label="${name}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('the drawn buttons are there under a coarse pointer', async (t) => {
  const page = await controlsPage(t);
  for (const name of ['left', 'right', 'THRUST']) {
    const box = await page.locator(`button[aria-label="${name}"]`).boundingBox();
    assert.ok(box, `${name} is drawn`);
    // ⚠️ A control a thumb cannot hit is not a control. The library's halo is
    // deliberately bigger than the circle somebody sees, and this is the
    // number that matters on a phone rather than the visible radius.
    assert.ok(box.width >= 44 && box.height >= 44, `${name} is ${box.width}×${box.height}`);
  }
});

test('a press holds the verb the button is bound to', async (t) => {
  const page = await controlsPage(t);
  const left = await centreOf(page, 'left');

  assert.equal(await held(page, 'left'), false, 'nothing held before the press');
  await page.mouse.move(left.x, left.y);
  await page.mouse.down();
  assert.equal(await held(page, 'left'), true, 'held while down');
  await page.mouse.up();
  assert.equal(await held(page, 'left'), false, 'let go when lifted');
});

// ⚠️ The behaviour this file exists for. A thumb that must lift between two
// buttons cannot steer, and the library goes to some trouble to track a
// pointer from one to the next — `fingers` keyed by pointerId, reassigned on
// every pointermove.
test('a thumb slides from one button to its neighbour without lifting', async (t) => {
  const page = await controlsPage(t);
  const left = await centreOf(page, 'left');
  const right = await centreOf(page, 'right');

  await page.mouse.move(left.x, left.y);
  await page.mouse.down();
  assert.equal(await held(page, 'left'), true, 'the thumb starts on left');

  // In steps, because a slide is a run of pointermove events and a single
  // jump is not what a thumb does.
  await page.mouse.move(right.x, right.y, { steps: 12 });
  assert.equal(await held(page, 'right'), true, 'and arrives holding right');
  assert.equal(await held(page, 'left'), false, 'having let go of left on the way');

  await page.mouse.up();
  assert.equal(await held(page, 'right'), false, 'and lets go when lifted');
});
