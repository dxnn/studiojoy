// The reporter: the script that lets the studio see a game break.
//
// DeepSeek cannot be shown a picture (spec.md §14), so everything an agent
// learns about its running game has to arrive as text. This is where that text
// comes from: uncaught errors, failed resource loads and console.error calls,
// posted to the studio window and fed back into the next fire's context.
//
// It is never a file in a working tree and never a tag in a game's markup. The
// games listener serves the project's own index.html with this script injected
// at a reserved path (`_studio.html`), and the studio's preview points there.
// So the bytes the public plays are untouched, every game already has it, and
// no agent has to remember anything.
//
// The version it is built with is the commit that produced the bytes around
// it. It travels with every report, so a problem is always filed against the
// code that actually caused it rather than whatever HEAD happens to be when
// the report lands.

export const WRAPPER_PATH = '_studio.html';

const VERSION_MARK = '__STUDIO_VERSION__';

// Plain ES5: this runs inside a game written by a language model, which may
// target anything, and it is never bundled or parsed by us.
//
// Two rules it must never break. It reports only when framed — the wrapper
// opened directly has no studio to talk to. And it never throws: an exception
// here would surface inside the game as a bug the game does not have.
const REPORTER_JS = `(function () {
  if (window.parent === window) return;
  var slug = location.pathname.split('/')[1] || '';
  var version = '${VERSION_MARK}';
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
        version: version,
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

  // The game's moments — what Moments.say() dispatches on the window — so the
  // studio can watch a game say them while it is played, and the achievements
  // editor can offer the names it has heard. This script is injected before
  // any library loads, so it hears every one without knowing the library
  // exists. Throttled to the latest value per name a few times a second: a
  // moment said every frame is allowed, and sixty messages a second are not.
  var pending = {};
  var order = [];
  var momentTimer = null;

  function flushMoments() {
    momentTimer = null;
    var list = [];
    for (var i = 0; i < order.length && i < 50; i++) list.push(pending[order[i]]);
    pending = {};
    order = [];
    try {
      window.parent.postMessage({
        gamestudio: 'moment', slug: slug, version: version, moments: list
      }, '*');
    } catch (err) { /* nothing is listening; the game carries on */ }
  }

  window.addEventListener('moment', function (event) {
    try {
      var d = event && event.detail;
      if (!d || typeof d.name !== 'string') return;
      var name = d.name.slice(0, 40);
      var value = d.value;
      if (typeof value === 'string') value = value.slice(0, 100);
      else if (typeof value !== 'number') value = true;
      if (!pending[name]) {
        pending[name] = { name: name, value: value, times: 0 };
        order.push(name);
      }
      pending[name].value = value;
      pending[name].times += 1;
      if (momentTimer === null) momentTimer = setTimeout(flushMoments, 250);
    } catch (err) { /* never break the game */ }
  });
}());`;

// Hex only, and never longer than a sha. The value lands inside a script tag
// in a document served to the public, so it is not trusted to be what the
// caller says it is.
function safeVersion(version) {
  return String(version ?? '').replace(/[^0-9a-f]/g, '').slice(0, 40);
}

function reporterScript(version) {
  return `<script>${REPORTER_JS.replace(VERSION_MARK, safeVersion(version))}</script>`;
}

// The game's own index.html with the reporter put in front of it. Placed
// inside <head> when there is one and after the doctype otherwise, because it
// has to run before the game's first script to catch an error in it.
export function wrapHtml(html, version) {
  const script = `\n${reporterScript(version)}\n`;
  const lower = html.toLowerCase();
  for (const opener of ['<head', '<!doctype']) {
    const at = lower.indexOf(opener);
    if (at === -1) continue;
    const close = html.indexOf('>', at);
    if (close === -1) continue;
    return html.slice(0, close + 1) + script + html.slice(close + 1);
  }
  return script + html;
}
