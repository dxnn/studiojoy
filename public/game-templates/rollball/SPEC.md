# Roll a Ball

Rules, as shipped:

- The levels are `config/level.js`, each seen from above: walls, floor,
  holes, one start, one goal and coins. The ball starts on `S`, or on the
  first floor square of a level that has none. The run starts on the first
  level (or the one `?level=` names, which is how the studio's *Try it*
  opens a level), and a level's goal takes it on to the next one.
- A kind of square in `SQUARES` is drawn in its colour: a block the ball
  bumps into like a wall when it is `solid`, a marker on the floor when it
  is not. When the ball rolls onto one, its letter's function in `ON_SQUARE`
  runs; with none there, nothing happens.
- The stick, the arrows or WASD push the ball at `ROLL`; up rolls it away
  from the camera. It slows by `FRICTION` when nothing pushes, by `BRAKE`
  more while STOP (or space) is held, and never goes faster than `TOP`.
- A wall stops the ball and bounces it back with `BOUNCE` of the speed it hit
  with.
- Rolling over a hole drops the ball, falling at `GRAVITY`; after `RESPAWN`
  seconds it is back at the start. The coins it already has stay picked up,
  and the clock keeps running.
- A coin within `COIN_REACH` of the ball is picked up.
- Reaching the last level's goal ends the run. The coins and the clock carry
  on from level to level. The score is `COIN_POINTS` for every coin plus
  `TIME_POINTS` for every second under `PAR`. It goes on the scoreboard from
  the end screen.
- The game says these moments: `coin` (how many so far), `fall`, `level`
  (the level just finished), `goal` (the run's time) and `score`.
  Achievements are rules over them.

Ways to remix without code: the levels in the level editor — paint walls,
floor, holes, coins, the start and the goal, grow or shrink the grid, add,
copy, reorder and delete levels, and make up a kind of square with a name,
a colour and whether it is solid — every number in `config/play.js`, the
words, the colours, how tall the walls are and where the camera sits.

Ways that need a change to `js/roll.js`: what a made-up kind of square does
(its entry in `ON_SQUARE`), ramps and heights, moving walls, enemies, a jump,
a timer that runs out.
