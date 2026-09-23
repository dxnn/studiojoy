// A game drawn in 3D: boxes and balls in the game's own colours, lit, with a
// camera that follows what matters. Underneath is three.js (MIT,
// studio/three.module.js and three.core.js, three-license.txt); this file is
// the studio's way in to it, and the game's own code may use THREE too.
//
// ⚠️ It is a module, so its tag is <script type="module" src="studio/render3d.js">,
// after every classic script, and the game's own code that uses it is a
// module too, after it: <script type="module" src="js/game.js">. Modules run
// in order once the page has loaded, so Input, Screens and config/ are there.
//
//   Screens.fit(document.getElementById("wrap"));  // first: fit reads 960 × 600
//   Render3D.start(canvas, { sky: LOOK.SKY });
//   Render3D.boxes([[0, 0, 0], [1, 0, 0]], { size: [1, 0.2, 1], colour: "#556" });
//   const ball = Render3D.ball({ at: [0, 1, 0], size: 0.3, colour: LOOK.primary });
//   const wall = Render3D.box({ at: [2, 0.5, 0], size: [1, 1, 1], colour: "#889" });
//   Render3D.follow(ball, { back: 6, up: 5 });
//   ball.position.set(x, y, z);                     // a thing is a THREE.Mesh
//   Render3D.draw(dt);                              // once a frame, last
//
// Up is y. Across is x and toward the camera is z, so a level read from the
// top of a file down is rows going toward the player. Sizes are whole-world
// units — a floor square is 1 — not pixels. `at` is a thing's middle.
//
// boxes(list, { size, colour }) draws many of the same box as one thing —
// a floor, a maze's walls — which is how a phone keeps up; it answers the
// one mesh, and `list` is places. box and ball answer a mesh each, to move,
// turn (mesh.rotation.y) or hide (mesh.visible = false); remove(thing) takes
// one out, clear() empties the scene for a new level. follow(thing, { back,
// up, ease }) keeps the camera behind and above it, easing after it; without
// follow, look(from, to) places the camera once.
//
// The drawing buffer is sized from the canvas's box on the page, at most
// twice the screen's pixels, and kept right as it resizes, so nothing sizes
// the canvas but Screens.fit. The picture is kept after every frame, so the
// studio can see what the player sees. Those calls are the whole of it: no
// renderer, scene, camera or light to make. There are no models or shadows
// yet — a thing is a box or a ball.

import * as THREE from "./three.module.js";

const Render3D = (function () {
  "use strict";

  const MAX_RATIO = 2;
  let renderer = null;
  let scene = null;
  let camera = null;
  let followed = null;
  let follow = { back: 6, up: 5, ease: 4 };
  const materials = new Map();

  const material = (colour) => {
    const key = String(colour || "#cccccc");
    if (!materials.has(key)) materials.set(key, new THREE.MeshLambertMaterial({ color: key }));
    return materials.get(key);
  };
  const place = (mesh, at) => {
    if (Array.isArray(at)) mesh.position.set(Number(at[0]) || 0, Number(at[1]) || 0, Number(at[2]) || 0);
    return mesh;
  };
  const sizeOf = (size) => (Array.isArray(size) ? size.map((n) => Number(n) || 1) : [1, 1, 1]);

  function fitBuffer() {
    if (!renderer) return;
    const canvas = renderer.domElement;
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    renderer.setPixelRatio(Math.min(MAX_RATIO, window.devicePixelRatio || 1));
    // false: the buffer only. The canvas's CSS size is Screens.fit's.
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function start(canvas, options) {
    const o = options || {};
    if (!canvas || canvas.tagName !== "CANVAS") {
      console.warn("Render3D.start: it needs the game's <canvas>");
      return;
    }
    // preserveDrawingBuffer keeps the last frame readable after it is shown,
    // which is how the studio's look at the game sees more than black.
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    scene = new THREE.Scene();
    scene.background = new THREE.Color(o.sky || "#1b2140");
    if (o.fog) scene.fog = new THREE.Fog(o.sky || "#1b2140", Number(o.fog) || 20, (Number(o.fog) || 20) * 2.5);
    camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.1, 200);
    camera.position.set(0, 6, 8);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 10, 6);
    scene.add(sun);
    fitBuffer();
    if (typeof ResizeObserver === "function") new ResizeObserver(fitBuffer).observe(canvas);
  }

  const ready = (what) => {
    if (scene) return true;
    console.warn("Render3D." + what + ": call Render3D.start(canvas) first");
    return false;
  };

  function box(o) {
    if (!ready("box")) return null;
    const [w, h, d] = sizeOf(o && o.size);
    const mesh = place(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(o && o.colour)), o && o.at);
    scene.add(mesh);
    return mesh;
  }

  function ball(o) {
    if (!ready("ball")) return null;
    const r = Number(o && o.size) || 0.5;
    const mesh = place(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), material(o && o.colour)), o && o.at);
    scene.add(mesh);
    return mesh;
  }

  function boxes(list, o) {
    if (!ready("boxes") || !Array.isArray(list) || list.length === 0) return null;
    const [w, h, d] = sizeOf(o && o.size);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), material(o && o.colour), list.length);
    const m = new THREE.Matrix4();
    list.forEach((at, i) => {
      m.makeTranslation(Number(at[0]) || 0, Number(at[1]) || 0, Number(at[2]) || 0);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  function aim(dt) {
    if (!followed) return;
    const p = followed.position;
    const want = new THREE.Vector3(p.x, p.y + follow.up, p.z + follow.back);
    // Eased, and never past the thing: a big frame gap jumps straight there.
    const t = Math.min(1, follow.ease * (Number(dt) || 0));
    camera.position.lerp(want, dt === undefined ? 1 : t);
    camera.lookAt(p.x, p.y, p.z);
  }

  return {
    start: start,
    box: box,
    ball: ball,
    boxes: boxes,
    remove: function (thing) {
      if (!thing || !scene) return;
      scene.remove(thing);
      if (thing === followed) followed = null;
    },
    clear: function () {
      if (!scene) return;
      for (const child of scene.children.slice()) {
        if (child.isMesh) scene.remove(child);
      }
      followed = null;
    },
    follow: function (thing, o) {
      followed = thing || null;
      follow = {
        back: Number(o && o.back) || 6,
        up: Number(o && o.up) || 5,
        ease: Number(o && o.ease) || 4,
      };
      aim();
    },
    look: function (from, to) {
      if (!ready("look")) return;
      followed = null;
      camera.position.set(from[0], from[1], from[2]);
      camera.lookAt(to[0], to[1], to[2]);
    },
    draw: function (dt) {
      if (!renderer) return;
      aim(dt);
      renderer.render(scene, camera);
    },
  };
})();

window.Render3D = Render3D;
window.THREE = THREE;
