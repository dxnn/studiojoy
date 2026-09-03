// The conversations inside a project: list them with the project, make one,
// rename one. There is no delete: a chat holds everything anybody said in it,
// and nothing else in the studio throws away words.

import { json, noContent, HttpError } from '../http/respond.js';
import { readJson } from '../http/body.js';
import { requireAuth } from '../auth.js';
import { markSeen } from '../mentions.js';
import { markRead } from '../reads.js';
import { requireProject, requireString } from './helpers.js';
import {
  createChat, listChats, requireChat, chatPublic,
  MAX_CHATS_PER_PROJECT, MAX_CHAT_NAME,
} from '../chats.js';

export function chatRoutes(r) {
  r.get('/api/projects/:slug/chats', (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx);
    json(ctx.res, 200, { chats: listChats(ctx.db, project.id).map(chatPublic) });
  });

  // A new chat always allows helpers. The one that does not is the one a game
  // was born with, and there is no way to make a second of those: "just us"
  // is a place, not a setting.
  r.post('/api/projects/:slug/chats', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const body = await readJson(ctx.req);
    const name = requireString(body.name, 'name', { max: MAX_CHAT_NAME });

    // Games only. A chat project is one room — see server/chats.js — and the
    // studio offers no button for this there, so anything reaching here is
    // asking for a shape the client cannot show.
    if (project.kind === 'chat') {
      throw new HttpError(409, `${project.name} is one chat — start another chat of its own instead`);
    }

    const count = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM chats WHERE project_id = ?')
      .get(project.id).c;
    if (count >= MAX_CHATS_PER_PROJECT) {
      throw new HttpError(409, `a game may not have more than ${MAX_CHATS_PER_PROJECT} chats`);
    }

    const chat = createChat(ctx.db, project.id, { name, bots: 1 });
    ctx.broker.broadcast('chats.changed', { project_slug: project.slug });
    json(ctx.res, 201, chatPublic(chat));
  });

  // "I have read this one." Clears the marks left on this chat by anything
  // that called you by name, and stamps how far you have read it generally.
  // Not a side effect of the GET that opens the chat: a read that writes is a
  // read somebody else's tab can trip, and the client also calls this when a
  // message lands in the chat already on screen.
  //
  // Every account may do it, for any chat: reading is everybody's (spec.md
  // §3), and it clears nothing but your own rows.
  r.post('/api/projects/:slug/chats/:chat_id/seen', (ctx) => {
    const user = requireAuth(ctx);
    const project = requireProject(ctx);
    const chat = requireChat(ctx.db, project, ctx.params.chat_id);
    markSeen(ctx.db, user.id, chat.id);
    markRead(ctx.db, user.id, chat.id);
    noContent(ctx.res);
  });

  r.patch('/api/projects/:slug/chats/:chat_id', async (ctx) => {
    requireAuth(ctx);
    const project = requireProject(ctx, { write: true });
    const chat = requireChat(ctx.db, project, ctx.params.chat_id);
    const body = await readJson(ctx.req);
    const name = requireString(body.name, 'name', { max: MAX_CHAT_NAME });

    ctx.db.prepare('UPDATE chats SET name = ? WHERE id = ?').run(name, chat.id);
    ctx.broker.broadcast('chats.changed', { project_slug: project.slug });
    json(ctx.res, 200, chatPublic({ ...chat, name }));
  });
}
