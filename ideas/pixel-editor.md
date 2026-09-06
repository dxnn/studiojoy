# Making the pixel editor good at pixel art

(Dann, 2026-09-05: "Pics drawn using the pixel editor should only go to 256.
Larger pics can still be cropped, or reduced in pixel count until they fit.
In general I'd like the pixel editor to improve to be really good at pixel
art. What are some other tools should we add? How should it be organized?
Benchmark pixel art editors that people love.")

The 256 cap is done — `MAX_DRAWN` in `public/pixel-editor.js`, and the
`spec/` §6 paragraph says why the number is where the editor already changes
character. This note is the rest of the sentence.

## What is there now

Four tools — pencil, eraser, fill, eyedropper — a brush width, the game's
thirty-two colours, undo and redo a gesture at a time, and for a *strip*:
frame buttons, a looping preview, Copy/Paste frame and a ghost of the frame
before. All of it is honest and small, and `pixel-editor.js` is already
arithmetic over bytes with the canvas kept out of it, which is what makes
everything below cheap to test.

## What it costs today, measured

At 1280 × 820 with a 64-square picture open under Code:

| band | height |
|---|---|
| file tree above | 160px |
| **the canvas** | **~190px** |
| tools, brush, palette, the colours hint | ~200px |
| the saved/size/undo bar | 40px |

The controls out-rank the picture. On a phone the picture now gets the whole
pane (the list folds away — commit `f1b1b4f`), which is most of what a phone
needed, but the same band problem is underneath it.

Seven things are missing outright:

- **Zoom.** The canvas is fitted to its box and that is the only size there
  is. At 256 in a phone pane that is about 1:1: one picture pixel, one screen
  pixel, and detail work is impossible. This is the one that makes the new
  cap uncomfortable rather than freeing.
- **Straight lines, rectangles, circles.** The three shapes a hand cannot do
  square by square.
- **Pixel-perfect strokes.** A freehand diagonal drawn through `drawLine`
  leaves an L-shaped double at every corner. Every pixel artist removes those
  by hand; every good editor removes them for you.
- **Selection.** Nothing can be moved after it is drawn. A sprite two pixels
  off-centre is redrawn or lived with.
- **Symmetry.** Most sprites are symmetric and every one is drawn twice.
- **Flip, rotate, nudge.**
- **Crop and resize** — the second half of the ask above. Today a 512-square
  upload opens and is drawn on at 512 forever; there is no way to bring it
  into the game's scale.

## The editors people love, and what to take from each

- **Aseprite** (paid, the de facto standard for game pixel art). Loved for
  its timeline — layers across frames — onion skinning, animation tags,
  indexed palettes, a **pixel-perfect** freehand mode, dithering, symmetry,
  and exporting a sheet. *Take*: pixel-perfect, symmetry, the shape tools,
  and its rule that every tool has a one-key shortcut.
- **Piskel** (free, browser, open source). Loved for needing no install, a
  frame strip beside the canvas, and a **live preview box that plays the
  animation while you draw**. *Take*: nothing — the studio already copied the
  live preview, and it is the best thing in the drawing pane.
- **Lospec Pixel Editor** (free, browser, from the palette site). Loved for
  being **palette-first**: you start from a named limited palette and the
  work looks coherent because of it. *Take*: the studio is already
  palette-first — `config/look.js` is the palette and it is the game's. What
  is missing is a **shelf of named palettes** to start a game from, the way
  there is a shelf of pictures.
- **Pixilart** (free, browser, plus a gallery). Loved for being the one a
  twelve-year-old opens and understands. *Take*: the fact that its default
  screen is a canvas and a palette and almost nothing else.
- **dotpict** (phone-first, iOS and Android). Loved because it is the only
  one designed for a **finger**: you drag anywhere on the screen to move a
  crosshair and tap to paint, so your hand is never over the pixel you are
  aiming at. *Take*: this, and try it before assuming a finger can hit a
  pixel. It is the answer to the TODO line that says a finger is not a
  pointer.
- **GraphicsGale / LibreSprite**. Loved by people who had them first. Nothing
  here they do that the four above do not.

## What to add, ranked

### Tier 1 — changes what can be made

1. **Zoom and pan.** A zoom level, two-finger pan, and Fit. ⚠️ The trap is
   `spotOf` in `drawing.js`: it turns a screen position into a square by
   undoing `object-fit: contain`, and the zoom has to enter that one function
   and nowhere else — every tool below reads its answer.
2. **Line, rectangle, ellipse**, each dragged out and drawn on release, with
   the shape previewed while the pointer is down. `drawLine` exists; the other
   two are the same integer arithmetic. Filled and outline both.
3. **Pixel-perfect freehand.** Where three pixels in a row make an L, drop the
   middle one. About fifteen lines, applied as the stroke closes, and testable
   without a screen like everything else in `pixel-editor.js`.
4. **Crop and resize.** Two array operations — a nearest-neighbour scale and a
   rectangle cut. ⚠️ Neither can be an undo step: a step is a list of *indexes*
   into a picture of a fixed width, so changing the width invalidates the whole
   stack. So both clear undo and redo, and both **save**, which makes the
   previous size a version — the studio's own undo, and the reason Versions
   exists. Say so in the dialog.

### Tier 2 — makes it feel like a real editor

5. **Rectangular selection**: drag a box, move what is in it, cut, copy,
   paste. Everything through `setPixel`, so it is one undoable gesture for
   free, the way `pasteFrame` already is.
6. **Mirror drawing**, vertical and horizontal. Ten lines inside `stamp`.
7. **Flip, rotate 90°, nudge one pixel.** All exact. Free rotation is not, and
   is out (below).
8. **A grid**, on above about 8× zoom, with an optional every-8 guide.
9. **Replace a colour** everywhere in the picture. The palette already edits in
   place; this is the picture half of the same idea.

### Tier 3 — worth having, not worth blocking on

10. **Frames a strip can gain and lose.** Today a strip's frame count is its
    width ÷ its height and cannot change: adding a frame means widening the
    PNG. Add, duplicate, delete and reorder, with the file's width recomputed.
    Same undo caveat as crop.
11. **Dither fill** — two colours in a checker, which is how pixel art makes a
    gradient.
12. **Tile preview**: draw a 32-square and see it repeated, for backgrounds.
13. **A palette shelf**: named limited palettes to start a game's `look.js`
    from, beside the shelf of pictures.

### Deliberately out

- **Layers.** A picture is a file (`spec/` §6). Layers need a project format
  beside the PNG, and a sidecar breaks on rename, duplicate and restore — the
  same argument that put a sound's note *inside* its `.wav`. The ghost already
  covers the case layers were wanted for.
- **Free rotation.** Not exact. A kid who rotates 30° and back has lost the
  sprite, and no undo stack survives being closed and reopened.
- **Anti-aliased brushes, opacity, blur.** They are what makes pixel art stop
  being pixel art. Thirty-two colours is the same decision.

## How to organize it

Three bands, and the canvas takes what the other two do not.

```
┌──────────────────────────────────────────────┐
│ ✏ ⌫ 🪣 💉 │ ╱ ▭ ◯ │ ⬚ │ ⋮⋮ ⊹ │  1 2 4 8 │ − ⊡ + │  tools
├──────────────────────────────────────────────┤
│                                              │
│                  the picture                 │  everything left
│                                              │
├──────────────────────────────────────────────┤
│ ▶ ▪▪▪▪  1 2 3 4  Whole strip  Ghost          │  frames (a strip only)
│ ████████████████████████████████  ▣          │  the palette
├──────────────────────────────────────────────┤
│ Saved   64 × 64                    ↶  ↷      │  the bar, as now
└──────────────────────────────────────────────┘
```

Three changes to what is there:

- **One tool bar, not three rows.** Draw/erase/fill/pick, then the shapes,
  then select, then the two toggles that are about *how* you draw
  (pixel-perfect, mirror), then zoom. It wraps on a narrow pane and scrolls
  sideways on a phone, like the mode pills already do.
- **The brush width belongs to the tool.** It shows for the tools that use
  one and is absent for the others, instead of standing in a row of its own.
  Same rule as the bar over a conversation: a control that cannot do anything
  is left out.
- **The colours go to the bottom**, next to the canvas rather than under two
  rows of buttons, with the `config/look.js` hint moved onto the well's title.
  That line is a sentence of explanation standing where a picture should be.

On a phone, three more: swatches to at least 28px so a finger can hit one
(they are ~21px now); the tool bar scrolling rather than wrapping to three
lines; and the **crosshair question** — dotpict's drag-to-aim, tap-to-paint,
which is the difference between a 1-pixel brush being usable with a finger
and not. That last one is a real experiment, not a setting: try it on the
phone before building it either way.

## Order of work

1. **The three bands.** Cheapest, and it makes every tool below have somewhere
   to live.
2. **Zoom and pan.** The biggest single win, and it settles `spotOf` once
   before anything else reads it.
3. **Crop and resize.** What the ask above wants, and independent of the rest.
4. **Pixel-perfect, then the shapes.**
5. **Selection and move.**
6. **Mirror, flip, rotate.**
7. **Frames a strip can gain and lose.**

Each is its own commit and each is testable in `pixel-editor.test.js` without
a screen, which is the whole reason the file was split the way it was.
