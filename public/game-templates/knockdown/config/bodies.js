// Everything in the world when a level starts: what it is, where its middle
// is, how big it is and — for the square ones — how far it is turned, in
// degrees. The world is 960 across and 600 down, and down is down.
//   box    — a crate. It falls, stacks and gets knocked about. size: [wide, tall]
//   block  — stone. It never moves: the ground, a ledge, a wall. size: [wide, tall]
//   ball   — round, and it rolls. size: how far from its middle to its edge
//   target — what the player has to knock down. Round, like a ball.
// Build it in the studio's world editor rather than typing numbers: drag a
// thing to move it, drag its corner to size it.
const BODIES = [
  { kind: "block", at: [480, 580], size: [960, 40], angle: 0 },
  { kind: "block", at: [720, 530], size: [240, 60], angle: 0 },
  { kind: "box", at: [650, 480], size: [40, 40], angle: 0 },
  { kind: "box", at: [790, 480], size: [40, 40], angle: 0 },
  { kind: "box", at: [720, 450], size: [200, 20], angle: 0 },
  { kind: "target", at: [720, 422], size: 18 },
  { kind: "box", at: [650, 420], size: [40, 40], angle: 0 },
  { kind: "box", at: [790, 420], size: [40, 40], angle: 0 },
  { kind: "box", at: [720, 390], size: [200, 20], angle: 0 },
  { kind: "target", at: [720, 362], size: 18 },
  { kind: "ball", at: [540, 544], size: 16 },
];

// Where the shots are fired from.
const SLING = { at: [150, 440] };
