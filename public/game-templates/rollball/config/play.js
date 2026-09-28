// How the game plays. These are the numbers to change first — every one of
// them does something you can feel in a few seconds of rolling.

const PLAY = {
  // The ball
  BALL_SIZE: 0.3,      // how big the ball is, from its middle to its edge — a floor square is 1
  ROLL: 14,            // how hard the stick pushes the ball
  TOP: 6,              // the fastest it rolls, in floor squares a second
  FRICTION: 1.6,       // how quickly it slows when you let go — bigger is quicker
  BRAKE: 6,            // how hard the brake stops it
  BOUNCE: 0.4,         // how much speed it keeps bouncing off a wall, 0 to 1
  GRAVITY: 20,         // how fast it falls down a hole

  // The level
  COIN_REACH: 0.45,    // how close the ball has to get to a coin to pick it up
  RESPAWN: 1.2,        // seconds after falling before the ball is back at the start

  // The score
  COIN_POINTS: 100,    // points for every coin
  PAR: 60,             // a good time for all the levels, in seconds — under it scores
  TIME_POINTS: 10,     // points for every second under PAR
};
