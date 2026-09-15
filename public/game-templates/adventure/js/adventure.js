// Plays the adventure in config/scenes.js: shows a scene's picture, works out
// which spot a click landed on, and does what the spot says — walk through,
// say a line, pick something up. The adventure itself lives in the config
// files — this file is only the machinery, and it can be changed like any
// other game code.
"use strict";

(function () {
  const root = document.getElementById("adventure");

  // The colours in config/look.js, handed to the stylesheet as the variables
  // it draws from. The same four the studio takes while this game is open, so
  // changing one there changes both.
  if (window.LOOK) {
    for (const name of ["primary", "accent", "highlight", "deep"]) {
      if (LOOK[name]) document.documentElement.style.setProperty("--" + name, LOOK[name]);
    }
  }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // What the game says happened, for achievements in config/achievements.js
  // (and the studio's own watching). A fact, never a request for a prize —
  // "scene" on each one entered, "item" when something is picked up, "switch"
  // when one is remembered, "ending" with the scene the adventure stopped on.
  const moment = (name, value) => { if (window.Moments) Moments.say(name, value); };

  // The stage is built once and only its contents change, so the picture is
  // not reloaded on every line.
  const picture = el("img", "picture");
  picture.alt = "";
  const spots = el("div", "spots");
  const bag = el("div", "bag");
  const box = el("div", "box");
  const say = el("p", "say");
  const more = el("span", "more", "▾");
  box.append(say, more);
  root.append(picture, spots, bag, box);

  const keys = Object.keys(SCENES);
  const switches = new Set();
  let carried = [];
  let at = keys[0];
  let lines = []; // what is still to be said, first line up
  let after = null; // what happens once the last line has been read

  const scene = () => SCENES[at] || {};
  const spotsOf = () => scene().spots || [];

  // A spot is usable when its need is met and, if it takes something, that
  // thing has not been taken already — a key you keep picking up would be a
  // strange key. keep: true is for the fountain you can drink from twice.
  const usable = (spot) => (!spot.need || switches.has(spot.need))
    && !(spot.take && !spot.keep && carried.includes(spot.take));

  // The first usable spot the point is in, top to bottom — which is what lets
  // two spots on one box be a locked door and then an open one.
  const spotAt = (x, y) => spotsOf().find((s) => usable(s)
    && Array.isArray(s.at) && s.at.length === 4
    && x >= s.at[0] && x < s.at[0] + s.at[2] && y >= s.at[1] && y < s.at[1] + s.at[3]);

  /* The picture and where its pixels are ------------------------------------ */

  function setPicture(src) {
    const want = src || "";
    if (picture.dataset.src === want) return;
    picture.dataset.src = want;
    picture.style.visibility = want ? "visible" : "hidden";
    if (want) picture.src = want;
    else picture.removeAttribute("src");
  }

  // The picture is drawn to fit (object-fit: contain), so the part of the
  // element it actually covers has to be worked out from its own size. The
  // spots layer is laid over exactly that part, so a click's place in it is a
  // place in the picture's own pixels.
  let drawn = { x: 0, y: 0, w: 1, h: 1, scale: 1 };
  function layout() {
    const nw = picture.naturalWidth || 1;
    const nh = picture.naturalHeight || 1;
    const cw = picture.clientWidth || 1;
    const ch = picture.clientHeight || 1;
    const scale = Math.min(cw / nw, ch / nh);
    drawn = {
      x: (cw - nw * scale) / 2, y: (ch - nh * scale) / 2, w: nw * scale, h: nh * scale, scale,
    };
    spots.style.left = drawn.x + "px";
    spots.style.top = drawn.y + "px";
    spots.style.width = drawn.w + "px";
    spots.style.height = drawn.h + "px";
  }
  picture.addEventListener("load", layout);
  window.addEventListener("resize", layout);

  // A point in the layer, in the picture's own pixels.
  const pointOf = (e) => {
    const r = spots.getBoundingClientRect();
    return { x: (e.clientX - r.left) / drawn.scale, y: (e.clientY - r.top) / drawn.scale };
  };

  /* What you carry ------------------------------------------------------------ */

  function paintBag() {
    bag.replaceChildren();
    bag.hidden = carried.length === 0;
    if (!carried.length) return;
    bag.append(el("span", "label", WORDS.carrying));
    for (const item of carried) {
      // A picture when somebody has drawn one, the word until then. An <img>
      // that fails to load is swapped for the word rather than a broken icon.
      const img = el("img");
      img.alt = item;
      img.title = item;
      img.src = "assets/sprites/" + item + ".png";
      img.addEventListener("error", () => img.replaceWith(el("span", "word", item)));
      bag.append(img);
    }
  }

  /* Saying things --------------------------------------------------------------- */

  function speak(what, then) {
    lines = Array.isArray(what) ? what.slice() : [what];
    after = then || null;
    showLine();
  }

  function showLine() {
    if (!lines.length) {
      box.hidden = true;
      const then = after;
      after = null;
      if (then) then();
      return;
    }
    say.textContent = lines[0];
    more.hidden = lines.length === 1 && !after;
    box.hidden = false;
  }

  function nextLine() {
    lines.shift();
    showLine();
  }

  /* Doing what a spot says ---------------------------------------------------- */

  function act(spot) {
    if (spot.sound && window.Sound) Sound.play(spot.sound);
    if (spot.set) { switches.add(spot.set); moment("switch", spot.set); }
    if (spot.take) {
      carried.push(spot.take);
      switches.add(spot.take);
      moment("item", spot.take);
      paintBag();
      if (spot.say) speak(spot.say);
      return;
    }
    if (spot.go) {
      if (SCENES[spot.go]) enter(spot.go);
      else finish();
      return;
    }
    if (spot.say) speak(spot.say);
  }

  function enter(key) {
    at = key;
    lines = [];
    after = null;
    box.hidden = true;
    // A scene with nothing to click on is the end: an adventure with nothing
    // drawn yet shows its title and then The End, never a blank stage.
    if (!spotsOf().length) { finish(); return; }
    moment("scene", key);
    setPicture(scene().picture);
    layout();
  }

  function finish() {
    // The scene the adventure stopped on: one with no spots, or a spot that
    // led nowhere. The value is its name — Moments.say("ending", "morning").
    moment("ending", at);
    if (window.Screens) {
      Screens.title({
        name: WORDS.theEnd, tagline: "", hint: "", start: WORDS.again, onStart: begin,
      });
    } else {
      begin();
    }
  }

  function begin() {
    switches.clear();
    carried = [];
    paintBag();
    enter(keys[0]);
  }

  /* Clicks ------------------------------------------------------------------------ */

  // A tap while something is being said reads on; otherwise it lands on the
  // picture, and the spot it is in — if it is in one — does its thing.
  root.addEventListener("click", (e) => {
    if (document.body.classList.contains("screens-open")) return;
    if (!box.hidden) { nextLine(); return; }
    if (!spots.contains(e.target) && e.target !== picture) return;
    const p = pointOf(e);
    const spot = spotAt(p.x, p.y);
    if (spot) act(spot);
    else speak(WORDS.nothing);
  });
  spots.addEventListener("pointermove", (e) => {
    const p = pointOf(e);
    spots.classList.toggle("hot", Boolean(spotAt(p.x, p.y)));
  });
  window.addEventListener("keydown", (e) => {
    // Not while a title or ending screen is up: the library marks the body
    // for exactly this, and without it the Enter that presses Start would
    // also read the first line behind it.
    if (document.body.classList.contains("screens-open")) return;
    if ((e.key === "Enter" || e.key === " ") && !box.hidden) { e.preventDefault(); nextLine(); }
  });

  // ?scene=<name> opens straight into one scene, skipping the title screen.
  // The studio's "Try this scene" button uses it; nothing else does, and a
  // name that is not a scene is ignored rather than showing an empty stage.
  const asked = new URLSearchParams(location.search).get("scene");
  paintBag();
  if (asked && SCENES[asked]) enter(asked);
  else if (window.Screens) Screens.title({ start: WORDS.start, onStart: begin });
  else begin();
}());
