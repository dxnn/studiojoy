// The world editor: config/bodies.js as the centre pane of a knock-it-down
// game. The canvas is the world — the game's own 960 × 600, drawn flat by the
// studio from the unsaved model: drag a thing to move it, drag the handle on
// the selected one to size it, drag the sling. Beside it a column for adding
// things, the list of what is there and the checks; the selected thing's own
// numbers — its kind, place, size and turn — are the rail's. The model, the
// file writing, the geometry and the checks are world-editor.js; the drag
// plumbing is plan-canvas.js; this is the interface and the loading and saving
// around it.
//
// Explicit Save, like the track's: a pile half-built is a level that falls
// down on its own, and Save is what puts the preview on the new pile. Unsaved
// edits are parked per game on the way out and put back on return while the
// file is still the one they were made on.

import {
  worldModel, worldText, worldChecks, worldShape, hitAt, handleOf, corners,
  addBody, moveBody, resizeBody, setAngle, setKind, setSize, removeBody, moveSling,
  KINDS, ROUND, WORLD, WORLD_FILE,
} from './world-editor.js';
import { h } from './dom.js';
import { S, render, say, frozen, more } from './main.js';
import { refreshFiles, chooseFile } from './files.js';
import { readEditorFile, writeEditorFile } from './editor-file.js';
import { planCanvas } from './plan-canvas.js';

export { WORLD_FILE };

const PLAY_FILE = 'config/play.js';
// The interface's words for each kind, since a kid drops "a crate" and never
// "a body of kind box".
const LABELS = { box: 'Crate', block: 'Stone', ball: 'Ball', target: 'Target' };
const WHAT = {
  box: 'falls, stacks and gets knocked about',
  block: 'never moves — the ground, a ledge, a wall',
  ball: 'round, and it rolls',
  target: 'what the player knocks down',
};

/* State --------------------------------------------------------------------- */

const parked = new Map();

export async function loadWorld() {
  const slug = S.slug;
  const got = await readEditorFile(slug, WORLD_FILE, worldModel);
  if (!got) return;
  if (got.state) {
    S.world = got.state;
    return;
  }
  const kept = parked.get(slug);
  parked.delete(slug);
  const { text, etag, read } = got;
  if (kept && kept.etag === etag) {
    S.world = { text, etag, model: kept.model, dirty: true, selected: kept.selected };
    return;
  }
  if (kept) say(`${WORLD_FILE} changed since you were last here, so the edits you had not saved were dropped.`, true);
  S.world = {
    text, etag, model: { bodies: read.bodies, sling: read.sling }, dirty: false, selected: null,
  };
}

export function parkWorld() {
  const st = S.world;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, { model: st.model, etag: st.etag, selected: st.selected });
}

export function worldChanged() {
  const st = S.world;
  if (st?.saving) return;
  if (st?.model && st.dirty) {
    st.stale = true;
    say(`${WORLD_FILE} changed while you were working on it. What you have is still here — Save will ask which to keep.`);
    render();
    return;
  }
  loadWorld().then(render);
}

export async function saveWorld({ force = false } = {}) {
  const st = S.world;
  if (!st?.model) return false;
  const text = worldText(st.model);
  st.saving = true;
  const etag = await writeEditorFile(WORLD_FILE, text, {
    etag: st.etag, force, editor: 'world', noun: 'world',
  });
  st.saving = false;
  if (etag === null) return false;
  if (S.world === st) {
    st.etag = etag;
    st.text = text;
    st.dirty = false;
    st.stale = false;
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${WORLD_FILE}.`);
  render();
  return true;
}

export async function discardWorld() {
  if (S.world) S.world.dirty = false;
  await loadWorld();
  render();
}

// An edit: the file will differ, and the bar says so in place — a render here
// would replace the field under the finger.
function markUnsaved() {
  S.world.dirty = true;
  const status = document.getElementById('world-status');
  if (status) status.textContent = 'Not saved yet';
  const save = document.getElementById('world-save');
  if (save) save.disabled = frozen();
}

/* Drawing ------------------------------------------------------------------- */

// The game's own colours, off the shell: the world wears the game's look the
// way the track does, since it is standing in for the game.
function colours() {
  const css = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement) : null;
  const read = (name, fallback) => (css?.getPropertyValue(name)?.trim() || fallback);
  return {
    primary: read('--look-primary', '#ff9f43'),
    accent: read('--look-accent', '#7ed6df'),
    deep: read('--look-deep', '#10131f'),
    danger: read('--danger', '#ff5470'),
  };
}

const FILL = { box: '#c98b4f', block: '#5b6178', ball: '#9aa3c7' };

function paint(ctx, px, st) {
  const { model, selected } = st;
  const c = colours();
  ctx.fillStyle = c.deep;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD.width; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke(); }
  for (let y = 0; y <= WORLD.height; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke(); }

  model.bodies.forEach((b, i) => {
    ctx.fillStyle = b.kind === 'target' ? c.accent : FILL[b.kind];
    ctx.beginPath();
    if (ROUND.has(b.kind)) ctx.arc(b.at[0], b.at[1], b.size, 0, Math.PI * 2);
    else corners(b).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = px(i === selected ? 3 : 1.5);
    ctx.strokeStyle = i === selected ? '#fff' : 'rgba(0,0,0,0.5)';
    ctx.stroke();
    if (b.kind === 'target') {
      ctx.fillStyle = c.deep;
      ctx.beginPath();
      ctx.arc(b.at[0] - b.size * 0.35, b.at[1] - b.size * 0.2, b.size * 0.16, 0, Math.PI * 2);
      ctx.arc(b.at[0] + b.size * 0.35, b.at[1] - b.size * 0.2, b.size * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // The sling, as the game draws it: two posts and a fork.
  const [sx, sy] = model.sling;
  ctx.strokeStyle = c.primary;
  ctx.lineWidth = px(4);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy + 70);
  ctx.lineTo(sx, sy + 18);
  ctx.lineTo(sx - 14, sy - 4);
  ctx.moveTo(sx, sy + 18);
  ctx.lineTo(sx + 14, sy - 4);
  ctx.stroke();
  ctx.fillStyle = c.primary;
  ctx.beginPath();
  ctx.arc(sx, sy, px(9), 0, Math.PI * 2);
  ctx.fill();

  // The selected thing's size handle, a thumb's size on screen.
  const sel = model.bodies[selected];
  if (sel) {
    const [hx, hy] = handleOf(sel);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = c.deep;
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.arc(hx, hy, px(9), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/* The editor ----------------------------------------------------------------- */

const note = (...kids) => h('div', { class: 'plan-editor' }, h('div', { class: 'pad muted' }, ...kids));

export function renderWorldEditor() {
  const st = S.world;
  if (!st) return note(h('p', { text: 'Reading the world…' }));
  if (st.missing) return note(h('p', { text: `There is no ${WORLD_FILE} in this game, so there is no world to build here.` }));
  if (st.grown) {
    return note(
      h('p', { text: `${WORLD_FILE} has grown past the world editor — ${st.grown}.` }),
      h('p', {}, h('button', { class: 'link', text: 'Open it under Taste', onclick: () => chooseFile(WORLD_FILE) })),
    );
  }
  if (S.open?.path === WORLD_FILE) {
    return note(h('p', { text: `${WORLD_FILE} is open as text under Taste. Close it there to come back to the world.` }));
  }

  const { model } = st;
  const ro = frozen();
  const checks = worldChecks(model);
  const shape = worldShape(model);

  const { canvas } = planCanvas({
    world: WORLD,
    className: 'plan-canvas',
    readOnly: ro,
    paint: (ctx, px) => paint(ctx, px, st),
    press: (p) => {
      const hit = hitAt(model, p.x, p.y, 14 * p.scale, st.selected);
      if (!hit) {
        st.selected = null;
        render();
        return null;
      }
      if (hit.kind === 'body') st.selected = hit.index;
      // Held by the middle: the offset keeps a big block from jumping to put
      // its middle under the finger.
      const b = model.bodies[hit.index];
      const from = hit.kind === 'sling' ? model.sling : b.at;
      return { ...hit, dx: from[0] - p.x, dy: from[1] - p.y, moved: false };
    },
    drag: (d, p) => {
      if (d.kind === 'size') resizeBody(model, d.index, p.x, p.y);
      else if (d.kind === 'sling') moveSling(model, p.x + d.dx, p.y + d.dy);
      else moveBody(model, d.index, p.x + d.dx, p.y + d.dy);
      d.moved = true;
    },
    lift: (d) => {
      if (d.moved) markUnsaved();
      render();
    },
    remove: () => {
      if (st.selected === null || S.world !== st) return false;
      removeBody(model, st.selected);
      st.selected = null;
      markUnsaved();
      render();
      return true;
    },
  });

  // Dropped in the middle of the sky, where it is easy to see and falls
  // wherever the person drags it.
  const drop = (kind) => {
    st.selected = addBody(model, kind, WORLD.width / 2, WORLD.height / 3);
    markUnsaved();
    render();
  };

  const bodyRow = (b, i) => h('div', {
    class: `plan-row${st.selected === i ? ' on' : ''}`,
    onclick: (e) => {
      if (e.target.closest('button, select, input')) return;
      st.selected = i;
      render();
    },
  },
  h('span', { class: 'label', text: LABELS[b.kind] }),
  h('span', { class: 'hint muted mono', text: `${b.at[0]}, ${b.at[1]}` }),
  ro ? null : more(`body:${i}`, [{
    text: 'Delete', danger: true,
    onPick: () => { removeBody(model, i); st.selected = null; markUnsaved(); render(); },
  }], { label: `More about this ${LABELS[b.kind].toLowerCase()}` }));

  const side = h('div', { class: 'plan-side scroll', 'data-scroll': 'world-side' },
    h('div', { class: 'section-label', text: 'Put in' }),
    ro ? null : h('div', { class: 'row wrap' }, ...KINDS.map((kind) => h('button', {
      class: 'quiet tiny', text: `+ ${LABELS[kind]}`, title: `A ${LABELS[kind].toLowerCase()}: ${WHAT[kind]}`, onclick: () => drop(kind),
    }))),
    h('p', {
      class: 'hint muted',
      text: `${shape.things} things · ${shape.targets} to knock down`,
    }),
    h('p', { class: 'hint muted', text: ro ? '' : 'Drag a thing to move it, and the white dot on the chosen one to size it. Drag the sling to move where shots come from. Delete takes the chosen one out.' }),
    h('div', { class: 'section-label', text: 'In the world' }),
    ...model.bodies.map(bodyRow),
    checks.length ? h('div', { class: 'section-label', text: 'To look at' }) : null,
    ...checks.map((line) => h('p', { class: 'hint warn problem', text: `⚠ ${line}` })),
    h('p', { class: 'hint muted' },
      'How it plays — gravity, bounce, the sling, shots — is ',
      h('button', { class: 'link tiny', text: PLAY_FILE, onclick: () => chooseFile(PLAY_FILE) }),
      '.'));

  const bar = h('div', { class: 'editor-bar row' },
    h('span', { class: 'hint muted', id: 'world-status', text: st.dirty ? 'Not saved yet' : 'Saved' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'link', text: 'Show the text', title: `Open ${WORLD_FILE} as text under Taste`,
      onclick: async () => {
        if (st.dirty && !(await saveWorld())) return;
        await chooseFile(WORLD_FILE);
      },
    }),
    h('button', {
      class: 'link', text: 'Try it', title: 'Save, then play this world in the preview',
      onclick: async () => {
        if (st.dirty && !(await saveWorld())) return;
        S.previewOpen = true;
        S.previewNonce += 1;
        render();
      },
    }),
    h('button', {
      class: 'filled', id: 'world-save', text: 'Save', disabled: !st.dirty || ro,
      onclick: () => saveWorld(),
    }));

  return h('div', { class: 'plan-editor' },
    h('div', { class: 'plan-body' },
      h('div', { class: 'plan-canvas-box' }, canvas),
      side),
    bar);
}

/* The inspector -------------------------------------------------------------- */

// The chosen thing's own numbers, in the rail beside the preview; nothing
// chosen, and the world as a whole with the sling's place.
export function renderWorldInspector() {
  const st = S.world;
  if (!st?.model || st.grown || st.missing || S.open?.path === WORLD_FILE) return null;
  const { model, selected } = st;
  const ro = frozen();
  const head = (kind, name) => h('div', { class: 'inspector-head' },
    h('span', { class: 'section-label', text: kind }),
    h('div', { class: 'iname', text: name }));
  const fieldRow = (label, ...kids) => h('div', { class: 'ifield' },
    h('span', { class: 'ilabel', text: label }), ...kids);
  const box = (...kids) => h('div', { class: 'inspector scroll', 'data-scroll': 'inspector' }, ...kids);
  const numField = (id, value, onchange) => {
    const input = h('input', {
      type: 'number', class: 'cfg-num', id, step: '1', disabled: ro,
      onchange: (e) => { onchange(Number(e.currentTarget.value)); markUnsaved(); render(); },
    });
    input.value = String(value);
    return input;
  };

  const b = model.bodies[selected];
  if (b) {
    const i = selected;
    const kindPick = h('select', {
      disabled: ro,
      onchange: (e) => { setKind(model, i, e.currentTarget.value); markUnsaved(); render(); },
    }, KINDS.map((k) => {
      const o = h('option', { value: k, text: LABELS[k] });
      if (k === b.kind) o.selected = true;
      return o;
    }));
    const round = ROUND.has(b.kind);
    return box(head(LABELS[b.kind], WHAT[b.kind]),
      fieldRow('What it is', kindPick),
      fieldRow('Across', numField('world-x', b.at[0], (v) => moveBody(model, i, v, b.at[1]))),
      fieldRow('Down', numField('world-y', b.at[1], (v) => moveBody(model, i, b.at[0], v))),
      round
        ? fieldRow('Size', numField('world-r', b.size, (v) => setSize(model, i, v)))
        : [
          fieldRow('Wide', numField('world-w', b.size[0], (v) => setSize(model, i, v, b.size[1]))),
          fieldRow('Tall', numField('world-h', b.size[1], (v) => setSize(model, i, b.size[0], v))),
          fieldRow('Turned', numField('world-angle', b.angle, (v) => setAngle(model, i, v))),
        ],
      ro ? null : h('button', {
        class: 'link tiny danger', text: `Take the ${LABELS[b.kind].toLowerCase()} out`,
        onclick: () => { removeBody(model, i); st.selected = null; markUnsaved(); render(); },
      }));
  }

  const shape = worldShape(model);
  return box(head('World', `${shape.things} things`),
    h('p', { class: 'hint muted', text: `${shape.targets} to knock down. Click a thing to change its numbers here.` }),
    fieldRow('Sling across', numField('world-sx', model.sling[0], (v) => moveSling(model, v, model.sling[1]))),
    fieldRow('Sling down', numField('world-sy', model.sling[1], (v) => moveSling(model, model.sling[0], v))));
}
