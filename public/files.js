// A game's files: the tree itself, the three reserved images, opening one
// (as a picture to draw on, a sound to hear, or text to read), saving, and
// every move — rename, duplicate, delete, copy into another game or the
// studio's collection. One lifecycle, whichever kind of file it is.

import {
  S, api, say, send, render, showMode, frozen, loadProjects, encodePath,
  problem, NO_CONNECTION,
} from './main.js';
import {
  isDrawable, startDrawing, flushPalette, saveDrawing,
} from './drawing.js';
import { isSound, startSound, saveSound } from './sound-editor.js';
import { isQuizPath } from './quiz-editor.js';
import { isControlsPath, CONTROLS_FILE } from './controls-editor.js';
import { dirOf, closedDirs } from './files-tab.js';
import { dropArtIndex } from './story-guide.js';

/* Files ---------------------------------------------------------------------- */

export async function refreshFiles() {
  if (!S.slug) return;
  const res = await api('GET', `/api/projects/${S.slug}/files`);
  if (res.ok) {
    S.files = res.body.files;
    render();
  }
}

/* The reserved images -------------------------------------------------------

   Three picture names at the root of a game's tree are the studio's own
   dressing rather than the game's (GLOSSARY: *reserved image*): chat.png
   tiles behind the conversation, hero.png backs the bar over it and the
   game's card in the catalog, icon.png sits before the game's name in the
   sidebar. Root rather than assets/ on purpose — a sprite that happens to be
   called icon.png must not become the studio's dressing. All optional: a
   game without one wears the studio's own look. */

export const CHAT_IMAGE = 'chat.png';
export const HERO_IMAGE = 'hero.png';
export const ICON_IMAGE = 'icon.png';
export const RESERVED_IMAGES = [CHAT_IMAGE, HERO_IMAGE, ICON_IMAGE];

// What each of the three is, in the studio's own words, and the blank one it
// makes when somebody asks for one. These words are the only explanation the
// three ever get — the card under Pics wears `what`, and the dialog that
// offers them asks with `name` — so they live here, beside the names
// themselves, rather than being written out twice.
//
// `draw` is the blank canvas: a tile that repeats, a wide banner, a small
// square. `fit` is the most a picture from the device is scaled down to, which
// is generous — the studio would rather keep the picture than the bytes.
export const DRESSING = {
  [CHAT_IMAGE]: {
    name: 'Behind the conversation',
    what: 'behind the conversation',
    hint: 'It tiles, so it repeats across the whole pane — something small and quiet works best.',
    draw: [64, 64],
    fit: [512, 512],
  },
  [HERO_IMAGE]: {
    name: 'Over the conversation',
    what: 'behind the game\u2019s name, and on its card',
    hint: 'It backs the bar over the chat, and the game\u2019s card on the games page. Wide suits it.',
    draw: [320, 120],
    fit: [1280, 480],
  },
  [ICON_IMAGE]: {
    name: 'Beside the game\u2019s name',
    what: 'beside the game\u2019s name in the list',
    hint: 'The little picture in the sidebar, so it is only ever seen small.',
    draw: [32, 32],
    fit: [256, 256],
  },
};

// Held as object URLs rather than pointing a src at the file route: that
// route sends no-store, and a background rebuilt by every render would
// refetch on every keystroke. Fetched once, replaced on files.changed,
// revoked on replace so a session does not hold every wallpaper it ever saw.
async function imageUrl(slug, path) {
  const res = await send(`/api/projects/${slug}/files/${encodePath(path)}`);
  return res.ok ? URL.createObjectURL(await res.blob()) : null;
}

export function setReservedImages(next) {
  for (const url of Object.values(S.images)) if (url) URL.revokeObjectURL(url);
  S.images = next;
}

// The open game's two, by what S.files says is there — so the tree has to be
// fresh when this is called.
export async function loadReservedImages() {
  const slug = S.slug;
  const want = (path) => (S.files.some((f) => f.path === path) ? imageUrl(slug, path) : null);
  const [chat, hero] = await Promise.all([want(CHAT_IMAGE), want(HERO_IMAGE)]);
  // A slow fetch must not dress the game opened after it.
  if (S.slug !== slug) {
    for (const url of [chat, hero]) if (url) URL.revokeObjectURL(url);
    return;
  }
  setReservedImages({ chat, hero });
}

// One game's sidebar icon, straight from its tree: files.changed says the
// file moved, not which way, so the fetch is the check — a 404 is a deleted
// icon.
export async function refreshIcon(slug) {
  const url = await imageUrl(slug, ICON_IMAGE);
  const old = S.icons.get(slug);
  if (old) URL.revokeObjectURL(old);
  if (url) S.icons.set(slug, url);
  else S.icons.delete(slug);
  render();
}

// Fetch the icons the project list says exist and drop the ones it says are
// gone, never refetching one already held.
export function syncIcons() {
  for (const p of S.projects) {
    if (p.has_icon && !S.icons.has(p.slug)) refreshIcon(p.slug);
    else if (!p.has_icon && S.icons.has(p.slug)) {
      URL.revokeObjectURL(S.icons.get(p.slug));
      S.icons.delete(p.slug);
    }
  }
}

// ⚠️ Opening a file is several awaits long — its bytes, and for a picture the
// decode and the palette after that — so two clicks in a row overlap, and
// whichever finished last used to win, whichever was asked for last. Each open
// takes a token and drops everything it was carrying the moment a newer one
// starts. Without this, clicking one picture and then another showed the first
// one, or a title with no picture under it at all.
export let opening = null;

export async function openFile(path) {
  const token = {};
  opening = token;
  const stale = () => opening !== token;

  // A file opened from a link or a chip may sit in a folded folder; the row
  // showing is what says the editor is about this file, so unfold it.
  const top = dirOf(path);
  if (top) closedDirs().delete(top);

  // Colours changed in the editor ride along with whatever leaves it, so
  // switching files saves them instead of dropping them.
  await flushPalette();
  if (stale()) return;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (stale()) return;
  if (!res.ok) {
    say(problem(res, `Could not open ${path}.`), true);
    return;
  }
  // The listing already said whether this is text and what it is; a picture
  // opens with content null and is shown rather than edited.
  const entry = S.files.find((f) => f.path === path);
  const content = entry?.text ? await res.text() : null;
  if (stale()) return;
  S.open = {
    path,
    mime: entry?.mime ?? null,
    content,
    etag: res.headers.get('etag'),
    dirty: false,
  };
  S.draw = null;
  S.drawRefused = null;
  S.sound = null;
  S.soundRefused = null;
  // A file opens where it belongs: under Pics or Hear when that is the mode
  // and the file is its kind, under Questions when it is the quiz or Controls
  // when it is the bindings, and under Code for everything else, wherever it
  // was asked for.
  const mime = S.open.mime ?? '';
  const stays = (S.mode === 'pics' && mime.startsWith('image/'))
    || (S.mode === 'hear' && mime.startsWith('audio/'))
    || (S.mode === 'quiz' && isQuizPath(path))
    || (S.mode === 'controls' && isControlsPath(path));
  showMode(stays ? S.mode : 'code');
  render();
  // A picture opens as a picture you can draw on. There was a second way to
  // look at one and it showed it at exactly the same size, so it was a control
  // that did nothing but cost a click.
  if (isDrawable(S.open)) await startDrawing();
  // A sound opens as the numbers that made it, when it is one of ours.
  else if (isSound(S.open)) await startSound();
  // Last, and inside this await like everything else here: it is a number on a
  // link, so nothing waits for it, but a render landing after openFile has
  // settled would write the wrong address.
  await countVersions();
}

// How many versions this file has, for the link that opens them. One commit
// asked for and the count read off the answer — the number is the point, the
// list is the Versions tab's job. A failure leaves the link saying "Versions",
// which is what it said before there was a number to put on it.
export async function countVersions() {
  const token = opening;
  const path = S.open?.path;
  const res = await send(
    `/api/projects/${S.slug}/history?limit=1&path=${encodeURIComponent(path)}`,
  );
  if (opening !== token || S.open?.path !== path) return;
  if (!res.ok) return;
  const body = await res.json().catch(() => null);
  if (opening !== token || S.open?.path !== path) return;
  S.open.versions = body?.total ?? 0;
  render();
}

// Closing throws away unsaved text, which is the one thing in the editor that
// git cannot get back, so it asks first.
// `then` is the file to open once this one is out of the way, so choosing
// another file in the list asks the same question rather than throwing the
// work away silently. Now that every picture opens ready to draw on, that
// stray click is a great deal easier to make.
export function closeOpenFile(then = null) {
  if (!S.open) return;
  if (S.open.dirty) {
    S.dialog = { kind: 'close-file', path: S.open.path, then };
    render();
    return;
  }
  // A picture or a sound saves itself, so what is unsaved here is the last
  // two seconds of it: saved on the way out rather than asked about.
  if (S.draw?.dirty || S.sound?.dirty) return saveAndClose(then);
  // Returned, not fired and forgotten: a caller that waits for the close has
  // to be waiting for the open too. Back is one — it renders when this
  // settles, and a render that lands after it has already finished writes the
  // wrong address.
  if (then) return openFile(then);
  flushPalette();
  S.open = null;
  S.draw = null;
  S.drawRefused = null;
  S.sound = null;
  S.soundRefused = null;
  render();
}

// Choosing a file from anywhere at all — the list, a path in a diff, the
// header of one file's versions. Through closeOpenFile so unsaved work in the
// file being left gets the same question the ✕ asks, wherever the click came
// from.
export const chooseFile = (path) => (S.open ? closeOpenFile(path) : openFile(path));

// The third answer to that question: keep the work rather than throw it away.
// Whichever pane is open holds the unsaved thing — the text or the picture —
// so this picks the save that belongs to it, and the file closes only once the
// save has really landed. A conflict or a failure leaves the file open with
// the work still in it, exactly like the button in the editor bar.
export async function saveAndClose(then = null) {
  if (!S.open) return;
  let saved;
  if (S.draw) saved = await saveDrawing();
  else if (S.sound) saved = await saveSound();
  else saved = await saveOpenFile();
  if (saved) await closeOpenFile(then);
}

// True when the file is saved, false when it is not — a conflict or a failure
// — so "Save and close" knows whether closing would lose anything.
export async function saveOpenFile({ force = false } = {}) {
  if (!S.open) return false;
  const headers = { 'content-type': 'text/plain' };
  if (!force && S.open.etag) headers['if-match'] = S.open.etag;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(S.open.path)}`, {
    method: 'PUT', headers, body: S.open.content,
  });
  const body = await res.json().catch(() => null);

  if (res.status === 409) {
    // Someone — probably an agent — got there first. Offer the choice rather
    // than picking a winner.
    S.dialog = {
      kind: 'conflict',
      path: S.open.path,
      theirs: body?.content ?? '',
      etag: body?.etag ?? null,
    };
    render();
    return false;
  }
  if (!res.ok) {
    say(problem(res, body?.error ?? 'Could not save that file.'), true);
    return false;
  }
  S.open.etag = body.etag;
  S.open.dirty = false;
  S.previewNonce += 1;
  await refreshFiles();
  // The forms that save themselves say so in their own bar; Code's text
  // editor, which asks first, hears it back.
  if (!isQuizPath(S.open.path)) say(`Saved ${S.open.path}.`);
  else render();
  return true;
}

// The quiz form saves itself two seconds after the last change (spec.md §5):
// every change to it is a whole valid quiz, so there is nothing to wait for.
let openSaveTimer = null;
export function saveOpenFileSoon() {
  clearTimeout(openSaveTimer);
  openSaveTimer = setTimeout(() => {
    openSaveTimer = null;
    if (S.open?.dirty && !frozen()) saveOpenFile();
  }, 2000);
}

export async function createFile(path) {
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
    method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    say(body?.error ?? 'Could not make that file.', true);
    return;
  }
  await refreshFiles();
  await openFile(path);
}

/* The studio library ------------------------------------------------------- */

// A library is copied into a game, under studio/, rather than shared from one
// place. That is what keeps each game's repository complete: clone it, publish
// it, hand it to somebody, and it still runs, which neither a symlink nor a
// submodule survives.
//
// A game gets the library at creation (server/files/library.js) and is kept
// current by `npm run sweep` on the machine holding the games;
// studio/studio.json records which version it holds. There is no update from
// in here — a sweep's commits can be read and undone, where a button that
// rewrites somebody's game in one click asks nothing.
//
// The rule that makes it a library and not just a folder is in
// server/files/paths.js: a helper reads it and cannot write it.
export const LIBRARY_DIR = 'studio';

// The control scheme registry (public/templates/index.json, spec.md §4): what
// the Controls panel offers and the words for each. The studio's own file
// rather than any game's, so it is fetched once a session and kept — the
// panel renders on every keystroke and cannot wait for it each time.
async function loadSchemes() {
  if (S.schemes) return;
  const res = await send('/templates/index.json');
  if (!res.ok) return;
  const index = await res.json().catch(() => null);
  if (index) S.schemes = index;
}

// Controls is the controls file: arriving opens it, with the registry that
// names the shapes. A game with no config/controls.js — one from before the
// input library and never swept, or one a helper deleted it from — opens
// nothing rather than a banner about a file that cannot be opened, and the
// panel is what says so.
export async function openControls() {
  await loadSchemes();
  if (!S.files.some((f) => f.path === CONTROLS_FILE)) return;
  if (S.open?.path !== CONTROLS_FILE) await chooseFile(CONTROLS_FILE);
}

// The pixel and sound editors save themselves (spec.md §5): two seconds after
// the last stroke or slider, because every state a picture or a sound passes
// through is a picture or a sound. Code's text editor keeps its Save — half-
// typed code is a broken game. Skipped on a game the reader may not change;
// the write would only be refused.
let editorSaveTimer = null;
export function saveEditorSoon() {
  clearTimeout(editorSaveTimer);
  editorSaveTimer = setTimeout(() => {
    editorSaveTimer = null;
    if (frozen()) return;
    if (S.draw?.dirty) saveDrawing();
    else if (S.sound?.dirty) saveSound();
  }, 2000);
}

// A rename is a move, whether or not the folder changes with it: one commit,
// recorded by git as a rename, so the file's history is not cut in two.
export async function renameFile(from, to) {
  if (!to || to === from) return;
  const res = await api('POST', `/api/projects/${S.slug}/files/move`, { from, to });
  if (!res.ok) {
    say(res.body?.error ?? `Could not rename ${from}.`, true);
    return;
  }
  S.previewNonce += 1;
  // The new name goes on straight away, before anything else can look: a
  // commit is a files.changed on the stream, and the handler re-reads whatever
  // the open file is called — which, for the one moment between the answer and
  // the reopen below, was a file that no longer existed.
  if (S.open?.path === from) S.open = { ...S.open, path: to };
  await refreshFiles();
  // You renamed the file you were looking at, so you keep looking at it —
  // under the name it has now, which the address follows.
  if (S.open?.path === to) await openFile(to);
  say(`Renamed to ${to}.`);
}

// A duplicate is a new file that starts as another one: the bytes on disk,
// copied server-side, one commit. Unsaved edits stay where they are — in the
// editor, on the original — so the duplicate is of the last save.
export async function duplicateFile(from, to) {
  if (!to || to === from) return;
  const res = await api('POST', `/api/projects/${S.slug}/files/duplicate`, { from, to });
  if (!res.ok) {
    say(res.body?.error ?? `Could not duplicate ${from}.`, true);
    return;
  }
  S.previewNonce += 1;
  await refreshFiles();
  // The duplicate is the file you are about to change, so it opens — unless
  // the original holds unsaved work, which openFile would silently drop.
  if (!S.open?.dirty && !S.draw?.dirty && !S.sound?.dirty) await openFile(to);
  say(`Made ${to}.`);
}

// Whether it went: Modify image deletes the old name on its way to the new one
// and has a second thing to say only if this one was said already.
export async function deleteFile(path) {
  const res = await api('DELETE', `/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not delete that file.', true);
    return false;
  }
  if (S.open?.path === path) S.open = null;
  S.previewNonce += 1;
  await refreshFiles();
  say(`Deleted ${path}. You can get it back from Recall.`);
  return true;
}

// Open: anybody in the studio may change this game. An author's decision, and
// only an author's — the server says so too.
export async function setOpenEdit(open) {
  const res = await api('POST', `/api/projects/${S.slug}/open`, { open_edit: open });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change that.', true);
    return;
  }
  S.project.open_edit = open;
  await loadProjects();
  say(open
    ? 'Anybody in the studio can change this game now.'
    : 'Only this game’s editors can change it now — it wears a lock.');
  render();
}

// Who may change this game. The list comes back whole, so nothing here has to
// guess what the server did with a name it did not recognise.
export async function setAuthors(method, userId) {
  const path = method === 'POST'
    ? `/api/projects/${S.slug}/authors`
    : `/api/projects/${S.slug}/authors/${userId}`;
  const res = await api(method, path, method === 'POST' ? { user_id: userId } : undefined);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change who can edit this.', true);
    return;
  }
  S.project.authors = res.body.authors;
  S.project.mine = res.body.authors.some((a) => a.id === S.me.id);
  S.project.can_edit = S.project.mine || S.project.open_edit;
  await loadProjects();
  render();
}

export async function setPublished(published) {
  const res = await api('POST', `/api/projects/${S.slug}/publish`, { published });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change that.', true);
    return;
  }
  S.project.published = published;
  say(published
    ? 'This game is published now.'
    : 'Unpublished this game.');
}

// A file into another game: the bytes and nothing else. The route reads the
// source and writes the target, so the rights it checks are the target's.
export async function copyFileTo(slug, from, to) {
  const res = await api('POST', `/api/projects/${slug}/files/import`, {
    from_slug: S.slug, from_path: from, to_path: to,
  });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not copy that file.', true);
    return;
  }
  const game = S.projects.find((p) => p.slug === slug);
  say(`Copied ${to} into ${game?.name ?? slug}.`);
}

// A picture out of this game and into the studio's collection, where every
// game's shelf can pick it. The bytes go up raw, like an upload, with
// everything else in the query — a picture is not a JSON field.
export async function shareArt(path, { kind, name, who }) {
  const read = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (!read.ok) {
    say(read.status === 0 ? NO_CONNECTION : `Could not read ${path}.`, true);
    return;
  }
  const q = new URLSearchParams({ kind, name, ...(who ? { who } : {}) });
  const res = await send(`/api/collection?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: await read.blob(),
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    say(res.status === 0 ? NO_CONNECTION : (parsed?.error ?? 'Could not share that picture.'), true);
    return;
  }
  dropArtIndex();
  say(`${name} is in the studio's collection now. Every game can pick it.`);
}

// Back out again. The row is the only copy, which the dialog says; a game
// that already picked it keeps its own.
export async function unshareArt(art) {
  const res = await api('DELETE', `/api/collection/${art.id}`);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not take that picture out.', true);
    return;
  }
  dropArtIndex();
  say(`${art.name} is out of the studio's collection.`);
  render();
}
