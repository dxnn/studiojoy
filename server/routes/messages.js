import { json, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { tx } from '../db.js';
import { checkProjectPath } from '../files/paths.js';
import { requireProject, messagePublic } from './helpers.js';

const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_CONTEXT_PATHS = 50;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

// Pinning a path is a hint about attention, not a claim the file exists — a
// human may point at a file they are asking an agent to create. Validation
// still applies, because the path reaches the filesystem later.
function normalizeContextPaths(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'context_paths must be an array');
  if (value.length > MAX_CONTEXT_PATHS) {
    throw new HttpError(400, `context_paths may hold at most ${MAX_CONTEXT_PATHS} entries`);
  }
  const seen = new Set();
  for (const entry of value) {
    const checked = checkProjectPath(entry);
    if (!checked.ok) throw new HttpError(400, `context_paths: ${checked.reason}`);
    seen.add(checked.path);
  }
  return [...seen];
}

export function messageRoutes(r) {
  r.post('/api/projects/:slug/messages', async (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const body = await readJson(ctx.req);

    if (typeof body.body !== 'string') throw new HttpError(400, 'body must be a string');
    const text = body.body.trim();
    if (text.length === 0) throw new HttpError(400, 'body must not be empty');
    // The cap is on bytes, not characters: an emoji-heavy message costs more
    // than its length suggests.
    if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
      throw new HttpError(400, `body must be at most ${MAX_MESSAGE_BYTES} bytes`);
    }
    const contextPaths = normalizeContextPaths(body.context_paths);

    const now = new Date().toISOString();
    const messageId = tx(ctx.db, () => {
      const info = ctx.db
        .prepare(
          `INSERT INTO messages (project_id, user_id, body, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(project.id, user.id, text, now);
      const id = Number(info.lastInsertRowid);
      for (const p of contextPaths) {
        ctx.db
          .prepare('INSERT INTO message_context (message_id, path) VALUES (?, ?)')
          .run(id, p);
      }
      return id;
    });

    const row = ctx.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    const payload = messagePublic(ctx.db, row, project.slug);
    ctx.broker.broadcast('message.new', payload);

    // Fired after the message is durable and broadcast, so the human's own
    // message always appears before any agent reply. Agents are woken only by
    // human messages — bot-to-bot dampening lives in the orchestrator.
    ctx.orchestrator?.onHumanMessage(project, row);

    json(ctx.res, 201, payload);
  });

  r.get('/api/projects/:slug/messages', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);

    const rawLimit = Number(ctx.query.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_PAGE)
      : DEFAULT_PAGE;

    const rawBefore = ctx.query.get('before');
    const before = rawBefore === null ? null : Number(rawBefore);
    if (before !== null && !Number.isInteger(before)) {
      throw new HttpError(400, 'before must be a message id');
    }

    // Page backwards, return forwards: the client appends to the top of the
    // thread without reversing anything itself.
    const rows = before === null
      ? ctx.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT ?
           ) ORDER BY id ASC`,
        )
        .all(project.id, limit)
      : ctx.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages WHERE project_id = ? AND id < ?
             ORDER BY id DESC LIMIT ?
           ) ORDER BY id ASC`,
        )
        .all(project.id, before, limit);

    json(ctx.res, 200, {
      messages: rows.map((m) => messagePublic(ctx.db, m, project.slug)),
      has_more: rows.length === limit && rows.length > 0,
    });
  });
}
