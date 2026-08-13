// Game Studio — the whole client. Vanilla, no build step, no framework.
// Structural changes re-render a pane; streaming text mutates live nodes in
// place so a long reply doesn't rebuild the thread on every chunk.

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
  pinned: new Set(),
  tab: 'files',
  open: null, // {path, content, etag, dirty, conflict}
  history: [],
  diff: null,
  historyPath: null,
  live: new Map(), // agent_id -> {reply, trace, tool, error, nodes}
  dialog: null,
  banner: null,
  previewNonce: 0,
  autoscroll: true,
  narrowPane: 'chat',
};

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
  if (!slug) {
    S.slug = null;
    S.project = null;
    S.files = [];
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
  S.pinned = new Set();
  S.open = null;
  S.history = [];
  S.diff = null;
  S.live.clear();
  S.autoscroll = true;
  if (push) history.pushState({}, '', `/p/${slug}`);
  render();
}

window.addEventListener('popstate', () => openProject(slugFromUrl(), { push: false }));

/* Live events ------------------------------------------------------------- */

const STREAM_EVENTS = [
  'project.new', 'project.updated', 'message.new',
  'agent.stream.start', 'agent.stream.reasoning', 'agent.stream.chunk',
  'agent.tool', 'agent.stream.end', 'files.changed',
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

function liveFor(agentId) {
  let entry = S.live.get(agentId);
  if (!entry) {
    entry = { reply: '', trace: '', tool: null, error: false, nodes: null };
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
      // The finished message replaces whatever was streaming from that agent.
      if (data.agent_id !== null) S.live.delete(data.agent_id);
      S.project.messages.push(data);
      render();
      return;
    }

    case 'agent.stream.start': {
      if (!mine(data)) return;
      S.live.set(data.agent_id, {
        reply: '', trace: '', tool: null, error: false, nodes: null,
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

    case 'files.changed': {
      if (!mine(data)) return;
      refreshFiles();
      // An agent just rewrote the game; show the new version.
      S.previewNonce += 1;
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

/* History ----------------------------------------------------------------- */

async function loadHistory(path = null) {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await api('GET', `/api/projects/${S.slug}/history${query}`);
  if (res.ok) {
    S.history = res.body;
    S.historyPath = path;
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

function renderSidebar() {
  const rows = S.projects.map((p) => h('button', {
    class: `item${p.slug === S.slug ? ' active' : ''}${p.archived ? ' archived' : ''}`,
    onclick: () => { S.narrowPane = 'chat'; openProject(p.slug); },
  },
  h('div', { class: 'item-name', text: p.name }),
  h('div', { class: 'item-sub', text: p.preview || 'No messages yet' })));

  return h('div', { class: `pane${S.narrowPane === 'games' ? ' show' : ''}` },
    h('div', { class: 'bar brand-bar' },
      h('div', { class: 'brand', text: 'Game Studio' })),
    h('div', { class: 'pad' },
      h('button', {
        class: 'filled', style: 'width:100%',
        text: '+ New game',
        onclick: () => { S.dialog = { kind: 'new-project' }; render(); },
      })),
    h('div', { class: 'section-label', text: 'Games' }),
    h('div', { class: 'scroll' },
      rows.length ? rows : h('div', { class: 'pad muted', text: 'No games yet. Make one!' })),
    h('div', { class: 'who' },
      h('div', { class: 'name', text: S.me.display_name }),
      h('button', {
        class: 'quiet tiny', text: 'Sign out',
        onclick: async () => { await api('POST', '/api/logout'); location.href = '/'; },
      })),
  );
}

/* Render: chat ------------------------------------------------------------ */

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
      onclick: () => { S.tab = 'versions'; loadDiff(w.commit_sha); },
    }));
  }

  return h('div', { class: `msg ${isAgent ? 'from-agent' : 'from-human'}` },
    h('div', { class: 'from', text: who }),
    msg.body && h('div', { class: 'bubble', text: msg.body }),
    chips.length ? h('div', { class: 'chips' }, chips) : null);
}

function renderLive(agentId, entry) {
  const trace = h('div', { class: 'trace', text: entry.trace });
  const thinking = h('details', { class: 'thinking' },
    h('summary', { text: 'Thinking' }), trace);
  thinking.hidden = entry.trace === '';

  const reply = h('div', { class: 'bubble', text: entry.reply });
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

function renderChat() {
  const p = S.project;
  if (!p) {
    return h('div', { class: `pane chat${S.narrowPane === 'chat' ? ' show' : ''}` },
      h('div', { class: 'bar' },
        h('button', { class: 'quiet only-narrow', text: '☰ Games', onclick: () => { S.narrowPane = 'games'; render(); } }),
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

  const box = h('textarea', {
    placeholder: p.archived ? 'This game is finished (archived).' : 'Ask for something…',
    disabled: p.archived,
    onkeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
  });
  const submit = async () => {
    const text = box.value.trim();
    if (!text) return;
    box.value = '';
    S.autoscroll = true;
    await sendMessage(text);
  };

  const pinNote = S.pinned.size
    ? `Sending ${S.pinned.size} pinned file${S.pinned.size === 1 ? '' : 's'}.`
    : 'Tip: pin a file on the right to point at it.';

  return h('div', { class: `pane chat${S.narrowPane === 'chat' ? ' show' : ''}` },
    h('div', { class: 'bar' },
      h('button', { class: 'quiet only-narrow', text: '☰', onclick: () => { S.narrowPane = 'games'; render(); } }),
      h('div', { class: 'title', text: p.name }),
      p.archived && h('span', { class: 'tag', text: 'archived' }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'quiet only-narrow', text: 'Files', onclick: () => { S.narrowPane = 'rail'; render(); } }),
      h('button', {
        class: 'quiet tiny', text: 'Rename',
        onclick: () => { S.dialog = { kind: 'rename' }; render(); },
      }),
      h('button', {
        class: 'quiet tiny',
        text: p.archived ? 'Reopen' : 'Finish',
        title: p.archived ? 'Start working on this again' : 'Mark this game done and stop changes',
        onclick: () => { S.dialog = { kind: 'archive' }; render(); },
      })),
    scroller,
    h('div', { class: 'composer' },
      box,
      h('div', { class: 'row' },
        h('span', { class: 'hint', text: pinNote }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'filled', text: 'Send', disabled: p.archived, onclick: submit }))));
}

/* Render: right rail ----------------------------------------------------- */

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
    if (S.open.content === null) {
      editor.push(h('div', { class: 'pad muted', text: `${S.open.path} is a picture or sound, so there is nothing to edit here.` }));
    } else {
      const area = h('textarea', {
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
        h('div', { class: 'bar' },
          h('div', { class: 'title mono', text: S.open.path }),
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'quiet tiny', text: 'Versions',
            onclick: () => { S.tab = 'versions'; loadHistory(S.open.path); },
          }),
          h('button', {
            class: 'danger tiny', text: 'Delete',
            onclick: () => { S.dialog = { kind: 'delete-file', path: S.open.path }; render(); },
          })),
        area,
        h('div', { class: 'editor-bar row' },
          h('span', { class: 'hint muted', text: S.open.dirty ? 'Not saved yet' : 'Saved' }),
          h('div', { class: 'spacer' }),
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
    h('div', { class: 'scroll' },
      h('div', { class: 'tree' },
        rows.length ? rows : h('div', { class: 'pad muted', text: 'No files yet. Ask a helper to make one.' })),
      ...editor),
  ];
}

function renderPlayTab() {
  const url = `${S.project.play_url}?v=${S.previewNonce}`;
  return [h('div', { class: 'scroll' },
    h('div', { class: 'preview-wrap' },
      h('div', { class: 'row' },
        h('button', { class: 'quiet tiny', text: '⟳ Reload', onclick: () => { S.previewNonce += 1; render(); } }),
        h('div', { class: 'spacer' }),
        h('a', { href: S.project.play_url, target: '_blank', rel: 'noreferrer' },
          h('button', { class: 'quiet tiny', text: 'Open in a tab' }))),
      h('iframe', { class: 'preview-frame', src: url, title: 'Game preview' }),
      h('div', { class: 'hint muted', text: 'Anyone with the link can play this. It updates as soon as a file changes.' }),
      h('div', { class: 'mono muted', text: S.project.play_url })))];
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

function renderVersionsTab() {
  const header = h('div', { class: 'pad row' },
    h('span', { class: 'hint muted', text: S.historyPath ? `Versions of ${S.historyPath}` : 'All versions' }),
    h('div', { class: 'spacer' }),
    S.historyPath
      ? h('button', { class: 'quiet tiny', text: 'Show all', onclick: () => loadHistory(null) })
      : null);

  const rows = S.history.map((c) => h('div', { class: 'commit' },
    h('div', { class: 'subject', text: c.subject }),
    h('div', { class: 'meta' },
      h('span', { class: 'sha', text: c.short }), ' · ', c.author, ' · ',
      new Date(c.at).toLocaleString()),
    h('div', { class: 'row', style: 'margin-top:5px' },
      h('button', { class: 'quiet tiny', text: 'What changed?', onclick: () => loadDiff(c.sha) }),
      S.historyPath && !S.project.archived
        ? h('button', {
          class: 'quiet tiny', text: 'Bring this back',
          onclick: () => {
            S.dialog = { kind: 'restore', sha: c.sha, path: S.historyPath, short: c.short };
            render();
          },
        })
        : null)));

  return [header, h('div', { class: 'scroll' },
    rows.length ? rows : h('div', { class: 'pad muted', text: 'No versions yet.' }),
    S.diff
      ? h('div', { class: 'pad stack' },
        h('div', { class: 'hint muted', text: `Changed: ${S.diff.paths.join(', ') || 'nothing'}` }),
        S.diff.patch.trim()
          ? renderDiff(S.diff.patch)
          : h('div', { class: 'muted', text: 'Nothing to show for this one.' }))
      : null)];
}

function renderAgentsTab() {
  const attached = new Map(S.project.agents.map((a) => [a.agent_id, a]));

  const rows = S.agents.map((agent) => {
    const here = attached.get(agent.id);
    return h('div', { class: 'commit' },
      h('div', { class: 'row' },
        h('div', { class: 'subject', style: 'flex:1', text: agent.name }),
        here
          ? h('span', { class: `tag agent${here.chatty ? ' on' : ''}`, text: here.chatty ? 'always answers' : 'when called' })
          : null),
      h('div', { class: 'meta', text: `${agent.model.replace('deepseek-v4-', '')}${agent.reasoning ? ' · thinks first' : ''}${agent.file_tools ? ' · can edit files' : ' · talks only'}` }),
      h('div', { class: 'row', style: 'margin-top:5px' },
        here
          ? h('button', {
            class: 'quiet tiny',
            text: here.chatty ? 'Only when called' : 'Always answer',
            disabled: S.project.archived,
            onclick: async () => {
              await api('PATCH', `/api/projects/${S.slug}/agents/${agent.id}`, { chatty: !here.chatty });
              await openProject(S.slug, { push: false });
            },
          })
          : null,
        here
          ? h('button', {
            class: 'quiet tiny', text: 'Remove', disabled: S.project.archived,
            onclick: async () => {
              await api('DELETE', `/api/projects/${S.slug}/agents/${agent.id}`);
              await openProject(S.slug, { push: false });
            },
          })
          : h('button', {
            class: 'quiet tiny', text: 'Add to this game', disabled: S.project.archived,
            onclick: async () => {
              const res = await api('POST', `/api/projects/${S.slug}/agents`, {
                agent_id: agent.id, chatty: true,
              });
              if (!res.ok) say(res.body?.error ?? 'Could not add that helper.', true);
              await openProject(S.slug, { push: false });
            },
          }),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'danger tiny', text: 'Delete helper',
          onclick: () => { S.dialog = { kind: 'delete-agent', agent }; render(); },
        })));
  });

  return [
    h('div', { class: 'pad' },
      h('button', {
        class: 'quiet tiny', text: '+ New helper',
        onclick: () => { S.dialog = { kind: 'new-agent' }; render(); },
      })),
    h('div', { class: 'scroll' },
      rows.length ? rows : h('div', { class: 'pad muted', text: 'No helpers yet. Make one and add it to a game.' }),
      h('div', { class: 'pad hint muted', text: 'Helpers with "always answers" reply to everything. The others wait until you type @ and their name.' })),
  ];
}

function renderRail() {
  if (!S.project) return h('div', { class: 'pane' });

  const tab = (id, label) => h('button', {
    class: `tiny${S.tab === id ? ' on' : ''}`,
    text: label,
    onclick: () => {
      S.tab = id;
      if (id === 'versions' && S.history.length === 0) loadHistory(null);
      render();
    },
  });

  let body = [];
  if (S.tab === 'files') body = renderFilesTab();
  else if (S.tab === 'play') body = renderPlayTab();
  else if (S.tab === 'versions') body = renderVersionsTab();
  else body = renderAgentsTab();

  return h('div', { class: `pane${S.narrowPane === 'rail' ? ' show' : ''}` },
    h('div', { class: 'bar' },
      h('button', { class: 'quiet only-narrow', text: '←', onclick: () => { S.narrowPane = 'chat'; render(); } }),
      h('div', { class: 'tabs' },
        tab('files', 'Files'), tab('play', 'Play'),
        tab('versions', 'Versions'), tab('agents', 'Helpers'))),
    ...body);
}

/* Render: dialogs -------------------------------------------------------- */

function dialogFor(d) {
  const close = () => { S.dialog = null; render(); };
  const wrap = (title, ...body) => h('div', { class: 'backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'dialog' }, h('h2', { text: title }), ...body));
  const cancel = h('button', { class: 'quiet', text: 'Cancel', onclick: close });

  if (d.kind === 'new-project') {
    const name = h('input', { placeholder: 'Space Racer' });
    const slug = h('input', { placeholder: 'space-racer (optional)' });
    const err = h('p', { class: 'error' });
    return wrap('New game',
      h('label', { text: 'What is it called?' }), name,
      h('label', { text: 'Web address (letters, numbers and dashes)' }), slug,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => {
          const body = { name: name.value.trim() };
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

  if (d.kind === 'archive') {
    const finishing = !S.project.archived;
    return wrap(finishing ? 'Finish this game?' : 'Work on this again?',
      h('p', {
        text: finishing
          ? 'Nobody will be able to change it, and helpers will stop replying. People can still play it, and you can reopen it any time.'
          : 'You will be able to change files and talk to helpers again.',
      }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: finishing ? 'Finish it' : 'Reopen it',
        onclick: async () => {
          await api('POST', `/api/projects/${S.slug}/archive`, { archived: finishing });
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

  if (d.kind === 'restore') {
    return wrap('Bring back this version?',
      h('p', { text: `${d.path} will go back to how it was at ${d.short}. Nothing is lost — this adds a new version.` }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Bring it back',
        onclick: async () => { close(); await restore(d.sha, d.path); },
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

  if (d.kind === 'new-agent') {
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
    const err = h('p', { class: 'error' });
    return wrap('New helper',
      h('label', { text: 'Name (this is what you @ to call them)' }), name,
      h('label', { text: 'What should they be like?' }), description,
      h('label', { text: 'Brain' }), model,
      h('label', { class: 'row' }, reasoning, ' Think before answering'),
      h('label', { class: 'row' }, fileTools, ' Allowed to change files'),
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make helper',
        onclick: async () => {
          const res = await api('POST', '/api/agents', {
            name: name.value.trim(),
            description: description.value.trim(),
            model: model.value,
            reasoning: reasoning.checked,
            file_tools: fileTools.checked,
          });
          if (!res.ok) { err.textContent = res.body?.error ?? 'Could not make that helper.'; return; }
          close();
          await loadAgents();
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
          if (S.slug) await openProject(S.slug, { push: false });
        },
      })));
  }

  return null;
}

/* Render ------------------------------------------------------------------ */

function render() {
  root.replaceChildren();

  if (S.loading) {
    root.append(h('div', { class: 'auth-page' }, h('p', { class: 'muted', text: 'Loading…' })));
    return;
  }
  if (!S.me) {
    root.append(renderAuth());
    return;
  }

  const app = h('div', { class: 'app' }, renderSidebar(), renderChat(), renderRail());
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

  stickToBottom();
}

start();
