import { json, HttpError } from '../http/respond.js';
import { readJson, readRaw } from '../http/body.js';
import { mimeForPath, isTextPath, OCTET_STREAM } from '../http/static.js';
import { requireAuth } from '../auth.js';
import { resolveProjectPath, requireSlug } from '../files/paths.js';
import {
  listTree, readFileAt, writeFileAt, removeFileAt, assertCapacity, etagFor,
  etagMatches, MAX_FILE_BYTES,
} from '../files/tree.js';
import { commitPaths, movePath } from '../files/git.js';
import { versionNew } from '../files/pending.js';
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
    const project = requireProject(ctx, { files: true });
    const { files, totalBytes, count } = await listTree(projectDirFor(ctx, project));
    json(ctx.res, 200, { files, total_bytes: totalBytes, count });
  });

  // Renaming is a POST on a fixed path rather than a verb on the file, so it
  // cannot collide with a file whose own name is 'move'.
  r.post('/api/projects/:slug/files/move', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, files: true });
    const dir = projectDirFor(ctx, project);
    const body = await readJson(ctx.req);
    const from = resolveProjectPath(dir, body.from);
    const to = resolveProjectPath(dir, body.to);
    if (from.rel === to.rel) throw new HttpError(400, 'from and to are the same path');

    await ctx.mutex.run(project.slug, async () => {
      // Every direct commit lands the pending one first (files/pending.js):
      // here because `git mv` cannot move a file history has not seen yet.
      await ctx.pending.settleLocked(project.slug);
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
      versionNew(ctx.broker, project.slug, sha, [from.rel, to.rel]);
      json(ctx.res, 200, { from: from.rel, to: to.rel, commit: sha });
    });
  });

  // A file out of another game. Reading the source is every account's, so
  // this needs the same rights any other write to *this* game needs and
  // nothing more: the bytes are copied, the source is untouched, and the two
  // games stay strangers afterwards — no link, no history carried over.
  r.post('/api/projects/:slug/files/import', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, files: true });
    const body = await readJson(ctx.req);

    const fromSlug = requireSlug(String(body.from_slug ?? ''));
    const source = ctx.db.prepare('SELECT * FROM projects WHERE slug = ?').get(fromSlug);
    if (!source || source.kind === 'chat') throw new HttpError(404, 'no such game to copy from');
    if (source.id === project.id) throw new HttpError(400, 'that is the same game — use Duplicate');

    const from = resolveProjectPath(projectDirFor(ctx, source), body.from_path);
    const to = resolveProjectPath(projectDirFor(ctx, project), body.to_path ?? body.from_path);
    const bytes = await readFileAt(from.abs);
    if (bytes === null) throw new HttpError(404, `${from.rel} is not in ${source.name}`);
    if (await readFileAt(to.abs) !== null) {
      throw new HttpError(409, `${to.rel} is already here — pick another name`);
    }

    const dir = projectDirFor(ctx, project);
    const sha = await ctx.mutex.run(project.slug, async () => {
      await ctx.pending.settleLocked(project.slug);
      await assertCapacity(dir, { addingBytes: bytes.length, isNewFile: true });
      await writeFileAt(to.abs, bytes);
      return commitPaths(dir, [to.rel], `copy ${to.rel} from ${source.slug}`, authorFor(user));
    });
    ctx.broker.broadcast('files.changed', {
      project_slug: project.slug, paths: [to.rel],
    });
    versionNew(ctx.broker, project.slug, sha, [to.rel]);
    json(ctx.res, 201, {
      path: to.rel, size: bytes.length, etag: etagFor(bytes), commit: sha, from: from.rel,
    });
  });

  // Same fixed-path shape as move. Copying is the one write whose bytes the
  // client never sent, so it is also the one that pays assertCapacity for
  // content taken from the tree itself.
  r.post('/api/projects/:slug/files/duplicate', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, files: true });
    const dir = projectDirFor(ctx, project);
    const body = await readJson(ctx.req);
    const from = resolveProjectPath(dir, body.from);
    const to = resolveProjectPath(dir, body.to);
    if (from.rel === to.rel) throw new HttpError(400, 'from and to are the same path');

    await ctx.mutex.run(project.slug, async () => {
      await ctx.pending.settleLocked(project.slug);
      const buffer = await readFileAt(from.abs);
      if (buffer === null) throw new HttpError(404, `no such file: ${from.rel}`);
      if ((await readFileAt(to.abs)) !== null) {
        throw new HttpError(409, `${to.rel} already exists`);
      }
      await assertCapacity(dir, { addingBytes: buffer.length, isNewFile: true });
      await writeFileAt(to.abs, buffer);
      const sha = await commitPaths(
        dir, [to.rel], `duplicate ${from.rel} as ${to.rel}`, authorFor(user),
      );
      // Only the new path: the source did not change.
      ctx.broker.broadcast('files.changed', {
        project_slug: project.slug, paths: [to.rel],
      });
      versionNew(ctx.broker, project.slug, sha, [to.rel]);
      json(ctx.res, 201, { from: from.rel, to: to.rel, commit: sha });
    });
  });

  r.get('/api/projects/:slug/files/*path', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
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
    const project = requireProject(ctx, { write: true, files: true });
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
          : existing !== null && etagMatches(ifMatch, existing);
        if (!satisfied) {
          json(ctx.res, 409, conflictBody(rel, existing));
          return;
        }
      }

      await assertCapacity(dir, {
        addingBytes: buffer.length, isNewFile: existing === null,
      });
      const answer = (pending) => json(ctx.res, existing === null ? 201 : 200, {
        path: rel,
        size: buffer.length,
        etag: etagFor(buffer),
        // Whether this save is now waiting for its commit (files/pending.js).
        // False when the bytes were identical: nothing written, nothing owed.
        pending,
      });
      if (existing !== null && existing.equals(buffer)) {
        answer(false);
        return;
      }

      // A save is the one write that does not commit at once. Somebody else's
      // window lands first, so their work is never in this person's commit;
      // this person's own stays open and this save joins it.
      const author = authorFor(user);
      await ctx.pending.settleLocked(project.slug, { unless: author });
      await writeFileAt(abs, buffer);
      await ctx.pending.note(project.slug, dir, {
        projectId: project.id,
        path: rel,
        action: existing === null ? 'create' : 'update',
        author,
      });

      ctx.broker.broadcast('files.changed', {
        project_slug: project.slug, paths: [rel],
      });
      answer(true);
    });
  });

  // The client saying it is leaving — another game, another scene, the tab
  // closing: whatever this game owes history lands now rather than when the
  // idle timer says so. Nothing pending is a quiet null.
  r.post('/api/projects/:slug/commit', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true, files: true });
    json(ctx.res, 200, { commit: await ctx.pending.settle(project.slug) });
  });

  r.delete('/api/projects/:slug/files/*path', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true, files: true });
    const dir = projectDirFor(ctx, project);
    const { rel, abs } = resolveProjectPath(dir, ctx.params.path);

    await ctx.mutex.run(project.slug, async () => {
      await ctx.pending.settleLocked(project.slug);
      if ((await readFileAt(abs)) === null) throw new HttpError(404, 'no such file');
      await removeFileAt(dir, rel);
      const sha = await commitPaths(dir, [rel], `delete ${rel}`, authorFor(user));
      ctx.broker.broadcast('files.changed', {
        project_slug: project.slug, paths: [rel],
      });
      versionNew(ctx.broker, project.slug, sha, [rel]);
      json(ctx.res, 200, { path: rel, deleted: true, commit: sha });
    });
  });
}
