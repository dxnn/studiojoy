// How the race plays. These are the numbers to change first — every one of
// them does something you can feel in a few seconds of driving.

const PLAY = {
  LAPS: 3,             // laps to finish the race
  RIVALS: 3,           // how many rivals race against you, up to 6

  // Your car
  TURN: 3.4,           // how fast the car turns
  THRUST: 380,         // how hard the engine pushes while you hold GO
  DRAG: 1.1,           // how quickly it slows when you let go — bigger is quicker
  TOP: 320,            // top speed, in pixels a second
  BOOST_TOP: 460,      // top speed while boosting
  BOOST_PUSH: 260,     // the extra push while boosting

  // The rivals
  RIVAL_SPEED: 230,    // how fast a rival drives, in pixels a second
  RIVAL_WOBBLE: 0.1,   // how much a rival's speed wanders, 0 to 1

  // The road and what is on it
  OFF_ROAD: 3,         // how hard the grass slows you — bigger is harder
  BUMP: 0.3,           // how much of your speed you keep after hitting a rock
  PUDDLE: 2.2,         // how hard a puddle slows you
  PAD_PUSH: 1.4,       // a boost pad multiplies your speed by this

  // The race
  COUNTDOWN: 3,        // seconds before GO
  PAR: 60,             // a good time for the whole race, in seconds — under it scores
  PLACE_POINTS: 200,   // points for every rival you beat
};
