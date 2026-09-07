// The story editor: config/story.js as the centre pane of a visual novel,
// TyranoBuilder's three regions inside one tab beside the chats. The scene
// strip down the left; for the selected scene a stage showing what the player
// sees at the selected step, the steps as rows read top to bottom, and the
// editor bar under them. The model reading, the file writing, the checks and
// the stage arithmetic are story-editor.js; this is the interface, and the
// loading and saving around it. (It was a form in the rail once, and keeps
// the file's name; it is not a form any more.)
//
// Three rules from the rest of the studio. A step opens in its own row, and
// the click that selects it is the one that opens it. What lights up is what
// can be clicked. And typing repaints in place — the stage's words, the
// status line — while anything that changes the shape renders, because a
// render replaces the field under the fingers.
//
// Explicit Save, like every editor here: a save is a commit and a preview
// reload, so autosave would be a commit a keystroke. Unsaved edits are parked
// per game when the game is left and put back on return while the file is
// still the one they were made on — the composer's words are the one other
// thing git cannot recover, and a mis-click in the sidebar must not cost a
// scene (spec.md §6).

import {
  storyModel, storyText, storyChecks, storyShape, freshKey, renameScene, renameMood,
  stageFor, leadingTo, moveLine, startAt, addScene, addPerson, isSoundStep, soundStep,
  duplicateScene, titleWords, withTitleWords, WORDS_FILE,
} from './story-editor.js';
import { h } from './dom.js';
import {
  S, render, send, say, frozen, encodePath, commitNow, more, NO_CONNECTION,
} from './main.js';
import { refreshFiles, chooseFile } from './files.js';
import { createPictureAt } from './drawing.js';
import { renderGuide, artCredit } from './story-guide.js';
import { writeFiles } from './upload.js';

export const STORY_FILE = 'config/story.js';

const IMAGE_DIR = 'assets/images';
const SOUND_DIR = 'assets/sounds';
const MUSIC_DIR = 'assets/music';
const SPRITE_DIR = 'assets/sprites';

const portraitPath = (who, mood) => `${SPRITE_DIR}/${who}-${mood}.png`;

/* State --------------------------------------------------------------------- */

// Unsaved edits, parked when the game is left: the model as it stood, the etag
// it was made on, and where the reader was.
const parked = new Map();

// The stage's pictures as object URLs keyed by path — the reserved-images
// pattern, because the file routes send no-store and a stage rebuilt by every
// render would refetch on every keystroke. A miss is remembered too, so a
// picture the game does not have costs one 404 rather than one per paint.
// Dropped for the paths a files.changed names, and wholesale with the game.
const images = new Map();

export function dropStageImages(paths = null) {
  for (const [path, url] of images) {
    if (paths && !paths.includes(path)) continue;
    if (typeof url === 'string') URL.revokeObjectURL(url);
    images.delete(path);
  }
}

function imageUrl(path) {
  const held = images.get(path);
  if (held !== undefined) return held instanceof Promise ? held : Promise.resolve(held);
  const slug = S.slug;
  const loading = send(`/api/projects/${slug}/files/${encodePath(path)}`)
    .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
    .then((url) => {
      // A slow read must not dress the game opened after it.
      if (S.slug !== slug) {
        if (url) URL.revokeObjectURL(url);
        return null;
      }
      images.set(path, url);
      return url;
    });
  images.set(path, loading);
  return loading;
}

// Point an <img> at a file in the game, through the cache. Only when the path
// changes, or the browser restarts the load and the picture blinks.
function setPicture(img, path) {
  const want = path || '';
  if (img.dataset.path === want) return;
  img.dataset.path = want;
  img.hidden = true;
  img.removeAttribute('src');
  if (!want) return;
  imageUrl(want).then((url) => {
    if (img.dataset.path !== want || !url) return;
    img.src = url;
    img.hidden = false;
  });
}

// Where the reader is: a scene, and a step in it. Also what a followed URL
// sets, so a key that is gone falls back to the first scene rather than to
// nothing.
export function selectScene(key, step = 'scene') {
  const st = S.story;
  if (!st?.model) return;
  const has = st.model.scenes.some((s) => s.key === key);
  // Leaving a scene is where a version belongs (spec.md §5): what was typed
  // here lands as one commit rather than riding on with the next scene's.
  const leaving = has && st.scene !== null && st.scene !== key;
  st.person = null;
  st.title = false;
  st.scene = has ? key : (st.model.scenes[0]?.key ?? null);
  st.step = step;
  if (leaving) (st.dirty ? saveStory() : Promise.resolve()).then(() => commitNow());
}

/* Loading and saving --------------------------------------------------------- */

// The title screen's words, from config/words.js: the file's text and etag
// for the splice back, and the two lines as they stand here. Null when the
// game has no such file or a helper has reshaped it past the two lines — then
// there is no title row, rather than a wrong one. Typed changes are kept over
// a re-read, because a re-read happens when the file changed underneath and
// Save has to be asked again.
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

// Read the story off the disk into S.story. Run when the game opens and when
// the file changes underneath; a reload keeps the reader's place when the
// scene is still there. ⚠️ The story on screen stays put until the new one is
// ready: a render landing mid-read — a save's own refresh does — would write
// the address without its scene, as a new entry, and the reload would write
// it back as another.
export async function loadStory() {
  const slug = S.slug;
  const was = S.story;
  if (!S.files.some((f) => f.path === STORY_FILE)) {
    S.story = { grown: `${STORY_FILE} is not in this game`, missing: true };
    return;
  }
  // Edits parked on the way out come back while the file is the one they were
  // made on. Otherwise they are gone, and that is said rather than left to be
  // discovered.
  const kept = parked.get(slug);
  parked.delete(slug);
  const [res, words] = await Promise.all([
    send(`/api/projects/${slug}/files/${encodePath(STORY_FILE)}`),
    loadWords(slug, kept?.words),
  ]);
  if (S.slug !== slug) return;
  if (!res.ok) {
    S.story = { grown: res.status === 0 ? NO_CONNECTION : `the studio could not read ${STORY_FILE}` };
    return;
  }
  const text = await res.text();
  if (S.slug !== slug) return;
  const etag = res.headers.get('etag');
  const read = storyModel(text);
  if (!read.ok) {
    S.story = { grown: read.reason };
    return;
  }

  if (kept && kept.etag === etag) {
    S.story = {
      text, etag, model: kept.model, words, dirty: true, scene: null, step: 'scene', person: null,
    };
    selectScene(kept.scene, kept.step);
    S.story.person = kept.person;
    S.story.title = kept.title;
    return;
  }
  if (kept) {
    say(`${STORY_FILE} changed since you were last here, so the story edits you had not saved were dropped.`, true);
  }
  S.story = {
    text, etag, model: { cast: read.cast, scenes: read.scenes }, words, dirty: Boolean(words?.dirty),
    scene: null, step: 'scene', person: null,
  };
  selectScene(was?.scene ?? read.scenes[0]?.key, was?.scene ? was.step : 'scene');
  S.story.title = Boolean(was?.title);
}

// Called on the way out of a game, before the slug moves.
export function parkStory() {
  const st = S.story;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, {
    model: st.model, etag: st.etag, scene: st.scene, step: st.step, person: st.person,
    words: st.words, title: st.title,
  });
}

// The file changed on disk — a helper's commit, a save in the rail, a version
// brought back. Re-read it, unless there is unsaved work here, in which case
// the work stays and the next save asks before overwriting. Our own save's
// write arrives this way too, usually before the PUT answers: while a save is
// in flight the answer to it is the truth, so the event is left alone.
export function storyChanged() {
  const st = S.story;
  if (st?.saving) return;
  if (st?.model && st.dirty) {
    st.stale = true;
    say(`${STORY_FILE} changed while you were working on it. What you have is still here — the studio will ask which to keep when it saves.`);
    render();
    return;
  }
  loadStory().then(render);
}

// True when it landed. A 409 opens the conflict dialog, which comes back here
// with force or through discardStory. The save is a write, not yet a version:
// the commit follows on its own (spec.md §5). `keepalive` for the tab closing.
export async function saveStory({ force = false, keepalive = false } = {}) {
  const st = S.story;
  if (!st?.model) return false;
  // This is the save the timer was waiting to make.
  clearTimeout(saveTimer);
  saveTimer = null;
  // The title screen first, when it changed: its own file, its own commit.
  // A 409 here is not the story's conflict dialog — the file is re-read with
  // the typed lines kept over it, and the next Save lands them.
  if (st.words?.dirty && !(await saveWords(st))) return false;
  const text = storyText(st.model);
  // Nothing in the story itself changed — a title edit alone — so no commit
  // that changes nothing.
  if (text === st.text && !force) {
    st.dirty = false;
    S.previewNonce += 1;
    await refreshFiles();
    return true;
  }
  const headers = { 'content-type': 'text/plain' };
  if (!force && st.etag) headers['if-match'] = st.etag;
  st.saving = true;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(STORY_FILE)}`, {
    method: 'PUT', headers, body: text, keepalive,
  });
  const body = await res.json().catch(() => null);
  st.saving = false;
  if (res.status === 409) {
    S.dialog = { kind: 'story-conflict' };
    render();
    return false;
  }
  if (!res.ok) {
    say(res.status === 0 ? NO_CONNECTION : (body?.error ?? 'Could not save the story.'), true);
    return false;
  }
  // Only the editor that asked may finish the job: the commit is a
  // files.changed, and the game may have changed under it since.
  if (S.story === st) {
    st.etag = body.etag;
    st.text = text;
    // Typed during the save: the model is ahead of what landed, so it is
    // still dirty and goes in at the next quiet moment.
    st.dirty = storyText(st.model) !== text;
    st.stale = false;
    if (st.dirty) saveSoon();
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${STORY_FILE}.`);
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
    if (S.story === st) st.words = await loadWords(S.slug, w);
    say(`${WORDS_FILE} changed underneath — your title is still here, press Save again to keep it.`, true);
    render();
    return false;
  }
  if (!res.ok) {
    say(res.status === 0 ? NO_CONNECTION : (body?.error ?? `Could not save ${WORDS_FILE}.`), true);
    return false;
  }
  if (S.story === st) {
    w.text = text;
    w.etag = body.etag;
    w.dirty = false;
  }
  say(`Saved ${WORDS_FILE}.`);
  return true;
}

// Keep theirs: the unsaved work goes, and the file on disk is read again.
export async function discardStory() {
  if (S.story) S.story.dirty = false;
  await loadStory();
  render();
}

/* Repainting in place -------------------------------------------------------- */

// The stage's live nodes, while the editor is on screen. Null means a repaint
// has nothing to paint into.
let stageNodes = null;

// Every edit comes through here: the model changed, the file will be
// different, the stage and the status say so at once, and the save follows on
// its own — two seconds after the last edit, or sooner on the way out of a
// field, a scene, the editor or the game (spec.md §5). There is no Save
// button. The guide's answers come through it too, as storyEdited.
export { touched as storyEdited };

const AUTOSAVE_MS = 2000;
let saveTimer = null;

function touched() {
  const st = S.story;
  st.dirty = true;
  const status = document.getElementById('story-status');
  if (status) status.textContent = 'Saving…';
  paintStage();
  saveSoon();
}

// A save after `delay` of quiet; another edit pushes it back.
export function saveSoon(delay = AUTOSAVE_MS) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (S.story?.dirty && !frozen()) saveStory();
  }, delay);
}

// A person on the stage: their portrait at the selected mood, and their name.
function personView(st) {
  const person = st.model.cast.find((p) => p.key === st.person);
  if (!person) return null;
  const mood = person.moods[Number.isInteger(st.step) ? st.step : 0] ?? person.moods[0];
  return {
    picture: '',
    portrait: mood ? portraitPath(person.key, mood) : '',
    who: person.name || person.key,
    say: mood ? `Looking ${mood}.` : 'No moods yet, so this person is never shown.',
    choices: [], go: '', end: false,
  };
}

// The title screen as the stage can draw it: the tagline small over the title,
// and the Begin button as the one choice. Close, not exact — Screens.title()
// is the real thing, and Save shows it.
const titleView = ({ words }) => ({
  picture: '', portrait: '', who: words.tagline, say: words.title || '…', sound: '',
  choices: [{ say: words.start, need: '' }], go: '', end: false,
});

function paintStage() {
  if (!stageNodes) return;
  const st = S.story;
  const view = (st.title && st.words ? titleView(st) : st.person ? personView(st) : stageFor(st.model, st.scene, st.step))
    ?? {
      picture: '', portrait: '', who: '', say: '', sound: '', choices: [], go: '', end: false,
    };
  const n = stageNodes;
  setPicture(n.picture, view.picture);
  setPicture(n.portrait, view.portrait);
  n.who.textContent = view.who;
  n.who.hidden = !view.who;
  n.say.textContent = view.say;
  // A noise is heard, not seen — the words that are still up stay up, and
  // this says what is playing over them.
  n.sound.textContent = view.sound ? `♪ ${view.sound}` : '';
  n.sound.hidden = !view.sound;
  // Through h() rather than replaceChildren, which would write a skipped
  // child as the word "null".
  n.choices.replaceChildren(...h('div', {},
    view.choices.map((c) => h('span', { class: 'choice' },
      c.say || '…',
      c.need ? h('small', { text: ` only if ${c.need}` }) : null)),
    view.go ? h('span', { class: 'goes muted', text: `→ ${view.go}` }) : null,
    view.end ? h('span', { class: 'goes muted', text: 'the end' }) : null,
  ).childNodes);
}

function buildStage() {
  const picture = h('img', { class: 'picture', alt: '' });
  const portrait = h('img', { class: 'portrait', alt: '' });
  const who = h('p', { class: 'who' });
  const words = h('p', { class: 'say' });
  const choices = h('div', { class: 'choices' });
  const sound = h('p', { class: 'heard' });
  stageNodes = {
    picture, portrait, who, say: words, sound, choices,
  };
  paintStage();
  return h('div', { class: 'stage' }, picture, portrait,
    h('div', { class: 'box' }, who, words, sound, choices));
}

/* Controls ------------------------------------------------------------------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Ids on the fields are what carry the caret across a background render
// (main.js keeps the focus of anything called story-…). Read-only — somebody
// else's game, an archived one — is a field you can read and not type in; a
// button you could not press is left out instead (spec.md §6).
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
  setPicture(img, path);
  return img;
};
// Hear it where it stands, through the same cache the pictures use — the
// file routes send no-store, so a fresh <audio src> per render would refetch
// the whole track on every keystroke.
const play = (path) => h('button', {
  class: 'icon tiny', text: '▶', title: `Play ${path.split('/').pop()}`,
  onclick: () => {
    imageUrl(path).then((url) => { if (url) new Audio(url).play(); });
  },
});
const go = (key) => { selectScene(key); render(); };

// Shared with Pics and Hear (main.js): the same picture cache — dropped for
// the paths a files.changed names, wholesale with the game — and the same
// way to hear a file.
export {
  setPicture as pictureInto, imageUrl as cachedFileUrl, play as playButton, thumb as pictureThumb,
};

/* The editor ----------------------------------------------------------------- */

const note = (...kids) => h('div', { class: 'story-editor' }, h('div', { class: 'pad muted' }, ...kids));

export function renderStoryEditor() {
  stageNodes = null;
  const st = S.story;
  if (!st) return note(h('p', { text: 'Reading the story…' }));
  if (st.missing) {
    return note(h('p', { text: `There is no ${STORY_FILE} in this game, so there is no story to edit here.` }));
  }
  if (st.grown) {
    return note(
      h('p', { text: `${STORY_FILE} has grown past the story editor — ${st.grown}.` }),
      h('p', {}, h('button', {
        class: 'link', text: 'Open it under Taste', onclick: () => chooseFile(STORY_FILE),
      })),
    );
  }
  // One editor for the file at a time: while its text is open under Code,
  // this one waits rather than saving over what is typed there.
  if (S.open?.path === STORY_FILE) {
    return note(h('p', { text: `${STORY_FILE} is open as text under Taste. Close it there to come back to the story.` }));
  }

  const { model } = st;
  const { cast, scenes } = model;
  const ro = frozen();
  const paths = S.files.map((f) => f.path);
  const has = new Set(paths);
  const checks = storyChecks(model, paths);
  const shape = storyShape(model);
  const problemsFor = (key) => checks.filter((c) => c.where === key);
  const keys = scenes.map((s) => s.key);
  const switches = [...new Set(
    scenes.flatMap((s) => s.choices.map((c) => c.set)).filter(Boolean),
  )].sort();

  /* The strip ---------------------------------------------------------------- */

  const afterOf = (scene) => (scene.choices.length ? 'choices' : scene.go ? 'go' : 'end');
  const tailOf = (scene) => {
    const after = afterOf(scene);
    if (after === 'choices') return plural(scene.choices.length, 'choice');
    return after === 'go' ? `→ ${scene.go}` : 'the end';
  };

  // Two lines a row — the name, then what is known about it — because at the
  // strip's width a name beside "starts here · 3 choices" was three letters.
  // The row's ··· holds what can be done to the scene, and nothing that
  // cannot (spec.md §6): Start here is absent on the first scene, Delete
  // while anything still leads here or it is the last one. Its name, its
  // note, its picture and its music are the inspector's, beside the preview.
  const sceneRow = (scene, at) => {
    const problems = problemsFor(scene.key);
    const from = leadingTo(model, scene.key);
    return h('div', {
      class: `strip-row${!st.person && !st.title && st.scene === scene.key ? ' on' : ''}`,
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
        text: 'Start here', title: 'Make this the scene the story starts at',
        onPick: () => { startAt(model, scene.key); touched(); render(); },
      },
      // A copy for a choice that keeps the player here — the shape has no
      // lines after a choice, so "the door is locked" is a second scene.
      {
        text: 'Duplicate', title: 'A copy of this scene right after it — for a choice that keeps the player here',
        onPick: () => { const key = duplicateScene(model, scene.key); touched(); go(key); },
      },
      from.length === 0 && scenes.length > 1 && {
        text: 'Delete', danger: true,
        onPick: () => {
          model.scenes = scenes.filter((s) => s !== scene);
          touched();
          go(model.scenes[0]?.key);
        },
      },
    ], { label: `More about ${scene.key}` }));
  };

  // Somebody still saying lines cannot be taken out, so a person who is has
  // no ··· at all rather than a Delete that refuses.
  const personRow = (person) => {
    const used = scenes.reduce((n, s) => n + s.lines.filter((l) => l.who === person.key).length, 0);
    return h('div', {
      class: `strip-row${st.person === person.key ? ' on' : ''}`,
      onclick: () => { st.person = person.key; st.title = false; st.step = 0; render(); },
    },
    h('span', { class: 'sname', text: person.name || person.key }),
    h('span', { class: 'tail' }, h('span', { class: 'hint muted', text: plural(person.moods.length, 'mood') })),
    ro || used > 0 ? null : more(`person:${person.key}`, [{
      text: 'Delete', danger: true, title: 'Take them out of the story',
      onPick: () => { model.cast = cast.filter((p) => p !== person); touched(); go(st.scene); },
    }], { label: `More about ${person.name || person.key}` }));
  };

  // The title screen is the first thing a player sees and the one thing here
  // that is not a scene: its two lines live in config/words.js, and until this
  // row the only way to change "My Story" was to find that file on the right.
  const titleRow = st.words ? [
    h('div', { class: 'strip-head' }, h('span', { class: 'section-label', text: 'Title screen' })),
    h('div', {
      class: `strip-row${st.title ? ' on' : ''}`,
      onclick: () => { st.title = true; st.person = null; st.step = 'title'; render(); },
    },
    h('span', { class: 'sname', text: st.words.title || '…' }),
    h('span', { class: 'tail' }, h('span', { class: 'hint muted', text: 'what the player sees first' }))),
  ] : null;

  const strip = h('div', { class: 'story-strip scroll', 'data-scroll': 'story-strip' },
    titleRow,
    h('div', { class: 'strip-head' },
      h('span', { class: 'section-label', text: 'Scenes' }),
      h('span', {
        class: `hint ${checks.length ? 'warn' : 'muted'}`,
        text: `${shape.scenes} · ${plural(shape.endings, 'ending')}`
          + (checks.length ? ` · ⚠ ${checks.length}` : ''),
        title: checks.length ? `${checks.length} to look at` : null,
      })),
    ...scenes.map(sceneRow),
    ro ? null : h('button', {
      class: 'quiet tiny', text: '+ Add a scene',
      onclick: () => {
        const key = addScene(model, '');
        touched();
        go(key);
      },
    }),
    h('div', { class: 'strip-head' }, h('span', { class: 'section-label', text: 'People' })),
    ...cast.map(personRow),
    ro ? null : h('button', {
      class: 'quiet tiny', text: '+ Add someone',
      onclick: () => {
        const key = addPerson(model, '');
        touched();
        st.person = key;
        st.step = 0;
        render();
      },
    }));

  /* The steps ---------------------------------------------------------------- */

  const stepsBox = h('div', { class: 'steps scroll', 'data-scroll': 'story-steps' });

  // Selecting a step opens it in its row. A click on a field inside a row
  // selects the row as well, in place: a render there would rebuild the
  // field under the pointer — a select closing as it opened. A button's click
  // is the button's alone: ▲ has already moved the line and rendered by the
  // time its click reaches the row it used to be in, and a row that then
  // "selected" itself put the wrong line on the stage.
  const rowOf = (step, cls, ...kids) => h('div', {
    class: `step ${cls}${st.step === step ? ' on' : ''}`,
    onclick: (e) => {
      if (st.step === step || e.target.closest('button, a')) return;
      st.step = step;
      if (e.target.closest('input, select, textarea')) {
        for (const row of stepsBox.querySelectorAll('.step.on')) row.classList.remove('on');
        e.currentTarget.classList.add('on');
        paintStage();
        return;
      }
      render();
    },
  }, ...kids);

  // What happens in the scene, top to bottom. The scene's own fields — its
  // name, what leads here, the note about it, its picture and its music —
  // are the inspector's, beside the preview (renderStoryInspector below).
  const sceneSteps = (scene) => {
    const rows = [];

    // One row per step. Closed, it reads as the player would hear it; open,
    // it is who, mood and the words — or, for a sound, which noise. Rows drag
    // into order by their handle, and the ··· is the keyboard's way. Both
    // kinds are one list, so a noise drags in between two lines and back out.
    const sounds = filesUnder(SOUND_DIR, '.wav')
      .map((p) => p.slice(SOUND_DIR.length + 1, -4));
    let dragFrom = null;

    const handleFor = (i, what) => h('span', {
      class: 'handle', text: '≡', title: `Drag to move this ${what}`,
      draggable: ro ? null : 'true',
      ondragstart: (e) => {
        dragFrom = i;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      },
    });

    // Move up, move down, delete — the same three whichever kind of step it
    // is, behind the row's ··· (spec.md §6), with the end of the list saying
    // so by leaving a move out.
    const stepMore = (i, what) => (ro ? null : more(`line:${i}`, [
      i > 0 && {
        text: 'Move up',
        onPick: () => { moveLine(scene, i, i - 1); st.step = i - 1; touched(); render(); },
      },
      i < scene.lines.length - 1 && {
        text: 'Move down',
        onPick: () => { moveLine(scene, i, i + 1); st.step = i + 1; touched(); render(); },
      },
      {
        text: 'Delete', danger: true,
        onPick: () => { scene.lines.splice(i, 1); st.step = 'scene'; touched(); render(); },
      },
    ], { label: `More about this ${what}` }));

    // A drop lands wherever the pointer is, so every row takes the wiring
    // whatever it holds.
    const draggable = (row, i) => {
      if (ro) return row;
      row.addEventListener('dragover', (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        row.classList.add('drop');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        moveLine(scene, dragFrom, i);
        st.step = i;
        dragFrom = null;
        touched();
        render();
      });
      return row;
    };

    // A noise, at the moment it happens. It says nothing and nobody speaks
    // it, so the row is the sound's name and a way to hear it — and the
    // player carries straight on past it rather than waiting for a tap.
    const soundRow = (line, i) => {
      const open = st.step === i;
      const path = `${SOUND_DIR}/${line.sound}.wav`;
      return draggable(rowOf(i, `line noise${open ? ' open' : ''}`,
        handleFor(i, 'sound'),
        h('span', { class: 'thumb glyph', text: '♪' }),
        pick(
          // No "none": a step with no sound is not a step. ✕ removes it.
          [...new Set([line.sound, ...sounds])].map((s) => [s, s]),
          line.sound,
          (e) => { line.sound = e.currentTarget.value; touched(); render(); },
        ),
        play(path),
        has.has(path) ? null : h('span', { class: 'hint warn', text: 'not in this game' }),
        stepMore(i, 'sound')), i);
    };

    const lineRow = (line, i) => {
      if (isSoundStep(line)) return soundRow(line, i);
      const person = cast.find((p) => p.key === line.who);
      const open = st.step === i;
      const row = rowOf(i, `line${open ? ' open' : ''}`,
        handleFor(i, 'line'),
        line.who && line.mood ? thumb(portraitPath(line.who, line.mood)) : h('span', { class: 'thumb' }),
        open ? null : h('span', { class: `speaker${person ? '' : ' muted'}`, text: person ? (person.name || person.key) : (line.who || 'the story') }),
        open ? null : h('span', { class: `words${line.say ? '' : ' muted'}`, text: line.say || '…' }),
        stepMore(i, 'line'),
        open ? h('div', { class: 'sub' },
          pick(
            [['', 'The story'], ...cast.map((p) => [p.key, p.name || p.key])],
            line.who,
            (e) => {
              line.who = e.currentTarget.value;
              // A mood belongs to a person: keep it only if the new one has it.
              const moods = cast.find((p) => p.key === line.who)?.moods ?? [];
              if (!moods.includes(line.mood)) line.mood = moods[0] ?? '';
              touched();
              render();
            },
          ),
          person ? pick(
            [['', 'no picture'], ...person.moods.map((m) => [m, m])],
            line.mood,
            (e) => { line.mood = e.currentTarget.value; touched(); render(); },
          ) : null) : null,
        open ? h('div', { class: 'sub' }, (() => {
          const area = h('textarea', {
            class: 'cfg-text', id: 'story-say', rows: '2', placeholder: 'What is said', disabled: ro,
            oninput: (e) => { line.say = e.currentTarget.value; touched(); },
          });
          area.value = line.say;
          return area;
        })()) : null);
      return draggable(row, i);
    };
    rows.push(...scene.lines.map(lineRow));
    if (!ro) rows.push(h('div', { class: 'row wrap add-line' },
      h('button', {
        class: 'quiet tiny', text: '+ Add a line',
        onclick: () => {
          scene.lines.push({
            who: '', mood: '', say: '', sound: '',
          });
          st.step = scene.lines.length - 1;
          touched();
          render();
        },
      }),
      // Left out rather than disabled when the game has no sounds yet: the
      // answer is "+ Make a sound" over on the right, and a dead button in
      // the timeline would not say so.
      sounds.length ? h('button', {
        class: 'quiet tiny', text: '+ Add a sound',
        title: 'A noise at this point in the scene',
        onclick: () => {
          scene.lines.push(soundStep(sounds[0]));
          st.step = scene.lines.length - 1;
          touched();
          render();
        },
      }) : null));

    // The exit: what happens after the last line. The three are exclusive in
    // the file, so switching empties the other two.
    const AFTER = [
      ['choices', 'the player chooses'],
      ['go', 'go straight on to'],
      ['end', 'the story ends here'],
    ];
    const after = afterOf(scene);
    const elsewhere = keys.find((k) => k !== scene.key) ?? scene.key;
    const setAfter = (want) => {
      scene.choices = want === 'choices'
        ? [{ say: '', go: elsewhere, set: '', need: '' }]
        : [];
      scene.go = want === 'go' ? (keys.find((k) => k !== scene.key) ?? '') : '';
      touched();
      render();
    };
    const choiceRow = (choice, ci) => h('div', { class: 'sub choice-row' },
      field(`story-choice-${ci}`, choice.say, 'What the button says', {
        oninput: (e) => { choice.say = e.currentTarget.value; touched(); },
      }),
      h('span', { class: 'hint muted', text: 'goes to' }),
      pick(keys.map((k) => [k, k]), choice.go, (e) => {
        choice.go = e.currentTarget.value;
        touched();
        render();
      }),
      h('button', {
        class: 'link tiny', text: '→', title: `Open ${choice.go}`,
        disabled: !keys.includes(choice.go),
        onclick: () => go(choice.go),
      }),
      h('span', { class: 'hint muted', text: 'remembers' }),
      field(`story-set-${ci}`, choice.set, 'nothing', {
        onchange: (e) => { choice.set = e.currentTarget.value.trim(); touched(); render(); },
      }),
      h('span', { class: 'hint muted', text: 'only if' }),
      pick(
        [['', 'always'], ...switches.map((s) => [s, s])],
        choice.need,
        (e) => { choice.need = e.currentTarget.value; touched(); render(); },
      ),
      ro ? null : more(`choice:${ci}`, [{
        text: 'Delete', danger: true,
        onPick: () => { scene.choices.splice(ci, 1); touched(); render(); },
      }], { label: 'More about this choice' }));

    rows.push(rowOf('exit', `exit${st.step === 'exit' ? ' open' : ''}`,
      h('span', { class: 'glyph', text: '⇢' }),
      h('span', { class: 'label', text: 'Then' }),
      pick(AFTER, after, (e) => setAfter(e.currentTarget.value)),
      after === 'go' ? pick(
        keys.filter((k) => k !== scene.key).map((k) => [k, k]),
        scene.go,
        (e) => { scene.go = e.currentTarget.value; touched(); render(); },
      ) : null,
      after === 'go' ? h('button', {
        class: 'link tiny', text: '→', title: `Open ${scene.go}`,
        disabled: !keys.includes(scene.go),
        onclick: () => go(scene.go),
      }) : null,
      ...(after === 'choices' ? scene.choices.map(choiceRow) : []),
      after === 'choices' && !ro ? h('div', { class: 'sub' }, h('button', {
        class: 'quiet tiny', text: '+ Add a choice',
        onclick: () => {
          scene.choices.push({ say: '', go: elsewhere, set: '', need: '' });
          touched();
          render();
        },
      })) : null));

    rows.push(...problemsFor(scene.key).map((c) => h('p', { class: 'hint warn problem', text: `⚠ ${c.say}` })));
    return rows;
  };

  /* A person ----------------------------------------------------------------- */

  // A person is all the inspector's — their name, the note about them and
  // their moods (renderPersonInspector); the stage shows the mood the step
  // names. Taking them out is the strip row's ···.
  const personSteps = () => [
    h('p', {
      class: 'hint muted problem',
      text: 'Their name, the note about them and their moods are beside the preview.',
    }),
  ];

  /* The title screen ------------------------------------------------------------ */

  // Its two lines are the inspector's, beside the preview. The rest of that
  // file — the End, the buttons, how to play — stays the config form's, under
  // Code.
  const titleSteps = () => [
    h('p', { class: 'hint muted problem' },
      `The title and the line under it are beside the preview. The End, the buttons and how to play are in ${WORDS_FILE} — `,
      h('button', { class: 'link tiny', text: 'open it under Taste', onclick: () => chooseFile(WORDS_FILE) }),
      '.'),
  ];

  /* Put together -------------------------------------------------------------- */

  const showTitle = st.title && st.words;
  const scene = st.person || showTitle ? null : scenes.find((s) => s.key === st.scene);
  const person = st.person ? cast.find((p) => p.key === st.person) : null;
  if (showTitle) stepsBox.append(...titleSteps());
  else if (person) stepsBox.append(...personSteps(person));
  else if (scene) stepsBox.append(...sceneSteps(scene));
  else stepsBox.append(h('p', { class: 'muted', text: 'No scenes yet. Add one on the left.' }));

  // No Save: the story saves itself (touched, above). The whisper is the
  // only sign, and it says "Saved" nearly all the time.
  const bar = h('div', { class: 'editor-bar row' },
    h('span', { class: 'hint muted', id: 'story-status', text: st.dirty ? 'Saving…' : 'Saved' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'link', text: 'Show the text', title: `Open ${STORY_FILE} as text under Taste`,
      onclick: async () => {
        if (st.dirty && !(await saveStory())) return;
        await chooseFile(STORY_FILE);
      },
    }),
    scene ? h('button', {
      class: 'link', text: 'Try this scene', title: 'Play the game from this scene',
      onclick: async () => {
        if (st.dirty && !(await saveStory())) return;
        S.tryScene = scene.key;
        S.previewOpen = true;
        S.previewNonce += 1;
        render();
      },
    }) : null);

  // Leaving a field saves what was typed in it without waiting out the quiet.
  return h('div', {
    class: 'story-editor',
    onfocusout: () => { if (S.story?.dirty) saveSoon(0); },
  },
    strip,
    h('div', { class: 'story-main' },
      // The guide's one question, when it has one, over everything else.
      renderGuide(),
      buildStage(),
      h('div', {
        class: 'stage-note hint muted',
        text: 'Close to what the player sees — Try this scene shows the real thing.',
      }),
      stepsBox,
      bar));
}

/* The inspector -------------------------------------------------------------- */

// The selected thing's own fields, in the rail beside the preview (spec.md
// §6): a scene's name, what leads to it, the note about it, its picture and
// its music; a person's name and note; the title screen's two lines. These
// were the head rows of the steps; moved so the middle is what happens and
// the side is what it is about. The fields keep their story-… ids, so the
// caret survives a render here as it does in the middle, and every edit saves
// the way every edit does: touched().
export function renderStoryInspector() {
  const st = S.story;
  if (!st?.model || st.grown || st.missing || S.open?.path === STORY_FILE) return null;
  const { model } = st;
  const { cast, scenes } = model;
  const has = new Set(S.files.map((f) => f.path));
  const keys = scenes.map((s) => s.key);
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
      word('title', 'story-title', 'Title', 'What the story is called'),
      word('tagline', 'story-tagline', 'Under it', 'A line under the title'));
  }

  if (st.person) return renderPersonInspector(cast.find((p) => p.key === st.person));

  const scene = scenes.find((s) => s.key === st.scene);
  if (!scene) return null;
  const at = scenes.indexOf(scene);
  const from = leadingTo(model, scene.key);
  return box(head('Scene', scene.key),
    fieldRow('Name', field('story-name', scene.key, 'a short name', {
      onchange: (e) => {
        const want = freshKey(e.currentTarget.value, keys.filter((k) => k !== scene.key));
        renameScene(model, scene.key, want);
        st.scene = want;
        touched();
        render();
      },
    })),
    fieldRow('Comes from', from.length
      ? h('div', { class: 'row wrap' }, ...from.map((k) => h('button', {
        class: 'link tiny mono', text: k, onclick: () => go(k),
      })))
      : h('span', { class: 'hint muted', text: at === 0 ? 'the start of the story' : 'nothing leads here' })),
    fieldRow('About', field('story-about', scene.about ?? '', 'A line about this place, for the studio and its helpers', {
      oninput: (e) => { scene.about = e.currentTarget.value; touched(); },
    })),
    // The picture: the game's own to choose from — anything added under
    // assets/images/ (Pics' Add a picture, which can also pick one from the
    // studio's shelf) shows up here to select for the scene.
    fieldRow('Picture',
      scene.picture ? thumb(scene.picture) : null,
      h('div', { class: 'row wrap' },
        pick(
          [['', 'None'], ...filesUnder(IMAGE_DIR).map((p) => [p, p.slice(IMAGE_DIR.length + 1)])],
          scene.picture,
          (e) => { scene.picture = e.currentTarget.value; touched(); render(); },
        )),
      scene.picture && !has.has(scene.picture)
        ? h('span', { class: 'hint warn', text: 'not in this game' }) : null),
    // Music belongs to the whole scene the way the picture does — it keeps
    // playing into the next scene that asks for the same track. None first
    // and the only thing offered until somebody uploads a track: a picker
    // listing music the game does not have would name files nothing plays.
    fieldRow('Music',
      h('div', { class: 'row wrap' },
        pick(
          [['', 'None'], ...filesUnder(MUSIC_DIR).map((p) => [p, p.slice(MUSIC_DIR.length + 1)])],
          scene.music,
          (e) => { scene.music = e.currentTarget.value; touched(); render(); },
        ),
        scene.music ? play(scene.music) : null),
      scene.music && !has.has(scene.music)
        ? h('span', { class: 'hint warn', text: 'not in this game' }) : null));
}

// A person, for the story inspector and for Pics' Characters card alike
// (spec.md §6): their name, the note about them, and their moods — each a
// picture at the path the story expects, which is how somebody knows what to
// call the picture they draw. A mood is drawn on under Pics or Code, or picked
// from the shelf of faces, or renamed here, which renames the picture and
// every line said in it. `close` is the way out of a card in Pics; the strip
// in Write has no such thing to close.
export function renderPersonInspector(person, { close = null } = {}) {
  const st = S.story;
  if (!st?.model || !person) return null;
  const { model } = st;
  const ro = frozen();
  const has = new Set(S.files.map((f) => f.path));
  const fieldRow = (label, ...kids) => h('div', { class: 'ifield' },
    h('span', { class: 'ilabel', text: label }), ...kids);
  const moodRow = (mood, mi) => {
    const path = portraitPath(person.key, mood);
    return h('div', { class: 'mood-row row' },
      thumb(path),
      field(`story-mood-${mi}`, mood, 'a mood', {
        onchange: (e) => {
          const want = freshKey(e.currentTarget.value, person.moods.filter((m) => m !== mood), 'mood');
          renameMood(model, person.key, mood, want);
          touched();
          render();
        },
      }),
      has.has(path)
        ? h('button', { class: 'link tiny', text: 'Draw', title: `Open ${path} to draw on`, onclick: () => chooseFile(path) })
        : h('span', { class: 'hint warn', text: 'no picture yet', title: `${path} is not in this game` }),
      ro ? null : more(`mood:${person.key}:${mood}`, [
        {
          text: 'Pick a face…', title: 'A face from the studio\'s shelf, saved as this mood',
          onPick: () => {
            const openShelf = () => {
              S.dialog = {
                kind: 'pick-picture',
                art: 'portrait',
                // A mood's picture is a face; the shelf's kind is a character.
                title: 'Pick a face',
                place: async (a, blob) => {
                  const { failure } = await writeFiles([{ path, body: blob }]);
                  if (failure) { say(failure, true); return; }
                  say(artCredit(a, path));
                },
              };
              render();
            };
            if (has.has(path)) {
              S.dialog = { kind: 'replace-face', mood, person: person.name || person.key, proceed: openShelf };
              render();
            } else {
              openShelf();
            }
          },
        },
        !has.has(path) && {
          text: 'Draw one', title: `A blank face at ${path}, opened to draw on`,
          onPick: () => createPictureAt(path, 64, 64),
        },
        {
          text: 'Delete', danger: true,
          onPick: () => { person.moods.splice(mi, 1); touched(); render(); },
        },
      ], { label: `More about ${mood}` }));
  };
  return h('div', { class: 'inspector scroll', 'data-scroll': 'inspector' },
    h('div', { class: 'inspector-head row' },
      h('div', { class: 'grow' },
        h('span', { class: 'section-label', text: 'Character' }),
        h('div', { class: 'iname', text: person.name || person.key })),
      close ? h('button', { class: 'icon tiny', text: '✕', title: 'Close', onclick: close }) : null),
    fieldRow('Name',
      field('story-person', person.name, 'Their name', {
        oninput: (e) => { person.name = e.currentTarget.value; touched(); },
      }),
      h('span', { class: 'hint muted mono', text: person.key })),
    fieldRow('About', field('story-person-about', person.about ?? '', 'A line about them, for the studio and its helpers', {
      oninput: (e) => { person.about = e.currentTarget.value; touched(); },
    })),
    fieldRow('Moods',
      ...person.moods.map(moodRow),
      person.moods.length ? null : h('span', { class: 'hint muted', text: 'No moods yet, so this person is never shown.' }),
      ro ? null : h('button', {
        class: 'quiet tiny', text: '+ Add a mood',
        onclick: () => {
          person.moods.push(freshKey('', person.moods, 'mood'));
          touched();
          render();
        },
      })));
}
