// How this game looks — and how the studio looks while you are working on it.
//
// These four are the game's colours. The studio borrows them: the chat pane,
// the buttons in it, the preview and the file list all take these while this
// game is open, so the studio wears the game you are making. The quiz itself
// paints its own background and buttons from them too (js/quiz.js hands them
// to the stylesheet), so changing one here changes both.

const LOOK = {
  primary: "oklch(0.72 0.19 20)",   // the main colour: buttons, the game's name, your own messages
  accent: "oklch(0.78 0.15 350)",   // the second colour: helper names, file chips, edges
  highlight: "oklch(0.85 0.15 95)", // scores and version numbers, and nothing else
  deep: "#191033"                   // the dark everything else sits on
};
