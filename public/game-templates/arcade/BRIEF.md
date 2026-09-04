This game started from the arcade template: a canvas, a loop at sixty frames a
second, and the studio's libraries doing everything around the game. You hold
the bottom of the screen, meteors fall, and you break them before they land.

- config/play.js — every number that changes how it feels: speed, gravity, how
  often a meteor comes, how many lives. Start here.
- config/look.js — the four colours the game and the studio both wear, the
  canvas's own 960 × 600, and a colour per thing on screen.
- config/words.js — every word the player sees, HUD labels included.
- config/achievements.js — what a player can earn. The studio opens it as a
  form.
- config/controls.js — which keys, buttons and drawn controls do what. The
  studio opens it as Controls.
- js/game.js — the game itself: the loop, what moves, what hits what, what is
  drawn.
- css/style.css — the page around the canvas, which is almost nothing.
- index.html — the canvas, and the libraries in the order they load.

What the studio owns here, so it is never rebuilt by hand:

- **How big the game is on the screen** is `Screens.fit(#wrap)`, one line at
  the bottom of js/game.js. ⚠️ Never put a width on the canvas or on #wrap in
  css/style.css: a game sized on the window's width alone hangs off the bottom
  of a phone held sideways, and fit is the fix for exactly that.
- **The title and game-over screens** are one `Screens.title()` call, and the
  score is the only difference between them. The scoreboard and posting the
  run come with it.
- **The HUD** is `Screens.chips()`, said whole every frame. The charge bar is
  a chip too — a value of `{ value, max, text }` draws a meter — so there is
  no HUD markup in index.html and no HUD css in style.css.
- **Input** is asked `Input.held("left")` and friends, and every frame begins
  with `Input.update()`. The words — left, right, thrust, fire — are this
  game's own, from config/controls.js; rename them in both places together.

Sounds are called for and not shipped: `shoot`, `break`, `shield`,
`shield-gone` and `hurt`. Make them with "+ Make a sound" under Hear, keeping
those names, and they start playing with no code change — a missing sound is
quiet, never an error.

Ways to remix without much code: change the numbers in config/play.js; change
the words; add achievements; draw a ship in the pixel editor and swap the
drawn triangle for `Sprites.draw`. Ways that need real changes to js/game.js:
a second kind of meteor, a boss, power-ups you catch, two players.
