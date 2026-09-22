// The world editor's model layer: config/bodies.js in, a plain model out, and
// back to file text again — the bargain the track editor makes. Reading goes
// through the config reader, never running the file; writing regenerates it
// whole with the template's comments; anything the shape does not cover makes
// worldModel decline with a reason, and the file falls back to the generic
// config form, then to the text.
//
// A world is a list of bodies and the place the shots come from. Each body is
// a kind, a middle, a size and — for the square ones — which way up: the
// same words the physics library builds bodies from (studio/physics.js), so
// what the editor draws is where the game starts. What only the whole world
// can say is worldChecks: nothing to knock down, a body past the edge, two
// bodies starting inside each other — which the physics throws apart on the
// first frame — nothing still to stand on, more than a phone should carry.

import { parseConfigFile } from './config-file.js';

export const WORLD_FILE = 'config/bodies.js';
export const isWorldPath = (p) => p === WORLD_FILE;

// The world the bodies live in: the game's own canvas size.
export const WORLD = { width: 960, height: 600 };

// What a body can be. A box and a block are rectangles, a ball and a target
// are round; a block is the one that never moves.
export const KINDS = ['box', 'block', 'ball', 'target'];
export const ROUND = new Set(['ball', 'target']);
export const SIZES = { box: [40, 40], block: [200, 30], ball: 16, target: 18 };
export const MIN_SIZE = 6;
// Past this, a phone starts to crawl. A sentence, not a refusal.
export const MANY = 60;

const num = (node) => (node && node.kind === 'number' ? node.value : null);
const int = (node) => { const n = num(node); return n !== null && Number.isInteger(n) ? n : null; };
const keysOf = (node) => node.props.map((p) => p.key).sort().join(',');
const propNode = (node, key) => node.props.find((p) => p.key === key)?.node;
const pairOf = (node) => {
  if (!node || node.kind !== 'array' || node.items.length !== 2) return null;
  const pair = node.items.map(int);
  return pair.some((n) => n === null) ? null : pair;
};

/* Reading ------------------------------------------------------------------ */

export function worldModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = {
    ok: false, reason: 'the file has grown past what the world editor understands',
  };
  if (parsed.decls.map((d) => d.name).join(',') !== 'BODIES,SLING') return grown;
  const [bodiesNode, slingNode] = parsed.decls.map((d) => d.node);
  if (bodiesNode.kind !== 'array' || slingNode.kind !== 'object') return grown;
  if (keysOf(slingNode) !== 'at') return grown;
  const sling = pairOf(propNode(slingNode, 'at'));
  if (!sling) return grown;

  const bodies = [];
  for (const item of bodiesNode.items) {
    if (item.kind !== 'object') return grown;
    const kindNode = propNode(item, 'kind');
    const kind = kindNode?.kind === 'string' ? kindNode.value : null;
    if (!KINDS.includes(kind)) return grown;
    const at = pairOf(propNode(item, 'at'));
    if (!at) return grown;
    if (ROUND.has(kind)) {
      if (keysOf(item) !== 'at,kind,size') return grown;
      const size = int(propNode(item, 'size'));
      if (size === null || size < 1) return grown;
      bodies.push({ kind, at, size });
    } else {
      if (keysOf(item) !== 'angle,at,kind,size') return grown;
      const size = pairOf(propNode(item, 'size'));
      const angle = int(propNode(item, 'angle'));
      if (!size || size.some((n) => n < 1) || angle === null) return grown;
      bodies.push({ kind, at, size, angle });
    }
  }
  return { ok: true, bodies, sling };
}

/* Writing ------------------------------------------------------------------ */

const BODIES_NOTE = [
  '// Everything in the world when a level starts: what it is, where its middle',
  '// is, how big it is and — for the square ones — how far it is turned, in',
  '// degrees. The world is 960 across and 600 down, and down is down.',
  '//   box    — a crate. It falls, stacks and gets knocked about. size: [wide, tall]',
  '//   block  — stone. It never moves: the ground, a ledge, a wall. size: [wide, tall]',
  '//   ball   — round, and it rolls. size: how far from its middle to its edge',
  '//   target — what the player has to knock down. Round, like a ball.',
  '// Build it in the studio\'s world editor rather than typing numbers: drag a',
  '// thing to move it, drag its corner to size it.',
];
const SLING_NOTE = [
  '// Where the shots are fired from.',
];

export function worldText({ bodies, sling }) {
  const out = [...BODIES_NOTE, 'const BODIES = ['];
  for (const b of bodies) {
    const kind = JSON.stringify(b.kind);
    const at = `[${b.at[0]}, ${b.at[1]}]`;
    out.push(ROUND.has(b.kind)
      ? `  { kind: ${kind}, at: ${at}, size: ${b.size} },`
      : `  { kind: ${kind}, at: ${at}, size: [${b.size[0]}, ${b.size[1]}], angle: ${b.angle} },`);
  }
  out.push('];', '', ...SLING_NOTE, `const SLING = { at: [${sling[0]}, ${sling[1]}] };`, '');
  return out.join('\n');
}

/* Geometry ------------------------------------------------------------------ */

const rad = (deg) => (deg * Math.PI) / 180;

// A rectangle's four corners, turned about its middle.
export function corners(b) {
  const [cx, cy] = b.at;
  const [w, h] = b.size;
  const c = Math.cos(rad(b.angle));
  const s = Math.sin(rad(b.angle));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * w) / 2;
    const y = (sy * h) / 2;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

// How far a body reaches, as a box square to the world.
export function extent(b) {
  if (ROUND.has(b.kind)) {
    return { left: b.at[0] - b.size, right: b.at[0] + b.size, top: b.at[1] - b.size, bottom: b.at[1] + b.size };
  }
  const xs = corners(b).map((p) => p[0]);
  const ys = corners(b).map((p) => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

// A point in a rectangle's own frame: across and down from its middle.
function local(b, x, y) {
  const dx = x - b.at[0];
  const dy = y - b.at[1];
  const c = Math.cos(rad(-b.angle));
  const s = Math.sin(rad(-b.angle));
  return [dx * c - dy * s, dx * s + dy * c];
}

export function contains(b, x, y) {
  if (ROUND.has(b.kind)) return Math.hypot(x - b.at[0], y - b.at[1]) <= b.size;
  const [lx, ly] = local(b, x, y);
  return Math.abs(lx) <= b.size[0] / 2 && Math.abs(ly) <= b.size[1] / 2;
}

// How deep two bodies are inside each other, in pixels: 0 when they only
// touch or are apart. Separating axes for two rectangles, the nearest point
// for a ball against one, the distance for two balls.
export function overlap(a, b) {
  const ra = ROUND.has(a.kind);
  const rb = ROUND.has(b.kind);
  if (ra && rb) return Math.max(0, a.size + b.size - Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]));
  if (ra || rb) {
    const ball = ra ? a : b;
    const box = ra ? b : a;
    const [lx, ly] = local(box, ball.at[0], ball.at[1]);
    const hw = box.size[0] / 2;
    const hh = box.size[1] / 2;
    const nx = Math.max(-hw, Math.min(hw, lx));
    const ny = Math.max(-hh, Math.min(hh, ly));
    const inside = Math.abs(lx) < hw && Math.abs(ly) < hh;
    if (inside) return ball.size + Math.min(hw - Math.abs(lx), hh - Math.abs(ly));
    return Math.max(0, ball.size - Math.hypot(lx - nx, ly - ny));
  }
  const pa = corners(a);
  const pb = corners(b);
  let least = Infinity;
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 2; i += 1) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ax = (y1 - y2) / len;
      const ay = (x2 - x1) / len;
      const proj = (pts) => pts.map(([x, y]) => x * ax + y * ay);
      const qa = proj(pa);
      const qb = proj(pb);
      const depth = Math.min(Math.max(...qa), Math.max(...qb)) - Math.max(Math.min(...qa), Math.min(...qb));
      if (depth <= 0) return 0;
      least = Math.min(least, depth);
    }
  }
  return least;
}

/* Changing things ------------------------------------------------------------ */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const inWorld = (x, y) => [
  Math.round(clamp(x, 0, WORLD.width)), Math.round(clamp(y, 0, WORLD.height)),
];

export function addBody(model, kind, x, y) {
  if (!KINDS.includes(kind)) return -1;
  const size = SIZES[kind];
  model.bodies.push(ROUND.has(kind)
    ? { kind, at: inWorld(x, y), size }
    : { kind, at: inWorld(x, y), size: [...size], angle: 0 });
  return model.bodies.length - 1;
}

export function moveBody(model, i, x, y) {
  if (model.bodies[i]) model.bodies[i].at = inWorld(x, y);
}

// Sized by dragging its corner handle to (x, y): a ball's edge follows the
// pointer, a rectangle's corner does, in its own turned frame.
export function resizeBody(model, i, x, y) {
  const b = model.bodies[i];
  if (!b) return;
  if (ROUND.has(b.kind)) {
    b.size = Math.round(clamp(Math.hypot(x - b.at[0], y - b.at[1]), MIN_SIZE, WORLD.height / 2));
    return;
  }
  const [lx, ly] = local(b, x, y);
  b.size = [
    Math.round(clamp(Math.abs(lx) * 2, MIN_SIZE, WORLD.width * 2)),
    Math.round(clamp(Math.abs(ly) * 2, MIN_SIZE, WORLD.height * 2)),
  ];
}

export function setSize(model, i, w, h = w) {
  const b = model.bodies[i];
  if (!b) return;
  const fit = (n) => Math.round(clamp(Number(n) || MIN_SIZE, MIN_SIZE, WORLD.width * 2));
  if (ROUND.has(b.kind)) b.size = fit(w);
  else b.size = [fit(w), fit(h)];
}

// Degrees, kept between -180 and 180 so the file says the short way round.
export function setAngle(model, i, deg) {
  const b = model.bodies[i];
  if (!b || ROUND.has(b.kind)) return;
  const d = Math.round(Number(deg) || 0) % 360;
  b.angle = d > 180 ? d - 360 : d < -180 ? d + 360 : d;
}

// A round thing and a square one are different shapes on disk, so a change of
// kind across the line gives it the new shape's size.
export function setKind(model, i, kind) {
  const b = model.bodies[i];
  if (!b || !KINDS.includes(kind) || b.kind === kind) return;
  if (ROUND.has(kind) === ROUND.has(b.kind)) { b.kind = kind; return; }
  model.bodies[i] = ROUND.has(kind)
    ? { kind, at: b.at, size: SIZES[kind] }
    : { kind, at: b.at, size: [...SIZES[kind]], angle: 0 };
}

export function removeBody(model, i) {
  if (model.bodies[i]) model.bodies.splice(i, 1);
}

export function moveSling(model, x, y) {
  model.sling = inWorld(x, y);
}

// Where the selected body's size handle sits: a rectangle's bottom-right
// corner, a ball's right edge.
export function handleOf(b) {
  if (ROUND.has(b.kind)) return [b.at[0] + b.size, b.at[1]];
  return corners(b)[2];
}

/* Hit tests ------------------------------------------------------------------ */

// What is under a point: the selected body's size handle first, then the
// sling, then the topmost body. `reach` is how close counts, in world pixels.
export function hitAt(model, x, y, reach = 14, selected = null) {
  const sel = selected === null ? null : model.bodies[selected];
  if (sel) {
    const [hx, hy] = handleOf(sel);
    if (Math.hypot(x - hx, y - hy) <= reach) return { kind: 'size', index: selected };
  }
  if (Math.hypot(x - model.sling[0], y - model.sling[1]) <= reach) return { kind: 'sling' };
  for (let i = model.bodies.length - 1; i >= 0; i -= 1) {
    if (contains(model.bodies[i], x, y)) return { kind: 'body', index: i };
  }
  return null;
}

/* Checks ------------------------------------------------------------------- */

const NAMES = { box: 'box', block: 'block', ball: 'ball', target: 'target' };
const where = (b) => `${NAMES[b.kind]} at ${b.at[0]}, ${b.at[1]}`;

export function worldChecks({ bodies, sling }) {
  const out = [];
  if (!bodies.some((b) => b.kind === 'target')) {
    out.push('There is nothing to knock down yet — add a target.');
  }
  if (!bodies.some((b) => b.kind === 'block')) {
    out.push('Nothing is still — with no block to stand on, everything falls off the bottom.');
  }
  for (const b of bodies) {
    const e = extent(b);
    if (e.left < -1 || e.right > WORLD.width + 1 || e.top < -1 || e.bottom > WORLD.height + 1) {
      out.push(`The ${where(b)} reaches past the edge of the world.`);
    }
  }
  // Two blocks may overlap — neither moves — and touching is what stacking is.
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const [a, b] = [bodies[i], bodies[j]];
      if (a.kind === 'block' && b.kind === 'block') continue;
      if (overlap(a, b) > 1) {
        out.push(`The ${where(a)} and the ${where(b)} start inside each other, and will jump apart the moment the game begins.`);
      }
    }
  }
  if (bodies.some((b) => contains(b, sling[0], sling[1]))) {
    out.push('The sling is inside something, so every shot hits it straight away.');
  }
  if (bodies.length > MANY) {
    out.push(`There are ${bodies.length} things in the world — past ${MANY}, a phone starts to crawl.`);
  }
  return out;
}

// How the world reads as a whole.
export const worldShape = ({ bodies }) => ({
  things: bodies.length,
  targets: bodies.filter((b) => b.kind === 'target').length,
});
