// Game Studio — the whole client. Vanilla, no build step, no framework.
// Structural changes re-render a pane; streaming text mutates live nodes in
// place so a long reply doesn't rebuild the thread on every chunk.

import { parseConfigFile, literalFor, spliceValue } from './config-file.js';

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

const isChat = () => S.project?.kind === 'chat';

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

async function start() {
  const me = await api('GET', '/api/me');
  if (me.ok) {
    S.me = me.body;
    await Promise.all([loadProjects(), loadAgents()]);
    connectStream();
    await openProject(slugFromUrl(), { push: false });
  }
  S.loading = false;
  render();
}

async function loadProjects() {
  const res = await api('GET', '/api/projects');
  if (res.ok) S.projects = res.body;
}

async function loadAgents() {
  const res = await api('GET', '/api/agents');
  if (res.ok) S.agents = res.body;
}

async function openProject(slug, { push = true } = {}) {
  // Half-typed text belongs to the game it was typed in, so it is parked
  // here on the way out and put back on the way in.
  if (S.slug) S.drafts.set(S.slug, composerBox.value);
  composerBox.value = slug ? (S.drafts.get(slug) ?? '') : '';

  if (!slug) {
    S.slug = null;
    S.project = null;
    S.files = [];
    S.errors = [];
    S.open = null;
    if (push) history.pushState({}, '', '/');
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
  if (push) history.pushState({}, '', `/p/${slug}`);
  render();
  // The rail keeps whichever tab you were on, so arriving at a game with
  // Versions already open has to fetch now. Waiting for the next click on the
  // tab is what made the list look empty until you left it and came back.
  if (S.tab === 'versions' && !isChat()) await loadHistory(null);
}

window.addEventListener('popstate', () => openProject(slugFromUrl(), { push: false }));

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
      // is on screen; otherwise let opening the tab do it.
      S.historyStale = true;
      if (S.tab === 'versions') loadHistory(S.historyPath);
      if (S.open && data.paths.includes(S.open.path)) {
        if (S.open.dirty) {
          say(`${S.open.path} changed while you were editing it. Your text is still here — saving will ask before overwriting.`);
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
  const res = await fetch(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (!res.ok) {
    say(`Could not open ${path}.`, true);
    return;
  }
  const isText = S.files.find((f) => f.path === path)?.text;
  S.open = {
    path,
    content: isText ? await res.text() : null,
    etag: res.headers.get('etag'),
    dirty: false,
  };
  S.tab = 'files';
  render();
}

// Closing throws away unsaved text, which is the one thing in the editor that
// git cannot get back, so it asks first.
function closeOpenFile() {
  if (!S.open) return;
  if (S.open.dirty) {
    S.dialog = { kind: 'close-file', path: S.open.path };
  } else {
    S.open = null;
  }
  render();
}

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

async function loadDiff(sha) {
  const res = await api('GET', `/api/projects/${S.slug}/diff/${sha}`);
  if (res.ok) {
    S.diff = res.body;
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
    h('div', { class: 'scroll' },
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
      onclick: async () => {
        S.tab = 'versions';
        render();
        if (S.historyPath || S.historyStale || S.history.length === 0) await loadHistory(null);
        await loadDiff(w.commit_sha);
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
    h('div', { class: 'scroll cfg' }, body),
    h('div', { class: 'editor-bar row' },
      h('span', {
        class: 'hint muted', id: 'cfg-status', text: S.open.dirty ? 'Not saved yet' : 'Saved',
      }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'quiet', text: 'Show the text',
        onclick: () => { S.open.asText = true; render(); },
      }),
      h('button', {
        class: 'filled', id: 'save-btn', text: 'Save',
        disabled: !S.open.dirty || S.project.archived,
        onclick: () => saveOpenFile(),
      })),
  ];
}

function renderFilesTab() {
  const rows = S.files.map((f) => h('div', {
    class: `file${S.open?.path === f.path ? ' open' : ''}${f.unreachable ? ' unreachable' : ''}`,
  },
  h('input', {
    type: 'checkbox',
    title: 'Pin this file so helpers look at it',
    checked: S.pinned.has(f.path),
    disabled: f.unreachable,
    onchange: (e) => {
      if (e.currentTarget.checked) S.pinned.add(f.path);
      else S.pinned.delete(f.path);
      render();
    },
  }),
  h('button', {
    class: 'fname', text: f.path, disabled: f.unreachable,
    onclick: () => openFile(f.path),
  }),
  h('span', { class: 'fsize', text: `${f.size}b` })));

  const editor = [];
  if (S.open) {
    // One bar for both cases: a picture has nothing to edit but still has to
    // be closable, and Close belongs next to Delete either way.
    const bar = h('div', { class: 'bar' },
      h('div', { class: 'title mono', text: S.open.path }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'quiet tiny', text: 'Versions',
        onclick: () => { S.tab = 'versions'; loadHistory(S.open.path); },
      }),
      h('button', {
        class: 'danger tiny', text: 'Delete',
        onclick: () => { S.dialog = { kind: 'delete-file', path: S.open.path }; render(); },
      }),
      h('button', {
        class: 'icon tiny', text: '✕', title: 'Close this file',
        onclick: closeOpenFile,
      }));

    // A config file opens as fields rather than code, unless it holds something
    // the reader will not touch, or you asked to see the text.
    const parsed = isConfigPath(S.open.path) && S.open.content !== null
      ? parseConfigFile(S.open.content)
      : null;

    if (S.open.content === null) {
      editor.push(h('div', { class: 'editor' }, bar,
        h('div', { class: 'pad muted grow', text: `${S.open.path} is a picture or sound, so there is nothing to edit here.` })));
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
              class: 'quiet', text: 'Show the fields',
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

  return [
    h('div', { class: 'pad row' },
      h('button', {
        class: 'quiet tiny', text: '+ New file',
        disabled: S.project.archived,
        onclick: () => { S.dialog = { kind: 'new-file' }; render(); },
      }),
      h('div', { class: 'spacer' }),
      S.pinned.size
        ? h('button', { class: 'quiet tiny', text: 'Unpin all', onclick: () => { S.pinned.clear(); render(); } })
        : null),
    // With a file open the list shrinks to about five rows and the editor
    // takes everything else; with nothing open the list fills the pane.
    h('div', { class: `tree scroll${S.open ? ' short' : ''}` },
      rows.length ? rows : h('div', { class: 'pad muted', text: 'No files yet. Ask a helper to make one.' })),
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
  return [h('div', { class: 'scroll' },
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

// The changes for one commit, opened inside its own row. Only ever one is
// open, because opening a second replaces S.diff — which is also what makes
// "the last one closes itself" true without any bookkeeping.
function diffDrawer() {
  return h('div', { class: 'drawer' },
    h('div', { class: 'hint muted', text: `Changed: ${S.diff.paths.join(', ') || 'nothing'}` }),
    S.diff.patch.trim()
      ? renderDiff(S.diff.patch)
      : h('div', { class: 'muted', text: 'Nothing to show for this one.' }));
}

// Links are for looking at something, buttons are for changing something. The
// distinction is the whole vocabulary of this list: What changed, All files and
// See this in all versions are links; bringing a version back is a button.
function renderVersionsTab() {
  const header = h('div', { class: 'pad row' },
    h('span', { class: 'hint muted', text: S.historyPath ? `Versions of ${S.historyPath}` : 'All versions' }),
    h('div', { class: 'spacer' }),
    S.historyPath
      ? h('button', { class: 'link tiny', text: 'All files', onclick: () => loadHistory(null) })
      : null);

  const rows = S.history.map((c) => {
    const open = S.diff?.sha === c.sha;
    return h('div', { class: `commit${open ? ' open' : ''}` },
      h('div', { class: 'subject', text: c.subject }),
      h('div', { class: 'meta' },
        h('span', { class: 'sha', text: c.short }), ' · ', c.author, ' · ',
        new Date(c.at).toLocaleString()),
      h('div', { class: 'row', style: 'margin-top:5px' },
        h('button', {
          class: 'link tiny',
          text: open ? 'Hide the changes' : 'What changed?',
          onclick: () => {
            if (open) {
              S.diff = null;
              render();
            } else {
              loadDiff(c.sha);
            }
          },
        }),
        S.historyPath
          // From one file's history, the useful move is to go and look at the
          // whole version this file changed in — not to roll the project back,
          // which is a decision you make from the full list.
          ? h('button', {
            class: 'link tiny', text: 'See the whole version',
            onclick: async () => {
              await loadHistory(null);
              await loadDiff(c.sha);
            },
          })
          : null,
        S.historyPath && !S.project.archived
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
  return [header, h('div', { class: 'scroll' },
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
    onclick: () => {
      S.tab = id;
      // Clicking Versions means all of them, the same as Show all. A list
      // filtered to one file is somewhere you arrive from that file, not a
      // state the tab should hold on to.
      if (id === 'versions' && (S.historyPath || S.historyStale || S.history.length === 0)) {
        loadHistory(null);
      }
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
          await openProject(S.slug, { push: false });
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
          await openProject(S.slug, { push: false });
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
          onclick: () => { S.open = null; close(); },
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

  restoreFocus(focus);
  stickToBottom();
}

start();
