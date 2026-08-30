import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { mimeForPath, OCTET_STREAM } from '../http/static.js';
import { requireAuth } from '../auth.js';
import { resolveProjectPath, checkProjectPath } from '../files/paths.js';
import {
  writeFileAt, etagFor, listTree, removeFileAt,
  MAX_PROJECT_BYTES, MAX_PROJECT_FILES,
} from '../files/tree.js';
import {
  logCommits, countCommits, showFile, diffCommit, commitPaths, commitPathsTouched,
  treeAtCommit, restoreTree, GitError, isSha,
} from '../files/git.js';
import { requireProject, projectDirFor, authorFor } from './helpers.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function limitFrom(query) {
  const raw = Number(query.get('limit'));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

// An optional ?path= filter still has to satisfy path validation — history is
// a read, but it reaches git as a pathspec.
function optionalPath(query) {
  const raw = query.get('path');
  if (raw === null || raw === '') return null;
  const checked = checkProjectPath(raw);
  if (!checked.ok) throw new HttpError(400, checked.reason);
  return checked.path;
}

function requireShaParam(value) {
  if (!isSha(value)) throw new HttpError(400, 'not a commit id');
  return value;
}

export function historyRoutes(r) {
  r.get('/api/projects/:slug/history', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    const dir = projectDirFor(ctx, project);
    const path = optionalPath(ctx.query);
    // `total` is every version, `commits` at most a page of them: the file's
    // own bar wants the number without the list, and asks for one commit to
    // get it.
    const [commits, total] = await Promise.all([
      logCommits(dir, { path, limit: limitFrom(ctx.query) }),
      countCommits(dir, path),
    ]);
    json(ctx.res, 200, { commits, total });
  });

  r.get('/api/projects/:slug/history/:sha/*path', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    const dir = projectDirFor(ctx, project);
    const sha = requireShaParam(ctx.params.sha);
    const { rel } = resolveProjectPath(dir, ctx.params.path);

    let buffer;
    try {
      buffer = await showFile(dir, sha, rel);
    } catch (err) {
      // git exits non-zero for both an unknown commit and a path that did not
      // exist in it. Neither is a server fault.
      if (err instanceof GitError) throw new HttpError(404, 'not found at that commit');
      throw err;
    }

    ctx.res.writeHead(200, {
      'Content-Type': mimeForPath(rel) ?? OCTET_STREAM,
      'Content-Length': String(buffer.length),
      ETag: etagFor(buffer),
      'Cache-Control': 'no-store',
    });
    if (ctx.req.method === 'HEAD') return ctx.res.end();
    return ctx.res.end(buffer);
  });

  // A whole commit, never a slice of one. The versions list filtered to one
  // file shows only that file's part, but it does the narrowing itself: a
  // patch the server had already cut down could not say how many files the
  // version touched, which is what the list needs to offer the rest of it.
  r.get('/api/projects/:slug/diff/:sha', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    const dir = projectDirFor(ctx, project);
    const sha = requireShaParam(ctx.params.sha);

    let patch;
    let paths;
    try {
      // Two reads of the same commit that know nothing about each other, so
      // they run as one wait rather than two.
      [patch, paths] = await Promise.all([
        diffCommit(dir, sha), commitPathsTouched(dir, sha),
      ]);
    } catch (err) {
      if (err instanceof GitError) throw new HttpError(404, 'no such commit');
      throw err;
    }
    json(ctx.res, 200, { sha, paths, patch });
  });

  // Restore never rewrites history: the old bytes are written into the
  // working tree and committed as a new commit (spec.md §5).
  r.post('/api/projects/:slug/restore', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, files: true });
    const dir = projectDirFor(ctx, project);
    const body = await readJson(ctx.req);
    const sha = requireShaParam(body.sha);
    const { rel, abs } = resolveProjectPath(dir, body.path);

    await ctx.mutex.run(project.slug, async () => {
      let buffer;
      try {
        buffer = await showFile(dir, sha, rel);
      } catch (err) {
        if (err instanceof GitError) throw new HttpError(404, 'not found at that commit');
        throw err;
      }
      await writeFileAt(abs, buffer);
      const short = sha.slice(0, 7);
      const commit = await commitPaths(
        dir, [rel], `restore ${rel} to ${short}`, authorFor(user),
      );
      ctx.broker.broadcast('files.changed', {
        project_slug: project.slug, paths: [rel],
      });
      json(ctx.res, 200, {
        path: rel, size: buffer.length, restored_from: sha, commit,
      });
    });
  });

  // Rollback is restore one scope up: every file goes back to how it was at
  // that commit, anything made since is removed, and the lot lands as a single
  // new commit. History is never rewritten, so a rollback is itself undoable
  // by rolling back to the commit before it (spec.md §5).
  //
  // Its own route rather than `path` becoming optional on /restore: a client
  // that dropped a field would otherwise escalate from one file to the whole
  // tree, which is the one mistake here that would be expensive.
  r.post('/api/projects/:slug/rollback', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, files: true });
    const dir = projectDirFor(ctx, project);
    const body = await readJson(ctx.req);
    const sha = requireShaParam(body.sha);

    await ctx.mutex.run(project.slug, async () => {
      let entries;
      try {
        entries = await treeAtCommit(dir, sha);
      } catch (err) {
        if (err instanceof GitError) throw new HttpError(404, 'no such commit');
        throw err;
      }
      // The caps could have been lowered since, so an old tree is not
      // automatically allowed back in. Checked before anything is written.
      const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
      if (entries.length > MAX_PROJECT_FILES || totalBytes > MAX_PROJECT_BYTES) {
        throw new HttpError(409, 'that version is bigger than a project may be');
      }

      const wanted = new Set(entries.map((e) => e.path));
      const { files } = await listTree(dir);
      const removed = files.map((f) => f.path).filter((p) => !wanted.has(p));

      // An empty tree is a legitimate destination — the initial commit — and
      // `checkout <sha> -- .` fails on a pathspec that matches nothing.
      if (entries.length > 0) await restoreTree(dir, sha);
      for (const rel of removed) await removeFileAt(dir, rel);

      const touched = [...wanted, ...removed];
      const short = sha.slice(0, 7);
      const commit = touched.length > 0
        ? await commitPaths(dir, touched, `restore everything to ${short}`, authorFor(user))
        : null;
      if (commit) {
        ctx.broker.broadcast('files.changed', {
          project_slug: project.slug, paths: touched,
        });
      }
      json(ctx.res, 200, {
        restored_from: sha,
        commit,
        // Counts for the toast: null commit means the tree already matched.
        restored: entries.length,
        removed: removed.length,
      });
    });
  });
}
