// Which keys, controller buttons and screen controls do what.
//
// This game is held the buttons way: drawn buttons under both thumbs. The
// touch: names left, right, up and down sit under one thumb — two of them
// make a big pair, three or four an arrow pad — and every other touch: name
// is a button under the other thumb. A thumb can slide between neighbouring
// buttons without lifting.
//
// toggle:FIRE is a drawn button that latches: tap it on, tap it off, and the
// game reads it as held the whole time in between. Give a toggle to a verb a
// thumb would otherwise have to hold down forever — autofire, an engine —
// and keep the key: and pad: bindings beside it, which stay momentary.
//
// The names on the left — left, thrust, fire — are the game's own words for
// what a player is doing. Rename them to suit the game, then use the same
// word in the code: Input.held("thrust").

// The shape of the game on a touchscreen: drawn buttons under both thumbs.
const SCHEME = "buttons";

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the arrows or WASD, and the first controller plugged in.
  player1: {
    left: "key:left key:a pad:left pad:stick-left touch:left", // turn left
    right: "key:right key:d pad:right pad:stick-right touch:right", // turn right
    thrust: "key:up key:w pad:up pad:stick-up pad:b touch:THRUST", // push the engine
    fire: "key:space pad:a toggle:FIRE", // latches: tap on, tap off
    start: "key:enter pad:start touch:THRUST", // begin, or play again
  },
  // Player 2 shares the keyboard and uses the second controller. Nothing is
  // drawn on the screen for them: one screen has room for two thumbs, not four.
  player2: {
    left: "key:j pad:left pad:stick-left", // turn left
    right: "key:l pad:right pad:stick-right", // turn right
    thrust: "key:i pad:up pad:stick-up pad:b", // push the engine
    fire: "key:f pad:a", // fire
    start: "key:enter pad:start", // begin, or play again
  },
};

// Which corner the action buttons sit in: "right" or "left". The movement
// buttons take the other thumb.
const BUTTON_SIDE = "right";
