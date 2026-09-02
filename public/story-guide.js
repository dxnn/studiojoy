// The guide: the author is walked through the story by questions, one at a
// time, each writing into the story. Deterministic — the next question is a
// function of what the story is missing (nextQuestion, story-editor.js) — so
// it needs no state of its own beyond the questions the author has set
// aside, kept per game in prefs and cleared by "Ask me again", and it works on
// a new story, a half-built one and one hand-edited for a week. Every answer
// is an edit to the model and selects what it changed, so the stage and the
// steps follow; Save commits, as always. The author can ignore the card and
// click around, and it asks again from the story as it stands.
//
// A picture is a file rather than a line in the model, so the three ways to
// one commit at once: Draw opens a blank one in the rail, Upload takes any
// picture from this device and saves it as the PNG the story expects, and a
// plain card — the stand-in — is drawn here in the game's colours with the
// name on it. The card costs nothing and never fails, which is what keeps a
// story from getting stuck on art (ideas/vn-builder.md §4, §5).
//
// The card is built once per question and re-appended by every later render,
// like a dialog: a background render — a helper's reply landing — must not
// wipe what is being typed into it.

import {
  nextQuestion, emptyStory, addPerson, addScene, sceneCalled, storyModel,
} from './story-editor.js';
import { h } from './dom.js';
import {
  S, render, prefs, say, send, createPictureAt,
} from './main.js';
import { writeFiles } from './upload.js';
import { storyEdited, selectScene, saveStory } from './story-form.js';

// The standard set's home under public/, and where each kind lands in a game.
const ART = '/story-art';
const LANDS = { backgrounds: 'assets/images', portraits: 'assets/sprites', sounds: 'assets/sounds' };
const landing = (file) => `${LANDS[file.split('/')[0]]}/${file.split('/').pop()}`;

// The sizes the example's own art came in: a face and a backdrop.
const PORTRAIT = [128, 128];
const BACKDROP = [480, 270];

/* Set aside ----------------------------------------------------------------- */

// What the author answered "Later" to, per game, in this browser. The one
// piece of state the guide has: everything else is read off the story.
const skipKey = () => `guide-${S.slug}`;

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

/* The stand-in ---------------------------------------------------------------- */

// A flat card in the game's colours with the name on it: the deep colour, a
// primary border, a face for a person, the words in white. What the story
// shows until somebody draws or uploads the real one.
const look = () => ({
  primary: S.look.primary ?? 'oklch(0.72 0.19 20)',
  accent: S.look.accent ?? 'oklch(0.78 0.15 350)',
  deep: S.look.deep ?? '#191033',
});

function plainCard({ width, height, label, face }) {
  const colours = look();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colours.deep;
  ctx.fillRect(0, 0, width, height);
  // The studio's halftone, faintly, so a card reads as the studio's and not
  // as a finished picture nobody drew.
  ctx.fillStyle = colours.primary;
  ctx.globalAlpha = 0.18;
  for (let y = 6; y < height; y += 12) {
    for (let x = 6; x < width; x += 12) ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colours.primary;
  ctx.lineWidth = Math.max(4, Math.round(width / 80));
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
  if (face) {
    // A round face, two eyes, a smile — a person, not a place.
    const r = height * 0.28;
    const cx = width / 2;
    const cy = height * 0.42;
    ctx.fillStyle = colours.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colours.deep;
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, cy - r * 0.15, r * 0.1, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.35, cy - r * 0.15, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colours.deep;
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.1, r * 0.45, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.round(height / (face ? 9 : 6));
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.fillText(label, width / 2, face ? height * 0.85 : height / 2, width - 24);
  return new Promise((resolve) => { canvas.toBlob(resolve, 'image/png'); });
}

// Any picture from this device as a PNG at its own size — the story asks for
// .png by name, and a JPEG saved under that name would be a lie the browser
// happens to forgive.
async function asPng(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve) => { canvas.toBlob(resolve, 'image/png'); });
}

/* Answers ---------------------------------------------------------------------- */

const model = () => S.story.model;
const sceneOf = (key) => model().scenes.find((s) => s.key === key);

// A new person or place, selected so the stage shows what was just made.
function answerName(q, name) {
  if (q.id === 'scene-first') {
    const key = addScene(model(), name);
    storyEdited();
    selectScene(key, 'picture');
  } else {
    const key = addPerson(model(), name);
    storyEdited();
    S.story.person = key;
    S.story.step = 0;
  }
  render();
}

// Where a picture question's answer goes in the model: a scene's picture
// path, or nothing for a face, whose path is its name. Either way the thing
// it is about is selected.
function placed(q) {
  const st = S.story;
  if (q.scene) {
    const scene = sceneOf(q.scene);
    if (scene && scene.picture !== q.path) {
      scene.picture = q.path;
      storyEdited();
    }
    selectScene(q.scene, 'picture');
  } else {
    st.person = q.who;
    st.step = Math.max(0, model().cast.find((p) => p.key === q.who)?.moods.indexOf(q.mood) ?? 0);
  }
}

async function putPicture(q, body) {
  placed(q);
  const { failure } = await writeFiles([{ path: q.path, body }]);
  if (failure) say(failure, true);
  else say(`Added ${q.path}.`);
  render();
}

/* The example ------------------------------------------------------------------ */

// A whole story in one click, for seeing how one is made: its art copied in
// from the standard set, one commit a file, then the story written and saved.
// Its endings are marked as meant, or the guide would ask about each.
async function putInExample() {
  const st = S.story;
  const index = await send(`${ART}/index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const example = index?.examples?.mila;
  if (!example) { say('The example story could not be read.', true); return; }
  say('Putting the example story in…');
  const files = [];
  for (const file of example.uses) {
    const res = await send(`${ART}/${file}`);
    if (!res.ok) { say(`Could not read ${file}.`, true); return; }
    files.push({ path: landing(file), body: await res.blob() });
  }
  const text = await send(`${ART}/${example.story}`).then((r) => (r.ok ? r.text() : null));
  const read = text === null ? { ok: false } : storyModel(text);
  if (!read.ok) { say('The example story could not be read.', true); return; }
  const { failure } = await writeFiles(files);
  if (failure) { say(failure, true); return; }
  if (S.story !== st) return;
  st.model = { cast: read.cast, scenes: read.scenes };
  storyEdited();
  for (const scene of st.model.scenes) {
    if (!scene.choices.length && !scene.go) setAside(`exit:${scene.key}`);
  }
  selectScene(st.model.scenes[0].key);
  render();
  await saveStory();
}

/* The card ---------------------------------------------------------------------- */

const field = (id, placeholder, on = {}) => h('input', {
  type: 'text', class: 'cfg-text', id, placeholder, ...on,
});

const onEnter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

const later = (q, label = 'Later') => h('button', {
  class: 'quiet tiny', text: label, onclick: () => { setAside(q.id); render(); },
});

function nameCard(q) {
  const input = field('story-guide-name', q.id === 'scene-first' ? 'A place' : 'A name');
  const go = () => { if (input.value.trim()) answerName(q, input.value.trim()); };
  input.addEventListener('keydown', onEnter(go));
  return [
    h('div', { class: 'guide-row' }, input, h('button', { class: 'filled tiny', text: 'Next', onclick: go })),
    q.later ? h('div', { class: 'row' }, later(q, q.later)) : null,
  ];
}

function pictureCard(q) {
  const person = q.who ? model().cast.find((p) => p.key === q.who) : null;
  const label = person ? (person.name || person.key) : q.scene;
  const [width, height] = q.who ? PORTRAIT : BACKDROP;
  const picker = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: async (e) => {
      const file = e.currentTarget.files[0];
      e.currentTarget.value = '';
      if (!file) return;
      const png = await asPng(file);
      if (!png) { say('That one will not open as a picture.', true); return; }
      await putPicture(q, png);
    },
  });
  return [
    h('p', { class: 'hint muted', text: `It will be ${q.path}, ${width} by ${height}.` }),
    h('div', { class: 'row wrap guide-acts' },
      h('button', {
        class: 'filled tiny', text: 'Draw it', title: 'A blank picture, opened on the right to draw on',
        onclick: async () => {
          placed(q);
          if (await createPictureAt(q.path, width, height)) render();
        },
      }),
      h('button', { class: 'quiet tiny', text: 'Upload one', onclick: () => picker.click() }),
      h('button', {
        class: 'quiet tiny', text: 'A plain card for now',
        title: 'A card in the game\'s colours with the name on it, until there is a real picture',
        onclick: async () => putPicture(q, await plainCard({
          width, height, label, face: Boolean(q.who),
        })),
      }),
      later(q),
      picker),
  ];
}

function linesCard(q) {
  const { cast } = model();
  const who = cast.length ? h('select', { id: 'story-guide-who' },
    h('option', { value: '', text: 'The story says' }),
    ...cast.map((p) => h('option', { value: p.key, text: `${p.name || p.key} says` }))) : null;
  const area = h('textarea', {
    class: 'cfg-text', id: 'story-guide-lines', rows: '3',
    placeholder: 'One line each. Press Enter for the next line.',
  });
  const add = () => {
    const said = area.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const scene = sceneOf(q.scene);
    if (!said.length || !scene) return;
    const key = who?.value ?? '';
    const mood = key ? (cast.find((p) => p.key === key)?.moods[0] ?? '') : '';
    scene.lines.push(...said.map((say) => ({ who: key, mood, say })));
    storyEdited();
    selectScene(q.scene, scene.lines.length - 1);
    render();
  };
  return [
    who ? h('div', { class: 'guide-row' }, who) : null,
    area,
    h('div', { class: 'row wrap guide-acts' },
      h('button', { class: 'filled tiny', text: 'Add these lines', onclick: add }),
      later(q)),
  ];
}

function exitCard(q) {
  const box = h('div', { class: 'col' });
  const rows = [{ say: '', to: '' }, { say: '', to: '' }];
  const scene = () => sceneOf(q.scene);

  const choicesForm = () => {
    const paint = () => box.replaceChildren(
      ...rows.map((row, i) => h('div', { class: 'guide-row' },
        field(`story-guide-say-${i}`, 'What the button says', {
          oninput: (e) => { row.say = e.currentTarget.value; },
        }),
        h('span', { class: 'hint muted', text: 'leads to' }),
        field(`story-guide-to-${i}`, 'a place', {
          oninput: (e) => { row.to = e.currentTarget.value; },
        }))),
      h('div', { class: 'row wrap guide-acts' },
        h('button', {
          class: 'filled tiny', text: 'Add the choices',
          onclick: () => {
            const good = rows.filter((r) => r.say.trim() && r.to.trim());
            const s = scene();
            if (!good.length || !s) return;
            s.choices = good.map((r) => ({
              say: r.say.trim(), go: sceneCalled(model(), r.to), set: '', need: '',
            }));
            s.go = '';
            storyEdited();
            selectScene(q.scene, 'exit');
            render();
          },
        }),
        h('button', {
          class: 'quiet tiny', text: '+ Another choice',
          onclick: () => { rows.push({ say: '', to: '' }); paint(); },
        })),
    );
    paint();
  };

  const goForm = () => {
    const to = field('story-guide-to', 'a place');
    const on = () => {
      const s = scene();
      if (!to.value.trim() || !s) return;
      s.go = sceneCalled(model(), to.value.trim());
      s.choices = [];
      storyEdited();
      selectScene(q.scene, 'exit');
      render();
    };
    to.addEventListener('keydown', onEnter(on));
    box.replaceChildren(h('div', { class: 'guide-row' },
      h('span', { class: 'hint muted', text: 'straight on to' }),
      to,
      h('button', { class: 'filled tiny', text: 'Go on', onclick: on })));
  };

  return [
    h('div', { class: 'row wrap guide-acts' },
      h('button', { class: 'quiet tiny', text: 'The player chooses', onclick: choicesForm }),
      h('button', { class: 'quiet tiny', text: 'The story goes straight on', onclick: goForm }),
      // An ending is a scene like any other; saying so is the answer.
      later(q, 'The story ends here')),
    box,
  ];
}

const makeCard = (q) => [h('div', { class: 'row wrap guide-acts' },
  h('button', {
    class: 'filled tiny', text: 'Make it',
    onclick: () => {
      const key = addScene(model(), q.target);
      storyEdited();
      selectScene(key, 'picture');
      render();
    },
  }),
  later(q))];

const CARDS = {
  name: nameCard, picture: pictureCard, lines: linesCard, exit: exitCard, make: makeCard,
};

function card(q) {
  return h('div', { class: 'guide' },
    h('div', { class: 'guide-ask', text: q.ask }),
    ...CARDS[q.kind](q),
    // The whole thing in one click, offered while there is nothing to lose.
    emptyStory(model()) ? h('button', {
      class: 'link tiny', text: 'Or put in an example story, to see how one is made',
      onclick: putInExample,
    }) : null);
}

// Nothing missing but what was set aside: the way to play, and the way to be
// asked again. With nothing set aside either the guide has nothing to say and
// says nothing — the card goes away.
function readyCard() {
  return h('div', { class: 'guide ready' },
    h('span', { class: 'guide-ask', text: 'Your story is ready.' }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'quiet tiny', text: 'Ask me again',
      onclick: () => { prefs.set(skipKey(), '[]'); render(); },
    }),
    h('button', {
      class: 'filled tiny', text: '▶ Try it',
      onclick: async () => {
        if (S.story.dirty && !(await saveStory())) return;
        S.tryScene = model().scenes[0]?.key ?? null;
        S.previewOpen = true;
        S.previewNonce += 1;
        render();
      },
    }));
}

// One node per question, kept while the question stands. The words of the
// question are in the key too, so a renamed person gets a card that names
// them — at the cost of what was typed into the old one, which is rare.
let shown = { key: null, node: null };

export function renderGuide() {
  const st = S.story;
  if (!st?.model) return null;
  const skipped = skippedSet();
  const q = nextQuestion(st.model, S.files.map((f) => f.path), skipped);
  const key = q ? `${S.slug}:${q.id}:${q.ask}` : (skipped.size ? `${S.slug}:ready` : null);
  if (!key) {
    shown = { key: null, node: null };
    return null;
  }
  if (shown.key !== key) shown = { key, node: q ? card(q) : readyCard() };
  return shown.node;
}
