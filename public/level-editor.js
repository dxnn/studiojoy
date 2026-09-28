// The level editor's model layer: config/level.js in, grids out, and back to
// file text again — the bargain the track and world editors make. Reading
// goes through the config reader, never running the file; writing regenerates
// it whole with the template's comments; anything the shape does not cover
// makes levelModel decline with a reason, and the file opens as text instead.
//
// The file is every level, in the order they are played, and the kinds of
// square the game has made up. A level is rows of characters seen from above,
// the top row the far end — the move-and-collect heart ideas/templates.md
// sketched, and the one grid a 3D game and a 2D one can both be built from.
// Six characters are the studio's own; any other is a **kind of square** the
// game declared in SQUARES — a name, a colour, and whether the ball bumps
// into it — which the editor paints with like the six, and which the game
// draws and gives something to do. What only a whole level can say is
// levelChecks: no start, no goal, a goal the ball cannot roll to, a coin
// nobody can reach, a level too big for a phone.

import { parseConfigFile } from './config-file.js';

export const LEVEL_FILE = 'config/level.js';
export const isLevelPath = (p) => p === LEVEL_FILE;

// What a square can be, by the character the file writes for it — the six
// every game has. The rest are the game's own, in SQUARES.
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
// What the ball can roll across, of the six.
const ROLLABLE = new Set(['.', 'S', 'G', 'o']);
export const MIN_SIDE = 3;
// Past this a phone crawls and a kid gets lost. A sentence, and the most the
// editor grows a level to.
export const MAX_SIDE = 24;
// A made-up kind is one letter the six do not already use — a letter so it
// can be the key in SQUARES as written, and reads as itself in a row.
const SQUARE_CHARS = [...'abcdefghijklmnpqrstuvwxyzABCDEFHIJKLMNOPQRTUVWXYZ'];
export const isSquareChar = (ch) => SQUARE_CHARS.includes(ch);
export const MAX_NAME = 30;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const SQUARE_KEYS = 'colour,name,solid';

/* Reading ------------------------------------------------------------------ */

// One made-up kind as the file wrote it, or null when it is not one.
function squareOf(node) {
  if (node.kind !== 'object') return null;
  if (node.props.map((p) => p.key).sort().join(',') !== SQUARE_KEYS) return null;
  const get = (key) => node.props.find((p) => p.key === key).node;
  const name = get('name');
  const colour = get('colour');
  const solid = get('solid');
  if (name.kind !== 'string' || !name.value.trim() || name.value.length > MAX_NAME) return null;
  if (colour.kind !== 'string' || !COLOUR.test(colour.value)) return null;
  if (solid.kind !== 'boolean') return null;
  return { name: name.value, colour: colour.value, solid: solid.value };
}

export function levelModel(text) {
  const parsed = parseConfigFile(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const grown = {
    ok: false, reason: 'the file has grown past what the level editor understands',
  };
  const names = parsed.decls.map((d) => d.name).join(',');
  if (names !== 'LEVELS' && names !== 'LEVELS,SQUARES') return grown;

  const squares = {};
  const legend = parsed.decls[1]?.node;
  if (legend) {
    if (legend.kind !== 'object') return grown;
    for (const { key, node } of legend.props) {
      const square = isSquareChar(key) ? squareOf(node) : null;
      if (!square) return grown;
      squares[key] = square;
    }
  }
  const known = (ch) => CHARS.includes(ch) || ch in squares;

  const list = parsed.decls[0].node;
  if (list.kind !== 'array' || list.items.length === 0) return grown;
  const levels = [];
  for (const node of list.items) {
    if (node.kind !== 'array' || node.items.length === 0) return grown;
    if (node.items.some((item) => item.kind !== 'string')) return grown;
    const lines = node.items.map((item) => item.value);
    if (lines.some((line) => [...line].some((ch) => !known(ch)))) return grown;
    const width = Math.max(...lines.map((line) => line.length));
    if (width === 0) return grown;
    // A short row is a row with holes at its end: spaces are holes anyway, and
    // a text editor is apt to trim them.
    levels.push({ rows: lines.map((line) => [...line.padEnd(width, ' ')]) });
  }
  return { ok: true, levels, squares };
}

/* Writing ------------------------------------------------------------------ */

const LEVEL_NOTE = [
  '// The levels, in the order they are played, each from above: one character',
  '// a square, the top row the far end. Roll into the goal and the next one',
  '// starts; the last one\'s goal is the end of the run.',
  '//   #  a wall          .  floor          (a space)  a hole — fall in, start again',
  '//   S  where the ball starts   G  the goal   o  a coin on the floor',
  '// and any kind of square in SQUARES, below. Paint them in the studio\'s level',
  '// editor rather than typing: pick what a square is, then click or drag.',
];

const SQUARES_NOTE = [
  '// Kinds of square this game has made up, beyond those six: the letter each',
  '// is painted as, what it is called, its colour, and whether the ball bumps',
  '// into it like a wall (solid) or rolls over it. js/roll.js draws each one in',
  '// its colour, and ON_SQUARE there is what one does when the ball rolls on.',
];

export function levelText({ levels, squares }) {
  const kinds = Object.entries(squares);
  return [
    ...LEVEL_NOTE,
    'const LEVELS = [',
    ...levels.flatMap(({ rows }) => [
      '  [',
      ...rows.map((row) => `    ${JSON.stringify(row.join(''))},`),
      '  ],',
    ]),
    '];',
    '',
    ...SQUARES_NOTE,
    kinds.length ? 'const SQUARES = {' : 'const SQUARES = {};',
    ...kinds.map(([ch, s]) => `  ${ch}: { name: ${JSON.stringify(s.name)}, colour: ${JSON.stringify(s.colour)}, solid: ${s.solid} },`),
    ...(kinds.length ? ['};'] : []),
    '',
  ].join('\n');
}

/* Finding things -------------------------------------------------------------- */

export const size = ({ rows }) => ({ rows: rows.length, cols: rows[0]?.length ?? 0 });

// Every square of a level holding `ch`, as [row, col].
export function find(level, ch) {
  const out = [];
  level.rows.forEach((row, r) => row.forEach((c, k) => { if (c === ch) out.push([r, k]); }));
  return out;
}

// Whether the ball can roll across a square: the six's own rule, and a
// made-up kind unless it is solid.
export const rollable = (ch, squares) => ROLLABLE.has(ch) || (ch in squares && !squares[ch].solid);

// Every square the ball can roll to from the start, four ways, never through
// a wall or over a hole. A set of "r,c".
export function reachable(level, squares) {
  const [start] = find(level, 'S');
  const seen = new Set();
  if (!start) return seen;
  const { rows, cols } = size(level);
  const queue = [start];
  seen.add(start.join(','));
  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || seen.has(key)) continue;
      if (!rollable(level.rows[nr][nc], squares)) continue;
      seen.add(key);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

// How many squares, in every level, are made-up kind `ch`.
export const usesOf = (model, ch) => model.levels.reduce((n, level) => n + find(level, ch).length, 0);

/* Changing a level ------------------------------------------------------------ */

// A square becomes `ch`. A second start or goal moves the first: the old
// square becomes floor. Answers whether anything changed.
export function paint(level, r, c, ch, squares) {
  if (!(CHARS.includes(ch) || ch in squares)) return false;
  if (!level.rows[r] || level.rows[r][c] === undefined) return false;
  if (level.rows[r][c] === ch) return false;
  if (ONLY_ONE.has(ch)) {
    for (const [or, oc] of find(level, ch)) level.rows[or][oc] = '.';
  }
  level.rows[r][c] = ch;
  return true;
}

// A row or a column more or less, at the near end or the right: a new one is
// floor, and never past MAX_SIDE or below MIN_SIDE.
export function addRow(level) {
  const { rows, cols } = size(level);
  if (rows >= MAX_SIDE) return false;
  level.rows.push(Array(cols).fill('.'));
  return true;
}
export function removeRow(level) {
  if (size(level).rows <= MIN_SIDE) return false;
  level.rows.pop();
  return true;
}
export function addColumn(level) {
  if (size(level).cols >= MAX_SIDE) return false;
  for (const row of level.rows) row.push('.');
  return true;
}
export function removeColumn(level) {
  if (size(level).cols <= MIN_SIDE) return false;
  for (const row of level.rows) row.pop();
  return true;
}

/* Changing the list of levels ------------------------------------------------- */

// A new level is a small walled room with a start and a goal already in it,
// so it is one the ball can finish the moment it is made.
const FRESH = ['########', '#.....G#', '#......#', '#......#', '#S.....#', '########'];

// Each answers where the level it made or moved now is, or null when it
// could not: the list is never empty.
export function addLevel(model, after) {
  model.levels.splice(after + 1, 0, { rows: FRESH.map((line) => [...line]) });
  return after + 1;
}
export function duplicateLevel(model, at) {
  model.levels.splice(at + 1, 0, { rows: model.levels[at].rows.map((row) => [...row]) });
  return at + 1;
}
export function moveLevel(model, at, by) {
  const to = at + by;
  if (to < 0 || to >= model.levels.length) return null;
  const [level] = model.levels.splice(at, 1);
  model.levels.splice(to, 0, level);
  return to;
}
export function deleteLevel(model, at) {
  if (model.levels.length <= 1) return null;
  model.levels.splice(at, 1);
  return Math.min(at, model.levels.length - 1);
}

/* Changing the kinds of square -------------------------------------------------- */

// Colours a new kind is offered in, one after another: none of them the
// studio's gold, and none the floor's or the walls'.
const NEW_COLOURS = ['#ff6b6b', '#6bcb77', '#c77dff', '#ff9f43', '#4d96ff', '#f368e0'];

// A new kind of square, the next free letter, answered; null when all of
// them are taken.
export function addSquare(model) {
  const ch = SQUARE_CHARS.find((c) => !(c in model.squares));
  if (!ch) return null;
  const n = Object.keys(model.squares).length;
  model.squares[ch] = { name: 'New square', colour: NEW_COLOURS[n % NEW_COLOURS.length], solid: false };
  return ch;
}

// Only a kind no level uses: taking one out from under its squares would
// leave characters the file could not be read back with.
export function deleteSquare(model, ch) {
  if (!(ch in model.squares) || usesOf(model, ch) > 0) return false;
  delete model.squares[ch];
  return true;
}

/* Checks ------------------------------------------------------------------- */

export function levelChecks(level, squares) {
  const out = [];
  const starts = find(level, 'S');
  const goals = find(level, 'G');
  if (starts.length === 0) out.push('There is nowhere for the ball to start — put an S down.');
  if (starts.length > 1) out.push('There is more than one start; the ball can only start in one place.');
  if (goals.length === 0) out.push('There is no goal to roll to — put a G down.');
  if (goals.length > 1) out.push('There is more than one goal.');
  if (starts.length && goals.length) {
    const can = reachable(level, squares);
    if (!goals.some(([r, c]) => can.has(`${r},${c}`))) {
      out.push('The ball cannot roll from the start to the goal: a wall or a hole is in the way.');
    }
    const stuck = find(level, 'o').filter(([r, c]) => !can.has(`${r},${c}`));
    if (stuck.length) {
      out.push(`${stuck.length === 1 ? 'A coin is' : `${stuck.length} coins are`} where the ball cannot roll.`);
    }
  }
  const { rows, cols } = size(level);
  if (rows > MAX_SIDE || cols > MAX_SIDE) {
    out.push(`The level is ${cols} by ${rows} — past ${MAX_SIDE} a side, a phone starts to crawl.`);
  }
  return out;
}

// How a level reads as a whole.
export const levelShape = (level) => ({
  ...size(level), coins: find(level, 'o').length,
});
