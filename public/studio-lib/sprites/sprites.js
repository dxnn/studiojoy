// Draws the game's pictures by name, animated when one is a film strip.
//
//   Sprites.tick();                          // once a frame, at the top
//   Sprites.draw(ctx, "hero", x, y);         // assets/sprites/hero.png, x, y its top-left
//   Sprites.draw(ctx, "hero", x, y, { frame: 0, scale: 2, flip: true, fps: 12 });
//   Sprites.draw(ctx, "assets/images/sky.png", 0, 0);   // a still picture, by path
//
// A picture whose width is a whole multiple of its height is a strip of
// square frames — 64x16 is four — played at 8 a second: fps changes that,
// frame pins one, frames overrides the count. Any other shape is drawn whole.
// scale keeps pixels square; flip mirrors. A picture still loading draws
// nothing, and one that cannot load is a quiet console warning. tick and draw
// are the whole of it: no preload, init or list of sprites.

const Sprites = (function () {
  "use strict";

  // name -> { img, ready, warned }
  const cache = new Map();
  const DEFAULT_FPS = 8;
  // tick() is expected once per display frame; the clock reads in sixtieths
  // of a second, which is what a browser frame usually is.
  let clock = 0;

  const srcFor = (name) =>
    name.includes("/") || name.includes(".")
      ? name
      : "assets/sprites/" + name + ".png";

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
