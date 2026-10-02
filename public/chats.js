// A game's chats: switching between them, making one, who is in one, and
// being called by name across them. Not openProject: the files, the pins and
// the open file all belong to the game rather than to the chat, and throwing
// them away to read a different thread would be the same mistake Back used
// to make.

import { h } from './dom.js';
import {
  S, api, say, render, composerBox, canTalk, showMode, prefs, frozen,
} from './main.js';
import { liveMapFor, pendingMapFor, applyMessage } from './stream.js';
import { keepShot } from './telemetry.js';
import { withEmoji } from './shortcodes.js';

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

// Whether a row wears a mark at all. The pill it is on comes up out of muted
// while it does — a 7px dot beside a greyed word is easy to walk straight
// past, and the words are what the eye is already reading. The same two
// fields readMark reads, in one place so the two cannot disagree.
export const marked = (row) => Boolean(row.mentions || row.unread);

// The one token that reaches somebody: the first word of their name, stripped
// to what a mention may hold. A mention is one token, and the server matches
// on a prefix of the whole name, so "@Robin" reaches Robin Fox. Empty for a
// name with no letters or digits in it, which cannot be written as one at all.
export const handleFor = (name) => (name ?? '').trim().split(/\s+/)[0].replace(/[^A-Za-z0-9_-]/g, '');

// Clicking somebody in the Crew list points what you are typing at them.
export function mentionPerson(person) {
  // The Crew tab is reachable with no game open and with somebody else's
  // Building on screen, and the row lights up either way — so it answers
  // rather than going dead under the pointer.
  if (!canTalk()) { say('Open a chat you can write in first, then click a name.'); return; }
  const handle = handleFor(person.display_name);
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
  if (S.slug) S.unsent.set(S.slug, box.value);
}

/* The @ menu ---------------------------------------------------------------

   Type an @ and the studio offers everybody this message could reach, the way
   every other chat does. It is not decoration: an @ is what makes a helper
   answer at all, and what leaves a person a mark on the game — and the only
   way to find out a name was mentionable used to be to guess it or to go and
   click it in the sidebar.

   ⚠️ One node on the body, painted in place and never through render(). The
   composer is not rebuilt by a render (main.js) and neither is this: a menu
   in the tree would rebuild the whole thread on every keystroke of a name,
   which is the trap §17 names for every other live surface. */

const atMenu = h('div', { class: 'at-menu' });
document.body.append(atMenu);

// What the menu is showing: the rows, which one is lit, and the span of the
// box the pick replaces — from the @ to the caret. Null when it is shut.
let at = null;

// The same two rules the server parses with (server/mentions.js): a name is
// compared as its lowercase letters and digits alone, and an @ counts only at
// the start or after something that is not one of those — so typing an email
// address never opens this.
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const TYPING_AT = /(?:^|[^A-Za-z0-9])@([A-Za-z0-9_-]*)$/;

// Most rows at once. Past this it is a list to read rather than a name to
// pick, and the studio has a Crew tab for reading lists.
const AT_MOST = 8;

// Everybody this message could reach, in the order the Crew tab lists them:
// the people, then the helpers. A helper who is not in this room is offered
// too, because naming one is what puts them in it — except where the + that
// does the same thing is not offered either: the human-only room, the
// builder's, and a game this account may not change.
function atRows(typed) {
  const want = normalize(typed);
  const rows = [];
  for (const person of S.people) {
    if (person.id === S.me?.id) continue;
    rows.push({ name: person.display_name, what: 'leaves them a mark on this game' });
  }
  if (S.chat?.bots) {
    const here = S.project?.agents ?? [];
    for (const a of here) {
      rows.push({
        name: a.name,
        helper: true,
        what: a.chatty ? 'always answers here' : 'answers when called',
      });
    }
    if (!S.chat.builder && !frozen()) {
      const inRoom = new Set(here.map((a) => a.agent_id));
      for (const a of S.agents) {
        if (inRoom.has(a.id)) continue;
        rows.push({ name: a.name, helper: true, what: 'not in here yet — this brings them in' });
      }
    }
  }
  return rows
    .filter((row) => handleFor(row.name) && normalize(row.name).startsWith(want))
    .slice(0, AT_MOST);
}

// Over the composer, at its left edge, never wider than it is. Fixed like the
// ··· menus and for the same reason: the pane around it moves.
export function placeAtMenu() {
  if (!at) return;
  const box = composerBox.getBoundingClientRect();
  atMenu.style.left = `${box.left}px`;
  atMenu.style.bottom = `${Math.max(0, window.innerHeight - box.top + 6)}px`;
  atMenu.style.maxWidth = `${Math.max(220, box.width)}px`;
}
window.addEventListener('resize', placeAtMenu);

export function closeAtMenu() {
  if (!at) return;
  at = null;
  atMenu.replaceChildren();
  atMenu.className = 'at-menu';
}

function paintAtMenu() {
  atMenu.replaceChildren(...at.rows.map((row, i) => h('div', {
    class: `at-row${i === at.lit ? ' on' : ''}`,
    // ⚠️ The composer must not lose the caret to a click in here: the pick
    // puts the words back into the box they came from, and a blur first would
    // shut the menu before the click landed.
    onmousedown: (e) => e.preventDefault(),
    onclick: () => pickAt(i),
  },
  h('span', { class: `at-name${row.helper ? ' helper' : ''}`, text: row.name }),
  h('span', { class: 'at-what', text: row.what }))));
  atMenu.className = 'at-menu on';
  placeAtMenu();
}

// Read the box and show or hide the menu. Called on every keystroke and
// wherever else the caret can move.
export function followAt() {
  const to = composerBox.selectionStart ?? composerBox.value.length;
  const typing = composerBox.disabled ? null : TYPING_AT.exec(composerBox.value.slice(0, to));
  if (!typing) { closeAtMenu(); return; }
  const rows = atRows(typing[1]);
  if (rows.length === 0) { closeAtMenu(); return; }
  // Whichever row was lit stays lit while the list shrinks under it.
  const lit = at ? Math.min(at.lit, rows.length - 1) : 0;
  at = { rows, lit, from: to - typing[1].length - 1, to };
  paintAtMenu();
}

function pickAt(index) {
  const row = at?.rows[index];
  if (!row) return;
  const handle = handleFor(row.name);
  const before = composerBox.value.slice(0, at.from);
  const after = composerBox.value.slice(at.to);
  // A space after unless there is one already, so the next word is not run
  // into the name and swallowed by it.
  const tail = after.startsWith(' ') ? '' : ' ';
  const caret = at.from + handle.length + 1 + tail.length;
  composerBox.value = `${before}@${handle}${tail}${after}`;
  closeAtMenu();
  composerBox.focus();
  composerBox.setSelectionRange(caret, caret);
  if (S.slug) S.unsent.set(S.slug, composerBox.value);
}

// ⚠️ The keys the menu answers while it is open, before the composer's own
// handler sees them: Enter picks a name rather than sending the message, which
// is what every other chat does and what stops half a sentence being sent.
// True means the key has been taken.
export function keyAt(event) {
  if (!at) return false;
  if (event.key === 'Escape') { closeAtMenu(); return true; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    at.lit = (at.lit + (event.key === 'ArrowDown' ? 1 : -1) + at.rows.length) % at.rows.length;
    paintAtMenu();
    event.preventDefault();
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    pickAt(at.lit);
    return true;
  }
  return false;
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
    thinking: agent.thinking,
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
  // Who is in the room is about to change, and the menu is a list of them.
  closeAtMenu();
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
    return false;
  }
  S.chats.push(res.body);
  await openChat(res.body.id);
  say(`${res.body.name} is ready. Helpers can be put in this one.`);
  return true;
}

// An ask, dropped into the composer as the request it is — the kid can change
// it or send it as it stands. Nothing is sent for them.
export function askBuilder(text) {
  composerBox.value = text;
  composerBox.focus();
  composerBox.setSelectionRange(text.length, text.length);
  if (S.slug) S.unsent.set(S.slug, text);
}

// The way into achievements for a game that has none (spec.md §6). An
// achievement is a rule over the moments a game says, and saying them is
// code, so making the first ones is the builder's job: a builder room about
// them — the one already made, if there is one — with the ask waiting in the
// composer. A game with every room it may have gets the ask in Building.
export const ACHIEVEMENTS_ROOM = 'Achievements';
const ACHIEVEMENTS_ASK = 'Give this game some achievements: three to five things a player can earn '
  + 'by playing it, like finishing a level or beating a score. Make the game say the moments they need.';

export async function askForAchievements() {
  S.narrowPane = 'chat';
  const room = S.chats.find((c) => c.builder && c.name === ACHIEVEMENTS_ROOM);
  if (room) await openChat(room.id);
  else if (!(await createChat(ACHIEVEMENTS_ROOM))) await openChat(S.chats.find((c) => c.builder)?.id);
  askBuilder(ACHIEVEMENTS_ASK);
}

// The project payload carries its own copy of each attached helper's details,
// so a studio-wide edit or delete has to be mirrored into it.
export function syncAttached() {
  if (!S.project) return;
  const byId = new Map(S.agents.map((a) => [a.id, a]));
  S.project.agents = S.project.agents
    .filter((a) => byId.has(a.agent_id))
    .map((a) => ({ ...a, name: byId.get(a.agent_id).name }))
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
  // A frame of the game first, if one is on screen: "it looks wrong" is about
  // what they can see, and this is the moment they can see it (spec/ §8).
  // Half a second at the outside, behind a bubble that is already painted.
  await keepShot(slug);
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

// `:wave:` becomes 👋 here, before the bubble goes on screen, so what shows
// while it sends is what was sent.
export function sendMessage(text) {
  return post(S.slug, S.chat?.id, `local-${pendingCounter += 1}`, withEmoji(text));
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
