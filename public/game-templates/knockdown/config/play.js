// How the game plays. These are the numbers to change first — every one of
// them does something you can see in a single shot.

const PLAY = {
  SHOTS: 3,            // shots you get to knock every target down

  // The world
  GRAVITY: 900,        // how hard things fall — bigger is heavier
  BOUNCE: 0.2,         // how bouncy everything is, 0 (a thud) to 1 (a superball)
  FRICTION: 0.6,       // how much things grip each other, 0 (ice) to 1 (rubber)

  // The shot
  SHOT_SIZE: 14,       // how big the shot is, from its middle to its edge
  SHOT_WEIGHT: 4,      // how heavy the shot is next to a crate — heavier knocks harder
  PULL: 10,            // how fast a shot flies for every pixel you pull the sling back
  MAX_SPEED: 1100,     // the fastest a shot can go, in pixels a second
  REACH: 110,          // how far the sling pulls back, in pixels
  AIM_DOTS: 8,         // dots showing where a shot starts to go — 0 for none

  // Knocking things down
  POP: 260,            // how hard a target has to be hit to be knocked out, in pixels a second
  SETTLE: 6,           // the longest a shot waits for things to stop moving, in seconds

  // The score
  TARGET_POINTS: 100,  // points for every target knocked down
  SHOT_POINTS: 250,    // points for every shot left over when the last target goes
};
