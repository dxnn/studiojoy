// One-off: how much does a helper think when the ask is one step of a plan
// rather than the whole game? (ideas/planner.md, to be written.)
//
//   NODE_OPTIONS=--use-env-proxy node tmp/probe-step.mjs
//
// §14's table is the whole tank game in one ask: at the default effort the
// trace ate the budget nine runs in ten, and 'low' wrote files after 1,597
// and 6,886 tokens of thinking. Same preamble, same tools, same game — but
// the last message is one step of a six-step plan, with the plan shown.
//
// Step 1 runs against an empty tree. Step 2 runs against a hand-written
// version of what step 1 makes, so it is a real "add to what is there".
// Each at 'low' and at 'none', three runs each. The columns that matter:
// reasoning tokens, first call at, prose (the wall of text a kid reads),
// and whether it stayed inside its step.

import { stream, streamRow, preamble, blockOf, TOOLS, TASK, EMPTY_TREE, u } from './probe-lib.mjs';

const REPS = Number(process.env.PROBE_REPS ?? 3);

const PLAN = [
  ['The page and the numbers', ['index.html', 'css/style.css', 'config/play.js', 'config/look.js', 'config/words.js'],
    'The page with one canvas, the styles, and the tuning numbers (tank speed, turn speed, bullet speed, wall strength, power-up timing), the colours, and every word the player sees. Nothing moves yet: the game is a blank canvas that loads without errors.'],
  ['Two tanks that drive', ['js/input.js', 'js/tank.js', 'js/game.js'],
    'Keyboard input for two players (WASD + Space, arrows + Enter), a tank that has a position and an angle and can drive and turn, and the game loop that updates both tanks and draws each one on its own half of the canvas. No shooting yet.'],
  ['Shooting', ['js/bullet.js', 'js/game.js'],
    'Bullets that fly from a tank, hit the other tank, and cost a life. The game loop updates and draws them.'],
  ['Walls that break', ['config/world.js', 'js/walls.js', 'js/game.js'],
    'A grid of walls from config/world.js that bullets chip away at, and that tanks cannot drive through.'],
  ['Power-ups', ['js/powerups.js', 'js/game.js'],
    'Power-ups that appear on the map and give a tank a short boost: speed, triple shot, shield.'],
  ['Screens and notes', ['js/game.js', 'BRIEF.md', 'SPEC.md'],
    'A title screen, a winner screen with play again, and the two project documents.'],
];

const planText = PLAN.map(([title, files], i) => `${i + 1}. ${title} — ${files.join(', ')}`).join('\n');

function stepMessage(n) {
  const [title, files, what] = PLAN[n - 1];
  return [
    `[studio] "${TASK}" was too big for one reply, so it was split into ${PLAN.length} steps:`,
    planText,
    '',
    `This reply is step ${n} of ${PLAN.length}: ${title} (${files.join(', ')}). ${what}`,
    'Do only this step, then stop with a one-line note saying what you made. The other steps are later replies.',
  ].join('\n');
}

// What step 1 plausibly leaves behind, so step 2 is an edit to a real tree.
const AFTER_STEP_1 = {
  'index.html': `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tank</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<canvas id="game" width="960" height="540"></canvas>
<script src="config/play.js"></script>
<script src="config/look.js"></script>
<script src="config/words.js"></script>
</body>
</html>
`,
  'css/style.css': `html, body { margin: 0; background: #111; height: 100%; display: grid; place-items: center; }
canvas { background: #222; max-width: 100vw; max-height: 100vh; }
`,
  'config/play.js': `// How fast a tank drives, in pixels per second.
const TANK_SPEED = 120;
// How fast a tank turns, in degrees per second.
const TURN_SPEED = 180;
// How fast a bullet flies, in pixels per second.
const BULLET_SPEED = 320;
// How many hits a wall takes before it breaks.
const WALL_STRENGTH = 3;
// How many seconds a power-up lasts.
const POWERUP_SECONDS = 8;
// How many lives each tank starts with.
const LIVES = 3;
`,
  'config/look.js': `// The colour of player one's tank.
const TANK_ONE_COLOUR = "#4fc3f7";
// The colour of player two's tank.
const TANK_TWO_COLOUR = "#ff8a65";
// The colour of the walls.
const WALL_COLOUR = "#8d6e63";
// The colour of the ground.
const GROUND_COLOUR = "#263238";
// How big a tank is, in pixels.
const TANK_SIZE = 28;
`,
  'config/words.js': `// The name of the game, on the title screen.
const TITLE = "Tank";
// What the title screen says under the name.
const TAGLINE = "Two tanks. One arena.";
// Shown when a player wins.
const WIN_TEXT = "Player {n} wins!";
// The play-again button.
const AGAIN_TEXT = "Play again";
`,
};

async function arm(label, n, effort, system) {
  for (let i = 1; i <= REPS; i += 1) {
    const r = await stream({
      system, messages: [u(stepMessage(n))], tools: TOOLS, effort, maxTokens: 16384,
    });
    console.log(streamRow(`${label} '${effort}' #${i}`, r));
  }
}

console.log('step 1 of 6 (page + config), empty tree');
const sys1 = `${preamble('Tank')}\n\n${EMPTY_TREE}`;
await arm('step 1', 1, 'low', sys1);
await arm('step 1', 1, 'none', sys1);

console.log("\nstep 2 of 6 (input + tank + loop), on step 1's files");
const sys2 = `${preamble('Tank')}\n\n${blockOf(AFTER_STEP_1)}`;
await arm('step 2', 2, 'low', sys2);
await arm('step 2', 2, 'none', sys2);
