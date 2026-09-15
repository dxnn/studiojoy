// The track editor's model layer: config/track.js in, a plain model out, and
// back to file text again. Reading goes through the config reader — the file
// is never executed — and writing regenerates the whole file with the
// template's standard comments, the same bargain the story editor makes: it
// is the authoring surface for this one file. Anything the shape does not
// cover makes trackModel decline with a reason, and the file falls back to
// the generic config form, then to the text.
//
// It holds the geometry too — the closed road through the points, stroked
// as wide as `width` — because that is what the editor draws, what its
// pointer arithmetic asks (which handle, which segment, on the road or off
// it) and what only the whole track can say: the road crosses itself, a
// segment is shorter than the road is wide, a thing sits off the road where
// no car can meet it. That is trackChecks, and it is the reason this is an
// editor rather than a longer form. The game (js/race.js in the template)
// asks the same one question of the same line, so the two agree about what
// "on the road" means.

import { parseConfigFile } from './config-file.js';

export const TRACK_FILE = 'config/track.js';
export const isTrackPath = (p) => p === TRACK_FILE;

// The world the track is drawn in: the game's own canvas size.
export const WORLD = { width: 960, height: 600 };

// What can sit on the road, and how big one is when it is dropped there.
export const KINDS = ['rock', 'boost', 'puddle'];
export const SIZES = { rock: 22, boost: 30, puddle: 36 };
export const MIN_POINTS = 3;
export const MIN_WIDTH = 30;
export const MAX_WIDTH = 220;

const num = (node) => (node && node.kind === 'number' ? node.value : null);
const keysOf = (node) => node.props.map((p) => p.key).sort().join(',');
const propNode = (node, key) => node.props.find((p) => p.key === key)?.node;

// A place is two whole numbers.
const pairOf = (node) => {
  if (!node || node.kind !== 'array' || node.items.length !== 2) return null;
  const at = node.items.map(num);
  if (at.some((n) => n === null || !Number.isInteger(n))) return null;
  return at;
};

/* Reading ------------------------------------------------------------------ */

export function trackModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = {
    ok: false, reason: 'the file has grown past what the track editor understands',
  };
  if (parsed.decls.map((d) => d.name).join(',') !== 'TRACK,THINGS') return grown;
  const [trackNode, thingsNode] = parsed.decls.map((d) => d.node);
  if (trackNode.kind !== 'object' || thingsNode.kind !== 'array') return grown;
  if (keysOf(trackNode) !== 'points,start,width') return grown;

  const width = num(propNode(trackNode, 'width'));
  const start = num(propNode(trackNode, 'start'));
  const pointsNode = propNode(trackNode, 'points');
  if (width === null || width <= 0 || start === null || !Number.isInteger(start)) return grown;
  if (pointsNode.kind !== 'array') return grown;
  const points = pointsNode.items.map(pairOf);
  if (points.some((p) => p === null)) return grown;
  if (start < 0 || (points.length && start >= points.length)) return grown;

  const things = [];
  for (const item of thingsNode.items) {
    if (item.kind !== 'object' || keysOf(item) !== 'at,kind,size') return grown;
    const kindNode = propNode(item, 'kind');
    const kind = kindNode?.kind === 'string' ? kindNode.value : null;
    const at = pairOf(propNode(item, 'at'));
    const size = num(propNode(item, 'size'));
    if (!KINDS.includes(kind) || !at || size === null || size <= 0) return grown;
    things.push({ kind, at, size });
  }
  return {
    ok: true, width, points, start, things,
  };
}

/* Writing ------------------------------------------------------------------ */

const TRACK_NOTE = [
  '// The track: the points the road passes through, in order. The road closes',
  '// back to the first point on its own, and `width` is how wide it is. `start`',
  '// is which point the start line sits at. Draw it in the studio\'s track editor',
  '// rather than typing numbers: drag a point to move it, click on the road to',
  '// add one.',
];
const THINGS_NOTE = [
  '// What sits on the road: a rock to bash into, a boost pad that shoves you on,',
  '// a puddle that slows you down. Each has a kind, a place and a size, and',
  '// belongs on the road, where a car can meet it.',
];

export function trackText({
  width, points, start, things,
}) {
  const out = [...TRACK_NOTE, 'const TRACK = {', `  width: ${width},`, '  points: ['];
  for (const [x, y] of points) out.push(`    [${x}, ${y}],`);
  out.push('  ],', `  start: ${start},`, '};', '', ...THINGS_NOTE, 'const THINGS = [');
  for (const t of things) out.push(`  { kind: ${JSON.stringify(t.kind)}, at: [${t.at[0]}, ${t.at[1]}], size: ${t.size} },`);
  out.push('];', '');
  return out.join('\n');
}

/* Geometry ------------------------------------------------------------------ */

// The road's segments, closed: each from one point to the next, the last
// back to the first.
export function segments(points) {
  const n = points.length;
  const out = [];
  let from = 0;
  for (let i = 0; i < n; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay);
    out.push({
      i, ax, ay, bx, by, len, from,
    });
    from += len;
  }
  return out;
}

export const trackLength = (points) => segments(points).reduce((n, s) => n + s.len, 0);

// The nearest point on the road to (x, y): how far off the road it is, which
// segment it is on, how far along that segment, and how far round the loop.
export function nearestOnTrack(points, x, y) {
  let best = null;
  for (const s of segments(points)) {
    const len = s.len || 1;
    const ux = (s.bx - s.ax) / len;
    const uy = (s.by - s.ay) / len;
    const t = Math.max(0, Math.min(s.len, (x - s.ax) * ux + (y - s.ay) * uy));
    const px = s.ax + ux * t;
    const py = s.ay + uy * t;
    const dist = Math.hypot(x - px, y - py);
    if (!best || dist < best.dist) {
      best = {
        dist, seg: s.i, t, x: px, y: py, along: s.from + t,
      };
    }
  }
  return best;
}

// Whether two segments cross, endpoints not counting: the road's own joins
// are not crossings.
function cross(a, b) {
  const d = (x1, y1, x2, y2, x3, y3) => (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d1 = d(b.ax, b.ay, b.bx, b.by, a.ax, a.ay);
  const d2 = d(b.ax, b.ay, b.bx, b.by, a.bx, a.by);
  const d3 = d(a.ax, a.ay, a.bx, a.by, b.ax, b.ay);
  const d4 = d(a.ax, a.ay, a.bx, a.by, b.bx, b.by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Every pair of segments that cross, as [i, j] with i < j. Neighbours share a
// point and are skipped, the last and the first included.
export function crossings(points) {
  const segs = segments(points);
  const n = segs.length;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (cross(segs[i], segs[j])) out.push([i, j]);
    }
  }
  return out;
}

// Segments shorter than the road is wide, which draw as a kink.
export const shortSegments = (points, width) => segments(points)
  .filter((s) => s.len < width).map((s) => s.i);

// A thing is on the road when its middle is within half the width of the
// nearest segment — the game's own test, so the two agree.
export const onRoad = (thing, { points, width }) => (points.length >= 2
  ? nearestOnTrack(points, thing.at[0], thing.at[1]).dist <= width / 2
  : false);

/* Changing things ------------------------------------------------------------ */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const inWorld = (x, y) => [
  Math.round(clamp(x, 0, WORLD.width)), Math.round(clamp(y, 0, WORLD.height)),
];

export function movePoint(model, i, x, y) {
  if (i < 0 || i >= model.points.length) return;
  model.points[i] = inWorld(x, y);
}

// A new point on the road after segment `seg`, where somebody clicked, so
// the loop grows without changing where it goes anywhere else. The start
// keeps its point.
export function insertPoint(model, seg, x, y) {
  const at = clamp(seg + 1, 1, model.points.length);
  model.points.splice(at, 0, inWorld(x, y));
  if (model.start >= at) model.start += 1;
  return at;
}

// Never below three: two points is a line, not a loop.
export function removePoint(model, i) {
  if (model.points.length <= MIN_POINTS || i < 0 || i >= model.points.length) return false;
  model.points.splice(i, 1);
  if (model.start === i) model.start = 0;
  else if (model.start > i) model.start -= 1;
  return true;
}

export function setStart(model, i) {
  if (i >= 0 && i < model.points.length) model.start = i;
}

export function setWidth(model, width) {
  model.width = Math.round(clamp(Number(width) || MIN_WIDTH, MIN_WIDTH, MAX_WIDTH));
}

export function addThing(model, kind, x, y) {
  if (!KINDS.includes(kind)) return -1;
  model.things.push({ kind, at: inWorld(x, y), size: SIZES[kind] });
  return model.things.length - 1;
}

export function moveThing(model, i, x, y) {
  if (i < 0 || i >= model.things.length) return;
  model.things[i].at = inWorld(x, y);
}

export function removeThing(model, i) {
  if (i < 0 || i >= model.things.length) return;
  model.things.splice(i, 1);
}

/* Hit tests ------------------------------------------------------------------ */

// What is under a point in the world, for the editor's pointer: a handle, a
// thing, the road itself, or nothing. Handles first, so a point sitting on a
// thing is still the point; `reach` is how close counts, in world pixels.
export function hitAt(model, x, y, reach = 14) {
  let best = -1;
  let dist = reach;
  model.points.forEach(([px, py], i) => {
    const d = Math.hypot(x - px, y - py);
    if (d <= dist) { dist = d; best = i; }
  });
  if (best >= 0) return { kind: 'point', index: best };
  for (let i = model.things.length - 1; i >= 0; i -= 1) {
    const t = model.things[i];
    if (Math.hypot(x - t.at[0], y - t.at[1]) <= t.size) return { kind: 'thing', index: i };
  }
  if (model.points.length >= 2) {
    const near = nearestOnTrack(model.points, x, y);
    if (near.dist <= model.width / 2) return { kind: 'road', seg: near.seg, x: near.x, y: near.y };
  }
  return null;
}

/* Checks ------------------------------------------------------------------- */

// What the whole track says that one field cannot. `play` is the game's
// numbers when the editor has them — a track a rival laps before the
// countdown ends is only knowable against them.
export function trackChecks(model, play = null) {
  const { points, width, things, start } = model;
  const out = [];
  if (points.length < MIN_POINTS) out.push(`A track needs at least ${MIN_POINTS} points.`);
  if (start < 0 || start >= points.length) out.push('The start line is on a point that is gone.');
  for (const [i, j] of crossings(points)) {
    out.push(`The road crosses itself, between points ${i + 1} and ${j + 1}.`);
  }
  for (const i of shortSegments(points, width)) {
    const next = (i + 1) % points.length;
    out.push(`Points ${i + 1} and ${next + 1} are closer together than the road is wide, so there is a kink there.`);
  }
  for (const t of things) {
    if (!onRoad(t, model)) out.push(`The ${t.kind} at ${t.at[0]}, ${t.at[1]} is off the road, where no car can meet it.`);
  }
  if (play && points.length >= MIN_POINTS) {
    const len = trackLength(points);
    const speed = Number(play.RIVAL_SPEED) || 0;
    const count = Number(play.COUNTDOWN) || 0;
    if (speed && count && len < speed * count) {
      out.push(`The track is only ${Math.round(len)} pixels round — a rival would lap it before the countdown ends.`);
    }
  }
  return out;
}

// How the track reads as a whole.
export const trackShape = ({ points, things }) => ({
  points: points.length, things: things.length, length: Math.round(trackLength(points)),
});
