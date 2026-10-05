// The level editor: config/level.js as the centre pane of a roll-a-ball game.
// The canvas is one level from above, one square a cell, drawn by the studio
// from the unsaved model: pick what a square is — wall, floor, hole, coin,
// start, goal, or a kind of square the game made up — then click or drag
// across the grid to paint it. Beside it the levels in the order they are
// played, the kinds to paint with, the grid's size and the checks; the rail
// says what the chosen kind does, and is where a made-up kind is named and
// coloured. The model and the checks are level-editor.js; the drag plumbing
// is plan-canvas.js; this is the interface and the loading and saving around
// it.
//
// Explicit Save, like the track's and the world's: a maze half-painted is a
// level the ball cannot finish, and Save is what puts the preview on it. The
// game draws the level in 3D; this is the plan of it, flat, which is all the
// studio ever draws (ideas/modularity.md).

import {
  levelModel, levelText, levelChecks, levelShape, paint, addRow, removeRow,
  addColumn, removeColumn, reachable, rollable, addLevel, duplicateLevel,
  moveLevel, deleteLevel, addSquare, deleteSquare, usesOf, CHARS,
  MAX_SIDE, MIN_SIDE, MAX_NAME, LEVEL_FILE,
} from './level-editor.js';
import { h } from './dom.js';
import { S, render, say, frozen, more } from './main.js';
import { refreshFiles, chooseFile } from './files.js';
import { readEditorFile, writeEditorFile } from './editor-file.js';
import { planCanvas } from './plan-canvas.js';
import { tryFrom } from './preview-player.js';

export { LEVEL_FILE };

const PLAY_FILE = 'config/play.js';
// How big a square is drawn, in the plan's own pixels.
const CELL = 40;
// The interface's words for each of the six, and what each does. A made-up
// kind's are its name and whether it is solid.
const LABELS = { '#': 'Wall', '.': 'Floor', ' ': 'Hole', o: 'Coin', S: 'Start', G: 'Goal' };
const WHAT = {
  '#': 'The ball cannot roll through it.',
  '.': 'Where the ball rolls.',
  ' ': 'Nothing at all: roll in and the ball falls, then starts again.',
  o: 'A coin on the floor, picked up by rolling over it.',
  S: 'Where the ball starts. There is one; painting another moves it.',
  G: 'Where the ball is going. There is one; painting another moves it.',
};
// The order the six are offered in: the maze first, then what is in it.
const PALETTE = ['#', '.', ' ', 'o', 'S', 'G'];

const labelOf = (ch, squares) => LABELS[ch] ?? squares[ch]?.name ?? ch;
const whatOf = (ch, squares) => WHAT[ch] ?? (squares[ch]?.solid
  ? 'Made up for this game. The ball bumps into it, like a wall.'
  : 'Made up for this game. The ball rolls over it.');

/* State --------------------------------------------------------------------- */

const parked = new Map();

// The level being painted, kept inside the list.
const clampAt = (at, model) => Math.max(0, Math.min(model.levels.length - 1, at ?? 0));

export async function loadLevel() {
  const slug = S.slug;
  const got = await readEditorFile(slug, LEVEL_FILE, levelModel);
  if (!got) return;
  if (got.state) {
    S.level = got.state;
    return;
  }
  const kept = parked.get(slug);
  parked.delete(slug);
  const { text, etag, read } = got;
  const { tool = '#', at } = S.level ?? {};
  if (kept && kept.etag === etag) {
    S.level = { text, etag, model: kept.model, dirty: true, tool: kept.tool, at: kept.at };
    return;
  }
  if (kept) say(`${LEVEL_FILE} changed since you were last here, so the edits you had not saved were dropped.`, true);
  const model = { levels: read.levels, squares: read.squares };
  S.level = {
    text, etag, model, dirty: false,
    tool: CHARS.includes(tool) || tool in model.squares ? tool : '#',
    at: clampAt(at, model),
  };
}

export function parkLevel() {
  const st = S.level;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, { model: st.model, etag: st.etag, tool: st.tool, at: st.at });
}

export function levelChanged() {
  const st = S.level;
  if (st?.saving) return;
  if (st?.model && st.dirty) {
    st.stale = true;
    say(`${LEVEL_FILE} changed while you were working on it. What you have is still here — Save will ask which to keep.`);
    render();
    return;
  }
  loadLevel().then(render);
}

// The address's ?level=, counted from 1, and only past the first: a link to
// the level editor means its front door.
export const levelView = () => (S.level?.model && S.level.at > 0 ? String(S.level.at + 1) : null);

export function selectLevel(n) {
  const st = S.level;
  if (!st?.model) return;
  st.at = clampAt(Number(n) - 1 || 0, st.model);
}

export async function saveLevel({ force = false } = {}) {
  const st = S.level;
  if (!st?.model) return false;
  const text = levelText(st.model);
  st.saving = true;
  const etag = await writeEditorFile(LEVEL_FILE, text, {
    etag: st.etag, force, editor: 'level', noun: 'level',
  });
  st.saving = false;
  if (etag === null) return false;
  if (S.level === st) {
    st.etag = etag;
    st.text = text;
    st.dirty = false;
    st.stale = false;
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${LEVEL_FILE}.`);
  render();
  return true;
}

export async function discardLevel() {
  if (S.level) S.level.dirty = false;
  await loadLevel();
  render();
}

// An edit: the file will differ, and the bar says so in place.
function markUnsaved() {
  S.level.dirty = true;
  const status = document.getElementById('level-status');
  if (status) status.textContent = 'Not saved yet';
  const save = document.getElementById('level-save');
  if (save) save.disabled = frozen();
}

/* Drawing ------------------------------------------------------------------- */

// The game's own colours, off the shell, since the plan stands in for it.
function colours() {
  const css = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement) : null;
  const read = (name, fallback) => (css?.getPropertyValue(name)?.trim() || fallback);
  return {
    primary: read('--look-primary', '#4fc3f7'),
    accent: read('--look-accent', '#b39ddb'),
    deep: read('--look-deep', '#0e1726'),
    danger: read('--danger', '#ff5470'),
  };
}

// A letter in the middle of a square, in the plan's dark.
function letter(ctx, ch, mid, deep, px) {
  ctx.fillStyle = deep;
  ctx.font = `bold ${Math.round(CELL * 0.4)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, mid[0], mid[1] + px(0.5));
}

function paintPlan(ctx, px, st) {
  const { squares } = st.model;
  const level = st.model.levels[st.at];
  const { rows } = level;
  const c = colours();
  const can = reachable(level, squares);
  ctx.fillStyle = c.deep;
  ctx.fillRect(0, 0, rows[0].length * CELL, rows.length * CELL);
  rows.forEach((row, r) => row.forEach((ch, k) => {
    const x = k * CELL;
    const y = r * CELL;
    const made = squares[ch];
    if (ch !== ' ') {
      // A solid made-up kind is a wall in its own colour.
      ctx.fillStyle = ch === '#' ? '#98c1d9' : made?.solid ? made.colour : '#3d5a80';
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
    }
    // A square the ball can never reach is dimmed, so a sealed-off corner
    // shows as one.
    if (rollable(ch, squares) && can.size && !can.has(`${r},${k}`)) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    }
    const mid = [x + CELL / 2, y + CELL / 2];
    if (ch === 'o') {
      // Pale, not gold: in the studio gold is a number and nothing else.
      ctx.fillStyle = '#e2ecff';
      ctx.beginPath();
      ctx.arc(mid[0], mid[1], CELL * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (ch === 'S' || ch === 'G') {
      ctx.fillStyle = ch === 'S' ? c.primary : c.accent;
      ctx.beginPath();
      ctx.arc(mid[0], mid[1], CELL * 0.32, 0, Math.PI * 2);
      ctx.fill();
      letter(ctx, ch, mid, c.deep, px);
    } else if (made && !made.solid) {
      // A marker on the floor, as the game draws it, with its letter.
      ctx.fillStyle = made.colour;
      ctx.fillRect(x + CELL * 0.2, y + CELL * 0.2, CELL * 0.6, CELL * 0.6);
      letter(ctx, ch, mid, c.deep, px);
    } else if (made) {
      letter(ctx, ch, mid, c.deep, px);
    }
  }));
}

/* The editor ----------------------------------------------------------------- */

const note = (...kids) => h('div', { class: 'plan-editor' }, h('div', { class: 'pad muted' }, ...kids));

export function renderLevelEditor() {
  const st = S.level;
  if (!st) return note(h('p', { text: 'Reading the level…' }));
  if (st.missing) return note(h('p', { text: `There is no ${LEVEL_FILE} in this game, so there is no level to paint here.` }));
  if (st.grown) {
    return note(
      h('p', { text: `${LEVEL_FILE} has grown past the level editor — ${st.grown}.` }),
      h('p', {}, h('button', { class: 'link', text: 'Open it under Taste', onclick: () => chooseFile(LEVEL_FILE) })),
    );
  }
  if (S.open?.path === LEVEL_FILE) {
    return note(h('p', { text: `${LEVEL_FILE} is open as text under Taste. Close it there to come back to the level.` }));
  }

  const { model } = st;
  const { squares } = model;
  const level = model.levels[st.at];
  const ro = frozen();
  const checks = levelChecks(level, squares);
  const shape = levelShape(level);
  const go = (at) => { if (at !== null) st.at = at; render(); };
  const changed = (at) => { markUnsaved(); go(at); };

  const cellAt = (p) => [Math.floor(p.y / CELL), Math.floor(p.x / CELL)];
  const { canvas } = planCanvas({
    world: { width: shape.cols * CELL, height: shape.rows * CELL },
    className: 'plan-canvas',
    readOnly: ro,
    paint: (ctx, px) => paintPlan(ctx, px, st),
    // A press paints the square under it, and the drag goes on painting.
    press: (p) => {
      const [r, c] = cellAt(p);
      const held = { moved: paint(level, r, c, st.tool, squares) };
      if (held.moved) markUnsaved();
      return held;
    },
    drag: (held, p) => {
      const [r, c] = cellAt(p);
      if (paint(level, r, c, st.tool, squares)) {
        held.moved = true;
        markUnsaved();
      }
    },
    // The column's counts and checks follow the paint once the finger is up.
    lift: (held) => { if (held.moved) render(); },
    remove: () => false,
  });

  // The levels, in the order they are played. A row lights up because a
  // click anywhere on it opens that level.
  const levelRow = (lv, i) => {
    const problems = levelChecks(lv, squares).length;
    const { rows, cols } = levelShape(lv);
    return h('div', {
      class: `plan-row${st.at === i ? ' on' : ''}`,
      onclick: (e) => {
        if (e.target.closest('button')) return;
        go(i);
      },
    },
    h('span', { class: 'label', text: `Level ${i + 1}` }),
    problems ? h('span', { class: 'hint warn', text: `⚠ ${problems}` }) : null,
    h('span', { class: 'hint muted mono', text: `${cols} × ${rows}` }),
    ro ? null : more(`level:${i}`, [
      { text: 'Duplicate', title: 'A copy of this level right after it', onPick: () => changed(duplicateLevel(model, i)) },
      i > 0 && { text: 'Move earlier', onPick: () => changed(moveLevel(model, i, -1)) },
      i < model.levels.length - 1 && { text: 'Move later', onPick: () => changed(moveLevel(model, i, 1)) },
      model.levels.length > 1 && { text: 'Delete', danger: true, onPick: () => changed(deleteLevel(model, i)) },
    ], { label: `More about level ${i + 1}` }));
  };

  // A kind of square the game made up, as a row: picking it paints with it,
  // and opens under the row where it is named and coloured.
  const squareRow = ([ch, sq]) => h('div', {
    class: `plan-row${st.tool === ch ? ' on' : ''}`,
    onclick: (e) => {
      if (e.target.closest('button')) return;
      st.tool = ch;
      render();
    },
  },
  h('span', { class: 'kind-colour', style: `background:${sq.colour}` }),
  h('span', { class: 'label', text: sq.name }),
  h('span', { class: 'hint muted mono', text: ch }),
  ro ? null : more(`square:${ch}`, [
    usesOf(model, ch) === 0 && {
      text: 'Delete', danger: true,
      onPick: () => {
        deleteSquare(model, ch);
        if (st.tool === ch) st.tool = '.';
        changed(null);
      },
    },
  ], { label: `More about ${sq.name}` }));

  const tool = (ch) => h('button', {
    class: `quiet tiny${st.tool === ch ? ' on' : ''}`,
    text: LABELS[ch],
    title: WHAT[ch],
    'aria-pressed': st.tool === ch ? 'true' : 'false',
    onclick: () => { st.tool = ch; render(); },
  });
  const grow = (text, title, fn, able) => (ro ? null : h('button', {
    class: 'quiet tiny', text, title, disabled: !able,
    onclick: () => { if (fn(level)) { markUnsaved(); render(); } },
  }));
  const made = Object.entries(squares);

  const side = h('div', { class: 'plan-side scroll', 'data-scroll': 'level-side' },
    h('div', { class: 'section-label', text: 'Levels' }),
    ...model.levels.map(levelRow),
    ro ? null : h('button', {
      class: 'quiet tiny', text: '+ Add a level', title: 'A new level after this one, walled, with a start and a goal',
      onclick: () => changed(addLevel(model, st.at)),
    }),
    h('div', { class: 'section-label', text: 'Paint with' }),
    ro ? null : h('div', { class: 'row wrap level-tools' }, ...PALETTE.map(tool)),
    made.length ? h('div', { class: 'section-label', text: 'Made up for this game' }) : null,
    ...made.map(([ch, sq]) => [squareRow([ch, sq]), st.tool === ch ? squareFields(st) : null]),
    ro ? null : h('button', {
      class: 'quiet tiny', text: '+ A new kind of square',
      title: 'A square of your own — a bomb, a power-up, anything — to name, colour and paint with',
      onclick: () => {
        const ch = addSquare(model);
        if (!ch) return;
        st.tool = ch;
        markUnsaved();
        render();
        const name = document.getElementById('level-square-name');
        name?.focus();
        name?.select?.();
      },
    }),
    h('p', { class: 'hint muted', text: ro ? '' : `${labelOf(st.tool, squares)}: ${whatOf(st.tool, squares)} Click a square, or drag across several.` }),
    h('div', { class: 'section-label', text: 'The grid' }),
    h('p', { class: 'hint muted', text: `${shape.cols} across · ${shape.rows} down · ${shape.coins} coins` }),
    h('div', { class: 'row wrap' },
      grow('+ Row', 'A row of floor at the near end', addRow, shape.rows < MAX_SIDE),
      grow('− Row', 'Take the near row away', removeRow, shape.rows > MIN_SIDE),
      grow('+ Column', 'A column of floor on the right', addColumn, shape.cols < MAX_SIDE),
      grow('− Column', 'Take the right-hand column away', removeColumn, shape.cols > MIN_SIDE)),
    checks.length ? h('div', { class: 'section-label', text: 'To look at' }) : null,
    ...checks.map((line) => h('p', { class: 'hint warn problem', text: `⚠ ${line}` })),
    h('p', { class: 'hint muted' },
      'How it rolls — speed, bounce, falling, points — is ',
      h('button', { class: 'link tiny', text: PLAY_FILE, onclick: () => chooseFile(PLAY_FILE) }),
      '.'));

  const bar = h('div', { class: 'editor-bar row' },
    h('span', { class: 'hint muted', id: 'level-status', text: st.dirty ? 'Not saved yet' : 'Saved' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'link', text: 'Show the text', title: `Open ${LEVEL_FILE} as text under Taste`,
      onclick: async () => {
        if (st.dirty && !(await saveLevel())) return;
        await chooseFile(LEVEL_FILE);
      },
    }),
    h('button', {
      class: 'link', text: 'Try it', title: 'Save, then roll through this level and the ones after it in the preview',
      onclick: async () => {
        if (st.dirty && !(await saveLevel())) return;
        // The template's State: this level, arrived at fresh — no coins in
        // State is what makes Roll a ball build them again.
        tryFrom({ playing: true, at: st.at, coins: null });
        render();
      },
    }),
    h('button', {
      class: 'filled', id: 'level-save', text: 'Save', disabled: !st.dirty || ro,
      onclick: () => saveLevel(),
    }));

  return h('div', { class: 'plan-editor' },
    h('div', { class: 'plan-body' },
      h('div', { class: 'plan-canvas-box' }, canvas),
      side),
    bar);
}

/* A made-up square's fields ---------------------------------------------------- */

// The chosen kind of square, when the game made it up: named, coloured and
// made solid in place under its row (ideas/one-pane.md). The six the studio
// knows say what they do on their buttons and in the line under them.
function squareFields(st) {
  const { model } = st;
  const { squares } = model;
  const ro = frozen();
  const box = (...kids) => h('div', { class: 'inspector in-place' }, ...kids);
  const fieldRow = (label, ...kids) => h('div', { class: 'ifield' },
    h('span', { class: 'ilabel', text: label }), ...kids);

  const sq = squares[st.tool];
  if (sq) {
    const ch = st.tool;
    const uses = usesOf(model, ch);
    const name = h('input', {
      type: 'text', class: 'cfg-text', id: 'level-square-name', maxlength: String(MAX_NAME), disabled: ro,
      // Kept as it is typed, so a background render keeps it too; an empty
      // name is never kept, and leaving the field puts the last one back.
      oninput: (e) => {
        const v = e.currentTarget.value;
        if (v.trim()) { sq.name = v; markUnsaved(); }
      },
      onchange: () => render(),
    });
    name.value = sq.name;
    const colour = h('input', {
      type: 'color', id: 'level-square-colour', disabled: ro,
      oninput: (e) => { sq.colour = e.currentTarget.value; markUnsaved(); },
      onchange: () => render(),
    });
    colour.value = sq.colour;
    const solid = h('input', {
      type: 'checkbox', id: 'level-square-solid', checked: sq.solid, disabled: ro,
      onchange: (e) => { sq.solid = e.currentTarget.checked; markUnsaved(); render(); },
    });
    return box(
      h('div', { class: 'inspector-head' },
        h('span', { class: 'section-label', text: 'Kind of square' }),
        h('div', { class: 'iname', text: sq.name })),
      fieldRow('Name', name),
      fieldRow('Colour', colour),
      fieldRow('Solid', h('label', { class: 'row' }, solid, h('span', { class: 'hint muted', text: 'The ball bumps into it, like a wall' }))),
      h('p', { class: 'hint muted', text: uses
        ? `On ${uses} ${uses === 1 ? 'square' : 'squares'}. Paint over ${uses === 1 ? 'it' : 'them'} before it can be deleted.`
        : 'Not on any square yet.' }),
      h('p', { class: 'hint muted', text: `Painted as ${ch} in the file. The game draws it in its colour; what it does when the ball rolls on is up to the game — ask the helper to make it do something.` }));
  }
  return null;
}
