# Roll a Ball

Rules, as shipped:

- The level is `config/level.js`, seen from above: walls, floor, holes, one
  start, one goal and coins. The ball starts on `S`.
- The stick, the arrows or WASD push the ball at `ROLL`; up rolls it away
  from the camera. It slows by `FRICTION` when nothing pushes, by `BRAKE`
  more while STOP (or space) is held, and never goes faster than `TOP`.
- A wall stops the ball and bounces it back with `BOUNCE` of the speed it hit
  with.
- Rolling over a hole drops the ball, falling at `GRAVITY`; after `RESPAWN`
  seconds it is back at the start. The coins it already has stay picked up,
  and the clock keeps running.
- A coin within `COIN_REACH` of the ball is picked up.
- Reaching the goal ends the run. The score is `COIN_POINTS` for every coin
  plus `TIME_POINTS` for every second under `PAR`. It goes on the scoreboard
  from the end screen.
- The game says these moments: `coin` (how many so far), `fall`, `goal`
  (the time) and `score`. Achievements are rules over them.

Ways to remix without code: the level in the level editor — paint walls,
floor, holes, coins, the start and the goal, and grow or shrink the grid —
every number in `config/play.js`, the words, the colours, how tall the walls
are and where the camera sits.

Ways that need a change to `js/roll.js`: more than one level, ramps and
heights, moving walls, enemies, a jump, a timer that runs out, and anything
a square does beyond being floor, wall, hole, coin or goal.
