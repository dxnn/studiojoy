# The point-and-click adventure

Rules, as shipped:

- The adventure starts at the first scene listed in `SCENES`.
- A scene shows its `picture`. A click on the picture lands on the first
  spot, top to bottom, whose box holds the point and whose `need` is met —
  or on nothing, and the box says "Nothing happens."
- A spot does one thing. `go` walks through to that scene. `say` puts a line
  in the box; a list of lines is read one at a time, a tap or a click, Enter
  or Space for the next. `take` puts the thing among what the player
  carries, remembers a switch of the thing's own name, and may `say`
  something as it does; the spot is gone once taken unless it says
  `keep: true`.
- Any spot may `need` a switch, `set` one when it is used, and play a
  `sound`.
- Two spots on the same box with different needs are how a door is locked
  and then not.
- What the player carries is shown in the top corner: the picture at
  `assets/sprites/<thing>.png`, or the word until there is one.
- A scene with no spots at all is the end. Switches and things carried are
  forgotten when the adventure starts again.
- `?scene=<name>` on the address opens straight into one scene, skipping the
  title screen. The studio's "Try this scene" button uses it.

Ways to remix without code: everything in the adventure editor — scenes,
their pictures, the boxes and what each does — plus the words in
`config/words.js`, the colours in `config/look.js`, the pictures in
`assets/`, and the stylesheet.

Ways that need a change to `js/adventure.js`: a spot that does two things at
once, counting rather than remembering a yes or no, using one thing on
another, a hover that names what is under the pointer, and a controller
driving a cursor.
