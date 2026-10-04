// Everything that changes while the game is played, in one place.
//
//   State.reset({ score: 0, lives: 3, ship: { x: 480, y: 540 }, rocks: [] }); // a new run
//   State.score += 10;                  // read and change it like any object
//   State.rocks.push({ x: 100, y: 0 });
//
// Keep every changing thing here — never in a variable, a closure or a class
// of the game's own — and keep it plain: numbers, words, true and false, and
// lists and groups of those. No functions, pictures, canvases or library
// objects: a picture is drawn by name, and a physics body is the physics
// library's. Reach through State every time (State.ship.x): a load replaces
// the pieces, so a piece kept in a variable of your own is left behind.
//
// That is what lets the studio's preview pin a moment and go back to it, and
// what makes a save file one call:
//
//   const file = State.save();          // the whole run, as text
//   State.load(file);                   // and back to it
//   State.loaded(() => show());         // after every load — redraw a page
//
// A library with state of its own keeps it beside the game's — the physics
// library keeps its bodies this way:
//
//   State.include("physics", save, load);
//
// reset, save, load, loaded and include are the whole of it, and none of them
// is part of the data: not in a save, not in a loop over State, and not a name
// a field of the game's may take.

const State = (function () {
  "use strict";

  const state = {};
  const parts = new Map(); // name -> { save, load }, a library's own
  const listeners = [];
  const CALLS = ["reset", "save", "load", "loaded", "include"];

  // One warning per thing, ever: a reset every run must not bury the console.
  const warned = new Set();
  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn("State: " + message);
  }

  // Everything the game put here goes; the calls stay.
  function fill(from) {
    for (const key of Object.keys(state)) delete state[key];
    if (!from || typeof from !== "object") return;
    for (const key of Object.keys(from)) {
      if (CALLS.indexOf(key) >= 0) {
        warnOnce("field:" + key, '"' + key + '" is one of State\'s own calls, so a field cannot use it');
        continue;
      }
      state[key] = from[key];
    }
  }

  function reset(fresh) {
    fill(fresh);
    return state;
  }

  // The game's data and every library's part, as one piece of text — or null,
  // with one warning, when something in it is not plain.
  function save() {
    try {
      const own = {};
      for (const [name, part] of parts) own[name] = part.save();
      return JSON.stringify({ state: state, parts: own });
    } catch (err) {
      warnOnce("save", "could not be saved — keep it to numbers, words, true and false, "
        + "and lists and groups of those (" + err.message + ")");
      return null;
    }
  }

  // Back to a save: the data replaced whole, each library's part handed back,
  // then whoever asked is told, so a page drawn from State can draw again.
  function load(file) {
    let saved;
    try {
      saved = typeof file === "string" ? JSON.parse(file) : file;
    } catch (err) {
      warnOnce("load", "that is not a save State made (" + err.message + ")");
      return false;
    }
    if (!saved || typeof saved !== "object") return false;
    fill(saved.state);
    for (const [name, part] of parts) {
      if (saved.parts && Object.prototype.hasOwnProperty.call(saved.parts, name)) {
        part.load(saved.parts[name]);
      }
    }
    for (const fn of listeners) fn();
    return true;
  }

  function loaded(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function include(name, saveFn, loadFn) {
    if (typeof name !== "string" || typeof saveFn !== "function" || typeof loadFn !== "function") {
      warnOnce("include", "include(name, save, load) wants a name and two functions");
      return;
    }
    parts.set(name, { save: saveFn, load: loadFn });
  }

  const calls = { reset, save, load, loaded, include };
  for (const name of CALLS) {
    Object.defineProperty(state, name, { value: calls[name], enumerable: false });
  }
  return state;
})();
