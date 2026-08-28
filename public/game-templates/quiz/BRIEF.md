This game started from the quiz template: it asks the questions in
config/questions.js one at a time, counts which ending each answer points at,
and pronounces the player the ending with the most answers (a tie goes to the
one listed first).

- config/questions.js — the questions and the endings. This is the whole
  content of the game; the studio opens it as a form.
- config/words.js — the words on the screens that are not questions.
- js/quiz.js — the machinery: ask, count, pronounce.
- css/style.css — how it looks.
- index.html — loads the studio libraries, the config files, then js/quiz.js.
- assets/pick.wav, assets/tada.wav — the two sounds; remake them with
  "+ Make a sound" keeping the same names, or change the names in js/quiz.js.
