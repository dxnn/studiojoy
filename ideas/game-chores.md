# One-game chores

Fixes that belong to one game rather than to the studio — most of them a
request to the builder in that game's own chat rather than a hand edit.

- **flip-for-what**: move it onto the input module, the way space-racer went;
  then see whether it, or space-racer, wants a sound effect now that one can
  be made without leaving the studio.
- **space-racer**: pull its colours out of its drawing code into
  `config/look.js` (a refactor, so ask the builder rather than doing it by
  hand).
- **space-racer**: move it to the buttons scheme, and its hand-rolled menus
  onto `Screens.title` — its screens still sit under the drawn controls.
- **asteriskoids**: its upgrade chooser still sits under the drawn touch
  controls. The title and game-over screens step aside now; that one does
  not. It is the game's own screen, and `screens-open` is the library's class
  to set.
- **redwolf-radness**: migrate it. It is still one big file, so this is a
  rebuild rather than a move (fun-slide went this way live: `2a6821d` in its
  repo).
- **Every game**: give it its own four colours in its `config/look.js`. They
  all wear the studio's default crimson until somebody picks (GLOSSARY:
  *look*).
