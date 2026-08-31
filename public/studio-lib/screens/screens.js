// The words around the game — for now, hint(): the how-to-play line, worked
// out from config/controls.js and the device it is read on, so it is never
// wrong. It is just a string:
//
//   el.textContent = Screens.hint();     // "Arrows / WASD to move · Space to fire"
//   ctx.fillText(Screens.hint(), x, y);  // canvas games too
//
// On a keyboard it names player1's keys. On a touchscreen it says the shape
// SCHEME draws — "Push the stick to move · GO to fire" — and nothing that is
// not on the screen. A plugged-in controller is folded into each part:
// "Space or A to fire". Call it whenever a screen is drawn — the answer
// changes when a controller arrives. The doing-words are the binding names,
// so renaming a binding renames the hint; start is left out on purpose —
// the screen that starts the game says how in its own words.
//
// A game that wants its own words sets one line in config/words.js:
//
//   howToPlay: "Steer with one finger", // shown as written, on every device
//
// hint() is the whole of it so far. Missing pieces are quiet: no
// config/controls.js, or nothing in it for this device, is an empty string,
// never an error. Load config/controls.js (and config/words.js if used)
// before the game code that calls this.

const Screens = (function () {
  "use strict";

  const DIRS = ["left", "right", "up", "down"];
  // Verbs that are not doing-words — "Space to action" helps nobody, so
  // these clauses are just the control itself: "Tap anywhere", "Space".
  const MUTE_VERBS = ["action", "tap"];

  function player1() {
    if (typeof CONTROLS === "object" && CONTROLS && typeof CONTROLS.player1 === "object") {
      return CONTROLS.player1;
    }
    return null;
  }

  function schemeName() {
    return typeof SCHEME === "string" ? SCHEME : "";
  }

  function ownWords() {
    if (typeof WORDS === "object" && WORDS && typeof WORDS.howToPlay === "string") {
      return WORDS.howToPlay.trim();
    }
    return "";
  }

  function bindings(value) {
    const out = [];
    if (typeof value !== "string") return out;
    for (const part of value.split(/\s+/)) {
      const at = part.indexOf(":");
      if (at > 0) out.push({ kind: part.slice(0, at), name: part.slice(at + 1) });
    }
    return out;
  }

  function has(tokens, kind, name) {
    for (const t of tokens) {
      if (t.kind === kind && (name === undefined || t.name === name)) return true;
    }
    return false;
  }

  // Player 1's verbs, shaped for saying: direction verbs gathered into
  // groups — left/right/up/down are "move", aim-left…aim-down are "aim" —
  // and the rest kept in declaration order. start is the title screen's own
  // business, never the hint's.
  function model() {
    const verbs = player1();
    if (!verbs) return null;
    const groups = [];
    const singles = [];
    for (const verb of Object.keys(verbs)) {
      if (verb === "start") continue;
      const tokens = bindings(verbs[verb]);
      const dash = verb.lastIndexOf("-");
      const dir = dash < 0 ? verb : verb.slice(dash + 1);
      if (DIRS.indexOf(dir) < 0) {
        singles.push({ verb: verb, tokens: tokens });
        continue;
      }
      const name = dash < 0 ? "" : verb.slice(0, dash);
      let group = null;
      for (const g of groups) if (g.name === name) group = g;
      if (!group) {
        group = { name: name, tokens: [] };
        groups.push(group);
      }
      for (const t of tokens) group.tokens.push(t);
    }
    return { groups: groups, singles: singles };
  }

  function verbText(verb) {
    return verb.replace(/[-_]+/g, " ");
  }

  function clause(names, verb) {
    const what = names.filter(Boolean).join(" or ");
    if (!what) return "";
    if (MUTE_VERBS.indexOf(verb) >= 0) return what;
    return what + " to " + verbText(verb);
  }

  function sentence(clauses) {
    return clauses.filter(Boolean).join(" · ");
  }

  function keyName(name) {
    if (name.length === 1) return name.toUpperCase();
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  // What a direction group answers to on the keyboard: the arrow keys
  // become "Arrows", single letters become "WASD" when that is what they
  // are, or are listed out.
  function groupKeys(tokens) {
    let arrows = false;
    const letters = [];
    for (const t of tokens) {
      if (t.kind !== "key") continue;
      if (DIRS.indexOf(t.name) >= 0) arrows = true;
      else if (t.name.length === 1 && letters.indexOf(t.name) < 0) letters.push(t.name);
    }
    const parts = [];
    if (arrows) parts.push("Arrows");
    if (letters.length > 0) {
      let wasd = true;
      for (const l of ["w", "a", "s", "d"]) if (letters.indexOf(l) < 0) wasd = false;
      parts.push(wasd ? "WASD" : letters.map((l) => l.toUpperCase()).join(" / "));
    }
    return parts.join(" / ");
  }

  function padIn() {
    if (typeof navigator !== "object" || !navigator || typeof navigator.getGamepads !== "function") {
      return false;
    }
    for (const pad of navigator.getGamepads()) if (pad) return true;
    return false;
  }

  // The controller's word for a direction group: a stick when one is bound,
  // the pad otherwise; the sticks named apart when the game uses both.
  function groupPad(tokens, two) {
    let stick = false;
    let stick2 = false;
    let dpad = false;
    for (const t of tokens) {
      if (t.kind !== "pad") continue;
      if (t.name.indexOf("stick2-") === 0) stick2 = true;
      else if (t.name.indexOf("stick-") === 0) stick = true;
      else if (DIRS.indexOf(t.name) >= 0) dpad = true;
    }
    if (stick) return two ? "the left stick" : "the stick";
    if (stick2) return "the right stick";
    if (dpad) return "the pad";
    return "";
  }

  function singleKey(tokens) {
    for (const t of tokens) if (t.kind === "key") return keyName(t.name);
    return "";
  }

  function singlePad(tokens) {
    for (const t of tokens) {
      if (t.kind !== "pad") continue;
      if (t.name.indexOf("stick") === 0 || DIRS.indexOf(t.name) >= 0) continue;
      return t.name.length <= 2 ? t.name.toUpperCase() : keyName(t.name);
    }
    return "";
  }

  function keySentence(m) {
    const pad = padIn();
    let sticks2 = false;
    for (const g of m.groups) {
      for (const t of g.tokens) if (t.kind === "pad" && t.name.indexOf("stick2-") === 0) sticks2 = true;
    }
    const clauses = [];
    for (const g of m.groups) {
      clauses.push(clause(
        [groupKeys(g.tokens), pad ? groupPad(g.tokens, sticks2) : ""],
        g.name === "" ? "move" : g.name,
      ));
    }
    for (const s of m.singles) {
      clauses.push(clause([singleKey(s.tokens), pad ? singlePad(s.tokens) : ""], s.verb));
    }
    return sentence(clauses);
  }

  function touchLabels(tokens) {
    const out = [];
    for (const t of tokens) {
      if (t.kind === "touch" && t.name !== "screen" && out.indexOf(t.name) < 0) out.push(t.name);
    }
    return out;
  }

  function stickAims(tokens) {
    for (const t of tokens) if (t.kind === "stick" && t.name.indexOf("aim-") === 0) return true;
    return false;
  }

  // Verbs held by pushing a stick at all — fire on stick:aim — are said as
  // part of that stick's clause: "the right stick to aim and fire".
  function pushedVerbs(singles, name) {
    const out = [];
    for (const s of singles) if (has(s.tokens, "stick", name)) out.push(verbText(s.verb));
    return out;
  }

  function touchSentence(m) {
    const scheme = schemeName();
    const clauses = [];
    if (scheme === "one-button") {
      for (const s of m.singles) {
        if (has(s.tokens, "touch", "screen")) return sentence([clause(["Tap anywhere"], s.verb)]);
      }
      return "";
    }
    if (scheme === "swipe-tap") {
      for (const g of m.groups) {
        if (has(g.tokens, "swipe")) clauses.push(clause(["Swipe"], g.name === "" ? "move" : g.name));
      }
      for (const s of m.singles) {
        if (has(s.tokens, "swipe", "tap")) clauses.push(clause(["tap"], s.verb));
      }
      return sentence(clauses);
    }
    // stick-buttons, dual-stick and no SCHEME at all share their parts: an
    // on-screen stick for a direction group that binds one, the arrow pad
    // for one that binds touch: directions, and the drawn buttons.
    const sticky = [];
    for (const g of m.groups) if (has(g.tokens, "stick")) sticky.push(g);
    for (let i = 0; i < sticky.length; i += 1) {
      const aim = stickAims(sticky[i].tokens);
      const which = sticky.length > 1 ? (aim ? "the right stick" : "the left stick") : "the stick";
      const doing = [sticky[i].name === "" ? "move" : verbText(sticky[i].name)]
        .concat(pushedVerbs(m.singles, aim ? "aim" : "move"));
      clauses.push((i === 0 ? "Push " : "") + which + " to " + doing.join(" and "));
    }
    for (const g of m.groups) {
      if (!has(g.tokens, "stick") && has(g.tokens, "touch")) {
        clauses.push(clause(["Arrows"], g.name === "" ? "move" : g.name));
      }
    }
    for (const s of m.singles) {
      if (has(s.tokens, "stick", "move") || has(s.tokens, "stick", "aim")) continue;
      const labels = touchLabels(s.tokens);
      if (labels.length > 0) clauses.push(clause([labels.join(" or ")], s.verb));
    }
    return sentence(clauses);
  }

  return {
    // The how-to-play line for this device, right now — or WORDS.howToPlay
    // as written. Cheap to call whenever a screen is drawn.
    hint() {
      const own = ownWords();
      if (own !== "") return own;
      const m = model();
      if (!m) return "";
      const coarse = typeof window === "object" && window.matchMedia
        && window.matchMedia("(pointer: coarse)").matches;
      const line = coarse ? touchSentence(m) : keySentence(m);
      return line === "" ? "" : line.charAt(0).toUpperCase() + line.slice(1);
    },
  };
}());

window.Screens = Screens;
