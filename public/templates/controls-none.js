// Which keys and controller buttons do what — and nothing drawn over the game.
//
// This game has no controller: its own buttons and links on the page are the
// controls, and they already work everywhere. A mouse clicks them, a finger
// taps them, the Tab key reaches them, a screen reader reads them out. So
// nothing is drawn on top on a phone, the page still scrolls and selects like
// a page, and no key is taken away from the browser — Space on a button is
// still a click.
//
// A game made of buttons — a quiz, a story, a board you press — often needs
// nothing below at all. The two lines are there for a game that grows a
// keyboard as well: read them with Input.pressed("start"), the same as any
// other shape. If the game grows into one you steer, change SCHEME to the
// shape it wants and give the verbs the bindings to match.

// The shape of the game: "none" is no controller at all.
const SCHEME = "none";

// What the player can do, and everything that does it.
const CONTROLS = {
  player1: {
    action: "key:space pad:a", // the main button, if the game has one
    start: "key:enter pad:start", // begin, or play again
  },
};
