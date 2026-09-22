// Every word the player sees. Change these and the game is yours — no code
// to touch.

const WORDS = {
  // The big line on the title screen. Leave it out and the page's own title
  // is used instead.
  title: "Knock It Down",
  // Under it, one line about what this is.
  tagline: "Pull the sling back. Let go. Knock every target down.",
  // The button on the title screen, and the one on the end screen.
  start: "Play!",
  again: "Play again",

  // The labels on the HUD chips. A chip's label is the word here; the number
  // beside it is the game's.
  hudShots: "Shots",
  hudTargets: "Targets",
  hudScore: "Score",

  // The end screen. {shots} becomes how many shots it took.
  cleared: "💥 All knocked down!",
  clearedHow: "In {shots} shots",
  missed: "Still standing",
  missedHow: "{left} left to knock down",
};
