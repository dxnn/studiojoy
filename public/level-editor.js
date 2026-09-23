// The level editor's model layer: config/level.js in, a grid out, and back to
// file text again — the bargain the track and world editors make. Reading
// goes through the config reader, never running the file; writing regenerates
// it whole with the template's comments; anything the shape does not cover
// makes levelModel decline with a reason, and the file falls back to the
// generic config form, then to the text.
//
// A level is rows of characters seen from above, the top row the far end —
// the move-and-collect heart ideas/templates.md sketched, and the one grid a
// 3D game and a 2D one can both be built from. What only the whole level can
// say is levelChecks: no start, no goal, a goal the ball cannot roll to, a
// coin nobody can reach, a level too big for a phone.

import { parseConfigFile } from './config-file.js';

export const LEVEL_FILE = 'config/level.js';
export const isLevelPath = (p) => p === LEVEL_FILE;

// What a square can be, by the character the file writes for it.
export const TILES = {
  '#': 'wall',
  '.': 'floor',
  ' ': 'hole',
  S: 'start',
  G: 'goal',
  o: 'coin',
};
export const CHARS = Object.keys(TILES);
// Only one of each: the ball starts in one place and has one place to get to.
const ONLY_ONE = new Set(['S', 'G']);
// What the ball can roll across.
const ROLLABLE = new Set(['.', 'S', 'G', 'o']);
export const MIN_SIDE = 3;
// Past this a phone crawls and a kid gets lost. A sentence, and the most the
// editor grows a level to.
export const MAX_SIDE = 24;

/* Reading ------------------------------------------------------------------ */

export function levelModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = {
    ok: false, reason: 'the file has grown past what the level editor understands',
  };
  if (parsed.decls.map((d) => d.name).join(',') !== 'LEVEL') return grown;
  const node = parsed.decls[0].node;
  if (node.kind !== 'array' || node.items.length === 0) return grown;
  if (node.items.some((item) => item.kind !== 'string')) return grown;
  const lines = node.items.map((item) => item.value);
  if (lines.some((line) => [...line].some((ch) => !CHARS.includes(ch)))) return grown;
  const width = Math.max(...lines.map((line) => line.length));
  if (width === 0) return grown;
  // A short row is a row with holes at its end: spaces are holes anyway, and
  // a text editor is apt to trim them.
  const rows = lines.map((line) => [...line.padEnd(width, ' ')]);
  return { ok: true, rows };
}

/* Writing ------------------------------------------------------------------ */

const LEVEL_NOTE = [
  '// The level, from above: one character a square, the top row the far end.',
  '//   #  a wall          .  floor          (a space)  a hole — fall in, start again',
  '//   S  where the ball starts   G  the goal   o  a coin on the floor',
  '// Paint it in the studio\'s level editor rather than typing: pick what a',
  '// square is, then click or drag across the grid.',
];

export function levelText({ rows }) {
  return [
    ...LEVEL_NOTE,
    'const LEVEL = [',
    ...rows.map((row) => `  ${JSON.stringify(row.join(''))},`),
    '];',
    '',
  ].join('\n');
}

/* Finding things -------------------------------------------------------------- */

export const size = ({ rows }) => ({ rows: rows.length, cols: rows[0]?.length ?? 0 });

// Every square holding `ch`, as [row, col].
export function find(model, ch) {
  const out = [];
  model.rows.forEach((row, r) => row.forEach((c, k) => { if (c === ch) out.push([r, k]); }));
  return out;
}

// Every square the ball can roll to from the start, four ways, never through
// a wall or over a hole. A set of "r,c".
export function reachable(model) {
  const [start] = find(model, 'S');
  const seen = new Set();
  if (!start) return seen;
  const { rows, cols } = size(model);
  const queue = [start];
  seen.add(start.join(','));
  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || seen.has(key)) continue;
      if (!ROLLABLE.has(model.rows[nr][nc])) continue;
      seen.add(key);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

/* Changing things ------------------------------------------------------------ */

// A square becomes `ch`. A second start or goal moves the first: the old
// square becomes floor. Answers whether anything changed.
export function paint(model, r, c, ch) {
  if (!CHARS.includes(ch) || !model.rows[r] || model.rows[r][c] === undefined) return false;
  if (model.rows[r][c] === ch) return false;
  if (ONLY_ONE.has(ch)) {
    for (const [or, oc] of find(model, ch)) model.rows[or][oc] = '.';
  }
  model.rows[r][c] = ch;
  return true;
}

// A row or a column more or less, at the near end or the right: a new one is
// floor, and never past MAX_SIDE or below MIN_SIDE.
export function addRow(model) {
  const { rows, cols } = size(model);
  if (rows >= MAX_SIDE) return false;
  model.rows.push(Array(cols).fill('.'));
  return true;
}
export function removeRow(model) {
  if (size(model).rows <= MIN_SIDE) return false;
  model.rows.pop();
  return true;
}
export function addColumn(model) {
  if (size(model).cols >= MAX_SIDE) return false;
  for (const row of model.rows) row.push('.');
  return true;
}
export function removeColumn(model) {
  if (size(model).cols <= MIN_SIDE) return false;
  for (const row of model.rows) row.pop();
  return true;
}

/* Checks ------------------------------------------------------------------- */

export function levelChecks(model) {
  const out = [];
  const starts = find(model, 'S');
  const goals = find(model, 'G');
  if (starts.length === 0) out.push('There is nowhere for the ball to start — put an S down.');
  if (starts.length > 1) out.push('There is more than one start; the ball can only start in one place.');
  if (goals.length === 0) out.push('There is no goal to roll to — put a G down.');
  if (goals.length > 1) out.push('There is more than one goal.');
  if (starts.length && goals.length) {
    const can = reachable(model);
    if (!goals.some(([r, c]) => can.has(`${r},${c}`))) {
      out.push('The ball cannot roll from the start to the goal: a wall or a hole is in the way.');
    }
    const stuck = find(model, 'o').filter(([r, c]) => !can.has(`${r},${c}`));
    if (stuck.length) {
      out.push(`${stuck.length === 1 ? 'A coin is' : `${stuck.length} coins are`} where the ball cannot roll.`);
    }
  }
  const { rows, cols } = size(model);
  if (rows > MAX_SIDE || cols > MAX_SIDE) {
    out.push(`The level is ${cols} by ${rows} — past ${MAX_SIDE} a side, a phone starts to crawl.`);
  }
  return out;
}

// How the level reads as a whole.
export const levelShape = (model) => ({
  ...size(model), coins: find(model, 'o').length,
});
