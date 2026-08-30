// Who a message calls by name. One parser and one matching rule for both
// kinds of name in the studio: an @ that reaches a *helper* makes it eligible
// to answer this turn, and an @ that reaches a *person* leaves a mark on the
// game in their sidebar until they open the chat it was said in.
//
// Names are free-form ("Level Designer", "Robin Fox") but a mention is one
// token, so both sides are normalised to lowercase alphanumerics before
// comparison: "@leveldesigner", "@Level-Designer" and "@level" all reach Level
// Designer, and "@Robin" reaches Robin Fox.
function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The @ must start the string or follow a non-alphanumeric, so an email
// address in a message doesn't conjure a mention — "mail dann@example.com"
// would otherwise wake anything named Example.
const MENTION = /(?:^|[^A-Za-z0-9])@([A-Za-z0-9_-]{1,100})/g;

export function parseMentions(body) {
  const found = new Set();
  for (const match of String(body ?? '').matchAll(MENTION)) {
    const handle = normalize(match[1]);
    if (handle) found.add(handle);
  }
  return found;
}

// A prefix match needs two characters, so a stray "@a" doesn't wake the whole
// roster. An exact match on the full normalised name always counts, which
// keeps single-character names mentionable.
const MIN_PREFIX = 2;

// The rule both kinds share. A prefix rather than the whole name because what
// people type is the first word of it — the studio itself inserts "@Robin" for
// Robin Fox — and "@robin" is a prefix of "robinfox".
export function nameMatches(name, mentions) {
  const normalized = normalize(name);
  if (!normalized) return false;
  for (const handle of mentions) {
    if (handle === normalized) return true;
    if (handle.length >= MIN_PREFIX && normalized.startsWith(handle)) return true;
  }
  return false;
}

export function agentEligible({ name, chatty = false }, mentions) {
  if (chatty) return true;
  return nameMatches(name, mentions);
}

/* People -------------------------------------------------------------------
   A mention of a person is a row, not an event: the mark has to survive the
   tab being closed, so it is unseen in the database until that person opens
   the chat. Per chat rather than per project, because reading one conversation
   says nothing about what was said in another. */

// Never the person who wrote it: an @ in your own message is you pointing at
// somebody else, and marking your own game unread is furniture.
export function mentionedUsers(db, body, writerId) {
  const mentions = parseMentions(body);
  if (mentions.size === 0) return [];
  return db
    .prepare('SELECT id, display_name FROM users')
    .all()
    .filter((u) => u.id !== writerId && nameMatches(u.display_name, mentions))
    .map((u) => u.id);
}

export function recordMentions(db, { messageId, chatId, projectId, users, now }) {
  for (const userId of users) {
    db.prepare(
      `INSERT OR IGNORE INTO mentions
         (message_id, user_id, chat_id, project_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(messageId, userId, chatId, projectId, now);
  }
}

export function markSeen(db, userId, chatId) {
  db.prepare('UPDATE mentions SET seen = 1 WHERE user_id = ? AND chat_id = ? AND seen = 0')
    .run(userId, chatId);
}

// What is still waiting for this person, as a count of messages. Null user —
// nobody is signed in — is nothing waiting, not an error.
export const unseenInProject = (db, userId, projectId) => (userId
  ? db
    .prepare('SELECT COUNT(*) AS n FROM mentions WHERE user_id = ? AND project_id = ? AND seen = 0')
    .get(userId, projectId).n
  : 0);

export const unseenInChat = (db, userId, chatId) => (userId
  ? db
    .prepare('SELECT COUNT(*) AS n FROM mentions WHERE user_id = ? AND chat_id = ? AND seen = 0')
    .get(userId, chatId).n
  : 0);
