# The point-and-click adventure: scenes with spots on them

(Dann, 2026-09-01: "New template: point and click". The sketch in
ideas/templates.md dates from before the visual novel; this is that sketch
brought up to what the story editor settled.)

## What the visual novel already decided for it

The two share their vocabulary on purpose (spec/ §4): a **scene** is one
screen with a picture; a **switch** is one-way, `set` by an action and
`need`ed by another, never `flip`ped. The adventure adds one word — a
**spot**: a rectangle on the scene's picture that does something when clicked.
Its config is the story's with spots in place of lines:

```js
const SCENES = {
  hall: {
    picture: "assets/images/hall.png",
    about: "A dusty hall with a locked door",
    spots: [
      { at: [420, 60, 120, 200], say: "The door is locked.", need: "" },
      { at: [420, 60, 120, 200], go: "garden", need: "has_key" },
      { at: [40, 300, 80, 60], take: "key", set: "has_key", say: "A small brass key." },
    ],
  },
  garden: { picture: "assets/images/garden.png", spots: [] },
};
```

A spot is `at: [x, y, w, h]` in the picture's own pixels, plus exactly one
of: `go` (to a scene), `say` (a line in the box), `take` (an item into the
inventory, which `set`s a switch of the same name unless told otherwise). Any
spot may `need` a switch and `set` one. Two spots on the same rectangle with
different `need`s are how a door is locked and then not; the first whose
`need` is met wins, top to bottom. An **item** is a switch with a picture —
`assets/sprites/<item>.png` in the inventory strip — so the inventory is not
a second kind of state.

`js/adventure.js` draws the picture, hit-tests a click against the spots,
keeps the inventory strip, and plays `Sound.play` for a spot's optional
`sound`. DOM over a scaled `<img>`, not a canvas: a phone rotates and the
picture letterboxes with `object-fit: contain`, and the hit test maps the
click back into picture pixels through the img's rendered box. The same
`?scene=` the visual novel honours, for *Try this scene*.

## ⚠️ The constraint that makes the editor the point

Helpers cannot see pictures (spec/ §14). A spot is four numbers about a
picture, and nobody types those — so without an editor this template is
worked example scenes and a helper guessing. The editor is not a nicety here;
it is the only authoring surface that can exist.

## The editor: `Adventure`

An *editor* in the centre pane, registered in `public/game-types.js` under the
type `adventure`. The story editor's three regions, with the stage doing more:

- **The strip** down the left: every scene with its problems and its tail
  (*3 spots*, *nothing here*), then the **items**. Same rows, same `+ Add`.
- **The stage** is the picture with the spots drawn on it as translucent
  rectangles in the game's `primary`, labelled by what they do. **Drag a box
  on the picture to make a spot** — the spot picker TODO.md has carried since
  the templates plan — and drag a spot's edge to resize it, its middle to
  move it. The selected spot is the one whose row is open. The stage is the
  studio's own drawing from the unsaved model, as in the story editor
  (`stageFor` is the pattern), and the picture is the same object-URL cache.
- **The steps** under it: the scene's name and picture rows as the story has
  them (shelf and all — the standard set's backgrounds are exactly what an
  adventure wants), then one row per spot: what it does (a `select` of
  go / say / take), the target or the words, *only if* a switch, *remembers*
  a switch, and ✕. Selecting a row highlights its rectangle; a rectangle
  clicked on the stage opens its row.
- **The checks** — what only the whole graph can say: a scene nothing leads
  to; a spot whose `go` names a scene that is gone; a `need` nothing sets; a
  `take` of an item with no picture; two spots that overlap with the same
  `need` (the lower one can never be clicked); a scene with a picture the
  game does not have. And one the story editor never needed: **a spot off
  the picture** — `at` outside the picture's own size, which happens the
  moment a picture is replaced by a smaller one.

The guide (`nextQuestion`) can come along nearly whole: who is the hero is
gone (there is no cast), but *where does the story start*, *what does it look
like*, *what is there to click on* (the box-drag), *where does it lead* are
the same questions in the same order.

## Controls

The **point-and-click scheme** ideas/control-schemes.md deferred: the pointer
is the control and a touchscreen needs nothing drawn. On a pad, a drawn cursor
moved by the stick and A to click — `Input.point()` as the one new API surface
— is the couch-play version, and it is the reason the scheme was deferred: it
is real machinery. The template ships with `SCHEME = "point-and-click"` and a
`controls.js` binding `click: "pad:a key:space"`, and the input library grows
the scheme in the same build; until then no `SCHEME` means buttons and a
pointer game draws nothing because it binds no `touch:` names — the template
works on every phone from day one, and the pad comes later.

## Template tree

`index.html`, `css/style.css`, `js/adventure.js`, `config/scenes.js` (the
heart), `config/words.js` (the inventory label, the "nothing happens" line),
`config/look.js`, `config/controls.js`. Ships **empty** like the visual
novel: no scenes, so the first thing an author meets is *Where does the story
start?* and the example — a three-scene key-and-door — is *Or put in an
example adventure* on that first card, its art from the standard set.

Dialog words: `title: "A point-and-click adventure"`, `what: "Pictures with
things to click on: doors, keys, people. Draw a box on the picture to make one
— no code needed."`

## Build order

1. The template tree and the game, with the worked example — playable with
   no editor, spots typed by hand once, to prove the shape.
2. The editor without the box-drag: the strip, the stage drawing the spots,
   the rows, Save, the checks. Already usable with the numbers typed.
3. **The box-drag** on the stage: pointer down, move, up → a spot row. Then
   move and resize. Browser-checked at phone width: a finger on a 480×270
   picture scaled to 360px wide is the real test.
4. The guide, from the story's with the cast questions removed.
5. The preamble line for the type (§8): "an adventure — spots are rectangles
   on pictures you cannot see; never write `at` numbers, ask the person to
   draw the box in the studio".
6. GLOSSARY: **adventure** (the template), **spot**, **item**, **adventure
   editor**; a **scene** grows "or, in an adventure, spots" (ask before
   coining any of these).

## Open questions

- Inventory as a strip along the bottom, or a bag you open? A strip: it is
  visible, and a kid seeing the key is the whole game.
- Does `take` remove the spot? Yes by default (the key is gone from the
  floor) — `keep: true` for a fountain you can drink from twice.
- A `say` that is several lines, read one at a time as the visual novel does
  it — `say` takes a list. Small; do it from the start so the two shapes
  agree.
