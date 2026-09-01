// Reads the story in config/story.js: shows a scene, says its lines one at a
// time, and offers its choices. The story itself lives in the config files —
// this file is only the machinery, and it can be changed like any other game
// code.
"use strict";

(function () {
  const root = document.getElementById("story");

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

  // The stage is built once and only its contents change: rebuilding it would
  // reload the background picture on every line and make the story flicker.
  const picture = el("img", "picture");
  picture.alt = "";
  const portrait = el("img", "portrait");
  portrait.alt = "";
  const who = el("p", "who");
  const say = el("p", "say");
  const more = el("span", "more", "▾");
  const choices = el("div", "choices");
  // Inside the box, not over it: three choices under a long line used to sit
  // on top of the words that led to them.
  const box = el("div", "box");
  box.append(who, say, choices, more);
  root.append(picture, portrait, box);

  const keys = Object.keys(SCENES);
  const switches = new Set();
  let at = keys[0];
  let line = 0;
  let waiting = false; // true while the choices are up: a tap must not skip them

  const scene = () => SCENES[at] || {};
  const lines = () => scene().lines || [];

  function setPicture(node, src) {
    // Only when it changes, or the browser restarts the load and the picture
    // blinks between two lines of the same scene.
    const want = src || "";
    if (node.dataset.src === want) return;
    node.dataset.src = want;
    node.style.visibility = want ? "visible" : "hidden";
    if (want) node.src = want;
    else node.removeAttribute("src");
  }

  function enter(key) {
    at = key;
    line = 0;
    waiting = false;
    if (scene().sound && window.Sound) Sound.play(scene().sound);
    show();
  }

  function show() {
    setPicture(picture, scene().picture);
    const current = lines()[line] || {};
    const person = current.who ? (CAST[current.who] || {}) : null;
    who.textContent = person ? (person.name || current.who) : "";
    who.style.display = person ? "" : "none";
    say.textContent = current.say || "";
    setPicture(portrait, person && current.mood
      ? "assets/sprites/" + current.who + "-" + current.mood + ".png"
      : "");

    // What happens after the last line: choices, straight on, or the end.
    const last = line >= lines().length - 1;
    const offered = last ? (scene().choices || []).filter(
      (c) => !c.need || switches.has(c.need)
    ) : [];
    waiting = offered.length > 0;
    more.style.visibility = waiting || (last && !scene().go) ? "hidden" : "visible";

    choices.replaceChildren();
    for (const choice of offered) {
      const button = el("button", "choice", choice.say);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        if (choice.set) switches.add(choice.set);
        if (SCENES[choice.go]) enter(choice.go);
        else finish();
      });
      choices.append(button);
    }
  }

  function next() {
    if (waiting) return;
    if (line < lines().length - 1) { line += 1; show(); return; }
    if (scene().go && SCENES[scene().go]) { enter(scene().go); return; }
    finish();
  }

  function finish() {
    if (window.Screens) {
      Screens.title({
        name: WORDS.theEnd,
        tagline: "",
        hint: "",
        start: WORDS.again,
        onStart: begin,
      });
    } else {
      begin();
    }
  }

  function begin() {
    switches.clear();
    enter(keys[0]);
  }

  root.addEventListener("click", next);
  window.addEventListener("keydown", (e) => {
    // Not while a title or ending screen is up: the library marks the body
    // for exactly this, and without it the Enter that presses Start would
    // also step the first line of the story behind it.
    if (document.body.classList.contains("screens-open")) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); }
  });

  // ?scene=<name> opens straight into one scene, skipping the title screen.
  // The studio's "Try this scene" button uses it; nothing else does, and a
  // name that is not a scene is ignored rather than showing an empty stage.
  const asked = new URLSearchParams(location.search).get("scene");
  if (asked && SCENES[asked]) enter(asked);
  else if (window.Screens) Screens.title({ start: WORDS.start, onStart: begin });
  else begin();
}());
