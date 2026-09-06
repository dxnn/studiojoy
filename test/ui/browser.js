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

// A missing browser is the one failure that is not a bug in the studio, so it
// says what to run rather than surfacing Playwright's own message.
async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch (cause) {
    throw new Error(
      'Could not start Chromium. If it is not installed: npx playwright install chromium\n'
      + 'If this is a coding agent, it cannot run npm run ui at all — see the note above.',
      { cause },
    );
  }
}

// A studio and a browser, both closed when the test ends. The fixture is the
// same one every API test uses, so seeding is the API rather than a second
// set of fixtures that can drift from it.
export async function openStudio(t) {
  const app = await setup({ publicDir: PUBLIC_DIR });
  const browser = await launch();
  t.after(async () => {
    await browser.close();
    await app.close();
  });
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
