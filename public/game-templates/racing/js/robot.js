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
// This one keeps its foot down and steers for a point on the road a little
// ahead of the car (Road is js/race.js's), boosting when it is pointed
// straight at it.
"use strict";

Robot.play((s) => {
  if (!s.car || typeof Road === "undefined") return [];
  const car = s.car;
  const ahead = Road.at(Road.nearest(car.x, car.y).along + 60);
  let turn = Math.atan2(ahead.y - car.y, ahead.x - car.x) - car.angle;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  const hold = ["go"];
  if (turn < -0.08) hold.push("left");
  else if (turn > 0.08) hold.push("right");
  else if (Math.abs(turn) < 0.03) hold.push("boost");
  return hold;
});
