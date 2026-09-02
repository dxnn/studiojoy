# The racing template: a track you can draw with your finger

(Dann, 2026-09-01: "New template: racing game".) The fourth *game template*,
after the quiz, the visual novel and — still queued — the move-and-collect and
the point-and-click adventure (ideas/templates.md, ideas/point-and-click.md).

Two racing games already exist in the studio and say what the genre is here:
`space-racer` (a lap racer on a horizontal loop, rivals, boost, four tracks
that unlock) and `vroooooooom`, which despite its name is an asteroids
variant. Space-racer is the shape to start from: **laps on a closed track,
against rivals, with the track the thing a kid most wants to change**.

## What a template is for (the principle, restated)

Each template earns its place with an editor over its config heart — the part
a kid remixes before ever seeing code — and the editor is worth building for
what only it can see: the whole structure at once (ideas/templates.md, "What
the visual novel added"). For a quiz that was answers wired to endings; for a
story it was scenes nothing leads to. For a racer it is **the track**: a
closed loop that has to actually close, be wide enough to drive, and not
cross itself. A helper cannot see a picture (spec.md §14), so a track drawn as
coordinates is exactly the kind of thing a person authors and a helper only
tunes — the same constraint that shaped the adventure's spots, resolved the
same way: the studio draws, the config holds numbers.

## The heart: `config/track.js`

```js
// The track, as the points the road passes through, in order. The road
// closes back to the first point on its own. Draw it in the studio's track
// editor rather than typing numbers.
const TRACK = {
  width: 90,          // how wide the road is, in pixels
  points: [[120, 300], [300, 120], [700, 120], [860, 300], [700, 480], [300, 480]],
  start: 0,           // which point the start line sits at
};
// What sits beside the road: rocks to bash, boost pads, a puddle that slows
// you down. Each has a kind, a place, and a size.
const THINGS = [
  { kind: "rock", at: [500, 240], size: 22 },
  { kind: "boost", at: [500, 500], size: 30 },
];
```

`config/play.js` holds the feel (turn, thrust, friction, top speed, boost,
laps to win, rival count and rival speed) — the numbers space-racer already
keeps there, so the shape is proven. `config/words.js` holds the HUD words
and the countdown. `config/look.js` the four colours, as every game.

The road is the polyline through `points`, closed, stroked at `width`; the
cars are on the road when they are within `width / 2` of the nearest
segment. That one distance test is the whole physics of "off the track", and
it is what the editor's checks read too.

## The editor: `Track`

An *editor* in the centre pane (`public/game-types.js` registers it under the
type `racing`), like the story editor: the whole pane, the rail as it is.

**The canvas is the track.** The game's own 960×600 world, drawn by the
studio from the unsaved model — the road stroked at its width, the start
line, the things — with the points as handles:

- drag a handle to move it; the road redraws under the finger
- click on the road between two handles to add a point there
- select a handle and press Delete, or its ✕, to remove it (never below 3)
- drag a thing to move it; a row of thing kinds at the side drops a new one
- the start line is a handle too: a click on a point makes it the start

A form column beside it: the width as a slider, the play numbers as the
config form already shows them, and the list of things as rows (kind, size).
Save regenerates the file the way the story editor does — the template's
comments back on, byte-identical on an untouched save — and is a commit, so
Save stays explicit.

**What only the editor can see** — its checks, the way the story editor has
five: the road crosses itself (two non-adjacent segments intersect); a
segment is shorter than the width, which draws as a kink; a thing sits off
the road, where nobody can hit it; the track is so short that the rivals lap
you before the countdown ends (the total length against play.js's speeds).
The strip head says how many, the way the story's does.

**Try this track** — the preview at the game's own `?track=` is not needed:
there is one track per game in the template. `Try it` saves and reloads the
preview, which is what Save already does; the button is there because the
story editor taught that the sentence "save, then look right" wants one
press.

Phone width: the canvas fits the pane's width and the form column drops under
it. Handles are 24px targets at least — this is the one editor whose main
gesture is a drag, and the drawing test on a real phone (TODO.md) is the same
question asked of the pixel editor.

## The game: `js/race.js`

Small and honest, in the template's own code where a helper can grow it:

- a car with turn/thrust/drift from `play.js`, drawn as a triangle in the
  primary colour so it needs no sprite — `assets/sprites/car.png` is looked
  for first through the sprites library, so drawing one is all it takes
- rivals that follow the centreline at their speed with a little wobble;
  they are the difficulty knob and they make a race a race
- the road, drawn once to an offscreen canvas and blitted — the same
  cheapness lesson asteriskoids is learning on phones
- laps counted by crossing the start line the right way round; `Moments.say`
  for `lap`, `finished`, `place` and `time` so achievements ("first place",
  "a lap under 20 seconds") are three lines in the achievements editor
- `Screens.title()` with the board, `Screens.chips()` for LAP · POS · TIME,
  `Screens.title({ score, post: true })` at the finish, so it is on the
  scoreboard from birth. The score is the time in milliseconds, negated?
  — no: **bigger is better** is the board's rule, so the score is a place
  bonus plus time left from a par, and `WORDS.par` says the par.

## Controls

The *buttons* scheme with `touch:left`, `touch:right` as the big pair under
one thumb and `touch:GO` (thrust) plus `toggle:BOOST` under the other — the
"left/right split-corner steering layout" ideas/control-schemes.md calls a
variant of stick-buttons and the phone test since then says is its own best
shape for a car. `config/controls.js` ships with the template and the seed's
`stick-buttons` is overwritten by it at creation, as every template's is.

## Assets

Placeholders the studio's own makers replace: `assets/sounds/engine.wav`
(looped while thrusting, the sound library's `loop`), `bash.wav`, `boost.wav`,
`lap.wav`, all from the sound editor's presets. No pictures required — the
car is a triangle until somebody draws one, and the road is geometry.

## Words the dialog shows

`title: "A racing game"`, `what: "Laps around a track against rivals. Draw
the track with your finger — no code needed."` Heart `config/track.js`.

## Build order

1. The template tree: track.js, play.js, race.js, words, controls, sounds.
   Playable with no editor — a shipped default track — so the tree lands
   first and is a game the moment it exists.
2. The `Track` editor: canvas + handles + Save. The checks.
3. Things (rocks, boosts, puddles) in both the game and the editor.
4. The preamble line for the type (§8): "a racing game — the track is
   config/track.js, drawn in the studio; tune play.js, do not type points".
5. GLOSSARY: **racing template**, **track editor**, **track**, **thing**
   (working names; ask before coining).

## Open questions

- One track per game, or a list like space-racer's four? One first: a list
  is a second editor mode (`?track=`), and the fork is how a kid makes a
  second track today.
- Rivals as config (`RIVALS = 3`) or as things placed on the track? Config:
  where they start is the start line, always.
- Does the editor draw the road with the game's own `look`, or the studio's?
  The stage in the story editor wears the game's colours; the same here.
