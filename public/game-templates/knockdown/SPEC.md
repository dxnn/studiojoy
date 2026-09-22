# Knock It Down

Rules, as shipped:

- A level is the world in `config/bodies.js`: boxes that fall and stack,
  blocks that never move, balls that roll, and targets. The player has
  `SHOTS` shots to knock every target down.
- A shot is pulled back from the sling and let go — pressed anywhere on the
  game, dragged, released. It flies the opposite way to the pull at `PULL`
  pixels a second for every pixel pulled, up to `MAX_SPEED`; the band goes
  back at most `REACH`. With keys, up and down turn the aim, left and right
  change how hard, and fire lets go.
- Everything falls at `GRAVITY`, bounces by `BOUNCE` and grips by
  `FRICTION`. The shot is `SHOT_WEIGHT` times as heavy as a crate its size.
- A target is down when it is hit at `POP` pixels a second or harder, or
  when it leaves the world. Any two things meeting that hard is a crash.
- A shot is over when everything has stopped moving, or after `SETTLE`
  seconds. When the last shot is over the level ends.
- The score is `TARGET_POINTS` for every target down, plus `SHOT_POINTS` for
  every shot left when the last target goes. It goes on the scoreboard from
  the end screen.
- The game says these moments: `shot`, `crash`, `pop` (how many are down),
  `cleared` (the shots it took) and `score`. Achievements are rules over
  them.

Ways to remix without code: the world in the world editor — drag a thing,
size it by its corner, turn it, drop in boxes, blocks, balls and targets,
move the sling — every number in `config/play.js`, the words, the colours,
and a target in `assets/sprites/target.png`.

Ways that need a change to `js/knock.js`: more than one level, shots of
different kinds, things that break into pieces, a camera that follows the
shot, joints and ropes, and anything a target does beyond being knocked down.
