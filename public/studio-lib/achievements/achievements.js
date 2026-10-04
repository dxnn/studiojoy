// What a player can earn in this game, and the moment they earn it. The rules
// live in config/achievements.js — id, name, how, icon and `when`, one test on
// one of the game's moments — and this library watches the moments the game
// says with Moments.say(), awards each achievement the first time its rule is
// met, and shows a toast at the top of the screen. Earned is forever, per
// signed-in player, kept by the studio and never in the game's files.
//
//   Achievements.unlock("secret-room");   // grant one by hand, from the code
//   await Achievements.mine();            // [{ id, name, how, icon, got }]
//
// unlock() is for an achievement whose `when` is left out — a moment nobody
// wants to publish — and does what a met rule does: one save, one toast, and
// nothing the second time. mine() is the list in the file's order, each with
// `got` — when this player earned it, or null; a trophy screen is that list
// drawn. Signed out, the toast still shows, with a line saying to sign in on
// the front page to keep it, and nothing is stored. Each award is also said on
// the window as an "achievement" event with { id, name, how, icon } as its
// detail — how Screens.title() lists what the run won on the game-over
// screen, and a game can listen the same way.
//
// The toast wears achievements- classes (achievements-toast, -icon, -name,
// -how, -keep) and the game's LOOK colours, and the game's own css wins over
// its rules. A missing file, an unknown id or a dead network is one console
// warning, never an error.
//
// Those two calls are the whole of it. There is no init, no register and no
// list to declare here — the file is the list — and nothing here says a
// moment: that is Moments.say() in the game's own code, on the line where the
// thing happens. Load config/achievements.js before this file.

const Achievements = (function () {
  "use strict";

  const SLUG = /^[a-z0-9-]{1,40}$/;
  const MAX = 50;
  const NAME_MAX = 60;
  const HOW_MAX = 200;
  const ICON_BYTES = 32;
  const TOAST_MS = 4500;
  // How long an award waits for the studio to say what is already held before
  // going ahead anyway: a dead network must not hold the first toast until the
  // browser gives up on the request.
  const HELD_WAIT_MS = 3000;

  const warned = new Set();

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn("Achievements: " + message);
  }

  // ---------- the file ----------

  // Bytes the way the studio counts an icon: the same cap a reaction has.
  function utf8Bytes(text) {
    try {
      return encodeURIComponent(text).replace(/%[0-9A-Fa-f]{2}/g, "x").length;
    } catch (err) {
      return Infinity;
    }
  }

  function isCount(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  // The rule as it will be read, or null when `when` is outside the shape.
  // Every test present has to hold; the editor writes one.
  function whenOf(when) {
    if (typeof when !== "object" || when === null) return null;
    if (typeof when.moment !== "string" || !SLUG.test(when.moment)) return null;
    const out = { moment: when.moment };
    for (const test of ["atLeast", "atMost", "times"]) {
      if (when[test] === undefined) continue;
      if (!isCount(when[test])) return null;
      out[test] = when[test];
    }
    if (when.is !== undefined) {
      if (typeof when.is !== "string" && typeof when.is !== "number") return null;
      out.is = when.is;
    }
    return out;
  }

  // One entry as the rules read it, or null with a warning when it is outside
  // the shape — the server skips the same ones, so a rule dropped here would
  // have been refused there anyway.
  function ruleOf(entry, seen, index) {
    const skip = function (why) {
      const label = entry && typeof entry.id === "string" ? '"' + entry.id + '"' : "entry " + (index + 1);
      warnOnce("skip:" + index, label + " in config/achievements.js is skipped: " + why);
      return null;
    };
    if (typeof entry !== "object" || entry === null) return skip("it is not an object");
    if (typeof entry.id !== "string" || !SLUG.test(entry.id)) {
      return skip("its id is not a short slug of lowercase letters, digits and dashes");
    }
    if (seen.has(entry.id)) return skip("that id is already used");
    if (typeof entry.name !== "string" || entry.name === "" || entry.name.length > NAME_MAX) {
      return skip("its name is missing or longer than " + NAME_MAX + " characters");
    }
    const how = entry.how === undefined ? "" : entry.how;
    if (typeof how !== "string" || how.length > HOW_MAX) {
      return skip("its how is not text of up to " + HOW_MAX + " characters");
    }
    const icon = entry.icon === undefined || entry.icon === "" ? null : entry.icon;
    if (icon !== null && (typeof icon !== "string" || utf8Bytes(icon) > ICON_BYTES)) {
      return skip("its icon is not one emoji");
    }
    let when = null;
    if (entry.when !== undefined && entry.when !== null) {
      when = whenOf(entry.when);
      if (!when) return skip("its when does not name a moment and one test on it");
    }
    return { id: entry.id, name: entry.name, how: how, icon: icon, when: when };
  }

  // The file, read once — config/achievements.js is loaded before this
  // library, the way every page the studio writes does.
  const rules = (function () {
    if (typeof ACHIEVEMENTS === "undefined") {
      warnOnce("file", "config/achievements.js is missing: load it before studio/achievements.js");
      return [];
    }
    if (!Array.isArray(ACHIEVEMENTS)) {
      warnOnce("file", "ACHIEVEMENTS in config/achievements.js is not a list");
      return [];
    }
    const out = [];
    const seen = new Set();
    for (let i = 0; i < ACHIEVEMENTS.length; i += 1) {
      if (out.length >= MAX) {
        warnOnce("max", "config/achievements.js holds more than " + MAX + ": the rest are skipped");
        break;
      }
      const rule = ruleOf(ACHIEVEMENTS[i], seen, i);
      if (!rule) continue;
      seen.add(rule.id);
      out.push(rule);
    }
    return out;
  }());

  const byId = new Map();
  for (const rule of rules) byId.set(rule.id, rule);

  // ---------- the studio ----------

  // The slug is the first piece of the page's address, the same way every
  // game works it out. Empty off a game origin, which makes every call to
  // the studio a quiet no-op — the toasts still show.
  const slug = (function () {
    if (typeof location !== "object" || !location) return "";
    const parts = String(location.pathname || "").split("/");
    return parts.length > 1 ? parts[1] : "";
  }());

  function offline() {
    return typeof fetch !== "function" || slug === "";
  }

  function route() {
    return "/_achievements/" + encodeURIComponent(slug);
  }

  const held = new Set(); // what this player had when the page loaded
  const sent = new Set(); // what was awarded on this page
  const counts = new Map(); // moment name -> how often it has been said here

  function read() {
    return fetch(route())
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && Array.isArray(j.achievements) ? j.achievements : null))
      .catch(() => null);
  }

  // What this player already has, asked once when the page loads. Every
  // award waits on the answer, so a returning player is not shown "First
  // run" again — up to a point: a studio that does not answer is one warning
  // and the game goes on, since nothing is stored twice anyway.
  const ready = (function () {
    if (rules.length === 0 || offline()) return Promise.resolve();
    const asked = read().then(function (list) {
      if (!list) {
        warnOnce("read", "the studio could not say what you have earned");
        return;
      }
      for (const a of list) if (a && typeof a.id === "string" && a.got) held.add(a.id);
    });
    const waited = new Promise(function (resolve) { setTimeout(resolve, HELD_WAIT_MS); });
    return Promise.race([asked, waited]);
  }());

  // Tells the studio. `state` is "kept" when it is this player's now,
  // "signin" when nobody is signed in, "" for anything else — with one
  // warning, because a player who saw the toast will wonder tomorrow where it
  // went. `joy` is what the studio paid for it: the chips its makers put on
  // it, the first time somebody who did not make the game earns it.
  function save(id) {
    if (offline()) return Promise.resolve({ state: "", joy: 0 });
    return fetch(route(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id }),
    })
      .then(function (res) {
        if (res.status === 401) return { state: "signin", joy: 0 };
        if (!res.ok) {
          warnOnce("save", 'the studio did not keep "' + id + '" (' + res.status + ")");
          return { state: "", joy: 0 };
        }
        return res.json()
          .then(function (body) {
            const joy = body && typeof body.joy === "number" && body.joy > 0 ? body.joy : 0;
            return { state: "kept", joy: joy };
          })
          .catch(function () { return { state: "kept", joy: 0 }; });
      })
      .catch(function () {
        warnOnce("save", 'the studio did not keep "' + id + '"');
        return { state: "", joy: 0 };
      });
  }

  // ---------- the toast ----------

  // Every rule is written `body :where(…)`, one element selector of weight,
  // for the reason the screens library found in a browser: the sheet lands
  // after the game's own <link>, so it wins every tie at equal weight, and a
  // layer loses to any unlayered reset. At 0-0-1 a game's `.achievements-name
  // { … }` wins and a `* { margin: 0 }` loses, which is the right way round.
  //
  // The colours are the game's LOOK, set inline on the stack; the defaults are
  // the studio's own, so a game with no colours yet still looks like it
  // belongs here. ⚠️ Not the look's highlight anywhere: gold is a number worth
  // looking at, and a name is not a number. The type follows the screens
  // library's when that is loaded and the system's when it is not.
  const CSS = ""
    + ":where(:root){"
    + "--achievements-font:var(--screens-font,'Space Grotesk',-apple-system,BlinkMacSystemFont,"
    + "'Segoe UI',system-ui,sans-serif);"
    + "--achievements-text:#f2effe;--achievements-muted:#9a8fd0;"
    + "--achievements-panel:oklch(0.26 0.06 290/0.92);--achievements-border:#3a3168;"
    + "--achievements-primary:oklch(0.72 0.19 20);--achievements-accent:oklch(0.78 0.15 350)}"
    // Under the chips row, over everything else — an achievement earned on
    // the last hit lands while the game-over screen is coming up.
    + "body :where(.achievements-toasts){position:fixed;top:0;left:0;right:0;z-index:9999;"
    + "display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;"
    + "padding:calc(52px + env(safe-area-inset-top,0px)) 12px 0;"
    + "font-family:var(--achievements-font);-webkit-font-smoothing:antialiased}"
    + "body :where(.achievements-toast){display:grid;grid-template-columns:auto 1fr;column-gap:12px;"
    + "align-items:center;box-sizing:border-box;max-width:min(26rem,100%);padding:10px 16px;"
    + "border-radius:14px;background:var(--achievements-panel);"
    + "border:1px solid var(--achievements-border);color:var(--achievements-text);"
    + "box-shadow:0 0 26px color-mix(in oklab,var(--achievements-primary) 34%,transparent),"
    + "0 12px 30px rgba(6,4,14,.5);animation:achievements-in .35s ease-out}"
    + "body :where(.achievements-icon){font-size:28px;line-height:1}"
    + "body :where(.achievements-text){display:flex;flex-direction:column;gap:2px;"
    + "min-width:0;text-align:left}"
    + "body :where(.achievements-name){font-weight:700;font-size:15px;line-height:1.25;"
    + "overflow-wrap:break-word;color:var(--achievements-primary)}"
    + "body :where(.achievements-how){font-size:13px;line-height:1.3;color:var(--achievements-muted)}"
    + "body :where(.achievements-keep){grid-column:1/-1;margin-top:6px;font-size:12px;"
    + "color:var(--achievements-accent)}"
    // The joy it paid is a number worth looking at, so the studio's gold.
    + "body :where(.achievements-joy){grid-column:1/-1;margin-top:6px;font-size:13px;"
    + "font-weight:700;color:oklch(0.85 0.15 95)}"
    + "@keyframes achievements-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}";

  let styleDone = false;

  function injectStyle() {
    if (styleDone || typeof document !== "object" || !document.head) return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    styleDone = true;
  }

  // The game's colours, inline on the stack so they beat the defaults, and
  // only where config/look.js names one. Highlight is left out on purpose.
  function lookColours(node) {
    if (typeof LOOK !== "object" || !LOOK) return;
    for (const part of ["primary", "accent"]) {
      if (typeof LOOK[part] === "string" && LOOK[part] !== "") {
        node.style.setProperty("--achievements-" + part, LOOK[part]);
      }
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  let stack = null;

  function show(rule) {
    if (typeof document !== "object" || !document || !document.body) return null;
    injectStyle();
    if (!stack) {
      stack = el("div", "achievements-toasts");
      lookColours(stack);
      document.body.append(stack);
    }
    const toast = el("div", "achievements-toast");
    toast.append(el("span", "achievements-icon", rule.icon === null ? "" : rule.icon));
    const text = el("div", "achievements-text");
    text.append(el("span", "achievements-name", rule.name));
    if (rule.how !== "") text.append(el("span", "achievements-how", rule.how));
    toast.append(text);
    stack.append(toast);
    setTimeout(function () { toast.remove(); }, TOAST_MS);
    return toast;
  }

  // ---------- awarding ----------

  // Whether this moment meets the rule. A number test against a value that
  // is not a number is simply not met; `is` compares as text, so 5 and "5"
  // are the same answer.
  function met(when, value, count) {
    if (when.atLeast !== undefined && !(typeof value === "number" && value >= when.atLeast)) return false;
    if (when.atMost !== undefined && !(typeof value === "number" && value <= when.atMost)) return false;
    if (when.is !== undefined && String(value) !== String(when.is)) return false;
    if (when.times !== undefined && count < when.times) return false;
    return true;
  }

  // The award said on the window, the way a moment is: what the screens
  // library listens for to list a run's wins on the game-over screen, and a
  // game may too. Said whether or not the studio keeps it — the player saw
  // the toast, and the screen should agree with it.
  function tell(rule) {
    if (typeof CustomEvent !== "function" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent("achievement", {
      detail: { id: rule.id, name: rule.name, how: rule.how, icon: rule.icon },
    }));
  }

  // One award: once per page, never for something already held, and after
  // the studio has said what is held. The toast does not wait for the save;
  // the sign-in line is added if the save comes back asking for one.
  function award(rule) {
    if (sent.has(rule.id) || held.has(rule.id)) return;
    sent.add(rule.id);
    ready.then(function () {
      if (held.has(rule.id)) return;
      const toast = show(rule);
      tell(rule);
      save(rule.id).then(function (saved) {
        if (saved.state === "signin" && toast) {
          toast.append(el("span", "achievements-keep", "Sign in on the front page to keep it"));
        }
        if (saved.joy > 0 && toast) toast.append(el("span", "achievements-joy", "+" + saved.joy + " joy"));
      });
    });
  }

  function heard(event) {
    const d = event && event.detail;
    if (!d || typeof d.name !== "string") return;
    const count = (counts.get(d.name) || 0) + 1;
    counts.set(d.name, count);
    for (const rule of rules) {
      if (rule.when && rule.when.moment === d.name && met(rule.when, d.value, count)) award(rule);
    }
  }

  if (rules.length > 0 && typeof window.addEventListener === "function") {
    window.addEventListener("moment", heard);
  }

  function unlock(id) {
    const rule = byId.get(id);
    if (!rule) {
      warnOnce("unlock:" + String(id), 'unlock("' + String(id) + '"): '
        + "no achievement with that id in config/achievements.js");
      return;
    }
    award(rule);
  }

  // The list with `got`, asked fresh each time — a trophy screen at game over
  // wants this run's wins in it. Off the network it is the file's own list
  // with got null throughout.
  function mine() {
    const own = rules.map((r) => ({ id: r.id, name: r.name, how: r.how, icon: r.icon, got: null }));
    if (offline()) return Promise.resolve(own);
    return read().then(function (list) {
      if (list) return list;
      warnOnce("read", "the studio could not say what you have earned");
      return own;
    });
  }

  return { unlock: unlock, mine: mine };
}());

window.Achievements = Achievements;
