// Generic read-tracking for a chat: whether it holds a message from somebody
// else since this person last opened it, independent of @mentions — the
// "something happened" flag underneath the "you were named" one.
//
// One row per (user, chat) in chat_reads, the newest message id read there.
// markRead stamps it at the same moment markSeen clears mentions, so opening
// a chat clears both together.

export function markRead(db, userId, chatId) {
  const last = db.prepare('SELECT MAX(id) AS id FROM messages WHERE chat_id = ?').get(chatId).id;
  if (last == null) return;
  db.prepare(
    `INSERT INTO chat_reads (user_id, chat_id, last_read_message_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, chat_id) DO UPDATE
         SET last_read_message_id = excluded.last_read_message_id
       WHERE excluded.last_read_message_id > chat_reads.last_read_message_id`,
  ).run(userId, chatId, last);
}

// Never the person who wrote it — the same rule a mention follows: writing
// the last word in a room does not make it unread for you. Null user
// (nobody signed in) is nothing waiting, not an error.
export const chatHasUnread = (db, userId, chatId) => (userId
  ? db.prepare(
    `SELECT EXISTS(
       SELECT 1 FROM messages m
        WHERE m.chat_id = ?
          AND (m.user_id IS NULL OR m.user_id != ?)
          AND m.id > COALESCE(
            (SELECT last_read_message_id FROM chat_reads WHERE user_id = ? AND chat_id = ?), 0)
     ) AS unread`,
  ).get(chatId, userId, userId, chatId).unread === 1
  : false);

// The same question across every chat in a project, for the mark on the
// game itself.
export const projectHasUnread = (db, userId, projectId) => (userId
  ? db.prepare(
    `SELECT EXISTS(
       SELECT 1 FROM messages m
        JOIN chats c ON c.id = m.chat_id
        WHERE c.project_id = ?
          AND (m.user_id IS NULL OR m.user_id != ?)
          AND m.id > COALESCE(
            (SELECT last_read_message_id FROM chat_reads WHERE user_id = ? AND chat_id = c.id), 0)
     ) AS unread`,
  ).get(projectId, userId, userId).unread === 1
  : false);
