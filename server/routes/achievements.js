import { json, HttpError } from '../http/respond.js';
import { requireAuth } from '../auth.js';
import { readJson } from '../http/body.js';
import { requireProject, projectDirFor } from './helpers.js';
import { achievementCounts, definedAchievements } from '../achievements.js';
import { isAuthor } from '../authors.js';
import { stashOf, putChips } from '../joy.js';

// The achievements editor's structural read (spec.md §6): every definition in
// the game's config/achievements.js with how many players hold it and the joy
// it gives, the reader's own stash of chips, and whether they may put chips on
// these — an author of a published game. A read, so anybody in the studio;
// `files: true` because the definitions are a file, which a chat does not
// have. The earned rows have no route of their own on this origin — no list,
// no delete — because earned is forever (spec.md §3).
export function achievementRoutes(r) {
  r.get('/api/projects/:slug/achievements', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    json(ctx.res, 200, {
      achievements: await achievementCounts(ctx.db, project, projectDirFor(ctx, project)),
      stash: stashOf(ctx.db, user.id),
      can_put: project.published === 1 && isAuthor(ctx.db, project.id, user.id),
    });
  });

  // Chips from your stash onto one achievement (server/joy.js), for good: from
  // now on it gives that much more joy to everybody who earns it.
  r.post('/api/projects/:slug/achievements/:id/chips', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    const body = await readJson(ctx.req, 256);
    const defined = await definedAchievements(projectDirFor(ctx, project));
    if (!defined.some((a) => a.id === ctx.params.id)) throw new HttpError(404, 'no such achievement');
    json(ctx.res, 201, putChips(ctx.db, project, user, ctx.params.id, body?.chips));
  });
}
