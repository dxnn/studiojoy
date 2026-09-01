import path from 'node:path';
import { HttpError } from '../http/respond.js';
import { requireSlug } from '../files/paths.js';
import { requireAuth } from '../auth.js';
import { canEdit } from '../authors.js';

// Load the project named by :slug. Reads 404 on an unknown slug; writes also
// 409 on an archived one (spec.md §6). Archiving stops edits, not reads, and
// never stops the public game being served.
//
// ⚠️ `write: true` is also where authorship is checked, which is why it is on
// this one function rather than spread over thirty routes: a route that writes
// says so here, and saying so is what makes it refuse somebody who is not an
// author of a game that is not open (spec.md §11). A route that means to be an
// exception says `anyone: true` and takes the check itself — the human-only
// chat is the only one today.
//
// `files: true` marks a route that reaches the working tree. A chat has no
// working tree — no directory, no repo — so this is the one place that keeps
// such a route from being handed a path that does not exist (spec.md §12).
export function requireProject(ctx, { write = false, files = false, anyone = false } = {}) {
  const slug = requireSlug(ctx.params.slug);
  const project = ctx.db
    .prepare('SELECT * FROM projects WHERE slug = ?')
    .get(slug);
  if (!project) throw new HttpError(404, 'no such project');
  if (write && project.archived) throw new HttpError(409, 'project is archived');
  if (write && !anyone) {
    const user = requireAuth(ctx);
    if (!canEdit(ctx.db, project, user)) {
      throw new HttpError(403, `${project.name} is not yours to change — ask one of its editors`);
    }
  }
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

// The address a lockout or a limiter keys on: the socket's, or behind a
// reverse proxy the first hop of X-Forwarded-For — under the flag only,
// because unproxied a client that can name its own address can name a fresh
// one per request and never be limited (spec.md §6, §13).
//
// ⚠️ An IPv6 address is not a client. Every residential connection holds a
// /64 at least, so keyed on the whole address a limiter is stepped around
// with a fresh one per request and grows a map entry each time; the first
// four hextets are the household. IPv4 is one address per client and stays
// whole — including the ::ffff: form a dual-stack socket reports it in.
export function clientIp(ctx) {
  let ip = ctx.req.socket?.remoteAddress ?? 'unknown';
  if (ctx.trustProxy) {
    const forwarded = ctx.req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      ip = forwarded.split(',')[0].trim();
    }
  }
  return ipBucket(ip);
}

// `2001:db8:1:2:3:4:5:6` and `2001:0db8:1:2::` both bucket as
// `2001:db8:1:2::/64`. Anything without a colon, or with a dot in it, is
// IPv4 and comes back as it was.
export function ipBucket(ip) {
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail = ''] = ip.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const gap = Array(Math.max(0, 8 - front.length - back.length)).fill('0');
  const hextets = [...front, ...gap, ...back].slice(0, 4);
  return `${hextets.map((h) => (parseInt(h, 16) || 0).toString(16)).join(':')}::/64`;
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
  // Every emoji on this message, grouped, with who put it there: ids for the
  // "is this yours" test, names for the tooltip. Names resolved now like the
  // author's above, and without minding `deleted`, for the same reason.
  // Groups stand in the order the first of each landed, so a chip never moves
  // when somebody joins it.
  const reactions = [];
  for (const r of db
    .prepare(
      `SELECT r.emoji, r.user_id, u.display_name AS name
         FROM message_reactions r JOIN users u ON u.id = r.user_id
        WHERE r.message_id = ? ORDER BY r.created_at, r.user_id`,
    )
    .all(row.id)) {
    const entry = reactions.find((e) => e.emoji === r.emoji);
    if (entry) entry.users.push({ id: r.user_id, name: r.name });
    else reactions.push({ emoji: r.emoji, users: [{ id: r.user_id, name: r.name }] });
  }
  return {
    id: row.id,
    project_slug: slug,
    // Which conversation it belongs to. On every message because the stream
    // carries these to a client that may be looking at a different one — a
    // reply appearing in the wrong chat is worse than one arriving late.
    chat_id: row.chat_id ?? null,
    user_id: row.user_id ?? null,
    // Null for an agent. Never for a person: the lookup above asks `users`
    // without minding `deleted`, so somebody taken out of the studio still
    // signs the things they said, the way a deleted helper does.
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
    reactions,
    // Whether the token note under the bubble has a receipt to open. A flag
    // rather than the receipt itself: the breakdown is fetched on the click,
    // and old replies from before receipts existed stay a plain note.
    receipt: db
      .prepare('SELECT 1 FROM message_receipts WHERE message_id = ?')
      .get(row.id) !== undefined,
  };
}
