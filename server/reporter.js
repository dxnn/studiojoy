// The reporter: the script a game includes so the studio can see it break.
//
// DeepSeek cannot be shown a picture (spec.md §14), so everything an agent
// learns about its running game has to arrive as text. This is where that text
// comes from: uncaught errors, failed resource loads and console.error calls,
// posted to the studio window and fed back into the next fire's context.
//
// It is served by the studio at a reserved path on the games origin rather
// than copied into each working tree, so one fix reaches every game, old and
// new, and no agent can helpfully delete it.

export const REPORTER_PATH = '_studio.js';
export const REPORTER_TAG = '<script src="_studio.js"></script>';

// Plain ES5 in a string: it runs inside a game written by a language model,
// which may target anything, and it is never bundled or parsed by us.
//
// Two rules it must never break. It reports only when framed — a game opened
// directly has no studio to talk to, and postMessage to itself would be noise
// on someone else's page. And it never throws: an exception here would surface
// inside the game as a bug the game does not have.
export const REPORTER_JS = `(function () {
  if (window.parent === window) return;
  var slug = location.pathname.split('/')[1] || '';
  var seen = {};
  var sent = 0;
  var MAX = 20;

  // Absolute URLs back to the games origin are noise; what a helper can act on
  // is the project path it wrote.
  function shorten(url) {
    if (!url) return '';
    var s = String(url);
    var mark = '/' + slug + '/';
    var at = s.indexOf(mark);
    if (at !== -1) return s.slice(at + mark.length);
    return s.replace(/^[a-z]+:\\/\\/[^/]+\\//, '');
  }

  function report(message, where) {
    var key = message + '@' + where;
    // One line per distinct problem: a broken game loop throws sixty times a
    // second, and none of those repeats tell a helper anything new.
    if (seen[key] || sent >= MAX) return;
    seen[key] = true;
    sent += 1;
    try {
      window.parent.postMessage({
        gamestudio: 'error',
        slug: slug,
        message: String(message).slice(0, 500),
        location: String(where).slice(0, 200)
      }, '*');
    } catch (err) { /* nothing is listening; the game carries on */ }
  }

  // Capture phase, because a failed <script> or <img> load fires an error
  // event on the element and never reaches window in the bubble phase.
  window.addEventListener('error', function (event) {
    try {
      var target = event.target;
      if (target && target !== window && (target.src || target.href)) {
        report('could not load ' + shorten(target.src || target.href), 'index.html');
        return;
      }
      var at = shorten(event.filename);
      report(event.message || 'error', event.lineno ? at + ':' + event.lineno : at);
    } catch (err) { /* never break the game */ }
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event.reason;
      report('unfinished promise: ' + ((reason && reason.message) || reason), '');
    } catch (err) { /* never break the game */ }
  });

  // Games written by a helper report their own trouble this way more often
  // than they throw, so this is the line that usually carries the diagnosis.
  var passThrough = console.error;
  console.error = function () {
    try {
      report(Array.prototype.map.call(arguments, String).join(' '), 'console');
    } catch (err) { /* never break the game */ }
    return passThrough.apply(console, arguments);
  };
}());
`;
