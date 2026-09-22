// Which keys and controller buttons do what — and nothing drawn over the game.
//
// The sling is the control: press on it, pull back, let go — with a finger or
// a mouse, straight on the game. So nothing is drawn on top on a phone. The
// keys below are the other way to play, for a keyboard or a controller: turn
// the aim, change how hard, fire.
//
// The names on the left — up, down, left, right, fire — are the game's own
// words for what a player is doing. Rename them to suit the game, then use the
// same word in the code: Input.pressed("fire").

// The shape of the game: "none" is no controller drawn at all.
const SCHEME = "none";

// What the player can do, and everything that does it.
const CONTROLS = {
  player1: {
    up: "key:up key:w pad:up pad:stick-up", // aim higher
    down: "key:down key:s pad:down pad:stick-down", // aim lower
    left: "key:left key:a pad:left pad:stick-left", // softer
    right: "key:right key:d pad:right pad:stick-right", // harder
    fire: "key:space pad:a", // let go of the sling
    start: "key:enter pad:start", // begin, or play again
  },
};
