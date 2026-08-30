// Which keys, controller buttons and screen sticks do what.
//
// This game is held the dual-stick way: the left thumb moves, the right
// thumb aims — each on an analog stick that appears where the thumb lands.
// On a keyboard WASD moves and the arrows aim; on a controller the two
// sticks are the two sticks. stick:move and stick:aim are held while that
// stick is pushed at all, which is how a touchscreen fires and starts.
//
// The names on the left are the game's own words: rename them to suit the
// game, then use the same word in the code — the aim, as -1..1 numbers,
// is Input.axis("aim-left", "aim-right") and Input.axis("aim-up", "aim-down").

// The shape of the game on a touchscreen. "dual-stick" is two analog sticks,
// move under the left thumb and aim under the right.
const SCHEME = "dual-stick";

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the screen, WASD plus the arrows, or the first controller.
  player1: {
    left: "key:a pad:left pad:stick-left stick:left", // move left
    right: "key:d pad:right pad:stick-right stick:right", // move right
    up: "key:w pad:up pad:stick-up stick:up", // move up
    down: "key:s pad:down pad:stick-down stick:down", // move down
    "aim-left": "key:left pad:stick2-left stick:aim-left", // aim left
    "aim-right": "key:right pad:stick2-right stick:aim-right", // aim right
    "aim-up": "key:up pad:stick2-up stick:aim-up", // aim up
    "aim-down": "key:down pad:stick2-down stick:aim-down", // aim down
    fire: "key:space pad:a stick:aim", // fire — on a touchscreen, pushing the aim stick fires
    start: "key:enter pad:start stick:move stick:aim", // begin — push anything
  },
  // Player 2 uses the second controller. The screen and keyboard are player 1's.
  player2: {
    left: "pad:left pad:stick-left", // move left
    right: "pad:right pad:stick-right", // move right
    up: "pad:up pad:stick-up", // move up
    down: "pad:down pad:stick-down", // move down
    "aim-left": "pad:stick2-left", // aim left
    "aim-right": "pad:stick2-right", // aim right
    "aim-up": "pad:stick2-up", // aim up
    "aim-down": "pad:stick2-down", // aim down
    fire: "pad:a", // fire
    start: "pad:start", // begin, or play again
  },
};

// How far a stick has to lean before it counts as pushed — the controller's
// and the on-screen ones both. Sticks rest slightly off-centre, so a small
// number here means the game drifts on its own; a big one means the stick
// feels stiff.
const STICK_DEADZONE = 0.35;
