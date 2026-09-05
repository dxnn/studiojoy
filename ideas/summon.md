# Summoning a picture

Kids type a word and get a picture. Two halves, built in that order:
a **mirrored corpus in the repo** that works offline and is safe by
construction, and a **live search** over CC0 art on the wider web.

Decided 2026-09-04: a summoned picture lands in the game as a file, the same
way an upload does — no separate tray, no approval queue.

**Status.** Half one is built and green as the *big set*: 1,775 CC0 pictures
from Kenney (1,685) and PhyloPic (90), written by `npm run pullart`, searched
offline by name and tags, picked from `+ Find a thing to put in`. Half two is
unbuilt. Two things this plan said that the building corrected:

- **svgsilh is written and has never been run.** Cloudflare refuses a
  datacenter address on every path, so the fetching is blind and `--dry`
  exists to make finding out cost minutes rather than a commit. Everything
  around it is checked: the parser against the site's real markup
  (`test/svgsilh.test.js`), the fit arithmetic in `test/svg-box.test.js`, and
  the pick path in a browser against a stand-in silhouette (600×300 viewBox
  in, 255×128 PNG out, the strip shave firing).
- **Openverse is out of it.** This source went through Openverse's API until
  its search went down on 2026-09-04 and answered 504 to every query for an
  hour — filters or none, while its unsearched endpoints answered in under
  two seconds. svgsilh has its own search (`search/<word>-1.html`, twenty
  RDFa cards a page), which is one host instead of two, no key, no published
  rate limit — and ⚠️ **each card declares its own licence**, so CC0 is now
  the claim of whoever hosts the file rather than an aggregator's index of
  it. The site's keywords are better tags than the search word, too.
  The outage also bought two rules worth keeping: a timeout on every fetch,
  and giving up after four failed words in a row. Ninety minutes to notice,
  now three seconds.
- **The set is no longer written whole**, which was the plan's worst idea. It
  meant one host refusing blocked every pull, including the two sources that
  worked — and, one level down, a single pack's zip timing out silently
  deleted that pack's 27 committed pictures. Art now belongs to whatever
  fetched it, and only a fetch that succeeded replaces it: a source declares
  what it is authoritative for (Kenney per *pack*), everything else stays byte
  for byte, and a picture the new index does not name is deleted so an
  upstream removal still leaves. Naming a source pulls just that one. The
  invariant survives at a finer grain and costs nothing.
- **Nothing is resized at pull time.** The plan said every fetch would be.
  Resizing in Node with no dependencies means a PNG decoder *and* encoder;
  asking the sources for art that is already small costs nothing, and
  `asPng()` in the browser already fits a picture when somebody picks it.
  Anything over 512 a side is skipped instead.

## What is already built

Two thirds of the work is done and this plan is mostly wiring.

- `asPng(file, [maxW, maxH])` in `public/story-guide.js:230` takes anything
  the browser can decode, scales it to fit (never up), writes PNG, and shaves
  a pixel off a portrait that lands on a whole multiple of its height — the
  *strip* trap in `assets/sprites/`. `UPLOAD_FITS` is `{portrait: 256²,
  backdrop: 960×540}`. Both the guide and *Add a picture* already call it.
  **The "auto reduce in size" half needs no new code.**
- `artIndex()` in `public/story-guide.js:74` already merges two halves — the
  *standard set* under `public/story-art/` and the *studio collection* out of
  SQLite — into one list, each entry gaining a `src` so nothing downstream
  knows which half it came from. A third half is a third spread.
- The shelf renders in four places (the guide's card strip, `Pick a face…` on
  a mood, `+ Pick a … from the shelf` in *Add a picture*, and the filtered
  dialog). All four read the merged list.

What is genuinely new is one outbound host. Today the studio calls DeepSeek
and nothing else.

## Why not Wikimedia Commons

Commons hosts explicit material as policy and its search is unfiltered by
design. It is the largest CC0-ish pool and the worst possible front door for
a studio used by kids. Ruled out.

## Half one: the mirrored corpus

Art pulled down once, committed to this repo, searched locally. No network at
runtime, no third party, no key, no rate limit, and the safety question is
answered once at pull time by a person rather than every time by a filter.

- `public/story-art/` keeps its hand-picked 42 and its readable
  `licences.txt`. The mirror is its own folder with its own index, so the
  curated set stays first on the shelf and the two never blur.
- `npm run <pull>` fetches from a fixed list of packs and writes the index.
  Run on a machine that can reach them, like `npm run sweep` is run on the
  machine holding the games — **not** part of `npm test`, which has no
  network.
- ⚠️ Every fetch is downscaled and re-encoded to PNG at pull time, to the
  same fits the client uses. A 4000px museum scan in the repo helps nobody.
- ⚠️ svgsilh.com sits behind Cloudflare bot management. It answers a laptop
  and refuses this sandbox's egress IP (403, "Attention Required", every path
  including `/svg/<id>.svg`). A datacenter IP may well be refused too — which
  is an argument *for* mirroring it rather than fetching it live, and a
  reason the pull script must be runnable from a laptop.

Sources worth pulling, all CC0 and all bounded by subject rather than by a
moderation flag:

| pack | what it is | why it suits |
|---|---|---|
| svgsilh | ~358k CC0 silhouettes | flat, transparent, exactly sprite-shaped |
| Kenney | ~40k CC0 game assets | already the source of the set's 30 animal faces |
| PhyloPic | ~13k CC0 organism silhouettes | dinosaurs and animals, safe by construction |
| NASA | ~131k public domain | planets, rockets, stars |

Kenney and OpenGameArt publish no machine-readable index (both 404). Kenney
ships ~100 downloadable zips; the pull script takes a hand-written list of
pack URLs, not a crawl.

**Open: how big.** 42 pictures is 240 KB, so ~5.7 KB each. 500 items is
~3 MB, 2,000 is ~12 MB. The index is read once a session by every client, so
2,000 entries is ~300 KB of JSON on the wire — which is fine, but the shelf
dialog rendering 2,000 thumbnails at once is not: past a few hundred the
dialog has to filter before it renders, and its images want `loading="lazy"`.

## Half two: live summon

A search box that reaches past the repo. **Openverse** (`api.openverse.org`)
is the one API worth using: `license=cc0` is a real filter, `source=` is an
allowlist, and its mature filter is on by default. Verified reachable from
here — `dragon`, `rocket`, `castle`, `ice cream`, `robot`, `dinosaur`,
`pirate` all return CC0 hits.

Its pool is Flickr (536M), Wikimedia (89M) and iNaturalist (266M), so the
safety comes from restricting **sources**, never from trusting the flag:

- **Allowed:** PhyloPic, NASA, Biodiversity Heritage, Animal Diversity,
  WoRMS, Museums Victoria, Science Museum, Smithsonian NMNH — nature, space,
  museum objects, silhouettes.
- **Refused:** Flickr, Wikimedia, Europeana, Met, Rijksmuseum, Rawpixel,
  Wellcome — unbounded, or classical nudity, or medical imagery.

Stated plainly rather than pretended away: nothing in the allowed list is
pornographic, but Biodiversity Heritage and Smithsonian NMNH hold anatomical
drawings and dead specimens, and PhyloPic includes human silhouettes. Nobody
has audited 5M rows and nobody will.

### Shape

- `server/summon.js` — the client, injected into `createApp({..., summon})`
  the way `llm` already is, so `npm test` drives a scripted fake and stays
  offline.
- `server/routes/summon.js` — `GET /api/summon?q=` for the JSON and
  `GET /api/summon/:id` for the bytes, both behind `requireAuth`. Never on
  the games origin, which reads no cookie and serves no proxy.
- The server makes the call, not the browser: no CORS, no tainted canvas, no
  third party seeing a kid's search, and the allowlist enforced where it
  cannot be edited in devtools.
- ⚠️ **SSRF.** `:id` is an Openverse UUID and the host is a constant. A
  user-supplied URL never reaches `fetch`. A byte cap applies before anything
  is decoded.
- Picking one is the upload path exactly: `send('/api/summon/<id>')` → blob →
  `asPng(blob, fit)` → the same write. `by` and `licence` ride the banner, as
  they already do for the standard set.

### Costs and limits

- 200 requests/day anonymous, 20/min burst. A free key raises it to 10k/day.
  ⚠️ If the key becomes an env var, `npm start` must **not** fail without it
  the way it does without `DEEPSEEK_API_KEY` — summon goes quiet instead, and
  half one still works.
- Openverse's thumbnail proxy re-encodes to JPEG, so transparency is lost.
  Fine for a browsing thumbnail, wrong for the picked bytes — take those from
  the origin URL.
- A word blocklist on the query is defence in depth and the weakest layer:
  easy to defeat, and it buys false confidence if anyone treats it as the
  guard. The source allowlist is the guard.
