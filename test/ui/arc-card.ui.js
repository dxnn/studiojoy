// The arc at the top of Building (spec/ §6, ideas/doneness.md): a row of
// dots, the next stamp, its checks, and one button a kid presses on a phone.
// Geometry and a real pointer are what this needs a browser for — the ratchet
// itself is test/api-projects.test.js and the arcs test/arc.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import { openStudio, pageFor, PHONE } from './browser.js';
import { arcFor } from '../../public/arc.js';

// ⚠️ Held by id, never by the words on the card. A stamp's name, its principle
// and its asks are somebody's to reword on any afternoon, and a check that
// fails when they do is a check that stops the rewording. What is asserted is
// which stamp the card is on (`data-stamp`), that the studio numbers it, and
// that an ask lands in the composer exactly as public/arc.js writes it.
const BLANK = arcFor(null);
const stampAt = (i) => BLANK[i];

test('the arc shows in Building, folds on its head, and a press earns a stamp', async (t) => {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  const made = await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  const page = await pageFor(browser, app, app.client, { width: PHONE, touch: true });
  await page.goto(`${app.base}/p/tank?chat=${made.body.chat.id}`);
  await page.locator('.arc').waitFor();

  // A blank game: a dot per stamp, none earned, the first one up next — and
  // the step number written by the card, since no name carries one.
  const next = page.locator('.arc-next');
  assert.equal(await page.locator('.arc-dot').count(), BLANK.length);
  assert.equal(await page.locator('.arc-dot.earned').count(), 0);
  assert.equal(await next.getAttribute('data-stamp'), stampAt(0).id);
  assert.equal(await next.textContent(), `Step 1: ${stampAt(0).name}`);

  // The button is a thumb's size.
  const earn = page.getByRole('button', { name: /This one’s done/ });
  const box = await earn.boundingBox();
  assert.ok(box.height >= 32, `the earn button is ${box.height}px tall`);
  await earn.click();
  await page.locator('.arc-dot.earned').first().waitFor();
  assert.equal(await page.locator('.arc-dot.earned').count(), 1);
  assert.equal(await next.getAttribute('data-stamp'), stampAt(1).id);
  assert.equal(await next.textContent(), `Step 2: ${stampAt(1).name}`);
  assert.equal(app.db.prepare("SELECT stage FROM projects WHERE slug = 'tank'").get().stage, 1);

  // An ask lands in the composer, unsent and word for word.
  const [ask] = stampAt(1).asks;
  await page.getByRole('button', { name: ask.label }).click();
  assert.equal(await page.locator('textarea').inputValue(), ask.text);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE user_id IS NOT NULL').get().n, 0);

  // The head folds the card to its row and back.
  await page.locator('.arc-head').click();
  assert.equal(await page.locator('.arc-body').count(), 0);
  await page.locator('.arc-head').click();
  assert.equal(await page.locator('.arc-body').count(), 1);
});

test('a game with every stamp earned has no card at all', async (t) => {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  const made = await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  // The ratchet moves one stamp at a time.
  for (let stage = 1; stage <= BLANK.length; stage += 1) {
    await app.client.json('POST', '/api/projects/tank/stage', { body: { stage } });
  }
  const page = await pageFor(browser, app, app.client, { width: PHONE, touch: true });
  await page.goto(`${app.base}/p/tank?chat=${made.body.chat.id}`);
  await page.locator('textarea').waitFor();
  assert.equal(await page.locator('.arc').count(), 0);
});
