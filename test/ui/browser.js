// The browser half of a ui check: a real studio on an ephemeral port, served
// with the real `public/`, and a page already carrying somebody's session.
//
// These live outside `npm test` and always will. Playwright is this studio's
// only dependency and it downloads a browser; a suite that cannot be run on a
// fresh clone in ten seconds with nothing installed is worth less than the
// coverage. `npm test` stays the one that proves the studio.
//
// ⚠️ A coding agent cannot run these. Chrome's Mach port bootstrap is denied
// inside the agent sandbox — `bootstrap_check_in ... Permission denied
// (1100)`, with Playwright, with a hand-rolled CDP driver, and with
// `--no-sandbox`, so it is the sandbox rather than the driver. `npm run ui`
// is run by a person or by CI. Write them here, run them there.
import { chromium } from 'playwright';
import path from 'node:path';
import { setup } from '../helpers.js';

// The studio's own public directory, not the empty stub setup() makes for the
// API tests: the browser is here to load the actual client.
const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', '..', 'public');

// The two widths worth checking, and the only two. 390 is a phone in portrait
// — narrow.css's media queries are written against it — and 1280 is a laptop.
export const PHONE = 390;
export const LAPTOP = 1280;

// A browser that will not start is the one failure here that is not a bug in
// the studio, so it says what to do rather than passing Playwright's message
// through. The sandbox case is named on sight: it is the one somebody meets
// by running this from the wrong place, and the message is the whole fix.
const DENIED = /MachPortRendezvous|bootstrap_check_in|Permission denied \(1100\)/;

// A browser that would not start will not start for the next test either, and
// Playwright's cause carries a forty-line launch log. Kept, so the run says it
// once and then repeats the sentence rather than the log.
let refused = null;

async function launch() {
  if (refused) throw refused;
  try {
    return await chromium.launch({ headless: true });
  } catch (cause) {
    const first = DENIED.test(String(cause.message))
      ? new Error(
        'Chrome cannot start in this sandbox. `npm run ui` has to be run from a\n'
        + 'real terminal — not through a coding agent, and not with `!` inside one,\n'
        + 'which is the same sandbox. Everything else in the suite runs anywhere.',
        { cause },
      )
      : new Error(
        'Could not start Chromium. If it is not installed:\n'
        + '  npx playwright install chromium',
        { cause },
      );
    // The first failure carries Playwright's log; the repeats carry the
    // sentence and nothing else.
    refused = new Error(first.message);
    throw first;
  }
}

// A studio and a browser, both closed when the test ends. The fixture is the
// same one every API test uses, so seeding is the API rather than a second
// set of fixtures that can drift from it; `opts` are its — an `llm` for a
// check that needs a helper to answer.
export async function openStudio(t, opts = {}) {
  const app = await setup({ publicDir: PUBLIC_DIR, ...opts });
  // ⚠️ Registered before the browser is launched, never after. A launch that
  // throws used to leave the studio's own listener open, and a listening
  // server keeps node alive: the run hung instead of finishing, so the
  // reporter never flushed and the failure that caused it never printed. A
  // cleanup registered after the thing that can fail is not cleanup.
  let browser = null;
  t.after(async () => {
    if (browser) await browser.close();
    await app.close();
  });
  browser = await launch();
  return { app, browser };
}

// One person's page. Their session cookie comes out of the test client's own
// jar, so two clients are two browser contexts the same way they are two
// people — and nothing here reimplements signing in.
// `touch` is a different browser rather than a narrower one: base.css's 16px
// rule is behind `@media (pointer: coarse)`, which a merely narrow viewport
// does not match. hasTouch and isMobile are what make Chromium report a
// coarse pointer; the width is pinned to PHONE because narrow.css's queries
// are written against it, rather than left at a device profile's own.
const contextFor = (width, touch) => (touch
  ? { viewport: { width: PHONE, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
  : { viewport: { width, height: 820 } });

export async function pageFor(browser, app, client, { width = LAPTOP, touch = false } = {}) {
  const cookie = client.peek();
  if (!cookie) throw new Error('that client is not signed in');
  const pair = cookie.split(';')[0].trim();
  const eq = pair.indexOf('=');
  const context = await browser.newContext(contextFor(width, touch));
  // Playwright's 30 s is written for a network and a cold app server. This one
  // is on the loopback with the page already built, so a thing that is not
  // there in five seconds is not coming — and a check that takes half a minute
  // to say "no" is one nobody runs twice.
  context.setDefaultTimeout(5_000);
  await context.addCookies([
    { name: pair.slice(0, eq), value: pair.slice(eq + 1), url: app.base },
  ]);
  return context.newPage();
}

// Computed colour, which is the whole reason to be in a browser: the studio's
// colour rules are about what a person sees, and a class name is not that.
export const colourOf = (locator) => locator.evaluate((n) => getComputedStyle(n).color);

// ⚠️ Asserted before any rule behind a media query, never assumed. A check
// for `@media (pointer: coarse)` that runs without a coarse pointer passes
// while testing nothing, which is worse than failing: it reports the rule as
// held. If this ever fails, the emulation stopped producing the query and the
// fix is a launch arg, not a change to what the rule says.
export async function assertCoarse(page) {
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (!coarse) {
    throw new Error(
      'This page does not report a coarse pointer, so the touchscreen rules '
      + 'are not in force and nothing below is being checked. Fix the '
      + 'emulation in contextFor() before reading the result.',
    );
  }
}
