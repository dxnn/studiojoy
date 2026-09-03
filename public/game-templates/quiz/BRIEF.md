This game started from the quiz template: it asks the questions in
config/questions.js one at a time, counts which ending each answer points at,
and pronounces the player the ending with the most answers (a tie goes to the
one listed first).

- config/questions.js — the questions and the endings. This is the whole
  content of the game; the studio opens it as a form.
- config/words.js — the words on the screens that are not questions.
- config/look.js — the four colours the game and the studio both wear.
- js/quiz.js — the machinery: ask, count, pronounce.
- css/style.css — how it looks.
- index.html — loads the studio libraries, the config files, then js/quiz.js.
- assets/sounds/pick.wav, assets/sounds/tada.wav — the two sounds; remake them
  with "+ Make a sound" keeping the same names, or change the names in
  js/quiz.js.

The game is DOM and CSS rather than a canvas, because a question is text and
text wants to wrap and scale on a phone. It uses two of the studio libraries —
Sound for the two noises, Moments to say what happened — and the rest are
loaded but unused.

Two of them are unused on purpose, so leave them that way unless somebody asks
for the change:

- **Screens** is skipped. Its title and game-over screens fill the window over
  a game, which is right over a canvas and wrong here: the first question, the
  start screen and the ending are all the same panel in the middle of the
  page, and the ending is content rather than a score. js/quiz.js builds those
  three itself, in about a dozen lines.
- **Input** is loaded but never asked anything: every answer is a button, so a
  tap or a click is the whole of the controls and there is nothing to bind.
