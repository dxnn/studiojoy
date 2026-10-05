// A plan card's two controls (spec.md §6, §8): a person changes a draft, or a
// paused plan's pieces still to do — the words, the order, the list — and
// presses Build it, which hands the plan to the builder charged to their day.
// Whoever may talk in the builder's room may do both: the room is a bots
// chat, so that is the game's own rule (routes/messages.js).

import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { canEdit } from '../authors.js';
import { planFor, editPlan, announcePlan } from '../plans.js';
import { cleanPieces, cleanAssumptions, cleanSummary } from '../agents/sizing.js';
import { isArchived } from './helpers.js';

const OPEN = new Set(['draft', 'paused']);

function requirePlan(ctx) {
  const user = requireAuth(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'plan id must be a message id');
  const plan = planFor(ctx.db, id);
  if (!plan) throw new HttpError(404, 'no such plan');
  const project = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(plan.project_id);
  if (isArchived(project)) throw new HttpError(409, 'project is archived');
  if (!canEdit(ctx.db, project, user)) {
    throw new HttpError(403, `${project.name} is not yours to change — ask one of its editors`);
  }
  if (!OPEN.has(plan.status)) {
    throw new HttpError(409, plan.status === 'draft' ? 'that plan is waiting' : `that plan is ${plan.status}`);
  }
  return { user, plan, project };
}

export function planRoutes(r) {
  // Change a plan's words: any of summary, assumptions and pieces, each
  // held to the sizing's own shapes. Pieces given are the ones still to do.
  r.patch('/api/plans/:id', async (ctx) => {
    const { plan, project } = requirePlan(ctx);
    const body = await readJson(ctx.req);
    const patch = {};
    if (body.summary !== undefined) {
      if (typeof body.summary !== 'string') throw new HttpError(400, 'summary must be a string');
      patch.summary = cleanSummary(body.summary);
    }
    if (body.assumptions !== undefined) {
      if (!Array.isArray(body.assumptions)) throw new HttpError(400, 'assumptions must be a list');
      patch.assumptions = cleanAssumptions(body.assumptions);
    }
    if (body.pieces !== undefined) {
      if (!Array.isArray(body.pieces)) throw new HttpError(400, 'pieces must be a list');
      patch.pieces = cleanPieces(body.pieces);
      if (patch.pieces.length === 0) throw new HttpError(400, 'a plan needs at least one piece');
    }
    const changed = editPlan(ctx.db, plan.message_id, patch);
    announcePlan(ctx.db, ctx.broker, project.slug, changed);
    json(ctx.res, 200, { plan: changed.status, edited: true });
  });

  // Build it — or carry a paused plan on. One click, no confirmation: nothing
  // here is destructive. The builder picks the plan up as its next fire.
  r.post('/api/plans/:id/build', (ctx) => {
    const { user, plan } = requirePlan(ctx);
    if (!ctx.orchestrator) throw new HttpError(503, 'the studio is not building anything right now');
    const result = ctx.orchestrator.buildPlan(plan, user);
    if (!result.ok) throw new HttpError(409, result.reason);
    json(ctx.res, 202, { plan: 'queued' });
  });
}
