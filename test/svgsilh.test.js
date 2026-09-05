// Reading svgsilh.com's search results (bin/svgsilh.js), which is how the
// *big set*'s silhouettes are found. No network here — the parser takes a
// string — so this is the half of that source that can be held to a shape.
//
// ⚠️ The fixtures are the real page's markup, cut down: RDFa `about` on the
// card, keywords in the img's alt, and `rel="license"` per picture. If the
// site is redesigned these stop matching, which is the point of having them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cards, searchUrl, svgUrl } from '../bin/svgsilh.js';

const CC0 = '<p><a rel="license" target="_blank" href="http://creativecommons.org/publicdomain/zero/1.0/">'
  + '<img src="https://licensebuttons.net/p/zero/1.0/80x15.png" alt="CC0" /></a></p>';

const card = (id, alt, licence = CC0) => `
<div xmlns:dct="http://purl.org/dc/terms/" about="/svg/${id}.svg" class="card mb-3 box-shadow h-100">
<a href="/image/${id}.html"><img class="card-img-top" src="/svg/${id}.svg" width="200px" height="200px" alt="${alt}" /></a>
<div class="card-body"><div class="card-text">
<p property="dct:title"><a class="text-muted" href="/tag/x-1.html">x</a></p>
<p><a href="/svg/${id}.svg" download="${id}.svg">SVG</a> <a href="/png-512/${id}.png">PNG</a></p>
${licence}
</div></div></div>`;

const page = (...blocks) => `<html><body><h3>animal (4693 images)</h3>
<div class="card-columns">${blocks.join('')}</div></body></html>`;

test('every card on a page comes back, in the order the page lists them', () => {
  const found = cards(page(
    card('1295198', 'animal safari jump tiger zoo nature africa '),
    card('1801287', 'svg animal cat kitty pet '),
  ));
  assert.deepEqual(found, [
    { id: '1295198', tags: 'animal safari jump tiger zoo nature africa' },
    { id: '1801287', tags: 'svg animal cat kitty pet' },
  ]);
});

// ⚠️ The assertion this source exists for. svgsilh says CC0 on the card
// itself, so a card that does not is left alone rather than assumed — the
// whole reason this reads the site instead of an aggregator's index of it.
test('a card that does not declare CC0 is left where it is', () => {
  const other = '<p><a rel="license" href="https://creativecommons.org/licenses/by/4.0/">CC BY</a></p>';
  const found = cards(page(
    card('111', 'dragon '),
    card('222', 'dragon ', other),
    card('333', 'dragon ', ''),
  ));
  assert.deepEqual(found.map((c) => c.id), ['111']);
});

// Something answered and it was not the search page: a 404 body, an
// interstitial, a Cloudflare challenge. Empty rather than a throw, so the
// caller decides — and `pullart` does throw, because a word that silently
// finds nothing on every word would write an empty source.
test('a page that is not a search page has nothing on it', () => {
  assert.deepEqual(cards('<html><h1>Attention Required! | Cloudflare</h1></html>'), []);
  assert.deepEqual(cards(''), []);
  assert.deepEqual(cards(null), []);
  assert.deepEqual(cards(undefined), []);
});

test('a card with no keywords is still a card', () => {
  assert.deepEqual(cards(page(card('444', ''))), [{ id: '444', tags: '' }]);
});

test('the two URLs are the ones the site uses', () => {
  assert.equal(searchUrl('dragon'), 'https://svgsilh.com/search/dragon-1.html');
  assert.equal(searchUrl('dragon', 3), 'https://svgsilh.com/search/dragon-3.html');
  // ⚠️ A word with a space in it is a path segment, not a query.
  assert.equal(searchUrl('ice cream'), 'https://svgsilh.com/search/ice%20cream-1.html');
  assert.equal(svgUrl('1295198'), 'https://svgsilh.com/svg/1295198.svg');
});
