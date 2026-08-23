// Putting files into a game from this device: the path each one will take,
// the PUTs that send them, and the drop target. The dialog that fronts an
// upload lives in dialogs.js; the buttons that open it are on the files tab.

import {
  S, send, say, render, refreshFiles, openFile, sizeText, encodePath, NO_CONNECTION,
} from './main.js';

/* Uploads ----------------------------------------------------------------- */

// Where a picture or sound lands unless you say otherwise. The agent preamble
// names the same folder, so a dropped sprite is already at the path a helper
// will write in its code.
export const ASSET_DIR = 'assets';

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
export function uploadPlan(folder, files) {
  const taken = new Set();
  return files.map((file) => {
    const path = assetPath(folder, file.name);
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

export const openUpload = (files) => { S.dialog = { kind: 'upload', files }; render(); };

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
