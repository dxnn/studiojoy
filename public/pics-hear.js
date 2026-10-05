// Pics and Hear (spec.md §6): every picture in the game by what it is, and
// every sound over its music. A picture opens in the pixel editor on one
// click; a sound opens its editor under its own row, and a character their
// fields under the cards — in place, since there is no other pane to put them.

import { h } from './dom.js';
import {
  SPRITE_DIR, IMAGE_DIR, SOUND_DIR, MUSIC_DIR, pickToUpload,
} from './upload.js';
import { pictureInto, playButton, renderPersonInspector } from './story-form.js';
import { itemsOf, itemPath } from './adventure-editor.js';
import {
  S, frozen, sizeText, render, hasEditor,
} from './main.js';
import {
  chooseFile, closeOpenFile, RESERVED_IMAGES, DRESSING,
} from './files.js';
import { fileMore, renderOpenFile, renderMedia } from './files-tab.js';
import { renderSoundEditor, createSound } from './sound-editor.js';
import { plural } from './history.js';

const isPictureFile = (f) => Boolean(f?.mime?.startsWith('image/'));
const isAudioFile = (f) => Boolean(f?.mime?.startsWith('audio/'));
const baseName = (path) => path.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
const inDir = (f, dir) => f.path.startsWith(`${dir}/`);

// A card under Pics: the picture, its name, a line under it, its ···. Pressing
// it opens it in the pixel editor. ⚠️ One click, not two: selecting a picture
// into the rail first showed it at a size nothing could be done with, and cost
// a click on the way to the only thing anybody opens a picture for. Code's
// rows already went straight to the editor, and two panes treating a picture
// differently is the studio contradicting itself. A strip wears its first
// frame — the picture is pinned to the card's left edge.
function pictureCard({
  path, name, sub, strip = false,
}) {
  const on = S.open?.path === path;
  const img = h('img', { alt: '' });
  pictureInto(img, path);
  return h('div', {
    class: `card${on ? ' on' : ''}${strip ? ' strip' : ''}`,
    onclick: (e) => {
      if (e.target.closest('button')) return undefined;
      // A person may be open under the cards; opening a picture is not about
      // them any more.
      S.pick = null;
      return chooseFile(path);
    },
  },
  h('div', { class: 'cpic' }, img),
  h('div', { class: 'crow' }, h('div', { class: 'cname', text: name }), fileMore(path)),
  sub ? h('div', { class: 'csub', text: sub }) : null);
}

// A person, wearing their first mood. Their moods, their name and the note
// about them open under the cards, and the same card closes them again;
// taking them out of the story is Write's.
const pickedPerson = (person) => S.pick?.kind === 'person' && S.pick.key === person.key;
function personCard(person) {
  const on = pickedPerson(person);
  const img = h('img', { alt: '' });
  if (person.moods[0]) pictureInto(img, `${SPRITE_DIR}/${person.key}-${person.moods[0]}.png`);
  return h('div', {
    class: `card face${on ? ' on' : ''}`,
    onclick: () => { S.pick = on ? null : { kind: 'person', key: person.key }; render(); },
  },
  h('div', { class: 'cpic' }, img),
  h('div', { class: 'crow' }, h('div', { class: 'cname', text: person.name || person.key })),
  h('div', { class: 'csub', text: plural(person.moods.length, 'mood') }));
}

// Studio dressing is the one section that shows with nothing in it (spec.md
// §6). The three pictures a game can wear are the studio's rather than the
// game's, and a game wearing none had no way of saying they exist: the section
// was simply absent, so the only way to find out about hero.png was to be told
// its name. The button is the way in and the dialog is where each is explained.
function dressingSection(pictures, take) {
  const cards = pictures.filter((f) => RESERVED_IMAGES.includes(f.path))
    .map((f) => pictureCard({
      path: take(f).path, name: baseName(f.path), sub: DRESSING[f.path].what,
    }));
  // On a game nobody here may change, an empty section is an offer that cannot
  // be taken up.
  if (frozen() && cards.length === 0) return [];
  return [
    h('div', { class: 'section-row' },
      h('div', { class: 'section-label', text: 'Studio dressing' }),
      frozen() ? null : h('button', {
        class: 'quiet tiny',
        text: cards.length === RESERVED_IMAGES.length ? 'Change dressing' : 'Add dressing',
        title: 'The three pictures a game wears in the studio',
        onclick: () => { S.dialog = { kind: 'add-dressing' }; render(); },
      })),
    cards.length
      ? h('div', { class: 'cards' }, cards)
      : h('div', {
        class: 'pad muted',
        text: 'None yet. A game can wear three pictures of its own: one behind the '
          + 'conversation, one over it, and a little one beside its name.',
      }),
  ];
}

// Pics: every picture in the game by what it is, not by folder (spec.md §6).
// A visual novel shows its Characters — a card per person — over its Places;
// every game shows its sprites, its pictures, and the three reserved images by
// what each dresses; anything else that is a picture comes last, so nothing
// the tree holds is missing here. While a picture is open it is the whole
// pane, in the pixel editor; the bar's ✕ is the way back to the cards.
export function renderPicsMode() {
  if (S.open && isPictureFile(S.open)) return renderOpenFile();
  const pictures = S.files.filter((f) => isPictureFile(f) && !f.unreachable);
  const covered = new Set();
  const take = (f) => { covered.add(f.path); return f; };
  const section = (label, cards) => (cards.length
    ? [h('div', { class: 'section-label', text: label }), h('div', { class: 'cards' }, cards)]
    : []);
  const parts = [];
  const story = hasEditor('story') ? S.story?.model : null;
  if (story) {
    parts.push(...section('Characters', story.cast.map(personCard)));
    const person = story.cast.find(pickedPerson);
    if (person) {
      parts.push(renderPersonInspector(person, { close: () => { S.pick = null; render(); } }));
    }
    for (const person of story.cast) {
      for (const mood of person.moods) covered.add(`${SPRITE_DIR}/${person.key}-${mood}.png`);
    }
    const scenesUsing = (p) => story.scenes.filter((s) => s.picture === p).length;
    parts.push(...section('Places', pictures.filter((f) => inDir(f, IMAGE_DIR)).map((f) => {
      const n = scenesUsing(take(f).path);
      return pictureCard({
        path: f.path, name: baseName(f.path), sub: n ? `in ${plural(n, 'scene')}` : 'not in a scene yet',
      });
    })));
  }
  // An adventure shows its Places the same way, then the Things a spot can
  // pick up — each the picture the game shows among what the player carries.
  const adventure = hasEditor('adventure') ? S.adventure?.model : null;
  if (adventure) {
    const scenesUsing = (p) => adventure.scenes.filter((s) => s.picture === p).length;
    parts.push(...section('Places', pictures.filter((f) => inDir(f, IMAGE_DIR)).map((f) => {
      const n = scenesUsing(take(f).path);
      return pictureCard({
        path: f.path, name: baseName(f.path), sub: n ? `in ${plural(n, 'scene')}` : 'not in a scene yet',
      });
    })));
    const things = itemsOf(adventure).map(itemPath).filter((p) => covered.has(p) || pictures.some((f) => f.path === p));
    parts.push(...section('Things', things.map((p) => {
      const f = pictures.find((x) => x.path === p);
      return pictureCard({ path: take(f).path, name: baseName(p), sub: 'picked up in the game' });
    })));
  }
  parts.push(...section('Sprites', pictures
    .filter((f) => inDir(f, SPRITE_DIR) && !covered.has(f.path))
    .map((f) => pictureCard({ path: take(f).path, name: baseName(f.path), sub: sizeText(f.size), strip: true }))));
  if (!story && !adventure) {
    parts.push(...section('Pictures', pictures.filter((f) => inDir(f, IMAGE_DIR))
      .map((f) => pictureCard({ path: take(f).path, name: baseName(f.path), sub: sizeText(f.size) }))));
  }
  parts.push(...dressingSection(pictures, take));
  parts.push(...section('Other pictures', pictures.filter((f) => !covered.has(f.path))
    .map((f) => pictureCard({ path: f.path, name: f.path, sub: sizeText(f.size) }))));
  return [
    h('div', { class: 'pad row wrap' },
      frozen() ? null : h('button', {
        class: 'quiet tiny', text: 'Draw a picture',
        title: 'A blank canvas, ready to draw on',
        onclick: () => { S.dialog = { kind: 'draw-new', size: 64, name: 'sprite' }; render(); },
      }),
      // Straight to the device's own picker: everything Pics can add is a
      // picture, so a dialog here would only ever be this button and the two
      // beside it, one click further away.
      frozen() ? null : h('button', {
        class: 'quiet tiny', text: 'Upload a picture',
        title: 'A picture from this device',
        onclick: () => pickToUpload('image/*'),
      }),
      frozen() ? null : h('button', {
        class: 'quiet tiny', text: 'Add from the studio',
        title: 'Characters, places and things the studio already has',
        onclick: () => { S.dialog = { kind: 'pick-picture', art: null }; render(); },
      })),
    h('div', { class: 'pics scroll', 'data-scroll': 'pics' },
      // Said over the dressing section rather than instead of it: a game with
      // no pictures at all is exactly the one that has never been told what
      // the three it can wear are.
      pictures.length ? null : h('div', {
        class: 'pad muted', text: 'No pictures yet. Draw one, or ask a helper what the game needs.',
      }),
      parts),
  ];
}

// Hear: the game's sounds over its music (spec.md §6), a row each with a way
// to hear it. Selecting one opens it under its own row — sliders for a
// studio-made sound and a player for anything else — and the same row closes
// it again.
export function renderHearMode() {
  const audio = S.files.filter((f) => isAudioFile(f) && !f.unreachable);
  const row = (f) => {
    const on = S.open?.path === f.path;
    return [h('div', {
      class: `hear-row${on ? ' on' : ''}`,
      onclick: (e) => {
        if (e.target.closest('button')) return undefined;
        if (on) return closeOpenFile();
        return chooseFile(f.path);
      },
    },
    playButton(f.path),
    h('span', { class: 'hname mono', text: f.path.split('/').pop() }),
    h('span', { class: 'hsize', text: sizeText(f.size) }),
    fileMore(f.path)),
    on && S.open && isAudioFile(S.open) ? h('div', { class: 'inspector hear-open' },
      S.sound ? renderSoundEditor() : renderMedia(S.open),
      S.soundRefused ? h('p', { class: 'hint muted', text: S.soundRefused }) : null,
      h('p', { class: 'hint muted mono', text: f.path })) : null];
  };
  const section = (label, files) => (files.length
    ? [h('div', { class: 'section-label', text: label }), ...files.map(row)]
    : []);
  const sounds = audio.filter((f) => inDir(f, SOUND_DIR));
  const music = audio.filter((f) => inDir(f, MUSIC_DIR));
  const other = audio.filter((f) => !sounds.includes(f) && !music.includes(f));
  return [
    h('div', { class: 'pad row wrap' },
      frozen() ? null : h('button', {
        class: 'quiet tiny', text: 'Make a sound',
        title: 'A new blip, ready for its sliders',
        onclick: () => createSound(),
      }),
      frozen() ? null : h('button', {
        class: 'quiet tiny', text: 'Upload a sound',
        title: 'A sound or a whole track from this device',
        onclick: () => { S.dialog = { kind: 'add-file', only: 'sound' }; render(); },
      })),
    h('div', { class: 'hear scroll', 'data-scroll': 'hear' },
      ...section('Sounds', sounds), ...section('Music', music), ...section('Other', other),
      audio.length ? null : h('div', {
        class: 'pad muted', text: 'No sounds yet. Make one, or upload a track.',
      })),
  ];
}
