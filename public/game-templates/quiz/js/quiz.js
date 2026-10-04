// Asks the questions in config/questions.js, counts the answers, and
// pronounces the player one of the endings. The content lives in the config
// files — this file is only the machinery, and it can be changed like any
// other game code.
"use strict";

(function () {
  const root = document.getElementById("quiz");

  // Where the player is, kept in State (studio/state.js) — which is what lets
  // the studio's preview pin a moment and come back to it: the question, -1
  // for the start screen and past the last for the ending, and the answers
  // counted towards each ending so far.
  const fresh = () => {
    const tally = {};
    for (const key of Object.keys(RESULTS)) tally[key] = 0;
    return { at: -1, tally };
  };
  State.reset(fresh());

  const sound = (name) => { if (window.Sound) Sound.play(name); };
  // What the game says happened, for achievements in config/achievements.js
  // (and the studio's own watching). A fact, never a request for a prize —
  // "answered" every pick, "finished" with the ending the player got.
  const moment = (name, value) => { if (window.Moments) Moments.say(name, value); };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const show = (...nodes) => root.replaceChildren(...nodes);

  // The colours in config/look.js, handed to the stylesheet as the variables
  // it draws from. The same four the studio takes while this game is open, so
  // changing one there changes both.
  if (window.LOOK) {
    for (const name of ["primary", "accent", "highlight", "deep"]) {
      if (LOOK[name]) document.documentElement.style.setProperty("--" + name, LOOK[name]);
    }
  }

  function start() {
    State.reset(fresh());
    draw();
  }

  function next() {
    State.at += 1;
    if (State.at >= QUESTIONS.length) {
      sound("tada");
      moment("finished", best());
    }
    draw();
  }

  // The most answers wins; a tie goes to the ending listed first.
  function best() {
    let won = null;
    for (const key of Object.keys(RESULTS)) {
      if (won === null || (State.tally[key] || 0) > (State.tally[won] || 0)) won = key;
    }
    return won;
  }

  // The screen State says the player is on — the start, a question, or the
  // ending — with no noise of its own, so a moment put back is only shown.
  function draw() {
    if (State.at < 0) {
      const go = el("button", "big", WORDS.start);
      go.addEventListener("click", next);
      show(el("h1", "", WORDS.title), go);
      return;
    }
    if (State.at >= QUESTIONS.length) {
      const ending = RESULTS[best()]
        || { name: "A Mystery", tell: "This quiz has no endings yet." };
      const again = el("button", "big", WORDS.again);
      again.addEventListener("click", start);
      show(
        el("p", "count", WORDS.reveal),
        el("h1", "", ending.name),
        el("p", "tell", ending.tell),
        again,
      );
      return;
    }
    const q = QUESTIONS[State.at];
    const card = el("div", "card");
    card.append(el("p", "count", (State.at + 1) + " / " + QUESTIONS.length));
    card.append(el("h2", "", q.ask));
    for (const answer of q.answers) {
      const pick = el("button", "answer", answer.say);
      pick.addEventListener("click", () => {
        State.tally[answer.result] = (State.tally[answer.result] || 0) + 1;
        sound("pick");
        moment("answered", answer.result);
        next();
      });
      card.append(pick);
    }
    show(card);
  }

  // Back to a pinned moment: whatever screen it was on, drawn again.
  State.loaded(draw);

  start();
}());
