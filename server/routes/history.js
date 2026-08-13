import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { mimeForPath, OCTET_STREAM } from '../http/static.js';
import { requireAuth } from '../auth.js';
import { resolveProjectPath, checkProjectPath } from '../files/paths.js';
import { writeFileAt, etagFor } from '../files/tree.js';
import {
  logCommits, showFile, diffCommit, commitPaths, commitPathsTouched, GitError, isSha,
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
    const project = requireProject(ctx);
    const dir = projectDirFor(ctx, project);
    const commits = await logCommits(dir, {
      path: optionalPath(ctx.query), limit: limitFrom(ctx.query),
    });
    json(ctx.res, 200, commits);
  });

  r.get('/api/projects/:slug/history/:sha/*path', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
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

  r.get('/api/projects/:slug/diff/:sha', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
    const dir = projectDirFor(ctx, project);
    const sha = requireShaParam(ctx.params.sha);
    const filter = optionalPath(ctx.query);

    let patch;
    let paths;
    try {
      patch = await diffCommit(dir, sha, filter);
      paths = await commitPathsTouched(dir, sha);
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
    const project = requireProject(ctx, { write: true });
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
}
