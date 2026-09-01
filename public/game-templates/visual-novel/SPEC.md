# The visual novel

Rules, as shipped:

- The story starts at the first scene listed in `SCENES`.
- A scene shows its `picture`, plays its `sound` if it has one, and says its
  `lines` one at a time. A tap, a click, Enter or Space says the next one.
- A line with a `who` is that person speaking, and their portrait is
  `assets/sprites/<who>-<mood>.png`. A line with no `who` is narration.
- After the last line, one of three things happens: `choices` are offered,
  `go` carries the story straight on, or the story ends.
- A choice may `set` a switch. A choice that `need`s a switch is only offered
  once something has set it — everything else about it is the same.
- Switches are forgotten when the story starts again.
- `?scene=<name>` on the address opens straight into one scene, skipping the
  title screen. The studio's "Try this scene" button uses it.

Ways to remix without code: everything in the story editor — scenes, lines,
choices, who says what — plus the words in `config/words.js`, the colours in
`config/look.js`, the pictures in `assets/`, and the stylesheet.

Ways that need a change to `js/story.js`: letters appearing one at a time, a
back button, more than one portrait on screen at once, music that keeps
playing across scenes, a switch that can be turned off again, and anything
counted rather than remembered as a yes or no.
