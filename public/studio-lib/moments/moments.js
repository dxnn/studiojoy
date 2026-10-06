// Lets the game say what just happened, so achievements and the studio can
// listen. A moment is a fact — "this happened" — never a request for a prize.
//
//   Moments.say("level", 3);          // a number
//   Moments.say("ending", "good");    // a word, up to 100 characters
//   Moments.say("run-over");          // just that it happened, heard as true
//   const stop = Moments.on("level", (value) => { ... });   // listen; stop() ends it
//
// A name is a slug: lowercase letters, digits and dashes, up to 40. Anything
// else is one console warning and dropped. Saying one every frame is fine.
// Each is also a CustomEvent("moment") on the window with { name, value }.
// say and on are the whole of it: no register or init. config/achievements.js
// is where a moment becomes something a player earns.

const Moments = (function () {
  "use strict";

  const NAME = /^[a-z0-9-]{1,40}$/;
  const TEXT_MAX = 100;

  // One warning per name, ever: a bad say() on every frame would bury the
  // console the game's own problems are reported in.
  const warned = new Set();

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn("Moments: " + message);
  }

  // The value as it will be heard, or undefined when it cannot be.
  function heard(value) {
    if (value === undefined || value === null || value === true) return true;
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value === "string") return value.length <= TEXT_MAX ? value : undefined;
    return undefined;
  }

  function say(name, value) {
    if (typeof name !== "string" || !NAME.test(name)) {
      warnOnce(String(name), '"' + String(name) + '" is not a moment name: '
        + "lowercase letters, digits and dashes, up to 40");
      return;
    }
    const v = heard(value);
    if (v === undefined) {
      warnOnce(name, '"' + name + '" was said with a value that is not a number, '
        + "a piece of text up to 100 characters, or nothing");
      return;
    }
    if (typeof CustomEvent !== "function" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent("moment", { detail: { name: name, value: v } }));
  }

  function on(name, fn) {
    if (typeof fn !== "function" || typeof window.addEventListener !== "function") {
      return function () {};
    }
    const listener = function (event) {
      const d = event && event.detail;
      if (d && d.name === name) fn(d.value);
    };
    window.addEventListener("moment", listener);
    return function () { window.removeEventListener("moment", listener); };
  }

  return { say: say, on: on };
}());

window.Moments = Moments;
