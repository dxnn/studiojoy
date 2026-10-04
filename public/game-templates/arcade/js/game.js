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

// Everything that is true about the run happening right now, kept in State
// (studio/state.js) — which is what lets the studio's preview pin a moment
// and come back to it. A new run is State.reset(newRun()), so there is no
// reset() of the game's own to keep in step, and the code reaches through
// State every time rather than keeping a piece of it in a variable.
function newRun() {
  return {
    playing: false,  // a run is going, rather than a title screen
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
    stars: newStars(),
  };
}

// The sky behind a run, drifted every frame.
function newStars() {
  const stars = [];
  for (let i = 0; i < 90; i += 1) {
    stars.push({
      x: Math.random() * LOOK.WIDTH,
      y: Math.random() * LOOK.HEIGHT,
      size: Math.random() < 0.85 ? 1 : 2,
      drift: 6 + Math.random() * 22,
    });
  }
  return stars;
}

State.reset(newRun());

// Not the run's: when the last frame was drawn, and the title or game-over
// screen while one is up.
let last = 0;
let screen = null;

// Back to a pinned moment in the middle of a run: the screen that was up when
// it was put back goes, and the run carries on from there.
State.loaded(function () {
  if (!State.playing) return;
  if (screen) { screen.close(); screen = null; }
  updateHud();
});

// ---------- the loop ----------

function loop(now) {
  // Seconds since the last frame, capped: a tab left in the background comes
  // back with a gap of minutes in it, and without the cap everything teleports.
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  // ⚠️ First line of every frame, before anything asks what is held.
  Input.update();

  if (State.playing) step(dt);
  draw();
  requestAnimationFrame(loop);
}

function step(dt) {
  const ship = State.ship;

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
  State.cooldown -= dt;
  if (Input.held("fire") && State.cooldown <= 0) {
    State.cooldown = PLAY.BOLT_GAP;
    State.bolts.push({ x: ship.x, y: ship.y - 16 });
    Sound.play("shoot", 0.4);
  }

  for (const bolt of State.bolts) bolt.y -= PLAY.BOLT_SPEED * dt;
  State.bolts = State.bolts.filter((b) => b.y > -20);

  // Meteors arrive on a clock that speeds up with the level.
  State.nextRock -= dt;
  if (State.nextRock <= 0) {
    State.nextRock = Math.max(
      PLAY.ROCK_GAP_LEAST,
      PLAY.ROCK_GAP - (State.level - 1) * 0.12,
    );
    State.rocks.push({
      x: 40 + Math.random() * (LOOK.WIDTH - 80),
      y: -PLAY.ROCK_SIZE,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 2,
    });
  }

  const fall = PLAY.ROCK_SPEED + (State.level - 1) * PLAY.ROCK_SPEED_PER_LEVEL;
  for (const rock of State.rocks) {
    rock.y += fall * dt;
    rock.spin += rock.turn * dt;
  }

  hits();

  if (State.shield > 0) State.shield -= dt;

  for (const spark of State.sparks) {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.life -= dt;
  }
  State.sparks = State.sparks.filter((s) => s.life > 0);

  // A meteor that reaches the floor costs you, the same as one that lands on
  // you: the line is what you are holding.
  const passed = State.rocks.filter((r) => r.y > LOOK.HEIGHT);
  State.rocks = State.rocks.filter((r) => r.y <= LOOK.HEIGHT);
  for (let i = 0; i < passed.length; i += 1) hurt();

  updateHud();
}

// What touched what. Bolts break meteors; meteors break you.
function hits() {
  const ship = State.ship;
  const half = PLAY.ROCK_SIZE / 2;

  for (const rock of State.rocks) {
    if (rock.gone) continue;
    for (const bolt of State.bolts) {
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
  State.rocks = State.rocks.filter((r) => !r.gone);
  State.bolts = State.bolts.filter((b) => !b.gone);
}

function breakRock(rock) {
  State.score += PLAY.ROCK_POINTS;
  State.broken += 1;
  State.sinceLevel += 1;
  spark(rock.x, rock.y);
  Sound.play("break", 0.5);
  // ⚠️ On the line where it happens, not in a batch at the end.
  Moments.say("rock-broken");

  if (PLAY.CHARGE_FULL > 0 && State.shield <= 0 && State.charge < PLAY.CHARGE_FULL) {
    State.charge += 1;
    if (State.charge >= PLAY.CHARGE_FULL) {
      State.charge = PLAY.CHARGE_FULL;
      State.shield = PLAY.SHIELD_SECONDS;
      Sound.play("shield", 0.5);
    }
  }

  if (State.sinceLevel >= PLAY.LEVEL_EVERY) {
    State.sinceLevel = 0;
    State.level += 1;
    State.score += PLAY.LEVEL_POINTS;
    Moments.say("level", State.level);
  }
}

// A hit. The shield spends itself first, and the run ends when the lives do.
function hurt() {
  if (State.over) return;
  if (State.shield > 0) {
    State.shield = 0;
    State.charge = 0;
    Sound.play("shield-gone", 0.5);
    Moments.say("shield-saved");
    return;
  }
  State.lives -= 1;
  Sound.play("hurt", 0.6);
  if (State.lives <= 0) endRun();
}

function spark(x, y) {
  for (let i = 0; i < 10; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 180;
    State.sparks.push({
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
  chips[WORDS.hudScore] = Math.round(State.score);
  chips[WORDS.hudLives] = State.lives;
  chips[WORDS.hudLevel] = State.level;
  if (PLAY.CHARGE_FULL > 0) {
    chips[WORDS.hudCharge] = State.shield > 0
      ? { value: 1, max: 1, text: WORDS.shieldUp }
      : { value: State.charge, max: PLAY.CHARGE_FULL, text: State.charge + "/" + PLAY.CHARGE_FULL };
  }
  Screens.chips(chips, { hint: true });
}

// Both screens are this one call, and the score is the difference between
// them. `post` puts the run on the scoreboard and `board` shows the top ten
// with your place in it.
function titleScreen(score) {
  State.playing = false;
  Screens.chips({});
  screen = Screens.title({
    score,
    post: score !== undefined,
    board: true,
    onStart: startRun,
  });
}

function startRun() {
  screen = null;
  State.reset(newRun());
  State.playing = true;
  updateHud();
}

function endRun() {
  State.over = true;
  State.playing = false;
  Moments.say("run-over", Math.round(State.score));
  titleScreen(Math.round(State.score));
}

// ---------- drawing ----------

function draw() {
  ctx.fillStyle = LOOK.BG;
  ctx.fillRect(0, 0, LOOK.WIDTH, LOOK.HEIGHT);

  ctx.fillStyle = LOOK.STAR;
  for (const star of State.stars) {
    star.y += star.drift * 0.016;
    if (star.y > LOOK.HEIGHT) star.y = 0;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }

  for (const rock of State.rocks) drawRock(rock);

  ctx.fillStyle = LOOK.BOLT;
  for (const bolt of State.bolts) ctx.fillRect(bolt.x - 2, bolt.y - 10, 4, 14);

  for (const spark of State.sparks) {
    ctx.globalAlpha = Math.max(0, spark.life * 2);
    ctx.fillStyle = LOOK.SPARK;
    ctx.fillRect(spark.x - 2, spark.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  drawShip();
}

function drawShip() {
  const { x, y } = State.ship;

  if (Input.held("thrust") && State.playing) {
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

  if (State.shield > 0) {
    ctx.strokeStyle = LOOK.SHIELD;
    // The last second of it flashes, so nobody is surprised by losing it.
    ctx.globalAlpha = State.shield < 1 ? 0.3 + Math.abs(Math.sin(State.shield * 12)) * 0.5 : 0.8;
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
