// A game's chats: switching between them, making one, who is in one, and
// being called by name across them. Not openProject: the files, the pins and
// the open file all belong to the game rather than to the chat, and throwing
// them away to read a different thread would be the same mistake Back used
// to make.

import { h } from './dom.js';
import {
  S, api, say, render, composerBox, canTalk, showMode, prefs,
} from './main.js';
import { liveMapFor, pendingMapFor, applyMessage } from './stream.js';

/* Being called by name ----------------------------------------------------- */

// The mark on a game, a chat or a conversation pill saying somebody called you
// there and you have not read it. The studio's own cyan, because it is the
// studio talking to you rather than the game — and not gold, which is a score
// or a version and nothing else.
const calledMark = (n) => (n
  ? h('span', {
    class: 'called',
    text: `@${n}`,
    title: n === 1 ? 'Somebody called you by name here' : `${n} messages here call you by name`,
  })
  : null);

// The same mark, generic: a plain dot once anything else here is unread.
// Dropped the moment the @n badge already shows — a mention already says
// there is something unread, and showing both would say it twice.
export const readMark = (row) => calledMark(row.mentions)
  ?? (row.unread ? h('span', { class: 'unread', title: 'There are unread messages here' }) : null);

// Clicking somebody in the Crew list points what you are typing at them. The
// handle is the first word of their name — a mention is one token, and the
// server matches on a prefix of the whole name, so "@Robin" reaches Robin Fox.
export function mentionPerson(person) {
  // The Crew tab is reachable with no game open and with somebody else's
  // Building on screen, and the row lights up either way — so it answers
  // rather than going dead under the pointer.
  if (!canTalk()) { say('Open a chat you can write in first, then click a name.'); return; }
  const handle = (person.display_name ?? '').trim().split(/\s+/)[0].replace(/[^A-Za-z0-9_-]/g, '');
  // A name with no letters or digits in it cannot be written as one token, so
  // there is nothing honest to insert.
  if (!handle) {
    say(`${person.display_name} cannot be called by name — that name has no letters or digits in it.`, true);
    return;
  }

  const box = composerBox;
  const at = box.selectionStart ?? box.value.length;
  const before = box.value.slice(0, at);
  const after = box.value.slice(at);
  // A space either side unless there already is one: dropped mid-sentence, an
  // @name run into the word before it is not a mention at all.
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const tail = after.startsWith(' ') ? '' : ' ';
  box.value = `${before}${lead}@${handle}${tail}${after}`;
  const caret = before.length + lead.length + handle.length + 1 + tail.length;
  box.focus();
  box.setSelectionRange(caret, caret);
  if (S.slug) S.drafts.set(S.slug, box.value);
}

// Opening a chat is reading it, so anything in it that called you, or simply
// happened while you were away, stops asking. The counts are dropped here
// rather than refetched: the answer is arithmetic, and a round trip would
// repaint the sidebar a beat late.
export async function readChat() {
  const chat = S.chats.find((c) => c.id === S.chat?.id);
  if (!chat || (!chat.mentions && !chat.unread)) return;
  const had = chat.mentions;
  chat.mentions = 0;
  chat.unread = false;
  const stillUnread = S.chats.some((c) => c.unread);
  const row = S.projects.find((p) => p.slug === S.slug);
  if (row) {
    row.mentions = Math.max(0, (row.mentions ?? 0) - had);
    row.unread = stillUnread;
  }
  if (S.project) {
    S.project.mentions = Math.max(0, (S.project.mentions ?? 0) - had);
    S.project.unread = stillUnread;
  }
  await api('POST', `/api/projects/${S.slug}/chats/${S.chat.id}/seen`);
}

/* Helpers ----------------------------------------------------------------- */

// Attaching, detaching and toggling all edit the open project's own copy of
// its agent list rather than refetching it. A refetch would throw away the
// open file, the pins, and anything mid-stream.
export async function attachAgent(agent) {
  if (!S.chat) return;
  const res = await api('POST', `/api/projects/${S.slug}/chats/${S.chat.id}/agents`, {
    agent_id: agent.id, chatty: true,
  });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not add that helper.', true);
    return;
  }
  S.project.agents.push({
    agent_id: agent.id,
    name: agent.name,
    model: agent.model,
    thinking: agent.thinking,
    file_tools: agent.file_tools,
    chatty: true,
    responding: false,
  });
  S.project.agents.sort((a, b) => a.name.localeCompare(b.name));
  say(`${agent.name} joined ${S.chat.name} and will answer your messages there.`);
}

export async function detachAgent(a) {
  const res = await api(
    'DELETE', `/api/projects/${S.slug}/chats/${S.chat.id}/agents/${a.agent_id}`,
  );
  if (!res.ok) {
    say(res.body?.error ?? 'Could not take that helper out.', true);
    return;
  }
  S.project.agents = S.project.agents.filter((x) => x.agent_id !== a.agent_id);
  say(`${a.name} is no longer in ${S.chat.name}.`);
}

export async function toggleChatty(a) {
  const res = await api(
    'PATCH', `/api/projects/${S.slug}/chats/${S.chat.id}/agents/${a.agent_id}`,
    { chatty: !a.chatty },
  );
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change that helper.', true);
    return;
  }
  a.chatty = !a.chatty;
  say(a.chatty
    ? `${a.name} will answer every message.`
    : `${a.name} will wait until you type @${a.name.split(' ')[0]}.`);
}

/* Chats -------------------------------------------------------------------- */

export async function openChat(id) {
  // A chat pill pressed while an editor is up brings the chat forward — the
  // one already behind the editor included, which is why the early return
  // below still paints.
  const fromEditor = S.mode !== 'chat';
  showMode('chat');
  if (!S.project || id === S.chat?.id) {
    // Coming out from behind the editor is opening the chat: what called you
    // there while it was hidden has now been seen.
    if (fromEditor) {
      readChat();
      render();
    }
    return;
  }
  const res = await api('GET', `/api/projects/${S.slug}?chat=${id}`);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not open that chat.', true);
    return;
  }
  S.chat = res.body.chat;
  S.chats = res.body.chats;
  S.project.messages = res.body.messages;
  S.project.agents = res.body.agents;
  // Each chat has its own live buffers, so a helper mid-reply in the one you
  // just left keeps writing into that one.
  S.live = liveMapFor(S.slug, S.chat.id);
  S.pending = pendingMapFor(S.slug, S.chat.id);
  S.autoscroll = true;
  readChat();
  prefs.set(`chat-${S.slug}`, S.chat.id);
  render();
}

export async function createChat(name) {
  const res = await api('POST', `/api/projects/${S.slug}/chats`, { name });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not make that chat.', true);
    return;
  }
  S.chats.push(res.body);
  await openChat(res.body.id);
  say(`${res.body.name} is ready. Helpers can be put in this one.`);
}

// The project payload carries its own copy of each attached helper's details,
// so a studio-wide edit or delete has to be mirrored into it.
export function syncAttached() {
  if (!S.project) return;
  const byId = new Map(S.agents.map((a) => [a.id, a]));
  S.project.agents = S.project.agents
    .filter((a) => byId.has(a.agent_id))
    .map((a) => ({ ...a, name: byId.get(a.agent_id).name, model: byId.get(a.agent_id).model }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* Messages ---------------------------------------------------------------- */

// A send in flight, shown at once rather than waited for: the words are the
// one thing here git cannot get back, so they go on screen — pending, then
// either gone (the real message replaced it) or marked failed, but never
// removed on their own. One counter for the whole session is enough; the map
// it keys into is already per chat.
let pendingCounter = 0;

async function post(slug, chatId, localId, text) {
  const map = pendingMapFor(slug, chatId);
  map.set(localId, { body: text, status: 'sending' });
  render();
  const res = await api('POST', `/api/projects/${slug}/messages`, {
    body: text,
    chat_id: chatId,
    context_paths: [...S.pinned],
  });
  if (res.ok) {
    map.delete(localId);
    // Paint it straight in only if still looking at the chat it went to —
    // otherwise it is safely on the server and will show when that chat is
    // next opened. Either way the SSE echo that follows is a no-op.
    if (S.slug === slug && S.chat?.id === chatId) applyMessage(res.body);
    else render();
    return;
  }
  map.get(localId).status = 'failed';
  render();
  say(res.body?.error ?? 'Could not send that.', true);
}

export function sendMessage(text) {
  return post(S.slug, S.chat?.id, `local-${pendingCounter += 1}`, text);
}

// A failed bubble is clicked to try again, in place: same localId, so it
// does not jump to the bottom of the pane.
export function retrySend(slug, chatId, localId) {
  const entry = pendingMapFor(slug, chatId).get(localId);
  if (entry) post(slug, chatId, localId, entry.body);
}

export function stickToBottom() {
  // By name: with an editor up the pane's first scroller is the editor's, and
  // that one must not be pulled to its bottom on every render.
  const scroller = document.querySelector('.chat .scroll[data-scroll="chat"]');
  if (scroller && S.autoscroll) scroller.scrollTop = scroller.scrollHeight;
}
