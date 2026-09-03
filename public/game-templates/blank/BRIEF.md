This game started from a blank page: there is no game yet, only the studio
library and a placeholder to replace. Rewrite this file as the game takes
shape — it is the file map, and it is the one thing always in front of a
helper.

What is here now:

- index.html — the placeholder: a title, one line of text, and the script
  tags. Replace it with the game's own page.
- studio/ — the studio library, six of them, read-only. studio/studio.json
  says which and at what version.
- config/controls.js — the game's own copy of the controls, seeded by the
  input library. Nothing reads it yet: index.html deliberately leaves out
  config/controls.js and studio/input.js, because a page with nothing to
  steer would still draw a stick and buttons over it on a phone. Add both
  tags, in that order and ahead of the game's own scripts, the moment the
  game has controls.
- config/achievements.js — an empty list, seeded by the achievements library.
  Fill it in once the game says moments worth earning something for.

The other four libraries are loaded already, so a first script can call
Sound.play, Sprites.draw, Screens.title and Moments.say without touching
index.html.

## Controls

config/controls.js ships as **stick-buttons**: an analog stick under the left
thumb and round buttons under the right. That is a default, not a decision —
`SCHEME` is one word in that file and the game should wear the one that suits
it:

- `"buttons"` — drawn buttons under both thumbs; an arrow pad and fire buttons.
- `"one-button"` — a tap or a click anywhere is the button. Nothing is drawn.
- `"swipe-tap"` — four flicks and a tap. Moments, not states: read them with
  `Input.pressed`, never `Input.held`.
- `"stick-buttons"` — an analog stick beside the drawn buttons.
- `"dual-stick"` — a second stick to aim with.

Change `SCHEME`, then make the bindings match: the names on the left of
`CONTROLS` are the game's own words, and the same word is what the code asks
for with `Input.held("boost")`.
