// The builder: the studio's own helper, and the one every game is born with.
//
// A reserved `agents` row (`builtin = 1`) rather than one somebody made in the
// Crew tab: nobody edits it, nobody deletes it, it is not offered for putting
// in a chat, and its description and thinking are the code's — written
// onto the row on every open, so a studio that upgrades gets the new words.
// Every room in a game but `Humans only` is its: a game is born with
// `Building` and every chat added to it is another builder room, each with
// the builder seated and no other helper let in (chats.js, assertBotsAllowed).
// Helpers people make live in chat projects, blind to any tree. What the
// builder does that they do not — the sizing call, one fire per piece — is
// the orchestrator's (spec.md §8, ideas/planner.md).

export const BUILDER_NAME = 'Builder';
export const BUILDER_CHAT = 'Building';

// Item 3 of the system prompt, after the preamble and the brief. The preamble
// says what the studio is and BRIEF.md what this game is, so this says only
// who the builder is (ideas/agent-descriptions.md) — and it is short, because
// every word here is in front of every piece.
export const BUILDER_DESCRIPTION = [
  "You are the Builder, the studio's own helper for making a game with the people here.",
  'You build games with them, not for them: they are the designer, you make their ideas real in files.',
  'Warm, practical, brief. No praise and no jargon; when something breaks, say what was wrong and what',
  'you changed, in a sentence. Kids use this studio, so keep to cartoon danger and ask nothing personal.',
  'Use what the studio already does before writing your own version of it, keep files short and plain,',
  'and find the simpler version of a big idea that keeps the fun.',
].join('\n');

// For a small ask, a little thinking: no plan thought for it first. A piece
// runs at 'none' whatever this says (spec.md §14).
export const BUILDER_THINKING = 'low';

export const builderAgent = (db) => db
  .prepare('SELECT * FROM agents WHERE builtin = 1 AND deleted = 0')
  .get() ?? null;

// The row, made if missing and brought up to date if not. `created_by` has to
// be somebody: on a database with no accounts yet there is nothing to hang it
// on, so it is made the first time a game is (startChats), by which time the
// game's maker exists.
export function ensureBuilder(db, now = new Date().toISOString()) {
  const existing = builderAgent(db);
  if (existing) {
    db.prepare(
      'UPDATE agents SET description = ?, thinking = ? WHERE id = ?',
    ).run(BUILDER_DESCRIPTION, BUILDER_THINKING, existing.id);
    return builderAgent(db);
  }
  const someone = db.prepare('SELECT MIN(id) AS id FROM users').get()?.id ?? null;
  if (!someone) return null;
  // Names are unique among the living, and a helper somebody made and called
  // Builder would stand in the way. Theirs is renamed, never removed.
  db.prepare("UPDATE agents SET name = name || ' (helper)' WHERE name = ? AND deleted = 0")
    .run(BUILDER_NAME);
  db.prepare(
    `INSERT INTO agents
       (name, description, thinking, builtin, created_by, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(BUILDER_NAME, BUILDER_DESCRIPTION, BUILDER_THINKING, someone, now);
  return builderAgent(db);
}

export const builderRoom = (db, projectId) => db
  .prepare('SELECT * FROM chats WHERE project_id = ? AND builder = 1 ORDER BY id LIMIT 1')
  .get(projectId) ?? null;

// Chatty, and not through assertBotsAllowed: this is the one seat the room
// has, and the door that refuses everybody else is for everybody else.
function seatBuilder(db, chat, builder, userId, now) {
  db.prepare(
    `INSERT OR IGNORE INTO chat_agents (chat_id, agent_id, chatty, attached_by, attached_at)
     VALUES (?, ?, 1, ?, ?)`,
  ).run(chat.id, builder.id, userId, now);
}

// A builder room, with the builder in it: a game's Building at birth, and
// every chat added to a game after.
export function makeBuilderRoom(db, projectId, userId, now = new Date().toISOString(), name = BUILDER_CHAT) {
  const builder = ensureBuilder(db, now);
  const info = db
    .prepare('INSERT INTO chats (project_id, name, bots, builder, created_at) VALUES (?, ?, 1, 1, ?)')
    .run(projectId, name, now);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(info.lastInsertRowid);
  if (builder) seatBuilder(db, chat, builder, userId, now);
  return chat;
}

// Every room in a game that takes helpers is the builder's, an upgraded
// database included: the room keeps its name and every word said in it, the
// builder is seated, and the helpers people had put there leave — since
// 2026-09-15 a person's helper lives in a chat project and nowhere else. Two
// rooms a game used to be given (`Building` and, when that one had helpers,
// `Old building` beside it) both come forward as builder rooms. Idempotent:
// a room that is already the builder's is not made one again.
//
// ⚠️ And nobody is left beside the builder in any of them. Until 2026-09-15 a name
// typed in `Building` seated that helper there, and `Building` was already
// the builder's, so the rooms this finds never included it: a studio that ran
// that code has people's helpers sitting in builder rooms, where every fire
// is the builder's, file tools and all.
export function intoBuilderRooms(db, now = new Date().toISOString()) {
  const builder = ensureBuilder(db, now);
  if (!builder) return;
  const rooms = db.prepare(
    `SELECT c.* FROM chats c JOIN projects p ON p.id = c.project_id
      WHERE p.kind = 'game' AND c.bots = 1 AND c.builder = 0 ORDER BY c.id`,
  ).all();
  for (const room of rooms) {
    db.prepare('DELETE FROM chat_agents WHERE chat_id = ? AND agent_id != ?').run(room.id, builder.id);
    db.prepare('UPDATE chats SET builder = 1 WHERE id = ?').run(room.id);
    seatBuilder(db, room, builder, builder.created_by, now);
  }
  db.prepare(
    `DELETE FROM chat_agents WHERE agent_id != ?
       AND chat_id IN (SELECT id FROM chats WHERE builder = 1)`,
  ).run(builder.id);
}
