import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { currentSha, isSha } from '../files/git.js';
import {
  recordErrors, listErrors, errorPublic, MAX_ERRORS_PER_PROJECT,
} from '../runtime.js';
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
    // The reporter carries the commit its own bytes came from. A report from a
    // version that has since been replaced is dropped rather than filed
    // against the new one: the preview is already reloading, and anything
    // still broken will say so again. This is what keeps a fixed problem from
    // reappearing as a current one.
    const version = body.version === undefined ? head : body.version;
    if (!isSha(version) || version !== head) {
      json(ctx.res, 200, { errors: listErrors(ctx.db, project.id, head).map(errorPublic) });
      return;
    }

    const rows = recordErrors(
      ctx.db, project.id, head, body.errors.slice(0, MAX_ERRORS_PER_PROJECT),
    );
    const errors = rows.map(errorPublic);

    // Broadcast rather than answering with the list alone: every tab watching
    // this game should see the same problems, including the one that reported
    // them, so the client has a single path for rendering them.
    ctx.broker.broadcast('game.errors', { project_slug: project.slug, errors });
    json(ctx.res, 200, { errors });
  });
}
