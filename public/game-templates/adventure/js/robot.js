// The robot, taught to play this game. The studio's preview has a robot that
// plays any game for whoever is watching (press 🤖 under the preview), and
// this file is how it knows what to press. Only the preview loads it — nobody
// playing the game ever does.
//
// Robot.play is handed State every frame and answers what to press: here, a
// thing on the page to tap, or a point { x, y } to tap. Decide from State, the
// page and Robot.random() alone, keeping nothing of your own between taps,
// and a moment put back in the preview plays on exactly the same way.
//
// This one reads on with a tap while something is being said, and otherwise
// taps the middle of any spot in the picture it could use.
"use strict";

Robot.play((s) => {
  const box = document.querySelector("#adventure .box");
  if (box && !box.hidden) return box;
  const has = (name) => (s.switches || []).includes(name);
  const carried = (thing) => (s.carried || []).includes(thing);
  const spots = ((SCENES[s.scene] || {}).spots || []).filter((spot) => Array.isArray(spot.at)
    && spot.at.length === 4 && (!spot.need || has(spot.need)) && !(spot.take && !spot.keep && carried(spot.take)));
  const layer = document.querySelector("#adventure .spots");
  const picture = document.querySelector("#adventure .picture");
  if (!spots.length || !layer || !picture || !picture.naturalWidth) return null;
  const spot = spots[Math.floor(Robot.random() * spots.length)];
  const r = layer.getBoundingClientRect();
  const scale = r.width / picture.naturalWidth;
  return { x: r.left + (spot.at[0] + spot.at[2] / 2) * scale, y: r.top + (spot.at[1] + spot.at[3] / 2) * scale };
});
