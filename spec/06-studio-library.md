### The studio library

`studio/` is a reserved directory in a game's working tree holding the
studio's own **libraries**, described below — served, committed and cloned
like any other file. `studio/studio.json` is its **manifest**: library name
to the version this game has.

The **sound player** (`studio/sound.js`) is the second library, and proved
the shape: no orchestrator edit needed, since its API note is its own file
header — just the file and an `index.json` entry. `Sound.play("laser")`
plays `assets/sounds/laser.wav` (the sound editor's own files) through a
pooled element per shot, so rapid fire overlaps instead of cutting itself,
plus `loop`/`stop`/`mute`. A missing file or blocked autoplay is one console
warning, never an error — a game must not break over a sound.

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
`Screens.title()`, and the `Screens.chips()` HUD strip. Five decisions worth
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
rather than throwing.

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

**Copied, not shared**: real bytes, in the tree, in the history — at the
cost of drift, which the manifest makes visible rather than silent (other
designs tried and rejected: spec/alternatives.md). **Every game is born
holding the library**: creation scaffolds it server-side
(`server/files/library.js`, reading `public/studio-lib/index.json`) in one
commit right after `init`. The sweep is the same install pointed at a game
that already exists.

**Every game is kept current by the sweep.** Pinning each game to its birth
version split the fleet into generations: a helper asked to use a library
its game lacked had no file and no API note to find. `npm run sweep`
(`bin/sweep.js`), run on the machine holding the games, closes the gap:
every non-archived game gets the libraries it lacks and the current version
of the ones it holds, one commit per game, authored as the studio
(`studio@gamestudio.local`). Seeds and the game's own files are never
touched; `<script>` tags stay the page-writer's job.

⚠️ What makes the sweep safe is the **compatibility law**: a library version
N+1 must run every game that ran N, or it's a new library under a new name,
not a version bump. The escape hatch is the fleet's size — few enough to fix
by hand if the law ever breaks. Two refusals guard the edges: a manifest
newer than the studio's own is left alone (a rolled-back studio, not a game
to fix), and an archived game is skipped, catching up on its next reopening.

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

Which `config/controls.js` a game is seeded with is chosen at creation, like
its type — New game asks **How is it played?** beside "Start from" — but the
two stay unalike after that: a type is a column (`projects.type`), so no
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

A template may fix its own scheme: the quiz and visual novel both say `none`,
since buttons are pressed, not steered, so the dialog drops the question
rather than offering one it would overrule. An explicit scheme still wins
over a template's. `scaffoldLibraries` takes the override as a
destination-to-source map, so `npm run sweep` never learns about schemes at
all — it can't replace a seed that already exists, the same rule.
