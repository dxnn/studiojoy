// Meteor Run — the whole game.
//
// It is one loop, and the loop is always the same four lines: ask the input
// library what is being held, move everything by how long the frame took,
// draw it, ask for the next frame. Everything around the game — the title
// screen, the game-over screen and the scoreboard on it, the HUD strip, and
// how much of the window the canvas gets — belongs to the studio libraries,
// so none of it is in here.
//
// The numbers all live in config/play.js and config/look.js, the words in
// config/words.js. Change those first; come in here when you want the game to
// do something new.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- the run ----------

// Everything that is true about the run happening right now. A new run is
// this object built again, which is why there is no reset() to keep in step.
function newRun() {
  return {
    score: 0,
    lives: PLAY.LIVES,
    level: 1,
    broken: 0,       // meteors broken, all run
    sinceLevel: 0,   // and since the last level
    charge: 0,       // fills to PLAY.CHARGE_FULL, then becomes the shield
    shield: 0,       // seconds of bubble left
    ship: { x: LOOK.WIDTH / 2, y: LOOK.HEIGHT - PLAY.FLOOR, lift: 0 },
    cooldown: 0,
    bolts: [],
    rocks: [],
    sparks: [],
    nextRock: 1,
    over: false,
  };
}

let Run = newRun();
let playing = false;
let last = 0;

// The stars are the same every run: made once, drifted every frame.
const Stars = [];
for (let i = 0; i < 90; i += 1) {
  Stars.push({
    x: Math.random() * LOOK.WIDTH,
    y: Math.random() * LOOK.HEIGHT,
    size: Math.random() < 0.85 ? 1 : 2,
    drift: 6 + Math.random() * 22,
  });
}

// ---------- the loop ----------

function loop(now) {
  // Seconds since the last frame, capped: a tab left in the background comes
  // back with a gap of minutes in it, and without the cap everything teleports.
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  // ⚠️ First line of every frame, before anything asks what is held.
  Input.update();

  if (playing) step(dt);
  draw();
  requestAnimationFrame(loop);
}

function step(dt) {
  const ship = Run.ship;

  // Left and right slide you along; thrust lifts you and gravity takes it
  // back. The names are the game's own words, from config/controls.js.
  if (Input.held("left")) ship.x -= PLAY.SHIP_SPEED * dt;
  if (Input.held("right")) ship.x += PLAY.SHIP_SPEED * dt;
  ship.x = Math.max(24, Math.min(LOOK.WIDTH - 24, ship.x));

  ship.lift += (Input.held("thrust") ? -PLAY.THRUST : 0) * dt + PLAY.GRAVITY * dt;
  ship.y += ship.lift * dt;
  const floor = LOOK.HEIGHT - PLAY.FLOOR;
  if (ship.y > floor) { ship.y = floor; ship.lift = 0; }
  if (ship.y < 40) { ship.y = 40; ship.lift = 0; }

  // Firing. The button latches on a touchscreen — tap it on, tap it off — so
  // held() is the right question for it either way.
  Run.cooldown -= dt;
  if (Input.held("fire") && Run.cooldown <= 0) {
    Run.cooldown = PLAY.BOLT_GAP;
    Run.bolts.push({ x: ship.x, y: ship.y - 16 });
    Sound.play("shoot", 0.4);
  }

  for (const bolt of Run.bolts) bolt.y -= PLAY.BOLT_SPEED * dt;
  Run.bolts = Run.bolts.filter((b) => b.y > -20);

  // Meteors arrive on a clock that speeds up with the level.
  Run.nextRock -= dt;
  if (Run.nextRock <= 0) {
    Run.nextRock = Math.max(
      PLAY.ROCK_GAP_LEAST,
      PLAY.ROCK_GAP - (Run.level - 1) * 0.12,
    );
    Run.rocks.push({
      x: 40 + Math.random() * (LOOK.WIDTH - 80),
      y: -PLAY.ROCK_SIZE,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 2,
    });
  }

  const fall = PLAY.ROCK_SPEED + (Run.level - 1) * PLAY.ROCK_SPEED_PER_LEVEL;
  for (const rock of Run.rocks) {
    rock.y += fall * dt;
    rock.spin += rock.turn * dt;
  }

  hits();

  if (Run.shield > 0) Run.shield -= dt;

  for (const spark of Run.sparks) {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.life -= dt;
  }
  Run.sparks = Run.sparks.filter((s) => s.life > 0);

  // A meteor that reaches the floor costs you, the same as one that lands on
  // you: the line is what you are holding.
  const passed = Run.rocks.filter((r) => r.y > LOOK.HEIGHT);
  Run.rocks = Run.rocks.filter((r) => r.y <= LOOK.HEIGHT);
  for (let i = 0; i < passed.length; i += 1) hurt();

  updateHud();
}

// What touched what. Bolts break meteors; meteors break you.
function hits() {
  const ship = Run.ship;
  const half = PLAY.ROCK_SIZE / 2;

  for (const rock of Run.rocks) {
    if (rock.gone) continue;
    for (const bolt of Run.bolts) {
      if (bolt.gone) continue;
      if (Math.abs(bolt.x - rock.x) < half && Math.abs(bolt.y - rock.y) < half) {
        rock.gone = true;
        bolt.gone = true;
        breakRock(rock);
        break;
      }
    }
    if (rock.gone) continue;
    if (Math.abs(ship.x - rock.x) < half + 8 && Math.abs(ship.y - rock.y) < half + 8) {
      rock.gone = true;
      spark(rock.x, rock.y);
      hurt();
    }
  }
  Run.rocks = Run.rocks.filter((r) => !r.gone);
  Run.bolts = Run.bolts.filter((b) => !b.gone);
}

function breakRock(rock) {
  Run.score += PLAY.ROCK_POINTS;
  Run.broken += 1;
  Run.sinceLevel += 1;
  spark(rock.x, rock.y);
  Sound.play("break", 0.5);
  // ⚠️ On the line where it happens, not in a batch at the end.
  Moments.say("rock-broken");

  if (PLAY.CHARGE_FULL > 0 && Run.shield <= 0 && Run.charge < PLAY.CHARGE_FULL) {
    Run.charge += 1;
    if (Run.charge >= PLAY.CHARGE_FULL) {
      Run.charge = PLAY.CHARGE_FULL;
      Run.shield = PLAY.SHIELD_SECONDS;
      Sound.play("shield", 0.5);
    }
  }

  if (Run.sinceLevel >= PLAY.LEVEL_EVERY) {
    Run.sinceLevel = 0;
    Run.level += 1;
    Run.score += PLAY.LEVEL_POINTS;
    Moments.say("level", Run.level);
  }
}

// A hit. The shield spends itself first, and the run ends when the lives do.
function hurt() {
  if (Run.over) return;
  if (Run.shield > 0) {
    Run.shield = 0;
    Run.charge = 0;
    Sound.play("shield-gone", 0.5);
    Moments.say("shield-saved");
    return;
  }
  Run.lives -= 1;
  Sound.play("hurt", 0.6);
  if (Run.lives <= 0) endRun();
}

function spark(x, y) {
  for (let i = 0; i < 10; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 180;
    Run.sparks.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.3,
    });
  }
}

// ---------- what the player sees around the game ----------

// The whole strip, every frame. Screens.chips builds it once and touches only
// what changed, so saying all of it every time costs nothing — and the charge
// bar is a chip like the rest, not markup of this game's own.
function updateHud() {
  const chips = {};
  chips[WORDS.hudScore] = Math.round(Run.score);
  chips[WORDS.hudLives] = Run.lives;
  chips[WORDS.hudLevel] = Run.level;
  if (PLAY.CHARGE_FULL > 0) {
    chips[WORDS.hudCharge] = Run.shield > 0
      ? { value: 1, max: 1, text: WORDS.shieldUp }
      : { value: Run.charge, max: PLAY.CHARGE_FULL, text: Run.charge + "/" + PLAY.CHARGE_FULL };
  }
  Screens.chips(chips, { hint: true });
}

// Both screens are this one call, and the score is the difference between
// them. `post` puts the run on the scoreboard and `board` shows the top ten
// with your place in it.
function titleScreen(score) {
  playing = false;
  Screens.chips({});
  Screens.title({
    score,
    post: score !== undefined,
    board: true,
    onStart: startRun,
  });
}

function startRun() {
  Run = newRun();
  playing = true;
  updateHud();
}

function endRun() {
  Run.over = true;
  playing = false;
  Moments.say("run-over", Math.round(Run.score));
  titleScreen(Math.round(Run.score));
}

// ---------- drawing ----------

function draw() {
  ctx.fillStyle = LOOK.BG;
  ctx.fillRect(0, 0, LOOK.WIDTH, LOOK.HEIGHT);

  ctx.fillStyle = LOOK.STAR;
  for (const star of Stars) {
    star.y += star.drift * 0.016;
    if (star.y > LOOK.HEIGHT) star.y = 0;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }

  for (const rock of Run.rocks) drawRock(rock);

  ctx.fillStyle = LOOK.BOLT;
  for (const bolt of Run.bolts) ctx.fillRect(bolt.x - 2, bolt.y - 10, 4, 14);

  for (const spark of Run.sparks) {
    ctx.globalAlpha = Math.max(0, spark.life * 2);
    ctx.fillStyle = LOOK.SPARK;
    ctx.fillRect(spark.x - 2, spark.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  drawShip();
}

function drawShip() {
  const { x, y } = Run.ship;

  if (Input.held("thrust") && playing) {
    ctx.fillStyle = LOOK.FLAME;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 12);
    ctx.lineTo(x + 6, y + 12);
    ctx.lineTo(x, y + 22 + Math.random() * 8);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = LOOK.SHIP;
  ctx.beginPath();
  ctx.moveTo(x, y - 18);
  ctx.lineTo(x + 14, y + 12);
  ctx.lineTo(x, y + 5);
  ctx.lineTo(x - 14, y + 12);
  ctx.closePath();
  ctx.fill();

  if (Run.shield > 0) {
    ctx.strokeStyle = LOOK.SHIELD;
    // The last second of it flashes, so nobody is surprised by losing it.
    ctx.globalAlpha = Run.shield < 1 ? 0.3 + Math.abs(Math.sin(Run.shield * 12)) * 0.5 : 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawRock(rock) {
  const r = PLAY.ROCK_SIZE / 2;
  ctx.save();
  ctx.translate(rock.x, rock.y);
  ctx.rotate(rock.spin);
  ctx.beginPath();
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    const edge = r * (0.75 + ((i * 37) % 10) / 40);
    ctx.lineTo(Math.cos(angle) * edge, Math.sin(angle) * edge);
  }
  ctx.closePath();
  ctx.fillStyle = LOOK.ROCK_FILL;
  ctx.fill();
  ctx.strokeStyle = LOOK.ROCK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// ---------- boot ----------

// How much of the window the game may have, worked out from the canvas's own
// 960 × 600 against the window's width *and* height. ⚠️ It writes the size
// inline, which is why css/style.css says nothing about how wide #wrap is.
Screens.fit(document.getElementById("wrap"));

titleScreen();
requestAnimationFrame(loop);
