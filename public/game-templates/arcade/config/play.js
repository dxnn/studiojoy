// How the game plays. These are the numbers to change first — every one of
// them does something you can feel in a few seconds of playing.

const PLAY = {
  LIVES: 3,             // how many times you can be hit before the run ends

  // Your ship
  SHIP_SPEED: 420,      // how fast you slide left and right, pixels a second
  THRUST: 900,          // how hard the engine pushes upward
  GRAVITY: 700,         // how hard the world pulls you back down
  FLOOR: 60,            // how far above the bottom edge the ship rests

  // Firing
  BOLT_SPEED: 700,      // how fast a bolt travels
  BOLT_GAP: 0.22,       // seconds between shots — smaller is faster

  // Meteors
  ROCK_SPEED: 90,       // how fast the first ones fall
  ROCK_SPEED_PER_LEVEL: 22, // and how much faster each level makes them
  ROCK_GAP: 1.5,        // seconds between meteors at level one
  ROCK_GAP_LEAST: 0.35, // however fast it gets, never closer together than this
  ROCK_SIZE: 34,        // how big across a meteor is

  // Levels
  LEVEL_EVERY: 8,       // meteors broken before the next level

  // The charge meter: it fills as you break meteors, and a full one becomes a
  // shield that takes a hit for you. Set CHARGE_FULL to 0 to have no meter at
  // all — the chip goes away with it.
  CHARGE_FULL: 10,      // meteors broken to fill it
  SHIELD_SECONDS: 6,    // how long the bubble lasts once it is spent

  // Scoring
  ROCK_POINTS: 10,      // for breaking one
  LEVEL_POINTS: 50,     // for reaching the next level
};
