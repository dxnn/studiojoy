# Alternatives considered and rejected

Designs weighed against the ones actually built, and why each lost — kept
here rather than in the main flow so the reasoning survives without bulking
out the design-of-record. Each entry names where it applies; the current
design is documented there, not here.

### Sharing the studio library across games (spec/06-studio-library.md)

Three ways to share the studio library between games, each rejected on a
real failure mode:

- A **symlink** into a shared directory is refused by `listTree`'s `lstat`
  (a public-origin tree can't contain a sandbox escape), and dangles on a
  fresh clone anyway.
- A **submodule** records the version, but a plain `git clone` without
  `--recursive` leaves an empty directory, breaking any game meant to be
  cloned or published.
- A **shared route** on the games origin is always current but makes a game
  that only runs inside this studio.

The chosen design is real bytes, copied into the tree, versioned in history
— at the cost of drift, which the manifest makes visible rather than silent.

### Styling the screens library (spec/06-studio-library.md)

`@layer screens` was the first answer, and shipped for a while: an unlayered
rule beats a layered one at *any* specificity, so a game's own
`* { margin: 0; padding: 0 }` flattened every margin the layer had reset.
Bare `:where()` was the second answer, and lost the Start button to the
game's own `button { … }` instead. Neither failure showed up in a harness
page with no reset, which is the lesson worth keeping: a styling contract is
only tested against a stylesheet that did not expect it. The chosen design
weighs every injected rule at exactly one element selector
(`body :where(…)`) — see the specificity table in spec/06-studio-library.md.

### Packing sprites into a sheet (spec/06-studio-library.md)

A packed multi-sprite sheet was considered and rejected for the sprites
library: atlases exist for request-count and draw-call batching, neither of
which binds here, and the file is this studio's unit of naming, versioning,
diffing and thumbnailing — a kid edits `hero.png`, not a cell in a sheet.

### A font host for the screens library's typefaces (spec/06-studio-library.md)

A `<link>` to a font host was considered and rejected on the same grounds as
the shared route above: it makes a game that only looks right while
somebody else's server is up. The chosen design bundles the two typefaces
(Space Grotesk and Space Mono, OFL 1.1) beside the library instead.

### Undo in the pixel editor: diffing vs. replaying actions (spec/06-http-routes.md, Files)

The alternative to recording the pixels a stroke actually changed was a
stack of actions replayed over the base image. It stores less, but
`floodFill` is O(area) — replaying thirty fills to step back one is seconds
of work, which would need periodic keyframes. Diffing costs O(pixels
changed) in both directions instead: measured in a browser, a fill of a
670×330 background took 57 ms and undoing it took 8 ms. The chosen design
records each pixel a gesture touched, with its colour on both sides.

### Where a game's drawing palette lives (spec/06-http-routes.md, Files)

The first draft kept the palette in `localStorage`, which made a game's
colours a property of whichever browser had drawn in it. The chosen design
keeps it in the game's own `config/look.js` instead — a colour change is a
commit on the game, appears in Versions, and a helper reads the same list.
