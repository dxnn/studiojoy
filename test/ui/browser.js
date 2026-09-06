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
// set of fixtures that can drift from it.
export async function openStudio(t) {
  const app = await setup({ publicDir: PUBLIC_DIR });
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
export async function pageFor(browser, app, client, { width = LAPTOP } = {}) {
  const cookie = client.peek();
  if (!cookie) throw new Error('that client is not signed in');
  const pair = cookie.split(';')[0].trim();
  const eq = pair.indexOf('=');
  const context = await browser.newContext({ viewport: { width, height: 820 } });
  await context.addCookies([
    { name: pair.slice(0, eq), value: pair.slice(eq + 1), url: app.base },
  ]);
  return context.newPage();
}

// Computed colour, which is the whole reason to be in a browser: the studio's
// colour rules are about what a person sees, and a class name is not that.
export const colourOf = (locator) => locator.evaluate((n) => getComputedStyle(n).color);
