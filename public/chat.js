// The chat pane: the thread, a streaming reply's live nodes, the tint on a
// bubble, and the composer's surroundings. The composer node itself and the
// sending of a message stay in main.js — the box outlives every render, and
// what happens to unsent words is state the whole studio shares.

import { h } from './dom.js';
import {
  S, render, prefs, isChat, agentName, urlAs, openProject,
  composerBox, sendComposer, send, api, say, sizeText,
  openMode, showMode, renderModeBody, frozen, canTalk, nearQuota,
  more,
} from './main.js';
import { toolLabel, thinkingFor } from './stream.js';
import { loadDiff, loadHistory, historyNeedsLoad } from './history.js';
import {
  toggleChatty, detachAgent, openChat, readMark, marked, retrySend,
} from './chats.js';
import { modesFor } from './game-types.js';

/* Render: chat ------------------------------------------------------------ */

// The server's MAX_CHATS_PER_PROJECT, mirrored: past it the button that makes
// another one is left out rather than left to be refused.
const MAX_CHATS = 20;

// FNV-1a. Any stable scramble would do; this one is four lines and needs no
// seeding.
function hashOf(text) {
  let n = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  }
  return n >>> 0;
}

// A quiet wash of colour over a bubble, fixed per speaker: people land in the
// warm end, helpers in the green-to-blue end, and everyone gets their own hue
// and their own arrangement of blobs. Three low-alpha radial gradients over
// the usual bubble colour — enough that two helpers in one thread are told
// apart at a glance, not so much that it reads as decoration.
function tintStyle(agent, id) {
  const n = hashOf(`${agent ? 'a' : 'u'}:${id}`);
  // >>> and not >>: the hash fills 32 bits, and a signed shift would hand
  // back negative hues and off-canvas gradient origins.
  const pick = (shift, span) => (n >>> shift) % span;
  // Hue comes from a slot rather than a raw modulo, so two speakers either
  // share a hue or sit a clear step apart — never three degrees apart, which
  // reads as a rendering accident.
  const slot = pick(0, 6);
  const hue = agent ? 150 + slot * 15 : 20 + slot * 10;
  const hue2 = hue + 14 + pick(6, 20);
  return [
    `--th:${hue}`,
    `--th2:${hue2}`,
    `--ts:${agent ? 60 : 50}%`,
    `--x1:${6 + pick(9, 38)}%`, `--y1:${pick(13, 34)}%`,
    `--x2:${58 + pick(17, 38)}%`, `--y2:${64 + pick(21, 36)}%`,
    `--x3:${22 + pick(25, 56)}%`, `--y3:${38 + pick(3, 40)}%`,
  ].join(';');
}

// The small grey line under a reply. Plain language: the thread is long, so
// this helper was given the recent part of it and not the beginning. When the
// reply left a receipt, the token count is the link that opens it — a reply
// from before receipts existed stays a plain note, because a note that lights
// up must open something.
// The last thing in the thread, which is where a warning about your own day
// belongs: on every reply it would be a drumbeat, and on an old one it would
// be about a number that has since moved.
const newest = (msg) => S.project?.messages?.at(-1)?.id === msg.id;

function footnote(msg) {
  const parts = [];
  if (msg.tokens) {
    const label = `${msg.tokens.toLocaleString()} tokens`;
    parts.push(msg.receipt
      ? h('button', {
        class: 'link',
        text: S.receipt?.id === msg.id ? `${label} — hide` : label,
        title: 'What this reply was given, and what it cost',
        onclick: () => toggleReceipt(msg),
      })
      : label);
  }
  if (msg.trimmed) {
    parts.push(msg.trimmed === 1
      ? 'did not see the first message'
      : `did not see the first ${msg.trimmed} messages`);
  }
  // Your own day, in the place the cost of a reply is already written. Shown
  // on the newest reply only, and only to the person whose day it is.
  const near = msg.agent_id !== null && newest(msg) ? nearQuota() : null;
  if (near) {
    parts.push(h('span', {
      class: 'low',
      text: near.left === 0
        ? 'that is all your tokens for today'
        : `${near.left.toLocaleString()} of your ${near.limit.toLocaleString()} tokens left today`,
    }));
  }
  if (parts.length === 0) return null;
  const children = [];
  parts.forEach((part, i) => {
    if (i > 0) children.push(' · ');
    children.push(part);
  });
  return h('div', { class: 'tokens' }, ...children);
}

/* The receipt --------------------------------------------------------------
   What one reply was given and what it cost, fetched when the token note is
   clicked and painted in the reply's own row. One open at a time; the same
   note closes it. */

async function toggleReceipt(msg) {
  if (S.receipt?.id === msg.id) {
    S.receipt = null;
    render();
    return;
  }
  const res = await send(`/api/messages/${msg.id}/receipt`);
  if (!res.ok) { say('Could not read what this reply was given.', true); return; }
  const { breakdown, prompt_held: promptHeld } = await res.json();
  S.receipt = { id: msg.id, breakdown, promptHeld };
  render();
}

async function openPrompt(id) {
  const res = await send(`/api/messages/${id}/prompt`);
  if (!res.ok) { say('The exact prompt is only kept for the newest reply.', true); return; }
  S.dialog = { kind: 'prompt', text: await res.text() };
  render();
}

function renderReceipt(msg, receipt) {
  const b = receipt.breakdown;
  const row = (label, value) => h('div', { class: 'rrow' },
    h('span', { text: label }), h('span', { class: 'rval', text: value }));

  const given = [];
  const sys = b.system ?? {};
  if (sys.preamble) given.push(row('the studio’s instructions', sizeText(sys.preamble)));
  if (sys.brief) {
    given.push(row('the project brief',
      sizeText(sys.brief) + (sys.brief_cut ? ' (cut for size)' : '')));
  }
  if (sys.description) given.push(row('who this helper is', sizeText(sys.description)));
  if (sys.files) {
    given.push(row('the game’s files',
      `${sizeText(sys.files.bytes)} — ${sys.files.shown} sent whole`
      + (sys.files.omitted ? `, ${sys.files.omitted} left out for size` : '')));
  }
  const t = b.transcript ?? {};
  if (t.messages) {
    given.push(row('the conversation',
      `${t.messages} message${t.messages === 1 ? '' : 's'}, ${sizeText(t.bytes)}`));
  }
  const extras = b.last_message ?? {};
  if (extras.errors) given.push(row('problems from playing the game', sizeText(extras.errors)));
  if (extras.pins) given.push(row('a note about pinned files', sizeText(extras.pins)));
  const loop = b.loop ?? {};
  if (loop.appended_bytes) {
    given.push(row('read and written while replying',
      `${sizeText(loop.appended_bytes)} over ${loop.tool_calls} tool call${loop.tool_calls === 1 ? '' : 's'}`));
  }

  const requests = b.requests ?? [];
  const cost = [];
  // Why the "remembered" column can drop between requests: the loop told the
  // model to let go of its earlier thinking to keep the bill down.
  if (loop.sheds) {
    cost.push(row('earlier thinking set aside',
      `${loop.sheds} time${loop.sheds === 1 ? '' : 's'}, to keep the cost down`));
  }
  cost.push(...requests.map((u, i) => row(
    requests.length === 1 ? 'one request' : `request ${i + 1}`,
    `${u.miss.toLocaleString()} new + ${u.hit.toLocaleString()} remembered in, ${u.out.toLocaleString()} out`,
  )));
  const charged = requests
    .reduce((n, u) => n + u.miss + Math.ceil(u.hit / 30) + u.out * 3, 0);
  if (requests.length) {
    cost.push(h('div', {
      class: 'rsum muted',
      text: `remembered tokens count a thirtieth and tokens out count three times, so this reply cost ${charged.toLocaleString()} tokens`,
    }));
  }

  return h('div', { class: 'receipt' },
    h('div', { class: 'rhead', text: `What ${agentName(msg.agent_id)} was given` }),
    ...given,
    cost.length ? h('div', { class: 'rhead', text: 'What it cost' }) : null,
    ...cost,
    receipt.promptHeld
      ? h('button', {
        class: 'link tiny', text: 'See everything that was sent',
        onclick: () => openPrompt(msg.id),
      })
      : h('div', {
        class: 'rsum muted',
        text: 'The exact prompt is only kept for the newest reply.',
      }));
}

/* Working ------------------------------------------------------------------
   What a helper said on the way to its reply — every turn's words but the
   last — folded above the bubble the way the trace is, and fetched when the
   panel is first opened: it can run to tens of kilobytes, so the thread does
   not carry it. Kept here, not on the message, so a render mid-read does
   not close the panel or fetch it twice. Bounded like the traces. */

const MAX_KEPT_WORKINGS = 20;
const workings = new Map();

function workingPanel(msg) {
  if (!msg.working) return null;
  let kept = workings.get(msg.id);
  if (!kept) {
    kept = { text: null, loading: false, open: false };
    workings.set(msg.id, kept);
    while (workings.size > MAX_KEPT_WORKINGS) workings.delete(workings.keys().next().value);
  }
  return h('details', {
    class: 'working',
    open: kept.open,
    ontoggle: (event) => {
      kept.open = event.currentTarget.open;
      if (kept.open && kept.text === null && !kept.loading) loadWorking(msg, kept);
    },
  },
  h('summary', { text: 'Working' }),
  h('div', { class: 'folded', text: kept.text ?? 'Reading…' }));
}

async function loadWorking(msg, kept) {
  kept.loading = true;
  const res = await send(`/api/messages/${msg.id}/working`);
  kept.loading = false;
  if (!res.ok) { say('Could not read what this helper said on the way.', true); return; }
  kept.text = await res.text();
  render();
}

/* Reactions -----------------------------------------------------------------
   An emoji a person puts on a message. The chips under a bubble are the
   reactions it has, each carrying who on its tooltip; + opens a fixed
   palette. A click is applied here first and the stream's echo lands on the
   same merge, which is idempotent — that is the whole correctness story for
   two tabs and a slow network. */

const REACTION_EMOJI = [
  '👍', '❤️', '😂', '🎉', '🔥', '👀', '✅', '🚀', '🤔', '😮',
  '😢', '🙏', '👋', '💪', '⭐', '🎮', '🤖', '🥳', '😍', '💡',
];

// The one merge for the optimistic click and the SSE echo alike. Adding
// somebody already there and removing somebody already gone are both no-ops,
// and an emoji whose last person leaves takes its chip with it.
export function applyReactionDelta(msg, {
  emoji, user_id: id, user_name: name, action,
}) {
  const list = msg.reactions ?? (msg.reactions = []);
  const entry = list.find((r) => r.emoji === emoji);
  if (action === 'add') {
    if (!entry) list.push({ emoji, users: [{ id, name }] });
    else if (!entry.users.some((u) => u.id === id)) entry.users.push({ id, name });
  } else if (entry) {
    entry.users = entry.users.filter((u) => u.id !== id);
    if (entry.users.length === 0) list.splice(list.indexOf(entry), 1);
  }
}

const myReaction = (msg, emoji) => (msg.reactions ?? [])
  .some((r) => r.emoji === emoji && r.users.some((u) => u.id === S.me.id));

async function toggleReaction(msg, emoji) {
  const action = myReaction(msg, emoji) ? 'remove' : 'add';
  const me = { user_id: S.me.id, user_name: S.me.display_name };
  applyReactionDelta(msg, { emoji, ...me, action });
  render();
  const res = await api('POST', `/api/messages/${msg.id}/reactions/toggle`, { emoji });
  if (!res.ok) {
    // Put it back the way it was — only your own reaction can have moved.
    applyReactionDelta(msg, { emoji, ...me, action: action === 'add' ? 'remove' : 'add' });
    render();
    say(res.body?.error ?? 'The reaction did not go through.', true);
  }
}

// The palette is open on one message at a time, held in state so a background
// render rebuilds it where it was. A click anywhere else closes it; the row's
// own buttons stop their clicks from counting as elsewhere.
document.addEventListener('click', () => {
  if (S.reactionPicker === null) return;
  S.reactionPicker = null;
  render();
});

function reactionsRow(msg) {
  const chips = (msg.reactions ?? []).map((r) => h('button', {
    class: `reaction${r.users.some((u) => u.id === S.me.id) ? ' mine' : ''}`,
    // Who, on the chip itself: the count says how many, this says which.
    title: r.users.map((u) => u.name).join(', '),
    onclick: (e) => { e.stopPropagation(); toggleReaction(msg, r.emoji); },
  }, `${r.emoji} `, h('span', { class: 'count', text: String(r.users.length) })));
  const palette = S.reactionPicker === msg.id
    ? h('div', { class: 'reaction-palette' },
      REACTION_EMOJI.map((emoji) => h('button', {
        text: emoji, title: 'React with this',
        onclick: (e) => {
          e.stopPropagation();
          S.reactionPicker = null;
          toggleReaction(msg, emoji);
        },
      })))
    : null;
  return h('div', { class: 'reactions' },
    chips,
    h('button', {
      class: 'reaction add', text: '+', title: 'React with an emoji',
      onclick: (e) => {
        e.stopPropagation();
        S.reactionPicker = S.reactionPicker === msg.id ? null : msg.id;
        render();
      },
    }),
    palette);
}

// A plan card: the Builder's one reply for a plan (spec.md §8) — a checklist
// that ticks as the pieces land, each line a piece's title, the files it
// changed and its headline. The words over it are the body's first line, and
// the list is the plan row, moved along by `plan.update`. A piece's own row
// lives behind the card and opens in its line.
function renderPlanCard(msg) {
  const plan = msg.plan;
  const pieces = plan?.pieces ?? [];
  const done = pieces.filter((p) => p.status === 'done').length;
  const state = {
    done: pieces.length === 1 ? 'Press play and tell me what breaks.' : 'All done — press play and tell me what breaks.',
    paused: `Paused with ${pieces.length - done} to go. Say “carry on” to keep going.`,
    dropped: 'Set aside.',
    running: pieces.length === 1 ? '' : `Working on piece ${Math.min(done + 1, pieces.length)} of ${pieces.length}`,
  }[plan?.status] ?? '';
  const live = S.live.get(msg.agent_id);
  return h('div', { class: 'msg from-agent' },
    h('div', { class: 'from', text: agentName(msg.agent_id) }),
    h('div', { class: `pieces ${plan?.status ?? ''}` },
      h('div', { class: 'pieces-head', text: msg.body.split('\n')[0] }),
      pieces.length ? h('ol', { class: 'pieces-list' }, pieces.map((p) => renderPiece(msg, p, live))) : null,
      state ? h('div', {
        class: `pieces-state${plan.status === 'running' ? ' dots' : ''}`, text: state,
      }) : null),
    reactionsRow(msg),
    footnote(msg));
}

// One line of the card. Done: the tick, the title, the files it changed, its
// headline, and `Details`, which opens the piece's own row in place — one at
// a time, the same link closing it. Running: the live reply, here rather than
// at the foot of the thread, so the entry is marked as placed and the thread
// leaves it out. To do: the title and the files it is to touch.
function renderPiece(card, p, live) {
  const open = S.pieceOpen?.id === p.message_id ? S.pieceOpen.msg : null;
  const running = p.status === 'running' && live ? live : null;
  if (running) running.placed = true;
  const files = p.writes?.length ? p.writes : (p.files ?? []);
  return h('li', { class: `piece ${p.status}` },
    h('span', { class: `piece-mark${running ? ' dots' : ''}`, text: p.status === 'done' ? '✓' : (running ? '' : '○') }),
    h('span', { class: 'piece-title' },
      h('span', { text: p.title }),
      p.message_id ? h('button', {
        class: 'link piece-open',
        text: S.pieceOpen?.id === p.message_id ? 'Hide' : 'Details',
        onclick: () => openPiece(p.message_id),
      }) : null),
    files.length ? h('span', { class: 'piece-files muted', text: files.join(', ') }) : null,
    p.note ? h('div', { class: 'piece-note', text: p.note }) : null,
    running ? h('div', { class: 'piece-live' }, renderLive(card.agent_id, running)) : null,
    open ? h('div', { class: 'piece-detail' }, renderMessage(open)) : null);
}

async function openPiece(id) {
  if (S.pieceOpen?.id === id) {
    S.pieceOpen = null;
    render();
    return;
  }
  S.pieceOpen = { id, msg: null };
  render();
  const res = await send(`/api/messages/${id}`);
  if (!res.ok) {
    S.pieceOpen = null;
    say('Could not open that piece.', true);
    return;
  }
  S.pieceOpen = { id, msg: await res.json() };
  render();
}

function renderMessage(msg) {
  if (msg.kind === 'system') {
    return h('div', { class: 'msg system' }, h('div', { class: 'bubble', text: msg.body }));
  }
  if (msg.kind === 'plan') return renderPlanCard(msg);
  const isAgent = msg.agent_id !== null;
  // Your own messages say "You" — a thread full of your own name reads like
  // somebody else's. Everyone else is called what they are called, and
  // "Someone" is left for a message whose account has gone.
  const who = isAgent
    ? agentName(msg.agent_id)
    : (msg.user_id === S.me.id ? 'You' : (msg.user_name ?? 'Someone'));

  const chips = [];
  for (const p of msg.context_paths ?? []) {
    chips.push(h('button', { class: 'chip pin', text: `📎 ${p}`, disabled: true }));
  }
  for (const w of msg.writes ?? []) {
    const marks = { create: '＋', update: '✎', delete: '✕' };
    chips.push(h('button', {
      class: `chip ${w.action}`,
      text: `${marks[w.action] ?? ''} ${w.path}`,
      title: 'See what changed',
      // The changes open inside their own row in the list, so the list has to
      // be there — arriving here from a chip used to skip loading it entirely.
      // Getting there is one move however many steps it takes, so it is one
      // entry in the history and it ends on the row it opened.
      onclick: async () => {
        await urlAs('hold', async () => {
          showMode('versions');
          render();
          if (historyNeedsLoad(null)) await loadHistory(null);
        });
        await loadDiff(w.commit_sha, { goTo: true });
      },
    }));
  }

  // Present only for a reply this tab watched arrive.
  const kept = S.traces.get(msg.id);
  const thinking = kept
    ? h('details', {
      class: 'thinking',
      open: kept.open,
      ontoggle: (event) => { kept.open = event.currentTarget.open; },
    },
    h('summary', { text: 'Thinking' }),
    h('div', { class: 'folded', text: kept.text }))
    : null;

  return h('div', { class: `msg ${isAgent ? 'from-agent' : 'from-human'}` },
    h('div', { class: 'from', text: who }),
    thinking,
    workingPanel(msg),
    msg.body && h('div', {
      class: 'bubble',
      style: tintStyle(isAgent, isAgent ? msg.agent_id : msg.user_id),
      text: msg.body,
    }),
    chips.length ? h('div', { class: 'chips' }, chips) : null,
    reactionsRow(msg),
    // What this reply cost, and what it could not see. Both visible rather
    // than hidden: a reply that carried on from itself three times costs three
    // times as much, and a reply written without the start of a long
    // conversation explains itself much better if you know that.
    footnote(msg),
    S.receipt?.id === msg.id ? renderReceipt(msg, S.receipt) : null);
}

function renderLive(agentId, entry) {
  // ⚠️ Whether to follow the newest thought is kept on the entry, not read
  // off the box: a full render mid-stream builds a fresh box at scrollTop 0,
  // and a box measured there looks scrolled-up when it is simply new — which
  // would pin the trace to its first ten lines for the rest of the reply.
  const trace = h('div', {
    class: 'folded',
    text: entry.trace,
    onscroll: (event) => {
      const box = event.currentTarget;
      entry.traceFollow = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    },
  });
  const thinking = h('details', {
    class: 'thinking',
    open: entry.open,
    ontoggle: (event) => { entry.open = event.currentTarget.open; },
  }, h('summary', { text: 'Thinking' }), trace);
  thinking.hidden = entry.trace === '';

  // What earlier turns said, folded away as they end (stream.js, agent.tool):
  // the bubble below holds only the latest thing said, so a long reply is a
  // short line that changes rather than a wall that grows.
  const working = h('div', { class: 'folded', text: entry.working });
  const workingPanel = h('details', {
    class: 'working',
    open: entry.workingOpen,
    ontoggle: (event) => { entry.workingOpen = event.currentTarget.open; },
  }, h('summary', { text: 'Working' }), working);
  workingPanel.hidden = entry.working === '';

  const reply = h('div', {
    class: 'bubble', style: tintStyle(true, agentId), text: entry.reply,
  });
  reply.hidden = entry.reply === '';

  const tool = h('div', {
    class: 'busy dots', text: toolLabel(entry.tool) || thinkingFor(entry),
  });

  entry.nodes = { trace, thinking, working, workingPanel, reply, tool };

  return h('div', { class: 'msg from-agent' },
    h('div', { class: 'from', text: agentName(agentId) }),
    thinking,
    workingPanel,
    reply,
    entry.error
      ? h('div', { class: 'busy error', text: 'Something went wrong. Try asking again.' })
      : tool);
}

// A send still in flight, or one that did not make it. Painted from S.pending
// rather than S.project.messages — the same reason a streaming reply is —
// so it survives however long the request takes and is never quietly
// dropped. A failed one stays exactly where it is and is pressed to try
// again, rather than being handed back into the composer to retype.
function renderPending(localId, entry) {
  const failed = entry.status === 'failed';
  const slug = S.slug;
  const chatId = S.chat.id;
  return h('div', {
    class: `msg from-human pending${failed ? ' failed' : ''}`,
    onclick: failed ? () => retrySend(slug, chatId, localId) : null,
  },
  h('div', { class: 'from', text: 'You' }),
  h('div', { class: 'bubble', style: tintStyle(false, S.me.id), text: entry.body }),
  h('div', {
    class: 'send-status',
    text: failed ? 'Could not send — tap to retry' : 'Sending…',
  }));
}

// A message only gets an answer if some agent attached to this project is
// eligible. Nothing in the interface used to say that, so an unanswered
// message looked like a broken app. Two distinct gaps, two distinct fixes.
function helperGap() {
  if (!S.project || frozen()) return null;
  // The human-only chat is not missing its helpers; it is the room without
  // them. Nothing is said about it: the chat is called Humans only, which is
  // the whole of the explanation, and a standing notice under a name that
  // already says it is furniture.
  if (S.chat && !S.chat.bots) return null;
  if (S.project.agents.length > 0) {
    // Attached, but every one of them is waiting to be called by name.
    if (S.project.agents.some((a) => a.chatty)) return null;
    const names = S.project.agents.map((a) => `@${a.name.split(' ')[0]}`).join(' or ');
    return h('div', { class: 'notice' },
      `Your helpers only answer when you call them. Try starting your message with ${names}, `,
      'or click a helper’s name at the top to make them always answer.');
  }
  // The chat, not the game: a helper is in one conversation, so this one
  // having nobody in it says nothing about the others.
  const where = S.chat ? `“${S.chat.name}”` : 'this chat';
  // With helpers in the studio the fix is in this room, so say where it is
  // rather than offering a link whose only job would be to open a sidebar
  // that is usually already open. Both ways in, because the second one — an @
  // and a name — is the one nothing on screen would ever tell you about.
  if (S.agents.length > 0) {
    return h('div', { class: 'notice' },
      `Nobody is in ${where} yet, so nobody will answer. `,
      'Press the + above to put one in, or type @ and their name.');
  }
  return h('div', { class: 'notice' },
    'Nobody can answer yet — the studio has no helpers. ',
    h('button', {
      class: 'link',
      text: 'Make your first helper',
      onclick: () => {
        S.narrowPane = 'games';
        S.sidebar = true;
        prefs.set('sidebar', 'open');
        // On the tab it will land on, so the new helper is where the eye goes
        // when the dialog closes.
        S.sideTab = 'crew';
        prefs.set('side-tab', 'crew');
        S.dialog = { kind: 'new-agent' };
        render();
      },
    }), '.');
}

// The one item in that ··· with no dialog behind it: nothing is lost by
// pressing it, and what it undoes was confirmed on the way in. Said here
// rather than learnt from the refetch, the way archiving says it, and then the
// game is reopened so every control it froze comes back.
async function unarchiveProject() {
  const res = await api('POST', `/api/projects/${S.slug}/unarchive`);
  if (!res.ok) { say(res.body?.error ?? 'Could not unarchive it.', true); return; }
  S.project.archived = false;
  // Unarchiving the game you are already in is not somewhere new to go Back
  // from, even though it changes what the bar offers.
  await urlAs('replace', () => openProject(S.slug));
}

// Everything you can do to the whole game, behind one ··· beside its name
// (spec.md §6). One menu per thing, in one order, and anything you may not
// press left out rather than greyed: Fork is everybody's; Rename, Editors,
// Publish and Add chat are an editor's; Archive is the originator's, and only
// while the game is unpublished. Nothing to offer, no ···.
// Every item asks in a dialog, so every item ends in an ellipsis — except
// Unarchive, which asks nothing because it undoes rather than does: pressed by
// mistake, Archive is right there again.
//
// Three of these were buttons at the end of the bar, and a drawer under the
// name before that. The rule that put them here is not the one that made the
// drawer — three buttons never needed hiding — but that every thing in the
// studio has one ···, and the game is a thing.
function renderMore(p) {
  const yours = Boolean(p.mine);
  const rooms = !isChat();
  const item = (text, kind, { danger = false, title = null } = {}) => ({
    text, title, danger, onPick: () => { S.dialog = { kind }; render(); },
  });
  return more('game', [
    !frozen() && item('Rename…', 'rename'),
    rooms && !p.archived && item('Fork…', 'fork', {
      title: 'Start a new game from a copy of this one',
    }),
    rooms && yours && item('Editors…', 'authors', {
      title: 'Who can change this game, and whether the whole studio can',
    }),
    rooms && yours && !p.archived && item(
      p.published ? 'Unpublish…' : 'Publish…', 'publish',
    ),
    rooms && !frozen() && S.chats.length < MAX_CHATS && item('Add chat…', 'new-chat', {
      title: 'Start another chat in this game',
    }),
    p.originator && !p.archived && !p.published && item('Archive…', 'archive', {
      danger: true, title: 'Put this game away — you can unarchive it again',
    }),
    p.originator && p.archived && {
      text: 'Unarchive', title: 'Bring this game back — everybody can change it again',
      danger: false, onPick: unarchiveProject,
    },
  ], { label: 'More about this game', small: false });
}

// The row of modes over the centre (spec.md §6, public/game-types.js): one
// pill per surface the centre can show, the chat first. A chat project is one
// room with nothing to switch to, so it has no row. The mark on Chat says
// somebody called you in a conversation behind whatever mode is up.
function renderModes(p) {
  const modes = modesFor(p);
  if (modes.length < 2) return null;
  // Chat carries the game's mark only while another surface is up: in front
  // of you it is being read, so there is nothing waiting to say.
  const away = (m) => m.id === 'chat' && S.mode !== 'chat';
  return h('div', { class: 'modes' }, modes.map((m) => h('button', {
    class: `mode${S.mode === m.id ? ' on' : ''}${away(m) && marked(p) ? ' marked' : ''}`,
    title: m.what,
    // ⚠️ Returned, not fired: Share reads before it shows (see syncUrl).
    onclick: () => openMode(m.id),
  }, m.label, away(m) ? readMark(p) : null)));
}

// One pill per conversation, and at the right the things that are about this
// conversation rather than about the game: the helpers listening in it, and
// the + that calls another in. Making another chat is the game's ···; this
// chat's own ··· sits after the pills, for the one you are in.
//
// ⚠️ The pills and the chips are each their own scroller. Two rows of helpers
// and a studio's worth of chats will not fit on a phone, and something has to
// give sideways rather than push the other off the end.
//
// Nothing here is ever greyed out: a button you cannot press is a question,
// and the answer — somebody else's game, an archived one, a room that takes
// no helpers — is not one a bar can give. What cannot be done is not offered.
export function renderChatTabs(p) {
  if (!S.chat) return null;
  // A helper's chip is its name, lit when it answers everything, and its ···:
  // whether it answers everything or waits to be called, and taking it out.
  // Both are a change to the game, so neither is offered on a game that is
  // archived or somebody else's — the server refuses them there, and a chip
  // that answers with a red banner is worse than a chip that stays still.
  // The Builder's chip has no ··· at all: nothing about it is anybody's.
  const first = (a) => a.name.split(' ')[0];
  const chips = p.agents.map((a) => h('span', { class: `hchip${a.chatty ? ' on' : ''}` },
    h('span', {
      class: 'hchip-name', text: a.name,
      title: a.builtin ? `${a.name} — the studio's own helper, always listening here`
        : a.chatty ? `${a.name} answers everything` : `${a.name} waits to be called by @${first(a)}`,
    }),
    frozen() || a.builtin ? null : more(`helper:${a.agent_id}`, [
      a.chatty
        ? { text: 'Wait to be called', title: `Answer only when somebody types @${first(a)}`, onPick: () => toggleChatty(a) }
        : { text: 'Answer everything', title: 'Answer every message in this chat', onPick: () => toggleChatty(a) },
      { text: 'Take out of this chat', danger: true, onPick: () => detachAgent(a) },
    ], { label: `More about ${a.name}` })));
  // A chat project is one room: there are no pills to switch between. Who is
  // listening in it is the whole of this row there.
  const rooms = !isChat();
  // Building is the Builder's room and takes no other helper (spec.md §8), so
  // like Humans only it offers no + and no rename: it is furniture, and the
  // words the studio uses for it.
  const addHelper = !frozen() && S.chat.bots && !S.chat.builder;
  if (!rooms && !addHelper && chips.length === 0) return null;
  return h('div', { class: 'chat-tabs' },
    rooms ? h('div', { class: 'pills' }, S.chats.map((c) => h('button', {
      class: `chat-tab${c.id === S.chat.id ? ' on' : ''}${c.bots ? '' : ' quiet-room'}`
        + `${marked(c) ? ' marked' : ''}`,
      title: c.builder ? `${c.name} — the Builder answers here`
        : c.bots ? `${c.name} — helpers can answer here` : `${c.name} — just the humans`,
      onclick: () => openChat(c.id),
    },
    c.name,
    // ⚠️ The only dot a pill wears. Humans only used to carry a second one
    // that never went away — it meant "no helper is listening here" — and a
    // dot that is always there says nothing, while reading as unread every
    // time. That room now says so with a dashed edge instead.
    // The mark on the game says somebody called you, or that something is
    // unread; this says in which conversation.
    readMark(c)))) : null,
    // The chat you are in. Humans only keeps its name — it is furniture, and
    // the words the studio uses for it — so it has nothing to offer and no ···.
    rooms && S.chat.bots && !S.chat.builder && !frozen() ? more(`chat:${S.chat.id}`, [
      { text: 'Rename…', onPick: () => { S.dialog = { kind: 'rename-chat', chat: S.chat }; render(); } },
    ], { label: `More about ${S.chat.name}` }) : null,
    h('div', { class: 'spacer' }),
    chips.length ? h('div', { class: 'hchips' }, chips) : null,
    // Outside the chips and never scrolled away with them: the way to add
    // somebody has to stay put whether the row holds nobody or nine.
    addHelper ? h('button', {
      class: 'hchip-add', text: '+',
      title: 'Put a helper in this chat', 'aria-label': 'Put a helper in this chat',
      onclick: () => { S.dialog = { kind: 'add-helper' }; render(); },
    }) : null);
}

export function renderChat() {
  const p = S.project;
  if (!p) {
    return h('div', { class: `pane chat${S.narrowPane === 'chat' ? ' show' : ''}` },
      h('div', { class: 'bar' },
        h('button', { class: 'quiet only-narrow', text: '☰ Games', onclick: () => { S.narrowPane = 'games'; render(); } }),
        !S.sidebar && h('button', {
          class: 'icon only-wide', text: '☰', title: 'Show games and helpers',
          onclick: () => { S.sidebar = true; prefs.set('sidebar', 'open'); render(); },
        }),
        h('div', { class: 'title', text: 'Unbridled Joy' })),
      h('div', { class: 'scroll pad muted' },
        h('p', { text: 'Pick a game on the left, or make a new one.' }),
        h('p', { text: 'Then ask a helper to build something and watch the files appear.' })));
  }

  // A live reply that is a running piece is drawn on its card's line
  // (renderPiece marks it placed); the rest go at the foot of the thread.
  for (const entry of S.live.values()) entry.placed = false;
  const items = p.messages.map(renderMessage);
  for (const [agentId, entry] of S.live) if (!entry.placed) items.push(renderLive(agentId, entry));
  for (const [localId, entry] of S.pending) items.push(renderPending(localId, entry));

  // chat.png, when the game has one, tiles behind the thread — on the
  // scroller rather than the messages, so it stays put while they move.
  const scroller = h('div', {
    class: `scroll${S.images.chat ? ' has-chat-image' : ''}`,
    style: S.images.chat ? `--chat-image:url(${S.images.chat})` : null,
    'data-scroll': 'chat',
    onscroll: (e) => {
      const el = e.currentTarget;
      S.autoscroll = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    },
  }, h('div', { class: 'messages' }, items));

  // ⚠️ The composer follows the chat, not the game — see canTalk().
  const talkable = canTalk();
  const box = composerBox;
  box.placeholder = p.archived
    ? 'This game is finished (archived).'
    : (talkable ? 'Ask for something…' : `Only ${p.name}’s editors can write here.`);
  box.disabled = !talkable;

  // Said only when there is something to say. The standing tip that used to
  // live here was a line of instructions under every message anybody ever
  // typed; what pinning is for is discoverable from the checkbox itself.
  const pinNote = !isChat() && S.pinned.size
    ? `Sending ${S.pinned.size} pinned file${S.pinned.size === 1 ? '' : 's'}.`
    : '';

  // Without an attached helper nothing is eligible to answer, and a message
  // just sits there. Say so before it happens rather than leaving silence to
  // be interpreted.
  const gap = helperGap();

  // A game starts open to the studio, so the lock is the news: this one is
  // its editors' alone. Set in the same dialog the padlock's own button
  // opens, which is where its meaning is explained.
  const locked = !isChat() && !p.open_edit;

  // The body of the pane is whatever the mode says (spec.md §6). The bar over
  // it and the row of modes stay whatever is showing; the chat's own row, the
  // thread and the composer are the chat mode's, and every other mode takes
  // their whole space the way the chat does.
  const body = S.mode === 'chat' ? null : renderModeBody();

  return h('div', { class: `pane chat${S.narrowPane === 'chat' ? ' show' : ''}` },
    // hero.png, when the game has one, backs the bar under a dark wash so the
    // name stays readable. An object URL, so nothing user-typed is in the style.
    h('div', {
      class: `bar${S.images.hero ? ' has-hero-image' : ''}`,
      style: S.images.hero ? `--hero-image:url(${S.images.hero})` : null,
    },
      h('button', { class: 'quiet only-narrow', text: '☰', onclick: () => { S.narrowPane = 'games'; render(); } }),
      !S.sidebar && h('button', {
        class: 'icon only-wide', text: '☰', title: 'Show games and helpers',
        onclick: () => { S.sidebar = true; prefs.set('sidebar', 'open'); render(); },
      }),
      // A status, not a control: it does not light up and it does not click.
      locked && h('span', {
        class: 'lock', text: '🔒', 'aria-label': 'Closed',
        title: `Only ${p.name}’s editors can change it`,
      }),
      h('div', { class: 'title', text: p.name }),
      p.archived && h('span', { class: 'tag', text: 'archived' }),
      h('div', { class: 'spacer' }),
      // State, not a control: whether the game is published. What changes it
      // is in the ··· and under Share.
      isChat() || p.archived ? null : h('span', {
        class: 'whisper',
        text: p.published ? 'published' : 'not published',
      }),
      renderMore(p),
      !isChat() && h('button', { class: 'quiet only-narrow', text: 'Preview', onclick: () => { S.narrowPane = 'rail'; render(); } })),
    renderModes(p),
    body ? null : renderChatTabs(p),
    body ?? scroller,
    // Send sits beside the box rather than under it: the strip it used to have
    // to itself was a whole row of studio for one button, and the box is wide
    // enough to give the width up.
    body ? null : h('div', { class: 'composer' },
      gap,
      pinNote ? h('div', { class: 'hint pins', text: pinNote }) : null,
      h('div', { class: 'say' },
        box,
        h('button', { class: 'filled', text: 'Send', disabled: !talkable, onclick: sendComposer }))));
}
