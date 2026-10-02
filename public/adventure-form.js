// The adventure editor: config/scenes.js as the centre pane of a point-and-
// click adventure, the story editor's three regions with the stage doing
// more. The scene strip down the left, then the things that can be carried;
// for the selected scene the stage — its picture with the spots drawn on it
// as boxes, where **dragging a box on the picture makes a spot** and dragging
// a box's middle or corner moves or resizes it — over the spots as rows read
// top to bottom, and the editor bar under them. The model reading, the file
// writing, the checks and the guide's questions are adventure-editor.js; this
// is the interface, and the loading and saving around it.
//
// Same rules as the story editor, from which most of this is taken. A spot
// opens in its own row, and the click that selects it — in the rows or on
// its box on the stage — is the one that opens it. What lights up is what can
// be clicked. Typing repaints in place; anything that changes the shape
// renders. It saves itself two seconds after an edit and sooner on the way
// out, into the pending commit; unsaved edits park per game.
//
// ⚠️ A spot's `at` is four numbers in the picture's own pixels, and nobody
// types those — not a kid, and not a helper that can see the hall but cannot
// measure it (ideas/point-and-click.md). The stage is where they come from.

import {
  adventureModel, adventureText, adventureChecks, adventureShape, freshKey, renameScene,
  addScene, duplicateScene, startAt, addSpot, moveSpot, leadingTo, itemsOf, switchesOf,
  emptyAdventure, spotLabel, spotAt, nextQuestion, itemPath, KINDS, ADVENTURE_FILE,
} from './adventure-editor.js';
import { titleWords, withTitleWords, WORDS_FILE } from './story-editor.js';
import { h } from './dom.js';
import {
  S, render, send, say, frozen, encodePath, commitNow, more, NO_CONNECTION, prefs,
} from './main.js';
import { refreshFiles, chooseFile } from './files.js';
import { readEditorFile, writeEditorFile } from './editor-file.js';
import { createPictureAt } from './drawing.js';
import {
  artShelf, artCredit, asPng, plainCard,
} from './story-guide.js';
import { writeFiles, IMAGE_DIR, SOUND_DIR } from './upload.js';
import { pictureInto, cachedFileUrl } from './story-form.js';

export { ADVENTURE_FILE };

// The size a thing's picture is drawn at when the studio makes one, and what
// an uploaded one is scaled down to fit.
const ITEM = [64, 64];
const BACKDROP = [480, 270];
const UPLOAD_FITS = { item: [128, 128], backdrop: [960, 540] };
const ART = '/story-art';

/* State --------------------------------------------------------------------- */

// Unsaved edits, parked when the game is left.
const parked = new Map();

// What the editor has learned of the pictures it has drawn — path to
// {width, height} — so a box can be drawn in the picture's own pixels and a
// spot off the edge of a picture that shrank can be named. Learned from the
// stage's <img> as each one loads; dropped with the game.
const sizes = new Map();

// Where the reader is: a scene, and a spot in it (an index) or 'scene'.
export function selectAdventureScene(key, spot = 'scene') {
  const st = S.adventure;
  if (!st?.model) return;
  const has = st.model.scenes.some((s) => s.key === key);
  const leaving = has && st.scene !== null && st.scene !== key;
  st.item = null;
  st.title = false;
  st.scene = has ? key : (st.model.scenes[0]?.key ?? null);
  st.spot = spot;
  if (leaving) (st.dirty ? saveAdventure() : Promise.resolve()).then(() => commitNow());
}

/* Loading and saving --------------------------------------------------------- */

async function loadWords(slug, kept = null) {
  if (!S.files.some((f) => f.path === WORDS_FILE)) return null;
  const res = await send(`/api/projects/${slug}/files/${encodePath(WORDS_FILE)}`);
  if (!res.ok || S.slug !== slug) return null;
  const text = await res.text();
  const read = titleWords(text);
  if (!read) return null;
  return {
    text, etag: res.headers.get('etag'), ...read,
    ...(kept?.dirty ? { title: kept.title, tagline: kept.tagline, dirty: true } : { dirty: false }),
  };
}

export async function loadAdventure() {
  const slug = S.slug;
  const was = S.adventure;
  const kept = parked.get(slug);
  const [got, words] = await Promise.all([
    readEditorFile(slug, ADVENTURE_FILE, adventureModel),
    loadWords(slug, kept?.words),
  ]);
  if (!got) return;
  if (got.state) {
    S.adventure = got.state;
    return;
  }
  parked.delete(slug);
  const { text, etag, read } = got;
  if (kept && kept.etag === etag) {
    S.adventure = {
      text, etag, model: kept.model, words, dirty: true, scene: null, spot: 'scene', item: null, title: false,
    };
    selectAdventureScene(kept.scene, kept.spot);
    S.adventure.item = kept.item;
    S.adventure.title = kept.title;
    return;
  }
  if (kept) {
    say(`${ADVENTURE_FILE} changed since you were last here, so the edits you had not saved were dropped.`, true);
  }
  S.adventure = {
    text, etag, model: { scenes: read.scenes }, words, dirty: Boolean(words?.dirty),
    scene: null, spot: 'scene', item: null, title: false,
  };
  selectAdventureScene(was?.scene ?? read.scenes[0]?.key, was?.scene ? was.spot : 'scene');
}

export function parkAdventure() {
  const st = S.adventure;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, {
    model: st.model, etag: st.etag, scene: st.scene, spot: st.spot, item: st.item, words: st.words, title: st.title,
  });
}

export function dropAdventureSizes() {
  sizes.clear();
}

// The file changed on disk. Re-read it, unless there is unsaved work here.
export function adventureChanged() {
  const st = S.adventure;
  if (st?.saving) return;
  if (st?.model && st.dirty) {
    st.stale = true;
    say(`${ADVENTURE_FILE} changed while you were working on it. What you have is still here — the studio will ask which to keep when it saves.`);
    render();
    return;
  }
  loadAdventure().then(render);
}

export async function saveAdventure({ force = false, keepalive = false } = {}) {
  const st = S.adventure;
  if (!st?.model) return false;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (st.words?.dirty && !(await saveWords(st))) return false;
  const text = adventureText(st.model);
  if (text === st.text && !force) {
    st.dirty = false;
    S.previewNonce += 1;
    await refreshFiles();
    return true;
  }
  st.saving = true;
  const etag = await writeEditorFile(ADVENTURE_FILE, text, {
    etag: st.etag, force, keepalive, editor: 'adventure', noun: 'adventure',
  });
  st.saving = false;
  if (etag === null) return false;
  if (S.adventure === st) {
    st.etag = etag;
    st.text = text;
    st.dirty = adventureText(st.model) !== text;
    st.stale = false;
    if (st.dirty) saveSoon();
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${ADVENTURE_FILE}.`);
  return true;
}

async function saveWords(st) {
  const w = st.words;
  const text = withTitleWords(w.text, w);
  if (text === null) { say(`${WORDS_FILE} has changed shape, so the title could not be written.`, true); return false; }
  st.saving = true;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(WORDS_FILE)}`, {
    method: 'PUT', headers: { 'content-type': 'text/plain', 'if-match': w.etag }, body: text,
  });
  const body = await res.json().catch(() => null);
  st.saving = false;
  if (res.status === 409) {
    if (S.adventure === st) st.words = await loadWords(S.slug, w);
    say(`${WORDS_FILE} changed underneath — your title is still here, press Save again to keep it.`, true);
    render();
    return false;
  }
  if (!res.ok) {
    say(res.status === 0 ? NO_CONNECTION : (body?.error ?? `Could not save ${WORDS_FILE}.`), true);
    return false;
  }
  if (S.adventure === st) {
    w.text = text;
    w.etag = body.etag;
    w.dirty = false;
  }
  say(`Saved ${WORDS_FILE}.`);
  return true;
}

export async function discardAdventure() {
  if (S.adventure) S.adventure.dirty = false;
  await loadAdventure();
  render();
}

/* Repainting in place -------------------------------------------------------- */

const AUTOSAVE_MS = 2000;
let saveTimer = null;

// Every edit comes through here: the model changed, the status says so, and
// the save follows on its own.
function touched() {
  const st = S.adventure;
  st.dirty = true;
  const status = document.getElementById('adventure-status');
  if (status) status.textContent = 'Saving…';
  saveSoon();
}
export { touched as adventureEdited };

export function saveSoon(delay = AUTOSAVE_MS) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (S.adventure?.dirty && !frozen()) saveAdventure();
  }, delay);
}

/* Controls ------------------------------------------------------------------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Ids on the fields carry the caret across a background render (main.js puts
// the focus back on anything with an id).
const field = (id, value, placeholder, on = {}) => {
  const input = h('input', {
    type: 'text', class: 'cfg-text', id, placeholder, disabled: frozen(), ...on,
  });
  input.value = value;
  return input;
};
const pick = (options, value, onchange, extra = {}) => h(
  'select', { onchange, disabled: frozen(), ...extra },
  options.map(([v, label]) => {
    const option = h('option', { value: v, text: label });
    if (v === value) option.selected = true;
    return option;
  }),
);
const filesUnder = (dir, ext) => S.files.map((f) => f.path)
  .filter((p) => p.startsWith(`${dir}/`) && (!ext || p.endsWith(ext))).sort();
const thumb = (path) => {
  const img = h('img', { class: 'thumb', alt: '' });
  pictureInto(img, path);
  return img;
};
const go = (key) => { selectAdventureScene(key); render(); };

const GLYPH = { go: '→', say: '“', take: '✋' };

/* The stage ------------------------------------------------------------------- */

// The picture with its spots drawn on as boxes in the game's primary colour,
// laid over exactly the part of the stage the picture fills, so a box's place
// is a place in the picture's own pixels. Drawn from the unsaved model.
//
// Three gestures on it, all by pointer: drag on empty picture draws a new
// box, which becomes a spot; drag a box's middle to move it; drag its corner
// grip to resize it. A tap on a box selects it, which opens its row. During
// a drag the boxes are moved in place, and the model changes — and the tree
// renders — when the pointer lifts.
function buildStage(st, scene) {
  const ro = frozen();
  const frame = h('div', { class: 'adv-frame' });
  const picture = h('img', { class: 'picture', alt: '' });
  const layer = h('div', { class: 'adv-spots' });
  frame.append(picture, layer);
  const stage = h('div', { class: 'adv-stage' }, frame);
  const known = () => sizes.get(scene?.picture) ?? null;

  // The frame takes the biggest box of the picture's shape that fits the
  // stage, so the picture fills it exactly and the boxes stay on it.
  const fit = () => {
    const size = known();
    const w = stage.clientWidth || 0;
    const hh = stage.clientHeight || 0;
    if (!size || !w || !hh) return;
    const scale = Math.min(w / size.width, hh / size.height);
    frame.style.width = `${Math.floor(size.width * scale)}px`;
    frame.style.height = `${Math.floor(size.height * scale)}px`;
    frame.dataset.scale = String(scale);
  };
  const scaleNow = () => Number(frame.dataset.scale) || 1;

  if (scene?.picture) {
    picture.addEventListener('load', () => {
      sizes.set(scene.picture, { width: picture.naturalWidth, height: picture.naturalHeight });
      fit();
      paintBoxes();
      // A size just learned may have made a spot off the edge, or not.
      const status = document.getElementById('adventure-status');
      if (status && !st.dirty) render();
    });
    pictureInto(picture, scene.picture);
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(stage);

  // Every spot as a box, in percentages of the frame, so a resize of the
  // frame moves them all for free.
  const boxes = [];
  const place = (box, at) => {
    const size = known();
    if (!size) return;
    box.style.left = `${(at[0] / size.width) * 100}%`;
    box.style.top = `${(at[1] / size.height) * 100}%`;
    box.style.width = `${(at[2] / size.width) * 100}%`;
    box.style.height = `${(at[3] / size.height) * 100}%`;
  };
  function paintBoxes() {
    layer.replaceChildren();
    boxes.length = 0;
    if (!scene || !known()) return;
    scene.spots.forEach((spot, i) => {
      const box = h('div', {
        class: `adv-box${st.spot === i ? ' on' : ''}`, title: spotLabel(spot),
      },
      h('span', { class: 'adv-tag', text: `${GLYPH[spot.kind]} ${spotLabel(spot)}` }),
      ro ? null : h('span', { class: 'grip', title: 'Drag to resize' }));
      box.dataset.index = String(i);
      place(box, spot.at);
      boxes.push(box);
      layer.append(box);
    });
  }
  paintBoxes();

  if (ro || !scene) {
    if (!scene) stage.append(h('div', { class: 'pad muted', text: 'No scenes yet. Add one on the left.' }));
    return stage;
  }

  // Pointer arithmetic: a pointer's place in the picture's own pixels.
  const pointOf = (e) => {
    const r = layer.getBoundingClientRect();
    const s = scaleNow();
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const MIN = 4; // a box smaller than this, in picture pixels, was a tap

  let drag = null;
  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !known()) return;
    const size = known();
    const p = pointOf(e);
    const box = e.target.closest('.adv-box');
    const index = box ? Number(box.dataset.index) : -1;
    const grip = Boolean(e.target.closest('.grip'));
    drag = {
      index, grip, from: p, start: index >= 0 ? [...scene.spots[index].at] : null, moved: false,
      rubber: null, size,
    };
    if (index < 0) {
      drag.rubber = h('div', { class: 'adv-box new' });
      layer.append(drag.rubber);
    }
    layer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  layer.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pointOf(e);
    const dx = p.x - drag.from.x;
    const dy = p.y - drag.from.y;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) drag.moved = true;
    const { size } = drag;
    if (drag.index < 0) {
      const x = clamp(Math.min(drag.from.x, p.x), 0, size.width);
      const y = clamp(Math.min(drag.from.y, p.y), 0, size.height);
      const w = clamp(Math.max(drag.from.x, p.x), 0, size.width) - x;
      const hh = clamp(Math.max(drag.from.y, p.y), 0, size.height) - y;
      drag.at = [x, y, w, hh];
      place(drag.rubber, drag.at);
      return;
    }
    const [sx, sy, sw, sh] = drag.start;
    drag.at = drag.grip
      ? [sx, sy, clamp(sw + dx, MIN, size.width - sx), clamp(sh + dy, MIN, size.height - sy)]
      : [clamp(sx + dx, 0, size.width - sw), clamp(sy + dy, 0, size.height - sh), sw, sh];
    place(boxes[drag.index], drag.at);
  });
  const lift = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    layer.releasePointerCapture?.(e.pointerId);
    if (d.rubber) d.rubber.remove();
    if (d.index < 0) {
      // A drawn box becomes a spot; a tap on the picture selects the spot
      // under it, if any — the smallest, so a small one inside a big one can
      // still be picked up.
      if (d.moved && d.at && d.at[2] >= MIN && d.at[3] >= MIN) {
        st.spot = addSpot(scene, d.at);
        touched();
        render();
      } else {
        const under = spotAt(scene, d.from.x, d.from.y);
        if (under >= 0 && under !== st.spot) { st.spot = under; render(); }
      }
      return;
    }
    if (d.moved && d.at) {
      scene.spots[d.index].at = d.at.map((n) => Math.round(n));
      st.spot = d.index;
      touched();
      render();
    } else if (st.spot !== d.index) {
      st.spot = d.index;
      render();
    }
  };
  layer.addEventListener('pointerup', lift);
  layer.addEventListener('pointercancel', lift);
  return stage;
}

/* The guide ------------------------------------------------------------------- */

const skipKey = () => `guide-adventure-${S.slug}`;
function skippedSet() {
  try {
    return new Set(JSON.parse(prefs.get(skipKey(), '[]')));
  } catch {
    return new Set();
  }
}
function setAside(id) {
  const set = skippedSet();
  set.add(id);
  prefs.set(skipKey(), JSON.stringify([...set]));
}

const model = () => S.adventure.model;
const sceneOf = (key) => model().scenes.find((s) => s.key === key);

async function putPicture(q, body, note = null) {
  if (q.scene) {
    const scene = sceneOf(q.scene);
    if (scene && scene.picture !== q.path) {
      scene.picture = q.path;
      touched();
    }
    selectAdventureScene(q.scene);
  } else if (q.item) {
    S.adventure.item = q.item;
  }
  const { failure } = await writeFiles([{ path: q.path, body }]);
  if (failure) say(failure, true);
  else say(note ?? `Added ${q.path}.`);
  render();
}

// The whole example in one click: its pictures copied in from the standard
// set, a plain card drawn for each thing it carries, then the scenes written
// and saved. Its ending is marked as meant, or the guide would ask about it.
async function putInExample() {
  const st = S.adventure;
  const index = await send(`${ART}/index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const example = index?.examples?.key;
  if (!example) { say('The example adventure could not be read.', true); return; }
  say('Putting the example adventure in…');
  const lands = { backgrounds: 'assets/images', portraits: 'assets/sprites', sounds: 'assets/sounds' };
  const files = [];
  for (const file of example.uses) {
    const res = await send(`${ART}/${file}`);
    if (!res.ok) { say(`Could not read ${file}.`, true); return; }
    files.push({ path: `${lands[file.split('/')[0]]}/${file.split('/').pop()}`, body: await res.blob() });
  }
  for (const item of example.items ?? []) {
    files.push({ path: itemPath(item), body: await plainCard({ width: ITEM[0], height: ITEM[1], label: item, face: false }) });
  }
  const text = await send(`${ART}/${example.scenes}`).then((r) => (r.ok ? r.text() : null));
  const read = text === null ? { ok: false } : adventureModel(text);
  if (!read.ok) { say('The example adventure could not be read.', true); return; }
  const { failure } = await writeFiles(files);
  if (failure) { say(failure, true); return; }
  if (S.adventure !== st) return;
  st.model = { scenes: read.scenes };
  touched();
  for (const scene of st.model.scenes) if (!scene.spots.length) setAside(`spots:${scene.key}`);
  selectAdventureScene(st.model.scenes[0].key);
  render();
  await saveAdventure();
}

const gfield = (id, placeholder, on = {}) => h('input', {
  type: 'text', class: 'cfg-text', id, placeholder, ...on,
});
const onEnter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };
const later = (q, label = 'Later') => h('button', {
  class: 'quiet tiny', text: label, onclick: () => { setAside(q.id); render(); },
});

function nameCard(q) {
  const input = gfield('adventure-guide-name', 'A place');
  const done = () => {
    if (!input.value.trim()) return;
    const key = addScene(model(), input.value.trim());
    touched();
    selectAdventureScene(key);
    render();
  };
  input.addEventListener('keydown', onEnter(done));
  return [h('div', { class: 'guide-row' }, input, h('button', { class: 'filled tiny', text: 'Next', onclick: done }))];
}

// A picture for a place or a thing: the shelf, Draw it, Upload one, a plain
// card. No "Make one for me" here — that microhelper is the story's, and a
// place is on the shelf already in nine shapes.
function pictureCard(q) {
  const isItem = Boolean(q.item);
  const [width, height] = isItem ? ITEM : BACKDROP;
  const label = isItem ? q.item : q.scene;
  const plain = () => plainCard({
    width, height, label, face: false,
  });
  const picker = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: async (e) => {
      const file = e.currentTarget.files[0];
      e.currentTarget.value = '';
      if (!file) return;
      const png = await asPng(file, isItem ? UPLOAD_FITS.item : UPLOAD_FITS.backdrop);
      if (!png) { say('That one will not open as a picture.', true); return; }
      await putPicture(q, png);
    },
  });
  return [
    h('p', { class: 'hint muted', text: `It will be ${q.path}, ${width} by ${height}.` }),
    artShelf(isItem ? 'sprite' : 'background', (a, blob) => putPicture(q, blob, artCredit(a, q.path))),
    h('div', { class: 'row wrap guide-acts' },
      h('button', {
        class: 'filled tiny', text: 'Draw it', title: 'A blank picture, opened under Taste to draw on',
        onclick: async () => {
          if (q.scene) { const s = sceneOf(q.scene); if (s && s.picture !== q.path) { s.picture = q.path; touched(); } }
          if (await createPictureAt(q.path, width, height)) render();
        },
      }),
      h('button', { class: 'quiet tiny', text: 'Upload one', onclick: () => picker.click() }),
      h('button', {
        class: 'quiet tiny', text: 'A plain card for now',
        title: 'A card in the game\'s colours with the name on it, until there is a real picture',
        onclick: async () => putPicture(q, await plain()),
      }),
      later(q),
      picker),
  ];
}

// What is there to click on: the answer is a box on the stage, so the card
// says so and offers the one alternative, a box in the middle to drag about.
function spotsCard(q) {
  return [
    h('p', { class: 'hint muted', text: 'Drag a box on the picture around something — a door, a key, a person — then say what it does.' }),
    h('div', { class: 'row wrap guide-acts' },
      h('button', {
        class: 'filled tiny', text: '+ Add a spot', title: 'A box in the middle of the picture, to drag where it belongs',
        onclick: () => {
          const scene = sceneOf(q.scene);
          if (!scene) return;
          const size = sizes.get(scene.picture) ?? { width: 400, height: 200 };
          S.adventure.spot = addSpot(scene, [size.width / 4, size.height / 4, size.width / 2, size.height / 2]);
          touched();
          render();
        },
      }),
      later(q, q.later)),
  ];
}

const makeCard = (q) => [h('div', { class: 'row wrap guide-acts' },
  h('button', {
    class: 'filled tiny', text: 'Make it',
    onclick: () => {
      const key = addScene(model(), q.target);
      touched();
      selectAdventureScene(key);
      render();
    },
  }),
  later(q))];

const CARDS = {
  name: nameCard, picture: pictureCard, spots: spotsCard, make: makeCard, item: pictureCard,
};

let shown = { key: null, node: null };

function renderGuide() {
  const st = S.adventure;
  if (!st?.model) return null;
  const skipped = skippedSet();
  const q = nextQuestion(st.model, S.files.map((f) => f.path), skipped);
  const key = q ? `${S.slug}:${q.id}:${q.ask}` : (skipped.size ? `${S.slug}:ready` : null);
  if (!key) {
    shown = { key: null, node: null };
    return null;
  }
  if (shown.key !== key) {
    shown = {
      key,
      node: q
        ? h('div', { class: 'guide' },
          h('div', { class: 'guide-ask', text: q.ask }),
          ...CARDS[q.kind](q),
          emptyAdventure(st.model) ? h('button', {
            class: 'link tiny', text: 'Or put in an example adventure, to see how one is made',
            onclick: putInExample,
          }) : null)
        : h('div', { class: 'guide ready' },
          h('span', { class: 'guide-ask', text: 'Your adventure is ready.' }),
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'quiet tiny', text: 'Ask me again',
            onclick: () => { prefs.set(skipKey(), '[]'); render(); },
          }),
          h('button', {
            class: 'filled tiny', text: '▶ Try it',
            onclick: async () => {
              if (st.dirty && !(await saveAdventure())) return;
              S.tryScene = st.model.scenes[0]?.key ?? null;
              S.previewOpen = true;
              S.previewNonce += 1;
              render();
            },
          })),
    };
  }
  return shown.node;
}

/* The editor ----------------------------------------------------------------- */

const note = (...kids) => h('div', { class: 'story-editor adventure-editor' }, h('div', { class: 'pad muted' }, ...kids));

export function renderAdventureEditor() {
  const st = S.adventure;
  if (!st) return note(h('p', { text: 'Reading the adventure…' }));
  if (st.missing) {
    return note(h('p', { text: `There is no ${ADVENTURE_FILE} in this game, so there is no adventure to edit here.` }));
  }
  if (st.grown) {
    return note(
      h('p', { text: `${ADVENTURE_FILE} has grown past the adventure editor — ${st.grown}.` }),
      h('p', {}, h('button', {
        class: 'link', text: 'Open it under Taste', onclick: () => chooseFile(ADVENTURE_FILE),
      })),
    );
  }
  if (S.open?.path === ADVENTURE_FILE) {
    return note(h('p', { text: `${ADVENTURE_FILE} is open as text under Taste. Close it there to come back to the adventure.` }));
  }

  const { model: m } = st;
  const { scenes } = m;
  const ro = frozen();
  const paths = S.files.map((f) => f.path);
  const has = new Set(paths);
  const checks = adventureChecks(m, paths, sizes);
  const shape = adventureShape(m);
  const problemsFor = (key) => checks.filter((c) => c.where === key);
  const keys = scenes.map((s) => s.key);
  const switches = switchesOf(m);
  const items = itemsOf(m);

  /* The strip ---------------------------------------------------------------- */

  const tailOf = (scene) => (scene.spots.length ? plural(scene.spots.length, 'spot') : 'the end');

  const sceneRow = (scene, at) => {
    const problems = problemsFor(scene.key);
    const from = leadingTo(m, scene.key);
    return h('div', {
      class: `strip-row${!st.item && !st.title && st.scene === scene.key ? ' on' : ''}`,
      onclick: () => go(scene.key),
    },
    h('span', { class: 'sname mono', text: scene.key }),
    h('span', { class: 'tail' },
      at === 0 ? h('span', { class: 'hint muted', text: 'starts here' }) : null,
      problems.length ? h('span', {
        class: 'hint warn', text: `⚠ ${problems.length}`, title: problems.map((c) => c.say).join('\n'),
      }) : null,
      h('span', { class: 'hint muted', text: tailOf(scene) })),
    ro ? null : more(`scene:${scene.key}`, [
      at !== 0 && {
        text: 'Start here', title: 'Make this the scene the adventure starts at',
        onPick: () => { startAt(m, scene.key); touched(); render(); },
      },
      {
        text: 'Duplicate', title: 'A copy of this scene right after it',
        onPick: () => { const key = duplicateScene(m, scene.key); touched(); go(key); },
      },
      from.length === 0 && scenes.length > 1 && {
        text: 'Delete', danger: true,
        onPick: () => {
          m.scenes = scenes.filter((s) => s !== scene);
          touched();
          go(m.scenes[0]?.key);
        },
      },
    ], { label: `More about ${scene.key}` }));
  };

  // A thing is wherever a spot takes it, so a row has no ··· of its own:
  // taking it out is deleting or changing that spot.
  const itemRow = (item) => h('div', {
    class: `strip-row${st.item === item ? ' on' : ''}`,
    onclick: () => { st.item = item; st.title = false; render(); },
  },
  h('span', { class: 'sname', text: item }),
  h('span', { class: 'tail' }, h('span', {
    class: `hint ${has.has(itemPath(item)) ? 'muted' : 'warn'}`,
    text: has.has(itemPath(item)) ? 'has a picture' : 'no picture yet',
  })));

  const titleRow = st.words ? [
    h('div', { class: 'strip-head' }, h('span', { class: 'section-label', text: 'Title screen' })),
    h('div', {
      class: `strip-row${st.title ? ' on' : ''}`,
      onclick: () => { st.title = true; st.item = null; render(); },
    },
    h('span', { class: 'sname', text: st.words.title || '…' }),
    h('span', { class: 'tail' }, h('span', { class: 'hint muted', text: 'what the player sees first' }))),
  ] : null;

  const strip = h('div', { class: 'story-strip scroll', 'data-scroll': 'adventure-strip' },
    titleRow,
    h('div', { class: 'strip-head' },
      h('span', { class: 'section-label', text: 'Scenes' }),
      h('span', {
        class: `hint ${checks.length ? 'warn' : 'muted'}`,
        text: `${shape.scenes} · ${plural(shape.spots, 'spot')}${checks.length ? ` · ⚠ ${checks.length}` : ''}`,
        title: checks.length ? `${checks.length} to look at` : null,
      })),
    ...scenes.map(sceneRow),
    ro ? null : h('button', {
      class: 'quiet tiny', text: '+ Add a scene',
      onclick: () => { const key = addScene(m, ''); touched(); go(key); },
    }),
    items.length ? h('div', { class: 'strip-head' }, h('span', { class: 'section-label', text: 'Things' })) : null,
    ...items.map(itemRow));

  /* The spots ---------------------------------------------------------------- */

  const scene = st.item || st.title ? null : scenes.find((s) => s.key === st.scene);
  const spotsBox = h('div', { class: 'steps scroll', 'data-scroll': 'adventure-spots' });

  const rowOf = (i, cls, ...kids) => h('div', {
    class: `step ${cls}${st.spot === i ? ' on' : ''}`,
    onclick: (e) => {
      if (st.spot === i || e.target.closest('button, a')) return;
      st.spot = i;
      if (e.target.closest('input, select, textarea')) {
        for (const row of spotsBox.querySelectorAll('.step.on')) row.classList.remove('on');
        e.currentTarget.classList.add('on');
        return;
      }
      render();
    },
  }, ...kids);

  const spotRows = (sc) => {
    const rows = [];
    const sounds = filesUnder(SOUND_DIR, '.wav').map((p) => p.slice(SOUND_DIR.length + 1, -4));
    const spotMore = (i) => (ro ? null : more(`spot:${i}`, [
      i > 0 && { text: 'Move up', onPick: () => { moveSpot(sc, i, i - 1); st.spot = i - 1; touched(); render(); } },
      i < sc.spots.length - 1 && { text: 'Move down', onPick: () => { moveSpot(sc, i, i + 1); st.spot = i + 1; touched(); render(); } },
      { text: 'Delete', danger: true, onPick: () => { sc.spots.splice(i, 1); st.spot = 'scene'; touched(); render(); } },
    ], { label: 'More about this spot' }));

    const sayArea = (spot) => {
      const area = h('textarea', {
        class: 'cfg-text', id: 'adventure-say', rows: '2', disabled: ro,
        placeholder: spot.kind === 'take' ? 'What it says as it is picked up, if anything' : 'What is said. One line each.',
        oninput: (e) => {
          spot.say = e.currentTarget.value.split('\n').map((s) => s.trim()).filter(Boolean);
          if (!spot.say.length && spot.kind === 'say') spot.say = [''];
          touched();
        },
      });
      area.value = spot.say.join('\n');
      return area;
    };

    const spotRow = (spot, i) => {
      const open = st.spot === i;
      const order = i + 1;
      return rowOf(i, `line${open ? ' open' : ''}`,
        h('span', { class: 'glyph', text: GLYPH[spot.kind] }),
        h('span', { class: 'label', text: `Spot ${order}` }),
        open ? null : h('span', { class: `words${spot.kind === 'say' && !spot.say[0] ? ' muted' : ''}`, text: spotLabel(spot) }),
        open || !spot.need ? null : h('span', { class: 'hint muted', text: `only if ${spot.need}` }),
        spotMore(i),
        open ? h('div', { class: 'sub' },
          pick([['go', 'goes to'], ['say', 'says'], ['take', 'picks up']], spot.kind, (e) => {
            spot.kind = e.currentTarget.value;
            if (spot.kind === 'go') { spot.say = []; spot.take = ''; spot.keep = false; if (!spot.go) spot.go = keys.find((k) => k !== sc.key) ?? ''; }
            if (spot.kind === 'say') { spot.go = ''; spot.take = ''; spot.keep = false; if (!spot.say.length) spot.say = ['']; }
            if (spot.kind === 'take') { spot.go = ''; }
            touched();
            render();
          }),
          spot.kind === 'go' ? pick(keys.map((k) => [k, k]), spot.go, (e) => { spot.go = e.currentTarget.value; touched(); render(); }) : null,
          spot.kind === 'go' ? h('button', {
            class: 'link tiny', text: '→', title: `Open ${spot.go}`, disabled: !keys.includes(spot.go), onclick: () => go(spot.go),
          }) : null,
          spot.kind === 'take' ? field('adventure-take', spot.take, 'the thing', {
            onchange: (e) => { spot.take = freshKey(e.currentTarget.value, [], 'thing'); touched(); render(); },
          }) : null,
          spot.kind === 'take' ? h('label', { class: 'row hint' },
            h('input', {
              type: 'checkbox', checked: spot.keep, disabled: ro, id: 'adventure-keep',
              onchange: (e) => { spot.keep = e.currentTarget.checked; touched(); },
            }), ' stays after it is taken') : null) : null,
        open && spot.kind !== 'go' ? h('div', { class: 'sub' }, sayArea(spot)) : null,
        open ? h('div', { class: 'sub' },
          h('span', { class: 'hint muted', text: 'only if' }),
          pick([['', 'always'], ...switches.filter((s) => s !== spot.set).map((s) => [s, s])], spot.need,
            (e) => { spot.need = e.currentTarget.value; touched(); render(); }),
          h('span', { class: 'hint muted', text: 'remembers' }),
          field('adventure-set', spot.set, 'nothing', {
            onchange: (e) => { spot.set = e.currentTarget.value.trim().replace(/\s+/g, '_'); touched(); render(); },
          }),
          sounds.length || spot.sound ? h('span', { class: 'hint muted', text: 'sound' }) : null,
          sounds.length || spot.sound ? pick([['', 'none'], ...[...new Set([spot.sound, ...sounds])].filter(Boolean).map((s) => [s, s])], spot.sound,
            (e) => { spot.sound = e.currentTarget.value; touched(); render(); }) : null) : null);
    };
    rows.push(...sc.spots.map(spotRow));
    if (!ro) {
      rows.push(h('div', { class: 'row wrap add-line' },
        h('button', {
          class: 'quiet tiny', text: '+ Add a spot', title: 'A box in the middle of the picture, to drag where it belongs',
          onclick: () => {
            const size = sizes.get(sc.picture) ?? { width: 400, height: 200 };
            st.spot = addSpot(sc, [size.width / 4, size.height / 4, size.width / 2, size.height / 2]);
            touched();
            render();
          },
        }),
        h('span', { class: 'hint muted', text: 'or drag a box on the picture' })));
    }
    rows.push(...problemsFor(sc.key).map((c) => h('p', { class: 'hint warn problem', text: `⚠ ${c.say}` })));
    return rows;
  };

  if (st.title && st.words) {
    spotsBox.append(h('p', { class: 'hint muted problem' },
      `The title and the line under it are beside the preview. The End, the buttons and how to play are in ${WORDS_FILE} — `,
      h('button', { class: 'link tiny', text: 'open it under Taste', onclick: () => chooseFile(WORDS_FILE) }), '.'));
  } else if (st.item) {
    spotsBox.append(h('p', { class: 'hint muted problem', text: 'Its picture is beside the preview. It is picked up wherever a spot says so.' }));
  } else if (scene) {
    spotsBox.append(...spotRows(scene));
  } else {
    spotsBox.append(h('p', { class: 'muted', text: 'No scenes yet. Add one on the left.' }));
  }

  const bar = h('div', { class: 'editor-bar row' },
    h('span', { class: 'hint muted', id: 'adventure-status', text: st.dirty ? 'Saving…' : 'Saved' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'link', text: 'Show the text', title: `Open ${ADVENTURE_FILE} as text under Taste`,
      onclick: async () => {
        if (st.dirty && !(await saveAdventure())) return;
        await chooseFile(ADVENTURE_FILE);
      },
    }),
    scene ? h('button', {
      class: 'link', text: 'Try this scene', title: 'Play the game from this scene',
      onclick: async () => {
        if (st.dirty && !(await saveAdventure())) return;
        S.tryScene = scene.key;
        S.previewOpen = true;
        S.previewNonce += 1;
        // On a phone the preview is the rail, a pane away: go there.
        S.narrowPane = 'rail';
        render();
      },
    }) : null);

  return h('div', {
    class: 'story-editor adventure-editor',
    onfocusout: () => { if (S.adventure?.dirty) saveSoon(0); },
  },
  strip,
  // A scroller of its own on a phone (story-editor.css), so it has a name.
  h('div', { class: 'story-main', 'data-scroll': 'adventure-main' },
    renderGuide(),
    buildStage(st, scene),
    h('div', {
      class: 'stage-note hint muted',
      text: scene ? 'Drag a box on the picture to make a spot. Try this scene shows the real thing.' : '',
    }),
    spotsBox,
    bar));
}

/* The inspector -------------------------------------------------------------- */

// The selected thing's own fields, in the rail beside the preview: a scene's
// name, what leads to it, the note about it and its picture; a thing's
// picture; the title screen's two lines.
export function renderAdventureInspector() {
  const st = S.adventure;
  if (!st?.model || st.grown || st.missing || S.open?.path === ADVENTURE_FILE) return null;
  const { model: m } = st;
  const { scenes } = m;
  const has = new Set(S.files.map((f) => f.path));
  const keys = scenes.map((s) => s.key);
  const ro = frozen();
  const head = (kind, name) => h('div', { class: 'inspector-head' },
    h('span', { class: 'section-label', text: kind }),
    h('div', { class: 'iname', text: name }));
  const fieldRow = (label, ...kids) => h('div', { class: 'ifield' },
    h('span', { class: 'ilabel', text: label }), ...kids);
  const box = (...kids) => h('div', { class: 'inspector scroll', 'data-scroll': 'inspector' }, ...kids);

  if (st.title && st.words) {
    const w = st.words;
    const word = (key, id, label, placeholder) => fieldRow(label, field(id, w[key], placeholder, {
      oninput: (e) => { w[key] = e.currentTarget.value; w.dirty = true; touched(); },
    }));
    return box(head('Title screen', w.title || '…'),
      word('title', 'adventure-title', 'Title', 'What the adventure is called'),
      word('tagline', 'adventure-tagline', 'Under it', 'A line under the title'));
  }

  // The shelf as a dialog, for a place or a thing, landing at the path the
  // adventure expects.
  const pickFrom = (art, title, path, then) => {
    S.dialog = {
      kind: 'pick-picture',
      art,
      title,
      place: async (a, blob) => {
        const { failure } = await writeFiles([{ path, body: blob }]);
        if (failure) { say(failure, true); return; }
        say(artCredit(a, path));
        then?.();
        render();
      },
    };
    render();
  };

  if (st.item) {
    const path = itemPath(st.item);
    return box(head('Thing', st.item),
      fieldRow('Picture',
        has.has(path) ? thumb(path) : h('span', { class: 'hint warn', text: `no picture yet — it is shown as the word ${st.item}` }),
        h('span', { class: 'hint muted mono', text: path }),
        ro ? null : h('div', { class: 'row wrap' },
          has.has(path)
            ? h('button', { class: 'link tiny', text: 'Draw', title: `Open ${path} to draw on`, onclick: () => chooseFile(path) })
            : h('button', { class: 'link tiny', text: 'Draw one', title: `A blank ${ITEM[0]} by ${ITEM[1]} picture at ${path}`, onclick: () => createPictureAt(path, ...ITEM) }),
          h('button', { class: 'link tiny', text: 'Pick a thing…', onclick: () => pickFrom('sprite', 'Pick a thing', path) }))));
  }

  const scene = scenes.find((s) => s.key === st.scene);
  if (!scene) return null;
  const at = scenes.indexOf(scene);
  const from = leadingTo(m, scene.key);
  const size = sizes.get(scene.picture);
  return box(head('Scene', scene.key),
    fieldRow('Name', field('adventure-name', scene.key, 'a short name', {
      onchange: (e) => {
        const want = freshKey(e.currentTarget.value, keys.filter((k) => k !== scene.key));
        renameScene(m, scene.key, want);
        st.scene = want;
        touched();
        render();
      },
    })),
    fieldRow('Comes from', from.length
      ? h('div', { class: 'row wrap' }, ...from.map((k) => h('button', { class: 'link tiny mono', text: k, onclick: () => go(k) })))
      : h('span', { class: 'hint muted', text: at === 0 ? 'the start of the adventure' : 'nothing leads here' })),
    fieldRow('About', field('adventure-about', scene.about ?? '', 'A line about this place, for the studio and its helpers', {
      oninput: (e) => { scene.about = e.currentTarget.value; touched(); },
    })),
    fieldRow('Picture',
      scene.picture ? thumb(scene.picture) : null,
      h('div', { class: 'row wrap' },
        pick(
          [['', 'None'], ...filesUnder(IMAGE_DIR).map((p) => [p, p.slice(IMAGE_DIR.length + 1)])],
          scene.picture,
          (e) => { scene.picture = e.currentTarget.value; touched(); render(); },
        ),
        ro ? null : h('button', {
          class: 'link tiny', text: 'Pick a picture…', title: 'A place from the studio\'s shelf, saved for this scene',
          onclick: () => {
            const path = scene.picture || `${IMAGE_DIR}/${scene.key}.png`;
            pickFrom('background', 'Pick a picture', path, () => { scene.picture = path; touched(); });
          },
        })),
      scene.picture && !has.has(scene.picture) ? h('span', { class: 'hint warn', text: 'not in this game' }) : null,
      size ? h('span', { class: 'hint muted', text: `${size.width} by ${size.height} pixels — the spots are boxes on it` }) : null));
}

// For the preview's ?scene= and the address: the scene the reader is on.
export const adventureSceneNow = () => S.adventure?.scene ?? null;
export { cachedFileUrl };
