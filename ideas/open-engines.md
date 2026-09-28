# Open engines: free-form games on three.js and real physics

A sketch, 2026-09-28. Not decided. The ask: keep the explicit editors (Level,
World, Track) for the templates that have them, and also let a person and the
builder make *any* game on three.js and a physics engine — 2D or 3D — in a
game that opts in.

## What there is today

- Two extras, each a **façade** over a vendored engine (spec/06-studio-library.md):
  **physics** over planck.js 1.5 (2D, 297 KB), and **render3d** over three.js
  r186 (2.1 MB unminified, a module). Each tells the builder its API in the top
  comment of its file, which rides the preamble for games that hold it
  (≤ 4,096 characters, `NOTE_BYTES`).
- The façades are deliberately closed. render3d owns the renderer, the scene,
  the camera and the lights and never hands them out; its shape line forbids a
  renderer, camera or light of the game's own. physics hides fixtures, joints,
  forces, sensors and raycasts. planck is reachable anyway (the `planck`
  global, `b._b`), and three.js through `window.THREE`, but only as far as
  `mesh.add(child)` reaches.
- No 3D physics anywhere. Roll a ball rolls its own circle on a grid, on
  purpose (ideas/modularity.md).
- An extra gets into a game two ways: a template's `libraries`, or a person's
  `+ The <name> library` under Code → Add a file. The builder cannot add one.
- The compatibility law: version N+1 of a library runs every game N ran, or it
  is a new library under a new name. An engine's version is part of the name.

## The shape I would build

**Two layers, both kept.** The façades stay what they are, for the editor
templates and for a game that wants the easy path. Beside them, the *open*
layer: the engines themselves, named as extras, with the studio's few rules
said once in their notes.

1. **Open up render3d without breaking it.** Add `Render3D.scene()`,
   `Render3D.camera()` and `Render3D.renderer()`. Adding calls keeps every
   existing game running, so it is render3d 2, not a new library. A free-form
   game uses the studio's renderer — made with `preserveDrawingBuffer`, so
   `look_at_game` still sees the picture — and its own everything else. The
   shape line changes from "never make a renderer, camera or light" to "never
   make a *renderer*; the camera and lights are yours if you ask for them".
2. **A 3D physics extra: `physics3d`, over cannon-es.** Pure JavaScript, an ES
   module, MIT, one small dependency-free file, and the API a model already
   knows from years of examples. Its slow release pace (0.20 since 2022) is a
   feature under the compatibility law. The alternative is Rapier (Apache,
   WebAssembly): faster and better maintained, but a megabyte-plus of base64
   wasm, and an API that has changed between versions, which the law punishes.
   ⚠️ Sizes and versions here are from memory, not checked — the sandbox
   cannot reach npm. Check them before vendoring.
3. **Raw where the façade is thin.** For physics3d I would ship cannon-es
   itself plus a note, not a façade: a façade is what makes a template's editor
   possible, and a free-form game has no editor to serve. The note is the
   studio's rules — the fixed step, units in metres, one world per page, the
   version and what changed since the version a model is likely to know.
4. **Two templates that opt in, no editor.** *An empty 3D world* (render3d 2
   plus physics3d: a floor, a light, a ball you can push, the loop) and *An
   empty 2D world* (physics plus the raw planck note: a floor, a box, the
   loop). Each has a type brief saying the game is the builder's to write,
   the few rules, and where the numbers go (config/, as always). Their arc is
   the blank game's. They would appear in New game's "Start from" next to the
   editor templates.
5. **three.js add-ons through an import map.** OrbitControls, GLTFLoader and
   the rest import the bare name `three`. The 3D template's `index.html`
   carries `<script type="importmap">` mapping `three` to
   `./studio/three.module.js`, and the add-ons a game is likely to want are
   vendored under `studio/` with render3d. Models (`assets/models/`, already
   served) start loading once GLTFLoader is there.

## Traps, known in advance

- **The picture.** A renderer the game makes itself is black to
  `look_at_game` without `preserveDrawingBuffer`. Point 1 is the fix; the note
  has to say it.
- **The size.** `Screens.fit` once, before the renderer starts, exactly as
  render3d says today. The same trap for anybody's renderer.
- **The version drift.** The builder writes three.js as it learned it. r150+
  renamed colour management, dropped `Geometry` and moved add-ons. The note
  names the renames that matter; that is most of what an open engine's note
  is for.
- **Phones.** Vendor three.js minified (~700 KB rather than 2.1 MB).
  TODO.md already asks for Roll a ball on an old phone.
- **The cache.** Notes ride only in games that hold the library, so a longer
  note moves no other game's prompt prefix (ideas/modularity.md).
- **No CDN, ever.** The games origin sends no CSP, so nothing technically stops
  an import from a CDN. The rule is policy: a game never depends on somebody
  else's server being up. Engines are vendored.

## Questions

1. cannon-es or Rapier for 3D physics? I would pick cannon-es, for the
   compatibility law and the size.
2. Two empty templates, or one "empty world" with a 2D/3D choice in the New
   game dialog? I would pick two: each carries its own page, its own tags and
   its own brief.
3. Should a person be able to add `physics3d` to *any* game (the existing
   `+ The <name> library` button), or only through the empty-3D template? The
   button works for any extra today; a 3D engine without render3d is odd but
   harmless.
