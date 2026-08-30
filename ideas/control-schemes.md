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
- **clicker** (working name **normal** when it returns) — the game's own DOM
  buttons are the controls; the scheme adds pad/arrow focus-cycling and a loud
  focus ring. ⚠️ It cannot live inside `input.js` as-is: DOM games have no
  frame loop to call `Input.update()`, and pads are poll-only, so it needs its
  own rAF heartbeat — its own small library file. The quiz would declare it.
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
