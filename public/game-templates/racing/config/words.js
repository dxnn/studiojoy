// Every word the player sees. Change these and the game is yours — no code
// to touch.

const WORDS = {
  // The big line on the title screen. Leave it out and the page's own title
  // is used instead.
  title: "Lap Racer",
  // Under it, one line about what this is.
  tagline: "Three laps. Beat the rivals.",
  // The button on the title screen, and the one on the finish screen.
  start: "Race!",
  again: "Race again",
  // The end of the countdown.
  go: "GO!",

  // The labels on the HUD chips. A chip's label is the word here; the number
  // beside it is the game's.
  hudLap: "Lap",
  hudPlace: "Place",
  hudTime: "Time",

  // The finish screen. {place} becomes 2nd, 3rd …; {time} the seconds.
  first: "🏆 First place!",
  placed: "You came {place}",
  finished: "{time} seconds for the whole race",
};

// What each finishing place is called. The first one is unused — places
// start at 1.
const PLACES = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
