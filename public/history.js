// Versions: the data behind the Share page's history section — the list, one
// diff, a restore of a single file, and a whole-tree rollback.

import {
  S, api, say, render,
} from './main.js';
import { refreshFiles, openFile } from './files.js';

// The list on screen is not the list being asked for — a different filter, one
// that was never fetched, or one a commit has landed under since.
export const historyNeedsLoad = (path) => path !== S.historyPath
  || S.history.length === 0
  || S.historyStale;

// A diff opened from somewhere other than its own row — from one file's
// versions, where the whole version is fifty rows away — has to be gone to.
// One shot, set by whatever opened it: doing this on every render would yank
// the list around under someone who had scrolled away from an open diff.
let showDiffRow = false;

export function keepDiffInView() {
  if (!showDiffRow) return;
  showDiffRow = false;
  // 'start', not 'nearest': the row being on screen is not the point, seeing
  // what is inside it is, and the drawer is below the row.
  document.querySelector('.commit.open')?.scrollIntoView({ block: 'start' });
}

export async function loadHistory(path = null) {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await api('GET', `/api/projects/${S.slug}/history${query}`);
  if (res.ok) {
    S.history = res.body.commits;
    S.historyTotal = res.body.total;
    S.historyPath = path;
    S.historyStale = false;
    S.diff = null;
    render();
  }
}

// A whole commit, always. The list's filter is still the drawer's filter —
// from one file's versions the question is what happened to that file — but
// the narrowing happens here rather than in the request, so the version can
// also say how many other files it touched. `All files changed (n)` clears the
// filter, which is how you get the rest of it.
// `goTo` for a diff opened from somewhere other than its own row, which may be
// anywhere down a list of fifty. Set here rather than by the caller so it is
// set only when there is a row to go to: a request that fails renders nothing,
// and a flag left standing would jump the list on some later render instead.
export async function loadDiff(sha, { goTo = false } = {}) {
  const res = await api('GET', `/api/projects/${S.slug}/diff/${sha}`);
  if (res.ok) {
    S.diff = res.body;
    showDiffRow = showDiffRow || goTo;
    render();
  }
}

export async function restore(sha, path) {
  const res = await api('POST', `/api/projects/${S.slug}/restore`, { sha, path });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not bring that version back.', true);
    return;
  }
  S.previewNonce += 1;
  await refreshFiles();
  if (S.open?.path === path) await openFile(path);
  await loadHistory(S.historyPath);
  say(`Brought ${path} back to an earlier version.`);
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Whole-tree rollback. The result is reported rather than the confirmation
// predicted: the server is the one that knows how many files moved.
export async function rollback(sha) {
  const res = await api('POST', `/api/projects/${S.slug}/rollback`, { sha });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not bring that version back.', true);
    return;
  }
  S.previewNonce += 1;
  await refreshFiles();
  if (S.open?.path) await openFile(S.open.path);
  await loadHistory(S.historyPath);
  const { commit, restored, removed } = res.body;
  if (!commit) {
    say('Everything already looked like that version, so nothing changed.');
    return;
  }
  const gone = removed > 0 ? `, ${plural(removed, 'newer file')} taken away` : '';
  say(`Everything is back to ${sha.slice(0, 7)} — ${plural(restored, 'file')} put back${gone}.`);
}
