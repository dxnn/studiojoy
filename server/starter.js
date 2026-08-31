// The starter helper: the one that joins every new game's Building chat, so a
// game is somewhere you can ask for something the moment it exists rather than
// after a trip to the Crew tab.
//
// A studio-wide setting (`studio_state.default_agent_id`) rather than a name in
// the source: helpers are rows people make, rename and delete, and a studio
// with a different favourite should not need a code change. Null is nobody,
// and a soft-deleted agent reads as null too — so a helper taken out of the
// studio quietly stops joining instead of failing every creation.

import { assertBotsAllowed } from './chats.js';

export function starterAgent(db) {
  const id = db.prepare('SELECT default_agent_id FROM studio_state WHERE id = 1')
    .get()?.default_agent_id ?? null;
  if (!id) return null;
  return db.prepare('SELECT * FROM agents WHERE id = ? AND deleted = 0').get(id) ?? null;
}

// Chatty, because a helper that has to be called by name is not company: the
// point is that the first thing typed into that chat is answered. ⚠️ Still
// through assertBotsAllowed — the chat handed in is the game's Building chat,
// and the one rule about where a helper may be put has no exceptions.
export function joinStarter(db, chat, userId, now = new Date().toISOString()) {
  const agent = starterAgent(db);
  if (!agent) return null;
  assertBotsAllowed(chat);
  db.prepare(
    `INSERT INTO chat_agents (chat_id, agent_id, chatty, attached_by, attached_at)
     VALUES (?, ?, 1, ?, ?)`,
  ).run(chat.id, agent.id, userId, now);
  return agent;
}
