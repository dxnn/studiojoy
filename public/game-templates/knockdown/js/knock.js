// Knock It Down — the whole game.
//
// A sling, a pile of crates and stone, and targets somewhere in it. Pull the
// sling back and let go; the physics library does the falling, stacking and
// knocking over, and this file decides what counts: a target hit hard enough,
// or knocked off the world, is down. Everything around the game — the title
// screen, the end screen and the scoreboard on it, the HUD strip, and how
// much of the window the canvas gets — belongs to the studio libraries, so
// none of it is in here.
//
// The world is config/bodies.js, built in the studio's world editor; the feel
// is config/play.js, the colours config/look.js, the words config/words.js.
// Change those first; come in here when you want the game to do something
// new.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- the level ----------

// Everything that is true about the level being played. A new level is this
// built again — world and all — which is why there is no reset() to keep in
// step.
function newLevel() {
  Physics.world({ gravity: PLAY.GRAVITY, bounce: PLAY.BOUNCE, friction: PLAY.FRICTION });
  // A block is the one kind that never moves; the rest is the physics'.
  Physics.build(BODIES.map((b) => Object.assign({}, b, { still: b.kind === "block" })));
  return {
    shotsLeft: PLAY.SHOTS,
    down: 0,
    score: 0,
    shot: null,        // the shot in the air, while there is one
    waited: 0,         // seconds since it was fired
    pulling: false,    // a finger or the mouse is on the sling
    pull: [-60, 40],   // where the band is pulled to, from the sling
    over: false,
  };
}

let Level = null;
let playing = false;
let last = 0;

const targets = () => Physics.all().filter((b) => b.kind === "target");

// A hit is told after each step, with how hard the two met. Hard enough, and a
// target is down; hard enough between anything, and it is a crash worth a
// noise.
Physics.onHit(function (a, b, speed) {
  if (!playing || speed < PLAY.POP) return;
  Sound.play("hit", Math.min(1, speed / (PLAY.POP * 4)));
  Moments.say("crash");
  if (a.kind === "target") knockDown(a);
  if (b.kind === "target") knockDown(b);
});

function knockDown(target) {
  if (Physics.all().indexOf(target) < 0) return;
  Physics.remove(target);
  Level.down += 1;
  Level.score += PLAY.TARGET_POINTS;
  Sound.play("pop", 0.6);
  Moments.say("pop", Level.down);
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
  draw();
  requestAnimationFrame(loop);
}

function step(dt) {
  const L = Level;
  Physics.step(dt);

  // Off the edge of the world is down too: a target knocked off the ledge
  // counts, and a shot that flew away is gone.
  for (const b of Physics.all()) {
    if (b.still) continue;
    const gone = b.y > LOOK.HEIGHT + 60 || b.x < -60 || b.x > LOOK.WIDTH + 60;
    if (!gone) continue;
    if (b.kind === "target") knockDown(b);
    else Physics.remove(b);
  }

  if (L.shot) {
    // The shot is over when everything has settled, or it has waited long
    // enough — a ball rolling on a flat floor could roll for a long time.
    L.waited += dt;
    if ((L.waited > 0.6 && !Physics.moving()) || L.waited > PLAY.SETTLE) endShot();
  } else {
    aimWithKeys(dt);
    if (Input.pressed("fire")) fire();
  }
  updateHud();
}

// ---------- the sling ----------

// Up and down turn the aim, left and right change how hard: the pull, moved
// round the sling and in and out.
function aimWithKeys(dt) {
  const L = Level;
  let angle = Math.atan2(L.pull[1], L.pull[0]);
  let reach = Math.hypot(L.pull[0], L.pull[1]);
  angle += Input.axis("up", "down") * 1.5 * dt;
  reach += Input.axis("left", "right") * PLAY.REACH * dt;
  reach = Math.max(10, Math.min(PLAY.REACH, reach));
  L.pull = [Math.cos(angle) * reach, Math.sin(angle) * reach];
}

// The speed a shot leaves with: the opposite way to the pull, harder the
// further back it went.
function launchSpeed(pull) {
  let vx = -pull[0] * PLAY.PULL;
  let vy = -pull[1] * PLAY.PULL;
  const speed = Math.hypot(vx, vy);
  if (speed > PLAY.MAX_SPEED) {
    vx *= PLAY.MAX_SPEED / speed;
    vy *= PLAY.MAX_SPEED / speed;
  }
  return [vx, vy];
}

function fire() {
  const L = Level;
  if (L.shot || L.shotsLeft <= 0) return;
  const [vx, vy] = launchSpeed(L.pull);
  L.shot = Physics.add({ kind: "shot", at: SLING.at, size: PLAY.SHOT_SIZE, weight: PLAY.SHOT_WEIGHT });
  Physics.fling(L.shot, vx, vy);
  L.shotsLeft -= 1;
  L.waited = 0;
  Sound.play("fling", 0.5);
  Moments.say("shot", PLAY.SHOTS - L.shotsLeft);
}

function endShot() {
  const L = Level;
  Physics.remove(L.shot);
  L.shot = null;
  if (targets().length === 0) finish(true);
  else if (L.shotsLeft <= 0) finish(false);
}

// The pointer, in the game's own 960 × 600 whatever size the canvas is drawn.
function worldPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) * (LOOK.WIDTH / rect.width),
    (e.clientY - rect.top) * (LOOK.HEIGHT / rect.height),
  ];
}

// Press anywhere and the band comes to the finger, so a small screen never
// needs a precise first touch; let go to fire.
function pullTo(e) {
  const [x, y] = worldPoint(e);
  let dx = x - SLING.at[0];
  let dy = y - SLING.at[1];
  const reach = Math.hypot(dx, dy);
  if (reach > PLAY.REACH) {
    dx *= PLAY.REACH / reach;
    dy *= PLAY.REACH / reach;
  }
  Level.pull = [dx, dy];
}

canvas.addEventListener("pointerdown", (e) => {
  if (!playing || Level.shot) return;
  Level.pulling = true;
  canvas.setPointerCapture(e.pointerId);
  pullTo(e);
});
canvas.addEventListener("pointermove", (e) => {
  if (Level?.pulling) pullTo(e);
});
canvas.addEventListener("pointerup", () => {
  if (!Level?.pulling) return;
  Level.pulling = false;
  // A tap is not a shot: the band has to have gone back a little.
  if (Math.hypot(Level.pull[0], Level.pull[1]) > 12) fire();
});
canvas.addEventListener("pointercancel", () => { if (Level) Level.pulling = false; });

// ---------- what the player sees around the game ----------

// The whole strip, every frame. Screens.chips builds it once and touches only
// what changed, so saying all of it every time costs nothing.
function updateHud() {
  const chips = {};
  chips[WORDS.hudShots] = Level.shotsLeft;
  chips[WORDS.hudTargets] = targets().length;
  chips[WORDS.hudScore] = Level.score;
  Screens.chips(chips, { hint: true });
}

function startGame() {
  Level = newLevel();
  playing = true;
  updateHud();
}

// Both screens are Screens.title, and the score is the difference between
// them. `post` puts the level on the scoreboard and `board` shows the top ten
// with your place in it.
function finish(cleared) {
  const L = Level;
  playing = false;
  L.over = true;
  const used = PLAY.SHOTS - L.shotsLeft;
  if (cleared) {
    L.score += L.shotsLeft * PLAY.SHOT_POINTS;
    Moments.say("cleared", used);
  }
  Moments.say("score", L.score);
  Screens.chips({});
  Screens.title({
    name: cleared ? WORDS.cleared : WORDS.missed,
    tagline: cleared
      ? WORDS.clearedHow.replace("{shots}", used)
      : WORDS.missedHow.replace("{left}", targets().length),
    score: L.score,
    post: true,
    board: true,
    start: WORDS.again,
    onStart: startGame,
  });
}

// ---------- drawing ----------

// A target is assets/sprites/target.png the moment somebody draws one, and a
// round face in the game's colour until then.
const targetPicture = new Image();
let hasTargetPicture = false;
targetPicture.onload = () => { hasTargetPicture = true; };
targetPicture.src = "assets/sprites/target.png";

function draw() {
  ctx.fillStyle = LOOK.SKY;
  ctx.fillRect(0, 0, LOOK.WIDTH, LOOK.HEIGHT);
  if (!Level) {
    // Before the first game: the world as config/bodies.js has it.
    for (const b of BODIES) drawBody(Object.assign({ x: b.at[0], y: b.at[1], angle: (b.angle || 0) * Math.PI / 180 }, sizeOf(b), { kind: b.kind }));
    drawSling(null);
    return;
  }
  for (const b of Physics.all()) drawBody(b);
  drawSling(Level.shot ? null : Level.pull);
}

const sizeOf = (b) => (typeof b.size === "number" ? { r: b.size } : { w: b.size[0], h: b.size[1] });

function drawBody(b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  if (b.r) {
    if (b.kind === "target") drawTarget(b.r);
    else {
      ctx.fillStyle = b.kind === "shot" ? LOOK.SHOT : LOOK.BALL;
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const stone = b.kind === "block";
    ctx.fillStyle = stone ? LOOK.BLOCK : LOOK.BOX;
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.strokeStyle = stone ? LOOK.BLOCK_EDGE : LOOK.BOX_EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(-b.w / 2 + 1, -b.h / 2 + 1, b.w - 2, b.h - 2);
  }
  ctx.restore();
}

function drawTarget(r) {
  if (hasTargetPicture) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(targetPicture, -r, -r, r * 2, r * 2);
    return;
  }
  ctx.fillStyle = LOOK.TARGET;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = LOOK.TARGET_EYES;
  ctx.beginPath();
  ctx.arc(-r * 0.35, -r * 0.2, r * 0.16, 0, Math.PI * 2);
  ctx.arc(r * 0.35, -r * 0.2, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

// The sling: two posts and, while a shot is waiting, the band and the shot
// pulled back in it, with dots for where it starts to go.
function drawSling(pull) {
  const [sx, sy] = SLING.at;
  ctx.strokeStyle = LOOK.BOX_EDGE;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy + 70);
  ctx.lineTo(sx, sy + 18);
  ctx.moveTo(sx, sy + 18);
  ctx.lineTo(sx - 14, sy - 4);
  ctx.moveTo(sx, sy + 18);
  ctx.lineTo(sx + 14, sy - 4);
  ctx.stroke();
  if (!pull || !playing || Level.shotsLeft <= 0) return;
  const [px, py] = [sx + pull[0], sy + pull[1]];
  ctx.strokeStyle = LOOK.BAND;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx - 14, sy - 4);
  ctx.lineTo(px, py);
  ctx.lineTo(sx + 14, sy - 4);
  ctx.stroke();
  ctx.fillStyle = LOOK.SHOT;
  ctx.beginPath();
  ctx.arc(px, py, PLAY.SHOT_SIZE, 0, Math.PI * 2);
  ctx.fill();
  // Where it goes for the first moment: the same fall the physics uses.
  const [vx, vy] = launchSpeed(pull);
  ctx.fillStyle = LOOK.accent;
  for (let i = 1; i <= PLAY.AIM_DOTS; i += 1) {
    const t = i * 0.06;
    ctx.beginPath();
    ctx.arc(sx + vx * t, sy + vy * t + 0.5 * PLAY.GRAVITY * t * t, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- boot ----------

// How much of the window the game may have, worked out from the canvas's own
// 960 × 600 against the window's width *and* height. ⚠️ It writes the size
// inline, which is why css/style.css says nothing about how wide #wrap is.
Screens.fit(document.getElementById("wrap"));

Screens.title({ start: WORDS.start, onStart: startGame });
requestAnimationFrame(loop);
