// Things that fall, stack, roll, bounce and knock each other over, in the
// game's own pixels with y going down. Underneath is planck.js (Box2D, MIT,
// studio/planck.min.js and planck-license.txt) — this file is the studio's
// way in to it; the game's own code may use the `planck` global too.
//
//   Physics.world({ gravity: 900, bounce: 0.2, friction: 0.6 }); // optional
//   const bodies = Physics.build(BODIES);  // every entry of a config list
//   const ball = Physics.add({ kind: "ball", at: [150, 430], size: 14 });
//   Physics.fling(ball, 600, -400);        // its speed now, pixels a second
//   Physics.step(dt);                      // once a frame
//   Physics.onHit(function (a, b, speed) { if (speed > 300) Moments.say("crash"); });
//   for (const b of Physics.all()) draw(b); // b.x, b.y, b.angle, b.w, b.h, b.r
//
// A body is written the way config/bodies.js writes one: `at` its middle,
// `size` [width, height] for a box or one number, the radius, for a ball;
// `angle` in degrees; `still: true` for one that never moves (the ground, a
// ledge); `bounce`, `friction` and `weight` to override the world's. Any
// other key is the game's — `kind` above all — and rides along untouched:
// b.thing is the entry it was built from, b.kind a copy of its kind.
//
// Everything a game reads is on the body, fresh after every step: x, y and
// angle (radians, for ctx.rotate), vx and vy, w and h or r, still, and
// asleep once it has come to rest. Physics.at(x, y) is the body under a
// point, Physics.remove(b) takes one out, Physics.moving() is true while
// anything is still moving — how a turn knows the dust has settled — and
// Physics.clear() empties the world for a new level.
//
// step(dt) runs on a fixed clock of 60 steps a second whatever the frame
// rate, so a tower falls the same way on a phone and a laptop. onHit is
// called after the step, never inside it, so it may add or remove bodies;
// `speed` is how hard the two met, pixels a second along the push between
// them. Nothing here draws: the game draws each body where it is.
//
// Those calls are the whole of it. There is no body type to pick, no fixture
// and no metres: size and still say it all. index.html loads
// studio/planck.min.js and then studio/physics.js, before the game's own.

const Physics = (function () {
  "use strict";

  const SCALE = 30; // pixels in a metre
  const STEP = 1 / 60;
  const MAX_STEPS = 4; // a slow frame catches up at most this far
  const RESTING = 5; // px/s below which a body counts as still

  const P = typeof planck !== "undefined" ? planck : null;
  if (!P) console.warn("Physics: studio/planck.min.js is not loaded before studio/physics.js");

  let settings = { gravity: 900, bounce: 0.2, friction: 0.6 };
  let world = null;
  let bodies = [];
  let hits = [];
  let listeners = [];
  let spare = 0;

  const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);

  function make() {
    world = new P.World({ gravity: P.Vec2(0, settings.gravity / SCALE) });
    // Queued, never answered here: planck locks the world while it steps.
    world.on("begin-contact", function (contact) {
      const a = contact.getFixtureA().getBody().getUserData();
      const b = contact.getFixtureB().getBody().getUserData();
      if (!a || !b) return;
      const normal = contact.getWorldManifold(null)?.normal;
      const va = a._b.getLinearVelocity();
      const vb = b._b.getLinearVelocity();
      const dx = va.x - vb.x;
      const dy = va.y - vb.y;
      const speed = normal ? Math.abs(dx * normal.x + dy * normal.y) : Math.hypot(dx, dy);
      hits.push([a, b, speed * SCALE]);
    });
  }

  function worldNow() {
    if (!world && P) make();
    return world;
  }

  function sync(b) {
    const p = b._b.getPosition();
    const v = b._b.getLinearVelocity();
    b.x = p.x * SCALE;
    b.y = p.y * SCALE;
    b.angle = b._b.getAngle();
    b.vx = v.x * SCALE;
    b.vy = v.y * SCALE;
    b.asleep = !b.still && !b._b.isAwake();
  }

  function add(thing) {
    const w = worldNow();
    if (!w || !thing || !Array.isArray(thing.at)) {
      console.warn("Physics.add: a body needs `at: [x, y]`", thing);
      return null;
    }
    const round = typeof thing.size === "number";
    const still = thing.still === true;
    const body = w.createBody({
      type: still ? "static" : "dynamic",
      position: P.Vec2(num(thing.at[0], 0) / SCALE, num(thing.at[1], 0) / SCALE),
      angle: (num(thing.angle, 0) * Math.PI) / 180,
    });
    const bw = round ? 0 : Math.max(1, num(thing.size?.[0], 20));
    const bh = round ? 0 : Math.max(1, num(thing.size?.[1], 20));
    const r = round ? Math.max(1, thing.size) : 0;
    body.createFixture(round ? P.Circle(r / SCALE) : P.Box(bw / 2 / SCALE, bh / 2 / SCALE), {
      density: num(thing.weight, 1),
      friction: num(thing.friction, settings.friction),
      restitution: num(thing.bounce, settings.bounce),
    });
    const b = {
      kind: thing.kind, thing, still, w: bw, h: bh, r,
      x: 0, y: 0, angle: 0, vx: 0, vy: 0, asleep: false, _b: body,
    };
    body.setUserData(b);
    sync(b);
    bodies.push(b);
    return b;
  }

  function step(dt) {
    if (!worldNow()) return;
    spare = Math.min(spare + Math.max(0, num(dt, 0)), STEP * MAX_STEPS);
    // A hair under, so 1/30 of a second is two steps and not one and a bit.
    while (spare >= STEP - 1e-9) {
      world.step(STEP, 8, 3);
      spare -= STEP;
    }
    for (const b of bodies) sync(b);
    const now = hits;
    hits = [];
    for (const [a, b, speed] of now) {
      if (bodies.indexOf(a) < 0 || bodies.indexOf(b) < 0) continue;
      for (const fn of listeners) fn(a, b, speed);
    }
  }

  function remove(b) {
    const i = bodies.indexOf(b);
    if (i < 0) return;
    bodies.splice(i, 1);
    world.destroyBody(b._b);
  }

  // A point inside a body: a ball by distance, a box in its own turned frame.
  function at(x, y) {
    for (let i = bodies.length - 1; i >= 0; i -= 1) {
      const b = bodies[i];
      const dx = x - b.x;
      const dy = y - b.y;
      if (b.r) {
        if (dx * dx + dy * dy <= b.r * b.r) return b;
        continue;
      }
      const c = Math.cos(-b.angle);
      const s = Math.sin(-b.angle);
      if (Math.abs(dx * c - dy * s) <= b.w / 2 && Math.abs(dx * s + dy * c) <= b.h / 2) return b;
    }
    return null;
  }

  return {
    world: function (opts) {
      settings = {
        gravity: num(opts?.gravity, 900),
        bounce: num(opts?.bounce, 0.2),
        friction: num(opts?.friction, 0.6),
      };
      bodies = [];
      hits = [];
      spare = 0;
      if (P) make();
    },
    build: function (list) {
      return (Array.isArray(list) ? list : []).map(add).filter(Boolean);
    },
    add: add,
    fling: function (b, vx, vy) {
      if (!b || b.still) return;
      b._b.setAwake(true);
      b._b.setLinearVelocity(P.Vec2(num(vx, 0) / SCALE, num(vy, 0) / SCALE));
      sync(b);
    },
    step: step,
    onHit: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    remove: remove,
    at: at,
    all: function () { return bodies.slice(); },
    moving: function () {
      return bodies.some((b) => !b.still && !b.asleep && Math.hypot(b.vx, b.vy) > RESTING);
    },
    clear: function () {
      for (const b of bodies.slice()) remove(b);
      hits = [];
      spare = 0;
    },
  };
})();
