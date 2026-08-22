import path from 'node:path';
import { HttpError } from '../http/respond.js';
import { requireSlug } from '../files/paths.js';

// Load the project named by :slug. Reads 404 on an unknown slug; writes also
// 409 on an archived one (spec.md §6). Archiving stops edits, not reads, and
// never stops the public game being served.
//
// `files: true` marks a route that reaches the working tree. A chat has no
// working tree — no directory, no repo — so this is the one place that keeps
// such a route from being handed a path that does not exist (spec.md §12).
export function requireProject(ctx, { write = false, files = false } = {}) {
  const slug = requireSlug(ctx.params.slug);
  const project = ctx.db
    .prepare('SELECT * FROM projects WHERE slug = ?')
    .get(slug);
  if (!project) throw new HttpError(404, 'no such project');
  if (write && project.archived) throw new HttpError(409, 'project is archived');
  if (files && project.kind === 'chat') {
    throw new HttpError(409, 'that is a chat, not a game: it has no files');
  }
  return project;
}

export function projectDirFor(ctx, project) {
  return path.join(path.resolve(ctx.gamesDir), project.slug);
}

// Identity for a git commit made on a person's behalf.
export function authorFor(user) {
  return { name: user.display_name, email: user.email };
}

// Identity for a git commit made by an agent. The domain is reserved so an
// agent's commits are never mistaken for a person's.
export function agentAuthorFor(agent, slug) {
  return { name: agent.name, email: `${slug}@agent.gamestudio.local` };
}

export function clientIp(ctx) {
  if (ctx.trustProxy) {
    const forwarded = ctx.req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
  }
  return ctx.req.socket?.remoteAddress ?? 'unknown';
}

export function requireString(value, field, { max, allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new HttpError(400, `${field} must not be empty`);
  }
  if (max !== undefined && trimmed.length > max) {
    throw new HttpError(400, `${field} must be at most ${max} characters`);
  }
  return trimmed;
}

export function optionalBool(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  throw new HttpError(400, `${field} must be a boolean`);
}

// Shapes a message row plus its context and write records for the client and
// for SSE. One shape in both places so the UI has a single code path.
export function messagePublic(db, row, slug) {
  const contextPaths = db
    .prepare('SELECT path FROM message_context WHERE message_id = ? ORDER BY path')
    .all(row.id)
    .map((r) => r.path);
  const writes = db
    .prepare(
      `SELECT path, action, bytes, commit_sha FROM message_writes
        WHERE message_id = ? ORDER BY path`,
    )
    .all(row.id);
  // Read now rather than stored on the message, for the same reason an agent's
  // name is resolved rather than copied (§3): the thread should say what a
  // person is called today. The client has no user list of its own — an agent's
  // name it can look up, a person's it cannot — so without this everybody but
  // you was "Someone".
  const author = row.user_id
    ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(row.user_id)
    : null;
  return {
    id: row.id,
    project_slug: slug,
    user_id: row.user_id ?? null,
    // Null for an agent, and for a person whose account has gone.
    user_name: author?.display_name ?? null,
    agent_id: row.agent_id ?? null,
    kind: row.kind ?? null,
    body: row.body,
    created_at: row.created_at,
    // Null on anything a person or the studio wrote: only a fire costs
    // tokens. Shown in the UI so a reply that continued itself three times is
    // visibly three times the cost (spec.md §8).
    tokens: row.tokens ?? null,
    // How many earlier messages the history budget kept out of this reply's
    // context. The agent is told in its prompt; this is how the person is.
    trimmed: row.trimmed ?? null,
    context_paths: contextPaths,
    writes: writes.map((w) => ({ ...w })),
  };
}
