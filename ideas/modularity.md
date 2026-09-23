# Modularity: game types, studio libraries, and what 3D and 2D physics ask of each

(Dann, 2026-09-22: "two places I'd like to make more modular: the individual
game builders, and the studio libraries. I want to think about e.g. introducing
3D games, and games with 2D physics engines, both of which require introducing
new libraries and probably new game making mini-apps. I'd like to do this in a
civilized way.") A report, not a plan: nothing here is built, and every name
below is a working name — the glossary rule says ask before coining. Questions
for you are collected in §7; the working names in §8.

Written from the spec, the code and a touch-point map of every place a type
key or a library name is hard-coded. No tests were run, no browser opened, and
⚠️ nothing about third-party engines was checked against the network — the
sizes and build shapes in §3 are from memory and want confirming on a laptop.

## Progress (2026-09-22)

Decided: **vendor** both engines (Q1), **Phase 0 first** in the order of §5
(Q9), the defaults for the rest — so no working name in §8 is coined yet,
and Phase 1 waits on them.

Built, each its own commit with its tests:

- §4.1 optional libraries — `core` in the index, a template's `libraries`,
  `POST /api/projects/:slug/libraries`, one choice per missing extra in *Add
  a file*. The glossary has **core set** and **extra**, taken from here.
- §4.2 shape lines in the index as `shape`, achievements' line included, and
  a generic library test (files, note, scripts, shape, carried licences). The
  engine-version-in-the-name rule (Q3) needs no code until an engine lands.
- §4.5 `.glb`/`.gltf` mime and the upload guess to `assets/models/`. The
  folder is *not* in the preamble's list: a game with no renderer has no use
  for it, and the renderer's own shape line is where a helper should learn it.
- §4.4, plumbing half: `public/editor-file.js` (read an editor's file, write
  it against its etag) and one conflict dialog for the four whole-game
  editors. Smaller than the `configEditor` sketched below — the parked copy,
  the selection and autosave stayed each editor's, because they differ.
- §4.3, first half: each editor entry in `game-types.js` carries `isPath`,
  `load`, `park`, `saveDirty`, `changed`, `reset`, `inspector`,
  `view`/`applyView`, and `main.js`, `stream.js` and `files-tab.js` loop over
  them. The type's preamble paragraph is its template's `brief` in
  `game-templates/index.json`, moved byte for byte.
- §4.4 template harness: `test/templates.test.js`.

Phase 1 built the same day (Q1–Q9 answered, §8's names taken): the physics
library over planck 1.5.0, *Knock it down* (`knockdown`, heart
`config/bodies.js` — not `world.js`, which stays the move-and-collect
batch), the world editor, and the plan canvas extracted from the track
editor as the world editor was built on it. The adventure's DOM boxes stayed
out of it.

Phase 2 built 2026-09-23: the 3D library, named **render3d** rather than
§8's `scene` — *scene* is already the story's word, *world* now Knock it
down's — over three.js 0.186, vendored unminified (Q4's 2.1 MB); *Roll a
ball* (`rollball`, heart `config/level.js`); and the level editor as a tile
painter on the plan canvas. What §6's traps came to:

- **Modules** (Q5): the façade and the game's own code are modules, last on
  the page; the blank page and every other template stay classic. The
  harness holds the order, and the index says `module: true`.
- **The shot**: `preserveDrawingBuffer`, and read back lit in a WebGL
  browser.
- **Drawing-buffer size**: the façade sizes it and never the CSS. ⚠️ A trap
  §6 missed: the buffer *is* the canvas's `width` and `height`, which
  `Screens.fit` reads the shape from — so `fit` runs once, before `start`.
  Said in the note and held by a test; a second library that grew a
  `fit`-like read would walk into it too.
- **The look axis** was never needed: a follow camera and a stick are enough
  for a maze. Phase 3's first-person maze is where pointer lock would start.
- The ball's rolling is the game's own, not the physics library's: a circle
  on a grid is a few lines, and a 2D engine under a 3D game would be a
  second thing to agree with the picture.

Left, on purpose:
- **Pics' sections** (`pics-hear.js:116–150`) stay hand-named for the two
  types that have them; a `kinds` hook is worth it at the third.
- **`arc.js`'s fallback** is `ARCS.arcade` with *What is it?* in front, which
  is deliberate and documented — not the smell §1b took it for.
- **Directories per type** (`public/types/<key>/`): with the hooks on the
  registry entry and the words in the index, a new type is one registry
  entry, one index entry and its own two modules. The directory move buys
  little more.
- **The preamble does not say when a held library's tag is missing** from
  `index.html` (§4.1 proposed it). A person who adds physics to a racing game
  is told by the toast to ask the builder; nothing tells the builder on its
  own. Worth building if that toast turns out to be missed. With render3d it
  matters more: a classic game given the 3D library needs its own code
  turned into a module, which is more than a tag.
- **Models**: `.glb`/`.gltf` are served and uploaded to `assets/models/`,
  but nothing loads one. That wants three.js's `GLTFLoader` (in its
  `examples/jsm`, with its own imports) vendored into render3d and a
  `Render3D.model(path)` — a version bump that keeps the law.

*Add a file* offering physics to a game without it, the one commit it
makes, and the choice going away after were shown in a browser on
2026-09-23.

## 0. The short version

Both registries already exist and both are the right shape:
`public/studio-lib/index.json` for libraries, `public/game-templates/index.json`
plus `public/game-types.js` for types. What the spec says about each — a library
adds no orchestrator edit; a type is registered in one place — is true of the
*mechanism* and not yet of the *surroundings*: a seventh library still touches
six `index.html` files and one hard-coded block in the orchestrator, and a sixth
type still touches about fourteen files, nine of them the same three lines
copied again (§1).

Three foundation moves, none of them about any genre, would make a library a
directory and a type a directory, and they are what "civilized" costs:

1. **Optional libraries.** Today every game gets every library. A 3D engine in
   every quiz is the one thing that must not happen, so `index.json` learns
   which libraries are the **core set** and which are **extras** a template or
   a person asks for (§4.1).
2. **A type is one module.** Editors, arc, preamble paragraph, picture kinds
   and the client's load/park/changed hooks, declared once per type and read
   generically by `main.js`, `stream.js`, `files-tab.js`, `pics-hear.js`,
   `arc.js` and the orchestrator (§4.3).
3. **An editor kit.** The load/etag/park/stale/save/409 plumbing that five
   config editors each carry their own copy of, plus the "plan canvas" the
   track and adventure editors both hand-rolled — extracted once, so a world
   editor and a level editor are the drawing and the checks and nothing else
   (§4.4).

Then 2D physics before 3D (§5): it is canvas, it reuses every existing library
unchanged, its editor is the track editor's shape, and none of the 3D-only
traps (§6) apply. The two decisions that shape everything are whether an
engine is written here or vendored in (§7, Q1) and whether a helper may add a
library or only a person (Q2).

## 1. What is there today, measured

### 1a. Libraries

Six libraries, 187 KB per game (`screens.js` alone 60 KB, its four typefaces
60 KB more), every game holding all six — `installMissing` in
`server/files/library.js:43` loops the whole index and there is no
per-game selection. Held version in `studio/studio.json`; the sweep raises
under the compatibility law; a helper reads and never writes (`isLibraryPath`,
`paths.js:26`); the API note is the top comment of `studio/<name>.js`, read
from the game's own copy and cut at `NOTE_BYTES = 4096`
(`orchestrator.js:473`, `buildLibraryNotes` :489–509, which finds the file
**by the convention `studio/<name>.js`** at :502 — so a library's note-bearing
file must carry the library's name).

What is generic today, needing no edit for a seventh: `library.js`,
`bin/sweep.js`, `buildLibraryNotes`, `libraryLines`, and one test —
`orchestrator.test.js:417–432` iterates the index and holds every note under
the cap.

What is hard-coded, and would be edited for a seventh:

| where | what | lines |
|---|---|---|
| `orchestrator.js` `shapeLines(held)` | one `held.has('<name>')` block per library, five of them; achievements has none and its contract is preamble prose instead | :138–184; :257, :266–267, :275–279 |
| six `game-templates/*/index.html` | a literal `<script src="studio/<name>.js">` block each, the blank page included | e.g. `racing/index.html:22–28` |
| `test/<name>-template.test.js` | one per library, each with its own path | six files |
| `test/orchestrator.test.js` | the shape lines asserted as literal text; three libraries installed by hand | :884–927 |
| `test/api-projects.test.js` | byte-compares for `input.js`, `sound.js`, `sprites.js` by name | :60–71 |
| `test/library-sweep.test.js` | `{ input: 1 }`, `added.includes('screens')` | :83, :92–93 |

Two rules are worth restating because 3D and physics both lean on them: a
library **carries its own words** (the `what` in the index, the note in the
file) except for its shape line, which the studio carries for it; and a
library's `files` may already include **third-party bytes under their own
licence file** — the screens library ships Space Grotesk and Space Mono with
`fonts-license.txt` beside them (spec/06-studio-library.md, "It carries its
own typefaces"). That is the precedent for a vendored engine.

### 1b. Types

A template is a tree under `public/game-templates/<key>/`, copied whole at
creation; its key becomes `projects.type`; the type decides editors
(`game-types.js`), the arc (`arc.js`), a preamble paragraph
(`orchestrator.js:351–403`), which picture kinds Pics shows
(`pics-hear.js:116–150`), and how the studio reloads and parks the editor's
file. Five types; three with an editor of their own (Write, Scenes, Track),
the quiz's a form reached under Code, the arcade's none.

What is generic today: `server/files/templates.js`, `routes/projects.js`
(creation, `typeFromTree`, fork, `arcFor`), New game in `dialogs.js`,
`renderModes` in `chat.js`, `renderModeBody` in `main.js:1316`, and the
opening default `editorsFor(type)[0]`.

What a sixth type touches today, from the map:

| where | what | lines |
|---|---|---|
| `game-templates/index.json` + `<key>/` tree | title, what, heart, scheme; the game | — |
| `game-types.js` | an import and a `GAME_TYPES` entry | :23–26, :28–61 |
| `arc.js` | an `ARCS` entry; ⚠️ the fallback arc is `ARCS.arcade` by name | :77–270, :272 |
| `orchestrator.js` | a `project.type === '<key>'` paragraph; none exists for quiz or arcade | :351–403 |
| `<key>-editor.js`, `<key>-form.js` | the model and the interface | new |
| `main.js` | imports; a state slot; leave-project save/park; `S.x = null` on switch; load on open; the rail inspector if-chain; `?scene=`-style URL state; beforeunload save | :23–30, :114–121, :620–627, :714–719, :847–853, :864–866, :969–971, :1254–1260, :1491–1492 |
| `stream.js` | a `files.changed` branch per editor file | :432–435 |
| `files-tab.js` | the `inEditor` chain that opens the heart as plain text under Code | :311–314 |
| `dialogs.js` | a fourth near-identical 409 conflict dialog | :1577–1622 |
| `pics-hear.js` | sections built from the editor's model | :116–150 |
| tests | `modes.test.js:36–43`, `ui/narrow.ui.js:24`, `api-projects.test.js`, `orchestrator.test.js:792–844`, a new `<key>-template.test.js` re-declaring `read`/`code`/`scripts` (no shared helper — `test/helpers.js` is server harness only) | — |
| `spec/06`, GLOSSARY | the record | — |

⚠️ The rail is the one place the registry does not reach: `renderInspector`
(`main.js:1254`) is an if-chain on editor id, so an editor registered in
`game-types.js` gets a centre pane for free and no rail.

Two things the map found that are not about count. First, the server has one
**type-specific route surface**: `routes/story.js` and `server/story.js`, the
visual novel's *fill* and *stand-in* microhelpers, registered in `app.js`.
Nothing equivalent exists for the other types, and a physics or 3D type may
want one ("make me a level"). Second, the studio has **two kinds of editor
and two registries**: *type editors* (Write, Questions, Scenes, Track — by
`projects.type`, one heart file each) and *file editors* (the pixel editor for
a `.png`, the sound editor for a `.wav`, the config form, the quiz and controls
forms — by path, dispatched in `files-tab.js:311–332`). "Mini-app" means the
first kind here; a viewer for a 3D model would be the second.

### 1c. The editor pattern that has stabilised

Five editors have converged on one shape, and it is worth naming its parts
because the next two want exactly it:

- a **model module** (`track-editor.js`): the heart's path; `xModel(text)`
  through `parseConfigFile` — never executed — declining with a reason when
  the file has grown; `xText(model)` regenerating the whole file with the
  template's comments, byte-identical on an untouched save; the geometry;
  the **checks**, which are what only the whole structure can say and the
  reason it is an editor rather than a form. Pure, shared with `npm test`,
  importable by the server (`arc.js`, `achievement-shape.js` already are);
- a **form module** (`track-form.js`): `loadX` (fetch, etag, the parked copy
  put back while the etag matches), `parkX`, `xChanged` (stale on a
  `files.changed`), `saveX` (`if-match`, a 409 dialog), the whisper, *Show the
  text*, *Try it*; the rail inspector for the selected thing; the **guide**
  where one fits (the story's, the adventure's);
- a **template test** holding the game to the shape: registration, the studio
  calls in their places, no size css of its own, script order, verbs bound,
  achievements over moments the game says, numbers and words in `config/`,
  the shipped heart read clean by the model.

The config grammar (`config-file.js:1–17`): `const NAME = value;`, values
being numbers, strings, booleans, null and arrays or objects of those, nested
without limit, with a comment per value; no identifiers, arithmetic or
template literals. A physics world as an array of body objects and a 3D level
as rows of strings both fit it as it is.

## 2. What 3D and 2D physics ask for

The same five things, and then one each.

**A library each, and both are extras.** An engine is cross-genre — a
platformer, a knock-down game and a pinball table all want the same physics;
a maze, a racer and a ball all want the same renderer — so both are libraries
by the existing rule (genre mechanics belong to the game; libraries stay
cross-genre, ideas/templates.md). Neither belongs in a quiz. So both need the
library mechanism to grow one notion it lacks: a library a game *opts into*.

**A template each**, a first game that is the *shape of a game* written out
for that engine the way the arcade and racing templates are for canvas — so
a helper starting from it does what the note asks rather than being told to.

**An editor each**, over a config heart, earning its place by its checks: a
body outside the world, a tower with nothing under it, a level with no way to
the goal, a scene too heavy for a phone.

**The studio shell stays engine-free.** The story editor's stage is drawn by
the studio and the track editor draws the track itself, both in canvas 2D.
A 3D level editor that renders 3D would put the renderer in the studio's own
page — 650 KB in the shell, the studio learning an engine, and a second
renderer to keep agreeing with the game's. The alternative is the pattern the
studio already has: **the studio draws the plan, the game draws itself** — a
top-down plan view in the editor, and *Try it* reloading the preview, where
the template's own code renders the level (the game as the renderer of
record, ideas/racing-template.md's "Try this track" taken one step further).
Recommended for both; for physics the plan *is* the world, since it is 2D.

**Both engines change behaviour when they change**, which is the compatibility
law's blind spot: a bump "runs every game that ran N" and still plays a tuned
tower differently. §4.2 and Q3.

Then, one each:

**2D physics** wants gravity, circles and boxes (polygons later), still and
moving bodies, bounce and friction, collision events, and a fixed timestep so
a phone and a laptop agree. Its editor is a plan you drag shapes on — the
track editor's gestures exactly. Everything else the studio has applies
unchanged: `Sprites.draw` at a body's position, `Moments.say` on a hit,
`Screens.fit` on the canvas, `Input` feeding a force. The *shot* works.

**3D** wants a renderer, a camera, lights, primitives and (later) models; a
canvas whose drawing buffer is sized from `Screens.fit`'s CSS box times a
capped device pixel ratio; an asset kind and mime types the studio does not
have (§6); a *look* axis `Input` does not have; and a way for the *shot* to
see a WebGL frame (§6). Its first editor is a plan view over a tile map,
which is the map editor ideas/templates.md already wants for the
move-and-collect template — two templates, one editor family.

## 3. The engine question, stated before the architecture

Everything in §4 is engine-agnostic. But the choice colours §5, so it is here.

**Write it here** is the studio's instinct — web push is VAPID and
`aes128gcm` by hand rather than `web-push` off npm. It buys a kid-shaped API,
a note that fits 4 KB because there is nothing else, and no licence question.
It costs: a rigid-body engine with stable stacking is a few hundred lines to
write and a few hundred more to make towers not jitter (sequential impulses,
warm starting, sleeping); a WebGL renderer with a scene graph, lights, a
camera and textures is a couple of thousand lines and glTF loading is another
project. And it costs the helper its fluency: DeepSeek knows three.js, Box2D
and matter.js cold and would learn a bespoke engine from a 4 KB note, which
is exactly the failure mode the API note cap exists to bound.

**Vendor it** follows the fonts precedent: the engine's file and its licence
text beside the studio's own façade, all three in the library's `files`. It
buys correctness and fluency. It costs: a definition — GLOSSARY says a
*studio library* is "the studio's own code", which widens to "…and what it
carries with it, under its own licence file"; size — a game's repository
grows once by the engine (fine against the 10 MB file cap and 200 MB project
cap, and only for games that asked); and a *surface the note cannot close* —
a fluent helper will reach past the façade into `THREE` whatever the note
says, so the note has to say the engine is there and that the game's own code
may use it, rather than pretend otherwise.

What the engines look like — planck and three.js measured from their npm
tarballs on 2026-09-22, the rest still from memory:

| | shape | build | ≈ size | note |
|---|---|---|---|---|
| matter.js | 2D rigid bodies, MIT | UMD, classic `<script>` | ~85 KB min | simplest API, DeepSeek fluent; stacking jitters, tunnels at speed |
| planck.js | Box2D in JS, MIT | UMD, classic `<script>`, global `planck` — **measured** 1.5.0 | 297 KB min, 55 KB gz | robust stacking and joints; a Box2D-shaped API, verbose without a façade |
| three.js | 3D renderer, MIT | ⚠️ **ES module only** — **measured** 0.186: `three.cjs` is a deprecation shim, no UMD, and npm ships no `.min` | 2.1 MB unminified (`three.module.js` 663 KB + the `three.core.js` it imports 1.46 MB), 420 KB gz | the default 3D on the web; DeepSeek fluent |
| Babylon.js | 3D engine, Apache | UMD | ~4 MB | too big to copy into a tree |
| bespoke 2D | circles + boxes, impulses | classic | ~30 KB | ours; towers are the risk |
| bespoke 3D | primitives, lights, one camera | classic | ~60 KB | ours; no models, no shadows, a long tail |

Whatever is picked, **the façade is the library and the engine is a file it
carries**: `studio/physics.js` is the note-bearing file (the `studio/<name>.js`
convention), `studio/planck.min.js` and `studio/planck-license.txt` ride in
`files` beside it. The façade is where the config heart is built into bodies,
where `Moments` are said on hits, where the fixed step lives, where a WebGL
context gets `preserveDrawingBuffer`. The note documents the façade and names
the engine underneath in one line.

My recommendation, held loosely: vendor both — planck for physics because a
tower that stands still is the whole genre and stability is the hard part;
three.js for 3D because a bespoke renderer is a second studio. If the answer
is "write it", physics is the one to write (a circle-and-box impulse engine
is tractable and the editor wants a small shape anyway) and 3D is still
vendored. Q1.

## 4. The architecture: five moves

### 4.1 Optional libraries — the core set and the extras

The smallest change with the largest effect, and a prerequisite for both
engines.

- `studio-lib/index.json`: each library gains `core: true|false`. The six
  today are core. A physics or 3D library is an extra.
- `installMissing(dir, publicDir, { seedFrom, want })` installs
  **core ∪ held ∪ want**: every core library the game lacks, every library
  the manifest already holds (raised to current), and the extras named in
  `want`. The sweep passes no `want`, so it raises what a game holds and adds
  only core — one line changes in `library.js:43`.
- `game-templates/index.json`: a template gains `libraries: ["physics"]`, the
  extras it is born holding. Creation passes them as `want`. The blank page
  loads core only, as it does today less input.
- **Adding an extra to an existing game** is a person's action, the way
  installing the library was always a person's: under Code, beside *Add a
  file*, `+ Add a studio library…` — a dialog listing the extras not held,
  each with its `what` from the index, one commit ("added the physics
  library"). The `<script>` tag stays the page-writer's job as the spec says
  — but the preamble can now *say* when a held library's tag is missing from
  `index.html`, which is a check the orchestrator can make from the tree and
  today does not. Q2 asks whether a helper should be able to do this through
  a tool; §4.1 builds the dialog either way.
- No removal in v1: a held extra costs one note in that game's preamble and
  its bytes, and taking one out of a game whose code calls it is a broken
  game nobody asked for.
- Tests: `library-sweep.test.js` gains "an extra is not installed unless
  held or asked for" and "a template's extras land at creation";
  `api-projects.test.js:60–71`'s three literal byte-compares become one loop
  over the core set.

What this protects beyond disk: the **prompt**. A held library's note and
shape lines ride every fire's system prompt for that game; optionality means
a visual novel never pays for a renderer it does not have, and the cache
prefix of forty-three existing games does not move when the seventh library
lands.

### 4.2 A library carries all its own words, and its version posture

- The **shape line** moves into the index: `shape: ["…", "…"]` per library,
  and `shapeLines(held)` becomes a loop over the manifest reading it — the
  last hard-coded block in the orchestrator goes, and api-notes.md's principle
  ("a second library teaches every helper about itself with zero orchestrator
  edits") is finished rather than mostly true. `orchestrator.test.js:884–927`
  then asserts assembly (a held library's shape present, an unheld one's
  absent) generically. Achievements gets a shape line at the same time, since
  today its contract is prose the block does not know about.
- **A vendored engine's version is part of the library's name, not its
  version integer.** The compatibility law already says a breaking change is
  "a new library under a new name": so `physics` *means* planck 1.x, its
  integer version counts façade changes that keep the law, and a move to an
  engine that plays differently is `physics2`, which no sweep ever installs
  into a game that did not ask. One mechanism, no `hold` flag, and the sweep
  stays what it is. The cost is a second library name in the fleet when that
  day comes; the fleet is small. Q3 asks whether you would rather have a
  per-game hold.
- GLOSSARY *studio library* widens by one clause to admit carried bytes under
  a licence file; the fonts already needed it.
- A generic library test to go with the note-cap loop: every `files` entry
  exists under `studio-lib/<name>/`, `<name>.js` is among them, every
  `scripts` entry names a file in `files` or a seed, `version ≥ 1`, and a
  licence file is present beside any file not written here (a `vendored`
  list in the entry, or the convention that any `.min.js` needs one).

### 4.3 A type is one module

One directory per type, two files, mirroring the split the editors already
keep:

```
public/types/racing/
  shape.js    pure: heart, isPath, model(text), text(model), checks, arc,
              brief (the preamble paragraph), kinds(model, files) for Pics,
              tryQuery (the ?scene= / ?track= the preview takes)
  editor.js   DOM: editors [{ id, label, what, render }], inspector(),
              load/park/changed/save, the guide
```

- `game-types.js` becomes the list of modules and nothing else;
  `editorsFor`, `modesFor`, `hasEditor` keep their signatures.
- `main.js` iterates: leave-project calls every registered editor's
  `save`-if-dirty-then-`park`; opening calls every held editor's `load`;
  `renderInspector` asks `editorShowing()?.inspector?.()` before falling
  through to the pick inspector and the summary; the URL state
  (`?scene=`) becomes the editor's `viewState`/`applyView` pair; the
  beforeunload save iterates too. Nine hand-edited spots become one loop
  each.
- `stream.js:432` becomes: for each held editor whose `shape.isPath` matches
  a changed path, call its `changed`. `files-tab.js:311` asks
  `editorsFor(type).some(e => e.shape.isPath(path))`. `pics-hear.js` asks
  each held editor for `kinds(model, files)` and renders the sections it
  returns (Characters/Places, Places/Things; the racing type returns none,
  as today).
- The orchestrator imports `shape.js` for `brief` and `arc` — the server
  already imports `public/arc.js` and `public/achievement-shape.js`, and the
  ⚠️ rule that makes it safe holds: `shape.js` touches no `document`, ever, and
  a test imports every type's `shape.js` under Node to prove it. `arc.js`'s
  `ARCS` table dissolves into each type's `arc`, with the shared stamps
  (`LOOKS`, `PLAYED`, `OUT`, `WHAT`) staying in `arc.js` and the fallback for
  a typeless game named there as its own arc rather than as `ARCS.arcade`.
- `game-templates/index.json` stays the New game dialog's manifest and the
  validation list (title, what, heart, scheme, and now `libraries`); the
  module holds code. Two files per type that must agree on `heart` — one test
  holds them together, the way `schemes.test.js` holds the two scheme lists.
- The four 409 dialogs in `dialogs.js:1577–1622` become one, parameterised by
  the editor (§4.4).
- Tests: `modes.test.js` and `ui/narrow.ui.js:24` derive their type table
  from the registry; the orchestrator's three per-type preamble tests become
  one loop asserting every registered type's `brief` appears for a game of
  that type and no other's does.

A type-specific *server* surface — the story's fill and stand-in routes — is
left where it is. If a second type wants a microhelper, `shape.js` is where
its prompt and caps would be declared and `routes/story.js` is the pattern to
generalise then, not before.

### 4.4 The editor kit

Two extractions, both from code that exists in three to five copies.

**The config editor plumbing.** From `story-form`, `adventure-form`,
`track-form`, `quiz-form`, `achievements-form`: a `configEditor({ file,
model, text, save: 'auto' | 'explicit', debounceMs })` returning
`{ load(slug), park(), changed(paths), save({ force }), state }` that owns
the fetch and etag, the parked map per slug, the stale flag and its `say`, the
dirty flag, the debounce for auto-save, the `if-match` PUT and the one 409
dialog, the whisper, *Show the text* (save first, then open as text), and
*Try it* (save first, then reload the preview at the type's `tryQuery`). The
rail inspector, the guide and the drawing stay the type's. Port the track
editor first — the newest and the one with explicit Save, so both modes are
exercised — then the adventure; the story, quiz and achievements when next
touched.

**The plan canvas.** From `track-form` (handles on a world) and
`adventure-form` (boxes on a picture): pointer-to-world mapping through the
box the browser drew, handles a thumb's size on screen whatever the scale,
selection, drag by the middle and resize by a corner, add-on-click, Delete
never below the minimum, the redraw from the unsaved model, and the ⚠️ 16px
and no-sideways-scroll rules at 390px that `npm run ui` checks. A
`planCanvas({ world, draw(ctx, model, selected), hitAt(model, x, y), on: {
move, resize, add, remove, select } })`. The physics world editor is this over
bodies; the 3D level editor is this over tiles; the move-and-collect map
editor on TODO is this over tiles too.

**A template test harness.** `test/templates.test.js` iterating
`game-templates/index.json` for the contract every template test re-declares
(§1c): registration and heart, the shape calls, no size css, script order with
`js/<game>.js` last and no hand-rolled HUD, verbs bound by whatever writes
`config/controls.js`, achievements over said moments, config files parsing,
and — new — every extra the template declares having its tag on the page. Each
`<type>-template.test.js` then holds only what is that template's alone (the
racing one's *KINDS drawn by the game*, its sounds carrying their note).

### 4.5 Asset kinds and mime

Small, and 3D cannot start without it.

- `server/http/static.js:9–39` gains `.glb`, `.gltf` (`model/gltf-binary`,
  `model/gltf+json`), `.bin`, `.obj`, `.mtl`, `.hdr`, `.ktx2`. Today an
  unknown extension is served as an attachment; a loader's `fetch` still reads
  it, so a model *would* load, but a direct visit downloads it and the studio
  cannot show it. `.wasm` (`application/wasm`) only if an engine needs it —
  `WebAssembly.instantiateStreaming` refuses the wrong mime — and a pure-JS
  engine is preferable for exactly this reason.
- A fifth asset folder, `assets/models/`, in the preamble's folder list
  (`orchestrator.js:208–218`), in `upload.js:55–75`'s guess (decided by
  extension, since a model has no shape to measure), and named — not shown —
  under Pics, or under a *Things* section with a cube where a thumbnail would
  be. Textures are pictures in `assets/images/` and the pixel editor makes
  them; 256 a side is the low-poly look, not a limitation.

## 5. Build order

**Phase 0 — foundations, no new genre.** Each its own commit with its tests;
kids see one new button (`+ Add a studio library…`) and nothing else moves.

1. Optional libraries (§4.1). Small: `library.js`, two index files, the
   dialog, three tests.
2. Shape lines into the index; achievements' line; the generic library test
   (§4.2).
3. Mime and `assets/models/` (§4.5).
4. The config editor plumbing, proven on the track editor, then the
   adventure (§4.4).
5. The type module: the racing type ported first as the shape, then the other
   four; `main.js`, `stream.js`, `files-tab.js`, `pics-hear.js`, `arc.js`
   and the orchestrator made to iterate (§4.3). The largest step and the one
   that touches `main.js`; ⚠️ it wants `npm run ui` run by a person after, since
   the mode row, the rail and the 390px layout are what it moves.
6. The plan canvas, extracted from track and adventure (§4.4).
7. The template test harness (§4.4).

**Phase 1 — 2D physics.** The library (façade over the engine of Q1;
`config/world.js` built into bodies; fixed step; hits as moments; `Sprites`
drawn at bodies), the template — working name *Knock it down*: a slingshot,
a tower, a goal; heart `config/world.js`; `config/play.js` for gravity,
bounce, shots — the **world editor** (plan canvas over bodies: drop a box, a
ball, a plank, a still block; drag, resize, rotate later; gravity and bounce
as sliders; checks: a body outside the world, a moving body over nothing
forever, no goal, more bodies than a phone should carry), its arc (*It
falls!* → *It knocks!* → *It's a puzzle* → looks → feels → fair → played →
out), its `brief`, tests, GLOSSARY, spec/ §6. Why first: canvas 2D, every
existing library applies unchanged, the shot works, no module question, and
the editor is the track editor's gestures over different things.

**Phase 2 — 3D.** The vendored renderer as an ES module (§6 on what that
changes), the façade (`Scene3`? — Q7) creating the context on the template's
canvas with `preserveDrawingBuffer: true`, sizing its buffer from
`--screens-fit-*` times a capped ratio, offering box/ball/ground/light, a
follow camera and a pick; the template — working name *Roll a ball*: a ball on
a tile floor with walls, ramps, coins and a goal; heart `config/level.js` as
rows of characters with a commented legend, which is the move-and-collect
heart from ideas/templates.md verbatim — the **level editor** (plan canvas as
a tile painter; heights as a letter; checks: no start, no goal, a goal the
ball cannot reach, a level too big for a phone), a `stick-buttons` scheme
with no look axis so it plays on a phone from day one, its arc, `brief`,
tests, GLOSSARY, spec/ §6. The tile painter is then also the move-and-collect
template's editor, which closes that TODO line's hardest half.

**Phase 3 — the second game in each family**, which is the test of the claim
that a type is cheap now: a bouncy platformer on the physics library; a
first-person maze on the 3D one, which is when the *look* axis and pointer
lock get built in `input.js` (Q6).

## 6. Traps, each written down once

- ⚠️ **ES modules in a game page.** three.js has no classic build, so the
  façade is a module (`<script type="module">`) that sets `window.Scene3`, and
  the template's own `js/` must either be a module too or wait for a ready
  event. Module scripts run after parsing, so the classic globals (`Input`,
  `Screens`, `CONTROLS`) exist by then and the load-order rule "controls
  before input" still holds for the classic libraries; but the template test's
  "js/<game>.js last" and the blank page's tag list both assume classic
  scripts, and `buildLibraryNotes` reads a `//` run at the top of the file,
  which a module still has. The blank page stays classic; only templates that
  hold the 3D library go module. A decision, since it is a second way a game
  page can be shaped (Q5).
- ⚠️ **The shot from WebGL.** `reporter.js:141–167` draws the biggest canvas
  into a 2D scratch canvas; a WebGL canvas made without
  `preserveDrawingBuffer` reads back blank once presented, and the reporter
  knows and does not guard (:138–140). The façade sets the flag (a small
  per-frame cost on phones), or the reporter dispatches a window event before
  it draws and the façade renders one frame on it — the second is cheaper at
  runtime and is a two-line reporter change. Without either, `look_at_game`
  hands the helper a black square and calls it the game.
- ⚠️ **A tuned game plays differently after a sweep.** §4.2's answer: the
  engine version is in the library's name. The façade's own bumps keep the law.
- ⚠️ **The note cannot close a vendored surface.** The note says the engine is
  there; the game's own code may use it; the studio supports what the façade
  offers and looks at the rest. Written in the note and in the template's
  BRIEF, not policed.
- **The 4 KB note.** A façade with a dozen calls fits; screens fits fourteen in
  3.7 KB. Condense before raising the cap, as CLAUDE.md says.
- **Drawing-buffer size.** `Screens.fit` sets CSS size from the canvas
  attributes; a WebGL canvas also needs its buffer sized from the CSS box times
  `devicePixelRatio`, capped (2, or lower on a hot phone), re-run when
  `--screens-fit-*` moves. The façade's job, and the arcade's "no size css of
  your own" rule stays true for the page.
- **Determinism.** A fixed physics step with an accumulator, in the façade,
  so a laptop and a phone knock the same tower down the same way; the racing
  template's `dt` cap at 0.05 is the same lesson.
- **Phones.** Body counts and triangle counts are what the editor's checks
  say, in the studio's checks-never-gate posture: "more than 60 things on the
  table and a phone will crawl" is a sentence, not a refusal.
- **Expectations.** A kid hearing "3D" pictures Minecraft; what a plan editor
  over primitives in the game's four colours makes is a low-poly toy. That is
  the stand-in posture — a flat card in the look is a picture — and the
  template's words should set it: *Roll a ball*, not *A 3D world*.
- **The rail on a phone.** A plan editor and a rail of fields is the story
  editor's "two tall stacked things" question again (TODO). The track editor
  is the one to feel first, since it is built and unfelt.

## 7. Questions for you

Each with the default I would take if you say nothing.

- **Q1 — write or vendor, per engine.** Default: vendor planck for 2D physics
  and three.js for 3D, each behind a studio façade, licence file beside it
  (§3). The alternative I would take second: write the 2D engine here, vendor
  3D regardless.
- **Q2 — may a helper add a library?** Default: no — a person does it from the
  dialog; the helper is told when a held library's tag is missing and asked to
  add the tag. The alternative is a fifth tool, `add_library(name)`, whitelist
  only, going through `installMissing` and never a helper's bytes — it keeps
  the write-wall's reason (no forked engines) while letting "make my game
  bouncy" be one ask. Worth doing later if the dialog turns out to be the
  step kids stall on.
- **Q3 — how an engine's version is held.** Default: in the library's name
  (`physics` is planck 1.x forever; a breaking engine move is `physics2`), so
  the sweep and the law stay one mechanism. Alternative: a per-game hold the
  dialog raises. Alternative two: trust the law and accept a tower that falls
  differently.
- **Q4 — where 3D is rendered in the studio.** Default: nowhere — the editor
  is a plan view and the preview is the game rendering its own level. The
  alternative puts the renderer in the shell for a live 3D editor view, and I
  would not.
- **Q5 — module scripts in a game page.** Default: allowed for a template that
  holds the 3D library; the blank page and every other template stay classic.
  Alternative: a classic-build renderer, which today means an older three.js
  or writing one.
- **Q6 — which first game in each family.** Default: *Knock it down*
  (slingshot and tower; no scheme question, `one-button` or `swipe-tap`) and
  *Roll a ball* (tile floor, follow camera, `stick-buttons`, no look axis).
  The alternatives that were close: a bouncy platformer first for physics
  (wants the input library to feel a jump, and a longer level), and a
  first-person maze first for 3D (wants a look axis and pointer lock, and
  phones are hard).
- **Q7 — the working names in §8**, any of them.
- **Q8 — is a type still one template?** A 3D racer is a new template
  (`racing3d`), not `racing` plus a library: a type is what the editors key on
  and a track editor in 2D says nothing about a 3D track. Default: yes, one
  template per type, and templates are cheap once §4.3 is done. Say so if you
  would rather types compose.
- **Q9 — does Phase 0 go in before either engine, or does physics land on
  today's seams and the seams get fixed after?** Default: Phase 0 first, in
  the order given — the type module (step 5) is the one that hurts to do with
  seven types instead of five.

## 8. Working names — proposals, none coined

Every one of these is a question, not a glossary entry.

- **core library** / **extra** (or *optional library*): a library every game
  holds vs one a template or a person asks for. `core: true` in the index.
- **type module**: `public/types/<key>/{shape.js, editor.js}`.
- **editor kit**: the config editor plumbing (`configEditor`) and the **plan
  canvas** (`planCanvas`).
- **physics library** (`studio/physics.js`, global `Physics`?) and its heart
  `config/world.js` — ⚠️ `world.js` is already the config batch the preamble
  names for a move-and-collect map, so either the physics heart takes another
  name (`config/table.js`? `config/bodies.js`?) or the two stay one word and
  the shape tells them apart. **world editor**. **Knock it down**.
- **3D library** (`studio/scene.js`, global `Scene3`?) and `config/level.js`.
  **level editor**. **Roll a ball**.
- **façade**: the studio-written file that is a library's note and surface
  over a carried engine.
