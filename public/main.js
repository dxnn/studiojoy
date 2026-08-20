// Game Studio — the whole client. Vanilla, no build step, no framework.
// Structural changes re-render a pane; streaming text mutates live nodes in
// place so a long reply doesn't rebuild the thread on every chunk.

import { parseConfigFile, literalFor, spliceValue } from './config-file.js';
import { patchFor, hasHunks, renameIn } from './patch.js';
import {
  SOUND_PARAMS, SOUND_PRESETS, WAVES, soundFrom, randomSound, soundBytes,
} from './sound-maker.js';
import {
  PALETTE, PALETTE_COLUMNS, SIZES, BRUSHES, MAX_SIDE, UNDO_BYTES, CLEAR,
  blankPicture, pictureFrom, pixelAt, drawLine, floodFill,
  beginStep, endStep, applyStep, stepBytes,
  rgbaOf, hexOf, clampSide, isColour,
} from './pixel-editor.js';

const root = document.getElementById('root');

/* DOM ---------------------------------------------------------------------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* Icons -------------------------------------------------------------------- */

// h() makes HTML elements, and an <svg> built with createElement is inert —
// SVG needs its own namespace. Small enough to keep separate rather than
// teaching h() about namespaces it would use nowhere else.
const SVG_NS = 'http://www.w3.org/2000/svg';

// Drawn in outline from currentColor, so a tool that is on inherits the filled
// button's ink without a second copy of the icon.
const ICONS = {
  pencil: ['M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
  eraser: ['M9 20H6l-3-3 10-10 6 6-7 7z', 'M4 21h16', 'M8 10l6 6'],
  bucket: ['M6 13l7-7 6.5 6.5-7 7L6 13z', 'M13 6 9.5 2.5', 'M19.5 15.5c1.2 1.7 1.2 3.5 0 3.5s-1.2-1.8 0-3.5z'],
  // A round bulb, because the first draft was a tapered diagonal body and read
  // as a second pencil sitting next to the pencil.
  dropper: ['M3 21l1-3.6 7.8-7.8 2.6 2.6L6.6 20 3 21z', 'M12.8 9.6l2.6 2.6', 'M14.5 6.5a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0'],
  undo: ['M2 5v6h6', 'M4.6 15.5a9 9 0 1 0 1.9-9.2L2 11'],
  redo: ['M22 5v6h-6', 'M19.4 15.5a9 9 0 1 1-1.9-9.2L22 11'],
};

function icon(name, size = 17) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // The words are on the button's title and aria-label; the picture is
  // decoration on top of them.
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// An icon button always carries the words too: a picture nobody recognises is
// only a button you have to press to find out about.
const iconButton = ({ name, label, hint, on = false, disabled = false, onclick }) => h('button', {
  class: `icon-btn${on ? ' on' : ''}`,
  title: hint ? `${label} — ${hint}` : label,
  'aria-label': label,
  'aria-pressed': on ? 'true' : null,
  disabled,
  onclick,
}, icon(name));

/* Saved preferences -------------------------------------------------------- */

// Layout is a per-person, per-device choice, so it lives in localStorage
// rather than in the database.
const prefs = {
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

const S = {
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
const composerBox = h('textarea', {
  onkeydown: (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendComposer();
    }
  },
  oninput: () => { if (S.slug) S.drafts.set(S.slug, composerBox.value); },
});

async function sendComposer() {
  const text = composerBox.value.trim();
  if (!text) return;
  composerBox.value = '';
  S.drafts.delete(S.slug);
  S.autoscroll = true;
  await sendMessage(text);
}

// The node surviving is not enough: removing it from the document blurs it
// and drops the caret. Both are put back after the tree is rebuilt.
const EDITOR_AREA = 'editor-area';

function focusSnapshot() {
  const el = document.activeElement;
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
  const el = snap.composer ? composerBox : document.getElementById(EDITOR_AREA);
  if (!el) return;
  el.focus();
  el.setSelectionRange(snap.start, snap.end);
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

const isChat = () => S.project?.kind === 'chat';

// A picture is the first file whose byte count nobody can read, so sizes are
// rounded once they leave kilobyte territory.
const sizeText = (bytes) => (bytes < 1024
  ? `${bytes} bytes`
  : bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

const agentName = (id) => S.project?.agents.find((a) => a.agent_id === id)?.name
  ?? S.agents.find((a) => a.id === id)?.name
  ?? 'Helper';

/* API --------------------------------------------------------------------- */

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
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
  return { status: res.status, ok: res.ok, body: parsed, headers: res.headers };
}

function say(message, bad = false) {
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
async function urlAs(mode, fn) {
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
const historyNeedsLoad = (path) => path !== S.historyPath
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

async function loadProjects() {
  const res = await api('GET', '/api/projects');
  if (res.ok) S.projects = res.body;
}

async function loadAgents() {
  const res = await api('GET', '/api/agents');
  if (res.ok) S.agents = res.body;
}

// The address is render()'s to write — opening a game only sets the state.
// Wrap the call in urlAs('replace', …) when it is not a navigation.
async function openProject(slug, { view = null } = {}) {
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
  // about anything missed while disconnected.
  stream.addEventListener('open', () => {
    if (S.slug) refreshFiles();
  });
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

function toolLabel(tool) {
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

async function refreshFiles() {
  if (!S.slug) return;
  const res = await api('GET', `/api/projects/${S.slug}/files`);
  if (res.ok) {
    S.files = res.body.files;
    render();
  }
}

async function openFile(path) {
  // Colours changed in the editor ride along with whatever leaves it, so
  // switching files saves them instead of dropping them.
  await flushPalette();
  const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (!res.ok) {
    say(`Could not open ${path}.`, true);
    return;
  }
  // The listing already said whether this is text and what it is; a picture
  // opens with content null and is shown rather than edited.
  const entry = S.files.find((f) => f.path === path);
  S.open = {
    path,
    mime: entry?.mime ?? null,
    content: entry?.text ? await res.text() : null,
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
const chooseFile = (path) => (S.open ? closeOpenFile(path) : openFile(path));

async function saveOpenFile({ force = false } = {}) {
  if (!S.open) return;
  const headers = { 'content-type': 'text/plain' };
  if (!force && S.open.etag) headers['if-match'] = S.open.etag;
  const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(S.open.path)}`, {
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
    say(body?.error ?? 'Could not save that file.', true);
    return;
  }
  S.open.etag = body.etag;
  S.open.dirty = false;
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${S.open.path}.`);
}

async function createFile(path) {
  const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
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

/* Uploads ----------------------------------------------------------------- */

// Where a picture or sound lands unless you say otherwise. The agent preamble
// names the same folder, so a dropped sprite is already at the path a helper
// will write in its code.
const ASSET_DIR = 'assets';

// Mirrors MAX_FILE_BYTES in server/files/tree.js. Checked here too so an
// oversized file is named in the dialog rather than failing halfway up.
const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// A dropped file's name becomes a project path: lowercased, runs of anything
// that isn't a letter or digit become one dash, the extension kept. The server
// validates the result regardless — this is so `My Hero (2).PNG` lands
// somewhere a ten-year-old can say out loud.
function assetPath(folder, filename) {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  const stem = (dot > 0 ? filename.slice(0, dot) : filename)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    // A name of nothing but punctuation would otherwise leave `.png` alone,
    // which is a hidden file rather than a picture.
    || 'file';
  return folder ? `${folder}/${stem}${ext}` : `${stem}${ext}`;
}

// What an upload would do, worked out before anything is sent so the dialog can
// show it: where each file lands, whether it replaces one already there, and
// the reason a file is being left out.
function uploadPlan(folder, files) {
  const taken = new Set();
  return files.map((file) => {
    const path = assetPath(folder, file.name);
    let problem = null;
    if (file.size > MAX_UPLOAD_BYTES) {
      problem = `too big — ${MAX_UPLOAD_MB} MB is the most`;
    } else if (taken.has(path)) {
      // Two dropped files can tidy down to one name. Letting the second
      // overwrite the first is the kind of loss nobody thinks to look for.
      problem = 'another one of these wants the same name';
    } else {
      // Only a file that is actually going to be sent holds the name — a
      // rejected one must not block the next file that wants it.
      taken.add(path);
    }
    return {
      file,
      path,
      problem,
      note: S.files.some((f) => f.path === path)
        ? 'replaces the one there now'
        : file.type
          ? sizeText(file.size)
          : `${sizeText(file.size)} — the game may not be able to use this`,
    };
  });
}

// One PUT per file, one commit each — the same thing a helper does when it
// writes several files. No If-Match: these replace on purpose, and whatever
// asked for them already said which files it would replace.
async function writeFiles(plan) {
  let done = 0;
  let failure = null;
  for (const { path, body } of plan) {
    const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
      method: 'PUT', body,
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => null);
      failure = uploadProblem(res.status, path, parsed?.error);
      // Whatever stopped this one stops the rest, and a banner per file would
      // bury the reason.
      break;
    }
    done += 1;
  }

  S.previewNonce += 1;
  await refreshFiles();
  return { done, failure };
}

async function uploadFiles(plan) {
  if (plan.length > 1) say(`Adding ${plan.length} things…`);
  const { done, failure } = await writeFiles(plan.map(({ path, file }) => ({ path, body: file })));
  if (failure) {
    say(done ? `${failure} ${done} of ${plan.length} got added.` : failure, true);
    return;
  }
  say(plan.length === 1 ? `Added ${plan[0].path}.` : `Added ${plan.length} files.`);
  // One file is something you want to look at; twelve sprites are not.
  if (plan.length === 1) await openFile(plan[0].path);
}

// The server's limits are exact and in bytes; the same fact has to arrive in
// words. Which cap was hit doesn't change what you'd do about it, so both
// 409s read the same. Anything unmapped keeps the server's own sentence.
function uploadProblem(status, path, error) {
  if (status === 413) {
    return `${path} is too big to add. One file can be up to ${MAX_UPLOAD_MB} MB.`;
  }
  if (status === 409) return `There is no room for ${path} — this game is full.`;
  return error ?? `Could not add ${path}.`;
}

const openUpload = (files) => { S.dialog = { kind: 'upload', files }; render(); };

// Dropping onto the list is the quickest way in on a laptop; the button beside
// New file is the one that works on a tablet. Both end in the same dialog.
// The highlight is toggled on the node rather than through render(), which
// would rebuild the element mid-drag and lose the drop.
function makeDropTarget(el) {
  const mark = (on) => el.classList.toggle('dropping', on);
  el.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    mark(true);
  });
  el.addEventListener('dragleave', (e) => { if (e.target === el) mark(false); });
  el.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    mark(false);
    const files = [...e.dataTransfer.files];
    if (files.length) openUpload(files);
  });
}

const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

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
const LIBRARY_DIR = 'studio';
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
  const res = await fetch(LIBRARY_INDEX);
  if (!res.ok) return null;
  return (await res.json()).libraries ?? null;
}

// What this game has, by library name. Absent or unreadable reads as "none",
// which is the same thing as far as installing goes.
async function gameLibraries() {
  if (!S.files.some((f) => f.path === LIBRARY_MANIFEST)) return {};
  const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(LIBRARY_MANIFEST)}`);
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
    const res = await fetch(libraryFile(name, file));
    if (!res.ok) { say(`Could not read ${file} from the studio library.`, true); return; }
    writes.push({ path: `${LIBRARY_DIR}/${file}`, body: await res.text() });
  }

  // The game's own companion files, written once. Replacing config/controls.js
  // would throw away buttons somebody chose.
  const kept = [];
  for (const seed of library.seeds ?? []) {
    if (S.files.some((f) => f.path === seed.to)) { kept.push(seed.to); continue; }
    const res = await fetch(seed.from);
    if (!res.ok) { say(`Could not read ${seed.to} from the studio library.`, true); return; }
    writes.push({ path: seed.to, body: await res.text() });
  }

  writes.push({ path: LIBRARY_MANIFEST, body: `${JSON.stringify({ ...held, [name]: library.version }, null, 2)}\n` });

  if (S.files.some((f) => f.path === 'index.html') && library.scripts?.length) {
    const res = await fetch(`/api/projects/${S.slug}/files/${encodePath('index.html')}`);
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
  const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(S.open.path)}`);
  if (!res.ok) { say('Could not open that picture.', true); return; }
  const bitmap = await createImageBitmap(await res.blob()).catch(() => null);
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
  if (S.drawPrefs.slot >= paletteColours().length) S.drawPrefs.slot = 0;
  render();
}

async function createPicture(name, width, height) {
  const path = assetPath(ASSET_DIR, `${name || 'picture'}.png`);
  const { failure } = await writeFiles([{ path, body: await pictureBlob(blankPicture(width, height)) }]);
  if (failure) { say(failure, true); return; }
  say(`Made ${path}.`);
  await openFile(path);
  await startDrawing();
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
  const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(LOOK_FILE)}`);
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
  fetch(`/api/projects/${S.slug}/files/${encodePath(LOOK_FILE)}`, {
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
    const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
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
    if (!res.ok) { say(body?.error ?? 'Could not save that picture.', true); return; }
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

/* Sounds ------------------------------------------------------------------ */

// Plain words for the four shapes, with the real name kept: a ten-year-old
// picks "buzzy", and the one who wants to know what a square wave is can see
// it. Same bargain as helper/agent.
const WAVE_WORDS = {
  square: 'Buzzy (square)', saw: 'Sharp (saw)', sine: 'Smooth (sine)', noise: 'Noisy (noise)',
};

const SOUND_WORDS = {
  pickup: 'Pick up', laser: 'Laser', explosion: 'Explosion', powerup: 'Power up',
  hit: 'Hit', jump: 'Jump', blip: 'Blip',
};

let soundUrl = null;

// The bytes played are the bytes that would be saved, so there is no way to
// hear one thing and keep another. The last URL is let go on the next play
// rather than on a timer: an object URL held forever is a leak, and one
// revoked too early is a sound that will not play twice.
function playSound(params) {
  if (soundUrl) URL.revokeObjectURL(soundUrl);
  soundUrl = URL.createObjectURL(new Blob([soundBytes(params)], { type: 'audio/wav' }));
  new Audio(soundUrl).play().catch(() => { /* a browser that will not autoplay */ });
}

async function saveSound(params, name) {
  const path = assetPath(ASSET_DIR, `${name || 'sound'}.wav`);
  const body = new Blob([soundBytes(params)], { type: 'audio/wav' });
  const { failure } = await writeFiles([{ path, body }]);
  if (failure) { say(failure, true); return; }
  say(`Saved ${path}.`);
  await openFile(path);
}

async function deleteFile(path) {
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

async function loadHistory(path = null) {
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
async function loadDiff(sha, { goTo = false } = {}) {
  const res = await api('GET', `/api/projects/${S.slug}/diff/${sha}`);
  if (res.ok) {
    S.diff = res.body;
    showDiffRow = showDiffRow || goTo;
    render();
  }
}

async function restore(sha, path) {
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
async function rollback(sha) {
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
async function attachAgent(agent) {
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

async function detachAgent(a) {
  const res = await api('DELETE', `/api/projects/${S.slug}/agents/${a.agent_id}`);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not take that helper out.', true);
    return;
  }
  S.project.agents = S.project.agents.filter((x) => x.agent_id !== a.agent_id);
  say(`${a.name} is no longer in this game.`);
}

async function toggleChatty(a) {
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
function syncAttached() {
  if (!S.project) return;
  const byId = new Map(S.agents.map((a) => [a.id, a]));
  S.project.agents = S.project.agents
    .filter((a) => byId.has(a.agent_id))
    .map((a) => ({ ...a, name: byId.get(a.agent_id).name, model: byId.get(a.agent_id).model }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* Messages ---------------------------------------------------------------- */

async function sendMessage(text) {
  const res = await api('POST', `/api/projects/${S.slug}/messages`, {
    body: text,
    context_paths: [...S.pinned],
  });
  if (!res.ok) say(res.body?.error ?? 'Could not send that.', true);
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

/* Render: sidebar --------------------------------------------------------- */

// The header of a foldable section. The marker is the affordance; the whole
// label is the hit area, because a 12px triangle is not one.
function sectionHead(id, label, add) {
  const open = S.sections[id];
  return h('div', { class: 'section-label row' },
    h('button', {
      class: 'sec-toggle',
      text: `${open ? '▾' : '▸'} ${label}`,
      title: open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`,
      onclick: () => {
        S.sections[id] = !open;
        prefs.set(`sec-${id}`, open ? 'closed' : 'open');
        render();
      },
    }),
    h('div', { class: 'spacer' }),
    add ? h('button', { class: 'icon tiny', text: '+', title: add.title, onclick: add.onclick }) : null);
}

function renderSidebar() {
  const rows = S.projects.filter((p) => p.kind !== 'chat').map((p) => h('button', {
    class: `item${p.slug === S.slug ? ' active' : ''}${p.archived ? ' archived' : ''}`,
    onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
  },
  h('div', { class: 'item-name', text: p.name }),
  h('div', { class: 'item-sub', text: p.preview || 'No messages yet' })));

  return h('div', { class: `pane side${S.narrowPane === 'games' ? ' show' : ''}` },
    h('div', { class: 'bar brand-bar' },
      h('div', { class: 'brand', text: 'Game Studio' }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'icon only-wide', text: '«', title: 'Hide this list',
        onclick: () => { S.sidebar = false; prefs.set('sidebar', 'closed'); render(); },
      })),
    h('div', { class: 'pad' },
      h('button', {
        class: 'filled', style: 'width:100%',
        text: '+ New game',
        onclick: () => { S.dialog = { kind: 'new-project' }; render(); },
      })),
    h('div', { class: 'section-label', text: 'Games' }),
    h('div', { class: 'scroll', 'data-scroll': 'games' },
      rows.length ? rows : h('div', { class: 'pad muted', text: 'No games yet. Make one!' })),
    renderChatList(),
    renderHelperList(),
    h('div', { class: 'who' },
      h('div', { class: 'name', text: S.me.display_name }),
      h('button', {
        class: 'quiet tiny', text: 'Sign out',
        onclick: async () => { await api('POST', '/api/logout'); location.href = '/'; },
      })),
  );
}

// A chat is a game with the game taken out: the same thread and the same
// helpers, no files and no preview.
function renderChatList() {
  const chats = S.projects.filter((p) => p.kind === 'chat');
  const head = sectionHead('chats', 'Chats', {
    title: 'Start a new chat',
    onclick: () => { S.dialog = { kind: 'new-project', chat: true }; render(); },
  });
  if (!S.sections.chats) return [head];

  const rows = chats.map((p) => h('div', { class: `srow${p.slug === S.slug ? ' sel' : ''}` },
    h('button', {
      class: 'hname', text: p.name, title: p.name,
      onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
    })));

  return [head, h('div', { class: 'small-list' },
    rows.length
      ? rows
      : h('div', { class: 'pad hint muted', text: 'No chats yet. Start one with +.' }))];
}

// Helpers belong to the studio, not to one game, so they live beside the game
// list. Which game a helper is *in* is shown and changed in that game's title
// bar instead.
function renderHelperList() {
  const attached = new Set((S.project?.agents ?? []).map((a) => a.agent_id));
  const canAdd = Boolean(S.project) && !S.project.archived;

  const rows = S.agents.map((agent) => {
    const here = attached.has(agent.id);
    return h('div', { class: `srow${here ? ' here' : ''}` },
      h('button', {
        class: 'hname',
        title: here
          ? `${agent.name} is in this game`
          : (canAdd ? `Put ${agent.name} in this game` : agent.name),
        disabled: here || !canAdd,
        onclick: () => attachAgent(agent),
      }, here ? h('span', { class: 'dot', text: '●' }) : null, agent.name),
      h('button', {
        class: 'icon tiny', text: '✎', title: `Change ${agent.name}`,
        onclick: () => { S.dialog = { kind: 'edit-agent', agent }; render(); },
      }));
  });

  const head = sectionHead('helpers', 'Helpers', {
    title: 'Make a new helper',
    onclick: () => { S.dialog = { kind: 'new-agent' }; render(); },
  });
  if (!S.sections.helpers) return [head];

  return [head, h('div', { class: 'small-list' },
    rows.length
      ? rows
      : h('div', { class: 'pad hint muted', text: 'No helpers yet. Make one with +.' }))];
}

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
// this helper was given the recent part of it and not the beginning.
function footnote(msg) {
  const parts = [];
  if (msg.tokens) parts.push(`${msg.tokens.toLocaleString()} tokens`);
  if (msg.trimmed) {
    parts.push(msg.trimmed === 1
      ? 'did not see the first message'
      : `did not see the first ${msg.trimmed} messages`);
  }
  return parts.length
    ? h('div', { class: 'tokens', text: parts.join(' · ') })
    : null;
}

function renderMessage(msg) {
  if (msg.kind === 'system') {
    return h('div', { class: 'msg system' }, h('div', { class: 'bubble', text: msg.body }));
  }
  const isAgent = msg.agent_id !== null;
  const who = isAgent
    ? agentName(msg.agent_id)
    : (msg.user_id === S.me.id ? 'You' : 'Someone');

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
    footnote(msg));
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
        S.sections.helpers = true;
        prefs.set('sec-helpers', 'open');
        S.dialog = { kind: 'new-agent' };
        render();
      },
    }), '.');
}

function renderChat() {
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
      h('div', { class: 'title', text: p.name }),
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
    scroller,
    h('div', { class: 'composer' },
      gap,
      box,
      h('div', { class: 'row' },
        h('span', { class: 'hint', text: pinNote }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'filled', text: 'Send', disabled: p.archived, onclick: sendComposer }))));
}

/* Render: right rail ----------------------------------------------------- */

/* Config form -------------------------------------------------------------- */

// Only under config/, and only .js — the shape spec.md §8 asks agents for.
const isConfigPath = (p) => /^config\/[^/]+\.js$/.test(p);

const looksLikeColour = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v);

// Where a value sits in the file: the declaration's name, then keys and list
// positions down to it — ['TRACKS', 1, 'width'].
function nodeAt(decls, path) {
  let node = decls.find((d) => d.name === path[0])?.node;
  for (const step of path.slice(1)) {
    if (!node) return null;
    node = typeof step === 'number'
      ? node.items?.[step]
      : node.props?.find((p) => p.key === step)?.node;
  }
  return node ?? null;
}

// One value changed. The file is re-read here rather than the nodes being kept
// from the last render for two reasons: a splice moves every offset after it,
// so a second edit against stale nodes would land in the wrong place; and
// re-rendering the pane on each change would replace the Save button under the
// pointer, so clicking Save right after typing would do nothing.
//
// The file is spliced, never regenerated, so comments and alignment survive.
function setConfigValue(path, kind, raw, input) {
  const parsed = parseConfigFile(S.open.content);
  const node = parsed.ok ? nodeAt(parsed.decls, path) : null;
  const literal = node === null ? null : literalFor(kind, raw);
  if (literal === null) {
    // A number left empty or filled with words changes nothing; put the field
    // back to what the file still says.
    if (input && node) input.value = String(node.value);
    return;
  }
  S.open.content = spliceValue(S.open.content, node, literal);
  S.open.dirty = true;
  const save = document.getElementById('save-btn');
  if (save) save.disabled = false;
  const status = document.getElementById('cfg-status');
  if (status) status.textContent = 'Not saved yet';
}

// Fields update on change rather than on every keystroke, so a half-typed
// number is never written into the file.
function configField(node, path) {
  if (node.kind === 'boolean') {
    return h('input', {
      type: 'checkbox',
      checked: node.value === true,
      onchange: (e) => setConfigValue(path, 'boolean', e.currentTarget.checked),
    });
  }
  if (node.kind === 'number') {
    const input = h('input', {
      type: 'number', step: 'any', class: 'cfg-num',
      onchange: (e) => setConfigValue(path, 'number', e.currentTarget.value, e.currentTarget),
    });
    input.value = String(node.value);
    return input;
  }
  if (node.kind === 'string' && looksLikeColour(node.value)) {
    const shown = h('span', { class: 'mono hint', text: node.value });
    const input = h('input', {
      type: 'color',
      onchange: (e) => {
        setConfigValue(path, 'string', e.currentTarget.value);
        shown.textContent = e.currentTarget.value;
      },
    });
    // <input type="color"> only speaks #rrggbb, so #fc0 is doubled up to show
    // it; that is only written back if a colour is actually picked.
    input.value = node.value.length === 4
      ? `#${node.value.slice(1).split('').map((c) => c + c).join('')}`
      : node.value;
    return h('span', { class: 'row' }, input, shown);
  }
  if (node.kind === 'string') {
    // A line with a newline in it is a paragraph, so it gets a box that shape.
    const multiline = node.value.includes('\n');
    const input = h(multiline ? 'textarea' : 'input', {
      class: 'cfg-text',
      ...(multiline ? { rows: 2 } : { type: 'text' }),
      onchange: (e) => setConfigValue(path, 'string', e.currentTarget.value),
    });
    input.value = node.value;
    return input;
  }
  // null, and anything else the reader allows but has no field for.
  return h('span', { class: 'mono hint muted', text: String(node.value) });
}

// A row per value, nesting for lists and groups. A list of groups — the tracks
// in a racing game, the levels in a platformer — comes out as one block per
// item, which is how it reads in the file too.
function configRows(label, node, path) {
  const comment = node.comment;
  if (node.kind === 'array' || node.kind === 'object') {
    const kids = node.kind === 'array'
      ? node.items.map((item, i) => configRows(`#${i + 1}`, item, [...path, i]))
      : node.props.map((p) => configRows(p.key, p.node, [...path, p.key]));
    return h('div', { class: 'cfg-group' },
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: label }),
        comment ? h('span', { class: 'hint muted', text: comment }) : null),
      h('div', { class: 'cfg-group-body' }, kids));
  }
  return h('label', { class: 'cfg-row' },
    h('span', { class: 'cfg-name mono', text: label }),
    configField(node, path),
    comment ? h('span', { class: 'hint muted', text: comment }) : null);
}

function renderConfigForm(decls) {
  const body = decls.length
    ? decls.map((d) => configRows(d.name, d.node, [d.name]))
    : [h('div', { class: 'pad muted', text: 'Nothing to change in here yet.' })];

  return [
    h('div', { class: 'scroll cfg', 'data-scroll': 'cfg' }, body),
    h('div', { class: 'editor-bar row' },
      h('span', {
        class: 'hint muted', id: 'cfg-status', text: S.open.dirty ? 'Not saved yet' : 'Saved',
      }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'link', text: 'Show the text',
        onclick: () => { S.open.asText = true; render(); },
      }),
      h('button', {
        class: 'filled', id: 'save-btn', text: 'Save',
        disabled: !S.open.dirty || S.project.archived,
        onclick: () => saveOpenFile(),
      })),
  ];
}

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
        area,
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

function renderDiff(patch) {
  const lines = patch.split('\n').map((line) => {
    let cls = null;
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
    else if (line.startsWith('@@')) cls = 'hunk';
    return h('span', { class: cls, text: `${line}\n` });
  });
  return h('pre', { class: 'diff' }, lines);
}

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|svg)$/i;

// The pictures in a version, narrowed to the file being read when the list is
// filtered to one: `paths` is the whole commit now, and a sprite that rode
// along in the same commit is not what a filtered list is about.
const imagesIn = (commit) => (commit?.paths ?? [])
  .filter((p) => IMAGE_PATH.test(p) && (!S.historyPath || p === S.historyPath));

// A picture as it was at one commit. git names a path in a commit that deleted
// it too, and there is nothing to show for that version, so a picture that
// will not load takes itself out rather than leaving a broken frame.
const versionImage = (sha, path, cls) => h('img', {
  class: cls,
  src: `/api/projects/${S.slug}/history/${sha}/${encodePath(path)}`,
  alt: path,
  loading: 'lazy',
  onerror: (e) => e.currentTarget.closest('.shot, .shot-big')?.remove(),
});

// A path, as a way back to the file it names — which is the usual reason to
// be reading about it. A path that is no longer in the game is plain text:
// there is nothing to open, and it says so on hover. So is an unreachable one,
// which the file list will not open either — a control that lights up and then
// answers with a red banner is the same fault in a different place.
function fileLink(path) {
  const entry = S.files.find((f) => f.path === path);
  if (entry && !entry.unreachable) {
    return h('button', { class: 'link', text: path, onclick: () => chooseFile(path) });
  }
  return h('span', {
    text: path,
    title: entry
      ? 'The studio cannot open this file — see the list under Files'
      : 'This file is not in the game any more',
  });
}

// The part of the open version being read: the whole commit, or one file's
// share of it. Kept until the version or the filter changes, because a whole
// commit can be hundreds of kilobytes and an open drawer is re-rendered by
// every chunk of an agent's reply.
let shownPatch = { key: null, patch: '' };

function patchShown() {
  const key = `${S.diff.sha}|${S.historyPath ?? ''}`;
  if (shownPatch.key !== key) {
    shownPatch = {
      key,
      patch: S.historyPath ? patchFor(S.diff.patch, S.historyPath) : S.diff.patch,
    };
  }
  return shownPatch.patch;
}

// The changes for one commit, opened inside its own row. Only ever one is
// open, because opening a second replaces S.diff — which is also what makes
// "the last one closes itself" true without any bookkeeping.
function diffDrawer() {
  // Filtered to one file, the drawer is about the file the header already
  // names, so listing it and labelling its picture would be that same path a
  // third and fourth time in one row.
  const oneFile = Boolean(S.historyPath);

  const paths = oneFile ? null : (S.diff.paths.length === 0
    ? ['nothing']
    : S.diff.paths.map((p, i) => [
      i ? ', ' : null,
      fileLink(p),
    ]));

  const pictures = imagesIn(S.diff);
  const patch = patchShown();
  const text = hasHunks(patch);
  // A version that only moved the file has no hunk and no picture in it, and
  // said nothing at all until it said this.
  const movedTo = !text && oneFile ? renameIn(patch) : null;

  return h('div', { class: 'drawer' },
    oneFile ? null : h('div', { class: 'hint muted' }, 'Changed: ', paths),
    pictures.map((p) => h('div', { class: 'shot-big' },
      oneFile ? null : h('div', { class: 'hint muted mono', text: p }),
      versionImage(S.diff.sha, p))),
    text ? renderDiff(patch) : null,
    movedTo ? h('div', { class: 'hint muted' }, 'Renamed to ', fileLink(movedTo)) : null,
    !text && !movedTo && !pictures.length
      ? h('div', { class: 'muted', text: 'Nothing to show for this one.' })
      : null);
}

// Links are for looking at something, buttons are for changing something. The
// distinction is the whole vocabulary of this list: Show changes, All files
// and All files changed are links; bringing a version back is a button.
function renderVersionsTab() {
  const header = h('div', { class: 'pad row' },
    // The name in the heading is the way back to the file: you got here from
    // it, and the usual next move is to go and change it.
    S.historyPath
      ? h('span', { class: 'hint muted' }, 'Versions of ', fileLink(S.historyPath))
      : h('span', { class: 'hint muted', text: 'All versions' }),
    h('div', { class: 'spacer' }),
    S.historyPath
      ? h('button', { class: 'link tiny', text: 'All files', onclick: () => loadHistory(null) })
      : null);

  const rows = S.history.map((c, i) => {
    const open = S.diff?.sha === c.sha;
    // One row's changes, open or shut. Every control that shows them is the
    // same control: the picture, and the words beside it.
    const toggle = () => {
      if (!open) return loadDiff(c.sha);
      S.diff = null;
      return render();
    };
    const pictures = imagesIn(c);
    // This list is git log for one path, newest first, so its first row is the
    // commit that produced the bytes on disk — bringing it back would commit
    // the file over itself. Unless that commit was the one that deleted it, in
    // which case bringing it back is the entire point.
    const current = S.historyPath && i === 0
      && S.files.some((f) => f.path === S.historyPath);
    return h('div', { class: `commit${open ? ' open' : ''}` },
      h('div', { class: 'subject', text: c.subject }),
      h('div', { class: 'meta' },
        h('span', { class: 'sha', text: c.short }), ' · ', c.author, ' · ',
        new Date(c.at).toLocaleString()),
      // A picture in a version is worth seeing without asking for it: the
      // question about a sprite is always "which one is that", and no amount
      // of reading a commit subject answers it.
      pictures.length
        ? h('div', { class: 'shots' }, pictures.map((p) => h('button', {
          class: 'shot',
          title: open ? `${p} — hide the details` : `${p} — see it big, and what else changed`,
          onclick: toggle,
        }, versionImage(c.sha, p))))
        : null,
      // Wrapped: three controls and a "Current version" do not fit a narrow
      // rail, and a label broken across two lines mid-phrase reads worse than
      // a control moved to the next line whole.
      h('div', { class: 'row wrap', style: 'margin-top:5px' },
        h('button', {
          class: 'link tiny',
          // One control in one place, its label saying which way it goes,
          // rather than a second control appearing beside it once it is open.
          text: open ? 'Hide changes' : 'Show changes',
          onclick: toggle,
        }),
        // From one file's history, the useful move is to go and look at the
        // whole version this file changed in — not to roll the project back,
        // which is a decision you make from the full list. `paths` is the
        // whole commit even here, so a version that touched nothing but the
        // file being read offers nothing: there is no rest of it to see.
        S.historyPath && c.paths.length > 1
          ? h('button', {
            class: 'link tiny', text: `All files changed (${c.paths.length})`,
            onclick: async () => {
              // Dropping the filter is on the way to the whole version, not
              // somewhere to come back to, so the two steps are one entry.
              await urlAs('hold', () => loadHistory(null));
              await loadDiff(c.sha, { goTo: true });
            },
          })
          : null,
        // Text, not a control: there is nowhere for it to go. It stays put in
        // the row rather than disappearing, so the newest version says what it
        // is instead of being the one row with nothing on the right.
        current ? h('span', { class: 'current', text: 'Current version' }) : null,
        S.historyPath && !current && !S.project.archived
          ? h('button', {
            class: 'quiet tiny', text: 'Bring this file back',
            onclick: () => {
              S.dialog = { kind: 'restore', sha: c.sha, path: S.historyPath, short: c.short };
              render();
            },
          })
          : null,
        !S.historyPath && !S.project.archived
          ? h('button', {
            class: 'quiet tiny', text: 'Bring everything back',
            onclick: () => {
              S.dialog = { kind: 'rollback', sha: c.sha, short: c.short };
              render();
            },
          })
          : null),
      open ? diffDrawer() : null);
  });

  // A diff whose commit is not in the list — older than the fifty this shows —
  // has nowhere to open, so it falls back to the foot of the list rather than
  // vanishing.
  const inList = S.history.some((c) => c.sha === S.diff?.sha);
  return [header, h('div', { class: 'scroll', 'data-scroll': 'versions' },
    rows.length ? rows : h('div', { class: 'pad muted', text: 'No versions yet.' }),
    S.diff && !inList ? h('div', { class: 'pad' }, diffDrawer()) : null)];
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

/* Render: dialogs -------------------------------------------------------- */

function dialogFor(d) {
  const close = () => { S.dialog = null; render(); };
  const wrap = (title, ...body) => h('div', { class: 'backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'dialog' }, h('h2', { text: title }), ...body));
  const cancel = h('button', { class: 'quiet', text: 'Cancel', onclick: close });
  // Room for a row of sliders. Everything else is a question with one answer
  // and stays narrow.
  const wide = (title, ...body) => {
    const node = wrap(title, ...body);
    node.firstChild.classList.add('wide');
    return node;
  };

  if (d.kind === 'new-project') {
    const chat = d.chat === true;
    const name = h('input', { placeholder: chat ? 'Silly ideas' : 'Space Racer' });
    const slug = h('input', { placeholder: chat ? 'silly-ideas (optional)' : 'space-racer (optional)' });
    const err = h('p', { class: 'error' });
    return wrap(chat ? 'New chat' : 'New game',
      h('label', { text: 'What is it called?' }), name,
      h('label', { text: 'Web address (letters, numbers and dashes)' }), slug,
      chat ? h('p', { class: 'hint muted', text: 'A chat is just for talking — no files, no game.' }) : null,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => {
          const body = { name: name.value.trim(), kind: chat ? 'chat' : 'game' };
          if (slug.value.trim()) body.slug = slug.value.trim();
          const res = await api('POST', '/api/projects', body);
          if (!res.ok) { err.textContent = res.body?.error ?? 'Could not make that.'; return; }
          close();
          await loadProjects();
          await openProject(res.body.slug);
        },
      })));
  }

  if (d.kind === 'rename') {
    const name = h('input');
    name.value = S.project.name;
    return wrap('Rename game',
      h('label', { text: 'New name' }), name,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Rename',
        onclick: async () => {
          const res = await api('PATCH', `/api/projects/${S.slug}`, { name: name.value.trim() });
          if (!res.ok) { say(res.body?.error ?? 'Could not rename it.', true); return; }
          close();
          await loadProjects();
          // Reopening the game you are already in is not somewhere new to go
          // Back from, even though it does clear the rail.
          await urlAs('replace', () => openProject(S.slug));
        },
      })));
  }

  // Only reachable for a game that is already archived: nothing in the
  // interface archives one any more.
  if (d.kind === 'archive') {
    return wrap('Work on this again?',
      h('p', { text: 'You will be able to change files and talk to helpers again.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Reopen it',
        onclick: async () => {
          await api('POST', `/api/projects/${S.slug}/archive`, { archived: false });
          close();
          // Reopening the game you are already in is not somewhere new to go
          // Back from, even though it does clear the rail.
          await urlAs('replace', () => openProject(S.slug));
        },
      })));
  }

  if (d.kind === 'new-file') {
    const path = h('input', { placeholder: 'js/game.js' });
    return wrap('New file',
      h('label', { text: 'Name it (use / for folders)' }), path,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => { close(); await createFile(path.value.trim()); },
      })));
  }

  // Nothing is sent until this is confirmed, so where each file lands is
  // visible before it lands there rather than being something to undo
  // afterwards. Any kind of file: what the studio can show it as is a separate
  // question, answered by MEDIA_KINDS when it is opened.
  if (d.kind === 'upload') {
    const folder = h('input', { placeholder: 'leave empty for the top of the game' });
    folder.value = ASSET_DIR;
    const list = h('div', { class: 'plan' });
    const ok = h('button', { class: 'filled', text: 'Add it' });

    const paint = () => {
      const plan = uploadPlan(folder.value.trim(), d.files);
      list.replaceChildren(...plan.map((it) => h('div', {
        class: `plan-row${it.problem ? ' skip' : ''}`,
      },
      h('span', { class: 'mono', text: it.path }),
      h('div', { class: 'spacer' }),
      h('span', { class: 'hint muted', text: it.problem ?? it.note }))));
      ok.disabled = plan.every((it) => it.problem);
    };
    paint();
    folder.addEventListener('input', paint);
    ok.addEventListener('click', async () => {
      const plan = uploadPlan(folder.value.trim(), d.files).filter((it) => !it.problem);
      close();
      await uploadFiles(plan);
    });

    return wrap(d.files.length === 1 ? 'Upload this file' : `Upload ${d.files.length} files`,
      h('label', { text: 'Which folder? assets/ is where pictures and sounds go; anything else can go where it belongs.' }), folder,
      list,
      h('div', { class: 'actions' }, cancel, ok));
  }

  // Same shape as the upload dialog: everything it would write is on screen
  // before any of it is sent.
  if (d.kind === 'draw-new') {
    const name = h('input', { placeholder: 'sprite' });
    name.value = d.name;
    const size = h('select', {}, SIZES.map((n) => h('option', { value: n, text: `${n} × ${n}` })));
    size.value = String(d.size);
    return wrap('Draw a picture',
      // Naming the unit is the whole point of this line: 32 means the file is
      // 32 pixels across, and a game usually draws a sprite that size much
      // bigger on screen. Picking a number here is picking the real size.
      h('label', { text: 'How big, in real pixels?' }), size,
      h('label', { text: 'Call it' }), name,
      h('p', { class: 'hint muted', text: 'It starts see-through and lands in assets/ as a .png, exactly this many pixels across. Small numbers are easier to draw square by square; big ones are for backgrounds and title screens.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Start drawing',
        onclick: async () => {
          const side = clampSide(size.value);
          const called = name.value.trim();
          close();
          await createPicture(called, side, side);
        },
      })));
  }

  if (d.kind === 'sound') {
    const sliders = new Map();
    const readouts = new Map();

    const wave = h('select', {
      onchange: (e) => { d.sound.wave = e.currentTarget.value; playSound(d.sound); },
    }, WAVES.map((w) => h('option', { value: w, text: WAVE_WORDS[w] })));

    const name = h('input', { placeholder: 'laser' });
    name.addEventListener('input', () => { d.name = name.value; d.named = true; });

    const shown = (p) => (p.step >= 1 ? String(Math.round(d.sound[p.key])) : d.sound[p.key].toFixed(2));

    // Painted in place rather than through render(), which would rebuild the
    // slider under the thumb that is dragging it — the same trap as the
    // problems panel.
    const paint = () => {
      for (const p of SOUND_PARAMS) {
        sliders.get(p.key).value = d.sound[p.key];
        readouts.get(p.key).textContent = shown(p);
      }
      wave.value = d.sound.wave;
      name.value = d.name;
    };

    const knobs = h('div', { class: 'knobs' }, SOUND_PARAMS.map((p) => {
      const readout = h('span', { class: 'knob-value mono' });
      const slider = h('input', {
        type: 'range', min: p.min, max: p.max, step: p.step,
        // Dragging moves the number beside it; letting go is what plays the
        // sound, so a slow drag is not forty overlapping sounds.
        oninput: (e) => {
          d.sound[p.key] = Number(e.currentTarget.value);
          readout.textContent = shown(p);
        },
        onchange: () => playSound(d.sound),
      });
      sliders.set(p.key, slider);
      readouts.set(p.key, readout);
      return h('label', { class: 'knob' },
        h('span', { class: 'knob-name', text: p.label }),
        slider,
        readout,
        h('span', { class: 'knob-note hint muted', text: p.comment }));
    }));

    // A preset renames the file too, until someone types a name of their own.
    const load = (sound, called) => {
      d.sound = sound;
      if (called && !d.named) d.name = called;
      paint();
      playSound(d.sound);
    };
    paint();

    return wide('Make a sound',
      h('div', { class: 'row wrap' },
        Object.keys(SOUND_PRESETS).map((n) => h('button', {
          class: 'quiet tiny', text: SOUND_WORDS[n] ?? n, onclick: () => load(soundFrom(n), n),
        })),
        h('button', { class: 'quiet tiny', text: 'Surprise me', onclick: () => load(randomSound()) })),
      h('label', { text: 'Shape' }), wave,
      knobs,
      h('label', { text: 'Call it' }), name,
      h('p', { class: 'hint muted', text: 'It lands in assets/ as a .wav, one version like anything else.' }),
      h('div', { class: 'actions' },
        cancel,
        h('button', { class: 'quiet', text: 'Play', onclick: () => playSound(d.sound) }),
        h('button', {
          class: 'filled', text: 'Save it',
          onclick: async () => {
            const { sound, name: called } = d;
            close();
            await saveSound(sound, called);
          },
        })));
  }

  if (d.kind === 'delete-file') {
    return wrap(`Delete ${d.path}?`,
      h('p', { text: 'You can always bring it back from Versions.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete it',
        onclick: async () => { close(); await deleteFile(d.path); },
      })));
  }

  if (d.kind === 'fork') {
    const name = h('input');
    name.value = `${S.project.name} copy`;
    const slug = h('input', { placeholder: 'leave empty to pick one for you' });
    const err = h('p', { class: 'error' });
    return wrap('Make a copy of this game',
      h('p', { text: 'The new game starts with all the same files and helpers. The chat starts fresh.' }),
      h('label', { text: 'What is the copy called?' }), name,
      h('label', { text: 'Web address' }), slug,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make the copy',
        onclick: async () => {
          const body = { name: name.value.trim() };
          if (slug.value.trim()) body.slug = slug.value.trim();
          const res = await api('POST', `/api/projects/${S.slug}/fork`, body);
          if (!res.ok) { err.textContent = res.body?.error ?? 'Could not copy that.'; return; }
          close();
          await loadProjects();
          await openProject(res.body.slug);
        },
      })));
  }

  if (d.kind === 'close-file') {
    return wrap(`Close ${d.path}?`,
      h('p', { text: 'You changed this file and have not saved it yet. Closing loses those changes.' }),
      h('div', { class: 'actions' },
        h('button', { class: 'quiet', text: 'Keep editing', onclick: close }),
        h('button', {
          class: 'danger', text: 'Close without saving',
          // Awaited and always rendered: the dialog is still on screen until
          // something renders, and the file being opened next may take a
          // moment or fail. Same rule as closeOpenFile — whoever waits for the
          // close is waiting for the open.
          onclick: async () => {
            S.open = null;
            S.draw = null;
            S.drawRefused = null;
            S.dialog = null;
            render();
            if (d.then) await openFile(d.then);
          },
        })));
  }

  if (d.kind === 'restore') {
    return wrap('Bring back this version?',
      h('p', { text: `${d.path} will go back to how it was at ${d.short}. Nothing is lost — this adds a new version.` }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Bring it back',
        onclick: async () => { close(); await restore(d.sha, d.path); },
      })));
  }

  if (d.kind === 'rollback') {
    return wrap('Bring the whole game back?',
      h('p', { text: `Every file goes back to how it was at ${d.short}. Anything made since then is taken away.` }),
      h('p', { text: 'Nothing is lost — this adds a new version, so you can come back from it too.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Bring it all back',
        onclick: async () => { close(); await rollback(d.sha); },
      })));
  }

  if (d.kind === 'conflict') {
    return wrap('This file changed while you were editing',
      h('p', { text: `A helper saved ${d.path} after you opened it. Which one do you want to keep?` }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'quiet', text: 'Keep theirs',
          onclick: async () => { close(); await openFile(d.path); },
        }),
        h('button', {
          class: 'filled', text: 'Keep mine',
          onclick: async () => { close(); await saveOpenFile({ force: true }); },
        })));
  }

  if (d.kind === 'new-agent' || d.kind === 'edit-agent') {
    const editing = d.kind === 'edit-agent';
    const name = h('input', { placeholder: 'Level Designer' });
    const description = h('textarea', {
      rows: '5',
      placeholder: 'You design fun levels. Keep things simple and playable.',
    });
    const model = h('select', {},
      h('option', { value: 'deepseek-v4-flash', text: 'Flash — quick' }),
      h('option', { value: 'deepseek-v4-pro', text: 'Pro — slower, better at hard things' }));
    const reasoning = h('input', { type: 'checkbox', checked: true });
    const fileTools = h('input', { type: 'checkbox', checked: true });
    if (editing) {
      name.value = d.agent.name;
      description.value = d.agent.description;
      model.value = d.agent.model;
      reasoning.checked = d.agent.reasoning;
      fileTools.checked = d.agent.file_tools;
    }
    const err = h('p', { class: 'error' });
    return wrap(editing ? `Change ${d.agent.name}` : 'New helper',
      h('label', { text: 'Name (this is what you @ to call them)' }), name,
      h('label', { text: 'What should they be like?' }), description,
      h('label', { text: 'Brain' }), model,
      h('label', { class: 'row' }, reasoning, ' Think before answering'),
      h('label', { class: 'row' }, fileTools, ' Allowed to change files'),
      err,
      h('div', { class: 'actions' },
        editing
          ? h('button', {
            class: 'danger', text: 'Delete helper',
            onclick: () => { S.dialog = { kind: 'delete-agent', agent: d.agent }; render(); },
          })
          : null,
        editing ? h('div', { class: 'spacer' }) : null,
        cancel,
        h('button', {
          class: 'filled', text: editing ? 'Save' : 'Make helper',
          onclick: async () => {
            const body = {
              name: name.value.trim(),
              description: description.value.trim(),
              model: model.value,
              reasoning: reasoning.checked,
              file_tools: fileTools.checked,
            };
            const res = editing
              ? await api('PATCH', `/api/agents/${d.agent.id}`, body)
              : await api('POST', '/api/agents', body);
            if (!res.ok) { err.textContent = res.body?.error ?? 'Could not save that helper.'; return; }
            close();
            await loadAgents();
            syncAttached();
            // You almost always make a helper because you want it in the game
            // you are looking at. Requiring a second "add to this game" click
            // was the trap that made a new studio look broken.
            if (!editing && S.slug && !S.project?.archived) await attachAgent(res.body);
            render();
          },
        })));
  }

  if (d.kind === 'delete-agent') {
    return wrap(`Delete ${d.agent.name}?`,
      h('p', { text: 'They will be removed from every game. What they already said stays in the chat.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete helper',
        onclick: async () => {
          await api('DELETE', `/api/agents/${d.agent.id}`);
          close();
          await loadAgents();
          syncAttached();
          render();
        },
      })));
  }

  return null;
}

/* Render ------------------------------------------------------------------ */

function render() {
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
    const dialog = dialogFor(S.dialog);
    if (dialog) root.append(dialog);
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
