// The words around the game: a how-to-play hint, the title and game-over
// screen, and the HUD strip.
//
//   ctx.fillText(Screens.hint(), x, y);  // "Arrows / WASD to move · Space to fire"
//
// The hint is a string, worked out from config/controls.js and the device
// it is read on, so it is never wrong: a keyboard gets player1's keys; a
// touchscreen the shape SCHEME draws — "Push the stick to move · GO to
// fire" — and nothing that is not on the screen; a plugged-in controller is
// folded in ("Space or A to fire"). The doing-words are the binding names;
// start is left out on purpose. A game that wants its own words sets one
// line in config/words.js:
//
//   howToPlay: "Steer with one finger", // shown as written, on every device
//
//   Screens.title({ onStart: start });            // a phone-fit title screen
//   Screens.title({ score: 12, onStart: start }); // game over — Play again
//
// title() fills the window over the game: the name (WORDS.title, else the
// page title), WORDS.tagline, one focused Start button — Enter starts on a
// keyboard, the drawn touch controls step aside while the screen is up, and
// a tap on the button also reaches Input as one frame of "start" — and the
// hint under it. A
// score shows big and the button says Play again (WORDS.again). Any of it
// can be passed instead: { name, tagline, hint, start, score, onStart } —
// arguments beat config. Colours follow LOOK; screens- classes are the css
// hooks. Returns { close }, for a game that starts from
// Input.pressed("start"). DOM only, gone when closed.
//
//   Screens.chips({ Score: 12, Lives: 3 }); // the HUD strip, top of screen
//
// chips() is cheap to call every frame: built once, only changed text is
// touched. Each call says the whole strip — a key not named is removed, and
// chips({}) clears it. Labels are your words; values wear the look's
// highlight; taps fall through to the game.
//
// Missing pieces are quiet — an empty string or a no-op, never an error.
// Load config/controls.js before the game code that calls this.

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
      if ((t.kind === "touch" || t.kind === "toggle") && t.name !== "screen"
        && out.indexOf(t.name) < 0) out.push(t.name);
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
      if (labels.length === 0) continue;
      const what = labels.join(" or ");
      // "FIRE to fire" helps nobody: a button wearing its own verb is enough.
      clauses.push(what.toLowerCase() === verbText(s.verb) ? what : clause([what], s.verb));
    }
    return sentence(clauses);
  }

  // The how-to-play line for this device, right now — or WORDS.howToPlay
  // as written. Cheap to call whenever a screen is drawn.
  function hint() {
    const own = ownWords();
    if (own !== "") return own;
    const m = model();
    if (!m) return "";
    const coarse = typeof window === "object" && window.matchMedia
      && window.matchMedia("(pointer: coarse)").matches;
    const line = coarse ? touchSentence(m) : keySentence(m);
    return line === "" ? "" : line.charAt(0).toUpperCase() + line.slice(1);
  }

  // The stylesheet, injected once. Class names are the styling hooks: a
  // game's own css can restyle any screens- part without replacing the
  // call. The shapes are the phone lessons: type clamped to the viewport so
  // a long name can never overflow a narrow screen, the panel centred with
  // auto margins inside a scrolling box — centred when it fits, scrolled
  // from the top when tall, never clipped at both ends the way flex
  // centering clips — and safe-area padding for notches. The chips row
  // takes no pointer events: a tap on the HUD is a tap on the game.
  const SCREENS_CSS = ""
    + ".screens-title-screen{position:fixed;inset:0;z-index:9998;overflow:auto;display:flex;"
    + "background:var(--screens-deep,rgba(14,14,22,.93));color:#fff;text-align:center;"
    + "font-family:system-ui,sans-serif}"
    + ".screens-panel{margin:auto;box-sizing:border-box;width:min(34rem,100%);"
    + "padding:calc(24px + env(safe-area-inset-top,0px)) calc(20px + env(safe-area-inset-right,0px)) "
    + "calc(24px + env(safe-area-inset-bottom,0px)) calc(20px + env(safe-area-inset-left,0px))}"
    + ".screens-name{margin:0;font-size:clamp(28px,9vw,60px);line-height:1.1;letter-spacing:.03em;"
    + "overflow-wrap:break-word;color:var(--screens-primary,#fff)}"
    + ".screens-tagline{margin:12px 0 0;font-size:clamp(15px,4vw,20px);opacity:.8;"
    + "color:var(--screens-accent,inherit)}"
    + ".screens-score{margin:18px 0 0;font-size:clamp(32px,10vw,64px);font-weight:700;"
    + "color:var(--screens-highlight,#ffd76a)}"
    + ".screens-start{display:inline-block;margin:26px 0 0;min-height:52px;padding:12px 34px;"
    + "font:600 clamp(17px,4.5vw,22px)/1.2 system-ui,sans-serif;color:#fff;cursor:pointer;"
    + "background:rgba(18,18,26,.42);border:2px solid var(--screens-primary,rgba(255,255,255,.8));"
    + "border-radius:999px}"
    + ".screens-start:active{background:rgba(18,18,26,.78)}"
    + ".screens-hint{margin:22px 0 0;font-size:clamp(13px,3.5vw,16px);opacity:.75}"
    + ".screens-chips{position:fixed;top:0;left:0;right:0;z-index:9997;display:flex;"
    + "flex-wrap:wrap;justify-content:center;gap:8px;pointer-events:none;"
    + "padding:calc(10px + env(safe-area-inset-top,0px)) 12px 0;"
    + "font-family:system-ui,sans-serif}"
    + ".screens-chip{display:flex;align-items:baseline;gap:6px;padding:4px 12px;"
    + "border-radius:999px;background:rgba(18,18,26,.42);"
    + "border:1px solid rgba(255,255,255,.25);color:#fff;font-size:clamp(12px,3vw,14px)}"
    + ".screens-chip-label{opacity:.7}"
    + ".screens-chip-value{font-weight:700;font-size:clamp(14px,3.6vw,17px);"
    + "color:var(--screens-highlight,#ffd76a)}";

  let styleDone = false;

  function injectStyle() {
    if (styleDone || typeof document !== "object" || !document.head) return;
    const style = document.createElement("style");
    style.textContent = SCREENS_CSS;
    document.head.append(style);
    styleDone = true;
  }

  function lookColours(node) {
    if (typeof LOOK !== "object" || !LOOK) return;
    for (const part of ["primary", "accent", "highlight", "deep"]) {
      if (typeof LOOK[part] === "string" && LOOK[part] !== "") {
        node.style.setProperty("--screens-" + part, LOOK[part]);
      }
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function wordsValue(key) {
    if (typeof WORDS === "object" && WORDS && typeof WORDS[key] === "string") {
      return WORDS[key];
    }
    return "";
  }

  // One title screen at a time: a new call replaces the one on screen.
  let openTitle = null;

  // While a screen is up the body wears "screens-open": the input library
  // hides its drawn controls under it and drops what thumbs were holding.
  // Either library missing the other simply leaves things as they are.
  function markBody(open) {
    if (typeof document !== "object" || !document || !document.body) return;
    const list = document.body.classList;
    if (!list) return;
    if (open) list.add("screens-open");
    else list.remove("screens-open");
  }

  // The Start button's tap, said to the input library, so a game that waits
  // on Input.pressed("start") starts from it too — one frame, like a key.
  function sayStart() {
    try {
      if (typeof Event === "function" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new Event("studio:start"));
      }
    } catch (e) { /* an environment with no events has nobody to tell */ }
  }

  function title(opts) {
    const o = typeof opts === "object" && opts ? opts : {};
    if (typeof document !== "object" || !document || !document.body) {
      return { close: function () {} };
    }
    injectStyle();
    if (openTitle) openTitle.close();

    const over = typeof o.score === "number";
    const name = typeof o.name === "string" ? o.name
      : wordsValue("title") || (typeof document.title === "string" ? document.title : "");
    const tagline = typeof o.tagline === "string" ? o.tagline : wordsValue("tagline");
    const line = typeof o.hint === "string" ? o.hint : hint();
    const label = typeof o.start === "string" ? o.start
      : wordsValue(over ? "again" : "start") || (over ? "Play again" : "Start");

    const root = el("div", "screens-title-screen");
    lookColours(root);
    const panel = el("div", "screens-panel");
    if (name !== "") panel.append(el("h1", "screens-name", name));
    if (tagline !== "") panel.append(el("p", "screens-tagline", tagline));
    if (over) panel.append(el("div", "screens-score", String(o.score)));
    const button = el("button", "screens-start", label);
    panel.append(button);
    if (line !== "") panel.append(el("p", "screens-hint", line));
    root.append(panel);
    document.body.append(root);
    markBody(true);

    const handle = {
      close: function () {
        if (openTitle === handle) openTitle = null;
        root.remove();
        if (openTitle === null) markBody(false);
      },
    };
    openTitle = handle;
    // Closed before onStart runs, so a handler that puts up the next screen
    // is not wiped by the old one going away.
    button.addEventListener("click", function () {
      handle.close();
      sayStart();
      if (typeof o.onStart === "function") o.onStart();
    });
    button.focus();
    return handle;
  }

  // The HUD strip: one row of chips pinned to the top of the screen, built
  // on the first call and touched only where the text changed, so calling
  // it every frame costs nothing when nothing moved.
  let chipsRoot = null;
  let chipNodes = new Map(); // label -> { chip, value, text }

  function chips(values) {
    if (typeof document !== "object" || !document || !document.body) return;
    const o = typeof values === "object" && values ? values : {};
    const labels = Object.keys(o);
    if (labels.length === 0) {
      if (chipsRoot) {
        chipsRoot.remove();
        chipsRoot = null;
        chipNodes = new Map();
      }
      return;
    }
    injectStyle();
    if (!chipsRoot) {
      chipsRoot = el("div", "screens-chips");
      lookColours(chipsRoot);
      document.body.append(chipsRoot);
    }
    for (const [label, node] of chipNodes) {
      if (!(label in o)) {
        node.chip.remove();
        chipNodes.delete(label);
      }
    }
    for (const label of labels) {
      let node = chipNodes.get(label);
      if (!node) {
        const chip = el("span", "screens-chip");
        chip.append(el("span", "screens-chip-label", label));
        const value = el("span", "screens-chip-value", "");
        chip.append(value);
        chipsRoot.append(chip);
        node = { chip: chip, value: value, text: null };
        chipNodes.set(label, node);
      }
      const text = String(o[label]);
      if (node.text !== text) {
        node.text = text;
        node.value.textContent = text;
      }
    }
  }

  return { hint: hint, title: title, chips: chips };
}());

window.Screens = Screens;
