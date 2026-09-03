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
  input library. See Controls below.
- config/achievements.js — an empty list, seeded by the achievements library.
  Fill it in once the game says moments worth earning something for.

All six libraries are loaded already, so a first script can call Input.held,
Sound.play, Sprites.draw, Screens.title and Moments.say without touching
index.html.

## Controls

`SCHEME` at the top of config/controls.js says how this game is held — its
**control scheme**, the shape of the game on a screen. Read it before writing
any input code: it was chosen when the game was made, so it is a decision
somebody made rather than a default, and the bindings under it are what a
phone draws.

- `"none"` — no controller at all: the game's own buttons on the page are the
  controls, and nothing is drawn over them. What a game of buttons wants — a
  quiz, a story, a board you press.
- `"buttons"` — drawn buttons under both thumbs; an arrow pad and fire buttons.
  A `toggle:` binding latches, so three things can be held at once.
- `"one-button"` — a tap or a click anywhere is the button. Nothing is drawn.
- `"swipe-tap"` — four flicks and a tap. Moments, not states: read them with
  `Input.pressed`, never `Input.held`.
- `"stick-buttons"` — an analog stick beside the drawn buttons.
- `"dual-stick"` — a second stick to aim with.

A person changes it whenever they like, so do not change it yourself unless
you have been asked to. If you are asked, change `SCHEME` and then make the
bindings match it: the names
on the left of `CONTROLS` are the game's own words, and the same word is what
the code asks for with `Input.held("boost")`.
