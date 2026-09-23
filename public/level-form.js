// The level editor: config/level.js as the centre pane of a roll-a-ball game.
// The canvas is the level from above, one square a cell, drawn by the studio
// from the unsaved model: pick what a square is — wall, floor, hole, coin,
// start, goal — then click or drag across the grid to paint it. Beside it
// the kinds to paint with, the grid's size and the checks; the rail says what
// the chosen kind does. The model and the checks are level-editor.js; the drag
// plumbing is plan-canvas.js; this is the interface and the loading and saving
// around it.
//
// Explicit Save, like the track's and the world's: a maze half-painted is a
// level the ball cannot finish, and Save is what puts the preview on it. The
// game draws the level in 3D; this is the plan of it, flat, which is all the
// studio ever draws (ideas/modularity.md).

import {
  levelModel, levelText, levelChecks, levelShape, paint, addRow, removeRow,
  addColumn, removeColumn, reachable, CHARS, TILES, MAX_SIDE, MIN_SIDE, LEVEL_FILE,
} from './level-editor.js';
import { h } from './dom.js';
import { S, render, say, frozen } from './main.js';
import { refreshFiles, chooseFile } from './files.js';
import { readEditorFile, writeEditorFile } from './editor-file.js';
import { planCanvas } from './plan-canvas.js';

export { LEVEL_FILE };

const PLAY_FILE = 'config/play.js';
// How big a square is drawn, in the plan's own pixels.
const CELL = 40;
// The interface's words for each kind of square, and what each does.
const LABELS = { '#': 'Wall', '.': 'Floor', ' ': 'Hole', o: 'Coin', S: 'Start', G: 'Goal' };
const WHAT = {
  '#': 'The ball cannot roll through it.',
  '.': 'Where the ball rolls.',
  ' ': 'Nothing at all: roll in and the ball falls, then starts again.',
  o: 'A coin on the floor, picked up by rolling over it.',
  S: 'Where the ball starts. There is one; painting another moves it.',
  G: 'Where the ball is going. There is one; painting another moves it.',
};
// The order the kinds are offered in: the maze first, then what is in it.
const PALETTE = ['#', '.', ' ', 'o', 'S', 'G'];

/* State --------------------------------------------------------------------- */

const parked = new Map();

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
  const tool = S.level?.tool ?? '#';
  if (kept && kept.etag === etag) {
    S.level = { text, etag, model: kept.model, dirty: true, tool: kept.tool };
    return;
  }
  if (kept) say(`${LEVEL_FILE} changed since you were last here, so the edits you had not saved were dropped.`, true);
  S.level = { text, etag, model: { rows: read.rows }, dirty: false, tool };
}

export function parkLevel() {
  const st = S.level;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, { model: st.model, etag: st.etag, tool: st.tool });
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

function paintPlan(ctx, px, st) {
  const { rows } = st.model;
  const c = colours();
  const can = reachable(st.model);
  ctx.fillStyle = c.deep;
  ctx.fillRect(0, 0, rows[0].length * CELL, rows.length * CELL);
  rows.forEach((row, r) => row.forEach((ch, k) => {
    const x = k * CELL;
    const y = r * CELL;
    if (ch !== ' ') {
      ctx.fillStyle = ch === '#' ? '#98c1d9' : '#3d5a80';
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
    }
    // A square the ball can never reach is dimmed, so a sealed-off corner
    // shows as one.
    if (ch !== '#' && ch !== ' ' && can.size && !can.has(`${r},${k}`)) {
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
      ctx.fillStyle = c.deep;
      ctx.font = `bold ${Math.round(CELL * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, mid[0], mid[1] + px(0.5));
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
  const ro = frozen();
  const checks = levelChecks(model);
  const shape = levelShape(model);

  const cellAt = (p) => [Math.floor(p.y / CELL), Math.floor(p.x / CELL)];
  const { canvas } = planCanvas({
    world: { width: shape.cols * CELL, height: shape.rows * CELL },
    className: 'plan-canvas',
    readOnly: ro,
    paint: (ctx, px) => paintPlan(ctx, px, st),
    // A press paints the square under it, and the drag goes on painting.
    press: (p) => {
      const [r, c] = cellAt(p);
      const held = { moved: paint(model, r, c, st.tool) };
      if (held.moved) markUnsaved();
      return held;
    },
    drag: (held, p) => {
      const [r, c] = cellAt(p);
      if (paint(model, r, c, st.tool)) {
        held.moved = true;
        markUnsaved();
      }
    },
    // The column's counts and checks follow the paint once the finger is up.
    lift: (held) => { if (held.moved) render(); },
    remove: () => false,
  });

  const tool = (ch) => h('button', {
    class: `quiet tiny${st.tool === ch ? ' on' : ''}`,
    text: LABELS[ch],
    title: WHAT[ch],
    'aria-pressed': st.tool === ch ? 'true' : 'false',
    onclick: () => { st.tool = ch; render(); },
  });
  const grow = (text, title, fn, able) => (ro ? null : h('button', {
    class: 'quiet tiny', text, title, disabled: !able,
    onclick: () => { if (fn(model)) { markUnsaved(); render(); } },
  }));

  const side = h('div', { class: 'plan-side scroll', 'data-scroll': 'level-side' },
    h('div', { class: 'section-label', text: 'Paint with' }),
    ro ? null : h('div', { class: 'row wrap level-tools' }, ...PALETTE.map(tool)),
    h('p', { class: 'hint muted', text: ro ? '' : `${LABELS[st.tool]}: ${WHAT[st.tool]} Click a square, or drag across several.` }),
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
      class: 'link', text: 'Try it', title: 'Save, then roll through this level in the preview',
      onclick: async () => {
        if (st.dirty && !(await saveLevel())) return;
        S.previewOpen = true;
        S.previewNonce += 1;
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

/* The inspector -------------------------------------------------------------- */

// What each kind of square does, the one being painted with first; the rail
// has no square of its own to show, since a level is painted, not picked.
export function renderLevelInspector() {
  const st = S.level;
  if (!st?.model || st.grown || st.missing || S.open?.path === LEVEL_FILE) return null;
  const shape = levelShape(st.model);
  return h('div', { class: 'inspector scroll', 'data-scroll': 'inspector' },
    h('div', { class: 'inspector-head' },
      h('span', { class: 'section-label', text: 'Level' }),
      h('div', { class: 'iname', text: `${shape.cols} by ${shape.rows}` })),
    ...CHARS.map((ch) => h('p', { class: `hint${ch === st.tool ? '' : ' muted'}` },
      h('strong', { text: `${LABELS[ch]} ` }), WHAT[ch])),
    h('p', { class: 'hint muted', text: `In the file each is one character: ${CHARS.map((ch) => `${ch === ' ' ? 'a space' : ch} ${TILES[ch]}`).join(', ')}.` }));
}
