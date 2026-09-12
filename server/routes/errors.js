import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { currentSha } from '../files/git.js';
import { isStamp } from '../files/pending.js';
import {
  recordErrors, listErrors, errorPublic, MAX_ERRORS_PER_PROJECT,
} from '../runtime.js';
import { readShot, saveShot } from '../shots.js';
import { requireProject, projectDirFor } from './helpers.js';

// The studio end of the runtime error feed. A game running in the preview
// iframe posts its problems to the studio page (reporter.js); the page checks
// the origin and forwards them here.
//
// Not restricted to unarchived projects: an archived game is still playable,
// and a problem seen while playing it is still worth recording. The body is
// LLM-written game text either way, so nothing here trusts it — it is capped,
// stripped of control characters, and only ever rendered as text.
export function errorRoutes(r) {
  r.post('/api/projects/:slug/errors', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    const body = await readJson(ctx.req);
    if (!Array.isArray(body.errors)) throw new HttpError(400, 'errors must be an array');

    const head = await currentSha(projectDirFor(ctx, project));
    // What the preview is running: HEAD, or HEAD plus the saves on top of it
    // while a pending commit is open (files/pending.js).
    const now = ctx.pending.stampOf(project.slug, head);
    // The reporter carries the version its own bytes came from. A report from
    // a version that has since been replaced is dropped rather than filed
    // against the new one: the preview is already reloading, and anything
    // still broken will say so again. This is what keeps a fixed problem from
    // reappearing as a current one. The one older version still taken is the
    // saves that have just landed as HEAD: a preview running them is running
    // HEAD, and keeps reporting under it until the next save.
    const version = body.version === undefined ? now : body.version;
    const last = ctx.pending.landedFor(project.slug);
    const filedAs = !isStamp(version) ? null
      : version === now ? now
        : last && version === last.stamp && now === head && last.sha === head ? head
          : null;
    if (filedAs === null) {
      json(ctx.res, 200, { errors: listErrors(ctx.db, project.id, now).map(errorPublic) });
      return;
    }

    const rows = recordErrors(
      ctx.db, project.id, filedAs, body.errors.slice(0, MAX_ERRORS_PER_PROJECT),
    );
    const errors = rows.map(errorPublic);

    // Broadcast rather than answering with the list alone: every tab watching
    // this game should see the same problems, including the one that reported
    // them, so the client has a single path for rendering them.
    ctx.broker.broadcast('game.errors', { project_slug: project.slug, errors });
    json(ctx.res, 200, { errors });
  });

  // A frame of the game, on the same road as its problems: the reporter draws
  // it when the studio asks, the page forwards it here, and `look_at_game`
  // hands it to a helper on the next fire (spec.md §8).
  //
  // Nothing is broadcast and nothing renders: one row, replaced. No SSE event
  // either, because nothing on screen changes — the person who caused this is
  // looking at the game already.
  r.put('/api/projects/:slug/shot', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    const body = await readJson(ctx.req);
    const shot = readShot(body.data);
    if (shot.error) throw new HttpError(400, shot.error);
    saveShot(ctx.db, project.id, { ...shot, version: body.version });
    json(ctx.res, 200, { bytes: shot.bytes.length });
  });
}
