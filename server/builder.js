// The builder: the studio's own helper, and the one every game is born with.
//
// A reserved `agents` row (`builtin = 1`) rather than one somebody made in the
// Crew tab: nobody edits it, nobody deletes it, it is not offered for putting
// in a chat, and its description, model and thinking are the code's — written
// onto the row on every open, so a studio that upgrades gets the new words.
// It lives in one room per game, `Building`, which takes no other helper the
// way `Humans only` takes none (chats.js, assertBotsAllowed). What it does
// there that an ordinary helper does not — the sizing call, one fire per
// piece — is the orchestrator's (spec.md §8, ideas/planner.md).

export const BUILDER_NAME = 'Builder';
export const BUILDER_CHAT = 'Building';
// What an existing game's Building becomes when it had helpers in it: the room
// and its words are kept under a name that says what it now is, and a fresh
// Building is made for the builder (intoBuilderRooms).
export const CARRIED_BUILDING = 'Old building';

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

export const BUILDER_MODEL = 'deepseek-v4-flash';
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
      'UPDATE agents SET description = ?, model = ?, thinking = ?, file_tools = 1 WHERE id = ?',
    ).run(BUILDER_DESCRIPTION, BUILDER_MODEL, BUILDER_THINKING, existing.id);
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
       (name, description, model, thinking, file_tools, builtin, created_by, created_at)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
  ).run(BUILDER_NAME, BUILDER_DESCRIPTION, BUILDER_MODEL, BUILDER_THINKING, someone, now);
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

// A game's Building: the builder's room, with the builder in it.
export function makeBuilderRoom(db, projectId, userId, now = new Date().toISOString()) {
  const builder = ensureBuilder(db, now);
  const info = db
    .prepare('INSERT INTO chats (project_id, name, bots, builder, created_at) VALUES (?, ?, 1, 1, ?)')
    .run(projectId, BUILDER_CHAT, now);
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(info.lastInsertRowid);
  if (builder) seatBuilder(db, chat, builder, userId, now);
  return chat;
}

// Every game gets the builder's room, an upgraded database included. A game's
// first room that takes helpers is its Building: empty, it becomes the
// builder's in place; with helpers in it, it keeps them and its words under
// `Old building`, and a fresh Building is made beside it. A room the people
// renamed is theirs and is left alone. Nothing runs twice: a game with a
// builder room is skipped.
export function intoBuilderRooms(db, now = new Date().toISOString()) {
  const builder = ensureBuilder(db, now);
  if (!builder) return;
  const games = db.prepare(
    `SELECT id FROM projects p
      WHERE p.kind = 'game'
        AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.project_id = p.id AND c.builder = 1)`,
  ).all();
  for (const game of games) {
    const open = db
      .prepare('SELECT * FROM chats WHERE project_id = ? AND bots = 1 ORDER BY id LIMIT 1')
      .get(game.id);
    if (open && open.name === BUILDER_CHAT) {
      const helpers = db
        .prepare('SELECT COUNT(*) AS n FROM chat_agents WHERE chat_id = ?')
        .get(open.id).n;
      if (helpers === 0) {
        db.prepare('UPDATE chats SET builder = 1 WHERE id = ?').run(open.id);
        seatBuilder(db, open, builder, builder.created_by, now);
        continue;
      }
      db.prepare('UPDATE chats SET name = ? WHERE id = ?').run(CARRIED_BUILDING, open.id);
    }
    makeBuilderRoom(db, game.id, builder.created_by, now);
  }
}
