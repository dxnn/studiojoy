// Draws the pictures in assets/ by name, animated when the picture is a
// film strip: square frames side by side in one file.
//
//   Sprites.tick();                          // once a frame, at the top
//   Sprites.draw(ctx, "hero", x, y);         // draws assets/hero.png
//   Sprites.draw(ctx, "hero", x, y, { frame: 0, scale: 2, flip: true, fps: 12 });
//
// A picture whose width is a whole multiple of its height is a strip: a
// 64x16 file is four 16x16 frames, played in order at 8 frames a second —
// fps changes the speed, frame pins one. Any other shape is a single frame
// drawn whole, so a big backdrop is safe. scale enlarges without smoothing,
// pixels staying square; flip mirrors left-to-right; frames overrides the
// count for the rare strip whose frames are not square.
//
// Those two calls are the whole of it. There is no preload, no init and no
// list of sprites to declare — the name is the file, the first draw loads
// it, and a picture still loading draws nothing rather than crashing the
// game. A file that cannot load is one console warning, then silence. Make
// a strip with "+ Draw a picture" — pick how many frames — or upload one.

const Sprites = (function () {
  "use strict";

  // name -> { img, ready, warned }
  const cache = new Map();
  const DEFAULT_FPS = 8;
  // tick() is expected once per display frame; the clock reads in sixtieths
  // of a second, which is what a browser frame usually is.
  let clock = 0;

  const srcFor = (name) =>
    name.includes("/") || name.includes(".") ? name : "assets/" + name + ".png";

  function warnOnce(entry, name) {
    if (entry.warned) return;
    entry.warned = true;
    console.warn('Sprites: could not draw "' + name + '" (' + srcFor(name) + ")");
  }

  function entryFor(name) {
    let entry = cache.get(name);
    if (!entry) {
      entry = { img: new Image(), ready: false, warned: false };
      entry.img.addEventListener("load", function () { entry.ready = true; });
      entry.img.addEventListener("error", function () { warnOnce(entry, name); });
      entry.img.src = srcFor(name);
      cache.set(name, entry);
    }
    return entry;
  }

  return {
    tick() { clock += 1; },

    draw(ctx, name, x, y, opts) {
      const entry = entryFor(name);
      if (!entry.ready) return;
      const o = opts || {};
      const img = entry.img;
      const frames = o.frames
        || (img.width > img.height && img.width % img.height === 0
          ? img.width / img.height
          : 1);
      const fw = img.width / frames;
      const fps = o.fps === undefined ? DEFAULT_FPS : o.fps;
      const frame = o.frame === undefined
        ? Math.floor((clock * fps) / 60) % frames
        : o.frame % frames;
      const scale = o.scale === undefined ? 1 : o.scale;
      try {
        ctx.imageSmoothingEnabled = false;
        if (o.flip) {
          ctx.save();
          ctx.translate(x + fw * scale, y);
          ctx.scale(-1, 1);
          ctx.drawImage(img, frame * fw, 0, fw, img.height, 0, 0, fw * scale, img.height * scale);
          ctx.restore();
        } else {
          ctx.drawImage(img, frame * fw, 0, fw, img.height, x, y, fw * scale, img.height * scale);
        }
      } catch (err) {
        warnOnce(entry, name);
      }
    },
  };
}());

window.Sprites = Sprites;
