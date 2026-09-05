// Reading svgsilh.com's own search results, for `npm run pullart`.
//
// The site has no API, but it has something better than one: a plain search
// URL, and result cards marked up in RDFa that carry the file, the keywords
// and ⚠️ **the licence, per picture, from the people hosting it**. That last
// is why this is worth parsing rather than asking an aggregator — an
// aggregator's word about somebody else's licence is one hop too many for art
// that gets copied into games people publish.
//
// Build-time only, and no network here: this half is a string in and rows
// out, so `test/svgsilh.test.js` can hold it to a real page's shape.
// `bin/pullart.js` is what fetches.

// One page of results. `-1` is the first page; the site pages the same way
// for every word, and one page of twenty is more than a pull wants per word.
export const searchUrl = (word, page = 1) => `https://svgsilh.com/search/${encodeURIComponent(word)}-${page}.html`;

// The picture itself. ⚠️ The SVG rather than the `/png-512/` beside it: 2 KB
// against 40, and it draws sharp at whatever size a game asks for, which is
// what `svgBox` in the browser then decides (spec/ §6).
export const svgUrl = (id) => `https://svgsilh.com/svg/${id}.svg`;

// A card opens with the RDFa subject — `about="/svg/1295198.svg"` — so that
// is where one card ends and the next begins.
const CARD = /about="\/svg\/(\d+)\.svg"/g;
// The keywords under the picture, which the card also puts in the img's alt.
// Far better tags than anything guessable from the word that was searched:
// a tiger found under *animal* says so itself.
const WORDS = /<img[^>]*class="card-img-top"[^>]*alt="([^"]*)"/;
// ⚠️ Per card, and the whole reason to read this page. A card without it is
// left alone rather than assumed.
const CC0 = /rel="license"[^>]*href="[^"]*creativecommons\.org\/publicdomain\/zero/;

// Every CC0 card on one search page: `{id, tags}`, in the order the page
// lists them. A page that is not a search page — a 404 body, an interstitial,
// a Cloudflare challenge — has no cards in it and comes back empty, which is
// the caller's cue that something answered but not the site.
export function cards(html) {
  const found = [];
  const starts = [...String(html ?? '').matchAll(CARD)];
  for (const [i, match] of starts.entries()) {
    const block = html.slice(match.index, starts[i + 1]?.index ?? html.length);
    if (!CC0.test(block)) continue;
    const tags = WORDS.exec(block)?.[1]?.trim().replace(/\s+/g, ' ') ?? '';
    found.push({ id: match[1], tags });
  }
  return found;
}
