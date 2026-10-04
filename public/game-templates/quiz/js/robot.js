// The robot, taught to play this game. The studio's preview has a robot that
// plays any game for whoever is watching (press 🤖 under the preview), and
// this file is how it knows what to press. Only the preview loads it — nobody
// playing the game ever does.
//
// Robot.play is handed State every frame and answers what to press: here,
// the button on the page to tap. Decide from State, the page and
// Robot.random() alone, keeping nothing of your own between taps, and a
// moment put back in the preview plays on exactly the same way.
//
// This one picks any answer, and starts again from the ending.
"use strict";

Robot.play(() => {
  const answers = document.querySelectorAll("#quiz .answer");
  if (answers.length) return answers[Math.floor(Robot.random() * answers.length)];
  return document.querySelector("#quiz button.big");
});
