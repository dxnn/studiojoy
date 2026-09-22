// The track editor: config/track.js as the centre pane of a racing game. The
// canvas *is* the track — the game's own 960 × 600 world, drawn by the studio
// from the unsaved model with the points as handles: drag a handle to move
// it, click on the road between two handles to add one, drag a rock, a pad or
// a puddle to move it. Beside it a column for the width, what is on the road,
// and the checks; the selected point's or thing's own numbers are the rail's.
// The model reading, the file writing, the geometry and the checks are
// track-editor.js; this is the interface, and the loading and saving around
// it.
//
// Explicit Save, unlike the story's and the adventure's: a track half-dragged
// is a race nobody can finish, and Save is what puts the preview on the new
// road. Unsaved edits are parked per game on the way out and put back on
// return while the file is still the one they were made on.

import {
  trackModel, trackText, trackChecks, trackShape, hitAt, movePoint, insertPoint, removePoint,
  setStart, setWidth, addThing, moveThing, removeThing, nearestOnTrack, crossings,
  KINDS, WORLD, MIN_WIDTH, MAX_WIDTH, MIN_POINTS, TRACK_FILE,
} from './track-editor.js';
import { parseConfigFile } from './config-file.js';
import { h } from './dom.js';
import {
  S, render, send, say, frozen, encodePath, more,
} from './main.js';
import { refreshFiles, chooseFile } from './files.js';
import { readEditorFile, writeEditorFile } from './editor-file.js';

export { TRACK_FILE };

const PLAY_FILE = 'config/play.js';
// The words for what sits on the road, by kind — the interface's, since a
// kid drops "a rock" and never "a thing of kind rock".
const NAMES = { rock: 'a rock', boost: 'a boost pad', puddle: 'a puddle' };
const LABELS = { rock: 'Rock', boost: 'Boost pad', puddle: 'Puddle' };

/* State --------------------------------------------------------------------- */

const parked = new Map();

// The two numbers the checks want from the game's own play.js, when the
// file has them in the plain shape: how fast a rival goes and how long the
// countdown is. Null when it cannot be read — then that one check is not made.
async function loadPlay(slug) {
  if (!S.files.some((f) => f.path === PLAY_FILE)) return null;
  const res = await send(`/api/projects/${slug}/files/${encodePath(PLAY_FILE)}`);
  if (!res.ok || S.slug !== slug) return null;
  const parsed = parseConfigFile(await res.text());
  const play = parsed.ok ? parsed.decls.find((d) => d.name === 'PLAY')?.node : null;
  if (!play || play.kind !== 'object') return null;
  const num = (key) => {
    const node = play.props.find((p) => p.key === key)?.node;
    return node?.kind === 'number' ? node.value : null;
  };
  return { RIVAL_SPEED: num('RIVAL_SPEED'), COUNTDOWN: num('COUNTDOWN'), LAPS: num('LAPS'), RIVALS: num('RIVALS') };
}

export async function loadTrack() {
  const slug = S.slug;
  const [got, play] = await Promise.all([
    readEditorFile(slug, TRACK_FILE, trackModel),
    loadPlay(slug),
  ]);
  if (!got) return;
  if (got.state) {
    S.track = got.state;
    return;
  }
  const kept = parked.get(slug);
  parked.delete(slug);
  const { text, etag, read } = got;
  if (kept && kept.etag === etag) {
    S.track = {
      text, etag, model: kept.model, play, dirty: true, selected: kept.selected,
    };
    return;
  }
  if (kept) say(`${TRACK_FILE} changed since you were last here, so the track edits you had not saved were dropped.`, true);
  S.track = {
    text,
    etag,
    model: {
      width: read.width, points: read.points, start: read.start, things: read.things,
    },
    play,
    dirty: false,
    selected: null,
  };
}

export function parkTrack() {
  const st = S.track;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, { model: st.model, etag: st.etag, selected: st.selected });
}

export function trackChanged() {
  const st = S.track;
  if (st?.saving) return;
  if (st?.model && st.dirty) {
    st.stale = true;
    say(`${TRACK_FILE} changed while you were working on it. What you have is still here — Save will ask which to keep.`);
    render();
    return;
  }
  loadTrack().then(render);
}

export async function saveTrack({ force = false } = {}) {
  const st = S.track;
  if (!st?.model) return false;
  const text = trackText(st.model);
  st.saving = true;
  const etag = await writeEditorFile(TRACK_FILE, text, {
    etag: st.etag, force, editor: 'track', noun: 'track',
  });
  st.saving = false;
  if (etag === null) return false;
  if (S.track === st) {
    st.etag = etag;
    st.text = text;
    st.dirty = false;
    st.stale = false;
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${TRACK_FILE}.`);
  render();
  return true;
}

export async function discardTrack() {
  if (S.track) S.track.dirty = false;
  await loadTrack();
  render();
}

// An edit: the file will differ, and the bar says so in place — a render here
// would replace the slider under the finger.
function markUnsaved() {
  const st = S.track;
  st.dirty = true;
  const status = document.getElementById('track-status');
  if (status) status.textContent = 'Not saved yet';
  const save = document.getElementById('track-save');
  if (save) save.disabled = frozen();
}

/* Drawing ------------------------------------------------------------------- */

// The studio's own colours, off the shell: the track wears the game's look
// the way the story's stage does, since it is standing in for the game.
function colours() {
  const css = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement) : null;
  const read = (name, fallback) => (css?.getPropertyValue(name)?.trim() || fallback);
  return {
    primary: read('--look-primary', '#ffb347'),
    accent: read('--look-accent', '#5fd3bc'),
    deep: read('--look-deep', '#0b1a0f'),
    danger: read('--danger', '#ff5470'),
  };
}

// Handles are a thumb's size on screen whatever the canvas is scaled to, so
// everything drawn for the hand is measured in screen pixels and scaled up.
function paint(canvas, st) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const { model, selected } = st;
  const { points, width, things } = model;
  const c = colours();
  const rect = canvas.getBoundingClientRect?.() ?? { width: WORLD.width };
  const px = (n) => n * (WORLD.width / (rect.width || WORLD.width));

  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  ctx.fillStyle = c.deep;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD.width; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke(); }
  for (let y = 0; y <= WORLD.height; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke(); }

  if (points.length >= 2) {
    const trace = () => {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (points.length >= MIN_POINTS) ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    trace();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = width + 10;
    ctx.stroke();
    trace();
    ctx.strokeStyle = '#3a3f4a';
    ctx.lineWidth = width;
    ctx.stroke();
    trace();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 18]);
    ctx.stroke();
    ctx.setLineDash([]);
    // A segment that crosses another is the road's one real fault, and it is
    // shown where it is rather than only said in the list.
    const bad = new Set(crossings(points).flat());
    if (bad.size) {
      ctx.strokeStyle = c.danger;
      ctx.lineWidth = 4;
      for (const i of bad) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    // The start line, across the road at its point.
    const s = points[model.start] ?? points[0];
    const n = points[(model.start + 1) % points.length] ?? s;
    const angle = Math.atan2(n[1] - s[1], n[0] - s[0]);
    ctx.save();
    ctx.translate(s[0], s[1]);
    ctx.rotate(angle);
    const sq = 10;
    for (let j = -width / 2; j < width / 2; j += sq) {
      for (let i = 0; i < 2; i += 1) {
        ctx.fillStyle = ((Math.floor((j + width / 2) / sq) + i) % 2) ? '#111' : '#fff';
        ctx.fillRect(i * sq, j, sq, Math.min(sq, width / 2 - j));
      }
    }
    ctx.restore();
  }

  things.forEach((t, i) => {
    const on = selected?.kind === 'thing' && selected.index === i;
    const [x, y] = t.at;
    ctx.globalAlpha = 0.9;
    if (t.kind === 'rock') {
      ctx.fillStyle = '#8d949f';
      ctx.beginPath();
      ctx.arc(x, y, t.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (t.kind === 'boost') {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 4;
      for (let k = -1; k <= 1; k += 1) {
        ctx.beginPath();
        ctx.moveTo(x - t.size * 0.5 + k * t.size * 0.45, y - t.size * 0.5);
        ctx.lineTo(x + k * t.size * 0.45, y);
        ctx.lineTo(x - t.size * 0.5 + k * t.size * 0.45, y + t.size * 0.5);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#3f7fbf';
      ctx.beginPath();
      ctx.ellipse(x, y, t.size, t.size * 0.6, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (on) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.arc(x, y, t.size + px(4), 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  points.forEach(([x, y], i) => {
    const on = selected?.kind === 'point' && selected.index === i;
    ctx.beginPath();
    ctx.arc(x, y, px(on ? 12 : 10), 0, Math.PI * 2);
    ctx.fillStyle = on ? '#fff' : c.primary;
    ctx.fill();
    ctx.lineWidth = px(2);
    ctx.strokeStyle = c.deep;
    ctx.stroke();
    if (i === model.start) {
      ctx.fillStyle = c.deep;
      ctx.font = `bold ${px(11)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', x, y + px(0.5));
    }
  });
}

/* The editor ----------------------------------------------------------------- */

const note = (...kids) => h('div', { class: 'track-editor' }, h('div', { class: 'pad muted' }, ...kids));

// One keyboard listener for the open editor, replaced on every render rather
// than added again.
let keys = null;

export function renderTrackEditor() {
  const st = S.track;
  if (!st) return note(h('p', { text: 'Reading the track…' }));
  if (st.missing) return note(h('p', { text: `There is no ${TRACK_FILE} in this game, so there is no track to draw here.` }));
  if (st.grown) {
    return note(
      h('p', { text: `${TRACK_FILE} has grown past the track editor — ${st.grown}.` }),
      h('p', {}, h('button', { class: 'link', text: 'Open it under Taste', onclick: () => chooseFile(TRACK_FILE) })),
    );
  }
  if (S.open?.path === TRACK_FILE) {
    return note(h('p', { text: `${TRACK_FILE} is open as text under Taste. Close it there to come back to the track.` }));
  }

  const { model } = st;
  const ro = frozen();
  const checks = trackChecks(model, st.play);
  const shape = trackShape(model);

  /* The canvas --------------------------------------------------------------- */

  const canvas = h('canvas', { class: 'track-canvas', width: WORLD.width, height: WORLD.height });
  const repaint = () => paint(canvas, st);
  // Painted once the canvas is on the page: its screen size decides how big
  // the handles are drawn.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(repaint);
  else repaint();

  const worldPoint = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scale = WORLD.width / (rect.width || WORLD.width);
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale };
  };

  let drag = null;
  if (!ro) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = worldPoint(e);
      const hit = hitAt(model, p.x, p.y, 14 * p.scale);
      if (hit?.kind === 'road') {
        // A click on the road between two handles is a new point there, and
        // the pointer is already holding it.
        const index = insertPoint(model, hit.seg, hit.x, hit.y);
        st.selected = { kind: 'point', index };
        drag = { kind: 'point', index, moved: true };
        markUnsaved();
      } else if (hit) {
        st.selected = { kind: hit.kind, index: hit.index };
        drag = { kind: hit.kind, index: hit.index, moved: false };
      } else {
        st.selected = null;
        drag = null;
        render();
        return;
      }
      canvas.setPointerCapture?.(e.pointerId);
      repaint();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = worldPoint(e);
      if (drag.kind === 'point') movePoint(model, drag.index, p.x, p.y);
      else moveThing(model, drag.index, p.x, p.y);
      drag.moved = true;
      repaint();
    });
    const lift = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) markUnsaved();
      render();
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
  }

  // Delete takes the selected point or thing out, when the keyboard is not in
  // a field.
  if (keys && typeof window !== 'undefined') window.removeEventListener('keydown', keys);
  keys = (e) => {
    if (ro || !st.selected || S.track !== st) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (e.target?.closest?.('input, textarea, select')) return;
    e.preventDefault();
    if (st.selected.kind === 'point') { if (!removePoint(model, st.selected.index)) return; } else removeThing(model, st.selected.index);
    st.selected = null;
    markUnsaved();
    render();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', keys);

  /* The side column -------------------------------------------------------- */

  const widthField = h('input', {
    type: 'range', min: String(MIN_WIDTH), max: String(MAX_WIDTH), step: '2', id: 'track-width', disabled: ro,
    oninput: (e) => {
      setWidth(model, e.currentTarget.value);
      widthOut.textContent = `${model.width} px`;
      markUnsaved();
      repaint();
    },
  });
  widthField.value = String(model.width);
  const widthOut = h('span', { class: 'hint muted', text: `${model.width} px` });

  // Dropped on the road nearest the middle of the world, so a new one is
  // somewhere a car can meet it and the person drags it from there.
  const drop = (kind) => {
    const near = model.points.length >= 2
      ? nearestOnTrack(model.points, WORLD.width / 2, WORLD.height / 2)
      : { x: WORLD.width / 2, y: WORLD.height / 2 };
    const index = addThing(model, kind, near.x, near.y);
    st.selected = { kind: 'thing', index };
    markUnsaved();
    render();
  };

  const thingRow = (t, i) => h('div', {
    class: `track-row${st.selected?.kind === 'thing' && st.selected.index === i ? ' on' : ''}`,
    onclick: (e) => {
      if (e.target.closest('button, select, input')) return;
      st.selected = { kind: 'thing', index: i };
      render();
    },
  },
  h('span', { class: 'label', text: LABELS[t.kind] }),
  h('span', { class: 'hint muted mono', text: `${t.at[0]}, ${t.at[1]}` }),
  ro ? null : more(`thing:${i}`, [{
    text: 'Delete', danger: true,
    onPick: () => { removeThing(model, i); st.selected = null; markUnsaved(); render(); },
  }], { label: `More about this ${NAMES[t.kind].slice(2)}` }));

  const side = h('div', { class: 'track-side scroll', 'data-scroll': 'track-side' },
    h('div', { class: 'section-label', text: 'The road' }),
    h('div', { class: 'row' }, h('span', { class: 'hint muted', text: 'Width' }), widthField, widthOut),
    h('p', {
      class: 'hint muted',
      text: `${shape.points} points · ${shape.length} px round`
        + (st.play?.LAPS ? ` · ${st.play.LAPS} laps` : '')
        + (st.play?.RIVALS != null ? ` · ${st.play.RIVALS} rivals` : ''),
    }),
    h('p', { class: 'hint muted', text: ro ? '' : 'Drag a point to move it. Click on the road to add one. Delete takes the selected one out.' }),
    h('div', { class: 'section-label', text: 'On the road' }),
    ...model.things.map(thingRow),
    ro ? null : h('div', { class: 'row wrap' }, ...KINDS.map((kind) => h('button', {
      class: 'quiet tiny', text: `+ ${LABELS[kind]}`, title: `Put ${NAMES[kind]} on the road`, onclick: () => drop(kind),
    }))),
    checks.length ? h('div', { class: 'section-label', text: 'To look at' }) : null,
    ...checks.map((say_) => h('p', { class: 'hint warn problem', text: `⚠ ${say_}` })),
    h('p', { class: 'hint muted' },
      'How it drives — speeds, laps, rivals — is ',
      h('button', { class: 'link tiny', text: PLAY_FILE, onclick: () => chooseFile(PLAY_FILE) }),
      '.'));

  /* The bar --------------------------------------------------------------- */

  const bar = h('div', { class: 'editor-bar row' },
    h('span', { class: 'hint muted', id: 'track-status', text: st.dirty ? 'Not saved yet' : 'Saved' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'link', text: 'Show the text', title: `Open ${TRACK_FILE} as text under Taste`,
      onclick: async () => {
        if (st.dirty && !(await saveTrack())) return;
        await chooseFile(TRACK_FILE);
      },
    }),
    h('button', {
      class: 'link', text: 'Try it', title: 'Save, then race on this track in the preview',
      onclick: async () => {
        if (st.dirty && !(await saveTrack())) return;
        S.previewOpen = true;
        S.previewNonce += 1;
        render();
      },
    }),
    h('button', {
      class: 'filled', id: 'track-save', text: 'Save', disabled: !st.dirty || ro,
      onclick: () => saveTrack(),
    }));

  return h('div', { class: 'track-editor' },
    h('div', { class: 'track-body' },
      h('div', { class: 'track-canvas-box' }, canvas),
      side),
    bar);
}

/* The inspector -------------------------------------------------------------- */

// The selected point's or thing's own numbers, in the rail beside the preview;
// nothing selected, and the track as a whole.
export function renderTrackInspector() {
  const st = S.track;
  if (!st?.model || st.grown || st.missing || S.open?.path === TRACK_FILE) return null;
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

  if (selected?.kind === 'point' && model.points[selected.index]) {
    const i = selected.index;
    const [x, y] = model.points[i];
    return box(head('Point', `${i + 1} of ${model.points.length}`),
      fieldRow('Across', numField('track-x', x, (v) => movePoint(model, i, v, y))),
      fieldRow('Down', numField('track-y', y, (v) => movePoint(model, i, x, v))),
      i === model.start
        ? h('p', { class: 'hint muted', text: 'The start line is here.' })
        : (ro ? null : h('button', {
          class: 'quiet tiny', text: 'Start here', title: 'Put the start line on this point',
          onclick: () => { setStart(model, i); markUnsaved(); render(); },
        })),
      ro || model.points.length <= MIN_POINTS ? null : h('button', {
        class: 'link tiny danger', text: 'Delete this point',
        onclick: () => { removePoint(model, i); st.selected = null; markUnsaved(); render(); },
      }));
  }

  if (selected?.kind === 'thing' && model.things[selected.index]) {
    const i = selected.index;
    const t = model.things[i];
    const kindPick = h('select', {
      disabled: ro,
      onchange: (e) => { t.kind = e.currentTarget.value; markUnsaved(); render(); },
    }, KINDS.map((k) => {
      const o = h('option', { value: k, text: LABELS[k] });
      if (k === t.kind) o.selected = true;
      return o;
    }));
    return box(head('On the road', LABELS[t.kind]),
      fieldRow('What it is', kindPick),
      fieldRow('Across', numField('track-tx', t.at[0], (v) => moveThing(model, i, v, t.at[1]))),
      fieldRow('Down', numField('track-ty', t.at[1], (v) => moveThing(model, i, t.at[0], v))),
      fieldRow('Size', numField('track-size', t.size, (v) => { t.size = Math.max(4, Math.round(v) || 4); })),
      ro ? null : h('button', {
        class: 'link tiny danger', text: `Take the ${NAMES[t.kind].slice(2)} off`,
        onclick: () => { removeThing(model, i); st.selected = null; markUnsaved(); render(); },
      }));
  }

  const shape = trackShape(model);
  return box(head('Track', `${shape.points} points`),
    h('p', { class: 'hint muted', text: `${shape.length} pixels round, ${model.width} wide, ${shape.things} on the road.` }),
    h('p', { class: 'hint muted', text: 'Click a point or something on the road to change its numbers here.' }));
}
