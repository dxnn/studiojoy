// Colours and sizes. All of the pretty stuff lives here.

const LOOK = {
  // The game's four. The studio wears these while this game is open, and the
  // title and finish screens are drawn from them.
  primary: "#ffb347",   // the game's own colour: its name, its buttons, your car
  accent: "#5fd3bc",    // the second colour: taglines, edges
  highlight: "#ffe08a", // a score, a time, and nothing else
  deep: "#0b1a0f",      // the dark everything else sits on

  // How big the game is, in its own pixels. The canvas keeps these numbers
  // whatever size the screen is: Screens.fit decides how much of the window
  // the picture takes, and the game goes on thinking in 960 × 600 — which is
  // also the world the track editor draws in.
  WIDTH: 960,
  HEIGHT: 600,

  GRASS: "#1d4a2a",     // everything that is not road
  EDGE: "#101a14",      // the dark edge of the road
  ROAD: "#3a3f4a",      // the road itself
  LINE: "#c9ced8",      // the dashes down the middle
  START_A: "#ffffff",   // the start line's squares
  START_B: "#101a14",   //   and the other squares
  CAR: "#ffb347",       // your car, until somebody draws assets/sprites/car.png
  RIVALS: ["#5fd3bc", "#f77fbe", "#8fa7ff", "#d0ff5f", "#ff8a65", "#c9b6ff"], // one per rival, round and round
  ROCK: "#8d949f",      // a rock
  ROCK_EDGE: "#dfe4ea", // a rock's outline
  BOOST: "#ffe08a",     // a boost pad
  PUDDLE: "#3f7fbf",    // a puddle
};

// The squares the studio offers when somebody draws a picture for this game.
// Greys first, then the rainbow, then the ones with more character.
const PALETTE = [
  "#000000", "#2c2c38", "#4c4c5e", "#6e6e84", "#9494a8", "#bcbcca", "#e2e2ec", "#ffffff",
  "#e33b3b", "#ea6a2a", "#f0932b", "#f7cf3d", "#c4d92e", "#5cc648", "#2fb783", "#28b3c4",
  "#2f86d4", "#00fdff", "#7a4fd0", "#c247c0", "#ff8fbf", "#ffc9a3", "#8a5a3c", "#d2b48c",
  "#7ee0c0", "#c9b6ff", "#e8c34a", "#7a2f4a", "#1f2a5a", "#6b7a2f", "#ff6f5e", "#8e5d9e",
];
