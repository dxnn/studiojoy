// Which keys, controller buttons and screen controls do what.
//
// This game is held the stick-and-buttons way: an analog stick under one
// thumb rolls the ball — it floats to wherever the thumb lands — and the
// round STOP button under the other is the brake.
//
// The names on the left — left, right, up, down, brake — are the game's own
// words for what a player is doing. Rename them to suit the game, then use the
// same word in the code: Input.held("brake").

// The shape of the game on a touchscreen: a stick and a button.
const SCHEME = "stick-buttons";

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the arrows or WASD, and the first controller plugged in.
  player1: {
    left: "key:left key:a pad:left pad:stick-left stick:left", // roll left
    right: "key:right key:d pad:right pad:stick-right stick:right", // roll right
    up: "key:up key:w pad:up pad:stick-up stick:up", // roll away
    down: "key:down key:s pad:down pad:stick-down stick:down", // roll back
    brake: "key:space pad:a touch:STOP", // slow right down
    start: "key:enter pad:start", // begin, or play again
  },
};

// How far a stick has to lean before it counts as pushed — the controller's
// and the on-screen one both. Sticks rest slightly off-centre, so a small
// number here means the ball drifts on its own; a big one means the stick
// feels stiff.
const STICK_DEADZONE = 0.2;

// Which corner the STOP button sits in: "right" or "left". The stick takes
// the other thumb.
const BUTTON_SIDE = "right";
