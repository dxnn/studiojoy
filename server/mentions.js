// Who a message calls by name. One parser and one matching rule for both
// kinds of name in the studio: an @ that reaches a *helper* makes it eligible
// to answer this turn — and puts it in the room if it was not already there —
// and an @ that reaches a *person* leaves a mark on the game in their sidebar
// until they open the chat it was said in.
//
// Names are free-form ("Level Designer", "Robin Fox") but a mention is one
// token, so both sides are normalised to lowercase alphanumerics before
// comparison: "@leveldesigner", "@Level-Designer" and "@level" all reach Level
// Designer, and "@Robin" reaches Robin Fox.
import { MAX_AGENTS_PER_CHAT } from './chats.js';

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
function nameMatches(name, mentions) {
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

/* Calling a helper in ------------------------------------------------------
   Naming a helper who is not in the room puts them in it, the way naming a
   person leaves them a mark: an @ is how you reach somebody, and having to
   go and fetch them from a list first is the studio asking you to do its
   filing. They arrive waiting to be called rather than chatty — you asked
   this one thing of them, not for a running commentary — and the orchestrator
   wakes them on this very message, because the @ that let them in is the same
   @ that makes them eligible. */

// ⚠️ Never into a chat that refuses helpers: the caller checks `bots` before
// this is reached, and assertBotsAllowed guards the route that does it by
// hand. A room that promises nobody is listening cannot be talked into
// breaking that promise.
export function callAgentsIn(db, { chatId, body, userId, now }) {
  const mentions = parseMentions(body);
  if (mentions.size === 0) return [];
  const already = db
    .prepare('SELECT agent_id FROM chat_agents WHERE chat_id = ?')
    .all(chatId);
  const room = new Set(already.map((r) => r.agent_id));
  const called = db
    .prepare('SELECT id, name FROM agents WHERE deleted = 0 ORDER BY name')
    .all()
    .filter((a) => !room.has(a.id) && nameMatches(a.name, mentions));

  const joined = [];
  for (const agent of called) {
    // The same wall the Crew tab hits. Whoever is named past it stays out and
    // the message still stands: refusing a message somebody has already
    // written because a room is full would lose the words.
    if (room.size + joined.length >= MAX_AGENTS_PER_CHAT) break;
    db.prepare(
      `INSERT INTO chat_agents (chat_id, agent_id, chatty, attached_by, attached_at)
       VALUES (?, ?, 0, ?, ?)`,
    ).run(chatId, agent.id, userId, now);
    joined.push(agent);
  }
  return joined;
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
    // Only people who are still here: a mark nobody will ever open is not a
    // mark. Their old ones stay in `mentions`, seen or not, and come back with
    // them.
    .prepare('SELECT id, display_name FROM users WHERE deleted = 0')
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
