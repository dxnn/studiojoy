// Nothing scrolls the body sideways at 390px.
//
// A phone in portrait is 390 CSS pixels and narrow.css's media queries are
// written against it. The rule is only about the *document*: the studio has
// several deliberate sideways scrollers inside it — the chat pills, the
// helper chips, a wide table, a diff — and each of those scrolls in its own
// box on purpose (spec/ §17). What must never happen is the page itself
// moving under a thumb, because then every surface is 400px wide and the
// right-hand edge of everything is off the screen.
//
// One assertion, every surface, and it needs a browser: layout at a width is
// the one thing a DOM stand-in has no opinion about at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../helpers.js';
import { openStudio, pageFor } from './browser.js';

// Every mode the centre can show, by id (public/game-types.js). The labels
// are Speak/See/Hear/Touch/Taste/Recall/Smell and on trial; the ids are the
// code's and hold still, which is why a test uses them.
const EVERY_GAME = ['chat', 'pics', 'hear', 'controls', 'code', 'versions', 'share'];

// What each template adds in front of those.
const TYPED = {
  'visual-novel': ['story'], quiz: ['quiz'], arcade: [], adventure: ['adventure'], racing: ['track'],
  knockdown: ['world'], rollball: ['level'],
};

// The document's own width against the viewport's, and — only if it has
// overflowed — what is sticking out, because otherwise a failure is a riddle.
const sidewaysScroll = (page) => page.evaluate(() => {
  const root = document.documentElement;
  const over = root.scrollWidth - root.clientWidth;
  if (over <= 0) return { over: 0, wide: [] };
  const edge = root.clientWidth;
  const wide = [...document.querySelectorAll('body *')]
    .filter((el) => el.getBoundingClientRect().right > edge + 1)
    .map((el) => `${el.tagName.toLowerCase()}`
      + `${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`
      + ` (to ${Math.round(el.getBoundingClientRect().right)}px)`);
  return { over, wide: [...new Set(wide)].slice(0, 6) };
});

async function studio(t, template) {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  await app.client.json('POST', '/api/projects', {
    body: { name: 'Tank', slug: 'tank', ...(template ? { template } : {}) },
  });
  // ⚠️ A touch context, not merely a narrow one. A phone is both, and the
  // coarse-pointer rule raises every field to 16px — bigger text is what
  // overflows, so a sweep at 390px with a fine pointer would measure a page
  // narrower than the one anybody has.
  const page = await pageFor(browser, app, app.client, { touch: true });
  return { app, page };
}

// A surface at a time rather than all of them in one test: which one moved is
// the whole of the information.
async function sweep(t, template, modes) {
  const { app, page } = await studio(t, template);
  for (const mode of modes) {
    const url = mode === 'chat' ? `${app.base}/p/tank` : `${app.base}/p/tank?mode=${mode}`;
    await page.goto(url);
    // The centre has painted. Without this a mode that is slow to render is
    // measured empty, which passes and means nothing.
    await page.locator('.modes .mode').first().waitFor();
    const { over, wide } = await sidewaysScroll(page);
    assert.equal(over, 0, `${mode} scrolls the page ${over}px sideways: ${wide.join(', ')}`);
  }
}

test('no mode of a game scrolls the page sideways at 390px', async (t) => {
  await sweep(t, null, EVERY_GAME);
});

for (const [template, extra] of Object.entries(TYPED)) {
  test(`no mode of the ${template} template scrolls the page sideways at 390px`, async (t) => {
    await sweep(t, template, [...extra, ...EVERY_GAME]);
  });
}

// The one surface reachable with no account, and the first thing a phone
// sees. Its own test because it needs the cookie thrown away.
test('the sign-in page does not scroll sideways at 390px', async (t) => {
  const { app, page } = await studio(t, null);
  await page.context().clearCookies();
  await page.goto(`${app.base}/`);
  await page.locator('input[type="password"]').waitFor();
  const { over, wide } = await sidewaysScroll(page);
  assert.equal(over, 0, `the sign-in page scrolls ${over}px sideways: ${wide.join(', ')}`);
});
