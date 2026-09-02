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

  // What the game says happened, for achievements in config/achievements.js
  // (and the studio's own watching). A fact, never a request for a prize —
  // "scene" on each one reached, "switch" when a choice sets one, "ending"
  // with the scene the story stopped on.
  const moment = (name, value) => { if (window.Moments) Moments.say(name, value); };

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

  // The track playing behind the scene, so it is only changed when it has to
  // be. Sound.loop() leaves a loop that is already going alone, which is what
  // lets music carry from one scene into the next without restarting; a scene
  // asking for a different track, or for none, stops the old one first.
  // Quieter than a sound effect, because people are talking over it.
  let playing = "";

  function setMusic(track) {
    const want = track || "";
    if (want === playing) return;
    if (playing && window.Sound) Sound.stop(playing);
    playing = want;
    if (want && window.Sound) Sound.loop(want, 0.4);
  }

  // A line that is only { sound: "page" } is a noise rather than something to
  // read: it plays the moment it is passed and the story carries straight on,
  // because waiting for a tap would leave the box empty for a beat. Plays
  // every sound from `from` up to the next thing somebody says, and answers
  // where the reader lands — which is past the end when only noises are left.
  function soundsFrom(from) {
    let i = from;
    while (i < lines().length && lines()[i].sound) {
      if (window.Sound) Sound.play(lines()[i].sound);
      i += 1;
    }
    return i;
  }

  function enter(key) {
    at = key;
    line = 0;
    waiting = false;
    // A scene with nothing in it — no lines, no choices, nowhere to go — is
    // the end: a story with nothing written yet shows its title and then The
    // End, never a blank stage.
    if (!lines().length && !(scene().choices || []).length && !scene().go) { finish(); return; }
    moment("scene", key);
    setMusic(scene().music);
    // The shape before a sound could happen part way through a scene, and it
    // meant "at the start". Still played, so a story the studio has not
    // re-saved sounds the way it always did.
    if (scene().sound && window.Sound) Sound.play(scene().sound);
    line = soundsFrom(0);
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
    // Nothing left to *say* is what makes it the last one — a noise after the
    // final line is still to come, and plays as the scene is left.
    const last = !lines().slice(line + 1).some((l) => !l.sound);
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
        // Any noise written after the last line happens as the scene is left,
        // which is here as much as it is on a tap.
        soundsFrom(line + 1);
        if (choice.set) { switches.add(choice.set); moment("switch", choice.set); }
        if (SCENES[choice.go]) enter(choice.go);
        else finish();
      });
      choices.append(button);
    }
  }

  function next() {
    if (waiting) return;
    // Where the next tap lands, playing whatever noise sits on the way. Past
    // the end means there was nothing more to say, so the scene is over.
    const to = soundsFrom(line + 1);
    if (to < lines().length) { line = to; show(); return; }
    if (scene().go && SCENES[scene().go]) { enter(scene().go); return; }
    finish();
  }

  function finish() {
    // The scene the story stopped on: a scene with no choices and no `go`, or
    // a choice that led nowhere. An ending is a scene like any other, so the
    // value is its name — Moments.say("ending", "the-good-one").
    moment("ending", at);
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
