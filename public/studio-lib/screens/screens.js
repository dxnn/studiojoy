// The furniture around the game: how big it is on the screen, a how-to-play
// hint, the title and game-over screen, the HUD strip, and snippets to go
// inside them — the scoreboard above all.
//
//   Screens.fit(document.getElementById("wrap"));  // once, at boot
//
// fit() gives the game as much of the window as its shape allows, taking that
// shape from the canvas's own width/height. ⚠️ Sizing on the window's width
// alone is what takes a game off the bottom of a sideways phone, so delete any
// width/height css of your own on that element: fit writes over it. Pass the
// box the game lives in — the canvas, or whatever holds it and its overlays.
// { max, width, height } override the cap and the shape; it sets
// --screens-fit-top/-left/-width/-height on :root for your own css.
//
//   ctx.fillText(Screens.hint(), x, y);  // "Arrows / WASD to move · Space to fire"
//
// hint() is read off config/controls.js and the device, so it is never wrong:
// player1's keys, or the shape SCHEME draws and nothing that is not on it,
// with a plugged-in controller folded in. start and every verb in HIDDEN are
// left out. WORDS.howToPlay replaces the line verbatim.
//
//   Screens.title({ onStart: start });   // the title screen
//   Screens.title({ score: 12, onStart: start, post: true, board: true });
//
// title() fills the window over the game: the name (WORDS.title, else the page
// title), WORDS.tagline, one Start button that Enter, Space or a tap presses,
// and the hint. The drawn controls step aside while it is up. A score shows
// big and the button says Play again (WORDS.again). { name, tagline, hint,
// start, score, onStart } beat config; `post: true` puts the score on the
// scoreboard, `board: true` adds the top ten (or { limit, around, title }),
// `extra` is your own node put in the panel. Returns { close }.
//
//   Screens.chips({ Score: 12, Lives: 3 }, { hint: true });   // the HUD strip
//   Screens.chips({ Risk: { value: 43, max: 100, text: "43/100" } });  // a meter
//   Screens.chips({ Fuel: myOwnDiv });        // your node, in that place
//
// chips() sits over the game — in the band above it when there is one — and is
// cheap every frame: built once, only what changed touched. Each call says the
// whole strip, in order; a key not named is removed, chips({}) clears it. A
// value is text, a meter, or a node of your own it never touches again.
// { hint: true } ends the row with the how-to-play line, left out where the
// game is too narrow for it.
//
// Snippets are nodes you place yourself, in a screen or your own page:
//
//   Screens.board({ limit: 10, around: 14 }) // the scoreboard, fetched
//   Screens.rows({ Rocks: 42, Level: 7 })    // a label-and-value list
//   Screens.signin()                         // who you are, or a sign-in link
//   await Screens.me()                       // { name } or null
//   await Screens.post(score)                // {rank} | {signin:true} | {}
//
// board() asks /_scores itself and fills in when it answers; `around: rank`
// marks that row and adds the four either side.
//
// Styling: every part wears a screens- class and your own css wins — a rule
// here weighs one element selector, so `.screens-name { … }` beats it, and
// !important is never needed. LOOK in config/look.js gives primary (name,
// button), accent (tagline), highlight (⚠️ a score, a meter, nothing else),
// deep (the ground). --screens-font and -mono, -text, -muted, -ink, -panel,
// -border, -radius are yours on :root; the screen wears screens-over on game
// over.
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

  // Verbs config/controls.js asks to keep out of the hint: the ones that make
  // the game rather than play it, like a key that draws the hitboxes. start is
  // always out — the title screen is its whole job.
  function hiddenVerbs() {
    if (typeof HIDDEN !== "undefined" && Array.isArray(HIDDEN)) return HIDDEN;
    return [];
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
    const hidden = hiddenVerbs();
    for (const verb of Object.keys(verbs)) {
      if (verb === "start" || hidden.indexOf(verb) >= 0) continue;
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
    // The null controller has nothing to explain: its controls are the game's
    // own buttons, and a button says what it does. Without this a game made
    // of buttons offered a line about keys it may never read — a visual novel
    // saying "Enter to start" over a Start button that only takes clicks.
    if (schemeName() === "none") return "";
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

  // The stylesheet, injected once, and ⚠️ every rule in it is written
  // `body :where(…)`, which is deliberate to the last character. :where()
  // contributes nothing, so each rule weighs exactly one element selector —
  // 0-0-1. That is the one weight that does what a library wants:
  //
  //   .screens-name { … }        a game means this        0-1-0  game wins
  //   button { … }               the game's page style    0-0-1  tie, we are later
  //   * { margin: 0 }            a reset                  0-0-0  we win
  //
  // ⚠️ Two wrong answers, both found in a browser, both on asteriskoids.
  // Plain `.screens-name` — no wrapper — wins every tie because this <style>
  // lands after the game's <link>, so a screen could not be restyled at all.
  // `@layer screens` is worse than doing nothing: an unlayered rule beats a
  // layered one at ANY specificity, and a game's first line is usually
  // `* { margin: 0; padding: 0 }` — that reset flattened every margin on the
  // screen, and the panel lost `margin:auto` and sat against the left edge.
  // Bare :where() then lost the Start button to the game's own `button { … }`.
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
  const SCREENS_CSS = ""
    + ":where(:root){"
    + "--screens-font:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;"
    + "--screens-mono:'Space Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"
    + "--screens-text:#f2effe;--screens-muted:#9a8fd0;--screens-ink:#12101f;"
    + "--screens-panel:oklch(0.26 0.06 290/0.72);--screens-border:#3a3168;"
    + "--screens-radius:13px;--screens-primary:oklch(0.72 0.19 20);"
    + "--screens-accent:oklch(0.78 0.15 350);--screens-highlight:oklch(0.85 0.15 95);"
    + "--screens-deep:#191033}"

    + "body :where(.screens-title-screen){position:fixed;inset:0;z-index:9998;overflow:auto;display:flex;"
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
    + "body :where(.screens-title-screen)::before{content:'';position:fixed;top:0;left:0;right:0;height:2px;"
    + "background:linear-gradient(90deg,var(--screens-primary),var(--screens-accent),"
    + "var(--screens-highlight))}"

    + "body :where(.screens-panel){margin:auto;box-sizing:border-box;width:min(34rem,100%);padding:28px 22px;"
    + "background:var(--screens-panel);border:1px solid var(--screens-border);"
    + "border-radius:var(--screens-radius);box-shadow:0 18px 50px rgba(6,4,14,.5)}"
    + "body :where(.screens-name){margin:0;font-size:clamp(30px,9vw,58px);line-height:1.05;font-weight:700;"
    + "letter-spacing:-.03em;overflow-wrap:break-word;color:var(--screens-primary)}"
    + "body :where(.screens-tagline){margin:11px 0 0;font-size:clamp(14px,3.8vw,18px);"
    + "color:var(--screens-accent)}"
    + "body :where(.screens-score){margin:16px 0 0;font-family:var(--screens-mono);font-weight:700;"
    + "font-size:clamp(34px,11vw,58px);line-height:1;font-variant-numeric:tabular-nums;"
    + "color:var(--screens-highlight)}"
    + "body :where(.screens-start){display:inline-block;margin:24px 0 0;min-height:52px;padding:13px 34px;"
    + "font:700 clamp(17px,4.5vw,21px)/1.2 var(--screens-font);color:var(--screens-ink);"
    + "cursor:pointer;border:0;border-radius:999px;"
    + "background:linear-gradient(100deg,var(--screens-primary),var(--screens-accent));"
    + "box-shadow:0 0 26px color-mix(in oklab,var(--screens-primary) 34%,transparent)}"
    + "body :where(.screens-start:hover){filter:brightness(1.08)}"
    + "body :where(.screens-start:active){filter:brightness(.92)}"
    + "body :where(.screens-start:focus-visible){outline:2px solid var(--screens-text);outline-offset:3px}"
    + "body :where(.screens-hint){margin:20px 0 0;font-size:clamp(13px,3.4vw,15px);color:var(--screens-muted)}"

    // What the run won, under its score and before everybody's board. The
    // box itself takes no room, so a run that won nothing shows nothing; the
    // names are in the primary, as the toast has them — ⚠️ never the
    // highlight, because a name is not a number.
    + "body :where(.screens-won-title){margin:18px 0 6px;font-size:11px;font-weight:600;letter-spacing:.14em;"
    + "text-transform:uppercase;color:var(--screens-muted)}"
    + "body :where(.screens-won-list){list-style:none;margin:0;padding:0;display:flex;"
    + "flex-direction:column;gap:4px}"
    + "body :where(.screens-won-row){display:flex;align-items:center;justify-content:center;gap:10px;"
    + "font-size:15px;font-weight:700;color:var(--screens-primary)}"
    + "body :where(.screens-won-icon){font-size:20px;line-height:1}"

    // The scoreboard snippet. A rank is mono and muted, a name is the reading
    // face, and ⚠️ only the score is gold — the moment that spreads to a rank
    // or a name the colour stops meaning "a number worth looking at".
    + "body :where(.screens-board){margin:24px 0 0;text-align:left}"
    + "body :where(.screens-board-title){margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.14em;"
    + "text-transform:uppercase;color:var(--screens-muted)}"
    + "body :where(.screens-board-list){list-style:none;margin:0;padding:0;display:flex;"
    + "flex-direction:column;gap:2px}"
    + "body :where(.screens-place){display:grid;grid-template-columns:2.4em 1fr auto;gap:10px;"
    + "align-items:baseline;padding:4px 9px;border:1px solid transparent;border-radius:8px}"
    + "body :where(.screens-place.screens-mine){border-color:var(--screens-primary);"
    + "background:color-mix(in oklab,var(--screens-primary) 14%,transparent)}"
    + "body :where(.screens-place-rank){font-family:var(--screens-mono);font-size:11.5px;"
    + "font-variant-numeric:tabular-nums;color:var(--screens-muted)}"
    + "body :where(.screens-place-name){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
    + "font-size:14px}"
    + "body :where(.screens-place-score){font-family:var(--screens-mono);font-weight:700;font-size:14px;"
    + "font-variant-numeric:tabular-nums;color:var(--screens-highlight)}"
    + "body :where(.screens-gap){padding:1px 9px;color:var(--screens-muted);letter-spacing:.2em;"
    + "font-size:11px}"
    + "body :where(.screens-empty){padding:4px 9px;color:var(--screens-muted);font-size:13px}"
    + "body :where(.screens-signin){margin:14px 0 0;font-size:13px;color:var(--screens-muted)}"
    + "body :where(.screens-signin a){color:var(--screens-primary)}"

    // The label-and-value list. Not gold: a count of rocks is a number, but
    // it is not a score.
    + "body :where(.screens-rows){list-style:none;margin:20px 0 0;padding:0;display:flex;"
    + "flex-direction:column;gap:2px;text-align:left}"
    + "body :where(.screens-row){display:flex;justify-content:space-between;gap:14px;padding:3px 9px;"
    + "font-size:14px}"
    + "body :where(.screens-row-label){color:var(--screens-muted)}"
    + "body :where(.screens-row-value){font-family:var(--screens-mono);font-weight:700;"
    + "font-variant-numeric:tabular-nums;color:var(--screens-text)}"

    + "body :where(.screens-chips){position:fixed;top:0;left:0;right:0;z-index:9997;display:flex;"
    + "flex-wrap:wrap;justify-content:center;gap:8px;pointer-events:none;"
    + "padding:calc(10px + env(safe-area-inset-top,0px)) 12px 0;"
    + "font-family:var(--screens-font)}"
    + "body :where(.screens-chip){display:flex;align-items:baseline;gap:7px;padding:4px 12px;"
    + "border-radius:999px;background:var(--screens-panel);"
    + "border:1px solid var(--screens-border);color:var(--screens-text);"
    + "font-size:clamp(12px,3vw,13.5px)}"
    + "body :where(.screens-chip-label){color:var(--screens-muted);letter-spacing:.04em}"
    + "body :where(.screens-chip-value){font-family:var(--screens-mono);font-weight:700;"
    + "font-size:clamp(13px,3.4vw,16px);font-variant-numeric:tabular-nums;"
    + "color:var(--screens-highlight)}"
    // Words in a chip are not a number: the reading face, the reading ink.
    + "body :where(.screens-chip-words){font-family:var(--screens-font);font-weight:600;"
    + "color:var(--screens-text)}"
    // A meter is the same number drawn twice, so it is gold like the number —
    // ⚠️ the one colour with a rule on it, and a bar of it is still a number.
    + "body :where(.screens-chip-meter){flex:none;width:clamp(30px,9vw,64px);height:6px;"
    + "border-radius:99px;overflow:hidden;align-self:center;"
    + "background:color-mix(in oklab,var(--screens-highlight) 20%,transparent)}"
    + "body :where(.screens-chip-fill){display:block;height:100%;width:0;border-radius:99px;"
    + "background:var(--screens-highlight)}"
    // The how-to-play chip is a sentence rather than a number, so it takes the
    // reading face and the muted ink. Whether it is there at all is measured
    // rather than declared — see placeChips.
    + "body :where(.screens-chip-hint){color:var(--screens-muted)}"
    // The HUD steps aside under a title or game-over screen, the same way the
    // drawn touch controls do. The screen is not quite opaque — the game shows
    // faintly through it on purpose — and a score bleeding through the top of
    // it reads as a mistake rather than as a HUD.
    + "body:where(.screens-open) :where(.screens-chips){display:none}";

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
    //
    // ⚠️ The board is read only once the rank is known. With title({ post:
    // true }) the rank is the post's answer, and a board asked for alongside
    // the post came back without this run on it — the request with no body
    // was answered first — so a new number one saw the old one, marked as
    // theirs. A plain rank resolves at once and costs nothing here.
    const rank = rankOf(o.around);
    const rows = Array.isArray(o.scores)
      ? Promise.resolve(o.scores)
      : rank.then(() => readScores(asked ? 100 : limit));
    Promise.all([rows, rank])
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

  // ---------- what the run won ----------

  // The achievements library says each award on the window as an
  // "achievement" event ({ id, name, how, icon }). They are kept from one
  // game over to the next, so the game-over screen can list what this run
  // won — and land on that screen as they arrive, because an achievement for
  // the last hit is awarded a beat after the game says the moment, which is
  // often once the screen is already up.
  let won = [];
  let wonBox = null; // the box on the game-over screen that is up
  let wonList = null;

  function wonRow(a) {
    const row = el("li", "screens-won-row");
    row.append(el("span", "screens-won-icon", a.icon ? String(a.icon) : "★"));
    row.append(el("span", "screens-won-name", String(a.name)));
    return row;
  }

  // The heading and the list arrive with the first row, so a run that won
  // nothing has no empty heading.
  function showWin(a) {
    if (!wonBox) return;
    if (!wonList) {
      wonList = el("ul", "screens-won-list");
      wonBox.append(el("p", "screens-won-title", wordsValue("won") || "Won this run"));
      wonBox.append(wonList);
    }
    wonList.append(wonRow(a));
  }

  function heardWin(event) {
    const d = event && event.detail;
    if (!d || typeof d.name !== "string") return;
    won.push(d);
    showWin(d);
  }

  if (typeof window.addEventListener === "function") {
    window.addEventListener("achievement", heardWin);
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
    // ⚠️ The chips row is display:none under a screen, and a hidden row
    // measures zero — so the one placed while the title screen was up was put
    // where a row of no height would go, and landed across the top of the
    // game. It is placed again the moment it can be measured.
    if (!open) placeChips();
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
    // The run's own trophies, under its score: the ones already won, and a
    // place for the ones about to land.
    const box = over ? el("div", "screens-won") : null;
    if (box) {
      wonBox = box;
      wonList = null;
      panel.append(box);
      for (const a of won) showWin(a);
    }
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
        // A game-over screen going away is the run being done with: what it
        // won is not the next run's. Only this screen's box, so a stale
        // handle closed again mid-run takes nothing from that run.
        if (box && wonBox === box) {
          won = [];
          wonBox = null;
          wonList = null;
        }
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

  /* How big the game is ---------------------------------------------------- */

  // A game is a fixed rectangle — its canvas says 960×600 — and the only
  // question a window asks is how much of itself the game may have. Deciding
  // that on the window's *width* alone is what took two of these games off the
  // bottom of a phone held sideways: 96vw of an 852pt window is 818pt across,
  // and 818 across is 512 tall in 393pt of height. So the width is the
  // smallest of three things: what the game is worth at most, what the window
  // is wide, and what the window's height can pay for at the game's own shape.
  //
  // ⚠️ Inline rather than a class, which is the one place this file overrules
  // a game instead of yielding to it: the line being replaced is usually
  // `#wrap { width: … }`, an id, and no rule this file can write beats an id.
  // A game that wants a different answer does not call fit.
  //
  // ⚠️ dvh, with a vh line written first for a browser too old to know it: on
  // iOS 100vh is the window with the toolbars *gone*, a promise the browser
  // keeps only once you scroll, which a game never does. An invalid value is
  // dropped by the CSSOM rather than throwing, so the older line survives
  // exactly where it is needed.
  //
  // ⚠️ And the page is left exactly one toolbar scrollable, as padding under
  // the body on the root: iOS hides its bars only when the page scrolls, and a
  // page that fits the small window to the pixel never does — a sideways phone
  // was playing in two thirds of its screen. Padding under the body rather
  // than height on it, so the game stays centred in the visible window before
  // the swipe; lvh − dvh rather than lvh − svh, so the slack is gone the
  // moment the bars are, or the game would then scroll off the top by the
  // same amount; content-box because every game's reset says border-box,
  // under which the page's `html { height: 100% }` would shrink to make room.
  // Zero wherever the toolbars stand still — a desktop, the preview, an
  // installed app — and dropped whole by a browser too old for lvh.
  let fitEl = null;
  let fitBox = null;
  let fitAspect = 0;
  let fitMax = 0;
  let fitWatching = false;
  let fitGapWas = null;

  function resolveEl(target) {
    if (target && typeof target === "object" && target.nodeType === 1) return target;
    if (typeof target === "string" && target !== "") return document.querySelector(target);
    return document.querySelector("canvas");
  }

  // The height the game does not get: everything else on the page. Measured
  // as the page's own height less the game's, which counts the page's padding,
  // the game's margins, and — the reason it is done this way — a title, a
  // hint line and a caption sharing the window with the canvas. A page whose
  // padding was all there was to count read the same either way; a game with
  // words above and below it did not, and sizing that one to the whole window
  // left the words to push it off the bottom.
  //
  // Anything taken out of the flow is rightly not counted: an overlay screen
  // and the chips row are both over the game rather than beside it.
  function fitGap(node) {
    if (typeof getComputedStyle !== "function") return 0;
    const page = getComputedStyle(document.body);
    const mine = getComputedStyle(node);
    const px = (v) => (parseFloat(v) || 0);
    // The game's own border and padding count too: the width worked out below
    // buys a *content* height, and a canvas in a 4px frame is eight pixels
    // taller than the sum says.
    let gap = px(page.paddingTop) + px(page.paddingBottom)
      + px(mine.marginTop) + px(mine.marginBottom)
      + px(mine.borderTopWidth) + px(mine.borderBottomWidth)
      + px(mine.paddingTop) + px(mine.paddingBottom);
    // ⚠️ Added up rather than subtracted from the page's height. Taking the
    // game out of document.body.scrollHeight looks like the same sum and is
    // not: a page with `min-height: 100vh` reports the window's height
    // whatever is on it, so the subtraction moves with the game's own size and
    // never settles. What the words beside the game measure does not.
    const parent = node.parentNode;
    for (const kid of (parent && parent.children) || []) {
      if (kid === node) continue;
      const s = getComputedStyle(kid);
      // Over the game rather than beside it: an overlay screen takes no room.
      if (s.display === "none" || s.position === "absolute" || s.position === "fixed") continue;
      gap += (kid.offsetHeight || 0) + px(s.marginTop) + px(s.marginBottom);
    }
    return Math.round(gap);
  }

  // ⚠️ Sized more than once on purpose. Narrowing the game changes the page
  // around it — the hint line over one game went from one row to two the
  // moment its canvas stopped being wider than the window — so the first
  // measurement is of a page that is about to stop existing. Reading the gap
  // again after writing forces the layout and gives the real number; two
  // passes settle every case seen, and three is the ceiling rather than the
  // expectation. Only ever at boot and on a resize.
  function sizeFit() {
    if (!fitEl) return;
    let last = null;
    for (let pass = 0; pass < 3; pass += 1) {
      const gap = Math.round(fitGap(fitEl));
      if (gap === last) break;
      last = gap;
      if (gap === fitGapWas) break;
      fitGapWas = gap;
      const room = "(100" + "%s" + "h - " + gap + "px) * " + fitAspect;
      fitEl.style.setProperty("width", "min(" + fitMax + "px, 100%, " + room.replace("%s", "v") + ")");
      fitEl.style.setProperty("width", "min(" + fitMax + "px, 100%, " + room.replace("%s", "dv") + ")");
    }
    measureFit();
  }

  // Where the game ended up, for anything the studio puts over it — the chips
  // row today. Published on :root as well, so a game's own stylesheet can put
  // something in the same place without measuring it a second time.
  function measureFit() {
    if (!fitEl || typeof fitEl.getBoundingClientRect !== "function") return;
    const r = fitEl.getBoundingClientRect();
    fitBox = { top: r.top, left: r.left, width: r.width, height: r.height };
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty("--screens-fit-top", Math.round(r.top) + "px");
      root.style.setProperty("--screens-fit-left", Math.round(r.left) + "px");
      root.style.setProperty("--screens-fit-width", Math.round(r.width) + "px");
      root.style.setProperty("--screens-fit-height", Math.round(r.height) + "px");
    }
    placeChips();
  }

  function fit(target, options) {
    if (typeof document !== "object" || !document || !document.body) return null;
    const o = typeof options === "object" && options ? options : {};
    const node = resolveEl(target);
    if (!node) return null;
    const canvas = node.tagName === "CANVAS" ? node : node.querySelector("canvas");
    const w = Number(o.width) || (canvas ? Number(canvas.getAttribute("width")) : 0);
    const h = Number(o.height) || (canvas ? Number(canvas.getAttribute("height")) : 0);
    if (!(w > 0) || !(h > 0)) return null;
    injectStyle();
    fitEl = node;
    fitAspect = Math.round((w / h) * 10000) / 10000;
    fitMax = Number(o.max) || w;
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty("box-sizing", "content-box");
      root.style.setProperty("padding-bottom", "calc(100lvh - 100dvh)");
    }
    sizeFit();
    if (!fitWatching) {
      fitWatching = true;
      // The size is CSS, so a rotation is right before anything here runs;
      // these are for where the game *is*, which only the browser knows.
      if (typeof ResizeObserver === "function") {
        new ResizeObserver(measureFit).observe(node);
        // ⚠️ And the page around it, because the words beside a game are not
        // all there at boot: one game's scene name is an empty div until the
        // first scene loads, and the 27 pixels it then takes came out of the
        // game's own height. Watching the parent catches that, and cannot
        // chase its own tail — the size written depends on the *siblings*,
        // which resizing the game does not change.
        if (node.parentNode && node.parentNode.nodeType === 1) {
          new ResizeObserver(sizeFit).observe(node.parentNode);
        }
      }
      if (typeof window.addEventListener === "function") {
        window.addEventListener("resize", sizeFit);
        window.addEventListener("orientationchange", sizeFit);
      }
    }
    return { box: function () { return fitBox; } };
  }

  /* The HUD strip ----------------------------------------------------------- */

  // One row of chips over the game, built on the first call and touched only
  // where something changed, so calling it every frame costs nothing when
  // nothing moved.
  //
  // A value is text, a meter — { value, max, text } — or a node the game made
  // itself, and the key is both the label and, by where it sits in the object,
  // the chip's place in the row.
  const CHIP_GAP = 8; // between the row and the game, above it or over it
  let chipsRoot = null;
  let chipNodes = new Map(); // label -> { chip, value, text, fill, width, own }
  let hintChip = null;
  let chipsAbove = null;

  // Above the game when the letterbox band is deep enough to hold the row,
  // over the top of it when it is not — which is the desktop case, where the
  // game has the window and there is no band. Only ever after fit() has said
  // where the game is; on its own the row stays across the top of the window.
  // ⚠️ Never from inside the per-frame path: it reads offsetHeight, which
  // makes the browser lay the page out there and then. It runs when the row
  // gains or loses a chip, and when the window or the game moves — all of
  // which are rare — and never for a number that merely changed.
  let placed = null;

  function placeChips() {
    if (!chipsRoot) return;
    const s = chipsRoot.style;
    // Narrow is a question about the *game*, not the window: sideways on a
    // phone the window is wide and the game is not. Without a fit there is no
    // game box to ask, so the window is the best answer there is.
    const room = fitBox ? fitBox.width : (window.innerWidth || 0);
    if (hintChip) hintChip.style.display = room > 0 && room < 640 ? "none" : "";
    if (!fitBox) {
      for (const name of ["left", "width", "top", "padding"]) s.setProperty(name, "");
      chipsAbove = null;
      placed = null;
      return;
    }
    // ⚠️ The padding goes before the measurement, not with the rest of the
    // placement after it: the stylesheet's own top padding is for a row
    // across the top of the window, and a row measured with it and then
    // placed without it is placed ten pixels wrong. Reading offsetHeight
    // right after setting it is what makes the browser answer for the row as
    // it will actually be — and the observer would never have caught this,
    // since padding moves the border box and it watches the content box.
    s.setProperty("padding", "0");
    // A row nobody can see has no height, and a height of nothing is not an
    // answer: leave it where it is and place it when it is back.
    const rowH = chipsRoot.offsetHeight || 0;
    if (rowH === 0) return;
    const above = fitBox.top >= rowH + CHIP_GAP * 2;
    const at = {
      left: Math.round(fitBox.left),
      width: Math.round(fitBox.width),
      top: Math.round(above ? fitBox.top - CHIP_GAP - rowH : fitBox.top + CHIP_GAP),
    };
    // ⚠️ Settling on the answer rather than refusing to look twice. Narrowing
    // the row to the game's width is itself what rewraps it and changes its
    // height, so the placement that matters is the *second* one — a guard
    // against running again would throw away the only pass with the real
    // height in it. The width never moves after the first pass, so the height
    // stops moving too, and this returns.
    if (placed && placed.left === at.left && placed.width === at.width && placed.top === at.top) {
      return;
    }
    placed = at;
    s.setProperty("left", at.left + "px");
    s.setProperty("width", at.width + "px");
    s.setProperty("top", at.top + "px");
    chipsAbove = above;
  }

  function meterOf(v) {
    return v && typeof v === "object" && typeof v.nodeType !== "number"
      && (typeof v.value === "number" || typeof v.max === "number") ? v : null;
  }

  function chips(values, options) {
    if (typeof document !== "object" || !document || !document.body) return;
    const o = typeof values === "object" && values ? values : {};
    const opts = typeof options === "object" && options ? options : {};
    const labels = Object.keys(o);
    if (labels.length === 0 && !opts.hint) {
      if (chipsRoot) {
        chipsRoot.remove();
        chipsRoot = null;
        chipNodes = new Map();
        hintChip = null;
      }
      return;
    }
    injectStyle();
    // Whether the row changed *shape*. A number ticking over is not a change
    // of shape and must not cost a layout; a chip arriving or leaving is.
    let moved = false;
    if (!chipsRoot) {
      chipsRoot = el("div", "screens-chips");
      lookColours(chipsRoot);
      document.body.append(chipsRoot);
      if (typeof window.addEventListener === "function") {
        window.addEventListener("resize", placeChips);
      }
      // ⚠️ The row is measured to be placed, and there are three ways it can
      // change height without chips() being the one to do it: a screen it was
      // hidden under closing — the game's own screen, which this file never
      // hears about — the typefaces arriving, and the row wrapping to two
      // lines. Watching the row itself covers all three, and costs nothing
      // per frame. Placing it changes its width, so the observer fires once
      // more and then settles; `placing` keeps that from going round.
      if (typeof ResizeObserver === "function") {
        new ResizeObserver(placeChips).observe(chipsRoot);
      }
      moved = true;
    }
    for (const [label, node] of chipNodes) {
      if (!(label in o)) {
        node.chip.remove();
        chipNodes.delete(label);
        moved = true;
      }
    }
    for (const label of labels) {
      const raw = o[label];
      const meter = meterOf(raw);
      const own = raw && typeof raw === "object" && raw.nodeType === 1 ? raw : null;
      let node = chipNodes.get(label);
      if (!node) {
        const chip = el("span", "screens-chip");
        chip.append(el("span", "screens-chip-label", label));
        node = { chip: chip, value: null, text: null, fill: null, width: null, own: null };
        chipsRoot.append(chip);
        chipNodes.set(label, node);
        moved = true;
      }
      // The game's own node goes in whole and is never touched again: what is
      // inside it is the game's business, frame by frame, not this file's.
      if (own) {
        if (node.own !== own) {
          clear(node.chip);
          node.chip.append(el("span", "screens-chip-label", label));
          node.chip.append(own);
          node.own = own;
          node.value = null;
          node.text = null;
          node.fill = null;
        }
        continue;
      }
      if (!node.value) {
        node.value = el("span", "screens-chip-value", "");
        node.chip.append(node.value);
      }
      const text = String(meter ? (meter.text === undefined ? meter.value : meter.text) : raw);
      if (node.text !== text) {
        node.text = text;
        node.value.textContent = text;
        // ⚠️ The highlight is for a number and nothing else, and a chip's
        // value is not always one: "Guns · Cannon" in gold is the colour
        // losing its meaning. A value with a digit in it counts, which keeps
        // 43/100 ×1.4 and 1,204 gold and puts words in the reading ink.
        node.value.className = "screens-chip-value"
          + (meter || typeof raw === "number" || /\d/.test(text) ? "" : " screens-chip-words");
      }
      if (meter && !node.fill) {
        const track = el("span", "screens-chip-meter");
        node.fill = el("span", "screens-chip-fill");
        track.append(node.fill);
        node.chip.append(track);
      }
      if (meter) {
        const max = Number(meter.max) > 0 ? Number(meter.max) : 1;
        const part = Math.max(0, Math.min(1, (Number(meter.value) || 0) / max));
        const width = (part * 100).toFixed(1) + "%";
        if (node.width !== width) {
          node.width = width;
          node.fill.style.width = width;
        }
      }
    }
    // The how-to-play line, last in the row and label-less: it is a sentence,
    // not a number. Left out where the game is too narrow to spare the room —
    // it is for somebody with a keyboard, and a touchscreen has the drawn
    // buttons saying the same thing.
    if (opts.hint && !hintChip) {
      hintChip = el("span", "screens-chip screens-chip-hint", hint());
      chipsRoot.append(hintChip);
      moved = true;
    } else if (!opts.hint && hintChip) {
      hintChip.remove();
      hintChip = null;
      moved = true;
    } else if (hintChip && moved) {
      chipsRoot.append(hintChip); // a new chip went in behind it; it stays last
    }
    if (moved) placeChips();
  }

  return {
    hint: hint,
    fit: fit,
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
