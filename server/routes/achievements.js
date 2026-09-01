import { json } from '../http/respond.js';
import { requireAuth } from '../auth.js';
import { requireProject, projectDirFor } from './helpers.js';
import { achievementCounts } from '../achievements.js';

// The achievements editor's structural read (spec.md §6): every definition in
// the game's config/achievements.js with how many players hold it. A read, so
// anybody in the studio; `files: true` because the definitions are a file,
// which a chat does not have. The earned rows have no route of their own on
// this origin — no list, no delete — because earned is forever (spec.md §3).
export function achievementRoutes(r) {
  r.get('/api/projects/:slug/achievements', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { files: true });
    json(ctx.res, 200, {
      achievements: await achievementCounts(ctx.db, project, projectDirFor(ctx, project)),
    });
  });
}
