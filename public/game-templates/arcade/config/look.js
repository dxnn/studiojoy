// Colours and sizes. All of the pretty stuff lives here.

const LOOK = {
  // The game's four. The studio wears these while this game is open, and the
  // title and game-over screens are drawn from them.
  primary: "#7cf6c8",   // the game's own colour: its name, its buttons
  accent: "#f77fbe",    // the second colour: taglines, edges
  highlight: "#ffe08a", // a score, a meter, and nothing else
  deep: "#05060f",      // the dark everything else sits on

  // How big the game is, in its own pixels. The canvas keeps these numbers
  // whatever size the screen is: Screens.fit decides how much of the window
  // the picture takes, and the game goes on thinking in 960 × 600.
  WIDTH: 960,
  HEIGHT: 600,

  BG: "#05060f",       // the space behind everything
  STAR: "#8b93b0",     // the drifting stars
  SHIP: "#7cf6c8",     // your ship
  FLAME: "#f77fbe",    // the engine, while you are thrusting
  BOLT: "#ffe9a8",     // what you fire
  ROCK: "#c9d5e0",     // a meteor's outline
  ROCK_FILL: "#1b2233", // a meteor's middle
  SHIELD: "#7cf6c8",   // the bubble a full charge buys you
  SPARK: "#ff9d5c",    // what a meteor breaks into
};

// The squares the studio offers when somebody draws a picture for this game.
// Greys first, then the rainbow, then the ones with more character.
const PALETTE = [
  "#000000", "#2c2c38", "#4c4c5e", "#6e6e84", "#9494a8", "#bcbcca", "#e2e2ec", "#ffffff",
  "#e33b3b", "#ea6a2a", "#f0932b", "#f7cf3d", "#c4d92e", "#5cc648", "#2fb783", "#28b3c4",
  "#2f86d4", "#00fdff", "#7a4fd0", "#c247c0", "#ff8fbf", "#ffc9a3", "#8a5a3c", "#d2b48c",
  "#7ee0c0", "#c9b6ff", "#e8c34a", "#7a2f4a", "#1f2a5a", "#6b7a2f", "#ff6f5e", "#8e5d9e",
];
