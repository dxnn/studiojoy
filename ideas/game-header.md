# A studio header: title screen, HUD chips, and a hint that reads the bindings

(Dann, 2026-08-30.) The exhibit: asteriskoids' title screen on a phone — a
fixed 50px h1 with 8px letter-spacing is ~460px of text on a 390px screen,
and flex centering clipped the panel at both ends, hiding the scoreboard.
Fixed by hand (`10c664d` in its repo), but the fix does not scale: every game
hand-rolls the same three surfaces, and helpers fail them the same way every
time — fixed pixels, desktop shapes, nothing checked on a phone. The header
makes the right thing the easy thing, which is the argument that won for the
input module. "Header" is the working word only; nothing is in GLOSSARY.md
until it is built.

## The three surfaces

- **The title screen** — game name, tagline, a start control, and (today, in
  practice) the scoreboard's Top 10. Every game has one; every one is
  different code.
- **The HUD strip** — small chips over the play area: score, level, whatever
  the game counts. Gold-adjacent numbers a player glances at.
- **The controls hint** — the line that tells a player how to play.
  Asteriskoids' says "Arrows / WASD fly · Space fires every gun you own",
  which is a lie on a tablet. This is the surface only a library can get
  right, because the right answer depends on the device *and* the bindings.

## The hint is derived, not written

⚠️ Corrected from the first sketch of this idea: at runtime the library sees
`SCHEME`, the verb names, and the binding strings — the comments in
config/controls.js are gone once the file executes. So the hint composes
from what is really there:

- keyboard: the key names per verb — "Arrows / WASD to fly · Space to fire"
  falls out of `key:` bindings mechanically;
- touch: the scheme plus the drawn labels — "Push the stick to fly · GO to
  fire" from `stick:` bindings and the `touch:GO` label;
- pad: the `pad:` names, said only when a pad is plugged in (`Input.pads()`).

A game that wants its own words puts a line in config/words.js and the
derived hint stands down — config beats cleverness, as everywhere else.

## Shape

The fourth studio library, and the first presentational one — a precedent to
keep deliberately small, so it never becomes the studio's UI framework. One
file, `studio/header.js`, styles injected from JS the way input.js does its
overlay (no `<link>`, no second file kind). It reads what the game already
declares: `WORDS.gameTitle` and `WORDS.tagline` from config/words.js, the
four colours from `LOOK`, the bindings from `CONTROLS`/`SCHEME`. Explicit
arguments override every read.

Candidate calls, deliberately few (open question below):

- `Header.title({ onStart })` — the phone-fit title screen: clamped type,
  safe centering, scroll-when-tall, safe-area padding, the hint underneath,
  the Top 10 if scores are on. Shows again for game-over with a score.
- `Header.chips({ Score: 0, Level: 1 })` — the HUD strip, updated by
  reassignment, drawn once.
- `Header.hint()` — the derived line alone, for games that keep their own
  screens but want the one hard part.

What it must never do: own the game loop (DOM only, no rAF), own the canvas
or the game's layout (the 366×230 game box on a phone is the game's own
sizing — adjacent problem, out of scope here), or be mandatory — like the
sound player, a game that draws its own screens simply does not call it.

## Adoption

- New games are born holding it — the scaffold, the manifest, the API note
  riding the preamble from the game's own copy: the no-orchestrator-edit
  shape, proven three times now (spec.md §4).
- Templates use it, so template games are phone-fit at birth.
- Old games: the sweep delivers the file, but adoption is per-game — a
  hand-rolled title screen has to be *replaced*, a helper errand each, same
  as scheme adoption.

## Costs

- Its API note adds ~2 KB of ambient bytes to every fire (spec.md §8's table
  has the room).
- The first presentational library — scope discipline is the price of the
  precedent.
- A name, when built: "header" collides with HTML's `<header>`, "HUD" is
  jargon. GLOSSARY entry waits for the decision.

## Build order sketch

1. `Header.hint()` — the unique value, smallest surface, exercises the
   SCHEME/CONTROLS reads everything else shares.
2. `Header.title()` — the pain the exhibit showed; folds the hint in.
3. `Header.chips()` — the least broken today; last.

## Open questions

- The name.
- Config-driven vs argument-driven where the two disagree; the chips model
  (an object reassigned, or named setters?).
- Does the title screen own the Top 10 (every game refetches /_scores by
  hand today — tempting, but it widens scope on day one)?
- Where the hint lives in-game: title screen only, or also faded under the
  HUD for the first seconds of a run?
- Styling hooks for a game that wants to restyle rather than replace: stable
  class names, or LOOK-only?
