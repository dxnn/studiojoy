# Control schemes: a standard set of ways to hold a game

(Dann, 2026-08-30.) Touch controls exist but there is only one style of them:
`touch:` bindings in `config/controls.js` become a digital d-pad bottom-left
and round named buttons bottom-right, drawn on coarse pointers
(`studio-lib/input/input.js`). No analog touch, no swipe, no pointer. A
**control scheme** standardises the physical shape of a game — what hands do —
so the touch layout, the pad mapping and the key defaults arrive as a set
instead of being argued one game at a time.

## Three layers, and the scheme is the bottom one

- **The scheme is the physical shape**: how many axes, how many buttons,
  which gestures. Fixed vocabulary, one per game.
- **The game's verbs** stay the game's own words — the left-hand names in
  `config/controls.js`, mapped onto the shape. Renaming `fire` to `boost`
  never changes the shape. (The file already keeps these apart: the verb is
  `fire`, the drawn label is whatever the `touch:` name says.)
- **Semantics stay in game code.** One button meaning three things on three
  screens is the game's business; the scheme never sees it.

Declared explicitly — one commented const in `config/controls.js` (working
name `SCHEME`) — rather than inferred from the bindings. The strip trick works
because a picture's shape is unambiguous; a bindings list is not. Explicit is
checkable (a file claiming swipe+tap but binding six touch buttons has left
its scheme, and the config form can say so), and it is one plain line a kid
can read and change.

What it buys: `input.js` draws the right overlay for the declared scheme; each
scheme is a preset `controls.js` seed, so "take the template's standard one"
costs nothing — a template's tree is copied after the library scaffold, so its
own `controls.js` already lands over the seed; and the API note tells a helper
what hands do ("one thumb on a stick, one button") without an orchestrator
edit.

## The four

**one-button** — one action, plus start (the same press). The whole screen is
the button: no overlay drawn, a listener on the play area — ignoring taps that
land on the game's own buttons and links, so a game-over screen still works.
`key:space pad:a`. Two players on two pads or a split keyboard; touch is one
player. Flappy-likes, timing games, reaction games. Nearly free, and it proves
the declaration mechanism end to end.

**swipe + tap** — four-direction flicks, a tap, start. ⚠️ A flick is an event,
not a state: it is surfaced for exactly one frame, so `pressed()` sees it once
and a `held()` loop gets a one-frame nudge instead of movement. The API note
must say which verbs are event-like, or a game written on `held()` misreads
them silently. A flick that completes between frames is buffered until the
next `Input.update()` and cleared on the one after — new machinery, small.
Needs `touch-action: none` on the play area or the browser eats the gestures,
and a pixel threshold to tell a flick from a tap. Pad: d-pad presses are
flicks, A is tap. Keys: arrows/WASD are flicks, space is tap. 2048-likes,
snake, lane runners, match puzzles.

**stick + buttons** — one analog axis pair, up to two labelled buttons, start.
The workhorse; most existing games are this, and it becomes the default seed.
The virtual stick is the one real build in the whole set: floating (its centre
is where the thumb lands), deadzone, feeding `axis()` continuous values.
⚠️ `axis()` today reads analog from pad sticks only — `stickValue` scans
`pad:` bindings — so the touch stick is a second analog source behind the same
call; no game-facing change. Keys stay digital ends (−1/0/1), which games
already expect. Touch is player 1 only — one screen has room for two thumbs,
not four — player 2 is the second pad or the shared keyboard, as now.
Platformers, top-down, racing (a left/right split-corner steering layout is a
variant of this scheme, not a scheme).

**dual stick** — two analog pairs, move and aim, plus start. The same stick
machinery twice, one per corner. With both thumbs occupied there is no thumb
left to fire: auto-fire, or firing while the aim stick is pushed — open
question below. Pads: both sticks and A. Keyboard: WASD + arrows (the
mouse-aim variant borrows pointer machinery and is deferred with
point-and-click). Never two players on touch. Twin-stick shooters.

## Start on a touchscreen — an existing gap, closed for free

`start: "key:enter pad:start"` carries no `touch:` binding today, so a tablet
player cannot begin or replay. No machinery needed: a `touch:` name may appear
in two verbs' lists, and `touchDown` is checked by name — so each preset binds
the primary touch control into `start`'s list as well. On the title screen the
game reads `pressed("start")`, in play it reads the verb; the same thumb does
the right thing per screen, and the semantics layer sorts it out.

## What the code needs

- The scheme const, read where the bindings are read; the overlay builder
  branches on it.
- ⚠️ Back-compat: a `controls.js` with no scheme behaves exactly as today —
  d-pad plus round buttons from the `touch:` bindings — so bumping the input
  library (v3 → v4) and sweeping `deploy/sync-games.sh` is safe. Seeds are
  never replaced, so no existing game's `controls.js` is touched.
- The virtual analog stick (shared by two schemes), the swipe buffer, the
  whole-screen tap. The overlay's fixed 218px band gives way to per-scheme
  layout.
- Preset seeds, one per scheme (`/templates/controls-<scheme>.js` shaped);
  a blank game gets stick+buttons.
- Tests extend the fake-pad pattern in `test/input-template.test.js` with
  fake touches and swipes; each overlay browser-checked on a coarse pointer.

## Build order

1. Declaration + presets + **one-button** — smallest overlay change, proves
   the mechanism.
2. **swipe + tap** — the event semantics and the buffer.
3. The virtual stick, then **stick + buttons** becomes the default seed.
4. **dual stick** — the stick twice.

Then the migrations, per game, the space-racer way: hand a helper the game and
the scheme. Games with hand-rolled touch are rebuild-and-verify jobs like any
other migration (TODO.md holds the list).

## Deferred, and why

- **point-and-click** — the only scheme demanding new API surface:
  `Input.point()`, a coordinate-space answer, and a drawn controller cursor.
  Wanted eventually (the adventure template gets couch play from it); parked
  so the expensive machinery stays off this critical path.
- **clicker** — built as `none`, see "The sixth" below. Its focus-cycling
  half is still deferred, and for the reason given there.
- **tilt** — iOS gates device orientation behind a permission prompt and there
  is no desktop analog. Out of the default set.
- **pinch / multi-touch gestures** — rare in these games, expensive to get
  right.

## Open questions

- The kid-facing word for a scheme (the const's comment, the template
  descriptions) — "controls"? "how it's played"? Worth wordsmithing.
- The const's name: `SCHEME` covers pad and keys too, `TOUCH` is what a kid
  sees change. Leaning `SCHEME`.
- Dual-stick fire: auto-fire, fire-while-aiming, or a third slot?
- Overlay ergonomics: opacity, safe-area insets, a "turn your screen" nudge
  in portrait. Tune when the stick exists.
- Does New game ever pick a scheme, or only templates plus the presets?
  Leaning: templates carry it, blank games get the default, a picker later
  if wanted.
- GLOSSARY: **control scheme**, when built.

## The fifth: buttons, toggles, and the end of the unnamed shape

(2026-08-31, built as input v5 / screens v4.) A phone test of the four
surfaced what they could not say: a thrust-and-turn ship needs three *held*
channels at once — turn, thrust, fire — and a phone has two thumbs. The
d-pad was clumsy for it and the stick worse: one thumb cannot work two
channels independently. No layout fixes that alone; the missing lever was
what a press *means*.

**`toggle:NAME`** — a binding kind, not a scheme option, because stickiness
belongs to one verb's button and the bindings line is where kids already
edit. A drawn button that latches: tap on, tap off, `held()` in between,
a bright ring while latched. Flips on pointer-down only — sliding onto a
toggle never flips it. Latches drop on blur and when a Screens screen
opens (respawning with the engine secretly on is worse than tapping).
`key:`/`pad:` on the same verb stay momentary, so the desktop feel never
changes. Asteriskoids latches FIRE (autofire) and keeps THRUST momentary
and featherable: latch fire, hold thrust, rock turn — all three at once.

**The `buttons` scheme** — the user's four-button layout, generalised: the
`touch:` directions form one cluster (two of one axis draw as a big pair,
both axes as the arrow pad), every other `touch:`/`toggle:` name climbs a
diagonal from the opposite corner, first-declared biggest and nearest it.
It is also what no `SCHEME` means: a legacy `controls.js` binding four
arrows and GO renders the same as before, so the unnamed shape is retired
rather than kept beside a twin. `BUTTON_SIDE = "left"` mirrors any layout,
sticks included — game-level, one plain const, until a per-player setting
is ever worth building.

**Rocking, not tapping** — the feel fix that mattered as much as the
layout. Buttons are geometry in input.js (centres and radii, anchored to
corners), hit-tested by arithmetic with an invisible halo around every
button and nearest-centre resolution where halos meet; the DOM is only
paint. So a thumb slides between neighbours without lifting, the same
maths runs headless in `npm test`, and per-button pointer capture — which
made slide-onto impossible — is gone.

**Screens steps aside** — the overlay used to sit on top of the title
screen on purpose, because the drawn GO was the only touch path to
`start`. Now `Screens.title()` marks the body `screens-open`: the drawn
controls hide, thumbs release, latches drop; the Start button relays one
frame of `start` through the window so poll-style games still begin by
touch. Either library missing the other degrades to the old behaviour.
Games with hand-rolled screens (asteriskoids, space-racer) still wear the
controls there until they move onto `Screens.title` — queued in TODO.md.

The input header grew to ~2.6 KB; the orchestrator's API-note cap went to
3 KB rather than compressing the note into illegibility. Not yet felt on a
real phone — that re-test is queued in TODO.md with the deploy.

## The sixth: none, the null controller

(Dann, 2026-09-03, built as input v6 / screens v12.) The four presets and the
fifth were built and then never reachable: nothing in the studio ever
installed one. `studio-lib/index.json` seeded `/templates/controls.js` —
`stick-buttons` — into every game, always, and the other four were read by
nothing but the tests. So a quiz declared an analog stick, and a visual
novel's title screen offered "Enter to start" over a Start button that only
took clicks.

**`none` is the absence of a controller, not a quiet one.** A game made of
its own buttons and links already works everywhere: a mouse clicks them, a
finger taps them, Tab reaches them, a screen reader reads them out. So the
shape draws nothing, installs no surface, leaves the body its scrolling and
its text selection, and ⚠️ is the one shape that does **not** take its bound
keys away from the browser — a prevented keydown on Space is a click the
browser then never sends to the button under the focus. `Screens.hint()`
returns "" for it: a button says what it does.

It is not the same as no `SCHEME` at all, which stays the `buttons` shape so
every game from before the word plays untouched.

Deferred, still: pad and arrow focus-cycling over those buttons, for the
reason the clicker row gave — a page of buttons has no frame loop, so it
wants a heartbeat of its own. `none` is where that lands when it is built,
rather than a seventh name.

## Picking one, and changing it after

(Dann, 2026-09-03.) The scheme is chosen when a game is made, the way its
type is, and then changed whenever — unlike the type. Four decisions taken
before the build:

1. The word in the file is `none`, kid-facing **Just the game's own
   buttons**, and it is the default seed. *normal* and *clicker* are retired
   as names.
2. **Arcade is a family in the interface, not a word in the file.** New game
   offers four choices — the null controller, Arcade, One button, Swipes and
   taps — and Arcade seeds `stick-buttons`, refined in the panel to its three
   manners: two sticks, a stick and buttons, buttons only. `SCHEME` stays one
   concrete word, because "explicit is checkable" is the whole argument for
   declaring it, and `SCHEME = "arcade"` would leave nothing in the file
   saying which shape a phone actually gets.
3. The panel is a **mode pill named Controls**, one per game, beside Pics and
   Hear. `config/controls.js` then opens under Code as plain text and nothing
   else — the story editor's rule, so one surface writes one file.
4. Verb names are shown and not editable: `left`, `thrust`, `boost` are the
   game's own words and `Input.held("thrust")` is in its code, so a rename in
   a form is a silent code break. Bindings, drawn labels, latching, the side
   and the deadzone are all editable. Adding and renaming verbs is queued in
   TODO.md.

Changing the shape rewrites `SCHEME` and nothing else. It must never replace
the file with the new shape's preset: that would take the game's own verbs
away and break its code. Instead the panel says what the new shape has no
room for — a stick under swipe-tap — and offers to drop that binding, one at
a time. Which is what explicit declaration was for.
