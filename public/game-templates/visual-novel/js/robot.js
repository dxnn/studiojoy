// The robot, taught to play this game. The studio's preview has a robot that
// plays any game for whoever is watching (press 🤖 under the preview), and
// this file is how it knows what to press. Only the preview loads it — nobody
// playing the game ever does.
//
// Robot.play is handed State every frame and answers what to press: here,
// the thing on the page to tap. Decide from State, the page and
// Robot.random() alone, keeping nothing of your own between taps, and a
// moment put back in the preview plays on exactly the same way.
//
// This one reads on with a tap, and picks any of the choices when they come.
"use strict";

Robot.play(() => {
  const choices = document.querySelectorAll("#story .choice");
  if (choices.length) return choices[Math.floor(Robot.random() * choices.length)];
  return document.querySelector("#story .box");
});
