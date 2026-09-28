# Knock it down: levels, and kinds of body a game makes up

A plan, 2026-09-28, the same shape Roll a ball got in 033e5a8. Waiting on the
questions at the end.

## The file

`config/bodies.js` becomes a list of piles, each with its own sling, since the
"sling inside something" check is per pile:

```js
const LEVELS = [
  { bodies: [ { kind: "block", at: [480, 580], size: [960, 40], angle: 0 }, … ],
    sling: { at: [150, 440] } },
  …
];
const KINDS = {};   // kinds of body this game made up
```

A made-up kind is keyed by a word the four do not use (`box`, `block`,
`ball`, `target`, and `shot`, the game's own at runtime), with exactly
`{ name, colour, round, still, weight, bounce }`. `round` decides the size's
shape (a number or `[w, h]`); `weight` and `bounce` are what the physics
library already honours per body, so a bouncy ball or a heavy stone needs no
code at all. Made-up kinds are never targets: a target is still the one thing
to knock down.

## The game (`js/knock.js`)

- A Run beside the Level: the score carries on; each pile gets its own
  `SHOTS`. Clearing a pile says `cleared` (the shots it took, so *One shot*
  still means one pile in one shot) and builds the next with
  `Physics.clear()` + `build()`. The last one's end is `score`, as now.
- `?level=` starts on the pile asked for, and *Try it* sends it.
- A made-up kind is drawn in its colour by its shape before it does anything,
  still or not, as its entry says. `ON_HIT = {}` is the one marked place for
  what it does: its word's function, called with the body, what hit it and
  how hard, for a bomb or glass.
- A `hudLevel` chip when there is more than one pile.

## The editor (World)

- **Levels** rows over the palette, as in Level: Duplicate, Move earlier,
  Move later, Delete; `+ Add a level` makes a floor, a target on a box and a
  sling, clean by the checks.
- The four `Put in` buttons, then **Made up for this game** rows and a button
  to make one; the rail names it, colours it, and sets round, still, how heavy
  and how bouncy.
- The checks learn made-up kinds: a still one counts for "nothing is still"
  and is exempt from overlap like a block.
- While in there: the plan draws the built-in kinds in the game's own colours
  from `config/look.js`, not the hex copied into the editor, which already
  disagrees with the game on the target and the sling.

## The builder

The brief says where each thing goes: a new pile is `+ Add a level` in World
(⚠️ never written from numbers, which is the rule the brief already has about
`at`); a new kind is one entry in `KINDS`; what it does is `ON_HIT`.

## The one game

`games/knock-down` (local only, no `server` remote) brought forward by hand.

## Questions

1. The interface word for a made-up kind. "Thing" is taken (it is a sprite,
   GLOSSARY.md). I would say **kind of body** in code and docs, and in the
   interface `+ Make up a new one`, under "Made up for this game".
2. `weight` and `bounce` in the kind: yes, or keep it to
   `{ name, colour, round, still }` and leave the physics to code?
3. Shots per pile (`SHOTS` each) or one pool for the whole run?
