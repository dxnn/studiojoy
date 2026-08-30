// The chat pane: the thread, a streaming reply's live nodes, the tint on a
// bubble, and the composer's surroundings. The composer node itself and the
// sending of a message stay in main.js — the box outlives every render, and
// what happens to unsent words is state the whole studio shares.

import { h } from './dom.js';
import {
  S, render, prefs, isChat, agentName, toolLabel, urlAs,
  loadHistory, loadDiff, historyNeedsLoad, toggleChatty, detachAgent,
  composerBox, sendComposer, send, say, sizeText, setPublished,
} from './main.js';

/* Render: chat ------------------------------------------------------------ */

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
    .reduce((n, u) => n + u.miss + Math.ceil(u.hit / 10) + u.out, 0);
  if (requests.length) {
    cost.push(h('div', {
      class: 'rsum muted',
      text: `remembered tokens count a tenth, so this reply cost ${charged.toLocaleString()} tokens`,
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

function renderMessage(msg) {
  if (msg.kind === 'system') {
    return h('div', { class: 'msg system' }, h('div', { class: 'bubble', text: msg.body }));
  }
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
          S.tab = 'versions';
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
    h('div', { class: 'trace', text: kept.text }))
    : null;

  return h('div', { class: `msg ${isAgent ? 'from-agent' : 'from-human'}` },
    h('div', { class: 'from', text: who }),
    thinking,
    msg.body && h('div', {
      class: 'bubble',
      style: tintStyle(isAgent, isAgent ? msg.agent_id : msg.user_id),
      text: msg.body,
    }),
    chips.length ? h('div', { class: 'chips' }, chips) : null,
    // What this reply cost, and what it could not see. Both visible rather
    // than hidden: a reply that carried on from itself three times costs three
    // times as much, and a reply written without the start of a long
    // conversation explains itself much better if you know that.
    footnote(msg),
    S.receipt?.id === msg.id ? renderReceipt(msg, S.receipt) : null);
}

function renderLive(agentId, entry) {
  const trace = h('div', { class: 'trace', text: entry.trace });
  const thinking = h('details', {
    class: 'thinking',
    open: entry.open,
    ontoggle: (event) => { entry.open = event.currentTarget.open; },
  }, h('summary', { text: 'Thinking' }), trace);
  thinking.hidden = entry.trace === '';

  const reply = h('div', {
    class: 'bubble', style: tintStyle(true, agentId), text: entry.reply,
  });
  reply.hidden = entry.reply === '';

  const tool = h('div', { class: 'working dots', text: toolLabel(entry.tool) });

  entry.nodes = { trace, thinking, reply, tool };

  return h('div', { class: 'msg from-agent' },
    h('div', { class: 'from', text: agentName(agentId) }),
    thinking,
    reply,
    entry.error
      ? h('div', { class: 'working error', text: 'Something went wrong. Try asking again.' })
      : tool);
}

// A message only gets an answer if some agent attached to this project is
// eligible. Nothing in the interface used to say that, so an unanswered
// message looked like a broken app. Two distinct gaps, two distinct fixes.
function helperGap() {
  if (!S.project || S.project.archived) return null;
  if (S.project.agents.length > 0) {
    // Attached, but every one of them is waiting to be called by name.
    if (S.project.agents.some((a) => a.chatty)) return null;
    const names = S.project.agents.map((a) => `@${a.name.split(' ')[0]}`).join(' or ');
    return h('div', { class: 'notice' },
      `Your helpers only answer when you call them. Try starting your message with ${names}, `,
      'or click a helper’s name at the top to make them always answer.');
  }
  const where = isChat() ? 'chat' : 'game';
  // With helpers in the studio the fix is one click in the sidebar, so say
  // that rather than offering a link whose only job would be to open a
  // sidebar that is usually already open.
  if (S.agents.length > 0) {
    return h('div', { class: 'notice' },
      `This ${where} has no helpers in it yet, so nobody will answer. `,
      'Add a helper by clicking them in the sidebar.');
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
        S.sideTab = 'helpers';
        prefs.set('side-tab', 'helpers');
        S.dialog = { kind: 'new-agent' };
        render();
      },
    }), '.');
}

// What you can do to the whole game, folded away under its name. These used to
// sit at the foot of the Play tab, which put them under the preview of a game
// you were in the middle of playing, and out of reach from every other tab.
//
// Closed, the drawer is zero-height rather than absent: it animates open, and
// a node that is not there cannot transition. It closes when the game changes,
// because it is a decision about the game you were looking at.
function renderActs(p) {
  const listed = Boolean(p.published);
  return h('div', { class: `acts${S.actsOpen ? ' open' : ''}` },
    h('button', {
      class: 'act fork',
      text: 'Make a copy',
      title: 'Start a new game from a copy of this one',
      disabled: p.archived,
      onclick: () => { S.dialog = { kind: 'fork' }; render(); },
    }),
    h('button', {
      class: `act publish${listed ? ' on' : ''}`,
      title: 'The games list is the page everyone sees at the games address',
      onclick: () => setPublished(!listed),
    }, h('span', { class: 'dot' }), listed ? 'Take out of the list' : 'Put in the list'),
    h('span', {
      class: `state${listed ? ' live' : ''}`,
      text: listed ? 'In the games list' : 'Only people with the link',
    }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'act',
      text: 'Rename',
      onclick: () => { S.dialog = { kind: 'rename' }; render(); },
    }));
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
        h('div', { class: 'title', text: 'Game Studio' })),
      h('div', { class: 'scroll pad muted' },
        h('p', { text: 'Pick a game on the left, or make a new one.' }),
        h('p', { text: 'Then ask a helper to build something and watch the files appear.' })));
  }

  const items = p.messages.map(renderMessage);
  for (const [agentId, entry] of S.live) items.push(renderLive(agentId, entry));

  const scroller = h('div', {
    class: 'scroll',
    'data-scroll': 'chat',
    onscroll: (e) => {
      const el = e.currentTarget;
      S.autoscroll = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    },
  }, h('div', { class: 'messages' }, items));

  const box = composerBox;
  box.placeholder = p.archived ? 'This game is finished (archived).' : 'Ask for something…';
  box.disabled = p.archived;

  // A chat has no files, so it has nothing to pin and no tip to give.
  let pinNote = '';
  if (!isChat()) {
    pinNote = S.pinned.size
      ? `Sending ${S.pinned.size} pinned file${S.pinned.size === 1 ? '' : 's'}.`
      : 'Tip: pin a file on the right to point at it.';
  }

  // Without an attached helper nothing is eligible to answer, and a message
  // just sits there. Say so before it happens rather than leaving silence to
  // be interpreted.
  const gap = helperGap();

  // One chip per helper in this game: the name toggles between answering
  // everything and waiting to be called, the ✕ takes them out.
  const chips = p.agents.map((a) => h('span', { class: `hchip${a.chatty ? ' on' : ''}` },
    h('button', {
      class: 'hchip-name', text: a.name, disabled: p.archived,
      title: a.chatty
        ? `${a.name} answers everything — click to make them wait for @${a.name.split(' ')[0]}`
        : `${a.name} waits to be called — click to make them answer everything`,
      onclick: () => toggleChatty(a),
    }),
    h('button', {
      class: 'hchip-x', text: '✕', disabled: p.archived,
      title: `Take ${a.name} out of this game`,
      onclick: () => detachAgent(a),
    })));

  return h('div', { class: `pane chat${S.narrowPane === 'chat' ? ' show' : ''}` },
    h('div', { class: 'bar' },
      h('button', { class: 'quiet only-narrow', text: '☰', onclick: () => { S.narrowPane = 'games'; render(); } }),
      !S.sidebar && h('button', {
        class: 'icon only-wide', text: '☰', title: 'Show games and helpers',
        onclick: () => { S.sidebar = true; prefs.set('sidebar', 'open'); render(); },
      }),
      // The name is the way into the game's own actions — the ones that are
      // about the whole game rather than the conversation. A chat has none of
      // them, so its name is just a name.
      isChat()
        ? h('div', { class: 'title', text: p.name })
        : h('button', {
          class: 'title',
          'aria-expanded': S.actsOpen ? 'true' : 'false',
          title: S.actsOpen ? 'Hide what you can do with this game' : 'What you can do with this game',
          onclick: () => { S.actsOpen = !S.actsOpen; render(); },
        }, h('span', { class: 'label', text: p.name })),
      h('button', {
        class: 'icon tiny', text: '✎', title: 'Rename this game',
        onclick: () => { S.dialog = { kind: 'rename' }; render(); },
      }),
      p.archived && h('span', { class: 'tag', text: 'archived' }),
      chips.length ? h('div', { class: 'hchips' }, chips) : null,
      h('div', { class: 'spacer' }),
      !isChat() && h('button', { class: 'quiet only-narrow', text: 'Files', onclick: () => { S.narrowPane = 'rail'; render(); } }),
      p.archived && h('button', {
        class: 'quiet tiny', text: 'Reopen',
        title: 'Start working on this again',
        onclick: () => { S.dialog = { kind: 'archive' }; render(); },
      })),
    isChat() ? null : renderActs(p),
    scroller,
    h('div', { class: 'composer' },
      gap,
      box,
      h('div', { class: 'row' },
        h('span', { class: 'hint', text: pinNote }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'filled', text: 'Send', disabled: p.archived, onclick: sendComposer }))));
}
