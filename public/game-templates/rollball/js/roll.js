// Roll a Ball — the whole game.
//
// A level of floor, walls and holes, seen from behind a ball; roll it to the
// goal and pick up the coins on the way. The level is read from
// config/level.js, one character a square, and drawn in 3D by the studio's
// render3d library; the rolling is this file's own few lines — push, friction,
// a top speed, bounce off a wall, fall down a hole. Everything around the game
// — the title screen, the end screen and the scoreboard on it, the HUD strip,
// and how much of the window the canvas gets — belongs to the studio
// libraries, so none of it is in here.
//
// ⚠️ This is a module (index.html loads it with type="module"), because the
// 3D library is one. It still reads the classic scripts' names — Input,
// Screens, LEVEL, PLAY — which were all there before it ran.
//
// The level is config/level.js, painted in the studio's level editor; the
// feel is config/play.js, the colours and the camera config/look.js, the
// words config/words.js. Change those first; come in here when you want the
// game to do something new.

const R = window.Render3D;
const canvas = document.getElementById("game");

// ---------- the level ----------

const ROWS = LEVEL.length;
const COLS = Math.max(...LEVEL.map((row) => row.length));
// What is in a square, by its character; outside the level is a hole.
const tileAt = (r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? " " : (LEVEL[r][c] || " "));
// Squares are one unit across, and the level sits in the middle of the world.
const toWorld = (r, c) => [c - (COLS - 1) / 2, r - (ROWS - 1) / 2];
const toSquare = (x, z) => [Math.round(z + (ROWS - 1) / 2), Math.round(x + (COLS - 1) / 2)];
const squares = (ch) => {
  const out = [];
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) if (tileAt(r, c) === ch) out.push([r, c]);
  return out;
};
const start = squares("S")[0] || [0, 0];

// The level is drawn once: floor under everything that is not a hole, walls
// on top, the goal a pad. Many of the same box is one Render3D.boxes call.
function drawLevel() {
  const floor = [];
  const walls = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = tileAt(r, c);
      if (ch === " ") continue;
      const [x, z] = toWorld(r, c);
      floor.push([x, -0.1, z]);
      if (ch === "#") walls.push([x, LOOK.WALL_HEIGHT / 2, z]);
    }
  }
  R.boxes(floor, { size: [1, 0.2, 1], colour: LOOK.FLOOR });
  R.boxes(walls, { size: [1, LOOK.WALL_HEIGHT, 1], colour: LOOK.WALL });
  for (const [r, c] of squares("G")) {
    const [x, z] = toWorld(r, c);
    R.box({ at: [x, 0.03, z], size: [0.9, 0.06, 0.9], colour: LOOK.GOAL });
  }
}

// ---------- the run ----------

// Everything that is true about the run happening right now. A new run is
// this built again, coins and all, which is why there is no reset().
let Run = null;
let playing = false;
let last = 0;
let ball = null;

function newRun() {
  if (Run) for (const coin of Run.coins) R.remove(coin.mesh);
  const [x, z] = toWorld(start[0], start[1]);
  const coins = squares("o").map(([r, c]) => {
    const [cx, cz] = toWorld(r, c);
    return { x: cx, z: cz, mesh: R.ball({ at: [cx, 0.35, cz], size: 0.18, colour: LOOK.COIN }) };
  });
  return {
    x, z, y: PLAY.BALL_SIZE, vx: 0, vz: 0, vy: 0,
    falling: false, back: 0, // seconds until the ball is back after a fall
    coins, got: 0, total: coins.length,
    time: 0,
  };
}

// ---------- the loop ----------

function loop(now) {
  // Seconds since the last frame, capped: a tab left in the background comes
  // back with a gap of minutes in it.
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  // ⚠️ First line of every frame, before anything asks what is held.
  Input.update();

  if (playing) step(dt);
  if (Run) ball.position.set(Run.x, Run.y, Run.z);
  // Last line of every frame: the picture, from where the camera follows.
  R.draw(dt);
  requestAnimationFrame(loop);
}

function step(dt) {
  const b = Run;
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
  if (under === " ") {
    b.falling = true;
    b.vy = 0;
    b.back = PLAY.RESPAWN;
    Sound.play("fall", 0.6);
    Moments.say("fall");
  }

  for (const coin of b.coins) {
    if (!coin.mesh.visible) continue;
    coin.mesh.rotation.y += dt * 3;
    if (Math.hypot(b.x - coin.x, b.z - coin.z) < PLAY.COIN_REACH) {
      coin.mesh.visible = false;
      b.got += 1;
      Sound.play("coin", 0.5);
      Moments.say("coin", b.got);
    }
  }

  if (under === "G") finish();
  else updateHud();
}

// A wall is a square; the ball is a circle on the floor. For each wall around
// it, the nearest point of the square: closer than the ball's size, and the
// ball is pushed back out and loses the speed it hit with, all but BOUNCE.
function bounceOffWalls(b) {
  const [r0, c0] = toSquare(b.x, b.z);
  for (let r = r0 - 1; r <= r0 + 1; r += 1) {
    for (let c = c0 - 1; c <= c0 + 1; c += 1) {
      if (tileAt(r, c) !== "#") continue;
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
  chips[WORDS.hudCoins] = Run.got + "/" + Run.total;
  chips[WORDS.hudTime] = Run.time.toFixed(1);
  Screens.chips(chips, { hint: true });
}

function startRun() {
  Run = newRun();
  playing = true;
  updateHud();
}

// Both screens are Screens.title, and the score is the difference between
// them. `post` puts the run on the scoreboard and `board` shows the top ten
// with your place in it. Bigger is better on the board: coins, plus time
// under par.
function finish() {
  const b = Run;
  playing = false;
  const time = Math.round(b.time * 10) / 10;
  const score = b.got * PLAY.COIN_POINTS + Math.max(0, Math.round((PLAY.PAR - time) * PLAY.TIME_POINTS));
  Sound.play("goal", 0.6);
  Moments.say("goal", time);
  Moments.say("score", score);
  Screens.chips({});
  Screens.title({
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
R.start(canvas, { sky: LOOK.SKY, fog: Math.max(ROWS, COLS) });
drawLevel();
const [sx, sz] = toWorld(start[0], start[1]);
ball = R.ball({ at: [sx, PLAY.BALL_SIZE, sz], size: PLAY.BALL_SIZE, colour: LOOK.BALL });
R.follow(ball, { back: LOOK.CAMERA_BACK, up: LOOK.CAMERA_UP });
// Built once before the title screen, so the level behind it has its coins;
// Roll! builds it again, fresh.
Run = newRun();

Screens.title({ start: WORDS.start, onStart: startRun });
requestAnimationFrame(loop);
