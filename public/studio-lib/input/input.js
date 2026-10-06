// One way in for the keyboard, a game controller and a touchscreen.
//
//   Input.update();                                // first, every frame
//   if (Input.held("left"))     turn(-1);          // down now
//   if (Input.pressed("fire"))  shoot();           // went down this frame
//   if (Input.released("fire")) stopCharging();    // came up this frame
//   ship.x += Input.axis("left", "right") * SPEED; // -1 .. 1, analog on a stick
//   Input.held("left", 2);                         // player 2: player2's keys, second pad
//   Input.pads();                                  // how many controllers are plugged in
//
// The verbs are config/controls.js's: CONTROLS.player1 (and player2) maps
// each to its bindings — "key:space pad:a touch:fire". SCHEME there is the
// shape of the game on a touchscreen, and the bindings have to match it:
//   "buttons" (no SCHEME)  touch: names drawn as buttons, touch:left/right/up/
//                          down under one thumb and the rest under the other;
//                          toggle:NAME latches, tap on and tap off;
//                          BUTTON_SIDE = "left" mirrors the layout
//   "one-button"           a tap or a click anywhere: touch:screen
//   "swipe-tap"            swipe:left … swipe:tap — read with pressed(), never held()
//   "stick-buttons"        a stick (stick:left …) beside the drawn buttons
//   "dual-stick"           an aim stick too (stick:aim-left …); stick:move and
//                          stick:aim are held while pushed
//   "none"                 nothing drawn: the page's own buttons are the controls
// Bindings with no pad: at all are lent a controller: arrows on the d-pad and
// stick, other verbs on A, B, X, Y in the file's order, start on Start. HIDDEN
// lists verbs for making the game, never lent a button or shown in a hint.
//
// update, held, pressed, released, axis and pads are the whole of it: there is
// no pointer or touch position and no setup call. Never a keydown listener of
// the game's own: two input systems fight over the same keys. Load
// config/controls.js, then this file, before the game's scripts.

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
  function declared() {
    try {
      if (typeof CONTROLS === "object" && CONTROLS) return CONTROLS;
    } catch (e) { /* config/controls.js is not loaded */ }
    return FALLBACK;
  }

  // Verbs for making the game rather than playing it (a key that draws the
  // hitboxes), which nothing should hand a controller button.
  function hiddenVerbs() {
    try {
      if (Array.isArray(HIDDEN)) return HIDDEN;
    } catch (e) { /* config/controls.js declares none */ }
    return [];
  }

  // A game whose bindings name no controller button anywhere is dead on a
  // controller, and three of the studio's were. So it is lent the usual
  // shape: the arrow verbs the d-pad and the left stick, every other verb a
  // face button in the order the file lists them — A, B, X, Y — the first two
  // a trigger as well (right, then left), and start the Start button and A.
  // Lent, never written: the file stays as it is, and a single pad: binding
  // anywhere means the game has said how it is held, so then nothing is lent.
  const LEND_ARROWS = ["left", "right", "up", "down"];
  const LEND_FACE = ["a", "b", "x", "y"];
  const LEND_TRIGGERS = ["rt", "lt"];
  function lend(all) {
    const players = Object.keys(all);
    const padBound = players.some((who) => Object.keys(all[who] || {})
      .some((verb) => listOf(all[who][verb]).some((b) => b.startsWith("pad:"))));
    if (padBound) return all;
    const hidden = hiddenVerbs();
    const out = {};
    for (const who of players) {
      const verbs = all[who] || {};
      const mine = {};
      let face = 0;
      for (const verb of Object.keys(verbs)) {
        let more = [];
        if (LEND_ARROWS.indexOf(verb) !== -1) more = ["pad:" + verb, "pad:stick-" + verb];
        else if (verb === "start") more = ["pad:start", "pad:a"];
        else if (hidden.indexOf(verb) === -1 && face < LEND_FACE.length) {
          more = ["pad:" + LEND_FACE[face]];
          if (face < LEND_TRIGGERS.length) more.push("pad:" + LEND_TRIGGERS[face]);
          face += 1;
        }
        // A line, the way the file writes one, since the screens library's
        // hint reads lines.
        mine[verb] = listOf(verbs[verb]).concat(more).join(" ");
      }
      out[who] = mine;
    }
    return out;
  }

  // What the game is played with: its own bindings, and what is lent them.
  // Worked out once per bindings object, since it is asked every frame.
  let lentFrom = null;
  let lent = null;
  function bindings() {
    const all = declared();
    if (all !== lentFrom) {
      lentFrom = all;
      lent = lend(all);
    }
    return lent;
  }

  function deadzone() {
    try {
      if (typeof STICK_DEADZONE === "number") return STICK_DEADZONE;
    } catch (e) { /* config/controls.js is not loaded */ }
    return 0.35;
  }

  // Which corner the action buttons (and the aim stick) sit in; movement
  // takes the other thumb. "right" unless config/controls.js says "left".
  function buttonSide() {
    try {
      if (BUTTON_SIDE === "left") return "left";
    } catch (e) { /* config/controls.js is not loaded */ }
    return "right";
  }

  // The declared control scheme, or "" — which draws the same as "buttons".
  // An unknown name gets that shape too, said once, rather than a game with
  // no controls at all.
  const SCHEMES = ["buttons", "one-button", "swipe-tap", "stick-buttons", "dual-stick", "none"];
  let warnedScheme = false;
  function schemeName() {
    let name = "";
    try {
      if (typeof SCHEME === "string") name = SCHEME;
    } catch (e) { /* config/controls.js is not loaded */ }
    if (!name || SCHEMES.indexOf(name) !== -1) return name || "";
    if (!warnedScheme) {
      warnedScheme = true;
      console.warn('[input] unknown SCHEME "' + name + '" — drawing the buttons shape');
    }
    return "";
  }

  // The shape actually on the screen: the declared scheme, else "buttons".
  const shape = () => schemeName() || "buttons";

  function bindingsFor(player, action) {
    const who = bindings()["player" + (player || 1)];
    return who ? listOf(who[action]) : [];
  }

  /* What is down right now ------------------------------------------------ */

  const keysDown = new Set();   // key names, lowercased
  const touchDown = new Set();  // touch binding names, exactly as written
  const latched = new Set();    // toggle binding names currently on
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
    // The null controller never takes a key away from the page: its controls
    // are the page's own buttons, and a prevented keydown on Space is a click
    // the browser then never sends to the button under the focus.
    if (schemeName() !== "none" && isBoundKey(key)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keysDown.delete(e.key.toLowerCase()); });

  // A key held while the tab loses focus never sends its keyup, and would
  // otherwise stay down for the rest of the game. Latches drop too: coming
  // back to a game whose engine is still secretly on is worse than tapping.
  window.addEventListener("blur", () => {
    keysDown.clear();
    touchDown.clear();
    latched.clear();
    fingers.clear();
    screenPointers.clear();
    gestureStarts.clear();
    resetStick("move");
    resetStick("aim");
    paintButtons();
  });

  // The Screens library's Start button reaches the game as one frame of
  // "start", so a game that begins from Input.pressed("start") starts from a
  // tap on it even while the drawn controls are hidden.
  let relayStart = false;
  window.addEventListener("studio:start", () => { relayStart = true; });

  // While a Screens title or game-over screen is up it owns the view: the
  // drawn controls hide, thumbs release, latches drop, sticks rest.
  // screens.js marks the body; an older copy of either library simply
  // leaves things as they are today.
  function screensOpen() {
    const body = typeof document === "object" && document ? document.body : null;
    return !!(body && body.classList && body.classList.contains("screens-open"));
  }

  let screensWasOpen = false;
  function watchScreens() {
    const open = screensOpen();
    if (open === screensWasOpen) return;
    screensWasOpen = open;
    if (overlay) overlay.style.display = open ? "none" : "";
    if (open) {
      dropButtons();
      resetStick("move");
      resetStick("aim");
    }
  }

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

  // The virtual sticks: analog, floating — a stick's centre is wherever the
  // thumb lands in its slice of the screen, and it reports how far the thumb
  // has travelled from there, clamped at STICK_RADIUS pixels. stick:left …
  // stick:down read the move stick, stick:aim-left … the aim stick, and
  // stick:move / stick:aim are held while that stick is pushed at all.
  const STICK_RADIUS = 56;
  const TOUCH_STICKS = {
    "left": ["move", "x", -1], "right": ["move", "x", 1],
    "up": ["move", "y", -1], "down": ["move", "y", 1],
    "aim-left": ["aim", "x", -1], "aim-right": ["aim", "x", 1],
    "aim-up": ["aim", "y", -1], "aim-down": ["aim", "y", 1],
  };
  const touchSticks = {
    move: { x: 0, y: 0, id: null, cx: 0, cy: 0 },
    aim: { x: 0, y: 0, id: null, cx: 0, cy: 0 },
  };

  // Which sticks the scheme has, each with its slice of the screen as
  // fractions of the width — on the far side from the buttons. Thumbs sit
  // low, so the top 40% is left alone — a game's own menus and touches live
  // there untroubled.
  function stickZones() {
    const s = schemeName();
    const flip = buttonSide() === "left";
    if (s === "stick-buttons") return flip ? { move: [0.55, 1] } : { move: [0, 0.45] };
    if (s === "dual-stick") {
      return flip ? { move: [0.5, 1], aim: [0, 0.5] } : { move: [0, 0.5], aim: [0.5, 1] };
    }
    return null;
  }

  function stickAt(x, y) {
    const zones = stickZones();
    if (!zones || y < window.innerHeight * 0.4) return null;
    for (const name of Object.keys(zones)) {
      const zone = zones[name];
      if (x >= window.innerWidth * zone[0] && x < window.innerWidth * zone[1]) return name;
    }
    return null;
  }

  function stickFor(id) {
    for (const name of Object.keys(touchSticks)) {
      if (touchSticks[name].id === id) return name;
    }
    return null;
  }

  const clampStick = (v) => Math.max(-1, Math.min(1, v));

  function resetStick(name) {
    const stick = touchSticks[name];
    stick.id = null;
    stick.x = 0;
    stick.y = 0;
    hideStick(name);
  }

  function installSticks() {
    // Only real thumbs: a mouse dragged across the screen is not a stick.
    // A thumb that lands on a drawn button is the button's.
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || onControl(e) || screensOpen()) return;
      if (buttonAt(e.clientX, e.clientY)) return;
      const name = stickAt(e.clientX, e.clientY);
      if (!name) return;
      const stick = touchSticks[name];
      if (stick.id !== null) return; // one thumb per stick
      if (e.preventDefault) e.preventDefault();
      stick.id = e.pointerId;
      stick.cx = e.clientX;
      stick.cy = e.clientY;
      showStick(name, e.clientX, e.clientY);
    });
    window.addEventListener("pointermove", (e) => {
      const name = stickFor(e.pointerId);
      if (!name) return;
      const stick = touchSticks[name];
      stick.x = clampStick((e.clientX - stick.cx) / STICK_RADIUS);
      stick.y = clampStick((e.clientY - stick.cy) / STICK_RADIUS);
      moveStick(name);
    });
    const lift = (e) => {
      const name = stickFor(e.pointerId);
      if (name) resetStick(name);
    };
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
  }

  function stickHeld(name) {
    if (name === "move" || name === "aim") {
      const stick = touchSticks[name];
      return Math.hypot(stick.x, stick.y) > deadzone();
    }
    const spec = TOUCH_STICKS[name];
    if (!spec) return false;
    return touchSticks[spec[0]][spec[1]] * spec[2] > deadzone();
  }

  // Run once, on the first update: by then config/controls.js has loaded (it
  // is documented to stand in front of this file). A declared scheme also
  // owns the screen — no browser scrolling, zooming or text selection over
  // the game — waiting for <body> the way the overlay does. Two shapes leave
  // the body alone, so a page-shaped game may still scroll: the default one,
  // and "none", where the page's own buttons are the controls.
  let surfacesInstalled = false;
  let bodyOwned = false;
  function prepare() {
    if (!surfacesInstalled) {
      surfacesInstalled = true;
      const s = schemeName();
      if (s === "one-button") installOneButton();
      if (s === "swipe-tap") installSwipeTap();
      if (stickZones()) installSticks();
    }
    if (!bodyOwned && schemeName() && schemeName() !== "none" && document.body) {
      bodyOwned = true;
      const style = document.body.style;
      style.touchAction = "none";
      style.userSelect = "none";
      style.webkitUserSelect = "none";
      // ⚠️ iOS Safari zooms on a pinch whatever touch-action and the viewport
      // say, and on a kid's iPad the zoomed game could not be pinched back
      // out, which ends the run. Safari's own gesture event and a two-finger
      // move are where a zoom starts, so both are refused.
      const refuse = (e) => { if (e.preventDefault) e.preventDefault(); };
      window.addEventListener("gesturestart", refuse);
      window.addEventListener("touchmove", (e) => {
        if (e.touches && e.touches.length > 1) refuse(e);
      }, { passive: false });
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
    if (kind === "toggle") return latched.has(name);
    if (kind === "swipe") return gestureNow.has(name);
    if (kind === "stick") return stickHeld(name);
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
    watchScreens();
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
    if (relayStart) {
      relayStart = false;
      now.add(stamp("start", 1));
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

  // The same reading from the virtual stick, when a stick: binding names it.
  // The screen is player 1's, like the drawn buttons.
  function touchStickValue(negative, positive, player) {
    if ((player || 1) !== 1) return 0;
    for (const [action, way] of [[positive, 1], [negative, -1]]) {
      for (const binding of bindingsFor(player, action)) {
        if (!binding.startsWith("stick:")) continue;
        const spec = TOUCH_STICKS[binding.slice(6)];
        if (!spec) continue;
        const value = touchSticks[spec[0]][spec[1]] * spec[2] * way;
        return Math.abs(value) > deadzone() ? value : 0;
      }
    }
    return 0;
  }

  // -1 .. 1. A stick gives everything in between; keys, buttons and thumbs
  // on drawn buttons give the ends.
  function axis(negative, positive, player) {
    const analog = stickValue(negative, positive, player) || touchStickValue(negative, positive, player);
    if (analog !== 0) return analog;
    return (held(positive, player) ? 1 : 0) - (held(negative, player) ? 1 : 0);
  }

  /* Buttons drawn on the screen ------------------------------------------- */

  // Only player 1 gets these: one screen has room for two thumbs, not four.
  let overlay = null;

  // Every drawn button in declaration order: a touch: name is held while a
  // thumb is on it, a toggle: name latches. A name bound both ways latches.
  function drawnNames() {
    const out = [];
    const actions = bindings().player1 || {};
    for (const action of Object.keys(actions)) {
      for (const binding of listOf(actions[action])) {
        const kind = binding.startsWith("touch:") ? "touch"
          : binding.startsWith("toggle:") ? "toggle" : null;
        if (!kind) continue;
        const name = binding.slice(kind.length + 1);
        const seen = out.find((b) => b.name === name);
        if (seen) seen.toggle = seen.toggle || kind === "toggle";
        else out.push({ name: name, toggle: kind === "toggle" });
      }
    }
    return out;
  }

  const ARROWS = { left: "←", right: "→", up: "↑", down: "↓" };

  // Dark inside, light outline. A game can be any colour behind these, so a
  // pale button on a pale background is a control nobody can find.
  const REST = "rgba(18,18,26,.42)";
  const PUSHED = "rgba(18,18,26,.78)";

  // Radii of the visible circles, the invisible extra ring of hit area every
  // button gets — a thumb that lands a little off still lands — and the
  // margin to the screen's corners.
  const R_PAIR = 48;    // a one-axis direction pair
  const R_CELL = 32;    // an arrow-pad cell
  const R_ACTION = 42;  // an action button
  const R_PRIMARY = 48; // the first action button
  const HALO = 14;
  const EDGE = 18;

  // The drawn buttons as geometry: centres offset from the anchored edge
  // (ox) and from the bottom (oy). Hit-testing is this arithmetic, never the
  // DOM, so the same thumb math runs with no screen at all — the drawing is
  // only paint.
  let drawn = [];

  function layoutButtons() {
    const names = drawnNames();
    if (!names.length) return [];
    const side = buttonSide();
    const out = [];

    // Directions under one thumb: one axis is a big pair (or one big
    // button), both axes are the arrow pad, a cell per bound direction.
    const dirs = ["left", "right", "up", "down"].filter((n) => names.some((b) => b.name === n));
    const dirAnchor = side === "right" ? "left" : "right";
    const oneAxis = dirs.every((n) => n === "left" || n === "right")
      || dirs.every((n) => n === "up" || n === "down");
    for (const b of names.filter((b) => ARROWS[b.name])) {
      const entry = { name: b.name, toggle: b.toggle, anchor: dirAnchor, r: oneAxis ? R_PAIR : R_CELL };
      if (oneAxis) {
        // ← before →, ↑ above ↓, whichever corner the pair is anchored in.
        const k = dirs.indexOf(b.name);
        const step = R_PAIR * 2 + 12;
        const across = b.name === "left" || b.name === "right";
        const flipped = across && dirAnchor === "right";
        entry.ox = EDGE + R_PAIR + (across ? (flipped ? dirs.length - 1 - k : k) * step : 0);
        entry.oy = EDGE + R_PAIR + (across ? 0 : (dirs.length - 1 - k) * step);
      } else {
        // Cell columns from the screen's left, rows from the bottom.
        const grid = { left: [0, 1], right: [2, 1], up: [1, 2], down: [1, 0] }[b.name];
        const gx = dirAnchor === "left" ? grid[0] : 2 - grid[0];
        entry.ox = EDGE + R_CELL + gx * 68;
        entry.oy = EDGE + R_CELL + grid[1] * 68;
      }
      out.push(entry);
    }

    // Everything else under the other thumb, climbing a diagonal from the
    // corner: the first-declared button is the big one nearest it.
    let k = 0;
    for (const b of names.filter((b) => !ARROWS[b.name])) {
      out.push({
        name: b.name,
        toggle: b.toggle,
        anchor: side,
        r: k === 0 ? R_PRIMARY : R_ACTION,
        ox: EDGE + R_PRIMARY + k * 56,
        oy: EDGE + R_PRIMARY + k * 76,
      });
      k += 1;
    }
    return out;
  }

  const centerX = (b) => (b.anchor === "left" ? b.ox : window.innerWidth - b.ox);
  const centerY = (b) => window.innerHeight - b.oy;

  // The button under a point, if any — the nearest centre wins where halos
  // overlap, which is what lets a thumb rock across neighbours.
  function buttonAt(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const b of drawn) {
      const d = Math.hypot(x - centerX(b), y - centerY(b));
      if (d <= b.r + HALO && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  // Which drawn button each finger is on. Sliding from one button onto the
  // next presses it without a lift; sliding onto a toggle changes nothing,
  // because a latch only flips on a deliberate tap.
  const fingers = new Map(); // pointerId -> momentary name, or null

  function syncFingers() {
    for (const b of drawn) {
      if (!b.toggle) touchDown.delete(b.name);
    }
    for (const name of fingers.values()) {
      if (name) touchDown.add(name);
    }
    paintButtons();
  }

  function dropButtons() {
    fingers.clear();
    latched.clear();
    syncFingers();
  }

  function installButtons() {
    window.addEventListener("pointerdown", (e) => {
      if (screensOpen()) return;
      const b = buttonAt(e.clientX, e.clientY);
      if (!b) return;
      if (e.preventDefault) e.preventDefault();
      if (b.toggle) {
        if (latched.has(b.name)) latched.delete(b.name);
        else latched.add(b.name);
        fingers.set(e.pointerId, null);
      } else {
        fingers.set(e.pointerId, b.name);
      }
      syncFingers();
    });
    window.addEventListener("pointermove", (e) => {
      if (!fingers.has(e.pointerId)) return;
      const b = buttonAt(e.clientX, e.clientY);
      const name = b && !b.toggle ? b.name : null;
      if (fingers.get(e.pointerId) === name) return;
      fingers.set(e.pointerId, name);
      syncFingers();
    });
    const lift = (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.delete(e.pointerId);
      syncFingers();
    };
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
  }

  function paintButtons() {
    for (const b of drawn) {
      if (!b.el) continue;
      const on = b.toggle ? latched.has(b.name) : touchDown.has(b.name);
      b.el.style.background = on ? PUSHED : REST;
      b.el.style.borderColor = b.toggle && on ? "#fff" : "rgba(255,255,255,.8)";
      b.el.style.boxShadow = b.toggle && on
        ? "0 0 10px rgba(255,255,255,.5)" : "0 1px 4px rgba(0,0,0,.45)";
    }
  }

  // The whole element is the hit halo, transparent, with the visible circle
  // on a face inside it, so the browser's touch handling covers the halo
  // too. No listeners: the window-level tracking above is the behaviour.
  function drawButton(b) {
    const hit = b.r + HALO;
    const el = document.createElement("button");
    el.setAttribute("aria-label", b.name);
    el.style.cssText = "position:fixed;display:flex;align-items:center;justify-content:center;"
      + (b.anchor === "left" ? "left:" : "right:") + (b.ox - hit) + "px;bottom:" + (b.oy - hit) + "px;"
      + "width:" + hit * 2 + "px;height:" + hit * 2 + "px;padding:0;margin:0;"
      + "background:none;border:none;border-radius:50%;z-index:9999;"
      + "touch-action:none;user-select:none;-webkit-user-select:none;"
      + "-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;";
    const face = document.createElement("span");
    face.textContent = ARROWS[b.name] || b.name;
    face.style.cssText = "display:flex;align-items:center;justify-content:center;overflow:hidden;"
      + "width:" + b.r * 2 + "px;height:" + b.r * 2 + "px;box-sizing:border-box;border-radius:50%;"
      + "border:2px solid rgba(255,255,255,.8);background:" + REST + ";"
      + "color:#fff;font:600 " + (b.r >= R_PRIMARY ? 20 : 18) + "px/1 system-ui,sans-serif;"
      + "box-shadow:0 1px 4px rgba(0,0,0,.45);";
    el.append(face);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    b.el = face;
    return el;
  }

  // The drawn side of a virtual stick: a resting ring and a knob, hidden
  // until a thumb lands, following it while it is down. Only ever built in a
  // browser with a coarse pointer — everywhere else these are no-ops and the
  // stick is state alone.
  let stickParts = null;

  function buildStickParts() {
    const base = document.createElement("div");
    base.style.cssText = "position:fixed;display:none;width:120px;height:120px;border-radius:50%;"
      + "box-sizing:border-box;border:2px solid rgba(255,255,255,.5);background:" + REST + ";"
      + "pointer-events:none;z-index:9999;";
    const knob = document.createElement("div");
    knob.style.cssText = "position:absolute;left:30px;top:30px;width:56px;height:56px;border-radius:50%;"
      + "box-sizing:border-box;border:2px solid rgba(255,255,255,.8);background:" + PUSHED + ";";
    base.append(knob);
    document.body.append(base);
    return { base, knob };
  }

  function showStick(name, x, y) {
    const part = stickParts && stickParts[name];
    if (!part) return;
    part.base.style.left = (x - 60) + "px";
    part.base.style.top = (y - 60) + "px";
    part.base.style.display = "block";
    part.knob.style.transform = "";
  }

  function moveStick(name) {
    const part = stickParts && stickParts[name];
    if (!part) return;
    const stick = touchSticks[name];
    // 32px of knob travel keeps the knob inside the ring at full tilt.
    part.knob.style.transform = "translate(" + (stick.x * 32) + "px," + (stick.y * 32) + "px)";
  }

  function hideStick(name) {
    const part = stickParts && stickParts[name];
    if (!part) return;
    part.base.style.display = "none";
    part.knob.style.transform = "";
  }

  // Built once, on the first frame, and only where there is a touchscreen to
  // build it for — a laptop with a mouse gets nothing drawn over the game.
  function buildTouchControls() {
    if (overlay) return;
    // Three shapes draw nothing: one-button and swipe-tap make the screen
    // itself the control, and "none" has no controller to draw.
    const s = shape();
    if (s === "one-button" || s === "swipe-tap" || s === "none") return;
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse || !document.body) return;
    const zones = stickZones();
    drawn = layoutButtons();
    if (!drawn.length && !zones) return;

    // A group to show and hide as one; the buttons position themselves.
    overlay = document.createElement("div");
    overlay.id = "touch-controls";
    overlay.style.cssText = "user-select:none;-webkit-user-select:none;";
    for (const b of drawn) overlay.append(drawButton(b));
    document.body.append(overlay);
    if (screensWasOpen) overlay.style.display = "none";
    if (drawn.length) installButtons();
    if (zones) {
      stickParts = {};
      for (const name of Object.keys(zones)) stickParts[name] = buildStickParts();
    }
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
    // The bindings actually played, lent controller buttons included. For
    // the screens library's how-to-play line, so it names what a controller
    // really does; a game asks held and pressed instead.
    bindings,
  };
}());

window.Input = Input;
