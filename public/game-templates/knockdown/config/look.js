// Colours and sizes. All of the pretty stuff lives here.

const LOOK = {
  // The game's four. The studio wears these while this game is open, and the
  // title and end screens are drawn from them.
  primary: "#ff9f43",   // the game's own colour: its name, its buttons, the shot
  accent: "#7ed6df",    // the second colour: taglines, the aiming dots
  highlight: "#ffe08a", // a score, and nothing else
  deep: "#10131f",      // the dark everything else sits on

  // How big the game is, in its own pixels. The canvas keeps these numbers
  // whatever size the screen is: Screens.fit decides how much of the window
  // the picture takes, and the game goes on thinking in 960 × 600 — which is
  // also the world the world editor draws in.
  WIDTH: 960,
  HEIGHT: 600,

  SKY: "#1b2140",       // behind everything
  BOX: "#c98b4f",       // a crate
  BOX_EDGE: "#7a4f2a",  // a crate's outline
  BLOCK: "#5b6178",     // stone that never moves
  BLOCK_EDGE: "#8a90a8", // stone's outline
  BALL: "#9aa3c7",      // a ball lying in the world
  TARGET: "#8fe36b",    // what you knock down, until somebody draws assets/sprites/target.png
  TARGET_EYES: "#10131f", // its eyes
  SHOT: "#ff9f43",      // what the sling fires
  BAND: "#e8d7b0",      // the sling's band, while you pull it
};

// The squares the studio offers when somebody draws a picture for this game.
// Greys first, then the rainbow, then the ones with more character.
const PALETTE = [
  "#000000", "#2c2c38", "#4c4c5e", "#6e6e84", "#9494a8", "#bcbcca", "#e2e2ec", "#ffffff",
  "#e33b3b", "#ea6a2a", "#f0932b", "#f7cf3d", "#c4d92e", "#5cc648", "#2fb783", "#28b3c4",
  "#2f86d4", "#00fdff", "#7a4fd0", "#c247c0", "#ff8fbf", "#ffc9a3", "#8a5a3c", "#d2b48c",
  "#7ee0c0", "#c9b6ff", "#e8c34a", "#7a2f4a", "#1f2a5a", "#6b7a2f", "#ff6f5e", "#8e5d9e",
];
