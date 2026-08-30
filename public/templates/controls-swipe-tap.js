// Which keys, controller buttons and screen gestures do what.
//
// This game is held the swipe-tap way: flick the screen to move, tap it to
// act. A flick or a tap is a moment, not a state — it happens and it is
// over — so the game reads these with Input.pressed("left"), never with
// Input.held. The keys and controller buttons below land on the same words.
//
// The names on the left are the game's own words: rename them to suit the
// game, then use the same word in the code.

// The shape of the game on a touchscreen. "swipe-tap" draws nothing over the
// game: flicking the screen and tapping it are the controls.
const SCHEME = "swipe-tap";

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the screen, the arrow keys or WASD, or the first controller.
  player1: {
    left: "key:left key:a pad:left swipe:left", // flick left
    right: "key:right key:d pad:right swipe:right", // flick right
    up: "key:up key:w pad:up swipe:up", // flick up
    down: "key:down key:s pad:down swipe:down", // flick down
    tap: "key:space pad:a swipe:tap", // a tap — a press that stays put
    start: "key:enter pad:start swipe:tap", // begin, or play again
  },
  // Player 2 shares the keyboard and uses the second controller. The screen
  // stays player 1's.
  player2: {
    left: "key:j pad:left", // flick left
    right: "key:l pad:right", // flick right
    up: "key:i pad:up", // flick up
    down: "key:k pad:down", // flick down
    tap: "key:f pad:a", // a tap
    start: "key:enter pad:start", // begin, or play again
  },
};
