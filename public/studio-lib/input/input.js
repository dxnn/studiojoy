// One way in for the keyboard, a game controller and a touchscreen.
//
// Every part of the game asks the same question — Input.held("left") — and
// this file works out whether that came from a key, a pad, or a thumb on a
// screen. What is bound to what lives in config/controls.js, so the buttons
// can be changed without opening this file.
//
// Call Input.update() once at the top of every frame, before anything reads
// it. That is what makes pressed() mean "went down just now":
//
//   Input.update();
//   if (Input.held("left"))     turn(-1);
//   if (Input.pressed("fire"))  shoot();          // once per press
//   ship.x += Input.axis("left", "right") * SPEED; // -1 .. 1, analog on a stick
//
// Two players share one keyboard and one screen: pass 2 as the last argument
// and Input reads player2's bindings and the second controller.
//
//   if (Input.held("left", 2)) turnOther(-1);
//
// config/controls.js may declare SCHEME — the shape of the game on a touch
// screen: "one-button" means a tap or a click anywhere is the button (bind
// touch:screen); "swipe-tap" means four flicks and a tap (swipe:left …
// swipe:tap) — flicks are moments, not states: read them with pressed(),
// never held(). With no SCHEME, touch: bindings are drawn as an arrow pad
// and round buttons.
//
// Use this instead of your own keydown listeners — two input systems fight
// over the same keys. index.html must load config/controls.js and then
// studio/input.js, in front of the game's own scripts, or these calls run
// against nothing.
//
// Those calls — update, held, pressed, released, axis, pads — are the whole
// of it. There is no setup call and no listener to add: loading the file is
// enough, and everything else is asking questions once update() has run.

const Input = (function () {
  "use strict";

  // Friendly names for the keys whose real names are long or invisible, so
  // config/controls.js can say "key:space" instead of "key: ".
  const KEY_NAMES = {
    left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown",
    space: " ", enter: "enter", esc: "escape", escape: "escape",
    shift: "shift", ctrl: "control", alt: "alt", tab: "tab",
  };

  // A controller in the standard layout, as the browser reports it.
  const PAD_BUTTONS = {
    a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7,
    back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15,
  };

  // Pushes of the sticks, read from the axes rather than the buttons:
  // [which axis, which way along it].
  const PAD_STICKS = {
    "stick-left": [0, -1], "stick-right": [0, 1],
    "stick-up": [1, -1], "stick-down": [1, 1],
    "stick2-left": [2, -1], "stick2-right": [2, 1],
    "stick2-up": [3, -1], "stick2-down": [3, 1],
  };

  // Used when config/controls.js is missing, so a game is never unplayable
  // because nobody has written the bindings down yet.
  const FALLBACK = {
    player1: {
      left: "key:left key:a pad:left pad:stick-left touch:left",
      right: "key:right key:d pad:right pad:stick-right touch:right",
      up: "key:up key:w pad:up pad:stick-up touch:up",
      down: "key:down key:s pad:down pad:stick-down touch:down",
      fire: "key:space pad:a touch:GO",
      start: "key:enter pad:start",
    },
  };

  // One line of bindings, split up. A list is accepted too: a helper writing
  // this file by hand is as likely to reach for one, and refusing it would
  // make the game silently unplayable.
  function listOf(value) {
    if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
    return Array.isArray(value) ? value.filter((b) => typeof b === "string") : [];
  }

  // config/controls.js and this file are separate <script> tags, and a game
  // may not have the first one at all. Reading it through try/catch means a
  // missing or late config is a fallback rather than a broken game.
  function bindings() {
    try {
      if (typeof CONTROLS === "object" && CONTROLS) return CONTROLS;
    } catch (e) { /* config/controls.js is not loaded */ }
    return FALLBACK;
  }

  function deadzone() {
    try {
      if (typeof STICK_DEADZONE === "number") return STICK_DEADZONE;
    } catch (e) { /* config/controls.js is not loaded */ }
    return 0.35;
  }

  // The declared control scheme, or "" for the old shape — an arrow pad and
  // round buttons drawn from the touch: bindings. An unknown name gets the
  // old shape too, said once, rather than a game with no controls at all.
  const SCHEMES = ["one-button", "swipe-tap"];
  let warnedScheme = false;
  function schemeName() {
    let name = "";
    try {
      if (typeof SCHEME === "string") name = SCHEME;
    } catch (e) { /* config/controls.js is not loaded */ }
    if (!name || SCHEMES.indexOf(name) !== -1) return name || "";
    if (!warnedScheme) {
      warnedScheme = true;
      console.warn('[input] unknown SCHEME "' + name + '" — drawing the plain touch controls');
    }
    return "";
  }

  function bindingsFor(player, action) {
    const who = bindings()["player" + (player || 1)];
    return who ? listOf(who[action]) : [];
  }

  /* What is down right now ------------------------------------------------ */

  const keysDown = new Set();   // key names, lowercased
  const touchDown = new Set();  // touch binding names, exactly as written
  let pads = [];
  let now = new Set();          // "1|left" for everything held this frame
  let last = new Set();

  const stamp = (action, player) => (player || 1) + "|" + action;

  // Every key named anywhere in the bindings. Used to decide whether to stop
  // the browser doing its own thing with a key — arrows scroll the page and
  // space scrolls it further, which makes a game feel broken.
  let boundKeys = null;
  function isBoundKey(name) {
    if (!boundKeys) {
      boundKeys = new Set();
      const all = bindings();
      for (const who of Object.keys(all)) {
        for (const action of Object.keys(all[who] || {})) {
          for (const binding of listOf(all[who][action])) {
            if (!binding.startsWith("key:")) continue;
            const key = binding.slice(4).toLowerCase();
            boundKeys.add(KEY_NAMES[key] || key);
          }
        }
      }
    }
    return boundKeys.has(name);
  }

  // Typing a name into a box is not playing the game, so the keys are left
  // alone while a text field has the focus.
  const typing = (e) => {
    const el = e.target;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  };

  window.addEventListener("keydown", (e) => {
    if (typing(e)) return;
    const key = e.key.toLowerCase();
    keysDown.add(key);
    if (isBoundKey(key)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keysDown.delete(e.key.toLowerCase()); });

  // A key held while the tab loses focus never sends its keyup, and would
  // otherwise stay down for the rest of the game.
  window.addEventListener("blur", () => {
    keysDown.clear();
    touchDown.clear();
    screenPointers.clear();
    gestureStarts.clear();
  });

  /* Control scheme surfaces ------------------------------------------------ */

  // A press on the game's own buttons and boxes belongs to them, never to a
  // scheme's whole-screen surface.
  function onControl(e) {
    const el = e.target;
    return !!(el && el.closest && el.closest("button,a,input,textarea,select,label"));
  }

  // one-button: the whole screen is the button — a tap or a click anywhere,
  // reaching the bindings as touch:screen. Held while any pointer is down.
  const screenPointers = new Set();
  function installOneButton() {
    window.addEventListener("pointerdown", (e) => {
      if (onControl(e)) return;
      if (e.preventDefault) e.preventDefault();
      screenPointers.add(e.pointerId);
      touchDown.add("screen");
    });
    const lift = (e) => {
      screenPointers.delete(e.pointerId);
      if (screenPointers.size === 0) touchDown.delete("screen");
    };
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
  }

  // swipe-tap: flicks and taps. A gesture only exists once the finger lifts,
  // so it reaches the game as a moment, not a state — surfaced for exactly
  // one update as swipe:left … swipe:tap, seen by pressed() and then gone.
  const FLICK_PX = 30; // travel that separates a flick from a tap
  let gestureNow = new Set();
  let gesturePending = new Set();
  const gestureStarts = new Map(); // pointerId -> where it went down
  function installSwipeTap() {
    window.addEventListener("pointerdown", (e) => {
      if (onControl(e)) return;
      if (e.preventDefault) e.preventDefault();
      gestureStarts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    window.addEventListener("pointerup", (e) => {
      const start = gestureStarts.get(e.pointerId);
      if (!start) return;
      gestureStarts.delete(e.pointerId);
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < FLICK_PX && Math.abs(dy) < FLICK_PX) gesturePending.add("tap");
      else if (Math.abs(dx) > Math.abs(dy)) gesturePending.add(dx > 0 ? "right" : "left");
      else gesturePending.add(dy > 0 ? "down" : "up");
    });
    window.addEventListener("pointercancel", (e) => { gestureStarts.delete(e.pointerId); });
  }

  // Run once, on the first update: by then config/controls.js has loaded (it
  // is documented to stand in front of this file). A declared scheme also
  // owns the screen — no browser scrolling, zooming or text selection over
  // the game — waiting for <body> the way the overlay does.
  let surfacesInstalled = false;
  let bodyOwned = false;
  function prepare() {
    if (!surfacesInstalled) {
      surfacesInstalled = true;
      const s = schemeName();
      if (s === "one-button") installOneButton();
      if (s === "swipe-tap") installSwipeTap();
    }
    if (!bodyOwned && schemeName() && document.body) {
      bodyOwned = true;
      const style = document.body.style;
      style.touchAction = "none";
      style.userSelect = "none";
      style.webkitUserSelect = "none";
    }
  }

  function padDown(name, player) {
    const pad = pads[(player || 1) - 1];
    if (!pad) return false;
    const stick = PAD_STICKS[name];
    if (stick) return (pad.axes[stick[0]] || 0) * stick[1] > deadzone();
    const index = PAD_BUTTONS[name];
    if (index === undefined) return false;
    const button = pad.buttons[index];
    if (!button) return false;
    // Triggers report a number between 0 and 1; everything else a flag.
    return typeof button === "object" ? button.pressed || button.value > 0.5 : button > 0.5;
  }

  function isDown(binding, player) {
    const colon = binding.indexOf(":");
    if (colon === -1) return false;
    const kind = binding.slice(0, colon);
    const name = binding.slice(colon + 1);
    if (kind === "key") {
      const key = name.toLowerCase();
      return keysDown.has(KEY_NAMES[key] || key);
    }
    if (kind === "touch") return touchDown.has(name);
    if (kind === "swipe") return gestureNow.has(name);
    if (kind === "pad") return padDown(name.toLowerCase(), player);
    return false;
  }

  // Controllers are polled, not pushed: their state is only readable by
  // asking. Nulls are dropped so the first pad plugged in is always player 1,
  // whichever socket the browser put it in.
  function readPads() {
    if (!navigator.getGamepads) return [];
    const out = [];
    for (const pad of navigator.getGamepads()) if (pad) out.push(pad);
    return out;
  }

  function update() {
    pads = readPads();
    prepare();
    if (!overlay) buildTouchControls();
    // Gestures finished since the last update are this frame's, and only
    // this frame's — that is what makes a flick a moment rather than a state.
    gestureNow = gesturePending;
    gesturePending = new Set();
    last = now;
    now = new Set();
    const all = bindings();
    for (const who of Object.keys(all)) {
      const player = Number(who.replace(/[^0-9]/g, "")) || 1;
      const actions = all[who] || {};
      for (const action of Object.keys(actions)) {
        for (const binding of listOf(actions[action])) {
          if (isDown(binding, player)) {
            now.add(stamp(action, player));
            break;
          }
        }
      }
    }
  }

  /* Reading it ------------------------------------------------------------ */

  const held = (action, player) => now.has(stamp(action, player));
  const pressed = (action, player) => now.has(stamp(action, player)) && !last.has(stamp(action, player));
  const released = (action, player) => !now.has(stamp(action, player)) && last.has(stamp(action, player));

  // The stick reading behind a pair of actions, or 0 when nothing is bound to
  // a stick or it is resting.
  function stickValue(negative, positive, player) {
    const pad = pads[(player || 1) - 1];
    if (!pad) return 0;
    for (const [action, way] of [[positive, 1], [negative, -1]]) {
      for (const binding of bindingsFor(player, action)) {
        if (!binding.startsWith("pad:")) continue;
        const stick = PAD_STICKS[binding.slice(4).toLowerCase()];
        if (!stick) continue;
        const value = (pad.axes[stick[0]] || 0) * stick[1] * way;
        return Math.abs(value) > deadzone() ? value : 0;
      }
    }
    return 0;
  }

  // -1 .. 1. A stick gives everything in between; keys, buttons and thumbs
  // give the ends.
  function axis(negative, positive, player) {
    const analog = stickValue(negative, positive, player);
    if (analog !== 0) return analog;
    return (held(positive, player) ? 1 : 0) - (held(negative, player) ? 1 : 0);
  }

  /* Buttons drawn on the screen ------------------------------------------- */

  // Only player 1 gets these: one screen has room for two thumbs, not four.
  let overlay = null;

  function touchNames() {
    const out = [];
    const actions = bindings().player1 || {};
    for (const action of Object.keys(actions)) {
      for (const binding of listOf(actions[action])) {
        if (binding.startsWith("touch:")) out.push(binding.slice(6));
      }
    }
    return out;
  }

  const ARROWS = { left: "←", right: "→", up: "↑", down: "↓" };

  // Dark inside, light outline. A game can be any colour behind these, so a
  // pale button on a pale background is a control nobody can find.
  const REST = "rgba(18,18,26,.42)";
  const PUSHED = "rgba(18,18,26,.78)";

  function padButton(name, label, size) {
    const el = document.createElement("button");
    el.textContent = label;
    el.setAttribute("aria-label", name);
    el.style.cssText = "pointer-events:auto;width:" + size + "px;height:" + size + "px;"
      + "border-radius:50%;border:2px solid rgba(255,255,255,.8);background:" + REST + ";"
      + "color:#fff;font:600 18px/1 system-ui,sans-serif;"
      + "box-shadow:0 1px 4px rgba(0,0,0,.45);"
      + "touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;";
    const down = (on) => {
      if (on) touchDown.add(name); else touchDown.delete(name);
      el.style.background = on ? PUSHED : REST;
    };
    // No pointer capture: sliding a thumb off a button should release it,
    // which is what a player expects and what a d-pad needs to feel right.
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); down(true); });
    el.addEventListener("pointerup", () => down(false));
    el.addEventListener("pointercancel", () => down(false));
    el.addEventListener("pointerleave", () => down(false));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    return el;
  }

  // Built once, on the first frame, and only where there is a touchscreen to
  // build it for — a laptop with a mouse gets nothing drawn over the game.
  function buildTouchControls() {
    if (overlay) return;
    // one-button and swipe-tap draw nothing: the screen itself is the control.
    const s = schemeName();
    if (s === "one-button" || s === "swipe-tap") return;
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse || !document.body) return;
    const names = touchNames();
    if (!names.length) return;

    overlay = document.createElement("div");
    overlay.id = "touch-controls";
    // Tall enough for the whole arrow pad: three 64px rows and the gaps
    // between them, plus the padding under it.
    overlay.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:218px;z-index:9999;"
      + "display:flex;align-items:flex-end;justify-content:space-between;"
      + "padding:0 18px 18px;pointer-events:none;";

    const arrows = names.filter((n) => ARROWS[n]);
    const dpad = document.createElement("div");
    dpad.style.cssText = "display:grid;grid-template-columns:repeat(3,64px);grid-template-rows:repeat(3,64px);gap:4px;";
    const cells = { up: 2, left: 4, right: 6, down: 8 };
    for (let i = 1; i <= 9; i += 1) {
      const name = Object.keys(cells).find((k) => cells[k] === i && arrows.indexOf(k) !== -1);
      const cell = name ? padButton(name, ARROWS[name], 64) : document.createElement("div");
      dpad.append(cell);
    }

    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:14px;align-items:flex-end;";
    for (const name of names.filter((n) => !ARROWS[n])) buttons.append(padButton(name, name, 84));

    overlay.append(arrows.length ? dpad : document.createElement("div"), buttons);
    document.body.append(overlay);
    // A thumb lifted anywhere at all releases everything: a pointerup that
    // lands outside the button never reaches it.
    window.addEventListener("pointerup", () => touchDown.clear());
  }

  return {
    update,
    held,
    pressed,
    released,
    axis,
    // How many controllers are plugged in — enough to offer two-player when
    // there are two, and to say "plug in a controller" when there are none.
    pads: () => pads.length,
  };
}());

window.Input = Input;
