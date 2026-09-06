// The unread mark, in a real browser.
//
// This file exists because of one bug. `.unread` is a span with no words in
// it, sized 7×7, and width and height do not apply to a non-replaced inline
// box — so on a chat pill it measured 0×15, painted nothing, and shipped that
// way for three days. Every test the studio had passed: the node was in the
// tree, the class was on it, the rule was in the stylesheet. Only a browser
// can be asked whether it has a size (spec/ §17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import {
  openStudio, pageFor, colourOf, PHONE, LAPTOP,
} from './browser.js';

// Dann's game with something waiting in it: Robin has said one thing in
// Humans only, which Dann has not read. Seeded over the API, so this test
// knows nothing about the database that the studio does not.
async function somethingWaiting(t) {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const theirs = app.newClient();
  await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin Fox', client: theirs,
  });
  await theirs.json('POST', '/api/projects/tank/messages', { body: { body: 'have a look' } });
  return { app, browser };
}

// The pill for one room, by the words on it.
const pill = (page, name) => page.locator('.chat-tab', { hasText: name });

for (const width of [PHONE, LAPTOP]) {
  test(`the unread dot has a size at ${width}px`, async (t) => {
    const { app, browser } = await somethingWaiting(t);
    const page = await pageFor(browser, app, app.client, { width });
    await page.goto(`${app.base}/p/tank`);

    const dot = pill(page, 'Humans only').locator('.unread');
    const box = await dot.boundingBox();
    assert.ok(box, 'the dot is on the pill at all');
    // ⚠️ The assertion the whole file is for. 0 is what shipped.
    assert.ok(box.width >= 6 && box.height >= 6, `the dot has a size (got ${box.width}×${box.height})`);
  });
}

test('a room with something waiting reads brighter than a quiet one', async (t) => {
  const { app, browser } = await somethingWaiting(t);
  const page = await pageFor(browser, app, app.client);
  await page.goto(`${app.base}/p/tank`);

  // Building is open, so it is neither quiet nor marked: the comparison is
  // Humans only, which has something waiting, against a pill that does not.
  const waiting = pill(page, 'Humans only');
  await waiting.waitFor();
  assert.equal(await waiting.evaluate((n) => n.classList.contains('marked')), true);

  const quiet = page.locator('.chat-tab:not(.marked):not(.on)').first();
  assert.notEqual(
    await colourOf(waiting), await colourOf(quiet),
    'a room with something in it does not read as muted',
  );
});
