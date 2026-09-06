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

// ⚠️ The room with something waiting in it must not be the room the studio
// opens on. `/p/tank` opens the first chat — `Humans only` — and opening a
// chat reads it, so a message seeded there is cleared by the page load and
// the mark correctly never appears. It cost a run to learn: seed the second
// room, which is also what actually happens to somebody.
async function somethingWaiting(t) {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const room = await app.client.json('POST', '/api/projects/tank/chats', {
    body: { name: 'Sound effects' },
  });
  const theirs = app.newClient();
  await signIn(app, {
    email: 'kid@example.com', password: 'hunter2', displayName: 'Robin Fox', client: theirs,
  });
  await theirs.json('POST', '/api/projects/tank/messages', {
    body: { body: 'listen to this', chat_id: room.body.id },
  });
  return { app, browser };
}

// The pill for one room, by the words on it.
const pill = (page, name) => page.locator('.chat-tab', { hasText: name });

// The studio open on Dann's game, with the pills painted. Waiting for the row
// first means "the app never rendered" fails differently from "the mark is
// not there", which is the difference between a broken studio and a bug.
async function open(app, browser, width) {
  const page = await pageFor(browser, app, app.client, { width });
  await page.goto(`${app.base}/p/tank`);
  await pill(page, 'Humans only').waitFor();
  return page;
}

for (const width of [PHONE, LAPTOP]) {
  test(`the unread dot has a size at ${width}px`, async (t) => {
    const { app, browser } = await somethingWaiting(t);
    const page = await open(app, browser, width);

    const dot = pill(page, 'Sound effects').locator('.unread');
    const box = await dot.boundingBox();
    assert.ok(box, 'the dot is on the pill at all');
    // ⚠️ The assertion the whole file is for. 0 is what shipped.
    assert.ok(
      box.width >= 6 && box.height >= 6,
      `the dot has a size (got ${box.width}×${box.height})`,
    );
  });
}

test('a room with something waiting reads brighter than a quiet one', async (t) => {
  const { app, browser } = await somethingWaiting(t);
  const page = await open(app, browser, LAPTOP);

  // Three rooms: Humans only is open, Sound effects has something waiting,
  // Building has nothing — one of each, which is the whole comparison.
  const waiting = pill(page, 'Sound effects');
  assert.equal(
    await waiting.evaluate((n) => n.classList.contains('marked')), true,
    'the room with something in it is marked',
  );
  const quiet = pill(page, 'Building');
  assert.equal(
    await quiet.evaluate((n) => n.classList.contains('marked')), false,
    'the room with nothing in it is not',
  );
  assert.notEqual(
    await colourOf(waiting), await colourOf(quiet),
    'and it does not read as muted',
  );
});
