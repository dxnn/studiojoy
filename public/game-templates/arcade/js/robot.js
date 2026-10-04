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
// This one slides under the meteor nearest the ground and keeps firing.
"use strict";

Robot.play((s) => {
  if (!s.ship || !s.rocks) return [];
  let lowest = null;
  for (const rock of s.rocks) if (!lowest || rock.y > lowest.y) lowest = rock;
  const hold = ["fire"];
  if (lowest && lowest.x < s.ship.x - 12) hold.push("left");
  if (lowest && lowest.x > s.ship.x + 12) hold.push("right");
  return hold;
});
