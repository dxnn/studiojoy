// A chat is one conversation inside a project. A game has as many as it wants
// — one for the humans, one per thing being built — and a project with no
// working tree (kind = 'chat') is a project whose chats are all there is.
//
// Two rules give the shape:
//
// - **The first chat is human only.** Every project is born with it, it is
//   what the studio opens on, and `bots = 0` is enforced where a helper would
//   be put in rather than where one would answer. A room that promises nobody
//   is listening has to keep that promise at the door.
// - **A helper belongs to a chat, not to a project.** The line-up, the chatty
//   switch, the cooldown and the dirty bit are all per chat, because they are
//   all about one conversation.

import { HttpError } from './http/respond.js';
import { HOME_CHAT } from './db.js';

export const MAX_CHATS_PER_PROJECT = 20;
export const MAX_CHAT_NAME = 60;

// The chat every project is born with, plus the one where the helpers are.
// Both, from the start: a new game that could only be talked about by humans
// would need a second click before anybody could ask for anything.
const WORK_CHAT = 'Building';

export function createChat(db, projectId, { name, bots = 1, now = new Date().toISOString() }) {
  const info = db
    .prepare('INSERT INTO chats (project_id, name, bots, created_at) VALUES (?, ?, ?, ?)')
    .run(projectId, name, bots ? 1 : 0, now);
  return db.prepare('SELECT * FROM chats WHERE id = ?').get(info.lastInsertRowid);
}

// Called once, when a project is made.
export function startChats(db, projectId, now = new Date().toISOString()) {
  createChat(db, projectId, { name: HOME_CHAT, bots: 0, now });
  return createChat(db, projectId, { name: WORK_CHAT, bots: 1, now });
}

export const listChats = (db, projectId) => db
  .prepare('SELECT * FROM chats WHERE project_id = ? ORDER BY id')
  .all(projectId);

// The one a project opens on when nothing says otherwise: the first, which is
// the human-only one.
export const homeChat = (db, projectId) => db
  .prepare('SELECT * FROM chats WHERE project_id = ? ORDER BY id LIMIT 1')
  .get(projectId);

// `?chat=` on a read, `chat_id` in a body. A chat id that belongs to another
// project is a 404 rather than a 403: from here it is simply not a chat of
// this project's.
export function requireChat(db, project, raw) {
  if (raw === null || raw === undefined || raw === '') return homeChat(db, project.id);
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'not a chat id');
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND project_id = ?').get(id, project.id);
  if (!chat) throw new HttpError(404, 'no such chat in this project');
  return chat;
}

// ⚠️ The one place that says a helper may not be put in a chat. Attach, the
// fork's copy and anything else that would write chat_agents goes through it,
// because "no bots allowed" that is only checked when a bot would answer is a
// promise kept by luck.
export function assertBotsAllowed(chat) {
  if (chat.bots !== 1) {
    throw new HttpError(409, `${chat.name} is just for the humans — helpers cannot be put in it`);
  }
}

export const chatPublic = (row) => ({
  id: row.id,
  name: row.name,
  bots: row.bots === 1,
});
