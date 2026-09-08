// The arc at the top of Building (spec/ §6, ideas/doneness.md): a row of
// dots, the next stamp, its checks, and one button a kid presses on a phone.
// Geometry and a real pointer are what this needs a browser for — the ratchet
// itself is test/api-projects.test.js and the arcs test/arc.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import { openStudio, pageFor, PHONE } from './browser.js';

test('the arc shows in Building, folds on its head, and a press earns a stamp', async (t) => {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  const made = await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const page = await pageFor(browser, app, app.client, { width: PHONE, touch: true });
  await page.goto(`${app.base}/p/tank?chat=${made.body.chat.id}`);
  await page.locator('.arc').waitFor();

  // A blank game: eight dots, none earned, "What is it?" up next.
  assert.equal(await page.locator('.arc-dot').count(), 8);
  assert.equal(await page.locator('.arc-dot.earned').count(), 0);
  assert.equal(await page.locator('.arc-next').textContent(), 'What is it?');

  // The button is a thumb's size.
  const earn = page.getByRole('button', { name: /This one’s earned/ });
  const box = await earn.boundingBox();
  assert.ok(box.height >= 32, `the earn button is ${box.height}px tall`);
  await earn.click();
  await page.locator('.arc-dot.earned').first().waitFor();
  assert.equal(await page.locator('.arc-dot.earned').count(), 1);
  assert.equal(await page.locator('.arc-next').textContent(), 'It moves');
  assert.equal(app.db.prepare("SELECT stage FROM projects WHERE slug = 'tank'").get().stage, 1);

  // An ask lands in the composer, unsent.
  await page.getByRole('button', { name: 'Make it move' }).click();
  assert.match(await page.locator('textarea').inputValue(), /Make the thing I steer move/);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE user_id IS NOT NULL').get().n, 0);

  // The head folds the card to its row and back.
  await page.locator('.arc-head').click();
  assert.equal(await page.locator('.arc-body').count(), 0);
  await page.locator('.arc-head').click();
  assert.equal(await page.locator('.arc-body').count(), 1);
});
