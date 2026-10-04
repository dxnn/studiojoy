// The robot, taught to play this game. The studio's preview has a robot that
// plays any game for whoever is watching (press 🤖 under the preview), and
// this file is how it knows what to press. Only the preview loads it — nobody
// playing the game ever does.
//
// Robot.play is handed State every frame and answers the verbs to hold: the
// names in config/controls.js. Decide from State and Robot.random() alone,
// keeping nothing of your own between frames, and a moment put back in the
// preview plays on exactly the same way.
//
// This one tips the aim up and down and pulls a little harder now and then,
// and lets go about once every couple of seconds while nothing is flying.
"use strict";

Robot.play((s) => {
  if (!s.playing || s.flying) return [];
  if (Robot.random() < 0.012) return ["fire"];
  const hold = [];
  const aim = Robot.random();
  if (aim < 0.25) hold.push("up");
  else if (aim < 0.5) hold.push("down");
  const power = Robot.random();
  if (power < 0.3) hold.push("right");
  else if (power < 0.4) hold.push("left");
  return hold;
});
