// Every word the player sees. Change these and the game is yours — no code
// to touch.

const WORDS = {
  // The big line on the title screen. Leave it out and the page's own title
  // is used instead.
  title: "Roll a Ball",
  // Under it, one line about what this is.
  tagline: "Roll to the goal. Pick up the coins. Mind the holes.",
  // The button on the title screen, and the one on the end screen.
  start: "Roll!",
  again: "Roll again",

  // The labels on the HUD chips. A chip's label is the word here; the number
  // beside it is the game's. The level's chip only shows with more than one.
  hudLevel: "Level",
  hudCoins: "Coins",
  hudTime: "Time",

  // The end screen. {time} becomes the seconds, {coins} how many were picked up.
  finished: "🏁 You made it!",
  finishedHow: "{time} seconds · coins: {coins}",
};
