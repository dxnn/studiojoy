// Asks the questions in config/questions.js, counts the answers, and
// pronounces the player one of the endings. The content lives in the config
// files — this file is only the machinery, and it can be changed like any
// other game code.
"use strict";

(function () {
  const root = document.getElementById("quiz");
  const tally = {};
  let at = -1; // -1 is the start screen

  const sound = (name) => { if (window.Sound) Sound.play(name); };

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
    for (const key of Object.keys(RESULTS)) tally[key] = 0;
    at = -1;
    const go = el("button", "big", WORDS.start);
    go.addEventListener("click", next);
    show(el("h1", "", WORDS.title), go);
  }

  function next() {
    at += 1;
    if (at >= QUESTIONS.length) return finish();
    const q = QUESTIONS[at];
    const card = el("div", "card");
    card.append(el("p", "count", (at + 1) + " / " + QUESTIONS.length));
    card.append(el("h2", "", q.ask));
    for (const answer of q.answers) {
      const pick = el("button", "answer", answer.say);
      pick.addEventListener("click", () => {
        tally[answer.result] = (tally[answer.result] || 0) + 1;
        sound("pick");
        next();
      });
      card.append(pick);
    }
    return show(card);
  }

  function finish() {
    // The most answers wins; a tie goes to the ending listed first.
    let best = null;
    for (const key of Object.keys(RESULTS)) {
      if (best === null || (tally[key] || 0) > (tally[best] || 0)) best = key;
    }
    const ending = RESULTS[best]
      || { name: "A Mystery", tell: "This quiz has no endings yet." };
    sound("tada");
    const again = el("button", "big", WORDS.again);
    again.addEventListener("click", start);
    show(
      el("p", "count", WORDS.reveal),
      el("h1", "", ending.name),
      el("p", "tell", ending.tell),
      again,
    );
  }

  start();
}());
