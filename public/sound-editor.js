// A sound as the numbers it was made from: reading a .wav's own note back out
// (public/sound-maker.js), the sliders that change it (sound-form.js), and
// saving it as a .wav again. Anything the browser calls audio is offered to
// the editor; what decides whether it has sliders is the file itself — one
// the studio wrote carries the numbers, and anything else stays the player it
// always was.

import { h } from './dom.js';
import { soundFrom, soundBytes, soundIn } from './sound-maker.js';
import { renderSoundForm, playSound } from './sound-form.js';
import { SOUND_DIR, writeFiles } from './upload.js';
import {
  S, send, say, render, encodePath, problem,
} from './main.js';
import {
  refreshFiles, openFile, saveEditorSoon, opening, putOpenFile,
} from './files.js';

export const isSound = (open) => !!open?.mime?.startsWith('audio/');

// The numbers come back out of the file rather than out of anything the studio
// kept, so what the sliders show is what is on disk. Same ownership rule as
// the picture: a sound read after a newer file has been asked for is dropped.
export async function startSound() {
  const token = opening;
  const stale = () => opening !== token;
  const path = S.open.path;

  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (stale()) return;
  if (!res.ok) {
    S.soundRefused = problem(res, 'The studio could not read this sound.');
    say(S.soundRefused, true);
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (stale()) return;
  const params = soundIn(bytes);
  if (!params) {
    // Said out loud rather than left as a player with no sliders: the numbers
    // cannot be worked back out of the samples, and without a line here that
    // reads as the studio forgetting how to open its own files.
    S.soundRefused = 'This one was not made here, so there are no numbers to change. It plays like any other sound.';
    render();
    return;
  }
  S.sound = { params, dirty: false };
  render();
}

// True when it landed and false when it did not, like the other two.
export async function saveSound() {
  const { path } = S.open;
  const holding = S.sound;
  const headers = S.open.etag ? { 'if-match': S.open.etag } : {};
  const { res, answer: body } = await putOpenFile(path, {
    headers, body: new Blob([soundBytes(holding.params)], { type: 'audio/wav' }),
  });
  // Two sounds cannot be compared in a dialog any more than two pictures can,
  // and the numbers are the whole file, so this says what happened and touches
  // nothing.
  if (res.status === 409) {
    say(`Someone changed ${path} while you were working on it. Close it and open it again to hear theirs.`, true);
    return false;
  }
  if (!res.ok) {
    say(problem(res, body?.error ?? 'Could not save that sound.'), true);
    return false;
  }
  // The save is a write on the stream like any other, and the pane may have
  // been rebuilt underneath, so only the editor that asked may finish the job.
  // `savedAt` is what tells the files.changed handler this write is our own.
  if (S.sound === holding && S.open?.path === path) {
    S.open.etag = body.etag;
    S.open.savedAt = Date.now();
    S.sound.dirty = false;
  }
  S.previewNonce += 1;
  await refreshFiles();
  return true;
}

// A name nobody has to think of. The sound is made first and named afterwards
// — by then you have heard it, which is the only moment anybody knows what it
// should be called — so this only has to be free and say what it is.
function freeName(dir, stem, ext) {
  for (let n = 1; ; n += 1) {
    const path = `${dir}/${stem}${n > 1 ? `-${n}` : ''}${ext}`;
    if (!S.files.some((f) => f.path === path)) return path;
  }
}

// No dialog: the one thing it used to ask that mattered was the name, and a
// name is a better question after you have heard the sound than before. It
// lands as a plain blip and opens on its sliders; Rename is in the same bar.
export async function createSound() {
  const path = freeName(SOUND_DIR, 'sound', '.wav');
  const body = new Blob([soundBytes(soundFrom('pickup'))], { type: 'audio/wav' });
  const { failure } = await writeFiles([{ path, body }]);
  if (failure) { say(failure, true); return; }
  say(`Made ${path}. Change it with the sliders, and Rename it when it sounds like something.`);
  // Opening it is what shows the sliders — the file carries them — so making a
  // sound and changing one later are the same thing from here on.
  await openFile(path);
}

// The sound as its numbers, with the same bar under it as every other pane.
// The sliders paint themselves (sound-form.js); this is the part that knows
// whether they have been saved.
export function renderSoundEditor() {
  const state = h('span', { class: 'hint muted' });
  const paint = () => { state.textContent = S.sound.dirty ? 'Saving…' : 'Saved'; };
  // No Save: a slider moved is a sound saved, two seconds later (spec.md §5).
  const changed = () => { S.sound.dirty = true; paint(); saveEditorSoon(); };
  paint();

  return h('div', { class: 'sound grow' },
    h('div', { class: 'scroll pad', 'data-scroll': 'sound' }, renderSoundForm(S.sound.params, changed)),
    h('div', { class: 'editor-bar row' },
      state,
      h('div', { class: 'spacer' }),
      h('button', { class: 'quiet', text: 'Play', onclick: () => playSound(S.sound.params) })));
}
