import { json, text, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { tx } from '../db.js';
import { checkProjectPath } from '../files/paths.js';
import { requireProject, messagePublic, requireString } from './helpers.js';
import { requireChat, homeChat } from '../chats.js';
import { canEdit } from '../authors.js';
import { mentionedUsers, recordMentions, callAgentsIn } from '../mentions.js';

const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_EMOJI_BYTES = 32;
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
    // Not `write: true` — the check belongs to the chat rather than the game,
    // and this is the one route where they differ.
    const project = requireProject(ctx, { write: true, anyone: true });
    const body = await readJson(ctx.req);
    // Which conversation this is in. Absent means the one the project opens
    // on, so an older client posts into the human-only chat rather than into
    // whichever one it guessed.
    const chat = requireChat(ctx.db, project, body.chat_id);
    // ⚠️ The human-only chat of every game is everyone's: talking to the people
    // in the studio is not editing their game, and a game you can see but
    // cannot say a word about is a strange thing to be able to see. Every
    // other chat is where the work happens, so it takes the game's own rule.
    if (chat.bots === 1 && !canEdit(ctx.db, project, user)) {
      throw new HttpError(403, `${project.name} is not yours to change — you can still talk in ${homeChat(ctx.db, project.id).name}`);
    }

    if (typeof body.body !== 'string') throw new HttpError(400, 'body must be a string');
    const text = body.body.trim();
    if (text.length === 0) throw new HttpError(400, 'body must not be empty');
    // The cap is on bytes, not characters: an emoji-heavy message costs more
    // than its length suggests.
    if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
      throw new HttpError(400, `body must be at most ${MAX_MESSAGE_BYTES} bytes`);
    }
    const contextPaths = normalizeContextPaths(body.context_paths);
    if (contextPaths.length > 0 && project.kind === 'chat') {
      throw new HttpError(400, 'a chat has no files to point at');
    }

    const now = new Date().toISOString();
    // Who this message calls by name — the people, not the helpers, who are
    // woken by the orchestrator further down. Resolved before the write so the
    // rows land in the same transaction as the message they belong to.
    const named = mentionedUsers(ctx.db, text, user.id);
    // And which helpers it calls into the room. Only where helpers are
    // allowed at all — the human-only chat of a game stays human-only, and an
    // @ is not a way round that. In the same transaction as the message, so a
    // helper is never in a room because of a message that is not there.
    let joined = [];
    const messageId = tx(ctx.db, () => {
      const info = ctx.db
        .prepare(
          `INSERT INTO messages (project_id, chat_id, user_id, body, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(project.id, chat.id, user.id, text, now);
      const id = Number(info.lastInsertRowid);
      for (const p of contextPaths) {
        ctx.db
          .prepare('INSERT INTO message_context (message_id, path) VALUES (?, ?)')
          .run(id, p);
      }
      recordMentions(ctx.db, {
        messageId: id, chatId: chat.id, projectId: project.id, users: named, now,
      });
      if (chat.bots === 1) {
        joined = callAgentsIn(ctx.db, {
          chatId: chat.id, body: text, userId: user.id, now,
        });
      }
      return id;
    });

    const row = ctx.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    const payload = messagePublic(ctx.db, row, project.slug);
    // On the broadcast and not on the answer to this request: it is the other
    // tabs that need to know, and each one keeps only the mark that is its
    // own. A person's ids are no secret here — the Crew tab lists everybody.
    // `joined` rides along for the same reason: every tab looking at this
    // chat has to grow a chip for a helper the message called in, and the
    // message is the only thing that says it happened.
    ctx.broker.broadcast('message.new', { ...payload, mentions: named, joined });

    // Fired after the message is durable and broadcast, so the human's own
    // message always appears before any agent reply. Agents are woken only by
    // human messages — bot-to-bot dampening lives in the orchestrator — and
    // only in this chat: a helper in another one is not listening here.
    ctx.orchestrator?.onHumanMessage(project, row, chat);

    json(ctx.res, 201, payload);
  });

  r.get('/api/projects/:slug/messages', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
    const chat = requireChat(ctx.db, project, ctx.query.get('chat'));

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
    // thread without reversing anything itself. A piece's row is not in the
    // thread — its card is — and is fetched by id from the card (spec.md §8).
    const rows = before === null
      ? ctx.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages WHERE chat_id = ? AND plan_message_id IS NULL
             ORDER BY id DESC LIMIT ?
           ) ORDER BY id ASC`,
        )
        .all(chat.id, limit)
      : ctx.db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages WHERE chat_id = ? AND id < ? AND plan_message_id IS NULL
             ORDER BY id DESC LIMIT ?
           ) ORDER BY id ASC`,
        )
        .all(chat.id, before, limit);

    json(ctx.res, 200, {
      messages: rows.map((m) => messagePublic(ctx.db, m, project.slug)),
      has_more: rows.length === limit && rows.length > 0,
    });
  });

  // Toggle an emoji on a message: on if you had not put it there, off if you
  // had. Anyone signed in may react to anything they can read, which is
  // everything (spec.md §3) — a reaction is talk about the work, not a change
  // to it, so neither authorship nor archiving stands in the way. The emoji is
  // stored as given, ≤ 32 bytes and never validated further: the client offers
  // a fixed set and renders with textContent, so a forged string is inert and
  // no worse than a message body.
  r.post('/api/messages/:id/reactions/toggle', async (ctx) => {
    const user = requireAuth(ctx);
    const body = await readJson(ctx.req);
    const emoji = requireString(body.emoji, 'emoji');
    if (Buffer.byteLength(emoji, 'utf8') > MAX_EMOJI_BYTES) {
      throw new HttpError(400, `emoji must be at most ${MAX_EMOJI_BYTES} bytes`);
    }
    const row = ctx.db
      .prepare(
        `SELECT m.id, m.chat_id, p.slug FROM messages m
           JOIN projects p ON p.id = m.project_id WHERE m.id = ?`,
      )
      .get(requireMessageId(ctx));
    if (!row) throw new HttpError(404, 'no such message');

    const action = tx(ctx.db, () => {
      const gone = ctx.db
        .prepare(
          `DELETE FROM message_reactions
            WHERE message_id = ? AND user_id = ? AND emoji = ?`,
        )
        .run(row.id, user.id, emoji);
      if (gone.changes > 0) return 'remove';
      ctx.db
        .prepare(
          `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(row.id, user.id, emoji, new Date().toISOString());
      return 'add';
    });

    // To every tab, the sender's own included: their other tabs need it, and
    // the one that clicked merges the echo as a no-op. The name rides along
    // for the same reason it does on a message — the client has no user list
    // to look one up in.
    ctx.broker.broadcast('message.reaction', {
      project_slug: row.slug,
      chat_id: row.chat_id,
      message_id: row.id,
      user_id: user.id,
      user_name: user.display_name,
      emoji,
      action,
    });
    json(ctx.res, 200, { action });
  });

  // The receipt behind the token note: what the reply was given and what each
  // request cost, captured when it fired (spec.md §8). Message ids are global
  // and every account sees every project, so auth is the whole check.
  r.get('/api/messages/:id/receipt', (ctx) => {
    requireAuth(ctx);
    const id = requireMessageId(ctx);
    const row = ctx.db
      .prepare(
        `SELECT breakdown, prompt IS NOT NULL AS held
           FROM message_receipts WHERE message_id = ?`,
      )
      .get(id);
    if (row) {
      json(ctx.res, 200, { breakdown: JSON.parse(row.breakdown), prompt_held: row.held === 1 });
      return;
    }
    // A plan card had no fire of its own: its receipt is its pieces', so the
    // card's token note opens the way a reply's does (spec.md §8). Nothing
    // has landed yet, no receipt yet.
    const pieces = ctx.db
      .prepare(
        `SELECT r.breakdown, r.prompt IS NOT NULL AS held
           FROM messages m JOIN message_receipts r ON r.message_id = m.id
          WHERE m.plan_message_id = ? ORDER BY m.id`,
      )
      .all(id);
    if (pieces.length === 0) throw new HttpError(404, 'no receipt for that message');
    json(ctx.res, 200, {
      breakdown: piecesBreakdown(pieces.map((p) => JSON.parse(p.breakdown))),
      prompt_held: pieces.at(-1).held === 1,
    });
  });

  // One message by id. A piece's row lives behind its plan card and is not in
  // the thread, so the card fetches it when somebody opens the piece (spec.md
  // §8). Anything readable is readable by everybody signed in, as the thread is.
  r.get('/api/messages/:id', (ctx) => {
    requireAuth(ctx);
    const row = ctx.db
      .prepare(
        `SELECT m.*, p.slug FROM messages m
           JOIN projects p ON p.id = m.project_id WHERE m.id = ?`,
      )
      .get(requireMessageId(ctx));
    if (!row) throw new HttpError(404, 'no such message');
    json(ctx.res, 200, messagePublic(ctx.db, row, row.slug));
  });

  // What the helper said on the way to that reply — every turn's words but
  // the last, its working. Kept on the row and never replayed into a fire;
  // shown only when somebody opens the panel (spec.md §8).
  r.get('/api/messages/:id/working', (ctx) => {
    requireAuth(ctx);
    const row = ctx.db
      .prepare('SELECT working FROM messages WHERE id = ?')
      .get(requireMessageId(ctx));
    if (!row?.working) throw new HttpError(404, 'nothing more was said on the way to that reply');
    text(ctx.res, 200, row.working);
  });

  // The prompt itself, exactly as the last request of that fire carried it.
  // Held only for the newest reply in each project — the next fire takes it.
  // A plan card's is its last piece's, the way its receipt is its pieces'.
  r.get('/api/messages/:id/prompt', (ctx) => {
    requireAuth(ctx);
    const id = requireMessageId(ctx);
    const row = ctx.db
      .prepare(
        `SELECT prompt FROM message_receipts
          WHERE message_id = ?
             OR message_id = (SELECT MAX(id) FROM messages WHERE plan_message_id = ?)`,
      )
      .get(id, id);
    if (!row || row.prompt === null) {
      throw new HttpError(404, 'the prompt is only kept for the newest reply in a project');
    }
    text(ctx.res, 200, row.prompt);
  });
}

// The pieces' receipts as one. What the fire was given is the last piece's —
// every piece runs on the sizing's own block, so they differ only in their
// turn — and what it cost is every piece's requests in order, the loop counts
// summed, and how many pieces there were.
function piecesBreakdown(list) {
  const sum = (key) => list.reduce((n, b) => n + (b.loop?.[key] ?? 0), 0);
  return {
    ...list.at(-1),
    pieces: list.length,
    loop: {
      turns: sum('turns'), tool_calls: sum('tool_calls'), appended_bytes: sum('appended_bytes'), sheds: sum('sheds'),
    },
    requests: list.flatMap((b) => b.requests ?? []),
  };
}

function requireMessageId(ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'not a message id');
  return id;
}
