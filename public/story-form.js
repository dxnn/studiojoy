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
  stageFor, leadingTo, moveLine, startAt,
} from './story-editor.js';
import { h } from './dom.js';
import {
  S, render, send, say, frozen, encodePath, refreshFiles, chooseFile, NO_CONNECTION,
} from './main.js';

export const STORY_FILE = 'config/story.js';

const IMAGE_DIR = 'assets/images';
const SOUND_DIR = 'assets/sounds';
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
  st.person = null;
  st.scene = st.model.scenes.some((s) => s.key === key) ? key : (st.model.scenes[0]?.key ?? null);
  st.step = step;
}

/* Loading and saving --------------------------------------------------------- */

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
  const res = await send(`/api/projects/${slug}/files/${encodePath(STORY_FILE)}`);
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

  // Edits parked on the way out come back while the file is the one they were
  // made on. Otherwise they are gone, and that is said rather than left to be
  // discovered.
  const kept = parked.get(slug);
  parked.delete(slug);
  if (kept && kept.etag === etag) {
    S.story = {
      text, etag, model: kept.model, dirty: true, scene: null, step: 'scene', person: null,
    };
    selectScene(kept.scene, kept.step);
    S.story.person = kept.person;
    return;
  }
  if (kept) {
    say(`${STORY_FILE} changed since you were last here, so the story edits you had not saved were dropped.`, true);
  }
  S.story = {
    text, etag, model: { cast: read.cast, scenes: read.scenes }, dirty: false,
    scene: null, step: 'scene', person: null,
  };
  selectScene(was?.scene ?? read.scenes[0]?.key, was?.scene ? was.step : 'scene');
}

// Called on the way out of a game, before the slug moves.
export function parkStory() {
  const st = S.story;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, {
    model: st.model, etag: st.etag, scene: st.scene, step: st.step, person: st.person,
  });
}

// The file changed on disk — a helper's commit, a save in the rail, a version
// brought back. Re-read it, unless there is unsaved work here, in which case
// the work stays and Save will ask before overwriting. Our own save's commit
// arrives this way too, usually before the PUT answers: while a save is in
// flight the answer to it is the truth, so the event is left alone.
export function storyChanged() {
  const st = S.story;
  if (st?.saving) return;
  if (st?.model && st.dirty) {
    st.stale = true;
    say(`${STORY_FILE} changed while you were working on it. What you have is still here — Save will ask before overwriting.`);
    render();
    return;
  }
  loadStory().then(render);
}

// True when it landed. A 409 opens the conflict dialog, which comes back here
// with force or through discardStory.
export async function saveStory({ force = false } = {}) {
  const st = S.story;
  if (!st?.model) return false;
  const text = storyText(st.model);
  const headers = { 'content-type': 'text/plain' };
  if (!force && st.etag) headers['if-match'] = st.etag;
  st.saving = true;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(STORY_FILE)}`, {
    method: 'PUT', headers, body: text,
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
    st.dirty = false;
    st.stale = false;
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${STORY_FILE}.`);
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
// different, the stage and the status say so at once.
function touched() {
  const st = S.story;
  st.dirty = true;
  const status = document.getElementById('story-status');
  if (status) status.textContent = 'Not saved yet';
  const save = document.getElementById('story-save');
  if (save) save.disabled = frozen();
  paintStage();
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

function paintStage() {
  if (!stageNodes) return;
  const st = S.story;
  const view = (st.person ? personView(st) : stageFor(st.model, st.scene, st.step))
    ?? { picture: '', portrait: '', who: '', say: '', choices: [], go: '', end: false };
  const n = stageNodes;
  setPicture(n.picture, view.picture);
  setPicture(n.portrait, view.portrait);
  n.who.textContent = view.who;
  n.who.hidden = !view.who;
  n.say.textContent = view.say;
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
  stageNodes = {
    picture, portrait, who, say: words, choices,
  };
  paintStage();
  return h('div', { class: 'stage' }, picture, portrait, h('div', { class: 'box' }, who, words, choices));
}

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
        class: 'link', text: 'Open it on the right', onclick: () => chooseFile(STORY_FILE),
      })),
    );
  }
  // One editor for the file at a time: while its text is open in the rail,
  // this one waits rather than saving over what is typed there.
  if (S.open?.path === STORY_FILE) {
    return note(h('p', { text: `${STORY_FILE} is open as text on the right. Close it there to come back to the story.` }));
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
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* Controls ---------------------------------------------------------------- */

  // Ids on the fields are what carry the caret across a background render
  // (main.js keeps the focus of anything called story-…).
  const field = (id, value, placeholder, on = {}) => {
    const input = h('input', {
      type: 'text', class: 'cfg-text', id, placeholder, disabled: ro, ...on,
    });
    input.value = value;
    return input;
  };
  const pick = (options, value, onchange, extra = {}) => h(
    'select', { onchange, disabled: ro, ...extra },
    options.map(([v, label]) => {
      const option = h('option', { value: v, text: label });
      if (v === value) option.selected = true;
      return option;
    }),
  );
  const filesUnder = (dir, ext) => paths
    .filter((p) => p.startsWith(`${dir}/`) && (!ext || p.endsWith(ext))).sort();
  const thumb = (path) => {
    const img = h('img', { class: 'thumb', alt: '' });
    setPicture(img, path);
    return img;
  };
  const go = (key) => { selectScene(key); render(); };

  /* The strip ---------------------------------------------------------------- */

  const afterOf = (scene) => (scene.choices.length ? 'choices' : scene.go ? 'go' : 'end');
  const tailOf = (scene) => {
    const after = afterOf(scene);
    if (after === 'choices') return plural(scene.choices.length, 'choice');
    return after === 'go' ? `→ ${scene.go}` : 'the end';
  };

  // Two lines a row — the name, then what is known about it — because at the
  // strip's width a name beside "starts here · 3 choices" was three letters.
  const sceneRow = (scene, at) => {
    const problems = problemsFor(scene.key);
    return h('div', {
      class: `strip-row${!st.person && st.scene === scene.key ? ' on' : ''}`,
      onclick: () => go(scene.key),
    },
    h('span', { class: 'sname mono', text: scene.key }),
    h('span', { class: 'tail' },
      at === 0 ? h('span', { class: 'hint muted', text: 'starts here' }) : null,
      problems.length ? h('span', {
        class: 'hint warn', text: `⚠ ${problems.length}`, title: problems.map((c) => c.say).join('\n'),
      }) : null,
      h('span', { class: 'hint muted', text: tailOf(scene) })));
  };

  const personRow = (person) => h('div', {
    class: `strip-row${st.person === person.key ? ' on' : ''}`,
    onclick: () => { st.person = person.key; st.step = 0; render(); },
  },
  h('span', { class: 'sname', text: person.name || person.key }),
  h('span', { class: 'tail' }, h('span', { class: 'hint muted', text: plural(person.moods.length, 'mood') })));

  const strip = h('div', { class: 'story-strip scroll', 'data-scroll': 'story-strip' },
    h('div', { class: 'strip-head' },
      h('span', { class: 'section-label', text: 'Scenes' }),
      h('span', {
        class: `hint ${checks.length ? 'warn' : 'muted'}`,
        text: `${shape.scenes} · ${plural(shape.endings, 'ending')}`
          + (checks.length ? ` · ⚠ ${checks.length}` : ''),
        title: checks.length ? `${checks.length} to look at` : null,
      })),
    ...scenes.map(sceneRow),
    h('button', {
      class: 'quiet tiny', text: '+ Add a scene', disabled: ro,
      onclick: () => {
        const key = freshKey('', keys);
        scenes.push({ key, picture: '', sound: '', lines: [], choices: [], go: '' });
        touched();
        go(key);
      },
    }),
    h('div', { class: 'strip-head' }, h('span', { class: 'section-label', text: 'People' })),
    ...cast.map(personRow),
    h('button', {
      class: 'quiet tiny', text: '+ Add someone', disabled: ro,
      onclick: () => {
        const key = freshKey('', cast.map((p) => p.key), 'person');
        cast.push({ key, name: '', moods: [] });
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

  const sceneSteps = (scene, at) => {
    const from = leadingTo(model, scene.key);
    const rows = [];

    // The scene itself: its name, every way in, and where the story starts.
    rows.push(rowOf('scene', 'head',
      h('span', { class: 'glyph', text: '▸' }),
      field('story-name', scene.key, 'a short name', {
        onchange: (e) => {
          const want = freshKey(e.currentTarget.value, keys.filter((k) => k !== scene.key));
          renameScene(model, scene.key, want);
          st.scene = want;
          touched();
          render();
        },
      }),
      h('span', { class: 'hint muted', text: from.length ? 'comes from:' : (at === 0 ? '' : 'nothing leads here') }),
      ...from.map((k) => h('button', { class: 'link tiny mono', text: k, onclick: () => go(k) })),
      h('div', { class: 'spacer' }),
      at === 0
        ? h('span', { class: 'hint muted', text: 'starts here' })
        : h('button', {
          class: 'quiet tiny', text: 'Start here', disabled: ro,
          title: 'Make this the scene the story starts at',
          onclick: () => { startAt(model, scene.key); touched(); render(); },
        }),
      h('button', {
        class: 'danger tiny', text: 'Remove',
        title: from.length
          ? `${plural(from.length, 'way')} in still lead here`
          : 'Remove this scene',
        disabled: ro || from.length > 0 || scenes.length < 2,
        onclick: () => {
          model.scenes = scenes.filter((s) => s !== scene);
          touched();
          go(model.scenes[0]?.key);
        },
      })));

    rows.push(rowOf('picture', 'fixed',
      h('span', { class: 'glyph', text: '▤' }),
      h('span', { class: 'label', text: 'Picture' }),
      pick(
        [['', 'none'], ...filesUnder(IMAGE_DIR).map((p) => [p, p.slice(IMAGE_DIR.length + 1)])],
        scene.picture,
        (e) => { scene.picture = e.currentTarget.value; touched(); render(); },
      ),
      scene.picture ? thumb(scene.picture) : null,
      scene.picture && !has.has(scene.picture)
        ? h('span', { class: 'hint warn', text: 'not in this game' }) : null));

    rows.push(rowOf('sound', 'fixed',
      h('span', { class: 'glyph', text: '♪' }),
      h('span', { class: 'label', text: 'Sound' }),
      pick(
        [['', 'none'], ...filesUnder(SOUND_DIR, '.wav')
          .map((p) => [p.slice(SOUND_DIR.length + 1, -4), p.slice(SOUND_DIR.length + 1)])],
        scene.sound,
        (e) => { scene.sound = e.currentTarget.value; touched(); render(); },
      ),
      scene.sound ? h('button', {
        class: 'icon tiny', text: '▶', title: 'Play it',
        onclick: () => {
          imageUrl(`${SOUND_DIR}/${scene.sound}.wav`).then((url) => { if (url) new Audio(url).play(); });
        },
      }) : null));

    // One row per line. Closed, it reads as the player would hear it; open,
    // it is who, mood and the words. Rows drag into order by their handle,
    // and ▲ ▼ are the keyboard's way.
    let dragFrom = null;
    const lineRow = (line, i) => {
      const person = cast.find((p) => p.key === line.who);
      const open = st.step === i;
      const handle = h('span', {
        class: 'handle', text: '≡', title: 'Drag to move this line',
        draggable: ro ? null : 'true',
        ondragstart: (e) => {
          dragFrom = i;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(i));
        },
      });
      const row = rowOf(i, `line${open ? ' open' : ''}`,
        handle,
        line.who && line.mood ? thumb(portraitPath(line.who, line.mood)) : h('span', { class: 'thumb' }),
        open ? null : h('span', { class: `speaker${person ? '' : ' muted'}`, text: person ? (person.name || person.key) : (line.who || 'the story') }),
        open ? null : h('span', { class: `words${line.say ? '' : ' muted'}`, text: line.say || '…' }),
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
          ) : null,
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'icon tiny', text: '▲', title: 'Move this line up', disabled: ro || i === 0,
            onclick: () => { moveLine(scene, i, i - 1); st.step = i - 1; touched(); render(); },
          }),
          h('button', {
            class: 'icon tiny', text: '▼', title: 'Move this line down', disabled: ro || i === scene.lines.length - 1,
            onclick: () => { moveLine(scene, i, i + 1); st.step = i + 1; touched(); render(); },
          }),
          h('button', {
            class: 'icon tiny', text: '✕', title: 'Remove this line', disabled: ro,
            onclick: () => { scene.lines.splice(i, 1); st.step = 'scene'; touched(); render(); },
          })) : null,
        open ? h('div', { class: 'sub' }, (() => {
          const area = h('textarea', {
            class: 'cfg-text', id: 'story-say', rows: '2', placeholder: 'What is said', disabled: ro,
            oninput: (e) => { line.say = e.currentTarget.value; touched(); },
          });
          area.value = line.say;
          return area;
        })()) : null);
      if (!ro) {
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
      }
      return row;
    };
    rows.push(...scene.lines.map(lineRow));
    rows.push(h('button', {
      class: 'quiet tiny add-line', text: '+ Add a line', disabled: ro,
      onclick: () => {
        scene.lines.push({ who: '', mood: '', say: '' });
        st.step = scene.lines.length - 1;
        touched();
        render();
      },
    }));

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
      h('button', {
        class: 'icon tiny', text: '✕', title: 'Remove this choice', disabled: ro,
        onclick: () => { scene.choices.splice(ci, 1); touched(); render(); },
      }));

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
      after === 'choices' ? h('div', { class: 'sub' }, h('button', {
        class: 'quiet tiny', text: '+ Add a choice', disabled: ro,
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

  const personSteps = (person) => {
    const used = scenes.reduce((n, s) => n + s.lines.filter((l) => l.who === person.key).length, 0);
    const rows = [];
    rows.push(rowOf('name', 'head',
      h('span', { class: 'glyph', text: '▣' }),
      field('story-person', person.name, 'Their name', {
        oninput: (e) => { person.name = e.currentTarget.value; touched(); },
      }),
      h('span', { class: 'hint muted mono', text: person.key }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'danger tiny', text: 'Remove',
        title: used ? `${plural(used, 'line')} still said by them` : 'Remove them from the story',
        disabled: ro || used > 0,
        onclick: () => {
          model.cast = cast.filter((p) => p !== person);
          touched();
          go(st.scene);
        },
      })));
    // One row per mood: the picture it is, and the file it expects — naming
    // the file is how somebody knows what to call the picture they draw.
    person.moods.forEach((mood, mi) => {
      const path = portraitPath(person.key, mood);
      rows.push(rowOf(mi, `line${st.step === mi ? ' open' : ''}`,
        thumb(path),
        st.step === mi
          ? field('story-mood', mood, 'a mood', {
            onchange: (e) => {
              const want = freshKey(e.currentTarget.value, person.moods.filter((m) => m !== mood), 'mood');
              renameMood(model, person.key, mood, want);
              touched();
              render();
            },
          })
          : h('span', { class: 'speaker', text: mood }),
        h('span', { class: `hint mono ${has.has(path) ? 'muted' : 'warn'}`, text: has.has(path) ? path : `${path} — not in this game` }),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'icon tiny', text: '✕', title: `Remove ${mood}`, disabled: ro,
          onclick: () => { person.moods.splice(mi, 1); st.step = 0; touched(); render(); },
        })));
    });
    rows.push(h('button', {
      class: 'quiet tiny add-line', text: '+ Add a mood', disabled: ro,
      onclick: () => {
        person.moods.push(freshKey('', person.moods, 'mood'));
        st.step = person.moods.length - 1;
        touched();
        render();
      },
    }));
    return rows;
  };

  /* Put together -------------------------------------------------------------- */

  const scene = st.person ? null : scenes.find((s) => s.key === st.scene);
  const person = st.person ? cast.find((p) => p.key === st.person) : null;
  if (person) stepsBox.append(...personSteps(person));
  else if (scene) stepsBox.append(...sceneSteps(scene, scenes.indexOf(scene)));
  else stepsBox.append(h('p', { class: 'muted', text: 'No scenes yet. Add one on the left.' }));

  const bar = h('div', { class: 'editor-bar row' },
    h('span', { class: 'hint muted', id: 'story-status', text: st.dirty ? 'Not saved yet' : 'Saved' }),
    st.stale ? h('span', { class: 'hint warn', text: 'changed underneath — Save will ask' }) : null,
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'link', text: 'Show the text', title: `Open ${STORY_FILE} as text on the right`,
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
    }) : null,
    h('button', {
      class: 'filled', id: 'story-save', text: 'Save',
      disabled: !st.dirty || ro,
      onclick: () => saveStory(),
    }));

  return h('div', { class: 'story-editor' },
    strip,
    h('div', { class: 'story-main' },
      buildStage(),
      h('div', {
        class: 'stage-note hint muted',
        text: 'Close to what the player sees — Try this scene shows the real thing.',
      }),
      stepsBox,
      bar));
}
