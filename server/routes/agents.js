import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { tx } from '../db.js';
import { requireProject, requireString, optionalBool } from './helpers.js';

const MAX_AGENT_NAME = 100;
const MAX_DESCRIPTION = 8 * 1024;
const MAX_AGENTS_PER_PROJECT = 10;

// The two canonical model ids, verified against /v1/models (spec.md §14).
// The deepseek-chat / deepseek-reasoner aliases are deliberately not offered:
// they are undocumented, both resolve to flash, and differ only in reasoning,
// which is a separate column here.
export const MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);

function agentPublic(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    model: row.model,
    reasoning: row.reasoning === 1,
    file_tools: row.file_tools === 1,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function requireModel(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !MODELS.has(value)) {
    throw new HttpError(400, `model must be one of ${[...MODELS].join(', ')}`);
  }
  return value;
}

function liveAgent(db, id) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) throw new HttpError(404, 'no such agent');
  const row = db
    .prepare('SELECT * FROM agents WHERE id = ? AND deleted = 0')
    .get(numeric);
  if (!row) throw new HttpError(404, 'no such agent');
  return row;
}

export function agentRoutes(r) {
  // Agents are studio-global: any account may create, edit, delete, or
  // attach any of them (spec.md §3). created_by is provenance, not ownership.
  r.get('/api/agents', (ctx) => {
    requireAuth(ctx);
    const rows = ctx.db
      .prepare('SELECT * FROM agents WHERE deleted = 0 ORDER BY name')
      .all();
    json(ctx.res, 200, rows.map(agentPublic));
  });

  r.post('/api/agents', async (ctx) => {
    const user = requireAuth(ctx);
    const body = await readJson(ctx.req);
    const name = requireString(body.name, 'name', { max: MAX_AGENT_NAME });
    const description = requireString(body.description, 'description', {
      max: MAX_DESCRIPTION, allowEmpty: true,
    });
    const model = requireModel(body.model) ?? 'deepseek-v4-flash';
    const reasoning = optionalBool(body.reasoning, 'reasoning') ?? true;
    const fileTools = optionalBool(body.file_tools, 'file_tools') ?? true;

    const clash = ctx.db
      .prepare('SELECT 1 FROM agents WHERE name = ? AND deleted = 0')
      .get(name);
    if (clash) throw new HttpError(409, `an agent named '${name}' already exists`);

    const info = ctx.db
      .prepare(
        `INSERT INTO agents
           (name, description, model, reasoning, file_tools, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name, description, model, reasoning ? 1 : 0, fileTools ? 1 : 0,
        user.id, new Date().toISOString(),
      );
    json(ctx.res, 201, agentPublic(liveAgent(ctx.db, info.lastInsertRowid)));
  });

  r.patch('/api/agents/:id', async (ctx) => {
    requireAuth(ctx);
    const agent = liveAgent(ctx.db, ctx.params.id);
    const body = await readJson(ctx.req);

    const next = {
      name: body.name === undefined
        ? agent.name
        : requireString(body.name, 'name', { max: MAX_AGENT_NAME }),
      description: body.description === undefined
        ? agent.description
        : requireString(body.description, 'description', {
          max: MAX_DESCRIPTION, allowEmpty: true,
        }),
      model: requireModel(body.model) ?? agent.model,
      reasoning: optionalBool(body.reasoning, 'reasoning') ?? agent.reasoning === 1,
      file_tools: optionalBool(body.file_tools, 'file_tools') ?? agent.file_tools === 1,
    };

    if (next.name !== agent.name) {
      const clash = ctx.db
        .prepare('SELECT 1 FROM agents WHERE name = ? AND deleted = 0 AND id != ?')
        .get(next.name, agent.id);
      if (clash) throw new HttpError(409, `an agent named '${next.name}' already exists`);
    }

    ctx.db
      .prepare(
        `UPDATE agents
            SET name = ?, description = ?, model = ?, reasoning = ?, file_tools = ?
          WHERE id = ?`,
      )
      .run(
        next.name, next.description, next.model,
        next.reasoning ? 1 : 0, next.file_tools ? 1 : 0, agent.id,
      );
    json(ctx.res, 200, agentPublic(liveAgent(ctx.db, agent.id)));
  });

  // Soft delete: messages reference the agent, so old history must keep
  // rendering its name. The partial unique index frees the name for reuse.
  r.delete('/api/agents/:id', (ctx) => {
    requireAuth(ctx);
    const agent = liveAgent(ctx.db, ctx.params.id);
    tx(ctx.db, () => {
      ctx.db.prepare('DELETE FROM project_agents WHERE agent_id = ?').run(agent.id);
      ctx.db.prepare('UPDATE agents SET deleted = 1 WHERE id = ?').run(agent.id);
    });
    noContent(ctx.res);
  });

  r.post('/api/projects/:slug/agents', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const body = await readJson(ctx.req);
    const agent = liveAgent(ctx.db, body.agent_id);
    const chatty = optionalBool(body.chatty, 'chatty') ?? false;

    const attached = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM project_agents WHERE project_id = ?')
      .get(project.id).c;
    if (attached >= MAX_AGENTS_PER_PROJECT) {
      throw new HttpError(409, `a project may not exceed ${MAX_AGENTS_PER_PROJECT} agents`);
    }
    const already = ctx.db
      .prepare('SELECT 1 FROM project_agents WHERE project_id = ? AND agent_id = ?')
      .get(project.id, agent.id);
    if (already) throw new HttpError(409, `${agent.name} is already attached`);

    ctx.db
      .prepare(
        `INSERT INTO project_agents (project_id, agent_id, chatty, attached_by, attached_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(project.id, agent.id, chatty ? 1 : 0, user.id, new Date().toISOString());
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1,
    });
    json(ctx.res, 201, { agent_id: agent.id, name: agent.name, chatty });
  });

  r.patch('/api/projects/:slug/agents/:agent_id', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const agent = liveAgent(ctx.db, ctx.params.agent_id);
    const body = await readJson(ctx.req);
    const chatty = optionalBool(body.chatty, 'chatty');
    if (chatty === undefined) throw new HttpError(400, 'chatty is required');

    const changed = ctx.db
      .prepare('UPDATE project_agents SET chatty = ? WHERE project_id = ? AND agent_id = ?')
      .run(chatty ? 1 : 0, project.id, agent.id).changes;
    if (changed === 0) throw new HttpError(404, `${agent.name} is not attached`);
    json(ctx.res, 200, { agent_id: agent.id, chatty });
  });

  r.delete('/api/projects/:slug/agents/:agent_id', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    // A soft-deleted agent can still be detached, so this looks the row up
    // directly rather than through liveAgent.
    const agentId = Number(ctx.params.agent_id);
    if (!Number.isInteger(agentId)) throw new HttpError(404, 'no such agent');
    const changed = ctx.db
      .prepare('DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?')
      .run(project.id, agentId).changes;
    if (changed === 0) throw new HttpError(404, 'not attached');
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1,
    });
    noContent(ctx.res);
  });
}
