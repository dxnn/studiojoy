// The one live connection the studio holds open: the SSE stream, the
// per-chat buffers a streaming reply is held in while it arrives, and the
// dispatch of everything the server pushes onto it.

import {
  S, api, render, say, urlAs, hasEditor, loadProjects, loadMe, setConnected, sizeText,
} from './main.js';
import { dropArtIndex } from './story-guide.js';
import { applyReactionDelta } from './chat.js';
import { STORY_FILE, storyChanged, dropStageImages } from './story-form.js';
import { ADVENTURE_FILE, adventureChanged } from './adventure-form.js';
import { TRACK_FILE, trackChanged } from './track-form.js';
import { ACHIEVEMENTS_FILE } from './achievements-editor.js';
import { achievementsChanged } from './achievements-form.js';
import { stickToBottom } from './chats.js';
import {
  refreshFiles, ICON_IMAGE, CHAT_IMAGE, HERO_IMAGE, refreshIcon,
  loadReservedImages, openFile, countVersions,
} from './files.js';
import { LOOK_FILE, loadPalette } from './drawing.js';
import { loadHistory } from './history.js';
import { problemPanelLive, paintProblems } from './telemetry.js';
import { notifyMessage } from './notify.js';

/* Live events ------------------------------------------------------------- */

// ⚠️ An allow-list, and the reason a new event does nothing until it is
// named here: EventSource only delivers what has been subscribed to, so a
// handler added to onEvent below without a line in this list is dead code
// that looks alive.
const STREAM_EVENTS = [
  'project.new', 'project.updated', 'message.new', 'message.reaction',
  'agent.stream.start', 'agent.stream.reasoning', 'agent.stream.chunk',
  'agent.tool', 'agent.stream.end', 'files.changed', 'version.new', 'game.errors',
  'collection.changed', 'plan.update',
];

export function connectStream() {
  const stream = new EventSource('/api/stream');
  for (const name of STREAM_EVENTS) {
    stream.addEventListener(name, (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      onEvent(name, data);
    });
  }
  // EventSource reconnects on its own; a refetch on reopen keeps us honest
  // about anything missed while disconnected. It is also the one thing in the
  // studio that holds a connection open, so it is what says whether there is
  // one: `error` fires on the drop and on every retry after it, `open` when the
  // studio is back and the missed events have been asked for.
  stream.addEventListener('open', () => {
    setConnected(true);
    if (S.slug) refreshFiles();
  });
  stream.addEventListener('error', () => setConnected(false));
}

function mine(data) {
  return data.project_slug === S.slug;
}

// The same event, for the conversation on screen. A game's chats share a
// stream, so a reply streaming into one must not paint itself into another —
// and an event from before chats existed, or about the project rather than a
// chat, has no chat_id and belongs wherever it lands.
function here(data) {
  return mine(data) && (data.chat_id === undefined || data.chat_id === null
    || data.chat_id === S.chat?.id);
}

// Reasoning traces are never persisted (spec.md §8), so the copy held here is
// the only one there will ever be: it survives the message landing, and
// nothing else. Bounded, because a long session would otherwise hold every
// trace it ever streamed.
const MAX_KEPT_TRACES = 50;

function keepTrace(messageId, text, open) {
  if (messageId === undefined || messageId === null) return;
  // The reply landing changes nothing about the panel: open stays open,
  // closed stays closed. Nothing should move under someone reading it.
  S.traces.set(messageId, { text, open });
  while (S.traces.size > MAX_KEPT_TRACES) {
    S.traces.delete(S.traces.keys().next().value);
  }
}

// One buffer of streaming replies per game, held for the whole session: what
// an agent has said so far exists nowhere else until the fire ends, so
// switching games must not clear it, and an event for a game that is not on
// screen still lands in its buffer — it just paints nothing.
const liveBySlug = new Map();

// Keyed by chat, not by game: two conversations in one game can have a helper
// mid-reply at the same time, and one buffer for both would interleave them.
export function liveMapFor(slug, chatId = null) {
  const key = `${slug}:${chatId ?? ''}`;
  let map = liveBySlug.get(key);
  if (!map) {
    map = new Map();
    liveBySlug.set(key, map);
  }
  return map;
}

// A human message on its way out, same shape of buffer as liveBySlug: it has
// to survive a chat switch, because the send it is waiting on keeps running
// wherever it was fired from.
const pendingBySlug = new Map();

export function pendingMapFor(slug, chatId = null) {
  const key = `${slug}:${chatId ?? ''}`;
  let map = pendingBySlug.get(key);
  if (!map) {
    map = new Map();
    pendingBySlug.set(key, map);
  }
  return map;
}

function liveFor(slug, chatId, agentId) {
  const map = liveMapFor(slug, chatId);
  let entry = map.get(agentId);
  if (!entry) {
    entry = {
      reply: '', working: '', trace: '', tool: null, error: false, nodes: null,
      open: false, workingOpen: false, startedAt: Date.now(),
    };
    map.set(agentId, entry);
  }
  return entry;
}

// ⚠️ Streamed text is painted at most once a frame, never per delta. Reasoning
// deltas arrive ~90 a second and a full-effort trace runs to tens of thousands
// of characters; repainting the whole box on each one — then reading
// scrollHeight, which reflows the text just replaced — costs more the longer
// the trace gets, and froze the page right as a long think reached the
// thinking cap. Deltas accumulate on the entry the moment they land; only the
// painting waits for the next frame, so nothing is lost, and a hidden tab
// simply paints everything at once when it is next shown.
function paintSoon(entry, key, paint) {
  entry.queued ??= {};
  if (entry.queued[key]) return;
  entry.queued[key] = true;
  requestAnimationFrame(() => {
    entry.queued[key] = false;
    // Reread at fire time: a render mid-stream builds fresh nodes, and the
    // stream ending detaches them — either way this paints what is current.
    if (entry.nodes) paint(entry);
  });
}

function paintTrace(entry) {
  const box = entry.nodes.trace;
  // ⚠️ The box is a few lines tall and a trace runs to hundreds. Left
  // alone it shows the first ten lines for as long as the helper thinks,
  // which is what made a working nine-minute reply look like a stopped
  // one. Stick it to the newest thought — unless somebody has scrolled
  // up to read, in which case leave them where they are.
  box.textContent = entry.trace;
  if (entry.traceFollow !== false) box.scrollTop = box.scrollHeight;
  entry.nodes.thinking.hidden = false;
  // The dots line says how long, from the deltas themselves rather than
  // a timer: they arrive ~90 a second while it thinks, so this ticks on
  // its own and stops when the thinking does.
  entry.nodes.tool.textContent = toolLabel(entry.tool) || thinkingFor(entry);
}

function paintReply(entry) {
  entry.nodes.reply.textContent = entry.reply;
  entry.nodes.reply.hidden = false;
  // Words arriving are the model talking again, so the line under the name
  // goes back to the count — a chunk cleared whatever tool it named.
  entry.nodes.tool.textContent = toolLabel(entry.tool) || thinkingFor(entry);
  stickToBottom();
}

// A turn ended on a tool call: the line under the name says which, and what
// the turn said moves from the bubble into the working panel. Painted in
// place for the same reason the reply is — a render mid-stream would rebuild
// the preview and restart the game.
function paintTool(entry) {
  const { nodes } = entry;
  nodes.tool.textContent = toolLabel(entry.tool);
  nodes.working.textContent = entry.working;
  nodes.workingPanel.hidden = entry.working === '';
  nodes.working.scrollTop = nodes.working.scrollHeight;
  nodes.reply.textContent = entry.reply;
  nodes.reply.hidden = entry.reply === '';
}

// A message landing, from wherever it came from: the SSE broadcast, or —
// for your own send — the POST response, painted in the moment it comes
// back rather than waiting on the stream to echo it. Whichever arrives
// second is a no-op: the push below is guarded by id.
export function applyMessage(data) {
  // The finished message replaces whatever was streaming from that agent
  // — in whichever game it is in — but its reasoning moves across rather
  // than vanishing: it is never saved, so this session is the only place
  // it will ever exist.
  if (data.agent_id !== null) {
    const map = liveMapFor(data.project_slug, data.chat_id);
    const entry = map.get(data.agent_id);
    if (entry?.trace) keepTrace(data.id, entry.trace, entry.open === true);
    map.delete(data.agent_id);
  }
  // Whoever said it and wherever it landed, the line under the game's name in
  // the sidebar now says this. It moves nothing: talk is not a change.
  const row = S.projects.find((p) => p.slug === data.project_slug);
  if (row) row.preview = data.body.slice(0, 80);
  // A piece's row lands behind its plan card (spec.md §8): the card's own
  // update carries what the thread shows of it, so this adds nothing to the
  // thread and marks nothing unread — the card did that when it arrived.
  if (data.plan_message_id) {
    if (here(data)) render();
    return;
  }
  // Somebody other than you said something. Where it landed decides what
  // happens to it: in the chat you are looking at it is already read, and
  // anywhere else — the chat behind an editor included — it leaves a mark
  // on that game and on that chat's pill until you go and look: the @n
  // badge when it named you, otherwise the plain unread flag. And, if the
  // studio is not the thing on screen, a notification — the same decision,
  // so it is made here rather than a second time somewhere else
  // (notify.js, ideas/notifications.md).
  if (data.user_id !== S.me?.id) {
    if (here(data) && S.mode === 'chat') {
      api('POST', `/api/projects/${data.project_slug}/chats/${data.chat_id}/seen`);
    } else {
      notifyMessage(data);
      const named = data.mentions?.includes(S.me?.id);
      if (row) {
        row.unread = true;
        if (named) row.mentions = (row.mentions ?? 0) + 1;
      }
      if (mine(data)) {
        const chat = S.chats.find((c) => c.id === data.chat_id);
        if (chat) {
          chat.unread = true;
          if (named) chat.mentions = (chat.mentions ?? 0) + 1;
        }
        if (S.project) {
          S.project.unread = true;
          if (named) S.project.mentions = (S.project.mentions ?? 0) + 1;
        }
      }
      render();
    }
  }
  if (!here(data)) return;
  // Helpers the message called in by name. Merged rather than refetched,
  // for the same reason attaching one from the Crew tab is: a refetch
  // would throw away the open file, the pins and anything mid-stream.
  for (const called of data.joined ?? []) {
    if (S.project.agents.some((a) => a.agent_id === called.id)) continue;
    const known = S.agents.find((a) => a.id === called.id);
    S.project.agents.push({
      agent_id: called.id,
      name: called.name,
      reasoning: known?.reasoning,
      file_tools: known?.file_tools,
      // Called for one thing, not signed up to answer everything.
      chatty: false,
      responding: false,
    });
  }
  if (data.joined?.length) S.project.agents.sort((a, b) => a.name.localeCompare(b.name));
  // Guarded by id: your own send may already have painted this from the POST
  // response, and the broadcast that follows is the same message again.
  if (!S.project.messages.some((m) => m.id === data.id)) S.project.messages.push(data);
  render();
  // A reply costs somebody their allowance, and if that somebody is you,
  // the line under it should say so. Only worth asking when you have an
  // allowance at all.
  if (data.agent_id !== null && S.me?.daily_tokens) loadMe().then(render);
}

function onEvent(name, data) {
  switch (name) {
    case 'project.new':
    case 'project.updated':
      loadProjects().then(render);
      if (mine(data) && S.project) {
        S.project.name = data.name ?? S.project.name;
        if (data.archived !== undefined) S.project.archived = data.archived;
        if (data.scores_on !== undefined) S.project.scores_on = data.scores_on;
        if (data.stage !== undefined) S.project.stage = data.stage;
        render();
      }
      return;

    case 'message.new':
      applyMessage(data);
      return;

    case 'message.reaction': {
      // A change to a message on screen, or to nothing: a conversation that is
      // not showing gets its reactions with its messages when it loads. Your
      // own click already applied this delta, and the merge shrugs at seeing
      // it again.
      if (!here(data)) return;
      const msg = S.project?.messages.find((m) => m.id === data.message_id);
      if (!msg) return;
      applyReactionDelta(msg, data);
      render();
      return;
    }

    case 'agent.stream.start': {
      liveMapFor(data.project_slug, data.chat_id).set(data.agent_id, {
        reply: '', working: '', trace: '', tool: null, error: false, nodes: null,
        open: false, workingOpen: false, startedAt: Date.now(),
      });
      if (here(data)) render();
      return;
    }

    case 'agent.stream.reasoning': {
      const entry = liveFor(data.project_slug, data.chat_id, data.agent_id);
      entry.trace += data.delta;
      // Thinking again: whatever the line named — a file being written, the
      // sizing call — is over, and the count takes the line back.
      entry.tool = null;
      if (!here(data)) return;
      if (entry.nodes) paintSoon(entry, 'trace', paintTrace);
      else render();
      return;
    }

    case 'agent.stream.chunk': {
      const entry = liveFor(data.project_slug, data.chat_id, data.agent_id);
      entry.reply += data.delta;
      entry.tool = null;
      if (!here(data)) return;
      if (entry.nodes) paintSoon(entry, 'reply', paintReply);
      else render();
      return;
    }

    case 'agent.tool': {
      const entry = liveFor(data.project_slug, data.chat_id, data.agent_id);
      // Sent as a call begins to arrive, every so often with how much of it
      // has, and again as it runs; and once for the builder's sizing call,
      // which is not a tool but streams nothing either (spec.md §9).
      entry.tool = { name: data.tool, path: data.path ?? null, bytes: data.bytes ?? null };
      // A tool call ends a turn, and what the turn said ahead of it was said
      // on the way, not to the person: fold it into the working panel, so
      // the bubble holds the latest thing said and never grows into a wall.
      // The same cut the server makes when the reply lands (spec.md §8).
      if (entry.reply) {
        entry.working += entry.working ? `\n\n${entry.reply}` : entry.reply;
        entry.reply = '';
      }
      if (!here(data)) return;
      if (entry.nodes) paintTool(entry);
      else render();
      return;
    }

    case 'agent.stream.end': {
      if (data.error) {
        // Kept, not painted: coming back to this game should still show that
        // its helper hit a wall.
        const entry = liveFor(data.project_slug, data.chat_id, data.agent_id);
        entry.error = true;
        entry.tool = null;
      } else if (!data.message_id) {
        // Nothing was written and nothing said.
        liveMapFor(data.project_slug, data.chat_id).delete(data.agent_id);
      }
      if (here(data)) render();
      return;
    }

    case 'plan.update': {
      // The checklist on a plan card moving along (spec.md §8). The card is an
      // ordinary message in the rendered tree, so a render is the repaint; a
      // card in a chat that is not on screen gets its state when that loads.
      if (!here(data)) return;
      const msg = S.project?.messages.find((m) => m.id === data.message_id);
      if (!msg) return;
      msg.plan = data.plan;
      // The card's body is rewritten as pieces land — it is the plan's reply —
      // and its token note is their cost so far.
      if (data.body) msg.body = data.body;
      msg.tokens = data.tokens;
      render();
      return;
    }

    case 'game.errors': {
      if (!mine(data)) return;
      // The server sends the whole current list, so there is nothing to merge.
      S.errors = data.errors;
      // Never a full render: rebuilding the tree rebuilds the preview iframe,
      // which restarts the game, which reports its problems again — a loop
      // that never settles. Same reason a streaming reply mutates its nodes.
      if (problemPanelLive()) paintProblems();
      else render();
      return;
    }

    // Somebody put a picture in the studio's collection, or took one out.
    // Every shelf everywhere reads the same list, so every tab drops its
    // copy — not only the tab that did it, and not only this game's.
    case 'collection.changed':
      dropArtIndex();
      render();
      return;

    case 'files.changed': {
      // Any game's icon: the sidebar wears them all, so this one is looked at
      // before the guard that keeps the rest to the open game.
      if (data.paths.includes(ICON_IMAGE)) refreshIcon(data.project_slug);
      // Any game's row moves up its group: the tree changed, which is what the
      // list sorts on (sidebar.js). This tab's clock, and now is newest.
      const row = S.projects.find((p) => p.slug === data.project_slug);
      if (row) row.updated_at = new Date().toISOString();
      if (!mine(data)) { render(); return; }
      // A new wallpaper or hero redresses the studio, and the loader reads
      // S.files for what exists — so the tree has to land first. The story
      // editor reads it the same way, and its stage drops the pictures that
      // moved so the next paint fetches them again.
      const tree = refreshFiles();
      if (data.paths.includes(CHAT_IMAGE) || data.paths.includes(HERO_IMAGE)) {
        tree.then(loadReservedImages).then(render);
      }
      if (hasEditor('story') && data.paths.includes(STORY_FILE)) tree.then(storyChanged);
      if (hasEditor('adventure') && data.paths.includes(ADVENTURE_FILE)) tree.then(adventureChanged);
      if (hasEditor('track') && data.paths.includes(TRACK_FILE)) tree.then(trackChanged);
      if (S.achievements && data.paths.includes(ACHIEVEMENTS_FILE)) tree.then(achievementsChanged);
      dropStageImages(data.paths);
      // A helper changing the game's colours retints the studio. Not while
      // there are unsaved ones in the editor: re-reading would throw those
      // away, and they are on their way into this same file.
      if (data.paths.includes(LOOK_FILE) && !S.palette?.dirty) loadPalette().then(render);
      // Somebody just rewrote the game; show the new bytes. A save's own write
      // arrives this way too, before its commit does, so the preview follows
      // the tree and not history (spec.md §5).
      S.previewNonce += 1;
      // Those problems belonged to the bytes that were just replaced. The
      // reload below re-runs the game, and anything still broken says so
      // again.
      S.errors = [];
      if (S.open && data.paths.includes(S.open.path)) {
        if (S.open.dirty || S.draw?.dirty || S.sound?.dirty) {
          say(`${S.open.path} changed while you were working on it. What you have is still here — saving will ask before overwriting.`);
        } else if (Date.now() - (S.open.savedAt ?? 0) > 5000) {
          // Somebody else's write: re-read the file. Our own save's write
          // arrives this way too, and re-opening on that would restart the
          // pixel editor — undo history and all — every two seconds.
          openFile(S.open.path);
        }
      }
      render();
      return;
    }

    case 'version.new': {
      if (!mine(data)) return;
      // A commit landed — a run of saves after its quiet, a helper's turn, a
      // restore — so the versions list is behind. Reload it if it is on
      // screen; otherwise let opening the tab do it. In replace mode: a commit
      // landing is not somewhere the reader navigated to, and every one would
      // otherwise leave an entry behind.
      S.historyStale = true;
      if (S.mode === 'versions') urlAs('replace', () => loadHistory(S.historyPath));
      // The open file has one more version than it had a moment ago —
      // including when this is the commit our own saves just became.
      if (S.open && data.paths.includes(S.open.path)) countVersions();
      return;
    }

    default:
  }
}

// How long this helper has been thinking, for the line under its name. A
// count rather than a spinner: at the ceiling a trace can run for minutes, and
// "thinking" alone says nothing about whether anything is still happening.
export function thinkingFor(entry) {
  if (!entry?.startedAt) return '';
  const seconds = Math.floor((Date.now() - entry.startedAt) / 1000);
  if (seconds < 5) return 'thinking';
  if (seconds < 60) return `thinking, ${seconds}s`;
  return `thinking, ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// What the helper is doing instead of talking, in plain words: the tool and
// its file, with how much of the file has arrived while it is still coming.
export function toolLabel(tool) {
  if (!tool) return '';
  const words = {
    write_file: 'writing', patch_file: 'editing',
    read_file: 'reading', delete_file: 'deleting',
    // Not a tool: the builder's sizing call, one whole answer with nothing to
    // stream (spec.md §8).
    size: 'working out how big this is',
  };
  const doing = [words[tool.name] ?? tool.name, tool.path].filter(Boolean).join(' ');
  return tool.bytes ? `${doing}, ${sizeText(tool.bytes)}` : doing;
}
