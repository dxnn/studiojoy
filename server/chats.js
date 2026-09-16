// A chat is one conversation inside a project. A game has as many as it wants
// — one for the humans, one per thing being built — and a project with no
// working tree (kind = 'chat') is one room and nothing else.
//
// Three rules give the shape:
//
// - **A game's first chat is human only.** Every game is born with it, it is
//   what the studio opens on, and `bots = 0` is enforced where a helper would
//   be put in rather than where one would answer. A room that promises nobody
//   is listening has to keep that promise at the door.
// - **A chat project is one room.** Not two: the whole thing is a place to
//   talk, so a second conversation inside it, and a front door in front of
//   that, is furniture around a room somebody already chose to open.
// - **A helper belongs to a chat, not to a project.** The line-up, the chatty
//   switch, the cooldown and the dirty bit are all per chat, because they are
//   all about one conversation.
// - **Every other room in a game is the builder's.** `Building`, and every
//   chat added to a game after it, holds the studio's own helper and nobody
//   else's (server/builder.js): the same door that keeps `Humans only` empty
//   keeps each of them to its one seat. Helpers people make go in chat
//   projects, where there is no tree to see.

import { HttpError } from './http/respond.js';
import { HOME_CHAT } from './db.js';
import { makeBuilderRoom } from './builder.js';

export const MAX_CHATS_PER_PROJECT = 20;
export const MAX_CHAT_NAME = 60;
// How many helpers may be in one conversation. Here rather than beside the
// route that enforces it, because being called in by name is a second way to
// reach the same wall.
export const MAX_AGENTS_PER_CHAT = 10;

export function createChat(db, projectId, { name, bots = 1, now = new Date().toISOString() }) {
  const info = db
    .prepare('INSERT INTO chats (project_id, name, bots, created_at) VALUES (?, ?, ?, ?)')
    .run(projectId, name, bots ? 1 : 0, now);
  return db.prepare('SELECT * FROM chats WHERE id = ?').get(info.lastInsertRowid);
}

// Called once, when a game is made: the human-only chat it opens on, then
// Building with the builder already in it — both from the start, so a new game
// is somewhere you can ask for something the moment it exists. Answers the
// builder's room, which is the one the studio opens a new game on.
export function startChats(db, projectId, userId, now = new Date().toISOString()) {
  createChat(db, projectId, { name: HOME_CHAT, bots: 0, now });
  return makeBuilderRoom(db, projectId, userId, now);
}

// Called once, when a chat project is made: the one room it has. Helpers are
// allowed in it — a room nobody can be called into is not what somebody means
// by starting a chat — and it wears the project's name, which is the only
// name anybody ever gave it.
export const startRoom = (db, projectId, name, now = new Date().toISOString()) => createChat(
  db, projectId, { name, bots: 1, now },
);

export const listChats = (db, projectId) => db
  .prepare('SELECT * FROM chats WHERE project_id = ? ORDER BY id')
  .all(projectId);

// The one a project opens on when nothing says otherwise: the first, which is
// a game's human-only chat and a chat project's only room.
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

// Whether a person's helper may be in this chat at all: a chat project's one
// room, and nothing in a game — every room there is the humans' or the
// builder's. ⚠️ The one rule, read by the door below and by a message that
// names a helper (mentions.js): a mention that could put a helper where the
// door refuses one would be the door kept by luck.
export const takesHelpers = (chat) => chat.bots === 1 && chat.builder !== 1;

// ⚠️ The one place that says a helper may not be put in a chat. Attach, the
// fork's copy and anything else that would write chat_agents goes through it,
// because "no bots allowed" that is only checked when a bot would answer is a
// promise kept by luck.
export function assertBotsAllowed(chat) {
  if (chat.bots !== 1) {
    throw new HttpError(409, `${chat.name} is just for the humans — helpers cannot be put in it`);
  }
  // A builder room has its one seat and takes no other helper. The same
  // promise as above, kept at the same door.
  if (chat.builder === 1) {
    throw new HttpError(409, `${chat.name} is the Builder's — a helper of your own goes in a chat of its own`);
  }
}

export const chatPublic = (row) => ({
  id: row.id,
  name: row.name,
  bots: row.bots === 1,
  builder: row.builder === 1,
});
