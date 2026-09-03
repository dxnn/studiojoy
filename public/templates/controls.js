// Which keys, controller buttons and screen controls do what.
//
// Every line is a list of ways to do one thing, separated by spaces, so a
// player can use whichever they have. Four kinds go in the list:
//
//   key:left   key:a   key:space   key:enter   key:shift   — the keyboard
//   pad:a  pad:b  pad:x  pad:y  pad:lb  pad:rb  pad:start   — a controller
//   pad:up pad:down pad:left pad:right  pad:stick-left …    — its pad and sticks
//   stick:left  stick:right  stick:up  stick:down           — the on-screen stick
//   touch:GO                                                — drawn on a screen
//   toggle:GO                                — drawn, and latches: tap on, tap off
//
// stick: names read the analog stick that appears under the left thumb on a
// phone or tablet — it floats to wherever the thumb lands. Any touch: name
// becomes a round button in the bottom-right with that name written on it;
// BUTTON_SIDE = "left" puts the buttons left and the stick right.
//
// The names on the left — left, fire, boost — are the game's own words for
// what a player is doing. Rename them to suit the game, then use the same
// word in the code: Input.held("boost").

// The shape of the game on a screen — what hands do. "stick-buttons" is an
// analog stick under the left thumb and round buttons under the right, and
// somebody chose it when this game was made.
//
// Change it in Controls, over the chat, which is also where the buttons are.
// Changing the word here does the same thing; then make the bindings below
// match the shape.
//
//   "none"           no controller at all: the game's own buttons on the
//                    page are the controls, and nothing is drawn over them
//   "buttons"        drawn buttons under both thumbs — an arrow pad on one
//                    side, the touch: names on the other
//   "one-button"     a tap or a click anywhere is the button; nothing drawn
//   "swipe-tap"      four flicks and a tap (swipe:left … swipe:tap). Moments,
//                    not states: read them with pressed(), never held()
//   "stick-buttons"  an analog stick beside the drawn buttons
//   "dual-stick"     a second stick to aim with (stick:aim-left …)
const SCHEME = "stick-buttons";

// What each player can do, and everything that does it.
const CONTROLS = {
  // Player 1 uses the arrows or WASD, and the first controller plugged in.
  player1: {
    left: "key:left key:a pad:left pad:stick-left stick:left", // move left
    right: "key:right key:d pad:right pad:stick-right stick:right", // move right
    up: "key:up key:w pad:up pad:stick-up stick:up", // move up, or thrust
    down: "key:down key:s pad:down pad:stick-down stick:down", // move down
    fire: "key:space pad:a touch:GO", // the main button
    boost: "key:shift pad:b", // the other button
    start: "key:enter pad:start touch:GO", // begin, or play again
  },
  // Player 2 shares the keyboard and uses the second controller. Nothing is
  // drawn on the screen for them: one screen has room for two thumbs, not four.
  player2: {
    left: "key:j pad:left pad:stick-left", // move left
    right: "key:l pad:right pad:stick-right", // move right
    up: "key:i pad:up pad:stick-up", // move up, or thrust
    down: "key:k pad:down pad:stick-down", // move down
    fire: "key:f pad:a", // the main button
    boost: "key:g pad:b", // the other button
    start: "key:enter pad:start", // begin, or play again
  },
};

// How far a stick has to lean before it counts as pushed — the controller's
// and the on-screen one both. Sticks rest slightly off-centre, so a small
// number here means the game drifts on its own; a big one means the stick
// feels stiff.
const STICK_DEADZONE = 0.35;
