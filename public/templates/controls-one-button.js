// Which keys, controller buttons and screen taps do what.
//
// This game is held the one-button way: the whole screen is the button. A
// tap or a click anywhere presses it, and so do the key and the controller
// button named below. The names on the left — action, start — are the game's
// own words: rename them to what they do (jump, flap, go), then use the same
// word in the code: Input.pressed("jump").

// The shape of the game on a touchscreen. "one-button" draws nothing over
// the game: a tap or a click anywhere is the button.
const SCHEME = "one-button";

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the screen, the keyboard, or the first controller.
  player1: {
    action: "key:space pad:a touch:screen", // the button — a tap or a click anywhere
    start: "key:enter pad:start touch:screen", // begin, or play again
  },
  // Player 2 shares the keyboard and uses the second controller. The screen
  // stays player 1's: one button cannot belong to two thumbs.
  player2: {
    action: "key:f pad:a", // the button
    start: "key:enter pad:start", // begin, or play again
  },
};
