import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { tx } from '../db.js';
import { THINKING_LEVELS, DEFAULT_THINKING } from '../llm/deepseek.js';
import { requireProject, requireString, optionalBool } from './helpers.js';
import { requireChat, assertBotsAllowed, MAX_AGENTS_PER_CHAT } from '../chats.js';

const MAX_AGENT_NAME = 100;
const MAX_DESCRIPTION = 8 * 1024;

function agentPublic(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    thinking: row.thinking,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function requireThinking(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !THINKING_LEVELS.includes(value)) {
    throw new HttpError(400, `thinking must be one of ${THINKING_LEVELS.join(', ')}`);
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

// The builder is the studio's (server/builder.js): its words are the code's,
// and there is nothing here for anybody to change or take away.
function ownAgent(db, id) {
  const row = liveAgent(db, id);
  if (row.builtin === 1) {
    throw new HttpError(403, `${row.name} is the studio's own helper and cannot be changed here`);
  }
  return row;
}

export function agentRoutes(r) {
  // Agents are studio-global: any account may create, edit, delete, or
  // attach any of them (spec.md §3). created_by is provenance, not ownership.
  // The builder is not among them: it is in every game's Building already and
  // goes nowhere else, so the Crew tab has nothing to offer about it.
  r.get('/api/agents', (ctx) => {
    requireAuth(ctx);
    const rows = ctx.db
      .prepare('SELECT * FROM agents WHERE deleted = 0 AND builtin = 0 ORDER BY name')
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
    const thinking = requireThinking(body.thinking) ?? DEFAULT_THINKING;

    const clash = ctx.db
      .prepare('SELECT 1 FROM agents WHERE name = ? AND deleted = 0')
      .get(name);
    if (clash) throw new HttpError(409, `an agent named '${name}' already exists`);

    const info = ctx.db
      .prepare(
        `INSERT INTO agents
           (name, description, thinking, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, description, thinking, user.id, new Date().toISOString());
    json(ctx.res, 201, agentPublic(liveAgent(ctx.db, info.lastInsertRowid)));
  });

  r.patch('/api/agents/:id', async (ctx) => {
    requireAuth(ctx);
    const agent = ownAgent(ctx.db, ctx.params.id);
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
      thinking: requireThinking(body.thinking) ?? agent.thinking,
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
            SET name = ?, description = ?, thinking = ?
          WHERE id = ?`,
      )
      .run(next.name, next.description, next.thinking, agent.id);
    json(ctx.res, 200, agentPublic(liveAgent(ctx.db, agent.id)));
  });

  // Soft delete: messages reference the agent, so old history must keep
  // rendering its name. The partial unique index frees the name for reuse.
  r.delete('/api/agents/:id', (ctx) => {
    requireAuth(ctx);
    const agent = ownAgent(ctx.db, ctx.params.id);
    tx(ctx.db, () => {
      ctx.db.prepare('DELETE FROM chat_agents WHERE agent_id = ?').run(agent.id);
      ctx.db.prepare('UPDATE agents SET deleted = 1 WHERE id = ?').run(agent.id);
    });
    noContent(ctx.res);
  });

  // A helper joins one conversation, not a game: the line-up, the chatty
  // switch and the cooldown all belong to the chat it is in. ⚠️ The human-only
  // chat refuses this outright — that is what "no bots allowed" means.
  r.post('/api/projects/:slug/chats/:chat_id/agents', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const chat = requireChat(ctx.db, project, ctx.params.chat_id);
    assertBotsAllowed(chat);
    const body = await readJson(ctx.req);
    const agent = liveAgent(ctx.db, body.agent_id);
    // The other half of a builder room: the builder is seated in every one of
    // a game's rooms at birth and goes nowhere else.
    if (agent.builtin === 1) {
      throw new HttpError(409, `${agent.name} works in a game's own rooms and cannot be put in a chat`);
    }
    const chatty = optionalBool(body.chatty, 'chatty') ?? false;

    const attached = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM chat_agents WHERE chat_id = ?')
      .get(chat.id).c;
    if (attached >= MAX_AGENTS_PER_CHAT) {
      throw new HttpError(409, `a chat may not exceed ${MAX_AGENTS_PER_CHAT} helpers`);
    }
    const already = ctx.db
      .prepare('SELECT 1 FROM chat_agents WHERE chat_id = ? AND agent_id = ?')
      .get(chat.id, agent.id);
    if (already) throw new HttpError(409, `${agent.name} is already in ${chat.name}`);

    ctx.db
      .prepare(
        `INSERT INTO chat_agents (chat_id, agent_id, chatty, attached_by, attached_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(chat.id, agent.id, chatty ? 1 : 0, user.id, new Date().toISOString());
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1,
    });
    json(ctx.res, 201, { agent_id: agent.id, name: agent.name, chatty, chat_id: chat.id });
  });

  r.patch('/api/projects/:slug/chats/:chat_id/agents/:agent_id', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const chat = requireChat(ctx.db, project, ctx.params.chat_id);
    const agent = liveAgent(ctx.db, ctx.params.agent_id);
    const body = await readJson(ctx.req);
    const chatty = optionalBool(body.chatty, 'chatty');
    if (chatty === undefined) throw new HttpError(400, 'chatty is required');

    const changed = ctx.db
      .prepare('UPDATE chat_agents SET chatty = ? WHERE chat_id = ? AND agent_id = ?')
      .run(chatty ? 1 : 0, chat.id, agent.id).changes;
    if (changed === 0) throw new HttpError(404, `${agent.name} is not in ${chat.name}`);
    json(ctx.res, 200, { agent_id: agent.id, chatty, chat_id: chat.id });
  });

  // Cancel (spec.md §8): that helper's reply stopped where it is, and what it
  // wrote put back. Anybody who may write here, the builder included, and no
  // confirmation: what it throws away is unfinished work no version ever held.
  r.post('/api/projects/:slug/chats/:chat_id/agents/:agent_id/cancel', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const chat = requireChat(ctx.db, project, ctx.params.chat_id);
    const agentId = Number(ctx.params.agent_id);
    if (!Number.isInteger(agentId)) throw new HttpError(404, 'no such agent');
    if (!ctx.orchestrator?.cancel(chat.id, agentId)) {
      throw new HttpError(409, 'nothing to cancel — it has already finished');
    }
    json(ctx.res, 202, { cancelled: true });
  });

  r.delete('/api/projects/:slug/chats/:chat_id/agents/:agent_id', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const chat = requireChat(ctx.db, project, ctx.params.chat_id);
    // A soft-deleted agent can still be detached, so this looks the row up
    // directly rather than through liveAgent.
    const agentId = Number(ctx.params.agent_id);
    if (!Number.isInteger(agentId)) throw new HttpError(404, 'no such agent');
    // ⚠️ The builder's seat is the room's, not anybody's to take away: a
    // builder room with nobody in it answers nothing (spec.md §3). Until
    // 2026-09-15 this route did not look, and the builder could be taken out.
    const row = ctx.db.prepare('SELECT name, builtin FROM agents WHERE id = ?').get(agentId);
    if (row?.builtin === 1) {
      throw new HttpError(409, `${row.name} is this room's own helper and cannot be taken out`);
    }
    const changed = ctx.db
      .prepare('DELETE FROM chat_agents WHERE chat_id = ? AND agent_id = ?')
      .run(chat.id, agentId).changes;
    if (changed === 0) throw new HttpError(404, 'not in this chat');
    ctx.broker.broadcast('project.updated', {
      slug: project.slug, name: project.name, archived: project.archived === 1,
    });
    noContent(ctx.res);
  });
}
