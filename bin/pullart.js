// Pull the **big set**: CC0 art mirrored into this repository, so a kid can
// type a word and get a picture with no network, no key and no third party
// deciding what is safe. The *standard set* beside it stays hand-picked and
// small; this is the half that is large and machine-gathered (spec.md §4).
//
//   npm run pullart                 # every source below
//   npm run pullart -- kenney       # one of them, leaving the rest alone
//   npm run pullart -- --dry        # fetch everything, write nothing
//   npm run pullart -- --list       # what would be pulled, fetching nothing
//
// Run it on a machine that can reach the sources, the way `npm run sweep` is
// run on the machine holding the games. It is **not** part of `npm test`,
// which has no network.
//
// **A source owns its own half of the set.** One that comes back replaces
// every picture named for it and nothing else; one that fails, or was not
// asked for, leaves its pictures exactly where they are. So a re-run is how
// a source changes, git says what moved, and one host being down costs that
// host's art rather than everybody's.
//
// ⚠️ Safety here is the **source list**, not a filter. Every pack named below
// is one author's CC0 game art, safe by what it is rather than by a flag
// somebody set. Adding a source means reading it first; there is no
// moderation queue behind this and there is not meant to be.
//
// ⚠️ Nothing is resized. The sources are asked for art that is already small
// (Kenney sprites are 64² to 256², PhyloPic serves rasters by size), anything
// over MAX_SIDE is skipped rather than scaled, and the browser's own asPng()
// does the fitting when somebody picks one. A resizer here would mean a PNG
// decoder and encoder in a repository with no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { entries, read } from './unzip.js';
import { cards, searchUrl, svgUrl } from './svgsilh.js';

const OUT = path.resolve(import.meta.dirname, '..', 'public', 'big-set');
const PICTURES = path.join(OUT, 'pictures');

// A picture bigger than this is a sheet, a poster or a scan — never the one
// thing a game draws. Skipped rather than scaled, see the header.
const MAX_SIDE = 512;
// Mean enough that no single file dominates the repository. Kenney's sprites
// come in under 3 KB; the cap is for the odd detailed one.
const MAX_BYTES = 128 * 1024;

// ⚠️ Copied into `assets/sprites/`, where the sprites library reads a picture
// whose width is a whole multiple of its height as a *strip* of square frames
// — so a 2:1 fish would animate instead of sitting still. The same rule
// `server/collection.js` and `test/story-art.test.js` hold their halves to.
const readsAsStrip = (width, height) => width > height && width % height === 0;

// A PNG states its size in IHDR, the first chunk. Null for anything that is
// not a PNG, which is the refusal — the fourth copy of these eight bytes in
// the studio, and the first that may not import the others (bin/ is not
// served and server/ is not build-time).
function pngSize(buf) {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!buf || buf.length < 24) return null;
  if (magic.some((byte, i) => buf[i] !== byte)) return null;
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width && height ? { width, height } : null;
}

/* Sources ------------------------------------------------------------------ */

// Kenney's packs: one author, everything CC0, everything drawn to be a game.
// The studio already ships 30 of his animal faces in the standard set, so
// this is more of a thing people here have seen work.
//
// ⚠️ Hand-written rather than crawled. kenney.nl's asset list is built in the
// browser and has no machine-readable index, so a slug is added here by a
// person who looked at the pack — which is also the safety rule above.
// Shooter packs are left out on purpose; this studio is used by kids.
//
// `tags` is the pack's own subject, searched alongside each picture's name:
// a drawing called "Fish red" should also come back for *sea*, and a pack is
// the only place that knowledge exists.
//
// Four packs were pulled and then dropped, which is the judgement this list
// is for: tiny-town, tiny-farm and pixel-platformer are tilesets whose every
// picture is called `tile_0044`; generic-items is 324 of `genericItem_color_001`;
// platformer-art-deluxe is 930 concatenated names (`treetrunkbranchendleft`)
// an older pack shipped, and its good half is in new-platformer-pack anyway;
// roguelike-characters ships only spritesheets; food-kit is 3D models.
const KENNEY = [
  { pack: 'fish-pack', tags: 'sea water underwater ocean' },
  { pack: 'animal-pack', tags: 'animal creature pet' },
  { pack: 'toon-characters', tags: 'person people character cartoon' },
  { pack: 'new-platformer-pack', tags: 'platformer jumping ground scenery' },
  { pack: 'simplified-platformer-pack', tags: 'platformer simple ground' },
  { pack: 'scribble-platformer', tags: 'platformer drawn scribble sketch' },
  { pack: 'jumper-pack', tags: 'jumping platformer' },
  { pack: 'alien-ufo-pack', tags: 'alien space ufo' },
  { pack: 'rolling-ball-assets', tags: 'ball rolling marble maze' },
  { pack: 'physics-assets', tags: 'block crate falling stacking' },
  { pack: 'board-game-icons', tags: 'board game dice card counter' },
  { pack: 'sports-pack', tags: 'sport ball player team' },
  { pack: 'shape-characters', tags: 'shape face hand body' },
  { pack: 'emotes-pack', tags: 'emote feeling mood bubble' },
  { pack: 'medals', tags: 'medal prize award winning' },
  { pack: 'letter-tiles', tags: 'letter alphabet word spelling' },
];

// A picture whose name is a word and a number — `tile_0044`, `characterBlue
// (13)` — is one of a run of near-identical variants. Its pack's `tags` would
// still find it, which is exactly the problem: 187 numbered poses bury every
// picture somebody could have named. ⚠️ The brackets are load-bearing —
// Kenney's older packs number with `(13)` and his newer ones with `_13`.
const UNSEARCHABLE = /^[a-z]+[^a-z0-9]*\d+[^a-z0-9]*$/i;

// A pack page offers its zip behind a donation prompt; the link inside it is
// the download. Scraped once per pack, rarely, from a laptop — and Kenney
// asks for a donation rather than for nobody to link, which `npm run pullart`
// prints a reminder of when it finishes.
const KENNEY_ZIP = /id='donate-text'[^>]*href='([^']+\.zip)'/;

// What inside a pack is never one thing a game draws: the shop preview, the
// sample sheet, and the packed sheets a game would have to cut up itself.
const NOT_ART = /(^|\/)(preview|sample|spritesheet|tilesheet|tilemap|__macosx)/i;

// PhyloPic: silhouettes of living things, and the only dinosaurs in the set —
// Kenney has drawn none. ⚠️ Mixed licences: most of PhyloPic is CC BY, so
// every image is checked one at a time and roughly half are left behind.
//
// ⚠️ `filter_name` matches **scientific** names only — *cow*, *owl* and *duck*
// all answer 404 — so each row is the taxon to ask for and the words a kid
// would actually type, which become the picture's tags. Homo is left out: a
// studio of kids has no use for it and the archive's human figures come with
// anatomical variants attached.
const PHYLOPIC_TAXA = [
  ['Tyrannosaurus', 'dinosaur trex monster'], ['Triceratops', 'dinosaur horns'],
  ['Stegosaurus', 'dinosaur plates'], ['Velociraptor', 'dinosaur raptor'],
  ['Brachiosaurus', 'dinosaur longneck'], ['Diplodocus', 'dinosaur longneck'],
  ['Ankylosaurus', 'dinosaur armour'], ['Spinosaurus', 'dinosaur sail'],
  ['Pterodactylus', 'dinosaur flying pterodactyl'], ['Mammuthus', 'mammoth elephant ice age'],
  ['Smilodon', 'sabre tooth tiger cat'], ['Felis', 'cat kitten pet'],
  ['Canis', 'dog wolf puppy pet'], ['Vulpes', 'fox'], ['Ursus', 'bear'],
  ['Panthera', 'lion tiger leopard big cat'], ['Equus', 'horse pony zebra'],
  ['Elephas', 'elephant'], ['Giraffa', 'giraffe'], ['Lepus', 'rabbit hare bunny'],
  ['Mus', 'mouse'], ['Sciurus', 'squirrel'], ['Cervus', 'deer stag'],
  ['Macaca', 'monkey'], ['Balaenoptera', 'whale'], ['Delphinus', 'dolphin'],
  ['Carcharodon', 'shark'], ['Octopus', 'octopus'], ['Cancer', 'crab'],
  ['Chelonia', 'turtle tortoise'], ['Python', 'snake'], ['Crocodylus', 'crocodile alligator'],
  ['Rana', 'frog'], ['Apis', 'bee'], ['Papilio', 'butterfly'], ['Formica', 'ant'],
  ['Coccinella', 'ladybird ladybug beetle'], ['Helix', 'snail'],
  ['Spheniscidae', 'penguin'], ['Bubo', 'owl'], ['Aquila', 'eagle bird'],
  ['Anas', 'duck'], ['Gallus', 'chicken hen rooster'], ['Ovis', 'sheep lamb'],
  ['Bos', 'cow cattle bull'], ['Sus', 'pig piglet'], ['Capra', 'goat'],
  ['Struthio', 'ostrich bird'], ['Aurelia', 'jellyfish'], ['Asterias', 'starfish'],
];
const PHYLOPIC = 'https://api.phylopic.org';
const CC0 = 'creativecommons.org/publicdomain/zero';

// svgsilh: ~358,000 CC0 silhouettes — flat, transparent, and the shape a
// game wants most.
//
// It is read through **its own search** (`bin/svgsilh.js`), not through an
// aggregator. That was not the first design: this went through Openverse
// until its search went down on 2026-09-04 and answered 504 for an hour, at
// which point the second host stopped looking free. Reading the site itself
// is one host instead of two, no key, no published rate limit — and ⚠️ the
// **licence comes from the people hosting the picture**, per card, in RDFa,
// rather than from somebody else's index of it.
//
// ⚠️ Cloudflare still refuses a datacenter address outright — 403 on every
// path, `/svg/<id>.svg` included — so this half runs from a laptop or not
// at all.
//
// **The word list is the curation.** A silhouette only enters the set if a
// word below asked for it, which is why nobody has to audit 358,000 rows:
// the same rule as Kenney's pack list, in a different shape. Twelve a word,
// which comes to about a thousand.
const SVGSILH_WORDS = [
  'dragon', 'robot', 'rocket', 'spaceship', 'alien', 'ghost', 'monster', 'skull',
  'castle', 'tower', 'house', 'door', 'ladder', 'bridge', 'fence', 'window',
  'sword', 'shield', 'crown', 'key', 'gem', 'coin', 'treasure', 'chest',
  'bomb', 'arrow', 'target', 'flag', 'clock', 'lamp', 'book', 'map',
  'star', 'heart', 'moon', 'sun', 'cloud', 'snowflake', 'fire', 'lightning',
  'tree', 'flower', 'mushroom', 'leaf', 'cactus', 'mountain', 'rock', 'wave',
  'boat', 'car', 'train', 'plane', 'bicycle', 'balloon', 'kite', 'anchor',
  'wheel', 'gear', 'magnet', 'telescope', 'camera', 'guitar', 'drum', 'bell',
  'ball', 'dice', 'cake', 'apple', 'banana', 'carrot', 'cheese', 'pizza',
  'fish', 'bird', 'cat', 'dog', 'horse', 'cow', 'pig', 'sheep',
  'rabbit', 'mouse', 'bear', 'lion', 'monkey', 'elephant', 'snake', 'frog',
  'spider', 'butterfly', 'bee', 'crab', 'octopus', 'whale', 'dinosaur', 'wizard',
];
const SVGSILH_PER_WORD = 12;
// svgsilh publishes no rate limit, which is a reason to be careful rather
// than a licence not to be: this run asks a small site for a page and a
// thousand files in one sitting, so it waits between requests. Under ten
// minutes for the whole source, and a guest's pace.
const POLITE_PAUSE = 400;
// However this source fails — Cloudflare refusing the address, the site
// down, a search page that comes back without cards in it — it fails the
// same way on every word. So a run stops asking rather than grinding through
// the list to prove it.
const GIVE_UP_AFTER = 4;
// An SVG is text, and a silhouette is one path. Anything much larger is a
// traced photograph, which is not what this set is for.
const MAX_SVG_BYTES = 64 * 1024;

/* Fetching ------------------------------------------------------------------ */

// Every source here answers a browser and some of them refuse a bare script,
// so the pull says who it is. ⚠️ svgsilh.com refuses a datacenter address
// outright (Cloudflare, 403 on every path) — one reason the set is mirrored
// rather than fetched while somebody waits.
const AGENT = 'unbridled-joy-pullart/1 (+https://kenney.nl; one pull, then cached in-repo)';

// ⚠️ Node's fetch waits forever by default, and a source that is *slow to
// refuse* costs more than one that refuses. Openverse's search went down on
// 2026-09-04 and answered a 504 after sixty seconds; ninety-six words of that
// is an hour and a half before the run gives up.
//
// Two numbers rather than one, because a page and a pack are different
// waits: an API or a search result that takes twenty seconds is broken, and
// a multi-megabyte zip that takes ninety is a slow morning. One number for
// both was 30s, and it cost `letter-tiles` its pictures the first time
// somebody's connection hesitated.
const PATIENCE = 20_000;
const PATIENCE_BYTES = 120_000;

async function grab(url, as = 'buffer') {
  const res = await fetch(url, {
    headers: { 'User-Agent': AGENT },
    signal: AbortSignal.timeout(as === 'buffer' ? PATIENCE_BYTES : PATIENCE),
  });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  if (as === 'json') return res.json();
  if (as === 'text') return res.text();
  return Buffer.from(await res.arrayBuffer());
}

/* Naming -------------------------------------------------------------------- */

// A file name a ten-year-old can say out loud, and a path the shelf's own
// test will accept: lowercase, one dash for any run of anything else.
const slug = (text) => String(text).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// `fish_blue` becomes "Fish blue": the words a kid types into the shelf's
// filter are the ones whoever drew it used, so they are kept rather than
// prettified into a caption nobody would search for.
const title = (text) => {
  const words = String(text).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
};

/* Kenney -------------------------------------------------------------------- */

// One pack, as art the set can hold. A pack ships the same drawing at two or
// three scales in sibling folders (PNG/Default, PNG/Double); the biggest that
// is still under the cap wins, keyed on the file's own name, so the set holds
// each drawing once at the sharpest size a game will want.
async function kenneyPack({ pack, tags }, report) {
  const page = await grab(`https://kenney.nl/assets/${pack}`, 'text');
  const found = page.match(KENNEY_ZIP);
  if (!found) throw new Error(`no download link on the ${pack} page`);
  const zip = await grab(found[1]);

  const best = new Map();
  for (const entry of entries(zip)) {
    if (!entry.name.toLowerCase().endsWith('.png') || NOT_ART.test(entry.name)) continue;
    if (entry.size > MAX_BYTES) { report.big += 1; continue; }
    let bytes;
    try {
      bytes = read(zip, entry);
    } catch { report.unread += 1; continue; }

    const size = pngSize(bytes);
    if (!size) { report.unread += 1; continue; }
    if (Math.max(size.width, size.height) > MAX_SIDE) { report.big += 1; continue; }
    // ⚠️ Skipped rather than padded: padding means encoding a PNG, and a
    // pack's few strips are not worth a encoder in a repository with none.
    if (readsAsStrip(size.width, size.height)) { report.strips += 1; continue; }

    const bare = path.basename(entry.name, path.extname(entry.name));
    if (UNSEARCHABLE.test(bare)) { report.unnamed += 1; continue; }
    const key = slug(bare);
    if (!key) continue;
    const area = size.width * size.height;
    const held = best.get(key);
    if (!held || area > held.area) best.set(key, { bytes, area, name: key });
  }

  return [...best.values()].map((picture) => ({
    file: `pictures/kenney-${pack}-${picture.name}.png`,
    kind: 'sprite',
    name: title(picture.name),
    tags,
    by: 'Kenney',
    licence: 'CC0',
    bytes: picture.bytes,
  }));
}

/* PhyloPic ------------------------------------------------------------------- */

// The API pins every answer to a build index and refuses a stale one, so the
// current build is asked for once and carried through the run. Asking for the
// list with no build at all redirects to the current one, which fetch follows.
async function phylopicBuild() {
  const { build } = await grab(`${PHYLOPIC}/images`, 'json');
  if (!build) throw new Error('PhyloPic did not say which build is current');
  return build;
}

async function phylopicTaxon([taxon, tags], build, seen, report) {
  // ⚠️ The name index is lowercase and case-sensitive: `Tyrannosaurus` is a
  // 404 and `tyrannosaurus` is three silhouettes.
  const list = await grab(
    `${PHYLOPIC}/images?build=${build}&page=0&filter_name=${encodeURIComponent(taxon.toLowerCase())}`,
    'json',
  );
  const items = list?._links?.items ?? [];
  const art = [];
  for (const item of items.slice(0, 4)) {
    const uuid = item.href.split('/')[2]?.split('?')[0];
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    const detail = await grab(`${PHYLOPIC}/images/${uuid}?build=${build}`, 'json');

    // ⚠️ The licence is per image and most of PhyloPic is not CC0. An image
    // whose licence is anything else is left where it is.
    if (!String(detail?._links?.license?.href ?? '').includes(CC0)) { report.notCc0 += 1; continue; }

    // The rasters run large to small; the first one inside the cap is the
    // one a game wants, and a thumbnail is the fallback for a wide silhouette
    // whose smallest raster is still too big.
    const files = [...(detail._links.rasterFiles ?? []), ...(detail._links.thumbnailFiles ?? [])];
    const fits = files.find((f) => {
      const [w, h] = String(f.sizes).split('x').map(Number);
      return w && h && Math.max(w, h) <= MAX_SIDE && !readsAsStrip(w, h);
    });
    if (!fits) { report.big += 1; continue; }

    const bytes = await grab(fits.href);
    if (bytes.length > MAX_BYTES) { report.big += 1; continue; }
    if (!pngSize(bytes)) { report.unread += 1; continue; }

    // A silhouette is titled scientifically, so the words a kid would type
    // are carried as tags instead: nobody searches for `Balaenoptera`.
    const name = detail._links.self?.title ?? taxon;
    art.push({
      file: `pictures/phylopic-${slug(name)}-${uuid.slice(0, 8)}.png`,
      kind: 'sprite',
      name: title(name),
      tags: `${tags} silhouette shadow`,
      by: detail._links.contributor?.title ?? 'PhyloPic',
      licence: 'CC0',
      bytes,
    });
  }
  return art;
}

/* svgsilh --------------------------------------------------------------------- */

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function svgsilhWord(word, seen, report) {
  const page = await grab(searchUrl(word), 'text');
  const found = cards(page);
  // A page that answered but holds no cards is not a search result — a 404
  // body, an interstitial, a Cloudflare challenge. Worth failing on, because
  // silently pulling nothing for every word would write an empty source.
  if (!found.length) throw new Error('answered with no cards on it');

  const art = [];
  for (const card of found) {
    if (art.length >= SVGSILH_PER_WORD) break;
    if (seen.has(card.id)) continue;
    seen.add(card.id);

    await wait(POLITE_PAUSE);
    const text = await grab(svgUrl(card.id), 'text').catch(() => null);
    if (!text || !text.includes('<svg')) { report.unread += 1; continue; }
    if (Buffer.byteLength(text) > MAX_SVG_BYTES) { report.big += 1; continue; }

    // ⚠️ No strip check here, unlike every other source: a vector has no
    // pixel size to measure. `svgBox` in the browser does it instead, on the
    // size it is about to draw at (public/story-guide.js).
    art.push({
      file: `pictures/svgsilh-${slug(word)}-${card.id}.svg`,
      kind: 'sprite',
      // A card carries no title, only keywords — so the name is the word
      // somebody typed to find it, which is also the word they will type
      // again. Twelve dragons all called Dragon is what a shelf of dragons
      // should look like; `shelfDestination` counts up past the collision.
      name: title(word),
      // The card's own keywords, which are worth more than anything guessable
      // from the search word: a tiger found under *animal* says *tiger* here.
      tags: `${word} ${card.tags} silhouette`.trim(),
      by: 'SVG Silh',
      // ⚠️ Not assumed — `cards()` drops any card whose own RDFa does not
      // say CC0, so this is the site's claim about its own file.
      licence: 'CC0',
      bytes: Buffer.from(text, 'utf8'),
    });
  }
  return art;
}

/* The run -------------------------------------------------------------------- */

// In the order they are most likely to refuse, not alphabetically: a source
// that is going to fail says so before sixteen pack downloads rather than
// after them. Since a refusal now costs only its own half, this is about
// how soon somebody watching finds out rather than about what is lost.
const SOURCES = {
  svgsilh: {
    what: `up to ${SVGSILH_WORDS.length * SVGSILH_PER_WORD} CC0 silhouettes,`
      + ` searched on svgsilh.com by ${SVGSILH_WORDS.length} words`,
    async pull(report) {
      const seen = new Set();
      const art = [];
      // Counted here rather than on `report`, which phylopic also writes to:
      // the checks below are about *this* source's words.
      let lost = 0;
      let inARow = 0;
      for (const [i, word] of SVGSILH_WORDS.entries()) {
        if (i) await wait(POLITE_PAUSE);
        try {
          const got = await svgsilhWord(word, seen, report);
          art.push(...got);
          inARow = 0;
          console.log(`  ${word}: ${got.length}`);
        } catch (e) {
          // ⚠️ A 403 is Cloudflare refusing this address, which a datacenter
          // sees on every word; "no cards on it" is something answering that
          // is not the search page. One word failing is nothing — a word
          // svgsilh has nothing for is allowed.
          console.error(`  ${word}: ${e.message}`);
          report.missing += 1;
          lost += 1;
          inARow += 1;
          // ⚠️ None of those three get better by asking ninety more times.
          // Failing here rather than at the end is the difference between
          // knowing in a minute and knowing in ninety.
          if (inARow >= GIVE_UP_AFTER) {
            throw new Error(`${inARow} words in a row failed, the last with "${e.message}"`
              + ' — nothing here gets better by asking again');
          }
        }
      }
      if (lost > SVGSILH_WORDS.length / 2) {
        throw new Error(`${lost} of ${SVGSILH_WORDS.length} words failed`
          + ' — a set with that big a hole in it is not a set');
      }
      // A word that found nothing is a word, not a failure: this source is
      // one shelf, so getting this far means it is authoritative for it.
      return { art, replaces: ['svgsilh-'] };
    },
  },
  kenney: {
    what: `${KENNEY.length} CC0 game-art packs by Kenney (kenney.nl)`,
    async pull(report) {
      const art = [];
      const replaces = [];
      for (const source of KENNEY) {
        try {
          const got = await kenneyPack(source, report);
          art.push(...got);
          // ⚠️ Only a pack that actually came back gives up the pictures it
          // put here last time. The trailing dash is the boundary: without
          // it `kenney-medals-` would also claim a pack called medals-2.
          replaces.push(`kenney-${source.pack}-`);
          console.log(`  ${source.pack}: ${got.length}`);
        } catch (e) {
          console.error(`  ${source.pack}: ${e.message} — its pictures are left as they were`);
          report.failed += 1;
        }
      }
      return { art, replaces };
    },
  },
  phylopic: {
    what: `CC0 silhouettes from PhyloPic, asked for by ${PHYLOPIC_TAXA.length} taxa`,
    async pull(report) {
      const build = await phylopicBuild();
      const seen = new Set();
      const art = [];
      for (const row of PHYLOPIC_TAXA) {
        try {
          const got = await phylopicTaxon(row, build, seen, report);
          art.push(...got);
          console.log(`  ${row[0]}: ${got.length}`);
        } catch (e) {
          // A taxon PhyloPic has never heard of answers 404, which is a
          // wrong word in the list rather than a broken run.
          console.error(`  ${row[0]}: ${e.message.startsWith('404') ? 'nothing under that name' : e.message}`);
          report.missing += 1;
        }
      }
      return { art, replaces: ['phylopic-'] };
    },
  },
};

// Which source a picture already in the set came from. Every file is named
// `pictures/<source>-…`, which is what makes a source's half of the set
// identifiable without recording it in every row.
const sourceOf = (file) => Object.keys(SOURCES)
  .find((name) => path.basename(file).startsWith(`${name}-`));

// **A source owns its own half, and only its own half.** Each one that comes
// back replaces every picture named for it and nothing else; each one that
// fails, or was not asked for, leaves its pictures exactly where they are.
//
// This was "the set is written whole" until 2026-09-04, which meant one host
// refusing took the other two down with it and there was no way to pull the
// two that worked. The invariant that mattered — a picture dropped upstream
// leaves rather than lingering — survives per source, and the thing it was
// paying for turns out to be free.
const asked = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const names = asked.length ? asked : Object.keys(SOURCES);
for (const name of names) {
  if (!SOURCES[name]) {
    console.error(`no source called ${name} — try ${Object.keys(SOURCES).join(', ')}`);
    process.exit(1);
  }
}
if (process.argv.includes('--list')) {
  for (const name of names) console.log(`${name}: ${SOURCES[name].what}`);
  process.exit(0);
}

const report = {
  big: 0, strips: 0, unread: 0, unnamed: 0, notCc0: 0, missing: 0, failed: 0,
};
const pulled = new Map();
const refused = [];
for (const name of names) {
  console.log(`${name} — ${SOURCES[name].what}`);
  try {
    const got = await SOURCES[name].pull(report);
    if (!got.art.length) throw new Error('nothing came back');
    pulled.set(name, got);
  } catch (e) {
    console.error(`\n${name} could not be pulled: ${e.message}`);
    refused.push(name);
  }
}

if (!pulled.size) {
  console.error(`\nnothing came back at all — the set is left exactly as it was (${
    refused.join(', ')})`);
  process.exit(1);
}

const art = [...pulled.values()].flatMap((got) => got.art);

// Everything really fetched, nothing written. What a first run wants: svgsilh
// in particular answers a laptop and refuses a datacenter, so finding out
// costs a few minutes rather than a commit that has to be undone.
if (process.argv.includes('--dry')) {
  console.log(`\n${art.length} pictures would be written, and nothing was:`);
  for (const [name, got] of pulled) console.log(`  ${name}: ${got.art.length}`);
  for (const name of refused) console.log(`  ${name}: refused — its pictures would be left alone`);
  process.exit(0);
}

// What the set already holds, minus what this run is authoritative for. A
// source says that itself — Kenney per *pack*, so one pack timing out costs
// that pack's refresh rather than its pictures — and anything nobody claimed
// stays exactly as it is. A first run finds no index and keeps nothing, which
// is the same code path.
const before = fs.existsSync(path.join(OUT, 'index.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')).art ?? []
  : [];
const replacing = [...pulled.values()].flatMap((got) => got.replaces);
const kept = before.filter(
  (a) => !replacing.some((prefix) => path.basename(a.file).startsWith(prefix)),
);

fs.mkdirSync(PICTURES, { recursive: true });

const seenFiles = new Set(kept.map((a) => a.file));
const index = [...kept];
for (const picture of art) {
  if (seenFiles.has(picture.file)) continue;
  seenFiles.add(picture.file);
  const { bytes, ...entry } = picture;
  fs.writeFileSync(path.join(OUT, entry.file), bytes);
  index.push(entry);
}
index.sort((a, b) => a.file.localeCompare(b.file));

// A picture the index no longer names: one this run replaced, one its source
// dropped upstream, or one belonging to a source that has been taken out of
// the list above. The index is the truth and the folder follows it.
for (const name of fs.readdirSync(PICTURES)) {
  if (!seenFiles.has(`pictures/${name}`)) fs.rmSync(path.join(PICTURES, name));
}

fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify({
  _what: 'The big set: CC0 art mirrored into this repository by `npm run pullart`, '
    + 'offered on the same shelf as the hand-picked standard set and the studio '
    + 'collection. Written by the pull, a source at a time — edit bin/pullart.js, '
    + 'not this file. '
    + 'A `sprite` is one thing on a transparent background and lands in assets/sprites/. '
    + 'A .svg entry is a silhouette, rasterised to a PNG by the browser when it is '
    + 'picked (artBytes in public/story-guide.js); everything else is already a PNG.',
  art: index,
}, null, 1)}\n`);

const by = [...new Set(index.map((a) => a.by))].sort();
fs.writeFileSync(path.join(OUT, 'licences.txt'), `The big set: where it came from, and under what.

Written by \`npm run pullart\`. Everything here is CC0 — public domain, no
attribution required, commercial use fine. Credit is given anyway, because
somebody drew it.

${index.length} pictures, by ${by.length} ${by.length === 1 ? 'maker' : 'makers'}:

${by.map((who) => `  ${who} — ${index.filter((a) => a.by === who).length}`).join('\n')}

Kenney's packs come from https://kenney.nl/assets and are CC0; he asks for a
donation rather than for credit, and https://kenney.nl/donate is the place.

PhyloPic silhouettes come from https://api.phylopic.org — that archive is
mixed, and only its CC0 images are here.

SVG Silh silhouettes come from https://svgsilh.com — searched, read and
fetched there, with no aggregator in between. Each one's CC0 is svgsilh's own
declaration on its own card (RDFa, rel="license"), checked per picture by the
pull; a card that does not say so is left where it is.
`);

const bytes = index.reduce((n, a) => n + fs.statSync(path.join(OUT, a.file)).size, 0);
console.log(`\n${index.length} pictures, ${(bytes / 1024 / 1024).toFixed(1)} MB in public/big-set/`);
// Said plainly rather than as a warning: art left alone is the set keeping
// what it already had, which is the point. `kept` counts what this run did
// not claim — a refused source, and any pack inside a source that failed.
for (const [name, got] of pulled) {
  const held = kept.filter((a) => sourceOf(a.file) === name).length;
  console.log(`  ${name}: ${got.art.length} refreshed${held ? `, ${held} left as they were` : ''}`);
}
for (const name of refused) {
  const held = kept.filter((a) => sourceOf(a.file) === name).length;
  console.log(`  ${name}: refused — its ${held} left as they were`);
}
const skipped = Object.entries(report).filter(([, n]) => n > 0);
if (skipped.length) console.log(`skipped: ${skipped.map(([k, n]) => `${n} ${k}`).join(', ')}`);
console.log('Kenney asks for a donation rather than credit: https://kenney.nl/donate');
