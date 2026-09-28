This game started from the roll-a-ball template: a ball on levels of
floor, walls and holes, seen from behind in 3D, rolled to each goal with
coins on the way; a goal takes it on to the next level. The levels are
painted, not typed: the studio opens config/level.js as the level editor,
the Level tab beside the chats.

- config/level.js — `LEVELS`, the levels in the order they are played, each
  from above, one character a square: `#` a wall, `.` floor, a space a hole,
  `S` the start, `G` the goal, `o` a coin. The top row is the far end. And
  `SQUARES`, the kinds of square this game has made up: a letter each, with
  `{ name, colour, solid }`. ⚠️ Paint them in the level editor rather than
  editing the rows by hand: a row a character short, or a stray letter,
  shifts the whole maze, and a letter SQUARES does not name shuts the
  editor out.
- config/play.js — how it feels: the ball's size, push, top speed,
  friction, brake and bounce, how fast it falls, how close a coin has to
  be, and what scores.
- config/words.js — every word the player sees.
- config/look.js — the four colours the game and the studio both wear, the
  floor's, the walls' (and how tall they are), the ball's, a coin's and the
  goal's, and where the camera sits behind the ball.
- config/controls.js — which keys, buttons and screen controls do what. Its
  scheme is `stick-buttons`: a stick under one thumb rolls the ball, and the
  round STOP button under the other is the brake.
- config/achievements.js — what a player can earn, as rules over the moments
  the game says: coin, fall, level, goal, score.
- js/roll.js — the whole game: each level built when the ball arrives in it,
  one loop, the rolling, the walls, the holes, the coins and the goal. A
  made-up kind of square is drawn in its colour already; what it does when
  the ball rolls on is its letter's entry in `ON_SQUARE`. ⚠️ A module, loaded
  with `type="module"`, because the 3D library is one.
- css/style.css — the page around the canvas. No width on the game: the
  screens library sizes it.
- assets/sounds/ — coin.wav, fall.wav and goal.wav, all from the studio's own
  sound maker, so each opens in it to change.

It holds the 3D library, an extra: studio/three.module.js and three.core.js
are three.js (MIT) and studio/render3d.js the studio's way in to it. The
game never makes a renderer, a camera or a light — Render3D.start does, and
the floor and the walls are one Render3D.boxes call each. The rolling is the
game's own: it is a circle on a grid, and a few lines say it better than a
physics engine would. Screens.fit comes first at boot, then Render3D.start:
fit reads the canvas's 960 × 600 and the library sizes its picture to
whatever fit made of it.

It uses every other studio library too: Input for the stick and the keys
(`Input.update()` first in every frame), Screens for how big the game is,
the HUD chips, the title and end screens and the scoreboard, Sound for the
noises, Moments to say what happened, Achievements to hand out what the
rules earn. Sprites is loaded and unused: nothing here is a flat picture.
