// The words around the game: a how-to-play hint, the title and game-over
// screen, the HUD strip, and snippets to put inside them — the scoreboard
// most of all.
//
//   ctx.fillText(Screens.hint(), x, y);  // "Arrows / WASD to move · Space to fire"
//
// hint() is a string worked out from config/controls.js and the device, so it
// is never wrong: a keyboard gets player1's keys, a touchscreen the shape
// SCHEME draws and nothing that is not on the screen, a plugged-in controller
// is folded in. The doing-words are the binding names; start is left out.
// WORDS.howToPlay replaces it verbatim.
//
//   Screens.title({ onStart: start });               // the title screen
//   Screens.title({ onStart: start, board: true });  // + the top ten
//   Screens.title({ score: 12, onStart: start, post: true, board: true });
//
// title() fills the window over the game: the name (WORDS.title, else the page
// title), WORDS.tagline, one focused Start button — Enter or Space press it,
// the drawn touch controls step aside, and a tap also reaches Input as one
// frame of "start" — and the hint. A score shows big; the button says Play
// again (WORDS.again). Any part can be passed instead — { name, tagline, hint,
// start, score, onStart } beat config. Returns { close }; DOM only.
// `post: true` puts the score on the scoreboard and the board shows where it
// landed; `board: true` adds the top ten, or pass { limit, around, title };
// `extra` is your own node, or a list of them, put in the panel.
//
//   Screens.chips({ Score: 12, Lives: 3 });   // the HUD strip, top of screen
//
// chips() is cheap every frame: built once, only changed text touched. Each
// call says the whole strip — a key not named is removed, chips({}) clears it.
//
// Snippets are nodes you place yourself, in these screens or your own page:
//
//   Screens.board({ limit: 10, around: 14 }) // the scoreboard, fetched
//   Screens.rows({ Rocks: 42, Level: 7 })    // a label-and-value list
//   Screens.signin()                         // who you are, or a sign-in link
//   await Screens.me()                       // { name } or null
//   await Screens.post(score)                // {rank} | {signin:true} | {}
//
// board() asks the studio for /_scores itself and fills in when it answers.
// `around: rank` marks that row, and past the list it adds the four above and
// four below, numbered where they really are.
//
// Styling: every part wears a screens- class and your own css always wins —
// the library's rules sit in an @layer, so nothing needs !important. The
// screen also wears screens-over on game over. Colours come from LOOK in
// config/look.js: primary (name, button), accent (tagline), highlight (⚠️ a
// score and nothing else), deep (the ground). --screens-font and -mono, -text,
// -muted, -ink, -panel, -border, -radius are yours on :root. The typefaces sit
// beside this file.
//
// Missing pieces are quiet — an empty string or a no-op, never an error.
// Load config/controls.js first.

const Screens = (function () {
  "use strict";

  const DIRS = ["left", "right", "up", "down"];
  // Verbs that are not doing-words — "Space to action" helps nobody, so
  // these clauses are just the control itself: "Tap anywhere", "Space".
  const MUTE_VERBS = ["action", "tap"];

  // Where this file lives, so the typefaces beside it resolve from any page:
  // a relative url() in an injected <style> is resolved against the document,
  // not the script, so a game with a page in a subdirectory would otherwise
  // ask for the fonts in the wrong place.
  const HERE = (function () {
    const script = typeof document === "object" && document && document.currentScript;
    const src = script && typeof script.src === "string" ? script.src : "";
    const cut = src.lastIndexOf("/");
    return cut < 0 ? "studio/" : src.slice(0, cut + 1);
  }());

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

  // The two typefaces, copied into the game beside this file rather than
  // fetched from a font host: a library must not make a game depend on
  // somebody else's server. Space Grotesk is one variable file covering
  // 400–700; Space Mono carries every number. The subsets are Google's own,
  // so latin-ext is only fetched by a page that shows an accent — and these
  // rules stay outside the layer, because @font-face is not part of the
  // cascade and a game changes the type by setting --screens-font, not by
  // outranking a rule.
  const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
    + "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,"
    + "U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,"
    + "U+2113,U+2C60-2C7F,U+A720-A7FF";

  function face(family, weight, file, range) {
    return "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight
      + ";font-display:swap;src:url('" + HERE + file + "') format('woff2');"
      + "unicode-range:" + range + "}";
  }

  const FONT_CSS = face("Space Grotesk", "400 700", "space-grotesk.woff2", LATIN)
    + face("Space Grotesk", "400 700", "space-grotesk-ext.woff2", LATIN_EXT)
    + face("Space Mono", "400", "space-mono.woff2", LATIN)
    + face("Space Mono", "700", "space-mono-bold.woff2", LATIN);

  // The stylesheet, injected once, and ⚠️ all of it inside `@layer screens`:
  // an unlayered rule beats a layered one whatever its specificity and
  // wherever it sits, so a game's own css/style.css wins by existing. Without
  // the layer this <style> lands after the game's <link> and quietly outranks
  // it, which is what made these screens un-restylable.
  //
  // Colour is the game's — the four LOOK names, set inline on the screen —
  // and the shapes are the studio's: the halftone dots, the hairline across
  // the top, the panel card, a pill button with a glow under it, and every
  // number in Space Mono with tabular figures. The defaults below are the
  // studio's own four, so a game that has not picked colours yet still looks
  // like it belongs here rather than like white text on black.
  //
  // The phone lessons are unchanged: type clamped to the viewport so a long
  // name cannot overflow, the panel centred with auto margins inside a
  // scrolling box — centred when it fits, scrolled from the top when tall,
  // never clipped at both ends the way flex centering clips — and safe-area
  // padding for notches. The chips row takes no pointer events: a tap on the
  // HUD is a tap on the game.
  const SCREENS_CSS = "@layer screens{"
    + ":root{"
    + "--screens-font:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;"
    + "--screens-mono:'Space Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"
    + "--screens-text:#f2effe;--screens-muted:#9a8fd0;--screens-ink:#12101f;"
    + "--screens-panel:oklch(0.26 0.06 290/0.72);--screens-border:#3a3168;"
    + "--screens-radius:13px;--screens-primary:oklch(0.72 0.19 20);"
    + "--screens-accent:oklch(0.78 0.15 350);--screens-highlight:oklch(0.85 0.15 95);"
    + "--screens-deep:#191033}"

    + ".screens-title-screen{position:fixed;inset:0;z-index:9998;overflow:auto;display:flex;"
    + "box-sizing:border-box;text-align:center;font-family:var(--screens-font);"
    + "color:var(--screens-text);-webkit-font-smoothing:antialiased;"
    + "padding:calc(22px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px)) "
    + "calc(22px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px));"
    + "background-color:color-mix(in oklab,var(--screens-deep) 92%,transparent);"
    + "background-image:"
    + "radial-gradient(color-mix(in oklab,var(--screens-accent) 20%,transparent) 1px,transparent 1px),"
    + "radial-gradient(color-mix(in oklab,var(--screens-primary) 16%,transparent) 1px,transparent 1px),"
    + "linear-gradient(165deg,color-mix(in oklab,var(--screens-primary) 15%,transparent),"
    + "transparent 55%,color-mix(in oklab,var(--screens-accent) 17%,transparent));"
    + "background-size:10px 10px,10px 10px,100% 100%;"
    + "background-position:0 0,5px 5px,0 0}"
    // The hairline: the studio's one gesture, drawn in this game's own three
    // colours rather than the studio's, so it reads as the house style and
    // not as the studio's badge on somebody's game.
    + ".screens-title-screen::before{content:'';position:fixed;top:0;left:0;right:0;height:2px;"
    + "background:linear-gradient(90deg,var(--screens-primary),var(--screens-accent),"
    + "var(--screens-highlight))}"

    + ".screens-panel{margin:auto;box-sizing:border-box;width:min(34rem,100%);padding:28px 22px;"
    + "background:var(--screens-panel);border:1px solid var(--screens-border);"
    + "border-radius:var(--screens-radius);box-shadow:0 18px 50px rgba(6,4,14,.5)}"
    + ".screens-name{margin:0;font-size:clamp(30px,9vw,58px);line-height:1.05;font-weight:700;"
    + "letter-spacing:-.03em;overflow-wrap:break-word;color:var(--screens-primary)}"
    + ".screens-tagline{margin:11px 0 0;font-size:clamp(14px,3.8vw,18px);"
    + "color:var(--screens-accent)}"
    + ".screens-score{margin:16px 0 0;font-family:var(--screens-mono);font-weight:700;"
    + "font-size:clamp(34px,11vw,58px);line-height:1;font-variant-numeric:tabular-nums;"
    + "color:var(--screens-highlight)}"
    + ".screens-start{display:inline-block;margin:24px 0 0;min-height:52px;padding:13px 34px;"
    + "font:700 clamp(17px,4.5vw,21px)/1.2 var(--screens-font);color:var(--screens-ink);"
    + "cursor:pointer;border:0;border-radius:999px;"
    + "background:linear-gradient(100deg,var(--screens-primary),var(--screens-accent));"
    + "box-shadow:0 0 26px color-mix(in oklab,var(--screens-primary) 34%,transparent)}"
    + ".screens-start:hover{filter:brightness(1.08)}"
    + ".screens-start:active{filter:brightness(.92)}"
    + ".screens-start:focus-visible{outline:2px solid var(--screens-text);outline-offset:3px}"
    + ".screens-hint{margin:20px 0 0;font-size:clamp(13px,3.4vw,15px);color:var(--screens-muted)}"

    // The scoreboard snippet. A rank is mono and muted, a name is the reading
    // face, and ⚠️ only the score is gold — the moment that spreads to a rank
    // or a name the colour stops meaning "a number worth looking at".
    + ".screens-board{margin:24px 0 0;text-align:left}"
    + ".screens-board-title{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.14em;"
    + "text-transform:uppercase;color:var(--screens-muted)}"
    + ".screens-board-list{list-style:none;margin:0;padding:0;display:flex;"
    + "flex-direction:column;gap:2px}"
    + ".screens-place{display:grid;grid-template-columns:2.4em 1fr auto;gap:10px;"
    + "align-items:baseline;padding:4px 9px;border:1px solid transparent;border-radius:8px}"
    + ".screens-place.screens-mine{border-color:var(--screens-primary);"
    + "background:color-mix(in oklab,var(--screens-primary) 14%,transparent)}"
    + ".screens-place-rank{font-family:var(--screens-mono);font-size:11.5px;"
    + "font-variant-numeric:tabular-nums;color:var(--screens-muted)}"
    + ".screens-place-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
    + "font-size:14px}"
    + ".screens-place-score{font-family:var(--screens-mono);font-weight:700;font-size:14px;"
    + "font-variant-numeric:tabular-nums;color:var(--screens-highlight)}"
    + ".screens-gap{padding:1px 9px;color:var(--screens-muted);letter-spacing:.2em;"
    + "font-size:11px}"
    + ".screens-empty{padding:4px 9px;color:var(--screens-muted);font-size:13px}"
    + ".screens-signin{margin:14px 0 0;font-size:13px;color:var(--screens-muted)}"
    + ".screens-signin a{color:var(--screens-primary)}"

    // The label-and-value list. Not gold: a count of rocks is a number, but
    // it is not a score.
    + ".screens-rows{list-style:none;margin:20px 0 0;padding:0;display:flex;"
    + "flex-direction:column;gap:2px;text-align:left}"
    + ".screens-row{display:flex;justify-content:space-between;gap:14px;padding:3px 9px;"
    + "font-size:14px}"
    + ".screens-row-label{color:var(--screens-muted)}"
    + ".screens-row-value{font-family:var(--screens-mono);font-weight:700;"
    + "font-variant-numeric:tabular-nums;color:var(--screens-text)}"

    + ".screens-chips{position:fixed;top:0;left:0;right:0;z-index:9997;display:flex;"
    + "flex-wrap:wrap;justify-content:center;gap:8px;pointer-events:none;"
    + "padding:calc(10px + env(safe-area-inset-top,0px)) 12px 0;"
    + "font-family:var(--screens-font)}"
    + ".screens-chip{display:flex;align-items:baseline;gap:7px;padding:4px 12px;"
    + "border-radius:999px;background:var(--screens-panel);"
    + "border:1px solid var(--screens-border);color:var(--screens-text);"
    + "font-size:clamp(12px,3vw,13.5px)}"
    + ".screens-chip-label{color:var(--screens-muted);letter-spacing:.04em}"
    + ".screens-chip-value{font-family:var(--screens-mono);font-weight:700;"
    + "font-size:clamp(13px,3.4vw,16px);font-variant-numeric:tabular-nums;"
    + "color:var(--screens-highlight)}"
    // The HUD steps aside under a title or game-over screen, the same way the
    // drawn touch controls do. The screen is not quite opaque — the game shows
    // faintly through it on purpose — and a score bleeding through the top of
    // it reads as a mistake rather than as a HUD.
    + "body.screens-open .screens-chips{display:none}"
    + "}";

  let styleDone = false;

  function injectStyle() {
    if (styleDone || typeof document !== "object" || !document.head) return;
    const style = document.createElement("style");
    style.textContent = FONT_CSS + SCREENS_CSS;
    document.head.append(style);
    styleDone = true;
  }

  // The game's four colours, set on the screen itself. Inline, so they beat
  // the layer's defaults — and only where config/look.js actually names one,
  // which is what lets a game with no colours yet set --screens-primary from
  // its own stylesheet instead.
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

  // Empties a node without replaceChildren, which is not everywhere yet.
  function clear(node) {
    while (node.children && node.children.length > 0) {
      node.children[node.children.length - 1].remove();
    }
  }

  function wordsValue(key) {
    if (typeof WORDS === "object" && WORDS && typeof WORDS[key] === "string") {
      return WORDS[key];
    }
    return "";
  }

  // ---------- the studio's scoreboard ----------

  // The slug is the first piece of the page's address, the same way every
  // game works it out. Empty off a game origin, which turns every call here
  // into a quiet no-op rather than a request to nowhere.
  const slug = (function () {
    if (typeof location !== "object" || !location) return "";
    const parts = String(location.pathname || "").split("/");
    return parts.length > 1 ? parts[1] : "";
  }());

  function offline() {
    return typeof fetch !== "function";
  }

  let mePromise = null;

  // Who is signed in: { name } or null. Asked once per page — a game may call
  // it on every screen — and null for every kind of failure, because a game
  // must not break over the network.
  function me() {
    if (mePromise) return mePromise;
    if (offline()) return Promise.resolve(null);
    mePromise = fetch("/_me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.user && typeof j.user.name === "string" ? { name: j.user.name } : null))
      .catch(() => null);
    return mePromise;
  }

  // Puts a score on the board. { rank } when it counted — rank null means it
  // missed the board — { signin: true } when nobody is signed in, and {} for
  // anything else. The name on the row is the account's; nothing here sends
  // one.
  function post(score) {
    if (offline() || slug === "") return Promise.resolve({});
    const whole = Math.round(Number(score));
    if (!Number.isFinite(whole)) return Promise.resolve({});
    return fetch("/_scores/" + encodeURIComponent(slug), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: whole }),
    })
      .then(function (res) {
        if (res.status === 401) return { signin: true };
        if (!res.ok) return {};
        return res.json().then((j) => ({ rank: j && typeof j.rank === "number" ? j.rank : null }));
      })
      .catch(() => ({}));
  }

  function readScores(limit) {
    if (offline() || slug === "") return Promise.resolve([]);
    return fetch("/_scores/" + encodeURIComponent(slug) + "?limit=" + limit)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && Array.isArray(j.scores) ? j.scores : []))
      .catch(() => []);
  }

  function whole(value, low, high, fallback) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, low), high);
  }

  // A rank to point at: a number, or a promise of one. The promise is what
  // title({ post: true }) hands over — the board is on the screen before the
  // post has answered, and paints once it has.
  function rankOf(value) {
    if (value && typeof value.then === "function") {
      return value
        .then((r) => (typeof r === "number" && r > 0 ? Math.trunc(r) : null))
        .catch(() => null);
    }
    return Promise.resolve(typeof value === "number" && value > 0 ? Math.trunc(value) : null);
  }

  function place(entry, rank, mine) {
    const row = el("li", mine ? "screens-place screens-mine" : "screens-place");
    row.append(el("span", "screens-place-rank", String(rank)));
    row.append(el("span", "screens-place-name", entry && entry.name != null ? String(entry.name) : ""));
    row.append(el("span", "screens-place-score", entry && entry.score != null ? String(entry.score) : ""));
    return row;
  }

  function paintBoard(list, entries, limit, around) {
    clear(list);
    if (!entries || entries.length === 0) {
      list.append(el("li", "screens-empty", wordsValue("noScores") || "No scores yet."));
      return;
    }
    const top = entries.slice(0, limit);
    for (let i = 0; i < top.length; i += 1) list.append(place(top[i], i + 1, around === i + 1));
    // Below the shown rows, a window into the middle of the board: the four
    // above this run, its own row, the four below. Numbered where they really
    // are, and started past the rows already shown, so nothing appears twice.
    if (around === null || around <= limit || around > entries.length) return;
    const at = around - 1;
    const from = Math.max(limit, at - 4);
    const to = Math.min(entries.length, at + 5);
    if (from > limit) list.append(el("li", "screens-gap", "···"));
    for (let i = from; i < to; i += 1) list.append(place(entries[i], i + 1, i === at));
  }

  // The scoreboard as a node: a heading and the ranked rows, fetched here
  // unless `scores` is passed. It goes on the screen empty and fills in.
  function board(opts) {
    const o = typeof opts === "object" && opts ? opts : {};
    injectStyle();
    const limit = whole(o.limit, 1, 100, 10);
    const asked = o.around !== undefined && o.around !== null;
    const root = el("div", "screens-board");
    const heading = typeof o.title === "string" ? o.title
      : wordsValue("topTen") || "Top " + limit;
    if (heading !== "") root.append(el("p", "screens-board-title", heading));
    const list = el("ul", "screens-board-list");
    root.append(list);
    // A rank past the shown rows needs the rest of the board to bracket it,
    // and a promised rank is not knowable yet — so either way, ask for all of
    // it. Without a rank, the shown rows are the whole request.
    const rows = Array.isArray(o.scores)
      ? Promise.resolve(o.scores)
      : readScores(asked ? 100 : limit);
    Promise.all([rows, rankOf(o.around)])
      .then((both) => paintBoard(list, both[0], limit, both[1]))
      .catch(() => {});
    return root;
  }

  // A label-and-value list: the run's numbers, the level's totals, whatever
  // the screen wants to say in rows. Values are said as they are given.
  function rows(values) {
    const o = typeof values === "object" && values ? values : {};
    injectStyle();
    const list = el("ul", "screens-rows");
    for (const label of Object.keys(o)) {
      const row = el("li", "screens-row");
      row.append(el("span", "screens-row-label", label));
      row.append(el("span", "screens-row-value", String(o[label])));
      list.append(row);
    }
    return list;
  }

  // Who is playing, or the way to become somebody: a score only goes on the
  // board under an account's name, so a signed-out player is offered the
  // front page rather than a name box.
  function signin() {
    injectStyle();
    const node = el("p", "screens-signin", "");
    me().then(function (who) {
      if (who) {
        node.textContent = (wordsValue("playingAs") || "Playing as") + " " + who.name;
        return;
      }
      clear(node);
      node.textContent = "";
      const link = el("a", "screens-signin-link", wordsValue("signIn") || "Sign in to get on the board");
      link.href = "/";
      node.append(link);
    });
    return node;
  }

  // ---------- the screens ----------

  // One title screen at a time: a new call replaces the one on screen.
  let openTitle = null;
  // The capture-phase key handler belonging to the screen that is up, so
  // closing takes it away with the screen.
  let keyStart = null;

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

    const root = el("div", over ? "screens-title-screen screens-over" : "screens-title-screen");
    lookColours(root);
    const panel = el("div", "screens-panel");
    if (name !== "") panel.append(el("h1", "screens-name", name));
    if (tagline !== "") panel.append(el("p", "screens-tagline", tagline));
    if (over) panel.append(el("div", "screens-score", String(o.score)));
    const button = el("button", "screens-start", label);
    panel.append(button);
    if (line !== "") panel.append(el("p", "screens-hint", line));

    // The game's own part of the screen — a run breakdown, a note, whatever
    // this game has that no library could guess. It goes above the board, so
    // the panel reads as your run and then everybody's.
    const own = o.extra === undefined || o.extra === null ? []
      : (Array.isArray(o.extra) ? o.extra : [o.extra]);
    for (const node of own) if (node) panel.append(node);

    // The scoreboard dance, in the one place every game was doing it by hand:
    // post the run, show the board around where it landed, and offer the sign
    // in to whoever is not signed in. The post starts now and the board waits
    // on it, so nothing is on the screen twice.
    const posting = over && o.post === true ? post(o.score) : null;
    const wanted = o.board === true ? {} : (typeof o.board === "object" && o.board ? o.board : null);
    if (wanted) {
      const around = posting ? posting.then((r) => r.rank) : wanted.around;
      panel.append(board({
        limit: wanted.limit, title: wanted.title, scores: wanted.scores, around: around,
      }));
    }
    if (wanted || posting) panel.append(signin());

    root.append(panel);
    document.body.append(root);
    markBody(true);

    const handle = {
      close: function () {
        if (openTitle === handle) openTitle = null;
        if (keyStart) {
          if (typeof window.removeEventListener === "function") {
            window.removeEventListener("keydown", keyStart, true);
          }
          keyStart = null;
        }
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

    // ⚠️ Enter and Space press the button, and this is why it takes a listener
    // rather than leaving it to the focused button: the input library binds
    // key:enter to start and key:space to fire, and calls preventDefault on
    // every bound key. Its listener is on window in the bubble phase, so a
    // focused button never saw the keypress that was supposed to activate it —
    // the title screen was mouse-only on every game that loads input.js.
    // Capture runs first, so this gets there before the default is taken away,
    // and it preventDefaults on its own account so a game without the input
    // library does not also activate the button and start twice.
    if (typeof window.addEventListener === "function") {
      keyStart = function (e) {
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        if (e.repeat) return;
        if (typeof e.preventDefault === "function") e.preventDefault();
        if (typeof e.stopPropagation === "function") e.stopPropagation();
        button.click();
      };
      window.addEventListener("keydown", keyStart, true);
    }
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

  return {
    hint: hint,
    title: title,
    chips: chips,
    board: board,
    rows: rows,
    signin: signin,
    me: me,
    post: post,
  };
}());

window.Screens = Screens;
