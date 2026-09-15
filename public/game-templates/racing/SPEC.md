# The racing game

Rules, as shipped:

- The race is `LAPS` laps around the track in `config/track.js`, against
  `RIVALS` rivals, after a countdown of `COUNTDOWN` seconds.
- Left and right steer. Holding GO accelerates; letting go slows the car by
  `DRAG`. BOOST raises the top speed while it is held or latched.
- The road is the closed line through the track's points, `width` wide. Off
  it is grass, which slows the car by `OFF_ROAD` every second.
- A rock stops the car to `BUMP` of its speed and shoves it out. A boost pad
  multiplies its speed by `PAD_PUSH`, once per pass. A puddle drags at it.
- Rivals follow the middle of the road in their lanes at `RIVAL_SPEED`,
  wandering by `RIVAL_WOBBLE`, easing off when far ahead and pushing when
  far behind. Bumping one slows both.
- Crossing the start line the right way round counts a lap; backwards
  uncounts one. The race ends on the last lap's crossing.
- The score is ten points for every second under `PAR`, plus `PLACE_POINTS`
  for every rival beaten. It goes on the scoreboard from the finish screen.
- The game says these moments: `lap`, `bash`, `boost`, `finished` (the time),
  `place` and `score`. Achievements are rules over them.

Ways to remix without code: the track in the track editor — drag a point,
click the road to add one, drop rocks, pads and puddles — every number in
`config/play.js`, the words, the colours, and a car in
`assets/sprites/car.png`.

Ways that need a change to `js/race.js`: a second player, more than one
track, a camera that follows the car, drifting, damage, and anything the
things on the road do beyond bash, shove and drag.
