// Putting files into a game from this device: the path each one will take,
// the PUTs that send them, and the drop target. The dialog that fronts an
// upload lives in dialogs.js; the buttons that open it are on the files tab.

import { h } from './dom.js';
import { MAX_SIDE } from './pixel-editor.js';
import {
  S, send, say, render, sizeText, encodePath, NO_CONNECTION,
} from './main.js';
import { refreshFiles, openFile, RESERVED_IMAGES } from './files.js';

/* Uploads ----------------------------------------------------------------- */

// Where a file lands unless you say otherwise, by what it is. The agent
// preamble names the same folders and the libraries look in them, so a sound
// dropped here is already at the path `Sound.play("laser")` resolves to.
//
// A *strip* — a picture whose width is a whole multiple of its height — is a
// sprite; any other picture is one to look at. That is the same rule the
// sprites library uses to decide whether a file animates, so the folder a
// picture lands in and the way it is drawn agree.
const ASSET_DIR = 'assets';
export const SOUND_DIR = `${ASSET_DIR}/sounds`;
export const MUSIC_DIR = `${ASSET_DIR}/music`;
export const IMAGE_DIR = `${ASSET_DIR}/images`;
export const SPRITE_DIR = `${ASSET_DIR}/sprites`;

// Where audio stops being a noise and becomes a tune. A sound effect longer
// than this is unusual and a piece of music shorter than it is unusual, so
// this is the line — and like the strip test below it is a guess the dialog
// shows before anything is sent, and the folder box overrules.
const MUSIC_SECONDS = 10;

// How long a file plays, without decoding it: the metadata alone carries the
// duration. 0 for anything the browser will not open, which sends it to
// assets/sounds/ — the folder audio went to before there was a choice.
// Infinity is possible for a stream and counts as music.
function seconds(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => done(audio.duration || 0));
    audio.addEventListener('error', () => done(0));
    audio.src = url;
  });
}

// A dropped file has to be measured before its folder can be guessed, so this
// is async and the dialog waits for it: a picture's shape says whether it is a
// strip, and audio's length says whether it is music. Anything that will not
// decode is a file the studio cannot measure, and goes where the ones it
// cannot animate or time go.
async function uploadItems(files) {
  return Promise.all(files.map(async (file) => {
    // The three reserved images live at the root, whatever their shape says:
    // hero.png is usually wide, and wide-and-divisible is also what a strip
    // looks like. The folder box in the dialog still overrules this.
    if (RESERVED_IMAGES.includes(assetPath('', file.name))) return { file, folder: '' };
    if (file.type?.startsWith('audio/')) {
      const length = await seconds(file);
      return { file, folder: length > MUSIC_SECONDS ? MUSIC_DIR : SOUND_DIR };
    }
    if (!file.type?.startsWith('image/')) return { file, folder: ASSET_DIR };
    const bitmap = await createImageBitmap(file).catch(() => null);
    const strip = !!bitmap && bitmap.width > bitmap.height
      && bitmap.width % bitmap.height === 0;
    // Too big for the pixel editor to open: the one kind of picture Upload
    // offers to make pixel art of first (dialogs.js, spec.md §6).
    const huge = !!bitmap && (bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE);
    bitmap?.close();
    return { file, folder: strip ? SPRITE_DIR : IMAGE_DIR, huge };
  }));
}

// Mirrors MAX_FILE_BYTES in server/files/tree.js. Checked here too so an
// oversized file is named in the dialog rather than failing halfway up.
const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// A dropped file's name becomes a project path: lowercased, runs of anything
// that isn't a letter or digit become one dash, the extension kept. The server
// validates the result regardless — this is so `My Hero (2).PNG` lands
// somewhere a ten-year-old can say out loud.
export function assetPath(folder, filename) {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  const stem = (dot > 0 ? filename.slice(0, dot) : filename)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    // A name of nothing but punctuation would otherwise leave `.png` alone,
    // which is a hidden file rather than a picture.
    || 'file';
  return folder ? `${folder}/${stem}${ext}` : `${stem}${ext}`;
}

// What an upload would do, worked out before anything is sent so the dialog can
// show it: where each file lands, whether it replaces one already there, and
// the reason a file is being left out.
//
// `folder` is the override typed into the dialog. Empty — which is how it
// starts — means each file goes to the folder its kind says, so a drop of a
// sound and two sprites lands in two places without anybody choosing twice.
export function uploadPlan(folder, items) {
  const taken = new Set();
  return items.map((item) => {
    const { file } = item;
    const path = assetPath(folder || item.folder, file.name);
    let problem = null;
    if (file.size > MAX_UPLOAD_BYTES) {
      problem = `too big — ${MAX_UPLOAD_MB} MB is the most`;
    } else if (taken.has(path)) {
      // Two dropped files can tidy down to one name. Letting the second
      // overwrite the first is the kind of loss nobody thinks to look for.
      problem = 'another one of these wants the same name';
    } else {
      // Only a file that is actually going to be sent holds the name — a
      // rejected one must not block the next file that wants it.
      taken.add(path);
    }
    return {
      file,
      path,
      problem,
      huge: item.huge === true,
      note: S.files.some((f) => f.path === path)
        ? 'replaces the one there now'
        : file.type
          ? sizeText(file.size)
          : `${sizeText(file.size)} — the game may not be able to use this`,
    };
  });
}

// One PUT per file, one commit each — the same thing a helper does when it
// writes several files. No If-Match: these replace on purpose, and whatever
// asked for them already said which files it would replace.
export async function writeFiles(plan) {
  let done = 0;
  let failure = null;
  for (const { path, body } of plan) {
    const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
      method: 'PUT', body,
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => null);
      failure = uploadProblem(res.status, path, parsed?.error);
      // Whatever stopped this one stops the rest, and a banner per file would
      // bury the reason.
      break;
    }
    done += 1;
  }

  S.previewNonce += 1;
  await refreshFiles();
  return { done, failure };
}

export async function uploadFiles(plan) {
  if (plan.length > 1) say(`Adding ${plan.length} things…`);
  const { done, failure } = await writeFiles(plan.map(({ path, file }) => ({ path, body: file })));
  if (failure) {
    say(done ? `${failure} ${done} of ${plan.length} got added.` : failure, true);
    return;
  }
  say(plan.length === 1 ? `Added ${plan[0].path}.` : `Added ${plan.length} files.`);
  // One file is something you want to look at; twelve sprites are not.
  if (plan.length === 1) await openFile(plan[0].path);
}

// The server's limits are exact and in bytes; the same fact has to arrive in
// words. Which cap was hit doesn't change what you'd do about it, so both
// 409s read the same. Anything unmapped keeps the server's own sentence.
function uploadProblem(status, path, error) {
  if (status === 0) return NO_CONNECTION;
  if (status === 413) {
    return `${path} is too big to add. One file can be up to ${MAX_UPLOAD_MB} MB.`;
  }
  if (status === 409) return `There is no room for ${path} — this game is full.`;
  return error ?? `Could not add ${path}.`;
}

// Measured before the dialog opens rather than inside it: the dialog's whole
// job is to show the path each file will take, and a path that changed a
// moment after it appeared would be the one thing it must not do.
export const openUpload = async (files) => {
  S.dialog = { kind: 'upload', items: await uploadItems(files) };
  render();
};

// The device's own picker, opened straight from a button — for a surface that
// offers uploading as a thing of its own rather than as one choice among
// several. A dialog whose only job is to open this one is a click nobody asked
// for. One input for the life of the page, appended to the body rather than
// built into the tree: a render clears the tree, and an input that has left the
// document takes its change event with it while the picker is still open.
let picker = null;
export function pickToUpload(accept = null) {
  if (!picker) {
    picker = h('input', {
      type: 'file', multiple: true, hidden: true,
      onchange: (e) => {
        const files = [...e.currentTarget.files];
        // Cleared so picking the same file twice in a row still fires.
        e.currentTarget.value = '';
        if (files.length) openUpload(files);
      },
    });
    document.body.append(picker);
  }
  picker.accept = accept ?? '';
  picker.click();
}

// Dropping onto the list is the quickest way in on a laptop; the button beside
// New file is the one that works on a tablet. Both end in the same dialog.
// The highlight is toggled on the node rather than through render(), which
// would rebuild the element mid-drag and lose the drop.
export function makeDropTarget(el) {
  const mark = (on) => el.classList.toggle('dropping', on);
  el.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    mark(true);
  });
  el.addEventListener('dragleave', (e) => { if (e.target === el) mark(false); });
  el.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    mark(false);
    const files = [...e.dataTransfer.files];
    if (files.length) openUpload(files);
  });
}

export const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
