// Lap Racer — the whole game.
//
// It is one loop, and the loop is always the same four lines: ask the input
// library what is being held, move everything by how long the frame took,
// draw it, ask for the next frame. Everything around the game — the title
// screen, the finish screen and the scoreboard on it, the HUD strip, and how
// much of the window the canvas gets — belongs to the studio libraries, so
// none of it is in here.
//
// The track is config/track.js, drawn in the studio's track editor; the feel
// is config/play.js, the colours config/look.js, the words config/words.js.
// Change those first; come in here when you want the race to do something
// new.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- the road ----------

// The road is the closed line through TRACK.points, stroked TRACK.width wide.
// Everything about "where on the track am I" is one question — how far along
// that line is the nearest point — so the line is measured once: each
// segment's length, and how far round the loop it starts.
const Road = (function () {
  const pts = TRACK.points;
  const n = pts.length;
  const segs = [];
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    segs.push({ ax, ay, bx, by, len, from: total, ux: (bx - ax) / len, uy: (by - ay) / len });
    total += len;
  }
  const half = TRACK.width / 2;

  // The nearest point on the road to (x, y): how far off the road it is, how
  // far round the loop it sits, and the segment it is on.
  function nearest(x, y) {
    let best = null;
    for (const s of segs) {
      const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
      const px = s.ax + s.ux * t;
      const py = s.ay + s.uy * t;
      const dist = Math.hypot(x - px, y - py);
      if (!best || dist < best.dist) best = { dist, along: s.from + t, seg: s, px, py };
    }
    return best;
  }

  // The point `along` pixels round the loop, and the road's direction there.
  function at(along) {
    let a = along % total;
    if (a < 0) a += total;
    let s = segs[segs.length - 1];
    for (const seg of segs) if (a >= seg.from && a < seg.from + seg.len) { s = seg; break; }
    const t = a - s.from;
    return { x: s.ax + s.ux * t, y: s.ay + s.uy * t, angle: Math.atan2(s.uy, s.ux), nx: -s.uy, ny: s.ux };
  }

  const start = segs[Math.min(Math.max(0, TRACK.start | 0), n - 1)].from;
  return { segs, total, half, nearest, at, start };
}());

// The road is the same every frame, so it is drawn once to its own canvas and
// copied in — the cheapest thing a phone can do with a big picture.
const roadPicture = document.createElement("canvas");
roadPicture.width = LOOK.WIDTH;
roadPicture.height = LOOK.HEIGHT;
(function drawRoadOnce() {
  const g = roadPicture.getContext("2d");
  g.fillStyle = LOOK.GRASS;
  g.fillRect(0, 0, LOOK.WIDTH, LOOK.HEIGHT);
  const trace = () => {
    g.beginPath();
    TRACK.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  g.lineJoin = "round";
  g.lineCap = "round";
  trace();
  g.strokeStyle = LOOK.EDGE;
  g.lineWidth = TRACK.width + 10;
  g.stroke();
  trace();
  g.strokeStyle = LOOK.ROAD;
  g.lineWidth = TRACK.width;
  g.stroke();
  trace();
  g.strokeStyle = LOOK.LINE;
  g.lineWidth = 3;
  g.setLineDash([18, 22]);
  g.stroke();
  g.setLineDash([]);
  // The start line: a checkered band across the road at the start point.
  const p = Road.at(Road.start);
  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.angle);
  const s = 12;
  for (let j = -Road.half; j < Road.half; j += s) {
    for (let i = 0; i < 2; i += 1) {
      g.fillStyle = ((Math.floor((j + Road.half) / s) + i) % 2) ? LOOK.START_B : LOOK.START_A;
      g.fillRect(i * s, j, s, Math.min(s, Road.half - j));
    }
  }
  g.restore();
}());

// ---------- the race ----------

// Everything that is true about the race happening right now. A new race is
// this object built again, which is why there is no reset() to keep in step.
function newRace() {
  const p = Road.at(Road.start - 30);
  const rivals = [];
  for (let i = 0; i < Math.min(6, PLAY.RIVALS); i += 1) {
    rivals.push({
      along: Road.start - 70 - i * 34, // grid rows behind the line
      lane: (i % 2 ? 1 : -1) * Road.half * 0.45,
      phase: Math.random() * Math.PI * 2,
      slow: 0, // seconds left of being bumped
      colour: LOOK.RIVALS[i % LOOK.RIVALS.length],
    });
  }
  return {
    car: { x: p.x + p.nx * Road.half * -0.45, y: p.y + p.ny * Road.half * -0.45, angle: p.angle, speed: 0 },
    lap: 0,
    progress: 0, // how far past the start line, 0 to Road.total
    rivals,
    countdown: PLAY.COUNTDOWN,
    time: 0,
    shake: 0,
    over: false,
    pads: THINGS.map(() => 0), // a boost pad's cooldown, so it shoves once
  };
}

let Race = newRace();
let racing = false;
let last = 0;
let engineOn = false;

// ---------- the loop ----------

function loop(now) {
  // Seconds since the last frame, capped: a tab left in the background comes
  // back with a gap of minutes in it, and without the cap everything teleports.
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  // ⚠️ First line of every frame, before anything asks what is held.
  Input.update();

  if (racing) step(dt);
  draw();
  requestAnimationFrame(loop);
}

function step(dt) {
  const r = Race;
  if (r.countdown > 0) {
    r.countdown -= dt;
    if (r.countdown <= 0) Sound.play("lap", 0.5);
    updateHud();
    return;
  }
  r.time += dt;
  const car = r.car;

  // Steering and the accelerator. The names are the game's own words, from
  // config/controls.js. The boost button latches on a touchscreen — tap it on,
  // tap it off — so held() is the right question for it either way.
  const boosting = Input.held("boost");
  const going = Input.held("go");
  car.angle += Input.axis("left", "right") * PLAY.TURN * dt * Math.min(1, 0.35 + car.speed / PLAY.TOP);
  if (going) car.speed += (PLAY.THRUST + (boosting ? PLAY.BOOST_PUSH : 0)) * dt;
  car.speed -= car.speed * PLAY.DRAG * dt;
  car.speed = Math.max(0, Math.min(boosting ? PLAY.BOOST_TOP : Math.max(car.speed - PLAY.THRUST * dt, PLAY.TOP), car.speed));
  if (going !== engineOn) {
    engineOn = going;
    if (going) Sound.loop("engine", 0.25);
    else Sound.stop("engine");
  }

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.x = Math.max(8, Math.min(LOOK.WIDTH - 8, car.x));
  car.y = Math.max(8, Math.min(LOOK.HEIGHT - 8, car.y));

  // Where on the track we are, and whether we just crossed the line — going
  // the right way round counts a lap, going backwards over it uncounts one.
  const near = Road.nearest(car.x, car.y);
  const progress = ((near.along - Road.start) % Road.total + Road.total) % Road.total;
  const quarter = Road.total / 4;
  if (r.progress > 3 * quarter && progress < quarter) {
    r.lap += 1;
    Sound.play("lap", 0.5);
    Moments.say("lap", r.lap);
    if (r.lap >= PLAY.LAPS) { finish(); return; }
  } else if (r.progress < quarter && progress > 3 * quarter && r.lap > 0) {
    r.lap -= 1;
  }
  r.progress = progress;

  // Off the road is grass, and grass is slow.
  if (near.dist > Road.half) car.speed *= Math.max(0, 1 - PLAY.OFF_ROAD * dt);

  // What is on the road: rocks bash, pads shove, puddles drag.
  THINGS.forEach((thing, i) => {
    const dx = car.x - thing.at[0];
    const dy = car.y - thing.at[1];
    const d = Math.hypot(dx, dy) || 1;
    if (thing.kind === "rock") {
      const reach = thing.size + 12;
      if (d < reach) {
        car.x = thing.at[0] + dx / d * reach;
        car.y = thing.at[1] + dy / d * reach;
        car.speed *= PLAY.BUMP;
        r.shake = 10;
        Sound.play("bash", 0.6);
        Moments.say("bash");
      }
    } else if (thing.kind === "boost") {
      r.pads[i] -= dt;
      if (d < thing.size && r.pads[i] <= 0) {
        r.pads[i] = 1;
        car.speed = Math.min(PLAY.BOOST_TOP, Math.max(car.speed, PLAY.TOP * 0.6) * PLAY.PAD_PUSH);
        Sound.play("boost", 0.5);
        Moments.say("boost");
      }
    } else if (thing.kind === "puddle") {
      if (d < thing.size) car.speed *= Math.max(0, 1 - PLAY.PUDDLE * dt);
    }
  });

  // The rivals follow the middle of the road, each in its lane, wandering a
  // little in speed — and rubber-banding, so a race stays a race: one far
  // ahead eases off, one far behind pushes harder.
  const mine = r.lap * Road.total + progress;
  for (const rival of r.rivals) {
    if (rival.slow > 0) { rival.slow -= dt; continue; }
    const theirs = rival.along - Road.start + 70;
    const gap = (theirs - mine) / Road.total;
    const rubber = gap > 0.12 ? 0.9 : gap < -0.12 ? 1.12 : 1;
    const wobble = 1 + PLAY.RIVAL_WOBBLE * Math.sin(r.time * 1.3 + rival.phase);
    rival.along += PLAY.RIVAL_SPEED * wobble * rubber * dt;
    // A bump: both lose a little, nobody vanishes.
    const p = rivalPos(rival);
    if (Math.hypot(car.x - p.x, car.y - p.y) < 22) {
      car.speed *= 0.5;
      rival.slow = 0.6;
      r.shake = 6;
      Sound.play("bash", 0.3);
    }
  }

  if (r.shake > 0) r.shake = Math.max(0, r.shake - 40 * dt);
  updateHud();
}

// Where a rival is right now: on the road, in its lane.
function rivalPos(rival) {
  const p = Road.at(rival.along);
  return { x: p.x + p.nx * rival.lane, y: p.y + p.ny * rival.lane, angle: p.angle };
}

// Your place: one, plus every rival further round than you.
function placeNow() {
  const mine = Race.lap * Road.total + Race.progress;
  return 1 + Race.rivals.filter((rv) => rv.along - Road.start + 70 > mine).length;
}

// ---------- what the player sees around the game ----------

// The whole strip, every frame. Screens.chips builds it once and touches only
// what changed, so saying all of it every time costs nothing.
function updateHud() {
  const chips = {};
  chips[WORDS.hudLap] = Math.min(Race.lap + 1, PLAY.LAPS) + "/" + PLAY.LAPS;
  chips[WORDS.hudPlace] = placeNow() + "/" + (Race.rivals.length + 1);
  chips[WORDS.hudTime] = Race.time.toFixed(1);
  Screens.chips(chips, { hint: true });
}

function startRace() {
  Race = newRace();
  racing = true;
  updateHud();
}

// Both screens are Screens.title, and the score is the difference between
// them. `post` puts the race on the scoreboard and `board` shows the top ten
// with your place in it. Bigger is better on the board, so the score is time
// under par plus points for every rival beaten.
function finish() {
  const r = Race;
  r.over = true;
  racing = false;
  if (engineOn) { engineOn = false; Sound.stop("engine"); }
  const place = placeNow();
  const time = Math.round(r.time * 10) / 10;
  const score = Math.max(0, Math.round((PLAY.PAR - time) * 10)) + (r.rivals.length + 1 - place) * PLAY.PLACE_POINTS;
  Moments.say("finished", time);
  Moments.say("place", place);
  Moments.say("score", score);
  Screens.chips({});
  Screens.title({
    name: place === 1 ? WORDS.first : WORDS.placed.replace("{place}", PLACES[place] || place + "th"),
    tagline: WORDS.finished.replace("{time}", time),
    score,
    post: true,
    board: true,
    start: WORDS.again,
    onStart: startRace,
  });
}

// ---------- drawing ----------

// Your car is assets/sprites/car.png the moment somebody draws one, and a
// triangle in the game's colour until then.
const carPicture = new Image();
let hasCarPicture = false;
carPicture.onload = () => { hasCarPicture = true; };
carPicture.src = "assets/sprites/car.png";

function draw() {
  ctx.save();
  if (Race.shake > 0.5) {
    ctx.translate((Math.random() - 0.5) * Race.shake, (Math.random() - 0.5) * Race.shake);
  }
  ctx.drawImage(roadPicture, 0, 0);
  for (const thing of THINGS) drawThing(thing);
  for (const rival of Race.rivals) {
    const p = rivalPos(rival);
    drawCar(p.x, p.y, p.angle, rival.colour, false);
  }
  drawCar(Race.car.x, Race.car.y, Race.car.angle, LOOK.CAR, true);
  ctx.restore();

  // The countdown, big and in the middle: a number, so it wears the highlight.
  if (racing && Race.countdown > 0) {
    ctx.fillStyle = LOOK.highlight;
    ctx.font = "bold 96px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.ceil(Race.countdown)), LOOK.WIDTH / 2, LOOK.HEIGHT / 2);
  } else if (racing && Race.time < 0.8) {
    ctx.fillStyle = LOOK.primary;
    ctx.globalAlpha = 1 - Race.time / 0.8;
    ctx.font = "bold 96px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(WORDS.go, LOOK.WIDTH / 2, LOOK.HEIGHT / 2);
    ctx.globalAlpha = 1;
  }
}

function drawCar(x, y, angle, colour, mine) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (mine && hasCarPicture) {
    const w = carPicture.width;
    const h = carPicture.height;
    const scale = 32 / Math.max(w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(carPicture, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
  } else {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-11, -9);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-11, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = LOOK.EDGE;
    ctx.beginPath();
    ctx.arc(3, 0, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawThing(thing) {
  const [x, y] = thing.at;
  const r = thing.size;
  if (thing.kind === "rock") {
    ctx.beginPath();
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      const edge = r * (0.75 + ((i * 37) % 10) / 40);
      ctx.lineTo(x + Math.cos(a) * edge, y + Math.sin(a) * edge);
    }
    ctx.closePath();
    ctx.fillStyle = LOOK.ROCK;
    ctx.fill();
    ctx.strokeStyle = LOOK.ROCK_EDGE;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (thing.kind === "boost") {
    ctx.strokeStyle = LOOK.BOOST;
    ctx.lineWidth = 4;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x - r * 0.5 + i * r * 0.45, y - r * 0.5);
      ctx.lineTo(x + i * r * 0.45, y);
      ctx.lineTo(x - r * 0.5 + i * r * 0.45, y + r * 0.5);
      ctx.stroke();
    }
  } else if (thing.kind === "puddle") {
    ctx.fillStyle = LOOK.PUDDLE;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------- boot ----------

// How much of the window the game may have, worked out from the canvas's own
// 960 × 600 against the window's width *and* height. ⚠️ It writes the size
// inline, which is why css/style.css says nothing about how wide #wrap is.
Screens.fit(document.getElementById("wrap"));

Screens.title({ start: WORDS.start, onStart: startRace });
requestAnimationFrame(loop);
