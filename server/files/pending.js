// The pending commit (spec.md §5). A person's save reaches the working tree at
// once and history a little later, as one commit for the run of saves rather
// than one per save. Every write used to be a commit, and a commit costs three
// things the spec has measured — a Versions row, a preview restart, and a
// prompt-cache miss for every helper from that file onward — so a story typed
// a line at a time was forty versions and forty reloads a minute.
//
// One window per project: whose saves, which paths, and a timer. It lands when
// the writer has been idle, when their client says they are leaving, and
// ⚠️ always before anybody else writes to the tree, before a helper fires, and
// before anything that reads the tree into history or rewrites it — a move, a
// restore, a rollback, a fork. So Versions never shows a person's work under a
// helper's name, and a fork never misses the line typed a moment ago. Only a
// person's saves open a window; a helper's turn commits as it always did.
//
// Every function called `…Locked` expects to be inside the project's mutex;
// the rest take it.
import { commitPaths, currentSha } from './git.js';
import { retagErrors } from '../runtime.js';

export const DEFAULT_IDLE_MS = 45_000;

// A version as the reporter carries it: a commit, or `<commit>:<n>` for the
// n-th save on top of it while a window is open — so the bytes a preview is
// running always have a name, committed yet or not (spec.md §8).
const STAMP_RE = /^[0-9a-f]{7,40}(:[0-9a-f]{1,8})?$/;
export const isStamp = (value) => typeof value === 'string' && STAMP_RE.test(value);

// Every commit that lands says so here, from whichever route or turn made it,
// so the client has one event to refresh Versions on. `files.changed` is about
// the tree and fires on the save; this is about history and may fire later.
export function versionNew(broker, slug, sha, paths) {
  if (!sha) return;
  broker.broadcast('version.new', { project_slug: slug, sha, paths });
}

export function createPending({ mutex, db = null, broker = null, idleMs = DEFAULT_IDLE_MS }) {
  // slug -> { dir, projectId, author, actions: Map<path, action>, writes, head, timer }
  const windows = new Map();
  // slug -> { stamp, sha } for the last window that landed: a preview still
  // running those bytes keeps reporting, under the commit they became.
  const landed = new Map();

  const stampFor = (w) => `${w.head}:${w.writes.toString(16)}`;

  // `create a.txt`, `update 3 files`: the verb the saves agree on, else update.
  function subjectFor(w) {
    const paths = [...w.actions.keys()];
    const verbs = new Set(w.actions.values());
    const verb = verbs.size === 1 ? verbs.values().next().value : 'update';
    return paths.length === 1 ? `${verb} ${paths[0]}` : `${verb} ${paths.length} files`;
  }

  function arm(slug, w) {
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      settle(slug).catch((err) => {
        console.error(`pending commit for ${slug} failed: ${err.message}`);
      });
    }, idleMs);
    // A timer must never be what keeps the process alive.
    w.timer.unref?.();
  }

  // Land the window, if there is one. `unless` names an author whose own
  // window is left open: their next save joins it rather than closing it.
  async function settleLocked(slug, { unless = null } = {}) {
    const w = windows.get(slug);
    if (!w) return null;
    if (unless && unless.email === w.author.email) return null;
    clearTimeout(w.timer);
    windows.delete(slug);
    const paths = [...w.actions.keys()];
    let sha;
    try {
      sha = await commitPaths(w.dir, paths, subjectFor(w), w.author);
    } catch (err) {
      // Nothing is lost — the bytes are in the tree — so the window goes back
      // and the next trigger tries again.
      windows.set(slug, w);
      arm(slug, w);
      throw err;
    }
    if (sha) {
      const stamp = stampFor(w);
      landed.set(slug, { stamp, sha });
      // The problems the preview filed against those saves were about the
      // bytes that just became this commit.
      if (db) retagErrors(db, w.projectId, stamp, sha);
      if (broker) versionNew(broker, slug, sha, paths);
    }
    return sha;
  }

  const settle = (slug) => mutex.run(slug, () => settleLocked(slug));

  // After a person's save has been written. Opens the window if none is open —
  // reading HEAD once, which is what the stamp hangs off — and restarts the
  // clock. The route has already settled anybody else's window before
  // writing; this only guards the case where it did not.
  async function note(slug, dir, { projectId, path, action, author }) {
    let w = windows.get(slug);
    if (w && w.author.email !== author.email) {
      await settleLocked(slug);
      w = null;
    }
    if (!w) {
      w = {
        dir, projectId, author, actions: new Map(), writes: 0, head: await currentSha(dir), timer: null,
      };
      windows.set(slug, w);
    }
    // Created and then edited in the same window is still a create.
    const before = w.actions.get(path);
    w.actions.set(path, before === 'create' ? 'create' : action);
    w.writes += 1;
    arm(slug, w);
  }

  return {
    note,
    settle,
    settleLocked,
    settleAll: () => Promise.all(
      [...windows.keys()].map((slug) => settle(slug).catch(() => null)),
    ),
    has: (slug) => windows.has(slug),
    // What the preview is stamped with, given HEAD as the caller read it.
    stampOf(slug, head) {
      const w = windows.get(slug);
      return w ? stampFor(w) : head;
    },
    landedFor: (slug) => landed.get(slug) ?? null,
  };
}
