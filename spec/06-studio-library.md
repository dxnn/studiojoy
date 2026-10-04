### The studio library

`studio/` is a reserved directory in a game's working tree holding the
studio's own **libraries**, described below — served, committed and cloned
like any other file. `studio/studio.json` is its **manifest**: library name
to the version this game has.

The **sound player** (`studio/sound.js`) is the second library, and proved
the shape: no orchestrator edit needed, since its API note is its own file
header — just the file and an `index.json` entry. `Sound.play("laser")`
plays `assets/sounds/laser.wav` (the sound editor's own files), so rapid fire
overlaps instead of cutting itself, plus `loop`/`stop`/`mute`. A missing file
or blocked autoplay is one console warning, never an error — a game must not
break over a sound.

⚠️ Since sound 4 a shot is a **Web Audio buffer**, fetched and decoded once
per name, and a loop is still one streamed `<audio>` element. A shot used to
be a pooled element each — a new one loading its file again, every `play()` a
trip through the media stack, which is what iOS is known to stall on — and on
an older iPad Doki Doki froze for about a tenth of a second per star picked
up, worst when several came at once (2026-09-29; seen, not profiled). A loop
stays an element because it is usually music, and three minutes decoded into
memory is tens of megabytes.
Web Audio starts only from inside a press, so every press wakes it, and
`navigator.audioSession.type = "playback"` keeps an iPad in silent mode
sounding the way `<audio>` always did. The element pool is kept only for a
browser with no Web Audio. ⚠️ Not yet heard on a real iPad.

The **sprites library** (`studio/sprites.js`) is the third. One sprite is one
file: `Sprites.draw(ctx, "hero", x, y)` draws `assets/sprites/hero.png`. A PNG
whose width is a whole multiple of its height is a **strip** — square frames
cycled by a shared clock (`Sprites.tick()`, 8 fps unless the call overrides;
`frame` pins one, `scale`/`flip` transform, `frames` overrides the count for
a non-square strip). No registry, no config — the picture's shape says
everything, same name-is-the-file rule as sound (why not a packed sheet:
spec/alternatives.md). The file is the unit of naming, versioning, diffing
and thumbnailing — a kid edits `hero.png`, not a cell in a sheet. Loading
draws nothing; missing warns once.

A strip opens in the pixel editor **one frame at a time**: frame buttons, a
live preview looping the whole strip at 8 fps, Copy/Paste frame (through
`setPixel` like every tool, so undoable), and a toggleable **ghost** — the
previous frame at quarter strength, wrapping so frame one ghosts the last.
Every tool is clipped to the open frame by one shared bounds check (`inside`
in pixel-editor.js), so a brush can't spill into the neighbour and a fill
can't leak across the strip; undo jumps to the frame it changed. "Whole
strip" draws across all frames at once, frame boundaries shown as a
display-only overlay. `+ Draw a picture` offers the frame count that makes a
strip.

The **screens library** (`studio/screens.js`) is the fourth, and the first
presentational one: `Screens.fit()`, `Screens.hint()`, the phone-fit
`Screens.title()`, and the `Screens.chips()` HUD strip. Seven decisions worth
stating.

**How big the game is on the screen is the studio's answer, not the game's.**
`Screens.fit(el)` takes the game's shape from its canvas's `width`/`height`
attributes and gives it the smallest of three widths: what it is worth at
most, what the window is wide, and what the window's *height* can pay for at
that shape. Left to each game it was written as width alone — twice, in the
two games that had one — and a fixed 8:5 rectangle at 96vw of an 852pt window
is 818 across and so 512 tall, in 393pt of height: the top and bottom of the
game off the screen on a phone held sideways. ⚠️ It writes the size **inline**,
the one place the library overrules a game rather than yielding to it, because
the rule it replaces is normally `#wrap { width: … }` and no rule this file can
write beats an id. A game that wants a different answer does not call it.
⚠️ The height term is `100dvh` with a `100vh` line before it: on iOS `100vh`
is the window with the toolbars *gone*, which the browser only honours once
you scroll, and a game never scrolls. The older line survives in a browser
that cannot parse `dvh`, because the CSSOM drops a value it cannot read
rather than throwing. ⚠️ And the page is left exactly one toolbar scrollable:
`fit` writes `padding-bottom: calc(100lvh - 100dvh)` and
`box-sizing: content-box` inline on the root, because iOS hides its bars only
when the page scrolls, and a page that fits the small window to the pixel
never does — a sideways phone was playing in two thirds of its screen.
Padding under the body rather than height on it, so the game stays centred in
the visible window before the swipe; `dvh` rather than `svh` in the
subtraction, so the slack is gone the moment the bars are, or the game would
scroll off the top by the same amount; `content-box` because every game's
reset says `border-box`, under which the page's `html { height: 100% }` would
shrink to make room. Zero wherever the toolbars stand still — a desktop, the
preview, an installed app — and dropped whole by a browser too old for `lvh`.

The height the game does *not* get is added up — the page's padding, the
game's own margins and frame, and every sibling sharing its parent, skipping
anything positioned out of the flow. ⚠️ Not subtracted from the page's height,
which looks like the same sum and is not: a page with `min-height: 100vh`
reports the window's height whatever is on it, so the subtraction moves with
the game's own size and never settles. And ⚠️ the page around a game is not
all there at boot — one game's scene-name line is an empty `div` until the
first scene loads, and the 27px it then takes came out of the game — so a
`ResizeObserver` on the parent re-runs the sum. It cannot chase its own tail:
the width depends on the *siblings*, which resizing the game does not change.

**Only a game with a fixed shape needs it.** Of the 20 canvas games the day
`fit` landed, 17 already set `canvas.width` to the window and redraw on
resize; they are fluid, were never cut off, and `fit` — which needs a shape
to preserve — has nothing to say to them. Three had a fixed rectangle, and
all three were cut off on a phone held sideways.

**The HUD goes in the letterbox band above the game when there is one.** Once
`fit()` has said where the game is, `chips()` places the row against it —
above it when the band can hold the row, over the top of the game when it
cannot, which is the desktop case. A chip's value may be a number, a **meter**
(`{ value, max, text }`, a bar beside the number), or a node the game built
itself, which the strip places once and never touches again; the key is both
the label and, by its place in the object, the chip's place in the row.
⚠️ Placement measures the row, so it must never run in the per-frame path: it
runs when the row gains or loses a chip, when the window or the game moves,
and when a `ResizeObserver` on the row itself reports it can be measured
again — the case a screen closing creates, which the library cannot otherwise
hear about when the screen is the game's own.

**Every injected rule weighs exactly one element selector.** `injectStyle()`
appends a `<style>` after the game's own `<link>`, so at equal specificity
the library would win every tie — unless every rule is written
`body :where(…)`, which contributes zero specificity and puts the whole
sheet at 0-0-1:

| the game's rule | weight | who wins | why it matters |
| --- | --- | --- | --- |
| `.screens-name { … }` | 0-1-0 | the game | it meant this |
| `button { … }` | 0-0-1 | the library, by being later | its page style should not eat the Start button |
| `* { margin: 0 }` | 0-0-0 | the library | a reset is not an opinion about a title screen |

⚠️ **A styling contract is only tested against a stylesheet that did not
expect it** — two earlier designs failed here in ways a harness page with no
reset never showed (spec/alternatives.md).

The library's variables are the deliberate exception, declared at
`:where(:root)` (specificity zero) so a game's own `:root` replaces a default
instead of fighting it. ⚠️ The four `LOOK` colours are the other exception —
set inline on the screen node, from the game's own `config/look.js`, and
beat any stylesheet; where `LOOK` names nothing, the default stands.

**Its default is the studio's form in the game's colour.** The four `LOOK`
names carry the colour; the shapes — halftone dots, a hairline, a panel
card, a glowing pill button, tabular-figure numbers — are the studio's own,
a fallback rather than white-on-black since most games haven't picked
colours yet. ⚠️ Gold is policed here as everywhere: the game-over score, a
board score, a chip value that is a number, a meter's fill, nothing else. A
chip's value is not always a number — `Guns · Cannon` in gold is the colour
losing its meaning — so a value with no digit in it takes the reading face and
the reading ink instead. Every chip in the fleet the day that rule landed had
a digit in it, so it changed nothing anybody could see.

**The title screen takes the focus only from a game that already has it.**
`title()` focuses its Start button when `document.hasFocus()`, and otherwise
leaves the focus where it is. ⚠️ The preview reloads the game on every write,
and a cross-origin frame that calls `focus()` on load takes the keyboard from
the page around it — measured in Chromium on 2026-09-28: a field in the studio
lost the next keystrokes to the game. A game being played keeps the focus
across a reload, because the frame is still the focused element, so the new
document has it too. Nothing is lost either way: Enter and Space start the game
through a listener on `window`, not through the focused button. Screens 15.

**It carries its own typefaces.** Space Grotesk and Space Mono (OFL 1.1,
`studio/fonts-license.txt`), four `.woff2` files beside the library — ~60 KB,
of which an ASCII page fetches 41 KB via Google's own `unicode-range` (why
not a font host: spec/alternatives.md). ⚠️ A relative `url()` in an injected
`<style>` resolves against the document, not the script, so paths are
derived from `document.currentScript.src`.

The library also carries **snippets**: pieces of a screen it builds and the
game places. `Screens.board()` is the scoreboard — calls `/_scores` itself,
marks the given rank, brackets a rank past the shown rows with the four
either side, numbered where they really are. `Screens.rows()` is a
label-and-value list, `Screens.signin()` is who's playing or the catalog
link, and `Screens.me()`/`Screens.post()` back them. `title({ score, post:
true, board: true })` is the whole game-over dance in one line — what every
game was writing by hand. Signed out, the post answers 401 and offers the
sign-in link instead of a name box (§6).

The **moments library** (`studio/moments.js`) is the fifth, and smallest.
`Moments.say("name", value)` validates the name (slug-shaped, ≤ 40) and value
(number, text ≤ 100, or nothing = `true`) and dispatches one
`CustomEvent("moment")`; anything outside the shape is a console warning and
dropped, so saying one every frame is safe. `Moments.on(name, fn)` is sugar
over `addEventListener`. The DOM event *is* the bus — the *reporter*,
injected before any library loads, hears every moment without the library
existing, and so can anything later (§8). Publishing is the game's; nothing
here knows what an *achievement* is.

The **achievements library** (`studio/achievements.js`) is the sixth. On load
it reads `config/achievements.js`, asks `/_achievements/<slug>` once for what
the player already holds, and subscribes to every moment a rule names. When
a rule is first met — or `Achievements.unlock("id")` is called — it posts
the unlock and shows a toast: DOM like Screens, the game's `primary`/`accent`
and ⚠️ never its `highlight` (gold stays a number). Signed out the toast
still shows with a sign-in line, storing nothing; a missing file, unknown id
or dead network is a console warning, never an error. Each award also fires
an `achievement` window event (`{ id, name, how, icon }`); the screens
library keeps them across game-overs as *Won this run*, so a late one still
agrees with the toasts. `Achievements.mine()` answers `/_achievements` for a
trophy screen. It **seeds** `config/achievements.js` the way input seeds
`controls.js`, so the sweep gives an existing game both the file and the
library. ⚠️ It carries its own copy of the shape rules — a classic script
can't import — kept from drifting against `public/achievement-shape.js` by a
shared test (§16).

The **state library** (`studio/state.js`, 2026-10-04, ideas/dreams.md §3) is
the seventh, and first in the index, so its game-shape line leads. `State`
*is* the run — `State.score += 10` — and its five calls are hidden from the
data (non-enumerable, refused as field names): `reset(fresh)` empties it and
fills it from a new run's object; `save()` is the run as JSON text with each
library's own part beside it, or null and one warning when something in it
is not plain; `load(text)` replaces the data whole, hands each library its
part, then calls everybody who asked through `loaded(fn)` — a page drawn
from State draws itself again there; `include(name, save, load)` is how a
library keeps state of its own with the game's. The rule it exists for, said
in the game shape: everything that changes while a game is played lives in
State — never in a variable, closure or class of the game's — as plain data
reached through State every time. That is what makes a **savepoint** in the
*preview player* (§6) a `save()`, and a save file one call. The four canvas
templates keep their run in it; a loaded moment closes the title or end
screen in front of it. Roll a ball draws its level from State — coins got
and squares hidden are State, the meshes are drawn from it — and Knock it
down keeps no body in State, finding its shot by kind.

The **physics library**, version 2, keeps its bodies in State's saves: it
enlists with `State.include` the first time a world exists, saves every body
as plain data (its config entry, place, angle, speed, spin, awake) and loads
by building each again — new objects, so a game holding an old one holds
nothing. `Physics.tune(opts)` sets gravity, bounce and friction on the live
world, gravity at once and the other two on every body that does not say its
own; Knock it down calls it every frame, so a tweak reaches a level already
built.

**Copied, not shared**: real bytes, in the tree, in the history — at the
cost of drift, which the manifest makes visible rather than silent (other
designs tried and rejected: spec/alternatives.md). **Every game is born
holding the core set**: creation scaffolds it server-side
(`server/files/library.js`, reading `public/studio-lib/index.json`) in one
commit right after `init`. The sweep is the same install pointed at a game
that already exists.

**Core and extras.** A library with `core: true` in the index is every
game's; one without is an **extra**, held only where somebody asked — an
engine is the case, since a quiz carrying a renderer costs its tree the bytes
and every fire its note (ideas/modularity.md). A template names the extras it
is born holding in its own `libraries` list (`game-templates/index.json`),
and a person adds one to an existing game from *Add a file* under Code —
one choice per extra the game lacks, absent when there is none, through
`POST /api/projects/:slug/libraries`, named by key and never a helper's
bytes. The install rule is **core ∪ held ∪ asked**: the sweep asks for
nothing, so it raises a held extra and never hands one to a game without it.
No removal: taking an engine out of a game whose code calls it is a broken
game nobody asked for. A helper cannot add one either; the page's
`<script>` tag stays the page-writer's job, and the toast says to ask the
builder for it.

**Every game is kept current by the sweep.** Pinning each game to its birth
version split the fleet into generations: a helper asked to use a library
its game lacked had no file and no API note to find. `npm run sweep`
(`bin/sweep.js`), run on the machine holding the games, closes the gap:
every non-archived game gets the core libraries it lacks and the current
version of every one it holds, one commit per game, authored as the studio
(`studio@gamestudio.local`). Seeds and the game's own files are never
touched; `<script>` tags stay the page-writer's job.

⚠️ What makes the sweep safe is the **compatibility law**: a library version
N+1 must run every game that ran N, or it's a new library under a new name,
not a version bump. The escape hatch is the fleet's size — few enough to fix
by hand if the law ever breaks. One refusal guards the edge: a manifest
newer than the studio's own is left alone (a rolled-back studio, not a game
to fix). An archived game is swept like any other since 2026-10-04 — it is
still playable, and eight of them took their move onto State without the
library it needed while the sweep skipped them.

The **physics library** (`studio/physics.js`, the first extra, 2026-09-22) is
a **façade**: the studio's own file, carrying its note, over a vendored
engine it ships beside it — `studio/planck.min.js`, planck.js 1.5.0 (Box2D in
JavaScript, MIT, a classic UMD script setting `planck`), with
`planck-license.txt`, the fonts' precedent. It speaks the game's pixels with y
down and degrees in config: `Physics.build(list)` makes a body from each
config entry (`at`, a `size` pair for a box or a radius for a ball, `angle`,
`still`, `bounce`/`friction`/`weight`), keeping every other key on
`b.thing`; `step(dt)` runs a fixed 60 Hz clock whatever the frame rate, so a
tower falls the same way on a phone and a laptop; `onHit(fn)` is told each
contact **after** the step — planck locks the world while it steps, so a
listener may remove bodies — with how hard the two met along the push
between them; `fling`, `at`, `remove`, `all`, `moving`, `clear`, `world` are
the rest. Nothing in it draws. ⚠️ **The engine's version is in the library's
name**: `physics` is planck 1.x, and its own integer counts façade changes
that keep the compatibility law. An engine that plays a tuned tower
differently is a new library, `physics2`, which no sweep installs into a game
that did not ask. The note says the engine is there and the game's own code
may use `planck`; the studio supports what the façade offers.

The **render3d library** (`studio/render3d.js`, the second extra, 2026-09-23)
is the 3D façade: three.js 0.186 (MIT) vendored as `three.module.js` and the
`three.core.js` it imports — 2.1 MB unminified, since npm ships no minified
build and the studio has no build step — with `three-license.txt`. ⚠️ **It is
a module**: three.js ships no classic build any more, so the façade is
`<script type="module">`, sets `window.Render3D` and `window.THREE`, and a
game using it has its own code as a module after it. Modules run in page
order after every classic script, so `Input`, `Screens` and `config/` are
there when they do; the index marks the library `module: true` and the
template harness holds the order (classic tags first, a module library as a
module, the game's own code a module). `start(canvas)` makes the renderer,
scene, camera and two lights; `box`, `ball` and `boxes` — many of one box as
a single instanced mesh, which is how a phone draws a floor — answer
`THREE.Mesh`es; `follow`, `look`, `remove`, `clear`, `draw(dt)`. The world is
whole units with y up. ⚠️ The drawing buffer is sized from the canvas's CSS
box (at most twice the screen's pixels, kept by a ResizeObserver) and never
the CSS, which is `Screens.fit`'s; but the buffer *is* the canvas's `width`
and `height`, which `fit` reads the game's shape from, so `fit` runs once,
before `start`, and never again. ⚠️ The renderer keeps its last frame
(`preserveDrawingBuffer`), because the preview's shot copies the biggest
canvas into a 2D one and a WebGL canvas that does not reads back black — a
helper told to look at the game would have seen nothing. No models or
shadows yet: `.glb`/`.gltf` are served and uploaded to `assets/models/`
(§4), and loading one wants three.js's GLTFLoader vendored beside it.

Two rules make it a library rather than a folder, both load-bearing:

- ⚠️ **A helper may read it and may not write it.** `isLibraryPath` in
  `paths.js` is the security boundary; `write_file`, `patch_file` and
  `delete_file` refuse with an actionable reason. Writable, a helper would
  fork a shared engine into one game with the drift invisible. A person may
  still write it — that's how it's installed.
- **It is named to an agent, never sent.** `listTree` flags library files;
  the ambient block lists them under `STUDIO LIBRARY` with a total size
  instead of contents (§8), sparing the budget the game's own code competes
  for. `read_file` still reaches it; pinning is disabled for the same reason.
- **It documents itself with an API note.** The comment block at the top of
  `studio/<name>.js` is reproduced in the preamble for each library the
  manifest holds, read from the game's own copy so the note matches the
  held version, and capped so it stays a note. A library adds no
  orchestrator edit; a game holding none gets no note.
- **A note closes its surface**, naming what the library deliberately lacks
  — no init, no unlock, no registry — so an absence reads as a closed
  question rather than uncertainty worth re-checking against the source.

`config/controls.js` is **not** part of the library: the game's own
bindings, seeded once from `public/templates/` and never replaced, since
they're buttons somebody chose. `seeds` in the index marks that distinction.

#### Picking the control scheme

Which `config/controls.js` a game is seeded with is chosen with its template,
like its type — Game Design's **How do you play it?** card for a game no
template makes, Make it writing the seed (§6), and `scheme` on
`POST /api/projects` for the API — but the two stay unalike after that: a type is a column (`projects.type`), so no
`write_file` can change which editors somebody sees; a scheme has to be a
file, since `input.js` reads `SCHEME` at runtime, which is also why it alone
stays changeable afterwards.

`public/templates/index.json` is the registry — one entry per scheme, the
dialog's words and its seed file — doubling as the validation list the way
`game-templates/index.json` does for templates. Three things it settles:

- **A request names a key, never a path.** `POST /api/projects` checks
  `scheme` against the registry before touching disk; a name shaped like a
  path is a 400, ⚠️ never a read of another file.
- **A family is an interface grouping, not a word in the file.** An entry
  naming a family — **Arcade** — is offered in the family's words and starts
  as its first manner (`stick-buttons`), narrowed afterwards in the panel.
  `SCHEME` itself is always one concrete shape, since "explicit is checkable"
  is the whole reason the declaration exists rather than being inferred from
  the bindings.
- **The default is the null controller**, which draws nothing. The
  registry's `default` and the input library's own `seeds[].from` must name
  the same file — `test/schemes.test.js` holds them together, the only two
  places that could disagree.

**A declared scheme owns the screen**, unless it is `none`: the body gets
`touch-action: none` and no text selection, and since input 7 Safari's
`gesturestart` and any two-finger `touchmove` are refused too. iOS zooms on a
pinch whatever the viewport and `touch-action` say, and on a kid's iPad the
zoomed game could not be pinched back out mid-run (2026-09-29). ⚠️ Not yet
felt on a real iPad. `none` and a file with no `SCHEME` keep the browser's
zoom, so a story or a quiz can still be enlarged to be read.

**A game that names no controller is lent one** (input 8, 2026-10-02). Three
games had keys and thumbs and no `pad:` at all, so a controller did nothing
in them. When no `pad:` binding appears anywhere in a game's bindings, the
arrow verbs get the d-pad and the left stick, every other verb a face button
in the order the file lists them — A, B, X, Y — the first two the right and
left triggers as well, and `start` gets Start and A; a verb in `HIDDEN` gets
nothing. ⚠️ Lent, never written: the file stays as it is, and one `pad:`
binding anywhere means the game has said how it is held, so nothing is lent
at all. `Input.bindings()` hands back what is actually played, and screens
16 reads its how-to-play line through it when the game holds input 8, so
the hint names what the controller really does. No game's own code reads a
controller (searched before it went in), so a lent button cannot be read
twice.

A template may fix its own scheme, and all three that ship do: the quiz and
the visual novel say `none`, since buttons are pressed rather than steered,
and the arcade template says `buttons`. So the dialog drops the question
rather than offering one it would overrule, and **only a blank page is asked
how it is played** — which is the right place for the question, since a blank
page is the only one whose shape nobody has decided yet. An explicit scheme
still wins over a template's.

⚠️ The word **Arcade** is on two things and means the same thing on both: the
control-scheme family, and the template that fixes one of its manners. They
never both need answering — picking the template takes the scheme question
away — and the template is listed as *An arcade game*, in the same voice as
*A quiz*, so the two strings differ where they do appear together. `scaffoldLibraries` takes the override as a
destination-to-source map, so `npm run sweep` never learns about schemes at
all — it can't replace a seed that already exists, the same rule.
