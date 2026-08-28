# Spritesheet: the third library, and what the pixel editor learns

One picture holding many frames, drawn by name. The pieces mostly exist: the
pixel editor already draws PNGs at any size up to 1024, the config form
already edits nested tables with comments, and a library is a file plus a
header note plus an `index.json` entry.

## The model (proposed): one sheet, uniform cells, a row per sprite

`config/sprites.js` — the game's own file, seeded by the library:

```js
// The picture the sprites live in. Draw it with "+ Draw a picture".
const SHEET = "assets/sprites.png";
// How big one cell is, in pixels. Every sprite uses the same size.
const CELL = 16;
// One line per sprite: which row of the sheet, and how many frames across.
const SPRITES = {
  hero: { row: 0, frames: 4 },   // walks
  rock: { row: 1, frames: 1 },   // just sits there
};
```

Row = sprite, columns = frames, one cell size for the whole sheet. Rejected
for v0: free rectangles ({x, y, w, h}) — flexible, but the config stops being
a thing a kid fills in, and the editor overlay stops being a grid.

## The library: `studio/sprites.js`

```js
Sprites.tick();                            // once a frame, like Input.update()
Sprites.draw(ctx, "hero", x, y);           // current frame, animated
Sprites.draw(ctx, "hero", x, y, { frame: 0, scale: 2, flip: true });
```

- A shared animation clock advanced by `tick()`; frames cycle at a config
  `FPS` (default 8). Passing `frame` pins one.
- Resilient, surface closed (the house rules): the sheet still loading draws
  nothing rather than throwing; an unknown name warns once; smoothing is
  turned off so pixels stay square; those two calls are the whole of it — no
  preload, no init, the first draw loads the sheet.
- Tests in a vm with a fake canvas context and Image, like the sound player.

## The editor: the pixel editor grows a grid

When the open PNG is the one `config/sprites.js` names as `SHEET`, the pixel
editor overlays the cell grid and labels each row with the sprite names that
claim it. Drawing is unchanged — the overlay is paint on top, not a mode.
Naming sprites is editing `config/sprites.js`, which the config form already
does. Deferred to a later pass: an animation preview (play the row under the
cursor), and an "add a row" that grows the PNG by `CELL`.

## Seeds and the starter sheet

Seed `config/sprites.js` only. No starter PNG: library seeds go through
`res.text()` today (`installLibrary` in main.js), so a binary seed would be
corrupted — and "+ Draw a picture" already creates the sheet at any size,
which keeps the first sheet a thing a kid drew rather than a placeholder to
delete. If a binary seed is ever wanted, install and scaffold both need a
bytes path first.

## Open questions

- Does `draw` take a plain `ctx` first argument, or does the library find the
  game's canvas itself? Passing `ctx` is more honest and works with any
  number of canvases; finding it is one less thing to type. Proposed: pass it.
- Per-sprite `fps` override in the config, or one global? Proposed: global
  `FPS` with per-sprite override allowed later without breaking anything.
- GLOSSARY entries (**spritesheet**, and whatever the overlay is called) when
  it lands.
