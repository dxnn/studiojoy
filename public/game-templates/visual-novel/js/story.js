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

  // Where the reader is, kept in State (studio/state.js) — which is what lets
  // the studio's preview pin a moment and come back to it, and what its "Try
  // this scene" puts a scene into. The scene, the line in it, and the switches
  // the choices have set, as a list.
  const keys = Object.keys(SCENES);
  const newStory = () => ({ playing: false, scene: keys[0], line: 0, switches: [] });
  State.reset(newStory());

  // Not the story's: whether the choices are up — a tap must not skip them —
  // and the title or ending screen while one is up.
  let waiting = false;
  let screen = null;

  const scene = () => SCENES[State.scene] || {};
  const lines = () => scene().lines || [];
  const has = (name) => State.switches.indexOf(name) >= 0;

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
    State.scene = key;
    State.line = 0;
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
    State.line = soundsFrom(0);
    show();
  }

  function show() {
    setPicture(picture, scene().picture);
    const current = lines()[State.line] || {};
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
    const last = !lines().slice(State.line + 1).some((l) => !l.sound);
    const offered = last ? (scene().choices || []).filter(
      (c) => !c.need || has(c.need)
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
        soundsFrom(State.line + 1);
        if (choice.set) {
          if (!has(choice.set)) State.switches.push(choice.set);
          moment("switch", choice.set);
        }
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
    const to = soundsFrom(State.line + 1);
    if (to < lines().length) { State.line = to; show(); return; }
    if (scene().go && SCENES[scene().go]) { enter(scene().go); return; }
    finish();
  }

  function finish() {
    // The scene the story stopped on: a scene with no choices and no `go`, or
    // a choice that led nowhere. An ending is a scene like any other, so the
    // value is its name — Moments.say("ending", "the-good-one").
    moment("ending", State.scene);
    State.playing = false;
    if (window.Screens) {
      screen = Screens.title({
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
    screen = null;
    State.reset(newStory());
    State.playing = true;
    enter(keys[0]);
  }

  // Back to a pinned moment, or a scene the studio's "Try this scene" put the
  // story into: the screen in front goes, and the reader is where State says.
  // The first line of a scene is entering it — its music and its opening
  // noises — and any other is shown as it stands.
  State.loaded(function () {
    if (!State.playing) return;
    if (screen) { screen.close(); screen = null; }
    if (!SCENES[State.scene]) State.scene = keys[0];
    if (State.line === 0) { enter(State.scene); return; }
    setMusic(scene().music);
    show();
  });

  root.addEventListener("click", next);
  window.addEventListener("keydown", (e) => {
    // Not while a title or ending screen is up: the library marks the body
    // for exactly this, and without it the Enter that presses Start would
    // also step the first line of the story behind it.
    if (document.body.classList.contains("screens-open")) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); }
  });

  // Always from the title screen: there is no way in at a later scene from
  // the address, so a player cannot skip to an ending. The studio's preview
  // goes to one through State instead.
  if (window.Screens) screen = Screens.title({ start: WORDS.start, onStart: begin });
  else begin();
}());
