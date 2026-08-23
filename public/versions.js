// The Versions tab: the list of commits, the drawer a version's changes open
// in, and the pictures a version shows without being asked. The actions —
// loading history, loading a diff, bringing things back — stay in main.js;
// this is the reading of them.

import { patchFor, hasHunks, renameIn } from './patch.js';
import { h } from './dom.js';
import {
  S, render, encodePath, chooseFile, loadHistory, loadDiff, urlAs,
} from './main.js';

/* Versions ----------------------------------------------------------------- */

function renderDiff(patch) {
  const lines = patch.split('\n').map((line) => {
    let cls = null;
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
    else if (line.startsWith('@@')) cls = 'hunk';
    return h('span', { class: cls, text: `${line}\n` });
  });
  return h('pre', { class: 'diff' }, lines);
}

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|svg)$/i;

// The pictures in a version, narrowed to the file being read when the list is
// filtered to one: `paths` is the whole commit now, and a sprite that rode
// along in the same commit is not what a filtered list is about.
const imagesIn = (commit) => (commit?.paths ?? [])
  .filter((p) => IMAGE_PATH.test(p) && (!S.historyPath || p === S.historyPath));

// A picture as it was at one commit. git names a path in a commit that deleted
// it too, and there is nothing to show for that version, so a picture that
// will not load takes itself out rather than leaving a broken frame.
const versionImage = (sha, path, cls) => h('img', {
  class: cls,
  src: `/api/projects/${S.slug}/history/${sha}/${encodePath(path)}`,
  alt: path,
  loading: 'lazy',
  onerror: (e) => e.currentTarget.closest('.shot, .shot-big')?.remove(),
});

// A path, as a way back to the file it names — which is the usual reason to
// be reading about it. A path that is no longer in the game is plain text:
// there is nothing to open, and it says so on hover. So is an unreachable one,
// which the file list will not open either — a control that lights up and then
// answers with a red banner is the same fault in a different place.
function fileLink(path) {
  const entry = S.files.find((f) => f.path === path);
  if (entry && !entry.unreachable) {
    return h('button', { class: 'link', text: path, onclick: () => chooseFile(path) });
  }
  return h('span', {
    text: path,
    title: entry
      ? 'The studio cannot open this file — see the list under Files'
      : 'This file is not in the game any more',
  });
}

// The part of the open version being read: the whole commit, or one file's
// share of it. Kept until the version or the filter changes, because a whole
// commit can be hundreds of kilobytes and an open drawer is re-rendered by
// every chunk of an agent's reply.
let shownPatch = { key: null, patch: '' };

function patchShown() {
  const key = `${S.diff.sha}|${S.historyPath ?? ''}`;
  if (shownPatch.key !== key) {
    shownPatch = {
      key,
      patch: S.historyPath ? patchFor(S.diff.patch, S.historyPath) : S.diff.patch,
    };
  }
  return shownPatch.patch;
}

// The changes for one commit, opened inside its own row. Only ever one is
// open, because opening a second replaces S.diff — which is also what makes
// "the last one closes itself" true without any bookkeeping.
function diffDrawer() {
  // Filtered to one file, the drawer is about the file the header already
  // names, so listing it and labelling its picture would be that same path a
  // third and fourth time in one row.
  const oneFile = Boolean(S.historyPath);

  const paths = oneFile ? null : (S.diff.paths.length === 0
    ? ['nothing']
    : S.diff.paths.map((p, i) => [
      i ? ', ' : null,
      fileLink(p),
    ]));

  const pictures = imagesIn(S.diff);
  const patch = patchShown();
  const text = hasHunks(patch);
  // A version that only moved the file has no hunk and no picture in it, and
  // said nothing at all until it said this. The name worth showing is the one
  // you are not standing on.
  const moved = !text && oneFile ? renameIn(patch) : null;
  const movedTo = moved && moved.to !== S.historyPath ? moved.to : null;
  const movedFrom = moved && moved.to === S.historyPath ? moved.from : null;

  return h('div', { class: 'drawer' },
    oneFile ? null : h('div', { class: 'hint muted' }, 'Changed: ', paths),
    pictures.map((p) => h('div', { class: 'shot-big' },
      oneFile ? null : h('div', { class: 'hint muted mono', text: p }),
      versionImage(S.diff.sha, p))),
    text ? renderDiff(patch) : null,
    movedTo ? h('div', { class: 'hint muted' }, 'Renamed to ', fileLink(movedTo)) : null,
    movedFrom ? h('div', { class: 'hint muted' }, 'Renamed from ', fileLink(movedFrom)) : null,
    !text && !moved && !pictures.length
      ? h('div', { class: 'muted', text: 'Nothing to show for this one.' })
      : null);
}

// Links are for looking at something, buttons are for changing something. The
// distinction is the whole vocabulary of this list: Show changes, All files
// and All files changed are links; bringing a version back is a button.
export function renderVersionsTab() {
  const header = h('div', { class: 'pad row' },
    // The name in the heading is the way back to the file: you got here from
    // it, and the usual next move is to go and change it.
    S.historyPath
      ? h('span', { class: 'hint muted' }, 'Versions of ', fileLink(S.historyPath))
      : h('span', { class: 'hint muted', text: 'All versions' }),
    h('div', { class: 'spacer' }),
    S.historyPath
      ? h('button', { class: 'link tiny', text: 'All files', onclick: () => loadHistory(null) })
      : null);

  const rows = S.history.map((c, i) => {
    const open = S.diff?.sha === c.sha;
    // One row's changes, open or shut. Every control that shows them is the
    // same control: the picture, and the words beside it.
    const toggle = () => {
      if (!open) return loadDiff(c.sha);
      S.diff = null;
      return render();
    };
    const pictures = imagesIn(c);
    // This list is git log for one path, newest first, so its first row is the
    // commit that produced the bytes on disk — bringing it back would commit
    // the file over itself. Unless that commit was the one that deleted it, in
    // which case bringing it back is the entire point.
    const current = S.historyPath && i === 0
      && S.files.some((f) => f.path === S.historyPath);
    return h('div', { class: `commit${open ? ' open' : ''}` },
      h('div', { class: 'subject', text: c.subject }),
      h('div', { class: 'meta' },
        h('span', { class: 'sha', text: c.short }), ' · ', c.author, ' · ',
        new Date(c.at).toLocaleString()),
      // A picture in a version is worth seeing without asking for it: the
      // question about a sprite is always "which one is that", and no amount
      // of reading a commit subject answers it.
      pictures.length
        ? h('div', { class: 'shots' }, pictures.map((p) => h('button', {
          class: 'shot',
          title: open ? `${p} — hide the details` : `${p} — see it big, and what else changed`,
          onclick: toggle,
        }, versionImage(c.sha, p))))
        : null,
      // Wrapped: three controls and a "Current version" do not fit a narrow
      // rail, and a label broken across two lines mid-phrase reads worse than
      // a control moved to the next line whole.
      h('div', { class: 'row wrap', style: 'margin-top:5px' },
        h('button', {
          class: 'link tiny',
          // One control in one place, its label saying which way it goes,
          // rather than a second control appearing beside it once it is open.
          text: open ? 'Hide changes' : 'Show changes',
          onclick: toggle,
        }),
        // From one file's history, the useful move is to go and look at the
        // whole version this file changed in — not to roll the project back,
        // which is a decision you make from the full list. `paths` is the
        // whole commit even here, so a version that touched nothing but the
        // file being read offers nothing: there is no rest of it to see.
        S.historyPath && c.paths.length > 1
          ? h('button', {
            class: 'link tiny', text: `All files changed (${c.paths.length})`,
            onclick: async () => {
              // Dropping the filter is on the way to the whole version, not
              // somewhere to come back to, so the two steps are one entry.
              await urlAs('hold', () => loadHistory(null));
              await loadDiff(c.sha, { goTo: true });
            },
          })
          : null,
        // Text, not a control: there is nowhere for it to go. It stays put in
        // the row rather than disappearing, so the newest version says what it
        // is instead of being the one row with nothing on the right.
        current ? h('span', { class: 'current', text: 'Current version' }) : null,
        S.historyPath && !current && !S.project.archived
          ? h('button', {
            class: 'quiet tiny', text: 'Bring this file back',
            onclick: () => {
              S.dialog = { kind: 'restore', sha: c.sha, path: S.historyPath, short: c.short };
              render();
            },
          })
          : null,
        !S.historyPath && !S.project.archived
          ? h('button', {
            class: 'quiet tiny', text: 'Bring everything back',
            onclick: () => {
              S.dialog = { kind: 'rollback', sha: c.sha, short: c.short };
              render();
            },
          })
          : null),
      open ? diffDrawer() : null);
  });

  // A diff whose commit is not in the list — older than the fifty this shows —
  // has nowhere to open, so it falls back to the foot of the list rather than
  // vanishing.
  const inList = S.history.some((c) => c.sha === S.diff?.sha);
  return [header, h('div', { class: 'scroll', 'data-scroll': 'versions' },
    rows.length ? rows : h('div', { class: 'pad muted', text: 'No versions yet.' }),
    S.diff && !inList ? h('div', { class: 'pad' }, diffDrawer()) : null)];
}
