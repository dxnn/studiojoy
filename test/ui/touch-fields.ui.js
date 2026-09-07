// No field's text is under 16px on a touchscreen (spec/ §17).
//
// The rule exists because iOS Safari zooms the page in when it focuses a
// field smaller than that, and leaves it zoomed until somebody pinches back
// out — the studio's fields were 12 to 15px, so tapping the composer left the
// studio about 7% wider than the phone, on every message. One `!important`
// rule in `base.css` under `@media (pointer: coarse)`.
//
// Nothing could check it before this file. The rule is a computed font size
// under a media query, so a DOM stand-in cannot see it and a narrow viewport
// does not trigger it: it needs a browser reporting a coarse pointer, which
// is asserted first (see assertCoarse — a check that runs without the query
// passes while testing nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import { openStudio, pageFor, assertCoarse } from './browser.js';

// The smallest a field may be. Not a constant shared with the stylesheet on
// purpose: this is the number iOS Safari cares about, and if somebody lowers
// the rule the test should fail rather than follow it.
const FLOOR = 16;

// Every field a finger can land in, with what it measures. Anything a person
// cannot type into is left out — a checkbox has no text to zoom towards.
const measureFields = (page) => page.evaluate(() => {
  const skip = ['hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button'];
  return [...document.querySelectorAll('input, textarea, select')]
    .filter((el) => !skip.includes(el.type))
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => ({
      what: `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''}`
        + `${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`,
      size: parseFloat(getComputedStyle(el).fontSize),
    }));
});

const under = (fields) => fields.filter((f) => f.size < FLOOR);

async function game(t) {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  return { app, browser };
}

// The first thing anybody touches, and the one surface reachable with no
// account at all — so it is checked without one.
test('no field on the sign-in form is under 16px on a touchscreen', async (t) => {
  const { app, browser } = await game(t);
  const page = await pageFor(browser, app, app.client, { touch: true });
  await page.context().clearCookies();
  await page.goto(`${app.base}/`);
  await page.locator('input[type="password"]').waitFor();
  await assertCoarse(page);

  const fields = await measureFields(page);
  assert.ok(fields.length >= 2, `the form has its fields (found ${fields.length})`);
  assert.deepEqual(under(fields), [], `every field is at least ${FLOOR}px`);
});

test('no field in a game is under 16px on a touchscreen', async (t) => {
  const { app, browser } = await game(t);
  const page = await pageFor(browser, app, app.client, { touch: true });
  await page.goto(`${app.base}/p/tank`);
  await page.locator('.chat-tab').first().waitFor();
  await assertCoarse(page);

  const fields = await measureFields(page);
  assert.ok(fields.length >= 1, 'the composer is a field on this surface');
  assert.deepEqual(under(fields), [], `every field is at least ${FLOOR}px`);
});

// ⚠️ The trap spec/ §17 names by hand: the code editor is a transparent-ink
// textarea over a <pre> twin holding the colours, so the two must wear the
// same type. Raise the field for the touchscreen and leave the <pre> and the
// colours shear off the text.
test('the code editor and its <pre> twin are raised together', async (t) => {
  const { app, browser } = await game(t);
  const page = await pageFor(browser, app, app.client, { touch: true });
  // The URL is the view (spec/ §17), so the file opens without driving the
  // mode row — which is a row of labels this test has no business knowing.
  await page.goto(`${app.base}/p/tank?mode=code&file=BRIEF.md`);
  const area = page.locator('.editor .code textarea');
  await area.waitFor();
  await assertCoarse(page);

  const sizeOf = (l) => l.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  const field = await sizeOf(area);
  const twin = await sizeOf(page.locator('.editor .code-hl'));
  assert.ok(field >= FLOOR, `the field is at least ${FLOOR}px (got ${field})`);
  assert.equal(twin, field, 'the <pre> twin wears the same type as the field');
});
