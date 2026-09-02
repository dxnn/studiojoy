import { json } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { requireProject } from './helpers.js';
import { fillLines, drawPicture } from '../story.js';

// The story editor's two small asks (spec.md §6). Both `write: true`: neither
// writes a file itself, but both spend tokens on making this game, so they
// belong to whoever may change it — and both refuse an archived game for the
// same reason every other change does. `files: true` because a chat has no
// story to ask about.
//
// The answers are handed back rather than saved. The fill's lines land in the
// unsaved model where the author can change or delete them, and the picture's
// SVG is drawn and saved by the browser as the PNG the story expects — so
// Save stays the only thing that commits.
export function storyRoutes(r) {
  r.post('/api/projects/:slug/story/fill', async (ctx) => {
    const user = requireAuth(ctx);
    requireProject(ctx, { write: true, files: true });
    json(ctx.res, 200, await fillLines(ctx, user, await readJson(ctx.req)));
  });

  r.post('/api/projects/:slug/story/picture', async (ctx) => {
    const user = requireAuth(ctx);
    requireProject(ctx, { write: true, files: true });
    json(ctx.res, 200, await drawPicture(ctx, user, await readJson(ctx.req)));
  });
}
