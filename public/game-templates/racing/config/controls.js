// Which keys, controller buttons and screen controls do what.
//
// This game is held the buttons way: drawn buttons under both thumbs. The
// touch: names left and right sit under one thumb as a big pair, and every
// other touch: name is a button under the other thumb. A thumb can slide
// between neighbouring buttons without lifting.
//
// toggle:BOOST is a drawn button that latches: tap it on, tap it off, and the
// game reads it as held the whole time in between. The key: and pad: bindings
// beside it stay momentary.
//
// The names on the left — left, go, boost — are the game's own words for
// what a player is doing. Rename them to suit the game, then use the same
// word in the code: Input.held("go").

// The shape of the game on a touchscreen: drawn buttons under both thumbs.
const SCHEME = "buttons";

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the arrows or WASD, and the first controller plugged in.
  player1: {
    left: "key:left key:a pad:left pad:stick-left touch:left", // steer left
    right: "key:right key:d pad:right pad:stick-right touch:right", // steer right
    go: "key:up key:w pad:up pad:stick-up pad:a touch:GO", // the accelerator
    boost: "key:space key:shift pad:b toggle:BOOST", // latches: tap on, tap off
    start: "key:enter pad:start touch:GO", // begin, or race again
  },
  // Player 2 shares the keyboard and uses the second controller. Nothing is
  // drawn on the screen for them: one screen has room for two thumbs, not four.
  player2: {
    left: "key:j pad:left pad:stick-left", // steer left
    right: "key:l pad:right pad:stick-right", // steer right
    go: "key:i pad:up pad:stick-up pad:a", // the accelerator
    boost: "key:f pad:b", // boost
    start: "key:enter pad:start", // begin, or race again
  },
};

// Which corner the action buttons sit in: "right" or "left". The steering
// buttons take the other thumb.
const BUTTON_SIDE = "right";
