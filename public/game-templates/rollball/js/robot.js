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
// This one finds its way. From the square under the ball it looks, a square
// at a time over squares it can roll on, for the nearest coin still lying
// there — or the goal, once there are none — and steers gently for the next
// square on that path, braking when it is going too fast to turn.
"use strict";

Robot.play((s) => {
  const level = typeof LEVELS !== "undefined" ? LEVELS[s.at] : null;
  if (!level || !Array.isArray(s.coins) || s.falling) return [];
  const rows = level.length;
  const cols = Math.max(...level.map((row) => row.length));
  const tile = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? " " : (level[r][c] || " "));
  const solid = (ch) => ch === "#" || Boolean(SQUARES[ch] && SQUARES[ch].solid);
  const open = (r, c) => tile(r, c) !== " " && !solid(tile(r, c));
  const toSquare = (x, z) => [Math.round(z + (rows - 1) / 2), Math.round(x + (cols - 1) / 2)];
  const toWorld = (r, c) => [c - (cols - 1) / 2, r - (rows - 1) / 2];

  const targets = new Set();
  for (const coin of s.coins) if (!coin.got) targets.add(toSquare(coin.x, coin.z).join(","));
  if (!targets.size) {
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) if (tile(r, c) === "G") targets.add(r + "," + c);
  }

  // Outward from the ball, remembering where each square was reached from.
  const [r0, c0] = toSquare(s.x, s.z);
  const here = r0 + "," + c0;
  const from = { [here]: null };
  const queue = [[r0, c0]];
  let found = null;
  while (queue.length && !found) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = (r + dr) + "," + (c + dc);
      if (key in from || !open(r + dr, c + dc)) continue;
      from[key] = r + "," + c;
      if (targets.has(key)) { found = key; break; }
      queue.push([r + dr, c + dc]);
    }
  }
  // Back along the way to the first square of it; with no way at all, the
  // middle of the square it is on.
  let next = found;
  while (next && from[next] !== here) next = from[next];
  const [tx, tz] = next ? toWorld(...next.split(",").map(Number)) : toWorld(r0, c0);

  // Up rolls away from the camera, which is less z.
  const hold = [];
  const steer = (gap, speed, less, more) => {
    const want = Math.max(-1.5, Math.min(1.5, gap * 2.5));
    if (speed < want - 0.25) hold.push(more);
    else if (speed > want + 0.25) hold.push(less);
  };
  steer(tx - s.x, s.vx, "left", "right");
  steer(tz - s.z, s.vz, "up", "down");
  if (Math.hypot(s.vx, s.vz) > 2.5) hold.push("brake");
  return hold;
});
