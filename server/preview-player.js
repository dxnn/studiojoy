// The preview player: what the studio's preview is, beside the reporter, since
// 2026-10-04 (ideas/dreams.md §3). The preview is a different kind of player
// from anybody playing the game: it is always debugging, and it is never on
// any board. Both are this script, injected into the wrapper after the
// reporter and ahead of every script of the game's own.
//
// It owns the game's time. The timestamps requestAnimationFrame hands a game,
// performance.now(), Date.now(), setTimeout, setInterval and Math.random()
// all come from here, so the studio can pause a game, step it one frame at a
// time, run it at half or quarter speed or two, four or sixteen times over — every
// canvas game, without the game knowing — and the random numbers are a
// stream with a state of its own, so a moment can be had again: a savepoint
// is the game's State (studio/state.js) and where that stream stood, taken by
// Pin and put back by Back, for any game that keeps its run in State.
//
// And it has the robot (below, and ideas/dreams.md §4): a player of its own
// that presses the game's keys, is taught by the game's js/robot.js if it has
// one, and hands the studio the moment before the game broke.
//
// And it answers the scoreboard and the achievements itself. A score or an
// unlock posted from the preview never leaves the page: the game hears "it
// did not make the board" and "it is yours", so a maker sees their game-over
// screen and watches an achievement toast every time it is met, and nothing
// lands on any board or in anybody's trophies. Asked who is playing, it says
// Preview; asked what this player has earned, it says nothing yet. Only
// `fetch` and `sendBeacon` are answered — a game hand-rolling an
// XMLHttpRequest to the board still reaches it.
//
// The reporter's two rules hold here too: only when framed, and never throw —
// an exception from this script would surface inside the game as a bug the
// game does not have. Where the game's own callback throws, it is let through
// untouched, so the reporter files it against the game's file and line.

export const PREVIEW_PLAYER_JS = `(function () {
  if (window.parent === window) return;
  if (!window.requestAnimationFrame || !window.performance || !Math.imul) return;
  var slug = location.pathname.split('/')[1] || '';
  var FRAME = 1000 / 60;

  function tell(message) {
    try {
      message.gamestudio = 'player-' + message.what;
      message.slug = slug;
      window.parent.postMessage(message, '*');
    } catch (err) { /* nothing is listening; the game carries on */ }
  }

  // ---------- time ----------

  var paused = false;
  var speed = 1;
  var steps = 0;
  var redraw = false;
  // Whether this page has handed the game a frame yet. A page that loads off
  // Play is paused before its first one, and a game that has never been called
  // has drawn nothing — so it is given one with no time in it, as soon as it
  // asks: the builder's shot is taken from this page (spec.md §6).
  var shown = false;
  var realNow = performance.now.bind(performance);
  var realFrame = window.requestAnimationFrame.bind(window);
  var now = realNow();
  var last = now;
  var queue = [];
  var nextId = 1;
  // Game time owed and not yet run.
  var owed = 0;
  // The most whole frames one real frame may run, times the speed: past that
  // the machine cannot keep up, and the rest is let go rather than raced.
  var MOST = 4;
  // A real frame a hair short of 1/60 s still runs one: a 60 Hz screen ticks
  // with jitter, and without the slack a game at 1× would miss a frame and
  // double the next, over and over. What it borrows comes off the next.
  var SLACK = 4;

  // Every callback the game asked for since the last frame, with the clock's
  // time. One asked for again from inside a callback waits for the next.
  function frame() {
    var due = queue;
    queue = [];
    if (due.length) shown = true;
    for (var i = 0; i < due.length; i++) due[i].fn(now);
  }

  // One whole game frame: the robot's savepoint when one is due, taken between
  // two frames like a pin; then the clock a frame on, the timers it brought
  // due, the robot's hands, and the game.
  function wholeFrame() {
    if (robot.on && robot.frames % KEEP_EVERY === 0) keep();
    now += FRAME;
    timers();
    robotFrame();
    frame();
  }

  // One real frame. ⚠️ Time goes in whole frames of exactly 1/60 s at every
  // speed, as many as are owed: the game is a 60 Hz machine here whatever the
  // screen is and however fast it is played, so one frame of the game is the
  // same frame at ¼× as at 4×. A game that counts something per frame rather
  // than per second — Asteriskoids' risk did — counted four times as fast in
  // slow motion while its rocks moved at a quarter (decided 2026-10-05). So ¼×
  // is a whole frame every fourth screen frame, choppy and exact; a 120 Hz
  // screen runs one every other; and a run is the same run however fast the
  // machine, which is what lets the robot's moment before a break break the
  // same way again. A redraw runs the callbacks with no time at all, so a
  // paused game shows a moment put back without moving. The next real frame is
  // asked for first, so a game whose callback throws stops nothing.
  function tick() {
    realFrame(tick);
    var real = realNow();
    var gap = real - last;
    last = real;
    var drawAgain = redraw;
    redraw = false;
    if (paused) {
      owed = 0;
      if (steps > 0) { steps -= 1; wholeFrame(); }
      else if (drawAgain || !shown) frame();
      return;
    }
    owed += gap * speed;
    var most = MOST * Math.max(1, speed);
    var ran = 0;
    while (owed >= FRAME - SLACK && ran < most) { owed -= FRAME; ran += 1; wholeFrame(); }
    if (ran === most) owed = 0;
    if (ran === 0 && drawAgain) frame();
  }

  window.requestAnimationFrame = function (fn) {
    var id = nextId++;
    queue.push({ id: id, fn: fn });
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) { queue.splice(i, 1); return; }
    }
  };
  performance.now = function () { return now; };

  // Date.now() keeps the same clock, from where the real one stood: a game
  // timing itself with it pauses, hurries and plays back like any other. So
  // does new Date() with nothing in the brackets, which is the same question
  // asked another way — a Date of the game's own clock, still a Date to
  // instanceof and to its own constructor, so asking a Date for its
  // constructor, or copying one with it, behaves as on the public page; and
  // Date(...) with a time given just what it always was. No fallback: an
  // engine without new.target cannot parse this script at all.
  var RealDate = Date;
  var dateBase = RealDate.now() - now;
  var clockNow = function () { return Math.floor(dateBase + now); };
  var ClockDate = function Date() {
    if (!new.target) return new RealDate(clockNow()).toString();
    var args = arguments.length ? Array.prototype.slice.call(arguments) : [clockNow()];
    return Reflect.construct(RealDate, args, new.target);
  };
  ClockDate.prototype = RealDate.prototype;
  RealDate.prototype.constructor = ClockDate;
  ClockDate.now = clockNow;
  ClockDate.parse = RealDate.parse;
  ClockDate.UTC = RealDate.UTC;
  window.Date = ClockDate;

  // An input event's timeStamp is the same clock again: a game timing a double
  // tap or a held key with it slows, pauses and plays back with the rest. A
  // browser that will not let it be redefined keeps real time there.
  try {
    if (typeof Event === 'function') {
      Object.defineProperty(Event.prototype, 'timeStamp', {
        configurable: true, get: function () { return now; },
      });
    }
  } catch (err) { /* real time for this one */ }

  // setTimeout and setInterval run from the same clock too (ideas/dreams.md
  // §4), so Pause pauses them, fast-forward hurries them and a robot's run is
  // the same run again. A timer is due once the clock reaches it, and runs at
  // the top of the frame it came due in; one set while timers are running
  // waits for the next frame, so a timer that keeps setting itself cannot
  // hold a frame up. One that throws is the game's error, thrown again on a
  // real timer of its own so the reporter files it and the frame goes on.
  var realTimeout = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : null;
  var timed = [];

  function later(fn, ms, args, repeat) {
    var id = nextId++;
    var wait = Math.max(0, Number(ms) || 0);
    var run = typeof fn === 'function' ? fn : function () { (0, eval)(String(fn)); };
    timed.push({ id: id, at: now + wait, every: repeat ? Math.max(1, wait) : 0, fn: run, args: args });
    return id;
  }

  function forget(id) {
    for (var i = 0; i < timed.length; i++) {
      if (timed[i].id === id) { timed.splice(i, 1); return; }
    }
  }

  function timers() {
    var before = nextId;
    for (var guard = 0; guard < 1000; guard++) {
      var next = null;
      for (var i = 0; i < timed.length; i++) {
        var t = timed[i];
        if (t.id < before && t.at <= now && (!next || t.at < next.at)) next = t;
      }
      if (!next) return;
      if (next.every) next.at += next.every;
      else forget(next.id);
      try {
        next.fn.apply(window, next.args);
      } catch (err) {
        if (!realTimeout) throw err;
        realTimeout(function () { throw err; }, 0);
      }
    }
  }

  var rest = function (list) { return Array.prototype.slice.call(list, 2); };
  window.setTimeout = function (fn, ms) { return later(fn, ms, rest(arguments), false); };
  window.setInterval = function (fn, ms) { return later(fn, ms, rest(arguments), true); };
  window.clearTimeout = function (id) { forget(id); };
  window.clearInterval = function (id) { forget(id); };

  realFrame(tick);

  // ---------- chance ----------

  // mulberry32: small, fast, and a whole state in one number, which is what
  // lets a moment be had again with the same meteors falling.
  function draw(s) {
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  var seed = (Math.floor(Math.random() * 4294967296) ^ Date.now()) >>> 0;
  // The robot's own dice (below), so the game's are the same whoever plays.
  var robotSeed = (Math.floor(Math.random() * 4294967296) ^ 0x9E3779B9) >>> 0;
  Math.random = function () {
    seed = (seed + 0x6D2B79F5) >>> 0;
    return draw(seed);
  };

  // ---------- never on a board ----------

  function answer(status, body) {
    return new Response(JSON.stringify(body), {
      status: status, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Which of the board's routes a request is, or null for any other.
  function boardRoute(input, method) {
    try {
      var url = new URL(typeof input === 'string' ? input : (input && input.url) || '', location.href);
      if (url.origin !== location.origin) return null;
      var post = String(method || 'GET').toUpperCase() === 'POST';
      if (url.pathname === '/_me') return 'me';
      if (/^\\/_scores\\//.test(url.pathname)) return post ? 'score' : null;
      if (/^\\/_achievements\\//.test(url.pathname)) return post ? 'unlock' : 'earned';
    } catch (err) { /* not a URL this answers */ }
    return null;
  }

  var realFetch = window.fetch && window.fetch.bind(window);
  if (realFetch) {
    window.fetch = function (input, init) {
      var route = boardRoute(input, (init && init.method) || (input && input.method));
      if (route === 'me') return Promise.resolve(answer(200, { user: { name: 'Preview' } }));
      if (route === 'score') return Promise.resolve(answer(201, { rank: null, preview: true }));
      if (route === 'unlock') return Promise.resolve(answer(201, { new: true, preview: true }));
      if (route === 'earned') {
        return realFetch(input, init).then(function (res) {
          if (!res.ok) return res;
          return res.json().then(function (body) {
            var list = (body && body.achievements) || [];
            for (var i = 0; i < list.length; i++) list[i].got = null;
            return answer(res.status, body);
          });
        });
      }
      return realFetch(input, init);
    };
  }
  if (navigator.sendBeacon) {
    var realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      return boardRoute(url, 'POST') ? true : realBeacon(url, data);
    };
  }

  // ---------- tweaks ----------

  // Numbers being tried in the studio, by config file and declaration —
  // {"config/play.js": {"PLAY": {...}}} — written into the live objects the
  // config files made. Kept on this origin too, so the next page has them
  // before the game's own code runs: each file's are put in the moment that
  // file has run, which is before the script after it starts. A const that is
  // a plain number cannot be written to and keeps what the file says.
  var TWEAKS = 'studio-tweaks:' + slug;
  var tweaks = {};
  try { tweaks = JSON.parse(localStorage.getItem(TWEAKS) || '{}') || {}; } catch (err) { tweaks = {}; }

  function into(target, value) {
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      var v = value[key];
      var t = target[key];
      if (Array.isArray(v) && Array.isArray(t)) {
        t.length = 0;
        for (var i = 0; i < v.length; i++) t.push(JSON.parse(JSON.stringify(v[i])));
      } else if (v && typeof v === 'object' && t && typeof t === 'object') {
        into(t, v);
      } else {
        target[key] = v;
      }
    }
  }

  // What each declaration was before a tweak first touched it, by file and
  // name, so a tweak let go — its value put back to the file's, or every
  // tweak undone — puts the game back at once rather than at the next page.
  // Config is plain data, so its JSON is the whole of it.
  var originals = {};

  function liveOf(name) {
    if (!/^[A-Za-z_$][\\w$]*$/.test(name)) return null;
    var live;
    try { live = (0, eval)(name); } catch (err) { return null; }
    return live && typeof live === 'object' ? live : null;
  }

  function tweak(file, decls) {
    for (var name in decls) {
      if (!Object.prototype.hasOwnProperty.call(decls, name)) continue;
      var live = liveOf(name);
      if (!live || !decls[name] || typeof decls[name] !== 'object') continue;
      var kept = originals[file] || (originals[file] = {});
      if (!Object.prototype.hasOwnProperty.call(kept, name)) {
        try { kept[name] = JSON.stringify(live); } catch (err) { /* not plain: never put back */ }
      }
      into(live, decls[name]);
    }
  }

  // Every declaration a tweak touched and no tweak names now, put back.
  function untweak() {
    for (var file in originals) {
      if (!Object.prototype.hasOwnProperty.call(originals, file)) continue;
      for (var name in originals[file]) {
        if (!Object.prototype.hasOwnProperty.call(originals[file], name)) continue;
        if (tweaks[file] && Object.prototype.hasOwnProperty.call(tweaks[file], name)) continue;
        var live = liveOf(name);
        if (live) into(live, JSON.parse(originals[file][name]));
        delete originals[file][name];
      }
    }
  }

  // Which config file a script element is, as the tweaks name it.
  function fileOf(src) {
    try {
      var path = new URL(src, location.href).pathname;
      var mark = '/' + slug + '/';
      return path.indexOf(mark) === 0 ? path.slice(mark.length) : null;
    } catch (err) { return null; }
  }

  if (document.addEventListener) {
    document.addEventListener('load', function (event) {
      try {
        var el = event.target;
        if (!el || el.tagName !== 'SCRIPT' || !el.src) return;
        var file = fileOf(el.src);
        if (file && tweaks[file]) tweak(file, tweaks[file]);
      } catch (err) { /* never break the game */ }
    }, true);
  }

  function retweak(next) {
    tweaks = next && typeof next === 'object' ? next : {};
    try { localStorage.setItem(TWEAKS, JSON.stringify(tweaks)); } catch (err) { /* private mode */ }
    untweak();
    for (var file in tweaks) {
      if (Object.prototype.hasOwnProperty.call(tweaks, file)) tweak(file, tweaks[file]);
    }
  }

  // ---------- savepoints ----------

  // The game's State (studio/state.js) — a const on the page, so reached by
  // name from global code rather than as a property of window — or null for a
  // game that keeps its run somewhere else.
  function gameState() {
    try {
      var found = (0, eval)('typeof State === "undefined" ? null : State');
      return found && typeof found.save === 'function' ? found : null;
    } catch (err) { return null; }
  }

  // A savepoint is the game's State and the random stream where it stood. The
  // clock is left alone: it only ever goes forward, so no game is handed a
  // frame from before its last one. The studio keeps it, which is how one
  // outlives a reload of this page.
  function pin() {
    var game = gameState();
    if (!game) { tell({ what: 'unpinned', reason: 'no-state' }); return; }
    var file = game.save();
    if (file === null) { tell({ what: 'unpinned', reason: 'not-plain' }); return; }
    tell({ what: 'pinned', savepoint: { file: file, seed: seed, robot: robotNow() } });
  }

  // Back to one. Not inside a try: a game's own State.loaded() that throws is
  // the game's error, for the reporter to file against its line.
  function back(savepoint) {
    var game = gameState();
    if (!game || !savepoint || typeof savepoint.file !== 'string') {
      tell({ what: 'unpinned', reason: 'no-state' });
      return;
    }
    if (!game.load(savepoint.file)) { tell({ what: 'unpinned', reason: 'not-a-save' }); return; }
    if (typeof savepoint.seed === 'number') seed = savepoint.seed >>> 0;
    robotBack(savepoint.robot);
    redraw = true;
  }

  // "Try this scene" and "Try it": the game's State once the page has loaded —
  // the game makes it while it loads — with the editor's fields laid over it,
  // loaded and then pinned, so Back comes here too. The savepoint's own way in,
  // not a second one; it replaces whatever was pinned, which is fine, since
  // trying a scene is a different thing from tuning the last one.
  function jump(fields) {
    var go = function () {
      var game = gameState();
      var file = game ? game.save() : null;
      if (file === null) { tell({ what: 'unpinned', reason: game ? 'not-plain' : 'no-state' }); return; }
      var saved = JSON.parse(file);
      for (var key in fields) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) saved.state[key] = fields[key];
      }
      if (!game.load(JSON.stringify(saved))) { tell({ what: 'unpinned', reason: 'not-a-save' }); return; }
      redraw = true;
      pin();
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go);
  }

  // ---------- sound ----------

  // Silent above 1×: every AudioContext the page makes is noted, and held
  // while the game runs fast — a game's own resume() included — then let go;
  // a sound played on an element is skipped while it does.
  var contexts = [];
  var quiet = function (p) { if (p && p.catch) p.catch(function () {}); };

  function hush() {
    for (var i = 0; i < contexts.length; i++) {
      var c = contexts[i];
      try {
        if (speed > 1 && !c.held) { c.held = true; quiet(c.suspend()); }
        else if (speed <= 1 && c.held) { c.held = false; quiet(c.resume()); }
      } catch (err) { /* a context already closed */ }
    }
  }

  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Real = window[name];
    if (typeof Real !== 'function') return;
    var Made = function () {
      var made = new (Function.prototype.bind.apply(Real, [null].concat(Array.prototype.slice.call(arguments))))();
      var c = { held: false, suspend: made.suspend.bind(made), resume: made.resume.bind(made) };
      made.resume = function () { return speed > 1 ? Promise.resolve() : c.resume(); };
      contexts.push(c);
      hush();
      return made;
    };
    Made.prototype = Real.prototype;
    window[name] = Made;
  });
  if (window.HTMLMediaElement && window.HTMLMediaElement.prototype.play) {
    var realPlay = window.HTMLMediaElement.prototype.play;
    window.HTMLMediaElement.prototype.play = function () {
      return speed > 1 ? Promise.resolve() : realPlay.apply(this, arguments);
    };
  }

  // ---------- the robot ----------

  // The studio's robot (ideas/dreams.md §4) plays the game for whoever is
  // watching. Its hands are key events — player one's verbs in
  // config/controls.js, each sent as its first key, which the input library
  // and a game's own listeners hear alike — and taps, where the page's own
  // buttons are the controls. Untaught, it holds a few verbs at a time for a
  // spell each. A game teaches it in js/robot.js, which only this page loads
  // (server/reporter.js):
  //
  //   Robot.play(function (state) { return ["right", "fire"]; });
  //
  // handed State every frame, answering the verbs to hold — or a thing on the
  // page to tap, or { x, y } to tap there. Robot.random() is its own dice, so
  // the game's are the same whoever plays. It presses Start on a title or
  // game-over screen after a beat, so it plays run after run, and a person's
  // own key or tap stops it. While it plays it keeps savepoints of its own,
  // two seconds apart — never the pin — and when the game throws it stops
  // and hands the oldest to the studio: a moment a few seconds before the
  // break, which plays into the same break again.
  var robot = { on: false, learned: false, held: {}, spells: {}, wait: 0, rest: 0, frames: 0 };
  var taught = null;
  var keys = {}; // the verbs it can press, as [key, code, keyCode]
  var down = {}; // the verbs it is holding down now
  var ring = []; // its own savepoints, oldest first
  var START_WAIT = 90; // frames a title or game-over screen stays up before Start
  var REST = 36; // frames after a tap before it decides again
  var KEEP_EVERY = 120; // frames between its savepoints
  var KEEP = 3;
  var PAIRS = { left: 'right', right: 'left', up: 'down', down: 'up' };
  // The friendly key names config/controls.js uses, as a keyboard sends them.
  var NAMED = {
    left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39],
    up: ['ArrowUp', 'ArrowUp', 38], down: ['ArrowDown', 'ArrowDown', 40],
    space: [' ', 'Space', 32], enter: ['Enter', 'Enter', 13], tab: ['Tab', 'Tab', 9],
    esc: ['Escape', 'Escape', 27], escape: ['Escape', 'Escape', 27],
    shift: ['Shift', 'ShiftLeft', 16], ctrl: ['Control', 'ControlLeft', 17], alt: ['Alt', 'AltLeft', 18]
  };
  // What the input library falls back to without a config/controls.js — and
  // what a game listening for its own keys most likely wants too.
  var FALLBACK = {
    left: 'key:left', right: 'key:right', up: 'key:up', down: 'key:down', fire: 'key:space', start: 'key:enter'
  };

  function roll() {
    robotSeed = (robotSeed + 0x6D2B79F5) >>> 0;
    return draw(robotSeed);
  }

  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };

  function global(name) {
    try { return (0, eval)('typeof ' + name + ' === "undefined" ? null : ' + name); } catch (err) { return null; }
  }

  function keyOf(name) {
    var k = String(name).toLowerCase();
    if (NAMED[k]) return NAMED[k];
    if (k.length === 1 && k >= 'a' && k <= 'z') return [k, 'Key' + k.toUpperCase(), k.toUpperCase().charCodeAt(0)];
    if (k.length === 1 && k >= '0' && k <= '9') return [k, 'Digit' + k, k.charCodeAt(0)];
    return [k, k, 0];
  }

  // Player one's verbs, each with the first key bound to it.
  function learnKeys() {
    var controls = global('CONTROLS');
    var one = (controls && controls.player1) || FALLBACK;
    keys = {};
    for (var verb in one) {
      if (!Object.prototype.hasOwnProperty.call(one, verb)) continue;
      var list = Array.isArray(one[verb]) ? one[verb] : String(one[verb]).split(' ');
      for (var i = 0; i < list.length; i++) {
        if (String(list[i]).indexOf('key:') === 0) { keys[verb] = keyOf(String(list[i]).slice(4)); break; }
      }
    }
    robot.learned = true;
  }

  function send(type, key) {
    try {
      var e = new KeyboardEvent(type, { key: key[0], code: key[1], bubbles: true, cancelable: true });
      Object.defineProperty(e, 'keyCode', { value: key[2] });
      Object.defineProperty(e, 'which', { value: key[2] });
      (document.activeElement || document.body).dispatchEvent(e);
    } catch (err) { /* a page with no keyboard to speak of */ }
  }

  // Exactly these verbs held, from this frame on.
  function hold(want) {
    for (var verb in keys) {
      var on = !!want[verb];
      if (on && !down[verb]) { down[verb] = true; send('keydown', keys[verb]); }
      else if (!on && down[verb]) { delete down[verb]; send('keyup', keys[verb]); }
    }
  }

  // A tap on a thing at a point of the page, as a finger or a mouse makes one.
  function tapOn(at, x, y) {
    try {
      var how = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
      var Pointer = window.PointerEvent || MouseEvent;
      at.dispatchEvent(new Pointer('pointerdown', how));
      at.dispatchEvent(new MouseEvent('mousedown', how));
      at.dispatchEvent(new Pointer('pointerup', how));
      at.dispatchEvent(new MouseEvent('mouseup', how));
      at.dispatchEvent(new MouseEvent('click', how));
    } catch (err) { /* nothing there to tap */ }
  }

  // A thing the robot chose is tapped itself, in its middle — so a game that
  // reads where a tap landed reads the thing, and a button a small preview
  // has cut in half is still pressed. { x, y } taps whatever is there.
  function tap(what) {
    if (what && typeof what.getBoundingClientRect === 'function') {
      var r = what.getBoundingClientRect();
      tapOn(what, r.left + r.width / 2, r.top + r.height / 2);
    } else if (what && typeof what.x === 'number' && typeof what.y === 'number') {
      var at = document.elementFromPoint(what.x, what.y);
      if (at) tapOn(at, what.x, what.y);
    }
  }

  var tappable = function (want) {
    return !!want && !Array.isArray(want)
      && (typeof want.getBoundingClientRect === 'function' || typeof want.x === 'number');
  };

  // The robot untaught. Where the page's own buttons are the controls, one of
  // them every so often. Otherwise — and on such a page with no button up,
  // which is also every free-form game still on the blank page's "none" —
  // each verb held or let go for a spell of its own, never both ways of a
  // pair at once; Start now and then, and a tap in the middle of the page,
  // for a game whose title screen is its own.
  function untaught() {
    if (global('SCHEME') === 'none') {
      var all = document.querySelectorAll('button');
      var shown = [];
      for (var i = 0; i < all.length; i++) {
        if (!all[i].disabled && all[i].getClientRects().length) shown.push(all[i]);
      }
      if (shown.length) return shown[Math.floor(roll() * shown.length)];
    }
    if (robot.frames % 240 === 120) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var want = {};
    for (var verb in keys) {
      if (verb === 'start') continue;
      if (!(robot.spells[verb] > 0)) {
        robot.held[verb] = !robot.held[verb] && roll() < 0.6;
        robot.spells[verb] = robot.held[verb] ? 10 + Math.floor(roll() * 50) : 5 + Math.floor(roll() * 40);
      }
      robot.spells[verb] -= 1;
      if (robot.held[verb] && !want[PAIRS[verb]]) want[verb] = true;
    }
    if (robot.frames % 300 === 299) want.start = true;
    return want;
  }

  // The robot's hands for one game frame, before the game reads them.
  function robotFrame() {
    if (!robot.on) return;
    if (!robot.learned) learnKeys();
    robot.frames += 1;
    var start = document.querySelector('.screens-title-screen .screens-start');
    if (start) {
      hold({});
      robot.wait += 1;
      if (robot.wait >= START_WAIT) { robot.wait = 0; tap(start); }
      return;
    }
    robot.wait = 0;
    if (robot.rest > 0) { robot.rest -= 1; return; }
    var want;
    if (taught) {
      // Its teacher's error is the game's to fix: filed by the reporter
      // against js/robot.js, with the robot already stopped.
      try { want = taught(gameState() || {}); } catch (err) { stopRobot('taught'); throw err; }
    } else {
      want = untaught();
    }
    if (tappable(want)) { hold({}); tap(want); robot.rest = REST; return; }
    var set = {};
    if (Array.isArray(want)) { for (var i = 0; i < want.length; i++) set[want[i]] = true; }
    else if (want && typeof want === 'object') set = want;
    hold(set);
  }

  function keep() {
    var game = gameState();
    var file = game ? game.save() : null;
    if (file === null) return;
    ring.push({ file: file, seed: seed, robot: robotNow() });
    if (ring.length > KEEP) ring.shift();
  }

  // The robot's part of any savepoint: its dice, and what its hands were
  // doing, so a moment put back plays on the same way.
  function robotNow() {
    return {
      seed: robotSeed, held: copy(robot.held), spells: copy(robot.spells),
      wait: robot.wait, rest: robot.rest, frames: robot.frames,
    };
  }

  function robotBack(saved) {
    hold({});
    ring = [];
    if (!saved || typeof saved !== 'object') return;
    if (typeof saved.seed === 'number') robotSeed = saved.seed >>> 0;
    robot.held = copy(saved.held || {});
    robot.spells = copy(saved.spells || {});
    robot.wait = Number(saved.wait) || 0;
    robot.rest = Number(saved.rest) || 0;
    robot.frames = Number(saved.frames) || 0;
  }

  function startRobot() {
    if (robot.on) return;
    robot.on = true;
    robot.learned = false;
    owed = 0;
    ring = [];
  }

  // Stopped — by the studio, by a person's hands, by its teacher's error, or
  // by the game breaking, when the studio is handed the moment before.
  function stopRobot(reason, more) {
    if (!robot.on) return;
    robot.on = false;
    hold({});
    var said = { what: 'robot', on: false, reason: reason };
    for (var key in more) if (Object.prototype.hasOwnProperty.call(more, key)) said[key] = more[key];
    ring = [];
    tell(said);
  }

  window.Robot = {
    play: function (fn) { if (typeof fn === 'function') taught = fn; },
    random: roll,
  };

  // A person's own key or tap takes over. The robot's events are not trusted
  // ones, so they never stop it.
  var hands = function (e) { if (e && e.isTrusted) stopRobot('hands'); };
  ['keydown', 'pointerdown', 'touchstart'].forEach(function (type) {
    window.addEventListener(type, hands, true);
  });
  // Code of the game's that threw while the robot played — not a picture or
  // a sound that failed to load, which never reaches the window.
  window.addEventListener('error', function (e) {
    if (!robot.on) return;
    var before = ring.length ? ring[0] : null;
    stopRobot('broke', { savepoint: before, message: String((e && e.message) || '').slice(0, 300) });
  });

  // ---------- the studio ----------

  // What the studio says: run or pause, how fast, one frame on, pin, back, a
  // place to jump to, the robot on or off. Settings arrive again after every
  // reload, asked for by 'ready' below.
  var SPEEDS = [0.25, 0.5, 1, 2, 4, 16];
  window.addEventListener('message', function (event) {
    var d = null;
    try {
      if (event.source !== window.parent) return;
      d = event.data;
      if (!d || d.gamestudio !== 'player') return;
      if (typeof d.paused === 'boolean') paused = d.paused;
      if (SPEEDS.indexOf(d.speed) >= 0) { speed = d.speed; hush(); }
      if (d.step) { paused = true; steps += 1; }
      if (d.tweaks) retweak(d.tweaks);
      if (d.pin) pin();
      if (d.robot === true) startRobot();
      if (d.robot === false) stopRobot('studio');
    } catch (err) { return; /* never break the game */ }
    if (d && d.back) back(d.back);
    if (d && d.jump && typeof d.jump === 'object') jump(d.jump);
  });
  tell({ what: 'ready' });
}());`;

export const previewPlayerScript = () => `<script>${PREVIEW_PLAYER_JS}</script>`;
