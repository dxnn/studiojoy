// A published game's hero picture on the catalog card, in a real browser.
//
// This file exists because of one bug. The card is `ul a:not(.players)` and
// the hero was `a.hero`; :not() carries its argument's weight, so the plain
// card outweighed the hero rule on every property they share — and its
// `background` shorthand reset `background-image` to none. Every test the
// studio had passed: the class was on the anchor, `--hero` held the right
// url, the file was served. Only a browser resolves a cascade (spec/ §17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signIn, startGames } from '../helpers.js';
import { openStudio, pageFor, LAPTOP } from './browser.js';

// A real PNG rather than a made-up one, so the browser has something it can
// actually decode: the studio's own icon, standing in for a game's hero.
const PNG = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'public', 'icons', 'icon-192.png'),
);

// One published game wearing a hero, and the public origin serving it.
async function catalog(t) {
  const { app, browser } = await openStudio(t);
  await signIn(app);
  const games = await startGames(app);
  t.after(() => games.close());
  await app.client.json('POST', '/api/projects', { body: { name: 'Tank', slug: 'tank' } });
  await app.client.json('PUT', '/api/projects/tank/files/index.html', { rawBody: '<h1>Tank</h1>' });
  await app.client.json('PUT', '/api/projects/tank/files/hero.png', { rawBody: PNG });
  await app.client.json('POST', '/api/projects/tank/publish', { body: { published: true } });

  // The catalog is public, so the page carries nobody's cookie — but pageFor
  // wants a signed-in client, and the studio's own is the one to hand it.
  const page = await pageFor(browser, app, app.client, { width: LAPTOP });
  await page.goto(`${games.base}/`);
  await page.locator('ul a.hero').waitFor();
  return page;
}

test('a hero card paints its picture and stands taller', async (t) => {
  const page = await catalog(t);
  const card = page.locator('ul a.hero');

  // ⚠️ The whole point: what the browser resolved, not what the rule says.
  // `none` here is the bug — the class and the variable are right in either
  // case.
  const image = await card.evaluate((n) => getComputedStyle(n).backgroundImage);
  assert.match(image, /url\("[^"]*\/tank\/hero\.png"\)/, 'the hero is not painted');
  assert.match(image, /linear-gradient/, 'the wash over it is gone');

  // The other half of the same loss: a hero card is the taller one.
  const { height } = await card.boundingBox();
  assert.ok(height >= 136, `a hero card is 136px tall, this one is ${height}`);

  // And the picture the url names is really there, and really a picture.
  const ok = await page.evaluate((src) => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth > 0);
    img.onerror = () => res(false);
    img.src = src;
  }), image.match(/url\("([^"]+)"\)/)[1]);
  assert.ok(ok, 'the hero url does not load');
});
