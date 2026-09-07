// Pics and Hear (spec.md §6): every picture in the game by what it is, and
// every sound over its music. A picture opens in the pixel editor on one
// click; a sound opens its editor in the rail on one click.

import { h } from './dom.js';
import {
  SPRITE_DIR, IMAGE_DIR, SOUND_DIR, MUSIC_DIR, pickToUpload,
} from './upload.js';
import { pictureInto, playButton, renderPersonInspector } from './story-form.js';
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
      // A person may be selected into the rail; opening a picture is not about
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
// about them are the inspector's; taking them out of the story is Write's.
function personCard(person) {
  const on = S.pick?.kind === 'person' && S.pick.key === person.key;
  const img = h('img', { alt: '' });
  if (person.moods[0]) pictureInto(img, `${SPRITE_DIR}/${person.key}-${person.moods[0]}.png`);
  return h('div', {
    class: `card face${on ? ' on' : ''}`,
    onclick: () => { S.pick = { kind: 'person', key: person.key }; render(); },
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
  parts.push(...section('Sprites', pictures
    .filter((f) => inDir(f, SPRITE_DIR) && !covered.has(f.path))
    .map((f) => pictureCard({ path: take(f).path, name: baseName(f.path), sub: sizeText(f.size), strip: true }))));
  if (!story) {
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
// to hear it. Selecting one opens it — its editor lands in the rail, sliders
// for a studio-made sound and a player for anything else — while the list
// stays here; the same row closes it again.
export function renderHearMode() {
  const audio = S.files.filter((f) => isAudioFile(f) && !f.unreachable);
  const row = (f) => {
    const on = S.open?.path === f.path;
    return h('div', {
      class: `hear-row${on ? ' on' : ''}`,
      onclick: (e) => {
        if (e.target.closest('button')) return undefined;
        return on ? closeOpenFile() : chooseFile(f.path);
      },
    },
    playButton(f.path),
    h('span', { class: 'hname mono', text: f.path.split('/').pop() }),
    h('span', { class: 'hsize', text: sizeText(f.size) }),
    fileMore(f.path));
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

// The inspector for Pics and Hear: the picked picture or person, or the open
// sound. A picture is where it lives and how big it is, and a way to draw on
// it, with the file's ··· in its head — its card is not on screen once it is
// open. A sound is the sound editor, or the player for one not made here.
export function renderPickInspector() {
  const head = (kind, name, ...extra) => h('div', { class: 'inspector-head row' },
    h('div', { class: 'grow' },
      h('span', { class: 'section-label', text: kind }),
      h('div', { class: 'iname', text: name })),
    ...extra);
  const box = (...kids) => h('div', { class: 'inspector scroll', 'data-scroll': 'inspector' }, ...kids);
  const fieldRow = (label, ...kids) => h('div', { class: 'ifield' },
    h('span', { class: 'ilabel', text: label }), ...kids);
  const shut = (onclick) => h('button', { class: 'icon tiny', text: '✕', title: 'Close', onclick });

  if (S.mode === 'hear') {
    if (!S.open || !isAudioFile(S.open)) return null;
    const { path } = S.open;
    return box(head('Sound', path.split('/').pop(), fileMore(path), shut(() => closeOpenFile())),
      S.sound ? renderSoundEditor() : renderMedia(S.open),
      S.soundRefused ? h('p', { class: 'hint muted', text: S.soundRefused }) : null,
      fieldRow('Where it lives', h('span', { class: 'hint muted mono', text: path })));
  }
  if (S.mode !== 'pics') return null;
  // The open picture first: it is what the pane is about, and a person left
  // selected from before is not.
  if (S.open && isPictureFile(S.open)) {
    const { path } = S.open;
    const f = S.files.find((x) => x.path === path);
    if (!f) return null;
    const sprite = inDir(f, SPRITE_DIR);
    const dressing = RESERVED_IMAGES.includes(path);
    // No thumbnail: the picture itself is in the editor beside this, and the
    // rail showing a second smaller copy of it was the whole of what made the
    // old two-click open feel pointless.
    return box(
      head(dressing ? 'Studio dressing' : sprite ? 'Sprite' : 'Picture', path.split('/').pop(),
        fileMore(path), shut(() => closeOpenFile())),
      fieldRow('Where it lives', h('span', { class: 'hint muted mono', text: `${path} · ${sizeText(f.size)}` })),
      dressing ? fieldRow('Dresses', h('span', { class: 'hint muted', text: DRESSING[path].what })) : null);
  }
  if (S.pick?.kind === 'person') {
    const person = S.story?.model?.cast.find((p) => p.key === S.pick.key);
    return person ? renderPersonInspector(person, { close: () => { S.pick = null; render(); } }) : null;
  }
  return null;
}
