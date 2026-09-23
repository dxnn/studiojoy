// Colours and sizes. All of the pretty stuff lives here.

const LOOK = {
  // The game's four. The studio wears these while this game is open, and the
  // title and end screens are drawn from them.
  primary: "#4fc3f7",   // the game's own colour: its name, its buttons, the ball
  accent: "#b39ddb",    // the second colour: taglines, the goal
  highlight: "#ffe08a", // a score, a time, and nothing else
  deep: "#0e1726",      // the dark everything else sits on

  // How big the game is on the screen, in its own pixels. The canvas keeps
  // these numbers whatever size the screen is: Screens.fit decides how much
  // of the window the picture takes.
  WIDTH: 960,
  HEIGHT: 600,

  SKY: "#16223a",       // behind everything
  FLOOR: "#3d5a80",     // a floor square
  WALL: "#98c1d9",      // a wall
  WALL_HEIGHT: 0.8,     // how tall a wall is, next to a floor square of 1
  BALL: "#4fc3f7",      // the ball
  COIN: "#ffd166",      // a coin
  GOAL: "#b39ddb",      // the goal pad

  // Where the camera sits: behind the ball and above it, in floor squares.
  CAMERA_BACK: 5,
  CAMERA_UP: 6,
};

// The squares the studio offers when somebody draws a picture for this game.
// Greys first, then the rainbow, then the ones with more character.
const PALETTE = [
  "#000000", "#2c2c38", "#4c4c5e", "#6e6e84", "#9494a8", "#bcbcca", "#e2e2ec", "#ffffff",
  "#e33b3b", "#ea6a2a", "#f0932b", "#f7cf3d", "#c4d92e", "#5cc648", "#2fb783", "#28b3c4",
  "#2f86d4", "#00fdff", "#7a4fd0", "#c247c0", "#ff8fbf", "#ffc9a3", "#8a5a3c", "#d2b48c",
  "#7ee0c0", "#c9b6ff", "#e8c34a", "#7a2f4a", "#1f2a5a", "#6b7a2f", "#ff6f5e", "#8e5d9e",
];
