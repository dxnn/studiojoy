// Which keys, controller buttons and screen taps do what.
//
// Every line is a list of ways to do one thing, separated by spaces, so a
// player can use whichever they have. Three kinds go in the list:
//
//   key:left   key:a   key:space   key:enter   key:shift   — the keyboard
//   pad:a  pad:b  pad:x  pad:y  pad:lb  pad:rb  pad:start   — a controller
//   pad:up pad:down pad:left pad:right  pad:stick-left …    — its pad and sticks
//   touch:left  touch:GO                                    — drawn on a screen
//
// touch:left, touch:right, touch:up and touch:down become the arrow pad in the
// bottom-left corner on a phone or tablet. Any other touch: name becomes a
// round button in the bottom-right with that name written on it.
//
// The names on the left — left, fire, boost — are the game's own words for
// what a player is doing. Rename them to suit the game, then use the same
// word in the code: Input.held("boost").

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the arrows or WASD, and the first controller plugged in.
  player1: {
    left: "key:left key:a pad:left pad:stick-left touch:left",      // move left
    right: "key:right key:d pad:right pad:stick-right touch:right", // move right
    up: "key:up key:w pad:up pad:stick-up touch:up",                // move up, or thrust
    down: "key:down key:s pad:down pad:stick-down touch:down",      // move down
    fire: "key:space pad:a touch:GO",                               // the main button
    boost: "key:shift pad:b",                                       // the other button
    start: "key:enter pad:start",                                   // begin, or play again
  },
  // Player 2 shares the keyboard and uses the second controller. Nothing is
  // drawn on the screen for them: one screen has room for two thumbs, not four.
  player2: {
    left: "key:j pad:left pad:stick-left",    // move left
    right: "key:l pad:right pad:stick-right", // move right
    up: "key:i pad:up pad:stick-up",          // move up, or thrust
    down: "key:k pad:down pad:stick-down",    // move down
    fire: "key:f pad:a",                      // the main button
    boost: "key:g pad:b",                     // the other button
    start: "key:enter pad:start",             // begin, or play again
  },
};

// How far a controller stick has to lean before it counts as pushed. Sticks
// rest slightly off-centre, so a small number here means the game drifts on
// its own; a big one means the stick feels stiff.
const STICK_DEADZONE = 0.35;
