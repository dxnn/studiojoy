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
// A picture is a file rather than a line in the model, so the four ways to
// one commit at once: Draw opens a blank one in the rail, Upload takes any
// picture from this device and saves it as the PNG the story expects, *Make
// one for me* asks the studio to draw a flat one, and a plain card — the
// stand-in's first rung — is drawn here in the game's colours with the name
// on it. The card costs nothing and never fails, which is what keeps a story
// from getting stuck on art, and it is where the asked-for one falls back to
// (ideas/vn-builder.md §4, §5).
//
// Two buttons ask the studio itself: *Fill it in for me* turns a sentence
// about what happens into lines, and *Make one for me* draws. Neither is a
// helper — no chat, no message, nothing kept — and the words for both stay
// the buttons' own: the guide never says "prompt" or "model".
//
// The card is built once per question and re-appended by every later render,
// like a dialog: a background render — a helper's reply landing — must not
// wipe what is being typed into it.

import {
  nextQuestion, emptyStory, addPerson, addScene, sceneCalled, storyModel,
} from './story-editor.js';
import { h } from './dom.js';
import {
  S, render, prefs, say, send, api, loadMe, createPictureAt,
} from './main.js';
import { writeFiles } from './upload.js';
import { storyEdited, selectScene, saveStory } from './story-form.js';

// The standard set's home under public/, and where each kind lands in a game.
const ART = '/story-art';
const LANDS = { backgrounds: 'assets/images', portraits: 'assets/sprites', sounds: 'assets/sounds' };
const landing = (file) => `${LANDS[file.split('/')[0]]}/${file.split('/').pop()}`;

// The set's index, read once a session and held: it is a static file shipped
// with the studio and cannot change while it runs. Only a good read is kept,
// so a studio that was briefly unreachable is asked again rather than being
// remembered as having no art at all.
let heldIndex = null;

async function artIndex() {
  if (heldIndex) return heldIndex;
  const res = await send(`${ART}/index.json`);
  if (!res.ok) return null;
  heldIndex = await res.json().catch(() => null);
  return heldIndex;
}

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

/* Asking the studio ------------------------------------------------------------ */

// One small ask, and the card goes quiet while it is out: these cost tokens,
// and a button that still looks pressable is a button somebody presses twice.
// The card is one node kept across renders, so disabling in place is safe —
// nothing rebuilds it underneath. The allowance is re-read afterwards for the
// same reason a reply re-reads it: it was your own day that was spent.
// The whole answer comes back, status and all: the two callers want different
// things from a failure — a refusal is not the same as an answer that turned
// out not to be a picture — and only one of them can say which.
async function asked(from, what, body) {
  const box = from.closest('.guide');
  const fields = [...box.querySelectorAll('button, input, textarea, select')]
    .filter((el) => !el.disabled);
  for (const el of fields) el.disabled = true;
  const res = await api('POST', `/api/projects/${S.slug}/story/${what}`, body);
  for (const el of fields) el.disabled = false;
  if (S.me?.daily_tokens) loadMe();
  if (!res.ok) say(res.body?.error ?? 'The studio could not do that just now.', true);
  return res;
}

// What came back, drawn. An <img> is where an SVG runs no scripts and loads
// nothing, which is what makes a picture nobody has read safe to draw at all
// — the same probe the .svg editor paints unsaved text through. ⚠️ The probe
// is given the size it should be: an SVG carrying only a viewBox has no
// intrinsic size, and left to itself it draws as nothing. Null for anything
// that will not load, which is the plain card's cue.
function svgToPng(svg, width, height) {
  return new Promise((resolve) => {
    const probe = new Image(width, height);
    probe.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(probe, 0, 0, width, height);
      canvas.toBlob(resolve, 'image/png');
    };
    probe.onerror = () => resolve(null);
    probe.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
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

// `note` replaces the banner when the picture is not simply the one that was
// asked for — a plain card standing in for a drawing that would not draw. The
// file did land, so it is not a failure, only a different answer than the one
// the button promised.
async function putPicture(q, body, note = null) {
  placed(q);
  const { failure } = await writeFiles([{ path: q.path, body }]);
  if (failure) say(failure, true);
  else say(note ?? `Added ${q.path}.`);
  render();
}

/* The example ------------------------------------------------------------------ */

// A whole story in one click, for seeing how one is made: its art copied in
// from the standard set, one commit a file, then the story written and saved.
// Its endings are marked as meant, or the guide would ask about each.
async function putInExample() {
  const st = S.story;
  const index = await artIndex();
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

// The standard set's pictures of the kind this question wants, offered as a
// shelf across the top of the card: the cheapest answer, the fastest, and the
// only one that is somebody's actual drawing rather than a card or a few
// shapes. Picking copies the bytes to the path the story expects — the set
// says what a picture looks like and the story says what it is called, so a
// portrait the set calls "Mila, happy" lands as whatever face was asked for.
// One file, one commit, no history and no link back, like every other import.
//
// Filled in when the index arrives rather than through render(): the card is
// one node kept for as long as its question stands, so painting into it is
// safe and a background render cannot wipe it. Plain <img src> too — these
// are static files the browser may cache, unlike a game's own, whose routes
// send no-store and need the stage's object-URL cache.
function artShelf(q) {
  const want = q.who ? 'portrait' : 'background';
  const shelf = h('div', { class: 'guide-shelf' });
  artIndex().then((index) => {
    const art = (index?.art ?? []).filter((a) => a.kind === want);
    if (!art.length) return;
    shelf.append(
      h('span', { class: 'hint muted', text: 'Ready to use:' }),
      ...art.map((a) => h('button', {
        class: 'art',
        // Who made it and under what, on the picture itself: the set is other
        // people's work and the licence travels with it, not just with the
        // index it was listed in.
        title: `${a.name} — ${a.by}, ${a.licence}`,
        onclick: async () => {
          const res = await send(`${ART}/${a.file}`);
          if (!res.ok) { say(`Could not read ${a.name}.`, true); return; }
          await putPicture(q, await res.blob(), `Added ${q.path} — ${a.name}, by ${a.by} (${a.licence}).`);
        },
      }, h('img', { src: `${ART}/${a.file}`, alt: a.name }))),
    );
  });
  return shelf;
}

function pictureCard(q) {
  const person = q.who ? model().cast.find((p) => p.key === q.who) : null;
  const label = person ? (person.name || person.key) : q.scene;
  const [width, height] = q.who ? PORTRAIT : BACKDROP;
  const plain = () => plainCard({ width, height, label, face: Boolean(q.who) });

  // Where the description is kept: the `about` key the game never reads,
  // on the person for a face and on the scene for a place. Resolved on use
  // rather than held, because a reload replaces the model underneath a card
  // that outlives it. Typing here is a story edit like any other — Save
  // commits it — and the fill reads the same line.
  const holder = () => (q.who
    ? model().cast.find((p) => p.key === q.who)
    : sceneOf(q.scene));
  const about = field('story-guide-about', q.who ? 'What they look like' : 'What it looks like', {
    oninput: (e) => {
      const on = holder();
      if (!on) return;
      on.about = e.currentTarget.value;
      storyEdited();
    },
  });
  about.value = holder()?.about ?? '';

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
  // Asked for, drawn, and saved as the PNG the story already expects — so the
  // pixel editor opens it like any other picture and drawing over it is the
  // next thing, not a fresh start. Anything that will not draw falls back to
  // the card, which is the whole point of having a rung below this one.
  const makeOne = async (from) => {
    const st = S.story;
    const res = await asked(from, 'picture', {
      kind: q.who ? 'portrait' : 'background',
      name: label,
      about: about.value.trim(),
      colours: ['primary', 'accent', 'deep'].map((role) => S.look[role]).filter(Boolean),
    });
    if (S.story !== st) return;
    const png = res.ok ? await svgToPng(res.body.svg, res.body.width, res.body.height) : null;
    if (png) { await putPicture(q, png); return; }
    // The studio answered and the answer was not a picture — the card stands
    // in, which is the whole reason there is a rung below this one. A refusal
    // (not yours to change, out of tokens, no connection) writes nothing: its
    // banner already says why, and a card nobody asked for would bury it.
    if (res.ok || res.status === 502) {
      await putPicture(q, await plain(), 'A plain card for now — what came back would not draw.');
    }
  };

  return [
    h('p', { class: 'hint muted', text: `It will be ${q.path}, ${width} by ${height}.` }),
    artShelf(q),
    h('div', { class: 'guide-row' }, about),
    h('div', { class: 'row wrap guide-acts' },
      h('button', {
        class: 'filled tiny', text: 'Draw it', title: 'A blank picture, opened on the right to draw on',
        onclick: async () => {
          placed(q);
          if (await createPictureAt(q.path, width, height)) render();
        },
      }),
      h('button', {
        class: 'quiet tiny', text: 'Make one for me',
        title: 'The studio draws a simple one from what you said, to change or draw over later',
        onclick: (e) => makeOne(e.currentTarget),
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

function linesCard(q) {
  const { cast } = model();
  const who = cast.length ? h('select', { id: 'story-guide-who' },
    h('option', { value: '', text: 'The story says' }),
    ...cast.map((p) => h('option', { value: p.key, text: `${p.name || p.key} says` }))) : null;
  const area = h('textarea', {
    class: 'cfg-text', id: 'story-guide-lines', rows: '3',
    placeholder: 'One line each. Press Enter for the next line.',
  });

  // A mood belongs to whoever is speaking, and the guide has only ever made
  // one — a line said in a mood its speaker does not have is a check the
  // story editor would flag straight back.
  const moodFor = (key) => (key ? (model().cast.find((p) => p.key === key)?.moods[0] ?? '') : '');
  const said = (lines) => {
    const scene = sceneOf(q.scene);
    if (!lines.length || !scene) return;
    scene.lines.push(...lines);
    storyEdited();
    selectScene(q.scene, scene.lines.length - 1);
    render();
  };

  const add = () => {
    const key = who?.value ?? '';
    const mood = moodFor(key);
    said(area.value.split('\n').map((s) => s.trim()).filter(Boolean)
      .map((say) => ({ who: key, mood, say })));
  };

  // The sentence is about what happens, not what anybody says: it goes into
  // the ask and nowhere else. What comes back is lines in the story's own
  // keys, put in where typed ones would go — to change, reorder or delete,
  // and committed by Save like everything else.
  const what = field('story-guide-what', 'Or say what happens here, in a few words');
  const fill = async (from) => {
    const sentence = what.value.trim();
    const scene = sceneOf(q.scene);
    if (!sentence || !scene) return;
    const st = S.story;
    const res = await asked(from, 'fill', {
      sentence,
      scene: { key: scene.key, about: scene.about },
      cast: model().cast.map((p) => ({ key: p.key, name: p.name, about: p.about })),
      lines: scene.lines.map((l) => ({ who: l.who, say: l.say })),
    });
    if (!res.ok || S.story !== st) return;
    said(res.body.lines.map((l) => ({ who: l.who, mood: moodFor(l.who), say: l.say })));
  };
  what.addEventListener('keydown', onEnter(() => fill(what)));

  return [
    who ? h('div', { class: 'guide-row' }, who) : null,
    area,
    h('div', { class: 'row wrap guide-acts' },
      h('button', { class: 'filled tiny', text: 'Add these lines', onclick: add }),
      later(q)),
    h('div', { class: 'guide-row' },
      what,
      h('button', {
        class: 'quiet tiny', text: 'Fill it in for me',
        title: 'The studio writes the lines from what you said, to change or delete',
        onclick: (e) => fill(e.currentTarget),
      })),
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
