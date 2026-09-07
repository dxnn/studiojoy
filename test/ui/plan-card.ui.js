// A draft plan card is something a kid types into on a phone (spec/ §8,
// ideas/planner.md): the summary, the assumptions and each piece are fields,
// Build it is one button, and a change made in a field is the plan's the
// moment the field is left. Geometry and a real pointer are what this needs a
// browser for — the server half is test/builder.test.js.
//
// The plan is seeded straight into the database: no LLM runs here, and a
// draft is a row that waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import { openStudio, pageFor, PHONE } from './browser.js';

async function draftWaiting(t) {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  const made = await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const chatId = made.body.chat.id;
  const builder = app.db.prepare('SELECT id FROM agents WHERE builtin = 1').get().id;
  const now = new Date().toISOString();
  const info = app.db.prepare(
    `INSERT INTO messages (project_id, chat_id, agent_id, kind, body, created_at)
     VALUES (?, ?, ?, 'plan', ?, ?)`,
  ).run(made.body.id, chatId, builder, "That's a big one — here's my plan in 2 pieces. Change anything, then press Build it.", now);
  const cardId = Number(info.lastInsertRowid);
  app.db.prepare(
    `INSERT INTO plans (message_id, project_id, chat_id, request, pieces, status, created_at, updated_at,
                        summary, assumptions, begun)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 0)`,
  ).run(
    cardId, made.body.id, chatId, 'build me a tank game',
    JSON.stringify([
      { title: 'The page', files: ['index.html'], what: 'The page and its styles.', status: 'todo', message_id: null, note: null },
      { title: 'Tanks that drive', files: ['js/tank.js'], what: 'Two tanks and the loop.', status: 'todo', message_id: null, note: null },
    ]),
    now, now, 'A tank game for two.', JSON.stringify(['Arrow keys and WASD.']),
  );
  const page = await pageFor(browser, app, app.client, { width: PHONE, touch: true });
  await page.goto(`${app.base}/p/tank?chat=${chatId}`);
  await page.locator('.pieces.draft').waitFor();
  return { app, page, cardId };
}

test('a draft card is fields and one button, all big enough for a thumb', async (t) => {
  const { page } = await draftWaiting(t);
  const fields = page.locator('.pieces.draft .plan-field');
  // The summary, the assumptions, and a title and a what per piece.
  assert.equal(await fields.count(), 6);
  for (let i = 0; i < 6; i += 1) {
    const size = await fields.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size >= 16, `field ${i} is ${size}px on a touchscreen`);
  }
  const build = page.locator('.pieces.draft button.filled', { hasText: 'Build it' });
  const box = await build.boundingBox();
  assert.ok(box && box.height >= 32 && box.width >= 80, `Build it is a button (${box?.width}×${box?.height})`);
  // Nothing sticks out of a 390px page.
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(over, 0, 'the card fits the phone');
});

test('a title typed into a draft is the plan\'s once the field is left', async (t) => {
  const { app, page, cardId } = await draftWaiting(t);
  const title = page.locator('.piece.editing input').first();
  await title.fill('Walls that break');
  await title.press('Tab');
  // The PATCH lands and the card follows plan.update; read the row.
  const deadline = Date.now() + 3000;
  let pieces = [];
  while (Date.now() < deadline) {
    pieces = JSON.parse(app.db.prepare('SELECT pieces FROM plans WHERE message_id = ?').get(cardId).pieces);
    if (pieces[0].title === 'Walls that break') break;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  assert.equal(pieces[0].title, 'Walls that break');
  assert.equal(pieces[1].title, 'Tanks that drive', 'the other piece is untouched');
  assert.equal(app.db.prepare('SELECT edited FROM plans WHERE message_id = ?').get(cardId).edited, 1);
  await page.locator('.piece.editing input').first().waitFor();
  assert.equal(await page.locator('.piece.editing input').first().inputValue(), 'Walls that break');
});
