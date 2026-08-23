// Game Studio — the client's core. Vanilla, no build step, no framework.
// Structural changes re-render a pane; streaming text mutates live nodes in
// place so a long reply doesn't rebuild the thread on every chunk.
//
// This file holds what everything else leans on — the state, the transport,
// the URL, the stream, and the file, drawing and history actions — plus
// render(), which composes the panes that live in the modules beside it:
// dom.js, sidebar.js, chat.js, versions.js, config-form.js, dialogs.js,
// upload.js.

import { parseConfigFile, literalFor, spliceValue } from './config-file.js';
import { soundFrom } from './sound-maker.js';
import {
  PALETTE, BRUSHES, MAX_SIDE, UNDO_BYTES, CLEAR,
  blankPicture, pictureFrom, pixelAt, drawLine, floodFill,
  beginStep, endStep, applyStep, stepBytes,
  rgbaOf, hexOf, isColour,
} from './pixel-editor.js';
import { h, iconButton } from './dom.js';
import {
  ASSET_DIR, assetPath, writeFiles, openUpload, makeDropTarget, isFileDrag,
} from './upload.js';
import { isConfigPath, renderConfigForm } from './config-form.js';
import { tokenize, langFor } from './highlight.js';
import { renderVersionsTab } from './versions.js';
import { renderChat } from './chat.js';
import { renderSidebar } from './sidebar.js';
import { dialogFor } from './dialogs.js';

const root = document.getElementById('root');

/* Saved preferences -------------------------------------------------------- */

// Layout is a per-person, per-device choice, so it lives in localStorage
// rather than in the database.
export const prefs = {
  get(key, fallback) {
    try { return localStorage.getItem(`gs.${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`gs.${key}`, String(value)); } catch { /* private mode */ }
  },
};

const RAIL_MIN = 280;
const RAIL_MAX = 900;

// The rail may never squeeze the chat below a readable width, whatever is
// stored or dragged.
function railClamp(px) {
  const max = Math.max(RAIL_MIN, Math.min(RAIL_MAX, window.innerWidth - 420));
  return Math.min(max, Math.max(RAIL_MIN, Number.isFinite(px) ? px : 360));
}

/* State ------------------------------------------------------------------- */

export const S = {
  me: null,
  loading: true,
  authError: null,
  projects: [],
  agents: [],
  slug: null,
  project: null,
  files: [],
  // What the game said when it ran, for the version of the files on disk now.
  errors: [],
  pinned: new Set(),
  tab: 'files',
  open: null, // {path, content, etag, dirty, conflict}
  // Set only while the open file is being drawn on, and thrown away with it:
  // {picture, undo, dirty}
  draw: null,
  // Which tool, how wide and which colours are a person's choice, not the
  // file's, so they outlive opening a different picture — and outlive the file
  // being re-read underneath the editor, which a save itself causes.
  //
  // `slot` is which colour square is chosen. The colours themselves are the
  // game's, not this browser's — see S.palette.
  drawPrefs: { tool: 'pencil', brush: 1, slot: 0 },
  // What the studio offers and what this game already has, so the Controls
  // button can say "update", or say nothing at all when there is nothing to do.
  libraries: { studio: null, game: {} },
  // The open project's colours, read from its own config/look.js so that
  // changing one is a change to the game with a version behind it, rather than
  // a setting that lives in whichever browser happened to make it.
  // {colours, text, from} — text is null when the game has no look.js yet.
  palette: null,
  // Why a picture is not open for drawing on, when it is not.
  drawRefused: null,
  history: [],
  diff: null,
  historyPath: null,
  // Set when a commit lands, so the versions list reloads instead of showing
  // whatever it happened to fetch first.
  historyStale: false,
  drafts: new Map(), // slug -> unsent composer text
  live: new Map(), // agent_id -> {reply, trace, tool, error, nodes}
  traces: new Map(), // message_id -> {text, open}; this session only
  dialog: null,
  banner: null,
  // A state, not an event: false from the moment something fails to reach the
  // studio until the live stream is back. A banner would time out and leave
  // somebody typing into a studio that cannot hear them.
  connected: true,
  previewNonce: 0,
  autoscroll: true,
  narrowPane: 'chat',
  sidebar: prefs.get('sidebar', 'open') !== 'closed',
  railWidth: railClamp(Number(prefs.get('rail', '360'))),
  // true = expanded. The game list is always shown; the two small sections
  // under it fold away.
  sections: {
    chats: prefs.get('sec-chats', 'open') !== 'closed',
    helpers: prefs.get('sec-helpers', 'open') !== 'closed',
  },
};

// The composer is built once and reused by every render. render() replaces
// the whole tree, and an agent starting a reply, finishing one, or touching a
// file all trigger one — a textarea rebuilt each time would throw away
// whatever was being typed. Keeping the node keeps the text.
export const composerBox = h('textarea', {
  onkeydown: (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendComposer();
    }
  },
  oninput: () => { if (S.slug) S.drafts.set(S.slug, composerBox.value); },
});

export async function sendComposer() {
  const text = composerBox.value.trim();
  if (!text) return;
  // Emptied on the way out so the thread does not look stuck, but the words are
  // the one thing in the studio that git cannot get back, so a send that fails
  // gives them back rather than swallowing them.
  const slug = S.slug;
  composerBox.value = '';
  S.drafts.delete(slug);
  S.autoscroll = true;
  if (await sendMessage(text)) return;

  // Back where they were typed: into the box if that is still this game and
  // nothing newer has been typed into it, and otherwise into that game's
  // draft — never over the top of something newer.
  if (S.slug === slug && !composerBox.value) {
    composerBox.value = text;
    S.drafts.set(slug, text);
  } else if (!S.drafts.has(slug)) {
    S.drafts.set(slug, text);
  }
}

// The node surviving is not enough: removing it from the document blurs it
// and drops the caret. Both are put back after the tree is rebuilt.
const EDITOR_AREA = 'editor-area';

function focusSnapshot() {
  const el = document.activeElement;
  // A control inside the open dialog survives render() by identity — the
  // dialog node is re-appended, never rebuilt — so the element itself is the
  // way back to it. Only text fields have a selection to keep; a select, a
  // slider or a colour box just needs the focus returned.
  if (dialogShown.node?.contains(el)) {
    const canSelect = typeof el.selectionStart === 'number';
    return {
      el,
      start: canSelect ? el.selectionStart : null,
      end: canSelect ? el.selectionEnd : null,
      scroll: el.scrollTop,
    };
  }
  if (el !== composerBox && el?.id !== EDITOR_AREA) return null;
  return {
    composer: el === composerBox,
    start: el.selectionStart,
    end: el.selectionEnd,
    scroll: el.scrollTop,
  };
}

function restoreFocus(snap) {
  if (!snap) return;
  const el = snap.el ?? (snap.composer ? composerBox : document.getElementById(EDITOR_AREA));
  // A remembered element that did not make it back into the tree — the render
  // that ran was the one closing its dialog — has nowhere to put the focus.
  if (!el || (snap.el && !el.isConnected)) return;
  el.focus();
  if (snap.start !== null && snap.start !== undefined) el.setSelectionRange(snap.start, snap.end);
  el.scrollTop = snap.scroll;
}

// How far down a list you are is state, and it lived on nodes that render()
// throws away — so picking a file forty rows down rebuilt the list at the top
// and lost your place. Each scroller carries a name, and the name is what the
// position is remembered against. Missing names are simply not restored, so a
// list that only appears in one state costs nothing.
function scrollSnapshot() {
  const snap = new Map();
  for (const el of root.querySelectorAll('[data-scroll]')) {
    if (el.scrollTop > 0) snap.set(el.dataset.scroll, el.scrollTop);
  }
  return snap;
}

function restoreScroll(snap) {
  if (snap.size === 0) return;
  for (const el of root.querySelectorAll('[data-scroll]')) {
    const top = snap.get(el.dataset.scroll);
    if (top) el.scrollTop = top;
  }
}

// Restoring the offset is not enough for the file list: opening a file shrinks
// it to about five rows, so the row you just clicked can end up below the
// bottom of a list that is technically where you left it. `nearest` does
// nothing when the row is already on screen.
function keepOpenFileInView() {
  document.querySelector('.tree .file.open')?.scrollIntoView({ block: 'nearest' });
}

// A diff opened from somewhere other than its own row — from one file's
// versions, where the whole version is fifty rows away — has to be gone to.
// One shot, set by whatever opened it: doing this on every render would yank
// the list around under someone who had scrolled away from an open diff.
let showDiffRow = false;

function keepDiffInView() {
  if (!showDiffRow) return;
  showDiffRow = false;
  // 'start', not 'nearest': the row being on screen is not the point, seeing
  // what is inside it is, and the drawer is below the row.
  document.querySelector('.commit.open')?.scrollIntoView({ block: 'start' });
}

export const isChat = () => S.project?.kind === 'chat';

// A picture is the first file whose byte count nobody can read, so sizes are
// rounded once they leave kilobyte territory.
export const sizeText = (bytes) => (bytes < 1024
  ? `${bytes} bytes`
  : bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export const agentName = (id) => S.project?.agents.find((a) => a.agent_id === id)?.name
  ?? S.agents.find((a) => a.id === id)?.name
  ?? 'Helper';

/* API --------------------------------------------------------------------- */

export const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export const NO_CONNECTION = 'Could not reach the studio. Check the connection and try again.';

// ⚠️ `fetch` does not answer when there is no connection — it throws. A dropped
// wifi, a closed lid, the server restarting mid-request: every one of those
// used to come out as an exception nobody caught, which is why a picture could
// open blank with nothing said and a message could vanish out of the composer.
//
// So nothing in the studio calls `fetch` directly. This answers instead: status
// 0, never ok, empty body, and the same shape a Response has as far as any
// caller here uses one — so every `if (!res.ok)` already written handles a
// dead connection without knowing it was one.
// Only a change is worth a render: while the connection is down the stream
// retries every few seconds and would otherwise rebuild the tree each time.
function setConnected(on) {
  if (S.connected === on) return;
  S.connected = on;
  render();
}

export async function send(url, opts) {
  try {
    // The one place `fetch` is named. Everywhere else calls this.
    return await fetch(url, opts);
  } catch {
    // Evidence, not a guess: this request did not reach the studio. Clearing it
    // again is the stream's job — it is the connection that knows.
    setConnected(false);
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      text: async () => '',
      blob: async () => new Blob(),
      json: async () => null,
    };
  }
}

// What to tell somebody, when a route's own message would be a guess. No
// connection is never the file's fault, so it never reads like it.
const problem = (res, fallback) => (res.status === 0 ? NO_CONNECTION : fallback);

export async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await send(path, opts);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.status === 401 && S.me) {
    S.me = null;
    render();
  }
  // Every caller reads `body.error` for what went wrong, so the one failure
  // that has no body still has to have a message.
  const failed = res.status === 0 ? { error: NO_CONNECTION } : parsed;
  return { status: res.status, ok: res.ok, body: failed, headers: res.headers };
}

export function say(message, bad = false) {
  S.banner = message ? { message, bad } : null;
  render();
}

/* Boot ------------------------------------------------------------------- */

const slugFromUrl = () => {
  const match = location.pathname.match(/^\/p\/([a-z0-9-]+)/);
  return match ? match[1] : null;
};

const RAIL_TABS = ['files', 'play', 'versions'];

// The URL is the view: which game, which tab, which file, which version — so
// what someone is looking at is always the thing they can send to somebody
// else. `file` is whichever file the rail is about: the open one under Files,
// the filter under Versions. One name because it is one idea.
const viewFromUrl = () => {
  const q = new URLSearchParams(location.search);
  return { tab: q.get('tab'), file: q.get('file'), version: q.get('version') };
};

// The inverse of applyView, and written in the same two branches so the pair
// can be read against each other.
function urlNow() {
  if (!S.slug) return '/';
  const q = new URLSearchParams();
  if (!isChat()) {
    if (S.tab !== 'files') q.set('tab', S.tab);
    if (S.tab === 'files' && S.open) q.set('file', S.open.path);
    if (S.tab === 'versions') {
      if (S.historyPath) q.set('file', S.historyPath);
      if (S.diff) q.set('version', S.diff.sha);
    }
  }
  const query = q.toString();
  return `/p/${S.slug}${query ? `?${query}` : ''}`;
}

// How render() writes the address. `push` — the default — is a navigation and
// gets an entry of its own. `replace` is for bringing the state into line with
// an address the browser already has: the first load, Back, a reopen nobody
// navigated to. `hold` is for a click that passes through a state on its way
// to another, where only where it ends up is somewhere to come back to.
let urlMode = 'push';
let urlModeToken = null;

// ⚠️ The mode is one global held across an await, so two of these can overlap
// — a Back pressed while a click is still working. Whoever set it last owns
// it, and only that one puts it back; restoring a saved value instead let an
// inner call finish first and leave `hold` standing, after which nothing ever
// wrote the address again. Going back to the default cannot get stuck: the
// worst an overlap costs now is one entry too many.
export async function urlAs(mode, fn) {
  const token = {};
  urlMode = mode;
  urlModeToken = token;
  try {
    await fn();
  } finally {
    if (urlModeToken === token) {
      urlMode = 'push';
      urlModeToken = null;
    }
  }
}

// Written from the state by render(), so no click has to remember to do it,
// and only when it differs — a streaming reply renders many times a second,
// and browsers throttle a history call made that often.
function syncUrl() {
  // ⚠️ Nothing is written before there is a session to write about: signed
  // out, S.slug is null, and rewriting the URL to / would throw away the deep
  // link somebody followed before they had finished answering the sign-in
  // form. render() returns early in that state too — this is the rule stated
  // where it can be read rather than left to the order of two statements.
  if (!S.me || S.loading || urlMode === 'hold') return;
  // A dialog is a decision in progress, not a view to link to. Holding the
  // address until it is answered is what keeps a Back out of unsaved work from
  // overwriting the entry it was going to: refuse the close and the file's own
  // address comes back as a new entry, accept it and the address that is
  // already there was right all along.
  if (S.dialog) return;
  const url = urlNow();
  if (url === location.pathname + location.search) return;
  // An entry per file, tab and version, so Back walks back through them the
  // way it walks back through games.
  if (urlMode === 'replace') history.replaceState({}, '', url);
  else history.pushState({}, '', url);
}

// The list on screen is not the list being asked for — a different filter, one
// that was never fetched, or one a commit has landed under since.
export const historyNeedsLoad = (path) => path !== S.historyPath
  || S.history.length === 0
  || S.historyStale;

// Put the rail where a URL says, and take away what it does not say — Back out
// of a file has to close it. Every part is optional, and a part that is no
// longer there — a deleted file, a commit off the end of the list — simply
// does not open; the rest of the view still arrives.
async function applyView({ tab, file, version }) {
  if (isChat()) return;
  S.tab = RAIL_TABS.includes(tab) ? tab : 'files';
  const want = file ?? null;
  if (S.tab === 'versions') {
    if (historyNeedsLoad(want)) await loadHistory(want);
    if (version !== (S.diff?.sha ?? null)) {
      // Arriving at a version is arriving at its row, which a link can drop
      // you thirty rows above.
      if (version) await loadDiff(version, { goTo: true });
      else S.diff = null;
    }
  } else if (S.tab === 'files') {
    // Back is a way out of a file as much as into one, and either way it goes
    // through the same question the ✕ asks when there is unsaved work. Answer
    // that no and the file stays open, so the next render puts its own address
    // back — a duplicate entry is a smaller price than losing what was typed.
    if (want && want !== S.open?.path) await chooseFile(want);
    else if (!want && S.open) closeOpenFile();
  }
  render();
}

// Back, and the first load. Same game means the rail moves on its own rather
// than the project being fetched again: openProject clears the pins, the open
// traces and anything mid-stream, which is far too much to throw away for a
// Back that only closed a file.
// One at a time. Two Backs pressed quickly both fetch, and interleaved they
// can settle in the other order — leaving the rail describing the address
// before last. Queued, the last address applied is the one showing.
let following = Promise.resolve();

const followUrl = () => {
  following = following.then(() => urlAs('replace', async () => {
    const slug = slugFromUrl();
    const view = viewFromUrl();
    if (slug && slug === S.slug) await applyView(view);
    else await openProject(slug, { view });
  }));
  return following;
};

async function start() {
  const me = await api('GET', '/api/me');
  // A studio that cannot be reached is not a studio you are signed out of, and
  // the sign-in form on its own says the wrong thing.
  if (me.status === 0) S.authError = NO_CONNECTION;
  if (me.ok) {
    S.me = me.body;
    await Promise.all([loadProjects(), loadAgents()]);
    connectStream();
    await followUrl();
  }
  // In replace mode: nothing was written while S.loading held syncUrl off, so
  // this is the render that first writes the address — and an address arrived
  // at is never a new entry. Otherwise a link whose parameters were in another
  // order, or named a file that has since gone, would be canonicalised into a
  // second entry and Back could not leave the studio.
  await urlAs('replace', async () => {
    S.loading = false;
    render();
  });
}

export async function loadProjects() {
  const res = await api('GET', '/api/projects');
  if (res.ok) S.projects = res.body;
}

export async function loadAgents() {
  const res = await api('GET', '/api/agents');
  if (res.ok) S.agents = res.body;
}

// The address is render()'s to write — opening a game only sets the state.
// Wrap the call in urlAs('replace', …) when it is not a navigation.
export async function openProject(slug, { view = null } = {}) {
  // Half-typed text belongs to the game it was typed in, so it is parked
  // here on the way out and put back on the way in.
  if (S.slug) S.drafts.set(S.slug, composerBox.value);
  composerBox.value = slug ? (S.drafts.get(slug) ?? '') : '';

  // Colours changed in the editor belong to the game being left, so they go in
  // before the slug does.
  await flushPalette();

  if (!slug) {
    S.slug = null;
    S.project = null;
    S.files = [];
    S.errors = [];
    S.open = null;
    S.palette = null;
    S.libraries = { studio: S.libraries.studio, game: {} };
    render();
    return;
  }
  const res = await api('GET', `/api/projects/${slug}`);
  if (!res.ok) {
    say(res.status === 404 ? 'That game does not exist.' : 'Could not open that game.', true);
    return;
  }
  S.slug = slug;
  S.project = res.body;
  S.files = res.body.files;
  S.errors = res.body.errors ?? [];
  S.pinned = new Set();
  S.open = null;
  S.history = [];
  // Cleared as well as the list: a path from the game you just left would
  // filter this game's history by a file it may not even have.
  S.historyPath = null;
  S.diff = null;
  S.historyStale = false;
  S.live.clear();
  S.traces.clear();
  S.autoscroll = true;
  S.palette = null;
  render();
  if (!isChat()) {
    await loadLibraries();
    render();
  }
  // The rail keeps whichever tab you were on unless a URL says otherwise, so
  // arriving at a game with Versions already open has to fetch now. Waiting
  // for the next click on the tab is what made the list look empty until you
  // left it and came back.
  await applyView(view ?? { tab: S.tab });
}

window.addEventListener('popstate', followUrl);

/* Live events ------------------------------------------------------------- */

const STREAM_EVENTS = [
  'project.new', 'project.updated', 'message.new',
  'agent.stream.start', 'agent.stream.reasoning', 'agent.stream.chunk',
  'agent.tool', 'agent.stream.end', 'files.changed', 'game.errors',
];

function connectStream() {
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

function liveFor(agentId) {
  let entry = S.live.get(agentId);
  if (!entry) {
    entry = { reply: '', trace: '', tool: null, error: false, nodes: null, open: false };
    S.live.set(agentId, entry);
  }
  return entry;
}

function onEvent(name, data) {
  switch (name) {
    case 'project.new':
    case 'project.updated':
      loadProjects().then(render);
      if (mine(data) && S.project) {
        S.project.name = data.name ?? S.project.name;
        if (data.archived !== undefined) S.project.archived = data.archived;
        render();
      }
      return;

    case 'message.new': {
      if (!mine(data)) return;
      // The finished message replaces whatever was streaming from that agent,
      // but its reasoning moves across rather than vanishing: it is never
      // saved, so this session is the only place it will ever exist.
      if (data.agent_id !== null) {
        const entry = S.live.get(data.agent_id);
        if (entry?.trace) keepTrace(data.id, entry.trace, entry.open === true);
        S.live.delete(data.agent_id);
      }
      S.project.messages.push(data);
      render();
      return;
    }

    case 'agent.stream.start': {
      if (!mine(data)) return;
      S.live.set(data.agent_id, {
        reply: '', trace: '', tool: null, error: false, nodes: null, open: false,
      });
      render();
      return;
    }

    case 'agent.stream.reasoning': {
      if (!mine(data)) return;
      const entry = liveFor(data.agent_id);
      entry.trace += data.delta;
      if (entry.nodes) {
        entry.nodes.trace.textContent = entry.trace;
        entry.nodes.thinking.hidden = false;
      } else render();
      return;
    }

    case 'agent.stream.chunk': {
      if (!mine(data)) return;
      const entry = liveFor(data.agent_id);
      entry.reply += data.delta;
      if (entry.nodes) {
        entry.nodes.reply.textContent = entry.reply;
        entry.nodes.reply.hidden = false;
        stickToBottom();
      } else render();
      return;
    }

    case 'agent.tool': {
      if (!mine(data)) return;
      const entry = liveFor(data.agent_id);
      entry.tool = data.path ? `${data.tool} ${data.path}` : data.tool;
      if (entry.nodes) entry.nodes.tool.textContent = toolLabel(entry.tool);
      else render();
      return;
    }

    case 'agent.stream.end': {
      if (!mine(data)) return;
      if (data.error) {
        const entry = liveFor(data.agent_id);
        entry.error = true;
        entry.tool = null;
        render();
      } else if (!data.message_id) {
        // Nothing was written and nothing said.
        S.live.delete(data.agent_id);
        render();
      }
      return;
    }

    case 'game.errors': {
      if (!mine(data)) return;
      // The server sends the whole current list, so there is nothing to merge.
      S.errors = data.errors;
      // Never a full render: rebuilding the tree rebuilds the preview iframe,
      // which restarts the game, which reports its problems again — a loop
      // that never settles. Same reason a streaming reply mutates its nodes.
      if (problemNodes) paintProblems();
      else render();
      return;
    }

    case 'files.changed': {
      if (!mine(data)) return;
      refreshFiles();
      // An agent just rewrote the game; show the new version.
      S.previewNonce += 1;
      // Those problems belonged to the version that was just replaced. The
      // reload below re-runs the game, and anything still broken says so
      // again.
      S.errors = [];
      // A commit landed, so the versions list is now behind. Reload it if it
      // is on screen; otherwise let opening the tab do it. In replace mode:
      // a helper finishing its turn is not somewhere the reader navigated to,
      // and every turn would otherwise leave an entry behind.
      S.historyStale = true;
      if (S.tab === 'versions') urlAs('replace', () => loadHistory(S.historyPath));
      if (S.open && data.paths.includes(S.open.path)) {
        if (S.open.dirty || S.draw?.dirty) {
          say(`${S.open.path} changed while you were working on it. What you have is still here — saving will ask before overwriting.`);
        } else {
          openFile(S.open.path);
        }
      }
      render();
      return;
    }

    default:
  }
}

export function toolLabel(tool) {
  if (!tool) return '';
  const [verb, ...rest] = tool.split(' ');
  const path = rest.join(' ');
  const words = {
    write_file: 'writing', patch_file: 'editing',
    read_file: 'reading', delete_file: 'deleting',
  };
  return `${words[verb] ?? verb} ${path}`.trim();
}

/* Problems the game reported --------------------------------------------- */

// The game runs on the games origin inside the preview iframe, so postMessage
// is the only way it can say anything at all — and that is deliberate
// (spec.md §7): the studio cannot reach into the frame either, which is why
// the reporter is injected by the server rather than from here. Everything
// arriving is text written by LLM-authored game code, so it is checked before
// it is believed: it must come from the games origin, and it must name the
// game we are actually looking at.
const MAX_ERROR_BATCH = 20;
const ERROR_BATCH_MS = 500;
const errorQueue = [];
let errorTimer = null;
// The commit the queued problems came from. The reporter is built with it, so
// it names the code that actually broke rather than whatever has been
// committed since.
let errorVersion = null;
// The live nodes of the problems panel, while the Play tab is on screen.
let problemNodes = null;

function gamesOrigin() {
  if (!S.project?.play_url) return null;
  try {
    return new URL(S.project.play_url).origin;
  } catch {
    return null;
  }
}

async function flushErrors() {
  errorTimer = null;
  const slug = S.slug;
  const version = errorVersion;
  const errors = errorQueue.splice(0, errorQueue.length).slice(0, MAX_ERROR_BATCH);
  if (!slug || errors.length === 0) return;
  // The reply comes back as a game.errors broadcast, so the list is rendered
  // from one place whichever tab reported it.
  await api('POST', `/api/projects/${slug}/errors`, { version, errors });
}

window.addEventListener('message', (event) => {
  const origin = gamesOrigin();
  if (!origin || event.origin !== origin) return;
  const data = event.data;
  if (!data || data.gamestudio !== 'error' || data.slug !== S.slug) return;
  const version = String(data.version ?? '');
  // A different version means the preview reloaded, so anything still queued
  // describes bytes that are gone.
  if (version !== errorVersion) {
    errorQueue.length = 0;
    errorVersion = version;
  }
  errorQueue.push({
    message: String(data.message ?? ''),
    location: String(data.location ?? ''),
  });
  // A game that breaks on load usually breaks several times at once; one
  // round trip for the burst is enough.
  if (errorTimer === null) errorTimer = setTimeout(flushErrors, ERROR_BATCH_MS);
});

/* Files ------------------------------------------------------------------- */

export async function refreshFiles() {
  if (!S.slug) return;
  const res = await api('GET', `/api/projects/${S.slug}/files`);
  if (res.ok) {
    S.files = res.body.files;
    render();
  }
}

// ⚠️ Opening a file is several awaits long — its bytes, and for a picture the
// decode and the palette after that — so two clicks in a row overlap, and
// whichever finished last used to win, whichever was asked for last. Each open
// takes a token and drops everything it was carrying the moment a newer one
// starts. Without this, clicking one picture and then another showed the first
// one, or a title with no picture under it at all.
let opening = null;

export async function openFile(path) {
  const token = {};
  opening = token;
  const stale = () => opening !== token;

  // Colours changed in the editor ride along with whatever leaves it, so
  // switching files saves them instead of dropping them.
  await flushPalette();
  if (stale()) return;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (stale()) return;
  if (!res.ok) {
    say(problem(res, `Could not open ${path}.`), true);
    return;
  }
  // The listing already said whether this is text and what it is; a picture
  // opens with content null and is shown rather than edited.
  const entry = S.files.find((f) => f.path === path);
  const content = entry?.text ? await res.text() : null;
  if (stale()) return;
  S.open = {
    path,
    mime: entry?.mime ?? null,
    content,
    etag: res.headers.get('etag'),
    dirty: false,
  };
  S.draw = null;
  S.drawRefused = null;
  S.tab = 'files';
  render();
  // A picture opens as a picture you can draw on. There was a second way to
  // look at one and it showed it at exactly the same size, so it was a control
  // that did nothing but cost a click.
  if (isDrawable(S.open)) await startDrawing();
}

// Closing throws away unsaved text, which is the one thing in the editor that
// git cannot get back, so it asks first.
// `then` is the file to open once this one is out of the way, so choosing
// another file in the list asks the same question rather than throwing the
// work away silently. Now that every picture opens ready to draw on, that
// stray click is a great deal easier to make.
function closeOpenFile(then = null) {
  if (!S.open) return;
  if (S.open.dirty || S.draw?.dirty) {
    S.dialog = { kind: 'close-file', path: S.open.path, then };
    render();
    return;
  }
  // Returned, not fired and forgotten: a caller that waits for the close has
  // to be waiting for the open too. Back is one — it renders when this
  // settles, and a render that lands after it has already finished writes the
  // wrong address.
  if (then) return openFile(then);
  flushPalette();
  S.open = null;
  S.draw = null;
  S.drawRefused = null;
  render();
}

// Choosing a file from anywhere at all — the list, a path in a diff, the
// header of one file's versions. Through closeOpenFile so unsaved work in the
// file being left gets the same question the ✕ asks, wherever the click came
// from.
export const chooseFile = (path) => (S.open ? closeOpenFile(path) : openFile(path));

export async function saveOpenFile({ force = false } = {}) {
  if (!S.open) return;
  const headers = { 'content-type': 'text/plain' };
  if (!force && S.open.etag) headers['if-match'] = S.open.etag;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(S.open.path)}`, {
    method: 'PUT', headers, body: S.open.content,
  });
  const body = await res.json().catch(() => null);

  if (res.status === 409) {
    // Someone — probably an agent — got there first. Offer the choice rather
    // than picking a winner.
    S.dialog = {
      kind: 'conflict',
      path: S.open.path,
      theirs: body?.content ?? '',
      etag: body?.etag ?? null,
    };
    render();
    return;
  }
  if (!res.ok) {
    say(problem(res, body?.error ?? 'Could not save that file.'), true);
    return;
  }
  S.open.etag = body.etag;
  S.open.dirty = false;
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${S.open.path}.`);
}

export async function createFile(path) {
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
    method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    say(body?.error ?? 'Could not make that file.', true);
    return;
  }
  await refreshFiles();
  await openFile(path);
}

/* The studio library ------------------------------------------------------- */

// A library is copied into a game, under studio/, rather than shared from one
// place. That is what keeps each game's repository complete: clone it, publish
// it, hand it to somebody, and it still runs, which neither a symlink nor a
// submodule survives. What it costs is drift, and the manifest is what makes
// drift visible — studio/studio.json records the version this game has, so the
// studio can say when one is behind instead of the two quietly diverging.
//
// The rule that makes it a library and not just a folder is in
// server/files/paths.js: a helper reads it and cannot write it.
export const LIBRARY_DIR = 'studio';
const LIBRARY_MANIFEST = `${LIBRARY_DIR}/studio.json`;
const LIBRARY_INDEX = '/studio-lib/index.json';

const libraryFile = (name, file) => `/studio-lib/${name}/${file}`;

// In front of the game's own scripts, so anything reading a library's globals on
// its first line finds them.
function withScriptTags(markup, srcs) {
  const tags = `${srcs.map((src) => `<script src="${src}"></script>`).join('\n')}\n`;
  const script = markup.search(/<script\b/i);
  if (script !== -1) return markup.slice(0, script) + tags + markup.slice(script);
  const body = markup.search(/<\/body>/i);
  if (body !== -1) return markup.slice(0, body) + tags + markup.slice(body);
  return `${markup}\n${tags}`;
}

async function studioLibraries() {
  const res = await send(LIBRARY_INDEX);
  if (!res.ok) return null;
  return (await res.json()).libraries ?? null;
}

// What this game has, by library name. Absent or unreadable reads as "none",
// which is the same thing as far as installing goes.
async function gameLibraries() {
  if (!S.files.some((f) => f.path === LIBRARY_MANIFEST)) return {};
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(LIBRARY_MANIFEST)}`);
  if (!res.ok) return {};
  try {
    const held = JSON.parse(await res.text());
    return held && typeof held === 'object' ? held : {};
  } catch {
    return {};
  }
}

// No dialog in front of this. An upload asks first because it has a decision in
// it — which folder — and files it is about to replace. This has neither: the
// paths come from the manifest, a game's own seeded files are never replaced,
// and every write is a commit that Versions can undo.
async function loadLibraries() {
  S.libraries = { studio: await studioLibraries(), game: await gameLibraries() };
}

// null when there is nothing to offer: installed and current, so no button.
function libraryOffer(name) {
  const library = S.libraries.studio?.[name];
  if (!library) return null;
  const held = S.libraries.game?.[name];
  if (held === undefined) return { library, label: `+ ${library.title}`, updating: false };
  if (held !== library.version) return { library, label: `Update ${library.title.toLowerCase()}`, updating: true };
  return null;
}

async function installLibrary(name) {
  const libraries = await studioLibraries();
  const library = libraries?.[name];
  if (!library) { say('Could not read the studio library.', true); return; }

  const held = await gameLibraries();
  const updating = held[name] !== undefined && held[name] !== library.version;
  const writes = [];

  // The library's own files, always written: this is the part worth keeping
  // current, and a helper cannot have changed it.
  for (const file of library.files) {
    const res = await send(libraryFile(name, file));
    if (!res.ok) { say(`Could not read ${file} from the studio library.`, true); return; }
    writes.push({ path: `${LIBRARY_DIR}/${file}`, body: await res.text() });
  }

  // The game's own companion files, written once. Replacing config/controls.js
  // would throw away buttons somebody chose.
  const kept = [];
  for (const seed of library.seeds ?? []) {
    if (S.files.some((f) => f.path === seed.to)) { kept.push(seed.to); continue; }
    const res = await send(seed.from);
    if (!res.ok) { say(`Could not read ${seed.to} from the studio library.`, true); return; }
    writes.push({ path: seed.to, body: await res.text() });
  }

  writes.push({ path: LIBRARY_MANIFEST, body: `${JSON.stringify({ ...held, [name]: library.version }, null, 2)}\n` });

  if (S.files.some((f) => f.path === 'index.html') && library.scripts?.length) {
    const res = await send(`/api/projects/${S.slug}/files/${encodePath('index.html')}`);
    const markup = res.ok ? await res.text() : null;
    const missing = (library.scripts ?? []).filter((src) => !markup?.includes(src));
    if (markup !== null && missing.length) {
      writes.push({ path: 'index.html', body: withScriptTags(markup, missing) });
    }
  }

  say(updating ? `Updating ${library.title}…` : `Setting up ${library.title}…`);
  const { done, failure } = await writeFiles(writes);
  if (failure) {
    say(done ? `${failure} ${done} of ${writes.length} got through.` : failure, true);
    return;
  }
  say(`${library.title} ${updating ? 'updated' : 'is ready'}: version ${library.version} in ${LIBRARY_DIR}/.`
    + (kept.length ? ` Your own ${kept.join(', ')} was left alone.` : '')
    + ' Ask a helper to use it.');
  // A banner is easy to miss, and with the files already in place nothing else
  // on screen moves — which makes a button that did four commits look like a
  // button that did nothing. The seeded file is the visible proof and the part a
  // person actually wants to change.
  const landing = library.seeds?.[0]?.to ?? LIBRARY_MANIFEST;
  await loadLibraries();
  await openFile(landing);
}

/* Drawing ----------------------------------------------------------------- */

// PNG only. A JPEG has no see-through parts and saving one back would quietly
// change what kind of file it is; a game sprite wants the transparency.
const isDrawable = (open) => open?.mime === 'image/png';

// A picture each, since these four are the ones every drawing program in the
// world draws the same way. The words stay on the title and the aria-label, so
// nothing is only a picture.
const DRAW_TOOLS = [
  { key: 'pencil', name: 'pencil', label: 'Draw', hint: 'paint with the chosen colour' },
  { key: 'eraser', name: 'eraser', label: 'Erase', hint: 'take the colour out again, back to see-through' },
  { key: 'fill', name: 'bucket', label: 'Fill', hint: 'flood everything joined to the pixel you click' },
  { key: 'pick', name: 'dropper', label: 'Eyedropper', hint: 'click a pixel to put its colour in the chosen square' },
];

function pictureCanvas(picture) {
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  canvas.getContext('2d').putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
  return canvas;
}

const pictureBlob = (picture) => new Promise((resolve) => {
  pictureCanvas(picture).toBlob(resolve, 'image/png');
});

// The picture comes back out of the file rather than out of anything the
// studio kept, so what is drawn on is what is actually on disk. Anything it
// will not open stays on screen as the picture, with the reason underneath —
// there is no second way to look at one, so refusing has to leave something.
async function startDrawing() {
  // Belongs to the open that started it: a picture decoded after a newer file
  // has been asked for is thrown away rather than drawn over it.
  const token = opening;
  const stale = () => opening !== token;
  const path = S.open.path;

  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (stale()) return;
  // The reason goes in the pane, not only in a banner: the picture itself
  // cannot load either, so without this the editor is a filename over an empty
  // box and nothing says why.
  if (!res.ok) {
    S.drawRefused = problem(res, 'The studio could not read this picture.');
    say(S.drawRefused, true);
    return;
  }
  const bitmap = await createImageBitmap(await res.blob()).catch(() => null);
  if (stale()) return;
  if (!bitmap) {
    S.drawRefused = 'This one will not open as a picture, so there is nothing to draw on.';
    render();
    return;
  }
  if (bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE) {
    S.drawRefused = `This is ${bitmap.width} by ${bitmap.height}. Drawing works up to `
      + `${MAX_SIDE} across, so this one is here to look at.`;
    render();
    return;
  }
  const canvas = pictureCanvas(blankPicture(bitmap.width, bitmap.height));
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const { data } = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height);
  S.draw = {
    picture: pictureFrom(bitmap.width, bitmap.height, data),
    undo: [],
    redo: [],
    dirty: false,
  };
  // Read fresh each time: a helper may have changed the game's colours, or
  // Versions may have brought an older look.js back, since the editor was last
  // open.
  await loadPalette();
  if (stale()) return;
  if (S.drawPrefs.slot >= paletteColours().length) S.drawPrefs.slot = 0;
  render();
}

export async function createPicture(name, width, height) {
  const path = assetPath(ASSET_DIR, `${name || 'picture'}.png`);
  const { failure } = await writeFiles([{ path, body: await pictureBlob(blankPicture(width, height)) }]);
  if (failure) { say(failure, true); return; }
  say(`Made ${path}.`);
  // openFile opens a picture ready to draw on; there is nothing to add here.
  await openFile(path);
}

/* The game's colours ------------------------------------------------------- */

// The palette is a *config file* like any other, which is the whole point:
// changing a colour is a commit on the game, it shows up in Versions, and a
// helper can read the same list the drawing tools offer.
const LOOK_FILE = 'config/look.js';

const paletteColours = () => S.palette?.colours ?? PALETTE;

// The colour being drawn with is whatever is in the chosen square, so putting a
// new colour in that square changes what the pencil does — which is what makes
// the well and the eyedropper edit the palette rather than sit beside it.
const chosenColour = () => paletteColours()[S.drawPrefs.slot] ?? PALETTE[0];

// The file the studio writes when a game has no look.js yet. Laid out in two
// rows of sixteen because that is how the studio shows it, and commented
// because every config file is.
// Eight to a source line: short enough to read, and short enough that changing
// one colour shows up in Versions as a line you can take in at a glance.
const lookFileText = (colours) => {
  const rows = [];
  for (let i = 0; i < colours.length; i += 8) {
    // Double quotes, matching literalFor and the config files the games already
    // have — otherwise the first colour edited stands out from the other 31.
    rows.push(`  ${colours.slice(i, i + 8).map((c) => `"${c}"`).join(', ')},`);
  }
  return `// How the game looks: the colours it is drawn from.
//
// These are the squares the studio offers when someone draws a picture for this
// game, so changing one here changes what the drawing tools hand out. Greys
// first, then the rainbow, then the ones with more character.
const PALETTE = [
${rows.join('\n')}
];
`;
};

async function loadPalette() {
  S.palette = { colours: [...PALETTE], text: null, from: null };
  if (!S.files.some((f) => f.path === LOOK_FILE)) return;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(LOOK_FILE)}`);
  if (!res.ok) return;
  const text = await res.text();
  S.palette.text = text;
  const parsed = parseConfigFile(text);
  const found = parsed.ok ? parsed.decls.find((d) => d.name === 'PALETTE') : null;
  // A look.js that holds other things but no PALETTE is normal — a game's own
  // colours belong in there too. The studio's list is then still the default,
  // and writing one appends rather than replaces.
  if (!Array.isArray(found?.node.value) || !found.node.value.every(isColour)) return;
  S.palette.colours = found.node.value;
  S.palette.from = LOOK_FILE;
}

// Changing a colour is a change in memory. Eyedropping half a dozen colours
// while drawing would otherwise be half a dozen commits on the game, which is
// the versioning working against the drawing rather than for it.
function setPaletteColour(index, hex) {
  const colours = [...paletteColours()];
  colours[index] = hex;
  S.palette = { ...S.palette, colours, dirty: true };
  render();
}

// The text the file should hold now: one value spliced in place so every
// comment and every other colour survives, or the whole file when there is not
// one yet. Null when the file is there but unreadable — the colours are then
// left alone rather than being written over something nobody can parse.
function lookFileWith(colours) {
  const before = S.palette?.text;
  if (before === null || before === undefined) return lookFileText(colours);

  const parsed = parseConfigFile(before);
  if (!parsed.ok) return null;
  const found = parsed.decls.find((d) => d.name === 'PALETTE');
  // The file exists and is readable but has no PALETTE — a game's own drawing
  // colours belong in there too — so add one rather than replacing anything.
  if (!found?.node.items) return `${before.replace(/\n*$/, '\n')}\n${lookFileText(colours)}`;

  // One splice at a time, re-parsing between: a splice moves every offset behind
  // it, which is the same reason the config form applies one edit per read.
  let text = before;
  for (let i = 0; i < colours.length; i += 1) {
    const current = parseConfigFile(text);
    const item = current.ok
      ? current.decls.find((d) => d.name === 'PALETTE')?.node.items?.[i]
      : null;
    if (!item || item.value === colours[i]) continue;
    text = spliceValue(text, item, literalFor('string', colours[i]));
  }
  return text;
}

// Called when the picture is saved and whenever the editor is left behind, so
// the colours ride along with the work rather than needing a save of their own.
async function flushPalette() {
  if (!S.palette?.dirty) return true;
  const colours = [...S.palette.colours];
  const text = lookFileWith(colours);
  if (text === null) {
    say(`${LOOK_FILE} has something in it the studio cannot read, so the colours were left alone.`, true);
    S.palette.dirty = false;
    return false;
  }
  const { failure } = await writeFiles([{ path: LOOK_FILE, body: text }]);
  if (failure) { say(failure, true); return false; }
  S.palette = { colours, text, from: LOOK_FILE, dirty: false };
  return true;
}

// Module scope rather than inside the pane, because the keyboard reaches it
// too and the pane is rebuilt on every render.
function stepDrawing(back) {
  if (!S.draw) return;
  const from = back ? S.draw.undo : S.draw.redo;
  const to = back ? S.draw.redo : S.draw.undo;
  const move = from.pop();
  if (!move) return;
  applyStep(S.draw.picture, move, back);
  to.push(move);
  S.draw.dirty = true;
  render();
}

// Closing the tab is not a switch and nothing else would catch it, so the last
// chance to keep the colours is here. `keepalive` is what lets a request outlive
// the page — a plain fetch is cancelled on unload, and sendBeacon cannot PUT.
window.addEventListener('pagehide', () => {
  if (!S.palette?.dirty || !S.slug) return;
  const text = lookFileWith(S.palette.colours);
  if (text === null) return;
  send(`/api/projects/${S.slug}/files/${encodePath(LOOK_FILE)}`, {
    method: 'PUT', body: text, keepalive: true,
  }).catch(() => { /* the page is going away regardless */ });
});

// A drawing is the one place in the studio where ⌘Z means something, so the
// listener asks whether one is open rather than being wired up and torn down
// with the pane. Ctrl for a keyboard without a ⌘.
window.addEventListener('keydown', (event) => {
  if (!S.draw || S.dialog) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  if (event.key.toLowerCase() !== 'z') return;
  // Typing a filename into a box is not drawing, and ⌘Z there belongs to the
  // box.
  const el = event.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  event.preventDefault();
  stepDrawing(!event.shiftKey);
});

// Saves whichever of the two has changed — the picture, the colours, or both —
// so one button covers the work in the pane.
async function saveDrawing() {
  const { path } = S.open;
  const drawing = S.draw;
  const drew = !!drawing?.dirty;
  const recoloured = !!S.palette?.dirty;

  if (drew) {
    const headers = S.open.etag ? { 'if-match': S.open.etag } : {};
    const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
      method: 'PUT', headers, body: await pictureBlob(drawing.picture),
    });
    const body = await res.json().catch(() => null);
    // The text conflict dialog offers to keep one side or the other. Two
    // pictures cannot be compared in a dialog, and nothing but a person writes a
    // PNG, so this says what happened and touches nothing.
    if (res.status === 409) {
      say(`Someone changed ${path} while you were drawing. Close it and open it again to see theirs.`, true);
      return;
    }
    if (!res.ok) {
      say(problem(res, body?.error ?? 'Could not save that picture.'), true);
      return;
    }
    // This write is a commit, and a commit is a files.changed on the stream like
    // any other, so the pane may already have been rebuilt underneath by the
    // time the response lands. Only the editor that made the request may finish
    // the job.
    if (S.draw === drawing && S.open?.path === path) {
      S.open.etag = body.etag;
      S.draw.dirty = false;
    }
  }

  const colours = await flushPalette();
  S.previewNonce += 1;
  await refreshFiles();
  if (!colours) return;
  if (drew && recoloured) say(`Saved ${path} and the colours.`);
  else if (recoloured) say(`Saved the colours in ${LOOK_FILE}.`);
  else say(`Saved ${path}.`);
}

// A rename is a move, whether or not the folder changes with it: one commit,
// recorded by git as a rename, so the file's history is not cut in two.
export async function renameFile(from, to) {
  if (!to || to === from) return;
  const res = await api('POST', `/api/projects/${S.slug}/files/move`, { from, to });
  if (!res.ok) {
    say(res.body?.error ?? `Could not rename ${from}.`, true);
    return;
  }
  S.previewNonce += 1;
  // The new name goes on straight away, before anything else can look: a
  // commit is a files.changed on the stream, and the handler re-reads whatever
  // the open file is called — which, for the one moment between the answer and
  // the reopen below, was a file that no longer existed.
  if (S.open?.path === from) S.open = { ...S.open, path: to };
  await refreshFiles();
  // You renamed the file you were looking at, so you keep looking at it —
  // under the name it has now, which the address follows.
  if (S.open?.path === to) await openFile(to);
  say(`Renamed to ${to}.`);
}

export async function deleteFile(path) {
  const res = await api('DELETE', `/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not delete that file.', true);
    return;
  }
  if (S.open?.path === path) S.open = null;
  S.previewNonce += 1;
  await refreshFiles();
  say(`Deleted ${path}. You can get it back from Versions.`);
}

async function setPublished(published) {
  const res = await api('POST', `/api/projects/${S.slug}/publish`, { published });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change that.', true);
    return;
  }
  S.project.published = published;
  say(published
    ? 'This game is in the games list now.'
    : 'Took this game out of the games list.');
}

/* History ----------------------------------------------------------------- */

export async function loadHistory(path = null) {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await api('GET', `/api/projects/${S.slug}/history${query}`);
  if (res.ok) {
    S.history = res.body;
    S.historyPath = path;
    S.historyStale = false;
    S.diff = null;
    render();
  }
}

// A whole commit, always. The list's filter is still the drawer's filter —
// from one file's versions the question is what happened to that file — but
// the narrowing happens here rather than in the request, so the version can
// also say how many other files it touched. `All files changed (n)` clears the
// filter, which is how you get the rest of it.
// `goTo` for a diff opened from somewhere other than its own row, which may be
// anywhere down a list of fifty. Set here rather than by the caller so it is
// set only when there is a row to go to: a request that fails renders nothing,
// and a flag left standing would jump the list on some later render instead.
export async function loadDiff(sha, { goTo = false } = {}) {
  const res = await api('GET', `/api/projects/${S.slug}/diff/${sha}`);
  if (res.ok) {
    S.diff = res.body;
    showDiffRow = showDiffRow || goTo;
    render();
  }
}

export async function restore(sha, path) {
  const res = await api('POST', `/api/projects/${S.slug}/restore`, { sha, path });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not bring that version back.', true);
    return;
  }
  S.previewNonce += 1;
  await refreshFiles();
  if (S.open?.path === path) await openFile(path);
  await loadHistory(S.historyPath);
  say(`Brought ${path} back to an earlier version.`);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Whole-tree rollback. The result is reported rather than the confirmation
// predicted: the server is the one that knows how many files moved.
export async function rollback(sha) {
  const res = await api('POST', `/api/projects/${S.slug}/rollback`, { sha });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not bring that version back.', true);
    return;
  }
  S.previewNonce += 1;
  await refreshFiles();
  if (S.open?.path) await openFile(S.open.path);
  await loadHistory(S.historyPath);
  const { commit, restored, removed } = res.body;
  if (!commit) {
    say('Everything already looked like that version, so nothing changed.');
    return;
  }
  const gone = removed > 0 ? `, ${plural(removed, 'newer file')} taken away` : '';
  say(`Everything is back to ${sha.slice(0, 7)} — ${plural(restored, 'file')} put back${gone}.`);
}

/* Helpers ----------------------------------------------------------------- */

// Attaching, detaching and toggling all edit the open project's own copy of
// its agent list rather than refetching it. A refetch would throw away the
// open file, the pins, and anything mid-stream.
export async function attachAgent(agent) {
  const res = await api('POST', `/api/projects/${S.slug}/agents`, {
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
    reasoning: agent.reasoning,
    file_tools: agent.file_tools,
    chatty: true,
    responding: false,
  });
  S.project.agents.sort((a, b) => a.name.localeCompare(b.name));
  say(`${agent.name} joined this game and will answer your messages.`);
}

export async function detachAgent(a) {
  const res = await api('DELETE', `/api/projects/${S.slug}/agents/${a.agent_id}`);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not take that helper out.', true);
    return;
  }
  S.project.agents = S.project.agents.filter((x) => x.agent_id !== a.agent_id);
  say(`${a.name} is no longer in this game.`);
}

export async function toggleChatty(a) {
  const res = await api('PATCH', `/api/projects/${S.slug}/agents/${a.agent_id}`, {
    chatty: !a.chatty,
  });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change that helper.', true);
    return;
  }
  a.chatty = !a.chatty;
  say(a.chatty
    ? `${a.name} will answer every message.`
    : `${a.name} will wait until you type @${a.name.split(' ')[0]}.`);
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

// True when it went. The caller needs to know, because what it does with the
// words depends on the answer.
async function sendMessage(text) {
  const res = await api('POST', `/api/projects/${S.slug}/messages`, {
    body: text,
    context_paths: [...S.pinned],
  });
  if (!res.ok) say(res.body?.error ?? 'Could not send that.', true);
  return res.ok;
}

function stickToBottom() {
  const scroller = document.querySelector('.chat .scroll');
  if (scroller && S.autoscroll) scroller.scrollTop = scroller.scrollHeight;
}

/* Render: sign in --------------------------------------------------------- */

function renderAuth() {
  const email = h('input', { type: 'email', autocomplete: 'username', id: 'email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', id: 'password' });
  const submit = async (event) => {
    event.preventDefault();
    S.authError = null;
    const res = await api('POST', '/api/login', {
      email: email.value, password: password.value,
    });
    if (res.ok) {
      S.loading = true;
      render();
      await start();
      return;
    }
    S.authError = res.body?.error ?? 'Could not sign in.';
    render();
  };

  return h('div', { class: 'auth-page' },
    h('form', { class: 'auth-card', onsubmit: submit },
      h('h1', { class: 'auth-title', text: 'Game Studio' }),
      h('p', { class: 'auth-tag', text: 'Build games with your helpers.' }),
      h('label', { for: 'email', text: 'Email' }), email,
      h('label', { for: 'password', text: 'Password' }), password,
      S.authError && h('p', { class: 'error', text: S.authError }),
      h('div', { class: 'row' }, h('button', { class: 'filled', type: 'submit', text: 'Sign in' })),
      h('p', { class: 'auth-note', text: 'Ask whoever runs the studio to make you an account.' }),
    ),
  );
}

/* Render: right rail ----------------------------------------------------- */

// A picture or sound has nothing to edit, so the pane shows the thing itself.
// The source is the same authenticated read the editor uses, and that route
// sends no-store, so a replaced file never shows the bytes it had before.
// How the pane shows a file that is not text. One entry per kind, matched in
// order, and the only place a new kind of file has to be added — which is the
// point of it being a list rather than a run of ifs. `mimeForPath` on the server
// decides what a file is; this decides what to do about it.
const MEDIA_KINDS = [
  { kind: 'picture', when: (mime) => mime?.startsWith('image/'), show: (src, path) => h('img', { src, alt: path }) },
  { kind: 'sound', when: (mime) => mime?.startsWith('audio/'), show: (src) => h('audio', { src, controls: true }) },
  { kind: 'video', when: (mime) => mime?.startsWith('video/'), show: (src) => h('video', { src, controls: true }) },
];

function renderMedia({ path, mime }) {
  const src = `/api/projects/${S.slug}/files/${encodePath(path)}`;
  const kind = MEDIA_KINDS.find((k) => k.when(mime));
  if (kind) return h('div', { class: 'media grow' }, kind.show(src, path));
  // Anything the studio has no way to show is still a real part of the game and
  // still readable — the server sends an unknown type as a download, so the
  // link is the honest thing to offer instead of an apology.
  return h('div', { class: 'pad muted grow' },
    h('p', { text: 'The studio has no way to show this one, but it is part of the game like any other file.' }),
    h('p', {}, h('a', { href: src, download: path.split('/').pop() }, 'Save it to open somewhere else')));
}

// Everything here is painted into one canvas and one pair of nodes rather
// than through render(), which would rebuild the canvas under the pointer
// drawing on it — the same reason the problems panel is painted in place.
function renderDrawing() {
  const { picture } = S.draw;
  // Blocking up the pixels is what a sprite wants and what a photograph does
  // not: past a few hundred across, a picture is being shown at or below its
  // own size and hard edges just make it look broken.
  const chunky = picture.width <= 256 && picture.height <= 256;
  const canvas = h('canvas', {
    class: `pixels${chunky ? '' : ' smooth'}`, width: picture.width, height: picture.height,
  });
  const state = h('span', { class: 'hint muted' });
  // The picture and the game's colours are both work in this pane, so one
  // button covers both and the words say which of them is waiting.
  const unsaved = () => {
    if (S.draw.dirty && S.palette?.dirty) return 'Picture and colours not saved yet';
    if (S.draw.dirty) return 'Not saved yet';
    if (S.palette?.dirty) return 'Colours not saved yet';
    return 'Saved';
  };
  const save = h('button', { class: 'filled', text: 'Save', onclick: () => saveDrawing() });

  const paint = () => {
    canvas.getContext('2d')
      .putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    state.textContent = unsaved();
    save.disabled = (!S.draw.dirty && !S.palette?.dirty) || S.project.archived;
  };

  const touched = () => {
    S.draw.dirty = true;
    paint();
  };

  // A gesture is one step back, however many pixels it covered, so undoing
  // feels like undoing a thing you did rather than a pixel you passed over.
  const opened = () => beginStep(picture);

  const used = () => [...S.draw.undo, ...S.draw.redo].reduce((n, s) => n + stepBytes(s), 0);

  const closed = () => {
    const step = endStep(picture);
    if (!step) return;
    S.draw.undo.push(step);
    // A new gesture is a new branch of history: whatever was undone is not
    // coming back, and keeping it would let redo paste it over this.
    S.draw.redo = [];
    // One step is always kept, however large — a flood fill of a whole big
    // picture is the only thing that can reach the budget on its own, and
    // refusing to remember it would mean it could not be undone.
    while (S.draw.undo.length > 1 && used() > UNDO_BYTES) S.draw.undo.shift();
    S.draw.dirty = true;
  };

  const colour = () => (S.drawPrefs.tool === 'eraser' ? CLEAR : rgbaOf(chosenColour()));

  // The canvas element fills its box and the picture is fitted inside it, so
  // the picture is centred with an empty strip on two sides. Both have to come
  // off before a position on screen is a square in the picture.
  const spotOf = (event) => {
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(box.width / picture.width, box.height / picture.height);
    const left = box.left + (box.width - picture.width * scale) / 2;
    const top = box.top + (box.height - picture.height * scale) / 2;
    return [
      Math.floor((event.clientX - left) / scale),
      Math.floor((event.clientY - top) / scale),
    ];
  };

  let last = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (S.project.archived) return;
    event.preventDefault();
    const [x, y] = spotOf(event);
    if (S.drawPrefs.tool === 'pick') {
      const found = pixelAt(picture, x, y);
      // Picking nothing would set the colour to invisible, which reads as the
      // eyedropper being broken rather than as an empty pixel.
      // Into the chosen square, so picking a colour off the picture is how you
      // build the palette up rather than something separate from it.
      if (found && found[3] !== 0) setPaletteColour(S.drawPrefs.slot, hexOf(found));
      return;
    }
    // A pointerup that never arrived — released off-window with no capture —
    // would otherwise leave the last gesture open and lose it to this one.
    if (picture.step) closed();
    opened();
    // Capture keeps a stroke going when the pointer leaves the canvas, so
    // drawing to the edge does not stop halfway. Failing to get it is not a
    // reason to refuse the stroke.
    try { canvas.setPointerCapture(event.pointerId); } catch { /* no capture */ }
    last = [x, y];
    if (S.drawPrefs.tool === 'fill') {
      floodFill(picture, x, y, colour());
      // A fill is over the moment it is done; there is no dragging it. Through
      // render() rather than paint() so Undo stops looking greyed out.
      last = null;
      closed();
      render();
      return;
    }
    drawLine(picture, x, y, x, y, colour(), S.drawPrefs.brush);
    touched();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!last || S.drawPrefs.tool === 'pick') return;
    const [x, y] = spotOf(event);
    if (last[0] === x && last[1] === y) return;
    drawLine(picture, last[0], last[1], x, y, colour(), S.drawPrefs.brush);
    last = [x, y];
    touched();
  });

  // Lifting the pointer is what ends a stroke, and therefore what makes it one
  // step back rather than a hundred.
  const stop = () => {
    if (!last) return;
    last = null;
    closed();
    render();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  const tools = h('div', { class: 'row wrap' }, DRAW_TOOLS.map((t) => iconButton({
    name: t.name,
    label: t.label,
    hint: t.hint,
    on: S.drawPrefs.tool === t.key,
    onclick: () => { S.drawPrefs.tool = t.key; render(); },
  })));

  // Only worth offering where it changes something: on a 32-square sprite a
  // 16-wide brush is most of the picture. The brush is a standing choice, so
  // one carried over from a big picture is brought back down here rather than
  // painting a whole small one in a single dab.
  const available = BRUSHES.filter((n) => n === 1 || n <= Math.min(picture.width, picture.height) / 4);
  if (!available.includes(S.drawPrefs.brush)) S.drawPrefs.brush = available[available.length - 1];

  const brushes = h('div', { class: 'row wrap' },
    h('span', { class: 'hint muted', text: 'Brush' }),
    available.map((n) => h('button', {
      class: `quiet tiny${S.drawPrefs.brush === n ? ' on' : ''}`,
      text: n === 1 ? '1 pixel' : `${n}`,
      title: `Paint ${n} pixel${n === 1 ? '' : 's'} across`,
      onclick: () => { S.drawPrefs.brush = n; render(); },
    })));

  // The game's colours, two rows of sixteen. Choosing one says both "draw with
  // this" and "this is the one the colour box and the eyedropper will change".
  const colours = paletteColours();
  const chips = colours.map((hex, i) => h('button', {
    class: `swatch${S.drawPrefs.slot === i ? ' on' : ''}`,
    style: `background:${hex}`,
    title: `${hex} — click to draw with it; the colour box and the eyedropper change the one you have chosen`,
    'aria-label': `Colour ${i + 1}, ${hex}`,
    onclick: () => {
      S.drawPrefs.slot = i;
      if (S.drawPrefs.tool === 'eraser') S.drawPrefs.tool = 'pencil';
      render();
    },
  }));

  const well = h('input', {
    type: 'color',
    title: `Change the square you have chosen — this edits ${LOOK_FILE}`,
    'aria-label': 'Change the chosen colour',
  });
  well.value = colours[S.drawPrefs.slot] ?? PALETTE[0];
  // Dragging around a colour picker fires input continuously. The square is
  // repainted in place so the picker is not replaced under the pointer, and
  // only letting go writes the file.
  well.addEventListener('input', () => {
    const chip = chips[S.drawPrefs.slot];
    if (chip) chip.style.background = well.value;
  });
  well.addEventListener('change', () => setPaletteColour(S.drawPrefs.slot, well.value));

  const swatches = h('div', { class: 'col' },
    h('div', { class: 'swatches' }, chips),
    h('div', { class: 'row wrap' },
      well,
      h('span', {
        class: 'hint muted',
        text: S.palette?.dirty
          ? `Colours change ${LOOK_FILE} when you save`
          : S.palette?.from
            ? `Colours from ${LOOK_FILE}`
            : `The studio's colours — changing one writes ${LOOK_FILE}`,
      }),
      h('div', { class: 'spacer' }),
      S.palette?.from
        ? h('button', {
          class: 'link tiny',
          text: 'See them',
          title: `Open ${LOOK_FILE}`,
          onclick: () => openFile(LOOK_FILE),
        })
        : null));

  paint();
  return h('div', { class: 'drawing grow' },
    h('div', { class: 'media grow' }, canvas),
    h('div', { class: 'pad col' }, tools, brushes, swatches),
    h('div', { class: 'editor-bar row' },
      state,
      h('span', { class: 'hint muted', text: `${picture.width} × ${picture.height}` }),
      h('div', { class: 'spacer' }),
      iconButton({
        name: 'undo',
        label: 'Undo',
        hint: 'take back the last thing you drew (⌘Z)',
        disabled: !S.draw.undo.length,
        onclick: () => stepDrawing(true),
      }),
      iconButton({
        name: 'redo',
        label: 'Redo',
        hint: 'put back what you just took back (⇧⌘Z)',
        disabled: !S.draw.redo.length,
        onclick: () => stepDrawing(false),
      }),
      save));
}

// How big a file can be and still be recoloured on every keystroke without
// the keystroke feeling it. Past this the editor is the plain textarea again.
const HIGHLIGHT_MAX = 128 * 1024;

// The text editor's colours: the same characters tokenized and painted on a
// <pre> underneath, with the textarea's own ink turned transparent — so the
// caret, the selection, the focus snapshot and the save flow all still belong
// to the textarea, and what is typed is exactly what is saved. Repainted in
// place on input rather than through render(), like every other live surface;
// the repaint listener lands after the oninput that stores the content, so it
// reads what was just typed.
function codeBox(area, path) {
  const lang = langFor(path);
  if (!lang || area.value.length > HIGHLIGHT_MAX) return area;
  const pre = h('pre', { class: 'code-hl', 'aria-hidden': 'true' });
  const paint = () => {
    pre.replaceChildren();
    for (const tok of tokenize(area.value, lang)) {
      pre.append(tok.cls ? h('span', { class: `tok-${tok.cls}`, text: tok.text }) : tok.text);
    }
    // A <pre> swallows a final newline where a textarea shows an empty last
    // line; the extra space keeps their bottoms level.
    if (area.value.endsWith('\n')) pre.append(' ');
  };
  area.addEventListener('input', paint);
  area.addEventListener('scroll', () => {
    pre.scrollTop = area.scrollTop;
    pre.scrollLeft = area.scrollLeft;
  });
  paint();
  return h('div', { class: 'code' }, pre, area);
}

function renderFilesTab() {
  const controls = libraryOffer('input');
  const rows = S.files.map((f) => h('div', {
    class: `file${S.open?.path === f.path ? ' open' : ''}${f.unreachable ? ' unreachable' : ''}${f.library ? ' library' : ''}`,
    // The whole row opens the file, not just the name on it. The row is what
    // lights up under the pointer, and the size, the gap and the padding used
    // to be lit and dead at the same time. An unreachable row does neither.
    onclick: f.unreachable ? null : () => chooseFile(f.path),
  },
  h('input', {
    type: 'checkbox',
    // Pinning a library file would push the thing deliberately kept out of a
    // helper's context straight back into it.
    title: f.library
      ? 'A studio library — helpers can call it without being shown it'
      : 'Pin this file so helpers look at it',
    checked: S.pinned.has(f.path),
    disabled: f.unreachable || f.library,
    // Its own control, inside a row that is also one: pinning a file is not
    // asking to open it.
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => {
      if (e.currentTarget.checked) S.pinned.add(f.path);
      else S.pinned.delete(f.path);
      render();
    },
  }),
  // No handler of its own — the click reaches the row. Still a button so the
  // row can be got at by keyboard.
  h('button', { class: 'fname', text: f.path, disabled: f.unreachable }),
  h('span', { class: 'fsize', text: sizeText(f.size) })));

  const editor = [];
  if (S.open) {
    // One bar for both cases: a picture has nothing to edit but still has to
    // be closable, and Close belongs next to Delete either way.
    const bar = h('div', { class: 'bar' },
      h('div', { class: 'title mono', text: S.open.path }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'link tiny', text: 'Versions',
        onclick: () => { S.tab = 'versions'; loadHistory(S.open.path); },
      }),
      h('button', {
        class: 'quiet tiny', text: 'Rename',
        disabled: S.project.archived,
        onclick: () => { S.dialog = { kind: 'rename-file', path: S.open.path }; render(); },
      }),
      h('button', {
        class: 'danger tiny', text: 'Delete',
        onclick: () => { S.dialog = { kind: 'delete-file', path: S.open.path }; render(); },
      }),
      h('button', {
        class: 'icon tiny', text: '✕', title: 'Close this file',
        // Wrapped, not passed: closeOpenFile's first argument is the file to
        // open next, and handing it the click event asked for a file named
        // "[object PointerEvent]" instead of closing anything.
        onclick: () => closeOpenFile(),
      }));

    // A config file opens as fields rather than code, unless it holds something
    // the reader will not touch, or you asked to see the text.
    const parsed = isConfigPath(S.open.path) && S.open.content !== null
      ? parseConfigFile(S.open.content)
      : null;

    if (S.open.content === null) {
      editor.push(h('div', { class: 'editor' }, bar,
        S.draw ? renderDrawing() : renderMedia(S.open),
        S.drawRefused ? h('div', { class: 'pad hint muted', text: S.drawRefused }) : null));
    } else if (parsed?.ok && !S.open.asText) {
      editor.push(h('div', { class: 'editor' }, bar, renderConfigForm(parsed.decls)));
    } else {
      const area = h('textarea', {
        id: EDITOR_AREA,
        spellcheck: 'false',
        oninput: (e) => {
          S.open.content = e.currentTarget.value;
          S.open.dirty = true;
          const save = document.getElementById('save-btn');
          if (save) save.disabled = false;
        },
      });
      area.value = S.open.content;
      editor.push(h('div', { class: 'editor' },
        bar,
        // Why a config file is showing as text: either you asked, or it holds
        // something the form will not pretend to understand.
        parsed && !parsed.ok
          ? h('div', { class: 'pad hint muted' }, `Showing the text because ${parsed.reason}.`)
          : null,
        codeBox(area, S.open.path),
        h('div', { class: 'editor-bar row' },
          h('span', { class: 'hint muted', text: S.open.dirty ? 'Not saved yet' : 'Saved' }),
          h('div', { class: 'spacer' }),
          parsed?.ok
            ? h('button', {
              class: 'link', text: 'Show the fields',
              onclick: () => { S.open.asText = false; render(); },
            })
            : null,
          h('button', {
            class: 'filled', id: 'save-btn', text: 'Save',
            disabled: !S.open.dirty || S.project.archived,
            onclick: () => saveOpenFile(),
          }))));
    }
  }

  // The picker is what makes uploading work on a tablet, where there is
  // nothing to drag from. Hidden because the styled button opens it.
  const picker = h('input', {
    type: 'file', multiple: true, hidden: true,
    onchange: (e) => {
      const files = [...e.currentTarget.files];
      // Cleared so picking the same file twice in a row still fires.
      e.currentTarget.value = '';
      if (files.length) openUpload(files);
    },
  });

  // With a file open the list shrinks to about five rows and the editor takes
  // everything else; with nothing open the list fills the pane.
  const tree = h('div', { class: `tree scroll${S.open ? ' short' : ''}`, 'data-scroll': 'files' },
    rows.length ? rows : h('div', {
      class: 'pad muted',
      text: 'No files yet. Ask a helper to make one, or drop a file here.',
    }));
  if (!S.project.archived) makeDropTarget(tree);

  return [
    h('div', { class: 'pad row wrap' },
      h('button', {
        class: 'quiet tiny', text: '+ New file',
        disabled: S.project.archived,
        onclick: () => { S.dialog = { kind: 'new-file' }; render(); },
      }),
      h('button', {
        class: 'quiet tiny', text: '+ Upload',
        title: 'Put any file from this device into the game',
        disabled: S.project.archived,
        onclick: () => picker.click(),
      }),
      picker,
      h('button', {
        class: 'quiet tiny', text: '+ Draw a picture',
        title: 'Draw a sprite and put it in assets/',
        disabled: S.project.archived,
        onclick: () => { S.dialog = { kind: 'draw-new', size: 64, name: 'sprite' }; render(); },
      }),
      h('button', {
        class: 'quiet tiny', text: '+ Make a sound',
        title: 'Make a sound effect and put it in assets/',
        disabled: S.project.archived,
        onclick: () => {
          S.dialog = { kind: 'sound', sound: soundFrom('pickup'), name: 'pickup' };
          render();
        },
      }),
      // Gone once the game has it and it is current. It used to sit there with
      // nothing to do, which reads as a button that does not work.
      controls ? h('button', {
        class: 'quiet tiny', text: controls.label,
        title: controls.updating
          ? `${controls.library.what} This game has an older one.`
          : controls.library.what,
        disabled: S.project.archived,
        onclick: () => installLibrary('input'),
      }) : null,
      h('div', { class: 'spacer' }),
      S.pinned.size
        ? h('button', { class: 'quiet tiny', text: 'Unpin all', onclick: () => { S.pinned.clear(); render(); } })
        : null),
    tree,
    ...editor,
  ];
}

// What the game reported while someone was playing it. Shown here because
// this is where you were when it happened; the helpers get the same list as
// text on the next message, which is the only way they can ever see it.
//
// The panel is built empty and filled in place, so a problem arriving mid-game
// never costs a re-render — see the game.errors event.
function paintProblems() {
  if (!problemNodes) return;
  const { box, list } = problemNodes;
  box.hidden = S.errors.length === 0;
  list.replaceChildren(...S.errors.map((e) => h('div', { class: 'problem' },
    e.location ? h('span', { class: 'where', text: e.location }) : null,
    h('span', { text: e.message }),
    e.times > 1 ? h('span', { class: 'muted', text: ` (${e.times} times)` }) : null)));
  // The only sign of trouble when you are looking at another tab.
  if (problemNodes.tab) problemNodes.tab.textContent = S.errors.length ? 'Play ⚠' : 'Play';
}

function renderProblems() {
  const list = h('div', { class: 'problem-list' });
  const box = h('div', { class: 'problems' },
    h('div', { class: 'problems-head', text: 'The game ran into trouble' }),
    list,
    h('div', { class: 'hint muted', text: 'Your helpers can see this. Ask them to fix it.' }));
  problemNodes = { box, list, tab: null };
  paintProblems();
  return box;
}

function renderPlayTab() {
  // The preview loads the studio's wrapper — the game's own index.html with
  // the reporter injected — while the link beside it, and everyone playing,
  // gets the untouched page. That is why no game carries a script tag for
  // this and why every game already reports.
  const url = `${S.project.play_url}_studio.html?v=${S.previewNonce}`;
  return [h('div', { class: 'scroll', 'data-scroll': 'play' },
    h('div', { class: 'preview-wrap' },
      h('div', { class: 'row' },
        h('button', { class: 'quiet tiny', text: '⟳ Reload', onclick: () => { S.previewNonce += 1; render(); } }),
        h('div', { class: 'spacer' }),
        h('a', { href: S.project.play_url, target: '_blank', rel: 'noreferrer' },
          h('button', { class: 'quiet tiny', text: 'Open in a tab' }))),
      h('iframe', { class: 'preview-frame', src: url, title: 'Game preview' }),
      renderProblems(),
      h('div', { class: 'hint muted', text: 'Anyone with the link can play this. It updates as soon as a file changes.' }),
      h('div', { class: 'mono muted', text: S.project.play_url }),
      h('div', { class: 'row' },
        h('button', {
          class: S.project.published ? 'quiet tiny' : 'filled tiny',
          text: S.project.published ? 'Take out of the games list' : 'Put in the games list',
          title: 'The games list is the page everyone sees at the games address',
          onclick: () => setPublished(!S.project.published),
        }),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'quiet tiny', text: 'Make a copy',
          title: 'Start a new game from a copy of this one',
          onclick: () => { S.dialog = { kind: 'fork' }; render(); },
        })),
      h('div', {
        class: 'hint muted',
        text: S.project.published
          ? 'This game is in the list everyone can see.'
          : 'Not in the list yet. It still works for anyone with the link.',
      })))];
}

// Drag the rail's left edge. Pointer capture keeps the drag on this element,
// and the width is written straight to the shell as a CSS variable so a drag
// never re-renders the pane it is resizing.
function railGrip() {
  const grip = h('div', { class: 'rail-grip', title: 'Drag to make this wider or narrower' });
  grip.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    grip.setPointerCapture(down.pointerId);
    const app = document.querySelector('.app');
    const move = (event) => {
      S.railWidth = railClamp(window.innerWidth - event.clientX);
      app.style.setProperty('--rail', `${S.railWidth}px`);
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      prefs.set('rail', S.railWidth);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  return grip;
}

function renderRail() {
  if (!S.project) return h('div', { class: 'pane rail' }, railGrip());

  const tab = (id, label) => h('button', {
    class: `tiny${S.tab === id ? ' on' : ''}`,
    text: label,
    onclick: async () => {
      // Clicking Versions means all of them, the same as Show all. A list
      // filtered to one file is somewhere you arrive from that file, not a
      // state the tab should hold on to. Held and awaited, or the render below
      // would write the filter's address on the way to dropping it.
      await urlAs('hold', async () => {
        S.tab = id;
        if (id === 'versions' && historyNeedsLoad(null)) await loadHistory(null);
      });
      render();
    },
  });

  let body = [];
  if (S.tab === 'play') body = renderPlayTab();
  else if (S.tab === 'versions') body = renderVersionsTab();
  else body = renderFilesTab();

  // The badge is the only sign of trouble when you are looking at another tab.
  // Handed to the problems panel so a problem arriving mid-game can update it
  // without a render.
  const playTab = tab('play', S.errors.length ? 'Play ⚠' : 'Play');
  if (problemNodes) problemNodes.tab = playTab;

  return h('div', { class: `pane rail${S.narrowPane === 'rail' ? ' show' : ''}` },
    railGrip(),
    h('div', { class: 'bar' },
      h('button', { class: 'quiet only-narrow', text: '←', onclick: () => { S.narrowPane = 'chat'; render(); } }),
      h('div', { class: 'tabs' }, tab('files', 'Files'), playTab, tab('versions', 'Versions'))),
    ...body);
}

/* Render ------------------------------------------------------------------ */

// The open dialog's node, kept for as long as that dialog is open. A dialog
// is built once and every later render re-appends the same node, because a
// background render — a helper's commit landing, the banner timer firing —
// must never rebuild a form somebody is typing into: rebuilding is what wiped
// the name out of New file when a save's files.changed arrived a moment
// later. The state object is the key: every open makes a fresh object, so a
// new dialog is a new node, and closing clears both. Same bargain as the
// composer: the node surviving is what keeps the words.
let dialogShown = { for: null, node: null };

export function render() {
  const focus = focusSnapshot();
  const scrolls = scrollSnapshot();
  // Rebuilt by the Play tab if it is on screen; null means an arriving
  // problem has nothing live to paint into and needs a full render.
  problemNodes = null;
  root.replaceChildren();

  if (S.loading) {
    root.append(h('div', { class: 'auth-page' }, h('p', { class: 'muted', text: 'Loading…' })));
    return;
  }
  if (!S.me) {
    root.append(renderAuth());
    return;
  }

  // A chat has no files, versions or preview, so it has no rail at all and
  // the thread takes the whole width.
  const app = h('div', {
    class: `app${S.sidebar ? '' : ' side-closed'}${isChat() ? ' no-rail' : ''}`,
    style: `--rail:${S.railWidth}px`,
  }, renderSidebar(), renderChat(), isChat() ? null : renderRail());
  root.append(app);

  // At the top, where the banner is at the bottom: this one is not a thing
  // that just happened, it is how things are until they are not.
  if (!S.connected) {
    root.append(h('div', { class: 'offline' },
      h('strong', { text: 'Not connected.' }),
      ' Trying again — what you have typed is safe.'));
  }

  if (S.banner) {
    const banner = h('div', {
      class: `notice${S.banner.bad ? ' bad' : ''}`,
      style: 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:200;max-width:min(560px,92vw)',
      text: S.banner.message,
    });
    root.append(banner);
    clearTimeout(render.bannerTimer);
    render.bannerTimer = setTimeout(() => {
      S.banner = null;
      render();
    }, 6000);
  }

  if (S.dialog) {
    if (dialogShown.for !== S.dialog) {
      dialogShown = { for: S.dialog, node: dialogFor(S.dialog) };
    }
    if (dialogShown.node) root.append(dialogShown.node);
  } else if (dialogShown.node) {
    dialogShown = { for: null, node: null };
  }

  restoreScroll(scrolls);
  restoreFocus(focus);
  // After restoreScroll, both of them: sticking the thread to the bottom and
  // pulling the open file into view are deliberate overrides of where the list
  // used to be.
  stickToBottom();
  keepOpenFileInView();
  keepDiffInView();
  // Last, so the URL is written from the state that actually made it onto the
  // screen.
  syncUrl();
}

// A file dropped anywhere but the list would otherwise be opened by the
// browser, navigating away from the studio and taking any unsaved edit with it.
// Missing the list has to mean nothing happened.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => { if (isFileDrag(e)) e.preventDefault(); });
}

start();
