import { json, HttpError } from '../http/respond.js';
import { readJson, readRaw } from '../http/body.js';
import { mimeForPath, isTextPath, OCTET_STREAM } from '../http/static.js';
import { requireAuth } from '../auth.js';
import { resolveProjectPath } from '../files/paths.js';
import {
  listTree, readFileAt, writeFileAt, removeFileAt, assertCapacity, etagFor,
  MAX_FILE_BYTES,
} from '../files/tree.js';
import { commitPaths, movePath } from '../files/git.js';
import { requireProject, projectDirFor, authorFor } from './helpers.js';

// Describe the current state of a path for a conflict response, so the editor
// can show what it would have clobbered.
function conflictBody(rel, buffer) {
  const body = {
    error: 'the file changed since you loaded it',
    path: rel,
    etag: buffer ? etagFor(buffer) : null,
  };
  if (buffer && isTextPath(rel)) body.content = buffer.toString('utf8');
  return body;
}

export function fileRoutes(r) {
  r.get('/api/projects/:slug/files', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
    const { files, totalBytes, count } = await listTree(projectDirFor(ctx, project));
    json(ctx.res, 200, { files, total_bytes: totalBytes, count });
  });

  // Renaming is a POST on a fixed path rather than a verb on the file, so it
  // cannot collide with a file whose own name is 'move'.
  r.post('/api/projects/:slug/files/move', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const dir = projectDirFor(ctx, project);
    const body = await readJson(ctx.req);
    const from = resolveProjectPath(dir, body.from);
    const to = resolveProjectPath(dir, body.to);
    if (from.rel === to.rel) throw new HttpError(400, 'from and to are the same path');

    await ctx.mutex.run(project.slug, async () => {
      if ((await readFileAt(from.abs)) === null) {
        throw new HttpError(404, `no such file: ${from.rel}`);
      }
      if ((await readFileAt(to.abs)) !== null) {
        throw new HttpError(409, `${to.rel} already exists`);
      }
      const sha = await movePath(
        dir, from.rel, to.rel, `move ${from.rel} to ${to.rel}`, authorFor(user),
      );
      ctx.broker.broadcast('files.changed', {
        project_slug: project.slug, paths: [from.rel, to.rel],
      });
      json(ctx.res, 200, { from: from.rel, to: to.rel, commit: sha });
    });
  });

  r.get('/api/projects/:slug/files/*path', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
    const dir = projectDirFor(ctx, project);
    const { rel, abs } = resolveProjectPath(dir, ctx.params.path);

    const buffer = await readFileAt(abs);
    if (buffer === null) throw new HttpError(404, 'no such file');
    const etag = etagFor(buffer);

    // The editor sends the ETag back on save; letting it also short-circuit a
    // reload is free.
    if (ctx.req.headers['if-none-match'] === etag) {
      ctx.res.writeHead(304, { ETag: etag });
      return ctx.res.end();
    }

    ctx.res.writeHead(200, {
      'Content-Type': mimeForPath(rel) ?? OCTET_STREAM,
      'Content-Length': String(buffer.length),
      ETag: etag,
      // Studio reads must never be cached: an agent may have rewritten the
      // file a second ago.
      'Cache-Control': 'no-store',
    });
    if (ctx.req.method === 'HEAD') return ctx.res.end();
    return ctx.res.end(buffer);
  });

  r.put('/api/projects/:slug/files/*path', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const dir = projectDirFor(ctx, project);
    const { rel, abs } = resolveProjectPath(dir, ctx.params.path);

    // Read the body before taking the lock, so a slow upload doesn't block
    // every other write to this project while it arrives.
    const buffer = await readRaw(ctx.req, MAX_FILE_BYTES);

    await ctx.mutex.run(project.slug, async () => {
      const existing = await readFileAt(abs);
      const ifMatch = ctx.req.headers['if-match'];
      if (ifMatch !== undefined) {
        // `*` is the standard way to say "only if it already exists".
        const satisfied = ifMatch === '*'
          ? existing !== null
          : existing !== null && ifMatch === etagFor(existing);
        if (!satisfied) {
          json(ctx.res, 409, conflictBody(rel, existing));
          return;
        }
      }

      await assertCapacity(dir, {
        addingBytes: buffer.length, isNewFile: existing === null,
      });
      await writeFileAt(abs, buffer);
      const action = existing === null ? 'create' : 'update';
      const sha = await commitPaths(dir, [rel], `${action} ${rel}`, authorFor(user));

      ctx.broker.broadcast('files.changed', {
        project_slug: project.slug, paths: [rel],
      });
      json(ctx.res, existing === null ? 201 : 200, {
        path: rel,
        size: buffer.length,
        etag: etagFor(buffer),
        // null when the bytes were identical: a no-op write, not a commit.
        commit: sha,
      });
    });
  });

  r.delete('/api/projects/:slug/files/*path', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const dir = projectDirFor(ctx, project);
    const { rel, abs } = resolveProjectPath(dir, ctx.params.path);

    await ctx.mutex.run(project.slug, async () => {
      if ((await readFileAt(abs)) === null) throw new HttpError(404, 'no such file');
      await removeFileAt(dir, rel);
      const sha = await commitPaths(dir, [rel], `delete ${rel}`, authorFor(user));
      ctx.broker.broadcast('files.changed', {
        project_slug: project.slug, paths: [rel],
      });
      json(ctx.res, 200, { path: rel, deleted: true, commit: sha });
    });
  });
}
