// Roll a Ball — the whole game.
//
// Levels of floor, walls and holes, seen from behind a ball; roll it to the
// goal and pick up the coins on the way, and the goal takes you on to the
// next level. The levels are read from config/level.js, one character a
// square, and drawn in 3D by the studio's render3d library; the rolling is
// this file's own few lines — push, friction, a top speed, bounce off a wall,
// fall down a hole. Everything around the game — the title screen, the end
// screen and the scoreboard on it, the HUD strip, and how much of the window
// the canvas gets — belongs to the studio libraries, so none of it is in here.
//
// ⚠️ This is a module (index.html loads it with type="module"), because the
// 3D library is one. It still reads the classic scripts' names — Input,
// Screens, LEVELS, SQUARES, PLAY — which were all there before it ran.
//
// The levels are config/level.js, painted in the studio's level editor; the
// feel is config/play.js, the colours and the camera config/look.js, the
// words config/words.js. Change those first; come in here when you want the
// game to do something new — and a new kind of square does its thing in
// ON_SQUARE, below.

const R = window.Render3D;
const canvas = document.getElementById("game");

// ---------- the levels ----------

// Which level a run starts on, counted from 0. The studio's "Try it" opens
// the preview on the level being painted: ?level=2 is the second.
const asked = Number(new URLSearchParams(location.search).get("level"));
const FIRST = Number.isInteger(asked) && asked >= 1 && asked <= LEVELS.length ? asked - 1 : 0;

// The level being played: its rows, its size, and where the ball starts.
let level = LEVELS[FIRST];
let ROWS = 0;
let COLS = 0;
let start = [0, 0];

// What is in a square, by its character; outside the level is a hole.
const tileAt = (r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? " " : (level[r][c] || " "));
// Squares are one unit across, and the level sits in the middle of the world.
const toWorld = (r, c) => [c - (COLS - 1) / 2, r - (ROWS - 1) / 2];
const toSquare = (x, z) => [Math.round(z + (ROWS - 1) / 2), Math.round(x + (COLS - 1) / 2)];
const whereIs = (ch) => {
  const out = [];
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) if (tileAt(r, c) === ch) out.push([r, c]);
  return out;
};
// What the ball bumps into: a wall, and any kind of square in SQUARES that
// says it is solid.
const solid = (ch) => ch === "#" || Boolean(SQUARES[ch] && SQUARES[ch].solid);

function useLevel(n) {
  level = LEVELS[n];
  ROWS = level.length;
  COLS = Math.max(...level.map((row) => row.length));
  start = whereIs("S")[0] || firstFloor();
}

// A level with no S painted yet starts the ball on the first square it can
// roll on, rather than inside a wall.
function firstFloor() {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = tileAt(r, c);
      if (ch !== " " && !solid(ch)) return [r, c];
    }
  }
  return [0, 0];
}

// A level is drawn when the ball arrives in it, on an empty scene: floor
// under everything that is not a hole, walls on top, a solid kind of square
// as a block in its own colour, the goal a pad, then the ball and the camera
// behind it. Many of the same box is one Render3D.boxes call.
function drawLevel() {
  R.clear();
  const floor = [];
  const walls = [];
  const blocks = {}; // a solid kind of square's places, by its letter
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = tileAt(r, c);
      if (ch === " ") continue;
      const [x, z] = toWorld(r, c);
      floor.push([x, -0.1, z]);
      if (ch === "#") walls.push([x, LOOK.WALL_HEIGHT / 2, z]);
      else if (solid(ch)) (blocks[ch] = blocks[ch] || []).push([x, LOOK.WALL_HEIGHT / 2, z]);
    }
  }
  R.boxes(floor, { size: [1, 0.2, 1], colour: LOOK.FLOOR });
  R.boxes(walls, { size: [1, LOOK.WALL_HEIGHT, 1], colour: LOOK.WALL });
  for (const ch of Object.keys(blocks)) {
    R.boxes(blocks[ch], { size: [1, LOOK.WALL_HEIGHT, 1], colour: SQUARES[ch].colour });
  }
  for (const [r, c] of whereIs("G")) {
    const [x, z] = toWorld(r, c);
    R.box({ at: [x, 0.03, z], size: [0.9, 0.06, 0.9], colour: LOOK.GOAL });
  }
  const [sx, sz] = toWorld(start[0], start[1]);
  ball = R.ball({ at: [sx, PLAY.BALL_SIZE, sz], size: PLAY.BALL_SIZE, colour: LOOK.BALL });
  R.follow(ball, { back: LOOK.CAMERA_BACK, up: LOOK.CAMERA_UP });
}

// ---------- what a kind of square does ----------

// What each kind of square in config/level.js's SQUARES does when the ball
// rolls onto it, by its letter. A kind with nothing here is still drawn in
// its colour — a solid one as a block the ball bumps into, any other as a
// marker on the floor — so a new kind can be painted and seen before it does
// anything. Each is a function of the square the ball just rolled onto:
//
//   b: (square) => { fall(); },     // a trap: down you go
//   p: (square) => { hide(square); }, // picked up, gone
//
// `square` is { r, c, key, mesh }, the mesh its marker. What a square does to
// the run goes in State, like everything else that changes — hide() is how a
// square is gone for the rest of the level — and every function in this file
// is there to call.
const ON_SQUARE = {};

// ---------- the run ----------

// Everything that is true about the run happening right now — which level it
// is on, the ball, the coins picked up, the clock — kept in State
// (studio/state.js), which is what lets the studio's preview pin a moment and
// come back to it. A new run is State.reset(newRun()), so there is no reset()
// of the game's own to keep in step.
//
// Not the run's: the picture of it. The level's rows and size, the ball's
// mesh, a mesh for each coin and marker — built from State by showLevel()
// whenever the level changes, and again when a pinned moment is put back.
let last = 0;
let ball = null;
let coinMeshes = [];
let markers = {};
let screen = null;

function newRun() {
  const coinsIn = (rows) => rows.join("").split("o").length - 1;
  return {
    playing: false, // a run is going, rather than a title screen
    at: FIRST,
    x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0,
    falling: false, back: 0, // seconds until the ball is back after a fall
    on: null, // the square under the ball, as "r,c"
    got: 0, total: LEVELS.slice(FIRST).reduce((n, rows) => n + coinsIn(rows), 0),
    time: 0,
    coins: [], // this level's: where each is, and whether it is got
    hidden: {}, // this level's squares a kind of square has hidden, by "r,c"
  };
}

// The ball arrives at the start of level n, with nothing picked up there yet.
function enterLevel(n) {
  State.at = n;
  useLevel(n);
  State.coins = whereIs("o").map(([r, c]) => {
    const [x, z] = toWorld(r, c);
    return { x, z, got: false };
  });
  State.hidden = {};
  const [x, z] = toWorld(start[0], start[1]);
  Object.assign(State, { x, z, y: PLAY.BALL_SIZE, vx: 0, vz: 0, vy: 0, falling: false, back: 0, on: null });
  showLevel();
}

// The level State is on, drawn as State says it is: its coins got or not,
// its markers hidden or not.
function showLevel() {
  useLevel(State.at);
  drawLevel();
  coinMeshes = State.coins.map((coin) => {
    const mesh = R.ball({ at: [coin.x, 0.35, coin.z], size: 0.18, colour: LOOK.COIN });
    mesh.visible = !coin.got;
    return mesh;
  });
  markers = {};
  for (const ch of Object.keys(SQUARES)) {
    if (solid(ch)) continue;
    for (const [r, c] of whereIs(ch)) {
      const [mx, mz] = toWorld(r, c);
      const key = r + "," + c;
      const mesh = R.box({ at: [mx, 0.08, mz], size: [0.6, 0.16, 0.6], colour: SQUARES[ch].colour });
      mesh.visible = !State.hidden[key];
      markers[key] = { r, c, ch, key, mesh };
    }
  }
}

// A square gone for the rest of the level: hidden in State, so a pinned
// moment remembers it, and on the screen.
function hide(square) {
  State.hidden[square.key] = true;
  square.mesh.visible = false;
}

// Down a hole — or anything else that should send the ball back to the start.
function fall() {
  State.falling = true;
  State.vy = 0;
  State.back = PLAY.RESPAWN;
  Sound.play("fall", 0.6);
  Moments.say("fall");
}

// Back to a pinned moment: the level it was on, drawn again from State, and
// the screen that was up when it was put back goes.
State.loaded(function () {
  showLevel();
  if (!State.playing) return;
  if (screen) { screen.close(); screen = null; }
  updateHud();
});

// ---------- the loop ----------

function loop(now) {
  // Seconds since the last frame, capped: a tab left in the background comes
  // back with a gap of minutes in it.
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  // ⚠️ First line of every frame, before anything asks what is held.
  Input.update();

  if (State.playing) step(dt);
  if (ball) ball.position.set(State.x, State.y, State.z);
  // Last line of every frame: the picture, from where the camera follows.
  R.draw(dt);
  requestAnimationFrame(loop);
}

function step(dt) {
  const b = State;
  b.time += dt;

  if (b.falling) {
    b.vy -= PLAY.GRAVITY * dt;
    b.y += b.vy * dt;
    b.back -= dt;
    if (b.back <= 0) {
      const [x, z] = toWorld(start[0], start[1]);
      Object.assign(b, { x, z, y: PLAY.BALL_SIZE, vx: 0, vz: 0, vy: 0, falling: false });
    }
    updateHud();
    return;
  }

  // The stick pushes; up is away from the camera. Friction slows it, the
  // brake slows it harder, and it never rolls faster than TOP.
  b.vx += Input.axis("left", "right") * PLAY.ROLL * dt;
  b.vz += Input.axis("up", "down") * PLAY.ROLL * dt;
  const slow = PLAY.FRICTION + (Input.held("brake") ? PLAY.BRAKE : 0);
  b.vx -= b.vx * Math.min(1, slow * dt);
  b.vz -= b.vz * Math.min(1, slow * dt);
  const speed = Math.hypot(b.vx, b.vz);
  if (speed > PLAY.TOP) {
    b.vx *= PLAY.TOP / speed;
    b.vz *= PLAY.TOP / speed;
  }
  // In steps shorter than half the ball, so a fast ball or a small one can
  // never land its middle inside a wall in one go and come out the far side.
  const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vz) * dt) / (PLAY.BALL_SIZE / 2)));
  for (let i = 0; i < steps; i += 1) {
    b.x += (b.vx * dt) / steps;
    b.z += (b.vz * dt) / steps;
    bounceOffWalls(b);
  }

  // Spun the way it rolls: a ball of radius r turns one radian for every r
  // it travels.
  ball.rotation.x += (b.vz * dt) / PLAY.BALL_SIZE;
  ball.rotation.z -= (b.vx * dt) / PLAY.BALL_SIZE;

  const [r, c] = toSquare(b.x, b.z);
  const under = tileAt(r, c);
  if (under === " ") fall();

  // Rolled onto a new square: if it is a kind with something to do, it does it.
  const key = r + "," + c;
  if (key !== b.on) {
    b.on = key;
    const marker = markers[key];
    if (marker && !b.hidden[key] && ON_SQUARE[marker.ch]) ON_SQUARE[marker.ch](marker);
  }

  b.coins.forEach((coin, i) => {
    if (coin.got) return;
    const mesh = coinMeshes[i];
    mesh.rotation.y += dt * 3;
    if (Math.hypot(b.x - coin.x, b.z - coin.z) < PLAY.COIN_REACH) {
      coin.got = true;
      mesh.visible = false;
      b.got += 1;
      Sound.play("coin", 0.5);
      Moments.say("coin", b.got);
    }
  });

  if (under === "G") reachGoal();
  else updateHud();
}

// The goal: on to the next level, or the end of the run after the last.
function reachGoal() {
  if (State.at + 1 < LEVELS.length) {
    Sound.play("goal", 0.6);
    Moments.say("level", State.at + 1);
    enterLevel(State.at + 1);
    updateHud();
  } else {
    finish();
  }
}

// A wall is a square; the ball is a circle on the floor. For each wall around
// it, the nearest point of the square: closer than the ball's size, and the
// ball is pushed back out and loses the speed it hit with, all but BOUNCE.
function bounceOffWalls(b) {
  const [r0, c0] = toSquare(b.x, b.z);
  for (let r = r0 - 1; r <= r0 + 1; r += 1) {
    for (let c = c0 - 1; c <= c0 + 1; c += 1) {
      if (!solid(tileAt(r, c))) continue;
      const [wx, wz] = toWorld(r, c);
      const nx = Math.max(wx - 0.5, Math.min(wx + 0.5, b.x));
      const nz = Math.max(wz - 0.5, Math.min(wz + 0.5, b.z));
      const dx = b.x - nx;
      const dz = b.z - nz;
      const d = Math.hypot(dx, dz);
      if (d >= PLAY.BALL_SIZE || d === 0) continue;
      const ux = dx / d;
      const uz = dz / d;
      b.x = nx + ux * PLAY.BALL_SIZE;
      b.z = nz + uz * PLAY.BALL_SIZE;
      const into = b.vx * ux + b.vz * uz;
      if (into < 0) {
        b.vx -= (1 + PLAY.BOUNCE) * into * ux;
        b.vz -= (1 + PLAY.BOUNCE) * into * uz;
      }
    }
  }
}

// ---------- what the player sees around the game ----------

// The whole strip, every frame. Screens.chips builds it once and touches only
// what changed, so saying all of it every time costs nothing.
function updateHud() {
  const chips = {};
  if (LEVELS.length > 1) chips[WORDS.hudLevel] = (State.at + 1) + "/" + LEVELS.length;
  chips[WORDS.hudCoins] = State.got + "/" + State.total;
  chips[WORDS.hudTime] = State.time.toFixed(1);
  Screens.chips(chips, { hint: true });
}

function startRun() {
  screen = null;
  State.reset(newRun());
  enterLevel(FIRST);
  State.playing = true;
  updateHud();
}

// Both screens are Screens.title, and the score is the difference between
// them. `post` puts the run on the scoreboard and `board` shows the top ten
// with your place in it. Bigger is better on the board: coins, plus time
// under par.
function finish() {
  const b = State;
  b.playing = false;
  const time = Math.round(b.time * 10) / 10;
  const score = b.got * PLAY.COIN_POINTS + Math.max(0, Math.round((PLAY.PAR - time) * PLAY.TIME_POINTS));
  Sound.play("goal", 0.6);
  Moments.say("goal", time);
  Moments.say("score", score);
  Screens.chips({});
  screen = Screens.title({
    name: WORDS.finished,
    tagline: WORDS.finishedHow.replace("{time}", time).replace("{coins}", b.got),
    score,
    post: true,
    board: true,
    start: WORDS.again,
    onStart: startRun,
  });
}

// ---------- boot ----------

// How much of the window the game may have, worked out from the canvas's own
// 960 × 600 against the window's width *and* height. ⚠️ First, before the 3D
// library starts: fit reads the canvas's size, and the library then sizes its
// picture to whatever fit made of it.
Screens.fit(document.getElementById("wrap"));
// The fog is set once, far enough out for the biggest level.
const widest = Math.max(...LEVELS.map((rows) => Math.max(rows.length, ...rows.map((row) => row.length))));
R.start(canvas, { sky: LOOK.SKY, fog: widest });
// Built once before the title screen, so the level behind it has its coins;
// Roll! builds it again, fresh.
State.reset(newRun());
enterLevel(FIRST);

screen = Screens.title({ start: WORDS.start, onStart: startRun });
requestAnimationFrame(loop);
