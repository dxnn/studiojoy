// The preview player: what the studio's preview is, beside the reporter, since
// 2026-10-04 (ideas/dreams.md §3). The preview is a different kind of player
// from anybody playing the game: it is always debugging, and it is never on
// any board. Both are this script, injected into the wrapper after the
// reporter and ahead of every script of the game's own.
//
// It owns the game's time. The timestamps requestAnimationFrame hands a game,
// performance.now() and Math.random() all come from here, so the studio can
// pause a game, step it one frame at a time, run it at half or quarter speed
// — every canvas game, without the game knowing — and the random numbers are
// a stream with a state of its own, so a moment can be had again.
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
  var realNow = performance.now.bind(performance);
  var realFrame = window.requestAnimationFrame.bind(window);
  var now = realNow();
  var last = now;
  var queue = [];
  var nextId = 1;

  // One real frame: time moves on — by as much as really passed, times the
  // speed, or by one frame for a step — and every callback the game asked for
  // since the last one runs with the clock's time. The next real frame is
  // asked for first, so a game whose callback throws stops nothing here.
  function tick() {
    realFrame(tick);
    var real = realNow();
    var run = !paused || steps > 0;
    if (!paused) now += (real - last) * speed;
    else if (steps > 0) { now += FRAME; steps -= 1; }
    last = real;
    if (!run) return;
    var due = queue;
    queue = [];
    for (var i = 0; i < due.length; i++) due[i].fn(now);
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
  realFrame(tick);

  // ---------- chance ----------

  // mulberry32: small, fast, and a whole state in one number, which is what
  // lets a moment be had again with the same meteors falling.
  var seed = (Math.floor(Math.random() * 4294967296) ^ Date.now()) >>> 0;
  Math.random = function () {
    seed = (seed + 0x6D2B79F5) >>> 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

  // ---------- the studio ----------

  // What the studio says: run or pause, how fast, one frame on. Settings
  // arrive again after every reload, asked for by 'ready' below.
  window.addEventListener('message', function (event) {
    try {
      if (event.source !== window.parent) return;
      var d = event.data;
      if (!d || d.gamestudio !== 'player') return;
      if (typeof d.paused === 'boolean') paused = d.paused;
      if (d.speed === 1 || d.speed === 0.5 || d.speed === 0.25) speed = d.speed;
      if (d.step) { paused = true; steps += 1; }
    } catch (err) { /* never break the game */ }
  });
  tell({ what: 'ready' });
}());`;

export const previewPlayerScript = () => `<script>${PREVIEW_PLAYER_JS}</script>`;
