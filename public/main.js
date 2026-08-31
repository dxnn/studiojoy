// Unbridled Joy — the client's core. Vanilla, no build step, no framework.
// Structural changes re-render a pane; streaming text mutates live nodes in
// place so a long reply doesn't rebuild the thread on every chunk.
//
// This file holds what everything else leans on — the state, the transport,
// the URL, the stream, and the file, drawing and history actions — plus
// render(), which composes the panes that live in the modules beside it:
// dom.js, sidebar.js, chat.js, versions.js, config-form.js, sound-form.js,
// dialogs.js, upload.js.

import { parseConfigFile, literalFor, spliceValue } from './config-file.js';
import { soundFrom, soundBytes, soundIn } from './sound-maker.js';
import { renderSoundForm, playSound } from './sound-form.js';
import {
  PALETTE, BRUSHES, MAX_SIDE, UNDO_BYTES, CLEAR,
  blankPicture, pictureFrom, pixelAt, drawLine, floodFill,
  beginStep, endStep, applyStep, stepBytes,
  clipFrame, unclip, copyFrame, pasteFrame,
  rgbaOf, hexOf, isColour,
} from './pixel-editor.js';
import { h, iconButton } from './dom.js';
import {
  SOUND_DIR, IMAGE_DIR, SPRITE_DIR, assetPath, writeFiles,
  makeDropTarget, isFileDrag,
} from './upload.js';
import { isConfigPath, renderConfigForm } from './config-form.js';
import { isQuizPath, quizModel } from './quiz-editor.js';
import { renderQuizForm } from './quiz-form.js';
import { tokenize, langFor } from './highlight.js';
import { renderVersionsTab } from './versions.js';
import { renderChat } from './chat.js';
import { renderSidebar, wordmark } from './sidebar.js';
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
  // The studio's people, for the Crew tab.
  people: [],
  // Everything the admin panel shows, while it is open. Null until then: it
  // is the one part of the studio most accounts may not even read.
  admin: null,
  slug: null,
  project: null,
  // The conversation on screen, and every conversation this game has. A game
  // is born with two — the human-only one it opens on, and one where helpers
  // can be put — and can have as many as it wants (spec.md §3).
  chat: null,
  chats: [],
  files: [],
  // What the game said when it ran, for the version of the files on disk now.
  errors: [],
  pinned: new Set(),
  tab: 'files',
  open: null, // {path, content, etag, dirty, conflict}
  // Set only while the open file is being drawn on, and thrown away with it:
  // {picture, undo, dirty}
  draw: null,
  // The same for a sound: the numbers the open .wav came off, while it is
  // open. {params, dirty}
  sound: null,
  // Which tool, how wide and which colours are a person's choice, not the
  // file's, so they outlive opening a different picture — and outlive the file
  // being re-read underneath the editor, which a save itself causes.
  //
  // `slot` is which colour square is chosen. The colours themselves are the
  // game's, not this browser's — see S.palette. `ghost` is whether a strip's
  // previous frame shows faintly under the one being drawn.
  drawPrefs: {
    tool: 'pencil', brush: 1, slot: 0, ghost: false,
  },
  // The open project's colours, read from its own config/look.js so that
  // changing one is a change to the game with a version behind it, rather than
  // a setting that lives in whichever browser happened to make it.
  // {colours, text, from} — text is null when the game has no look.js yet.
  palette: null,
  // The four colours the open game lends the studio, out of the same file.
  // Empty for a game that names none of them, which is a game wearing the
  // studio's own.
  look: {},
  // Why a picture is not open for drawing on, or a sound not open for
  // changing, when they are not.
  drawRefused: null,
  soundRefused: null,
  history: [],
  // Every version there is, against the page of them in `history` — the list
  // is capped and the number is not.
  historyTotal: 0,
  diff: null,
  historyPath: null,
  // The open game's kept scores, for the Scoreboard tab. Null until the tab
  // loads them; refetched every time the tab opens.
  scores: null,
  // Set when a commit lands, so the versions list reloads instead of showing
  // whatever it happened to fetch first.
  historyStale: false,
  drafts: new Map(), // slug -> unsent composer text
  live: new Map(), // the open game's map from liveBySlug; see connectStream
  traces: new Map(), // message_id -> {text, open}; this session only
  // The one open receipt under a reply's token note: {id, breakdown,
  // promptHeld}. One at a time, like a row's changes in the versions list.
  receipt: null,
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
  // Which of the sidebar's three lists is showing — games, chats or crew (the
  // people and the helpers, in that order). Three stacked sections fought each
  // other for the height of the pane; one list at a time, with tabs over it,
  // is the same things and one decision. Remembered like the rail width,
  // because it is a place you work from rather than a step in a task.
  sideTab: ['games', 'chats', 'crew'].includes(prefs.get('side-tab', 'games'))
    ? prefs.get('side-tab', 'games')
    : 'games',
  // What is typed in the sidebar's search box: a filter over the list on
  // screen, not a query. Deliberately not remembered — a filter still in force
  // tomorrow is a list with things missing from it.
  sideFind: '',
  // Whether the game is showing at the top of the rail or folded to one row.
  // Remembered next to the rail width: on a small screen the file list is
  // worth the whole pane, and that is a preference, not a step.
  previewOpen: prefs.get('preview', 'open') !== 'closed',
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
// The sidebar's filter box. Every keystroke in it re-renders the pane it is
// in, so without this it would lose the caret on its own second character.
export const SIDE_SEARCH = 'side-find';

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
  if (el !== composerBox && el?.id !== EDITOR_AREA && el?.id !== SIDE_SEARCH) return null;
  return {
    composer: el === composerBox,
    id: el.id,
    start: el.selectionStart,
    end: el.selectionEnd,
    scroll: el.scrollTop,
  };
}

function restoreFocus(snap) {
  if (!snap) return;
  const el = snap.el ?? (snap.composer ? composerBox : document.getElementById(snap.id));
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

// Whether this game is yours to change: you are one of its authors, or it is
// open to the whole studio. Archived is the other half of the same question —
// everything that was disabled for an archived game is disabled for somebody
// else's, and for the same reason: the answer to a click would be a refusal.
export const frozen = () => !S.project || S.project.archived || !S.project.can_edit;

// Whether a message can be sent into the chat on screen. ⚠️ The chat's rule
// and not the game's: the human-only chat of every game is everyone's, so
// somebody who cannot change a thing here can still say something in it.
export const canTalk = () => {
  if (!S.project || S.project.archived) return false;
  return S.chat?.bots === false || !frozen();
};

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

// Three, not four: the preview the Play tab held is now the top of the rail
// whatever is open under it. A `?tab=play` link from before falls back to
// Files, which is where its preview is anyway.
const RAIL_TABS = ['files', 'versions', 'scoreboard'];

// The URL is the view: which game, which tab, which file, which version — so
// what someone is looking at is always the thing they can send to somebody
// else. `file` is whichever file the rail is about: the open one under Files,
// the filter under Versions. One name because it is one idea.
const viewFromUrl = () => {
  const q = new URLSearchParams(location.search);
  return {
    tab: q.get('tab'), file: q.get('file'), version: q.get('version'),
    chat: q.get('chat'),
  };
};

// The inverse of applyView, and written in the same two branches so the pair
// can be read against each other.
function urlNow() {
  if (!S.slug) return '/';
  const q = new URLSearchParams();
  // Which conversation, unless it is the one the project opens on: a link to
  // a game means its front door, and a chat is a place inside it.
  if (S.chat && S.chats.length > 1 && S.chat.id !== S.chats[0].id) {
    q.set('chat', String(S.chat.id));
  }
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
async function applyView({ tab, file, version, chat }) {
  // The chat first: it is the only part of the view a chat-kind project has,
  // and switching it replaces the thread the rest of this is arranged around.
  const wanted = chat === null || chat === undefined ? S.chats[0]?.id : Number(chat);
  if (wanted && wanted !== S.chat?.id) await openChat(wanted);
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
  } else if (S.tab === 'scoreboard') {
    // Always refetched: scores change while nobody in the studio does
    // anything, so a cached list would be quietly wrong.
    await loadScores();
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
    await Promise.all([loadProjects(), loadAgents(), loadPeople()]);
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

// The people in the studio, for the Crew tab. Names only, and only ever read:
// an account is made with `npm run adduser` and by nothing in here.
// Your own numbers, re-read after a reply that was billed to you. `/api/me`
// carries what you may spend in a day and what you have spent of it, so the
// warning under a reply is drawn from your own row and never from anybody
// else's — an allowance is not a thing to show the room.
export async function loadMe() {
  const res = await api('GET', '/api/me');
  if (res.ok) S.me = res.body;
}

// How close you are to your own daily limit, or null when there is nothing to
// say: no allowance, or not near it yet. Within a tenth of it is the line —
// far enough out that there is time to finish a thought.
export function nearQuota() {
  const limit = S.me?.daily_tokens;
  if (!limit) return null;
  const spent = S.me.spent_today ?? 0;
  const left = Math.max(0, limit - spent);
  if (left > limit * 0.1) return null;
  return { spent, limit, left };
}

export async function loadPeople() {
  const res = await api('GET', '/api/users');
  if (res.ok) S.people = res.body;
}

/* Being called by name ----------------------------------------------------- */

// The mark on a game, a chat or a conversation pill saying somebody called you
// there and you have not read it. The studio's own cyan, because it is the
// studio talking to you rather than the game — and not gold, which is a score
// or a version and nothing else.
export const calledMark = (n) => (n
  ? h('span', {
    class: 'called',
    text: `@${n}`,
    title: n === 1 ? 'Somebody called you by name here' : `${n} messages here call you by name`,
  })
  : null);

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

// Opening a chat is reading it, so anything in it that called you stops
// asking. The counts are dropped here rather than refetched: the answer is
// arithmetic, and a round trip would repaint the sidebar a beat late.
async function readMentions() {
  const chat = S.chats.find((c) => c.id === S.chat?.id);
  if (!chat?.mentions) return;
  const had = chat.mentions;
  chat.mentions = 0;
  const row = S.projects.find((p) => p.slug === S.slug);
  if (row) row.mentions = Math.max(0, (row.mentions ?? 0) - had);
  if (S.project) S.project.mentions = Math.max(0, (S.project.mentions ?? 0) - had);
  await api('POST', `/api/projects/${S.slug}/chats/${S.chat.id}/seen`);
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
    S.live = new Map();
    S.receipt = null;
    render();
    return;
  }
  // Which conversation to open in: the one the address names, else the one
  // you were last in here, else the one the project opens on. A remembered id
  // that no longer exists falls back the same way, because the server answers
  // 404 and the retry carries no chat at all.
  const wanted = view?.chat ?? prefs.get(`chat-${slug}`, null);
  let res = await api('GET', `/api/projects/${slug}${wanted ? `?chat=${wanted}` : ''}`);
  if (res.status === 404 && wanted) res = await api('GET', `/api/projects/${slug}`);
  if (!res.ok) {
    say(res.status === 404 ? 'That game does not exist.' : 'Could not open that game.', true);
    return;
  }
  S.slug = slug;
  S.project = res.body;
  S.chats = res.body.chats ?? [];
  S.chat = res.body.chat ?? null;
  if (S.chat) prefs.set(`chat-${slug}`, S.chat.id);
  S.files = res.body.files;
  S.errors = res.body.errors ?? [];
  S.pinned = new Set();
  S.open = null;
  S.history = [];
  S.scores = null;
  // Cleared as well as the list: a path from the game you just left would
  // filter this game's history by a file it may not even have.
  S.historyPath = null;
  S.diff = null;
  S.historyStale = false;
  // What an agent is saying right now exists nowhere but this tab, so leaving
  // a game must not throw it away: the live buffers are per game, the stream
  // keeps filling them while you are elsewhere, and coming back picks this
  // game's up again. Kept traces are bounded and keyed by message id, so they
  // survive the switch the same way.
  S.live = liveMapFor(slug, S.chat?.id);
  S.autoscroll = true;
  readMentions();
  S.palette = null;
  // An open receipt belongs to a message in the game being left.
  S.receipt = null;
  render();
  // The best score is on the preview now, so it is fetched with the game
  // rather than when the Scoreboard tab is opened. One small request, and the
  // tab still refetches on its own — the public posts while the studio idles.
  // The game's own four colours come out of config/look.js in the same
  // breath: the studio wears them from the first paint, not from whenever a
  // picture is opened.
  if (!isChat()) {
    await loadScores();
    await loadPalette();
    render();
  }
  // The rail keeps whichever tab you were on unless a URL says otherwise, so
  // arriving at a game with Versions already open has to fetch now. Waiting
  // for the next click on the tab is what made the list look empty until you
  // left it and came back.
  // ⚠️ The chat is named explicitly, whatever the view says: it was settled
  // above, and applyView reads a missing chat as "the one the project opens
  // on". Left out, this call undid the remembered chat a beat after opening
  // it — the game appeared in the conversation you left it in and then
  // switched itself to Humans only. Back and Forward still reset, because
  // there the missing chat is the address talking.
  await applyView({ ...(view ?? { tab: S.tab }), chat: S.chat?.id });
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
function liveMapFor(slug, chatId = null) {
  const key = `${slug}:${chatId ?? ''}`;
  let map = liveBySlug.get(key);
  if (!map) {
    map = new Map();
    liveBySlug.set(key, map);
  }
  return map;
}

function liveFor(slug, chatId, agentId) {
  const map = liveMapFor(slug, chatId);
  let entry = map.get(agentId);
  if (!entry) {
    entry = { reply: '', trace: '', tool: null, error: false, nodes: null, open: false };
    map.set(agentId, entry);
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
        if (data.scores_on !== undefined) S.project.scores_on = data.scores_on;
        render();
      }
      return;

    case 'message.new': {
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
      // Somebody called you by name. Where the message landed decides what
      // happens to it: in the chat you are looking at it is already read, and
      // anywhere else it leaves a mark on that game until you go and look.
      if (data.mentions?.includes(S.me?.id)) {
        if (here(data)) {
          api('POST', `/api/projects/${data.project_slug}/chats/${data.chat_id}/seen`);
        } else {
          const row = S.projects.find((p) => p.slug === data.project_slug);
          if (row) row.mentions = (row.mentions ?? 0) + 1;
          if (mine(data)) {
            const chat = S.chats.find((c) => c.id === data.chat_id);
            if (chat) chat.mentions = (chat.mentions ?? 0) + 1;
            if (S.project) S.project.mentions = (S.project.mentions ?? 0) + 1;
          }
          render();
        }
      }
      if (!here(data)) return;
      S.project.messages.push(data);
      render();
      // A reply costs somebody their allowance, and if that somebody is you,
      // the line under it should say so. Only worth asking when you have an
      // allowance at all.
      if (data.agent_id !== null && S.me?.daily_tokens) loadMe().then(render);
      return;
    }

    case 'agent.stream.start': {
      liveMapFor(data.project_slug, data.chat_id).set(data.agent_id, {
        reply: '', trace: '', tool: null, error: false, nodes: null, open: false,
      });
      if (here(data)) render();
      return;
    }

    case 'agent.stream.reasoning': {
      const entry = liveFor(data.project_slug, data.chat_id, data.agent_id);
      entry.trace += data.delta;
      if (!here(data)) return;
      if (entry.nodes) {
        entry.nodes.trace.textContent = entry.trace;
        entry.nodes.thinking.hidden = false;
      } else render();
      return;
    }

    case 'agent.stream.chunk': {
      const entry = liveFor(data.project_slug, data.chat_id, data.agent_id);
      entry.reply += data.delta;
      if (!here(data)) return;
      if (entry.nodes) {
        entry.nodes.reply.textContent = entry.reply;
        entry.nodes.reply.hidden = false;
        stickToBottom();
      } else render();
      return;
    }

    case 'agent.tool': {
      const entry = liveFor(data.project_slug, data.chat_id, data.agent_id);
      entry.tool = data.path ? `${data.tool} ${data.path}` : data.tool;
      if (!here(data)) return;
      if (entry.nodes) entry.nodes.tool.textContent = toolLabel(entry.tool);
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
      // A helper changing the game's colours retints the studio. Not while
      // there are unsaved ones in the editor: re-reading would throw those
      // away, and they are on their way into this same file.
      if (data.paths.includes(LOOK_FILE) && !S.palette?.dirty) loadPalette().then(render);
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
        if (S.open.dirty || S.draw?.dirty || S.sound?.dirty) {
          say(`${S.open.path} changed while you were working on it. What you have is still here — saving will ask before overwriting.`);
          // The file on screen is untouched, but it has one more version than
          // it had a moment ago — including when this is the commit our own
          // save just made and the event beat the answer to it.
          countVersions();
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

  // A file opened from a link or a chip may sit in a folded folder; the row
  // showing is what says the editor is about this file, so unfold it.
  const top = dirOf(path);
  if (top) closedDirs().delete(top);

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
  S.sound = null;
  S.soundRefused = null;
  S.tab = 'files';
  render();
  // A picture opens as a picture you can draw on. There was a second way to
  // look at one and it showed it at exactly the same size, so it was a control
  // that did nothing but cost a click.
  if (isDrawable(S.open)) await startDrawing();
  // A sound opens as the numbers that made it, when it is one of ours.
  else if (isSound(S.open)) await startSound();
  // Last, and inside this await like everything else here: it is a number on a
  // link, so nothing waits for it, but a render landing after openFile has
  // settled would write the wrong address.
  await countVersions();
}

// How many versions this file has, for the link that opens them. One commit
// asked for and the count read off the answer — the number is the point, the
// list is the Versions tab's job. A failure leaves the link saying "Versions",
// which is what it said before there was a number to put on it.
async function countVersions() {
  const token = opening;
  const path = S.open?.path;
  const res = await send(
    `/api/projects/${S.slug}/history?limit=1&path=${encodeURIComponent(path)}`,
  );
  if (opening !== token || S.open?.path !== path) return;
  if (!res.ok) return;
  const body = await res.json().catch(() => null);
  if (opening !== token || S.open?.path !== path) return;
  S.open.versions = body?.total ?? 0;
  render();
}

// Closing throws away unsaved text, which is the one thing in the editor that
// git cannot get back, so it asks first.
// `then` is the file to open once this one is out of the way, so choosing
// another file in the list asks the same question rather than throwing the
// work away silently. Now that every picture opens ready to draw on, that
// stray click is a great deal easier to make.
function closeOpenFile(then = null) {
  if (!S.open) return;
  if (S.open.dirty || S.draw?.dirty || S.sound?.dirty) {
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
  S.sound = null;
  S.soundRefused = null;
  render();
}

// Choosing a file from anywhere at all — the list, a path in a diff, the
// header of one file's versions. Through closeOpenFile so unsaved work in the
// file being left gets the same question the ✕ asks, wherever the click came
// from.
export const chooseFile = (path) => (S.open ? closeOpenFile(path) : openFile(path));

// The third answer to that question: keep the work rather than throw it away.
// Whichever pane is open holds the unsaved thing — the text or the picture —
// so this picks the save that belongs to it, and the file closes only once the
// save has really landed. A conflict or a failure leaves the file open with
// the work still in it, exactly like the button in the editor bar.
export async function saveAndClose(then = null) {
  if (!S.open) return;
  let saved;
  if (S.draw) saved = await saveDrawing();
  else if (S.sound) saved = await saveSound();
  else saved = await saveOpenFile();
  if (saved) await closeOpenFile(then);
}

// True when the file is saved, false when it is not — a conflict or a failure
// — so "Save and close" knows whether closing would lose anything.
export async function saveOpenFile({ force = false } = {}) {
  if (!S.open) return false;
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
    return false;
  }
  if (!res.ok) {
    say(problem(res, body?.error ?? 'Could not save that file.'), true);
    return false;
  }
  S.open.etag = body.etag;
  S.open.dirty = false;
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${S.open.path}.`);
  return true;
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
// submodule survives.
//
// A game gets the library once, when it is created (server/files/library.js),
// and keeps what it was born with; studio/studio.json records which version
// that was. There is no update from in here. Bringing an older game forward is
// a sweep across the game repositories from a machine that has them all —
// deploy/sync-games.sh — where the change can be read and undone, rather than
// a button that rewrites somebody's game in one click and asks nothing.
//
// The rule that makes it a library and not just a folder is in
// server/files/paths.js: a helper reads it and cannot write it.
export const LIBRARY_DIR = 'studio';

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
  // A strip is wider than it is tall by whole frames, which is the same test
  // the sprites library makes when it decides to animate one. So the shape
  // picks the folder: something that moves is a sprite, and everything else is
  // a picture to look at.
  const dir = width > height ? SPRITE_DIR : IMAGE_DIR;
  const path = assetPath(dir, `${name || 'picture'}.png`);
  const { failure } = await writeFiles([{ path, body: await pictureBlob(blankPicture(width, height)) }]);
  if (failure) { say(failure, true); return; }
  say(`Made ${path}.`);
  // openFile opens a picture ready to draw on; there is nothing to add here.
  await openFile(path);
}

/* Sounds ------------------------------------------------------------------- */

// Anything the browser calls audio is offered to the editor. What decides is
// the file itself: one the studio wrote carries the numbers it was made from,
// and anything else — an uploaded .wav, an .mp3 — has nothing to slide and
// stays the player it always was.
const isSound = (open) => !!open?.mime?.startsWith('audio/');

// The numbers come back out of the file rather than out of anything the studio
// kept, so what the sliders show is what is on disk. Same ownership rule as
// the picture: a sound read after a newer file has been asked for is dropped.
async function startSound() {
  const token = opening;
  const stale = () => opening !== token;
  const path = S.open.path;

  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
  if (stale()) return;
  if (!res.ok) {
    S.soundRefused = problem(res, 'The studio could not read this sound.');
    say(S.soundRefused, true);
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (stale()) return;
  const params = soundIn(bytes);
  if (!params) {
    // Said out loud rather than left as a player with no sliders: the numbers
    // cannot be worked back out of the samples, and without a line here that
    // reads as the studio forgetting how to open its own files.
    S.soundRefused = 'This one was not made here, so there are no numbers to change. It plays like any other sound.';
    render();
    return;
  }
  S.sound = { params, dirty: false };
  render();
}

// True when it landed and false when it did not, like the other two.
async function saveSound() {
  const { path } = S.open;
  const holding = S.sound;
  const headers = S.open.etag ? { 'if-match': S.open.etag } : {};
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
    method: 'PUT', headers, body: new Blob([soundBytes(holding.params)], { type: 'audio/wav' }),
  });
  const body = await res.json().catch(() => null);
  // Two sounds cannot be compared in a dialog any more than two pictures can,
  // and the numbers are the whole file, so this says what happened and touches
  // nothing.
  if (res.status === 409) {
    say(`Someone changed ${path} while you were working on it. Close it and open it again to hear theirs.`, true);
    return false;
  }
  if (!res.ok) {
    say(problem(res, body?.error ?? 'Could not save that sound.'), true);
    return false;
  }
  // The save is a commit and a commit rebuilds the pane, so only the editor
  // that asked may finish the job.
  if (S.sound === holding && S.open?.path === path) {
    S.open.etag = body.etag;
    S.sound.dirty = false;
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${path}.`);
  return true;
}

// A name nobody has to think of. The sound is made first and named afterwards
// — by then you have heard it, which is the only moment anybody knows what it
// should be called — so this only has to be free and say what it is.
function freeName(dir, stem, ext) {
  for (let n = 1; ; n += 1) {
    const path = `${dir}/${stem}${n > 1 ? `-${n}` : ''}${ext}`;
    if (!S.files.some((f) => f.path === path)) return path;
  }
}

// No dialog: the one thing it used to ask that mattered was the name, and a
// name is a better question after you have heard the sound than before. It
// lands as a plain blip and opens on its sliders; Rename is in the same bar.
export async function createSound() {
  const path = freeName(SOUND_DIR, 'sound', '.wav');
  const body = new Blob([soundBytes(soundFrom('pickup'))], { type: 'audio/wav' });
  const { failure } = await writeFiles([{ path, body }]);
  if (failure) { say(failure, true); return; }
  say(`Made ${path}. Change it with the sliders, and Rename it when it sounds like something.`);
  // Opening it is what shows the sliders — the file carries them — so making a
  // sound and changing one later are the same thing from here on.
  await openFile(path);
}

/* The game's colours ------------------------------------------------------- */

// The palette is a *config file* like any other, which is the whole point:
// changing a colour is a commit on the game, it shows up in Versions, and a
// helper can read the same list the drawing tools offer.
const LOOK_FILE = 'config/look.js';

// The four colours a game lends the studio while it is open, read from `LOOK`
// in the same file and set on the shell as --look-primary and friends. The
// names are the game's own to change; what each one means is in GLOSSARY.md,
// and the short of it is: primary is the game's voice, accent is its second,
// highlight is a number worth looking at, deep is the dark behind them.
const LOOK_ROLES = ['primary', 'accent', 'highlight', 'deep'];

// ⚠️ This string is written into a style attribute, so it is checked rather
// than trusted: no semicolon or colon, so a value cannot close the declaration
// and start another, and no url() or var(). A colour that does not pass is
// simply not applied, which leaves the studio's own default standing.
const isLookColour = (value) => typeof value === 'string'
  && value.length <= 64
  && /^[a-z0-9#(),.%\s/-]+$/i.test(value)
  && !/url|expression|var\s*\(/i.test(value);

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
  S.look = {};
  if (!S.files.some((f) => f.path === LOOK_FILE)) return;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(LOOK_FILE)}`);
  if (!res.ok) return;
  const text = await res.text();
  S.palette.text = text;
  const parsed = parseConfigFile(text);
  // The same file, read once for two things: the squares the drawing tools
  // offer, and the four colours the studio wears while this game is open.
  const look = parsed.ok ? parsed.decls.find((d) => d.name === 'LOOK') : null;
  const values = look?.node?.value;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    for (const name of LOOK_ROLES) {
      // A colour and nothing else: this string goes into a style attribute, so
      // anything that is not plainly a colour is dropped rather than trusted.
      if (isLookColour(values[name])) S.look[name] = values[name].trim();
    }
  }
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
  // A step may have landed on a frame that is not on screen; jumping to the
  // frame it touched is what makes the undo visible rather than baffling.
  const p = S.draw.picture;
  const frames = p.width > p.height && p.width % p.height === 0 ? p.width / p.height : 1;
  if (frames > 1 && !S.draw.whole && move.at.length) {
    S.draw.frame = Math.floor((move.at[0] % p.width) / (p.width / frames));
  }
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
// so one button covers the work in the pane. True when everything landed and
// false when any of it did not, the same answer as saveOpenFile, so "Save and
// close" knows whether closing would lose anything.
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
      return false;
    }
    if (!res.ok) {
      say(problem(res, body?.error ?? 'Could not save that picture.'), true);
      return false;
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
  if (!colours) return false;
  if (drew && recoloured) say(`Saved ${path} and the colours.`);
  else if (recoloured) say(`Saved the colours in ${LOOK_FILE}.`);
  else say(`Saved ${path}.`);
  return true;
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

// A duplicate is a new file that starts as another one: the bytes on disk,
// copied server-side, one commit. Unsaved edits stay where they are — in the
// editor, on the original — so the duplicate is of the last save.
export async function duplicateFile(from, to) {
  if (!to || to === from) return;
  const res = await api('POST', `/api/projects/${S.slug}/files/duplicate`, { from, to });
  if (!res.ok) {
    say(res.body?.error ?? `Could not duplicate ${from}.`, true);
    return;
  }
  S.previewNonce += 1;
  await refreshFiles();
  // The duplicate is the file you are about to change, so it opens — unless
  // the original holds unsaved work, which openFile would silently drop.
  if (!S.open?.dirty && !S.draw?.dirty && !S.sound?.dirty) await openFile(to);
  say(`Made ${to}.`);
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

// Open: anybody in the studio may change this game. An author's decision, and
// only an author's — the server says so too.
export async function setOpenEdit(open) {
  const res = await api('POST', `/api/projects/${S.slug}/open`, { open_edit: open });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change that.', true);
    return;
  }
  S.project.open_edit = open;
  await loadProjects();
  say(open
    ? 'Anybody in the studio can change this game now.'
    : 'Only this game’s editors can change it now — it wears a lock.');
  render();
}

// Who may change this game. The list comes back whole, so nothing here has to
// guess what the server did with a name it did not recognise.
export async function setAuthors(method, userId) {
  const path = method === 'POST'
    ? `/api/projects/${S.slug}/authors`
    : `/api/projects/${S.slug}/authors/${userId}`;
  const res = await api(method, path, method === 'POST' ? { user_id: userId } : undefined);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not change who can edit this.', true);
    return;
  }
  S.project.authors = res.body.authors;
  S.project.mine = res.body.authors.some((a) => a.id === S.me.id);
  S.project.can_edit = S.project.mine || S.project.open_edit;
  await loadProjects();
  render();
}

export async function setPublished(published) {
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
    S.history = res.body.commits;
    S.historyTotal = res.body.total;
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
    reasoning: agent.reasoning,
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

// A file into another game: the bytes and nothing else. The route reads the
// source and writes the target, so the rights it checks are the target's.
export async function copyFileTo(slug, from, to) {
  const res = await api('POST', `/api/projects/${slug}/files/import`, {
    from_slug: S.slug, from_path: from, to_path: to,
  });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not copy that file.', true);
    return;
  }
  const game = S.projects.find((p) => p.slug === slug);
  say(`Copied ${to} into ${game?.name ?? slug}.`);
}

/* Running the studio ------------------------------------------------------- */

// The panel's data, fetched when it opens and re-fetched after every change:
// the numbers in it — what somebody has spent today — are the server's to
// know, and stale ones would be worse than a moment's wait.
export async function loadStudio() {
  const res = await api('GET', '/api/admin/studio');
  if (!res.ok) {
    say(res.body?.error ?? 'Could not read the studio settings.', true);
    return false;
  }
  S.admin = res.body;
  return true;
}

// One call for every change the panel makes, so every one of them ends with
// the same refreshed numbers.
export async function studioChange(method, path, body) {
  const res = await api(method, `/api/admin${path}`, body);
  if (!res.ok) {
    say(res.body?.error ?? 'Could not do that.', true);
    return false;
  }
  await loadStudio();
  // A name may have changed, and it is on messages and in the crew list.
  await loadPeople();
  render();
  return true;
}

/* Chats -------------------------------------------------------------------- */

// Switching conversations inside one game. Not openProject: the files, the
// pins and the open file all belong to the game rather than to the chat, and
// throwing them away to read a different thread would be the same mistake
// Back used to make.
export async function openChat(id) {
  if (!S.project || id === S.chat?.id) return;
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
  S.autoscroll = true;
  readMentions();
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

export async function renameChat(id, name) {
  const res = await api('PATCH', `/api/projects/${S.slug}/chats/${id}`, { name });
  if (!res.ok) {
    say(res.body?.error ?? 'Could not rename that chat.', true);
    return;
  }
  S.chats = S.chats.map((c) => (c.id === id ? res.body : c));
  if (S.chat?.id === id) S.chat = res.body;
  render();
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
    chat_id: S.chat?.id,
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
      h('h1', { class: 'auth-title' }, wordmark('UNBRIDLED', 'JOY')),
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

// The sound as its numbers, with the same bar under it as every other pane.
// The sliders paint themselves (sound-form.js); this is the part that knows
// whether they have been saved.
function renderSoundEditor() {
  const state = h('span', { class: 'hint muted' });
  const save = h('button', { class: 'filled', text: 'Save', onclick: () => saveSound() });
  const saveClose = h('button', {
    class: 'filled ok', text: 'Save and close',
    onclick: async () => { if (await saveSound()) await closeOpenFile(); },
  });
  const paint = () => {
    state.textContent = S.sound.dirty ? 'Not saved yet' : 'Saved';
    save.disabled = !S.sound.dirty || frozen();
    saveClose.disabled = save.disabled;
  };
  const changed = () => { S.sound.dirty = true; paint(); };
  paint();

  return h('div', { class: 'sound grow' },
    h('div', { class: 'scroll pad', 'data-scroll': 'sound' }, renderSoundForm(S.sound.params, changed)),
    h('div', { class: 'editor-bar row' },
      state,
      h('div', { class: 'spacer' }),
      h('button', { class: 'quiet', text: 'Play', onclick: () => playSound(S.sound.params) }),
      save,
      saveClose));
}

// Everything here is painted into one canvas and one pair of nodes rather
// than through render(), which would rebuild the canvas under the pointer
// drawing on it — the same reason the problems panel is painted in place.
function renderDrawing() {
  const { picture } = S.draw;

  // A strip — width a whole multiple of height — opens one frame at a time:
  // the canvas shows the frame being edited, the strip loops in a small
  // preview beside the frame buttons, and the tools are clipped to the frame
  // so a wide brush or a fill cannot leak into the neighbours. "Whole strip"
  // is the way back to seeing and drawing across everything at once.
  const frames = picture.width > picture.height && picture.width % picture.height === 0
    ? picture.width / picture.height
    : 1;
  const frameMode = frames > 1 && !S.draw.whole;
  const fw = picture.width / frames;
  if (!Number.isInteger(S.draw.frame) || S.draw.frame >= frames) S.draw.frame = 0;
  const viewW = frameMode ? fw : picture.width;
  const offsetX = frameMode ? S.draw.frame * fw : 0;
  if (frameMode) clipFrame(picture, offsetX, offsetX + fw);
  else unclip(picture);

  // Blocking up the pixels is what a sprite wants and what a photograph does
  // not: past a few hundred across, a picture is being shown at or below its
  // own size and hard edges just make it look broken.
  const chunky = viewW <= 256 && picture.height <= 256;
  const canvas = h('canvas', {
    class: `pixels${chunky ? '' : ' smooth'}`, width: viewW, height: picture.height,
  });

  // The whole picture, kept as a canvas for the frame view, the ghost and
  // the looping preview to draw slices of. Refreshed by paint().
  const whole = document.createElement('canvas');
  whole.width = picture.width;
  whole.height = picture.height;

  // In the whole-strip view the frame boundaries are an overlay — one screen
  // pixel at any zoom, never part of what is saved. The canvas letterboxes
  // the picture (object-fit: contain), so the overlay is fitted with the
  // same arithmetic spotOf uses, re-run on every resize.
  let lines = null;
  if (frames > 1 && !frameMode) {
    lines = h('div', { class: 'frame-lines' });
    lines.style.setProperty('--frames', frames);
    const place = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const scale = Math.min(box.width / picture.width, box.height / picture.height);
      lines.style.width = `${picture.width * scale}px`;
      lines.style.height = `${picture.height * scale}px`;
    };
    new ResizeObserver(place).observe(canvas);
  }
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
  // The same pair as the text editor, so every pane ends the same way. Closes
  // only once the save really landed: a picture somebody else changed
  // underneath stays open with the drawing still on it.
  const saveClose = h('button', {
    class: 'filled ok', text: 'Save and close',
    onclick: async () => { if (await saveDrawing()) await closeOpenFile(); },
  });

  const paint = () => {
    whole.getContext('2d')
      .putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    if (frameMode) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, viewW, picture.height);
      // The ghost: the frame before, very faint, to draw against. Display
      // only — the eyedropper and the save never see it. Frame one ghosts
      // the last frame, because the animation loops.
      if (S.drawPrefs.ghost) {
        const prev = ((S.draw.frame + frames - 1) % frames) * fw;
        ctx.globalAlpha = 0.25;
        ctx.drawImage(whole, prev, 0, fw, picture.height, 0, 0, fw, picture.height);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(whole, offsetX, 0, fw, picture.height, 0, 0, fw, picture.height);
    } else {
      canvas.getContext('2d')
        .putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    }
    state.textContent = unsaved();
    save.disabled = (!S.draw.dirty && !S.palette?.dirty) || frozen();
    saveClose.disabled = save.disabled;
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
  // off before a position on screen is a square in the picture — plus the
  // frame's own offset, when the canvas is showing one frame of a strip.
  const spotOf = (event) => {
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(box.width / viewW, box.height / picture.height);
    const left = box.left + (box.width - viewW * scale) / 2;
    const top = box.top + (box.height - picture.height * scale) / 2;
    return [
      Math.floor((event.clientX - left) / scale) + offsetX,
      Math.floor((event.clientY - top) / scale),
    ];
  };

  let last = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (frozen()) return;
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
  const available = BRUSHES.filter((n) => n === 1 || n <= Math.min(viewW, picture.height) / 4);
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

  // The strip, always playing while it is being edited: a small canvas on the
  // frame row looping at the library's own 8 frames a second, reading the
  // same `whole` canvas paint() refreshes — so a stroke shows up in the loop
  // as it is drawn. The loop stops itself once its canvas leaves the page, so
  // a render never leaks an animation.
  let frameRow = null;
  if (frames > 1) {
    const preview = h('canvas', { class: 'strip-preview', width: fw, height: picture.height });
    preview.style.width = `${Math.max(24, Math.round(40 * (fw / picture.height)))}px`;
    const pctx = preview.getContext('2d');
    let seen = false;
    const loop = (t) => {
      if (preview.isConnected) seen = true;
      else if (seen) return;
      const f = Math.floor(t / 125) % frames;
      pctx.clearRect(0, 0, fw, picture.height);
      pctx.drawImage(whole, f * fw, 0, fw, picture.height, 0, 0, fw, picture.height);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    frameRow = h('div', { class: 'row wrap' },
      preview,
      ...Array.from({ length: frames }, (_, i) => h('button', {
        class: `quiet tiny${frameMode && S.draw.frame === i ? ' on' : ''}`,
        text: `${i + 1}`,
        title: `Edit frame ${i + 1}`,
        onclick: () => { S.draw.whole = false; S.draw.frame = i; render(); },
      })),
      h('button', {
        class: `quiet tiny${frameMode ? '' : ' on'}`,
        text: 'Whole strip',
        title: 'See and draw across every frame at once',
        onclick: () => { S.draw.whole = true; render(); },
      }),
      h('div', { class: 'spacer' }),
      frameMode ? h('button', {
        class: 'quiet tiny', text: 'Copy frame',
        title: 'Remember this frame, to paste over another one',
        onclick: () => { S.draw.copied = copyFrame(picture, fw, S.draw.frame); render(); },
      }) : null,
      frameMode && S.draw.copied ? h('button', {
        class: 'quiet tiny', text: 'Paste frame',
        title: 'Paste the copied frame over this one — one Undo takes it back',
        disabled: frozen(),
        onclick: () => {
          if (picture.step) closed();
          opened();
          pasteFrame(picture, fw, S.draw.frame, S.draw.copied);
          closed();
          render();
        },
      }) : null,
      frameMode ? h('button', {
        class: `quiet tiny${S.drawPrefs.ghost ? ' on' : ''}`,
        text: 'Ghost',
        title: 'Show the frame before, very faintly, to draw against',
        onclick: () => { S.drawPrefs.ghost = !S.drawPrefs.ghost; render(); },
      }) : null);
  }

  paint();
  return h('div', { class: 'drawing grow' },
    h('div', { class: 'media grow' }, canvas, lines),
    h('div', { class: 'pad col' }, frameRow, tools, brushes, swatches),
    h('div', { class: 'editor-bar row' },
      state,
      h('span', {
        class: 'hint muted',
        text: frameMode
          ? `frame ${S.draw.frame + 1} of ${frames} — ${fw} × ${picture.height}`
          : frames > 1
            ? `${picture.width} × ${picture.height} — ${frames} frames of ${picture.height}`
            : `${picture.width} × ${picture.height}`,
      }),
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
      save,
      saveClose));
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

/* The scoreboard tab -------------------------------------------------------
   The kept scores for this game, with the admin's three moves: delete one,
   delete all, and the per-game switch. All of it talks to the studio origin —
   the games listener never reads a cookie, so nothing over there moderates. */

async function loadScores() {
  const res = await send(`/api/projects/${S.slug}/scores`);
  if (!res.ok) { say(problem(res, 'Could not load the scoreboard.'), true); return; }
  const body = await res.json();
  S.scores = body.scores;
  S.project.scores_on = body.scores_on;
}

async function toggleScores(on) {
  const res = await api('PATCH', `/api/projects/${S.slug}`, { scores_on: on });
  if (!res.ok) { say(res.body?.error ?? 'Could not change the scoreboard.', true); return; }
  S.project.scores_on = on;
  render();
}

export async function deleteScore(id) {
  const res = await send(`/api/projects/${S.slug}/scores/${id}`, { method: 'DELETE' });
  if (!res.ok) { say(problem(res, 'Could not delete that score.'), true); return false; }
  if (S.scores) S.scores = S.scores.filter((s) => s.id !== id);
  return true;
}

export async function clearScores() {
  const res = await send(`/api/projects/${S.slug}/scores`, { method: 'DELETE' });
  if (!res.ok) { say(problem(res, 'Could not delete the scores.'), true); return false; }
  S.scores = [];
  return true;
}

// "2 min ago" over a timestamp: a board full of same-day dates says nothing
// about which name just appeared.
function agoText(iso) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function renderScoreboardTab() {
  const on = S.project.scores_on !== false;
  const rows = (S.scores ?? []).map((s, i) => h('div', { class: 'score-row' },
    h('span', { class: 'rank', text: `#${i + 1}` }),
    h('span', { class: 'sname', text: s.name }),
    h('span', { class: 'sval mono', text: s.score.toLocaleString() }),
    h('span', { class: 'swhen', text: agoText(s.created_at) }),
    h('button', {
      class: 'icon tiny', text: '✕', title: 'Delete this score',
      onclick: () => { S.dialog = { kind: 'delete-score', score: s }; render(); },
    })));

  return [
    h('div', { class: 'pad row wrap' },
      // A button, not a link: it changes what the public origin serves.
      h('button', {
        class: 'quiet tiny',
        text: on ? 'Turn the scoreboard off' : 'Turn the scoreboard back on',
        onclick: () => toggleScores(!on),
      }),
      h('div', { class: 'spacer' }),
      S.scores?.length ? h('button', {
        class: 'danger tiny', text: 'Delete all scores',
        onclick: () => { S.dialog = { kind: 'clear-scores' }; render(); },
      }) : null),
    on ? null : h('div', {
      class: 'pad hint muted',
      text: 'The scoreboard is off: the game cannot show or take scores, and '
        + 'helpers are not told it exists. The scores below are kept.',
    }),
    h('div', { class: 'scroll', 'data-scroll': 'scores' },
      rows.length ? h('div', { class: 'score-list' }, ...rows) : h('div', {
        class: 'pad muted',
        text: S.scores === null ? 'Loading…' : 'No scores yet.',
      })),
  ];
}

/* The file list ------------------------------------------------------------ */

// Which top-level folders are folded shut, per game, for this session. Not a
// view: a fold is how you read a long list, not somewhere a link can send you.
const closedDirsBySlug = new Map();

function closedDirs() {
  let set = closedDirsBySlug.get(S.slug);
  if (!set) { set = new Set(); closedDirsBySlug.set(S.slug, set); }
  return set;
}

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : null);

// A dot per row, coloured by what the file is for: the page the game starts
// at, the code, the library it may not change. Everything else — art, sounds,
// words — keeps the muted default, because a colour per extension is a legend
// nobody reads. Gold is not here on purpose: it means a number or a version
// everywhere else in the studio, and a file is neither.
function fileDot(f) {
  const colour = f.library ? 'var(--ok)'
    : f.path === 'index.html' ? 'var(--accent)'
      : /\.(js|css|json|html)$/i.test(f.path) ? 'var(--agent)'
        : null;
  return h('span', { class: 'fdot', style: colour ? `background:${colour}` : null });
}

function renderFilesTab() {
  const fileRow = (f, top) => h('div', {
    class: `file${top ? ' inset' : ''}${S.open?.path === f.path ? ' open' : ''}${f.unreachable ? ' unreachable' : ''}${f.library ? ' library' : ''}`,
    // The whole row opens the file, not just the name on it. The row is what
    // lights up under the pointer, and the size, the gap and the padding used
    // to be lit and dead at the same time. An unreachable row does neither.
    // The open file's own row closes it again — the same control both ways,
    // like Show changes / Hide changes — through the same unsaved-work
    // question the ✕ asks.
    onclick: f.unreachable ? null : () => (
      S.open?.path === f.path ? closeOpenFile() : chooseFile(f.path)
    ),
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
  fileDot(f),
  // No handler of its own — the click reaches the row. Still a button so the
  // row can be got at by keyboard. Inside a folder the row shows the rest of
  // the path — the folder's own row already says the front of it.
  h('button', { class: 'fname', text: top ? f.path.slice(top.length + 1) : f.path, disabled: f.unreachable }),
  h('span', { class: 'fsize', text: sizeText(f.size) }));

  // The list is sorted by path, so a folder's files are already contiguous:
  // one header row where each top-level folder starts, and its files hidden
  // while it is folded shut. One level, on purpose — the studio asks helpers
  // for small flat trees, and js/lib/x.js under a js/ header still says lib/.
  const closed = closedDirs();
  const rows = [];
  let group = null;
  for (const f of S.files) {
    const top = dirOf(f.path);
    if (top !== group) {
      group = top;
      if (top !== null) {
        const inside = S.files.filter((x) => dirOf(x.path) === top);
        const bytes = inside.reduce((n, x) => n + x.size, 0);
        const shut = closed.has(top);
        rows.push(h('div', {
          class: 'file dir',
          onclick: () => {
            if (shut) closed.delete(top);
            else closed.add(top);
            render();
          },
        },
        // Square and amber against the files' round dots, which is the whole
        // difference between a folder row and a file row at a glance.
        h('span', { class: 'fdot' }),
        h('button', { class: 'fname', text: `${shut ? '▸' : '▾'} ${top}/` }),
        h('span', {
          class: 'fsize',
          text: `${inside.length} file${inside.length === 1 ? '' : 's'} · ${sizeText(bytes)}`,
        })));
      }
    }
    if (top !== null && closed.has(top)) continue;
    rows.push(fileRow(f, top));
  }

  const editor = [];
  if (S.open) {
    // One bar for both cases: a picture has nothing to edit but still has to
    // be closable, and Close belongs next to Delete either way.
    const bar = h('div', { class: 'bar' },
      h('div', { class: 'title mono', text: S.open.path }),
      h('div', { class: 'spacer' }),
      // The count is on the link because it is the thing worth knowing before
      // clicking it: one version means there is nothing to compare, and twelve
      // means this file has a story. Plain "Versions" until the number lands,
      // rather than a 0 that would be a lie for a file that exists.
      h('button', {
        class: 'link tiny',
        text: S.open.versions
          ? `${S.open.versions} version${S.open.versions === 1 ? '' : 's'}`
          : 'Versions',
        onclick: () => { S.tab = 'versions'; loadHistory(S.open.path); },
      }),
      h('button', {
        class: 'quiet tiny', text: 'Rename',
        disabled: frozen(),
        onclick: () => { S.dialog = { kind: 'rename-file', path: S.open.path }; render(); },
      }),
      h('button', {
        class: 'quiet tiny', text: 'Duplicate',
        disabled: frozen(),
        onclick: () => { S.dialog = { kind: 'duplicate-file', path: S.open.path }; render(); },
      }),
      // Into another game. Not disabled by frozen(): copying out of a game
      // takes nothing from it, and the rights that matter are the ones on the
      // game it lands in — which is what the dialog offers.
      h('button', {
        class: 'quiet tiny', text: 'Copy to…',
        title: 'Copy this file into another game',
        onclick: () => { S.dialog = { kind: 'copy-to', path: S.open.path }; render(); },
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
    // the reader will not touch, or you asked to see the text. Before that,
    // config/questions.js in the quiz shape opens as the quiz editor — the
    // whole game as a form — falling back through the generic form to the
    // text as the file outgrows each reader.
    const parsed = isConfigPath(S.open.path) && S.open.content !== null
      ? parseConfigFile(S.open.content)
      : null;
    const quiz = isQuizPath(S.open.path) && S.open.content !== null && !S.open.asText
      ? quizModel(S.open.content)
      : null;

    if (S.open.content === null) {
      const refused = S.drawRefused ?? S.soundRefused;
      editor.push(h('div', { class: 'editor' }, bar,
        S.draw ? renderDrawing() : S.sound ? renderSoundEditor() : renderMedia(S.open),
        refused ? h('div', { class: 'pad hint muted', text: refused }) : null));
    } else if (quiz?.ok) {
      editor.push(h('div', { class: 'editor' }, bar, ...renderQuizForm(quiz)));
    } else if (parsed?.ok && !S.open.asText) {
      editor.push(h('div', { class: 'editor' }, bar,
        quiz && !quiz.ok
          ? h('div', { class: 'pad hint muted', text: `Showing every field because ${quiz.reason}.` })
          : null,
        renderConfigForm(parsed.decls)));
    } else {
      const area = h('textarea', {
        id: EDITOR_AREA,
        spellcheck: 'false',
        oninput: (e) => {
          S.open.content = e.currentTarget.value;
          S.open.dirty = true;
          for (const id of ['save-btn', 'save-close-btn']) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
          }
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
            disabled: !S.open.dirty || frozen(),
            onclick: () => saveOpenFile(),
          }),
          // Closes only once the save really landed: a conflict or a failure
          // keeps the file open with the words still in it.
          h('button', {
            class: 'filled ok', id: 'save-close-btn', text: 'Save and close',
            disabled: !S.open.dirty || frozen(),
            onclick: async () => { if (await saveOpenFile()) closeOpenFile(); },
          }))));
    }
  }

  // With a file open the list shrinks to about five rows and the editor takes
  // everything else; with nothing open the list fills the pane.
  const tree = h('div', { class: `tree scroll${S.open ? ' short' : ''}`, 'data-scroll': 'files' },
    rows.length ? rows : h('div', {
      class: 'pad muted',
      text: 'No files yet. Ask a helper to make one, or drop a file here.',
    }));
  if (!frozen()) makeDropTarget(tree);

  return [
    // One button, four ways in. The four used to sit here in a row that
    // wrapped to two lines in a narrow rail and put the rarest of them beside
    // the commonest; which kind of file you are adding is a question, so it is
    // asked in a dialog.
    h('div', { class: 'pad row wrap' },
      h('button', {
        class: 'quiet tiny', text: 'Add a file',
        title: 'Make a file, upload one, draw a picture or make a sound',
        disabled: frozen(),
        onclick: () => { S.dialog = { kind: 'add-file' }; render(); },
      }),
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
}

function renderProblems() {
  const list = h('div', { class: 'problem-list' });
  const box = h('div', { class: 'problems' },
    h('div', { class: 'problems-head', text: 'The game ran into trouble' }),
    list,
    h('div', { class: 'hint muted', text: 'Your helpers can see this. Ask them to fix it.' }));
  problemNodes = { box, list };
  paintProblems();
  return box;
}

// The best anybody has scored, for the strip under the preview. Only when the
// board is on and the scores happen to be loaded — a number that is sometimes
// absent is better than a request fired to fill a label.
const bestScore = () => (S.project.scores_on !== 0 && S.scores?.length ? S.scores[0].score : null);

const showScore = (n) => n.toLocaleString();

// The preview, which is no longer a tab: a game is the thing you are working
// on, so it sits at the top of the rail whatever else is open. Collapsed, it
// is one row that still plays.
//
// The frame loads the studio's wrapper — the game's own index.html with the
// reporter injected — while Open, and everyone playing, gets the untouched
// page. That is why no game carries a script tag for this and why every game
// already reports.
function renderPreview() {
  const best = bestScore();
  const url = `${S.project.play_url}_studio.html?v=${S.previewNonce}`;
  const shut = () => {
    S.previewOpen = !S.previewOpen;
    prefs.set('preview', S.previewOpen ? 'open' : 'closed');
    render();
  };
  // The same control either way — folded, the row around it is a button too,
  // so the click must not also reach it and unfold the game.
  const openInTab = (stop) => h('a', {
    href: S.project.play_url,
    target: '_blank',
    rel: 'noreferrer',
    onclick: stop ? (e) => e.stopPropagation() : null,
  }, h('button', { class: 'icon', text: 'Open', title: 'Play it in its own tab' }));

  return h('div', { class: `preview-wrap${S.previewOpen ? '' : ' collapsed'}` },
    // Built either way: the iframe is only in the tree when it is open, so a
    // collapsed preview is not a game running silently in the background.
    S.previewOpen ? h('iframe', { class: 'preview-frame', src: url, title: 'Game preview' }) : null,
    S.previewOpen
      ? h('div', { class: 'preview-foot' },
        best === null ? null : h('span', { class: 'best', text: `BEST ${showScore(best)}` }),
        h('div', { class: 'spacer' }),
        openInTab(false),
        h('button', { class: 'icon', text: 'Hide ▲', title: 'Fold the game away', onclick: shut }))
      : null,
    // Folded: one row. The same control that hid it brings it back — Hide ▲
    // and Show ▼ are one button in two states, in the place the eye already
    // is — and the whole row is a way in too, because it lights up. Open comes
    // with it: playing the game in its own tab is the one thing you would fold
    // the preview away and still want.
    S.previewOpen ? null : h('div', {
      class: 'preview-row', title: `Show ${S.project.name}`, onclick: shut,
    },
    h('span', { class: 'play', text: '▶' }),
    h('span', { class: 'pname', text: `Play ${S.project.name}` }),
    openInTab(true),
    h('button', {
      class: 'icon', text: 'Show ▼', title: 'Show the game',
      // The row under it is a button in all but name; letting the click reach
      // it as well would toggle twice and fold it straight back.
      onclick: (e) => { e.stopPropagation(); shut(); },
    })),
    // Rendered either way. Folding the game away stops it running, but the
    // problems it already reported are still the answer to "why is it broken",
    // and a panel that vanished with the frame would take them with it.
    renderProblems());
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
        // Fresh every time: the public posts scores while the studio is idle.
        if (id === 'scoreboard') await loadScores();
      });
      render();
    },
  });

  let body = [];
  if (S.tab === 'versions') body = renderVersionsTab();
  else if (S.tab === 'scoreboard') body = renderScoreboardTab();
  else body = renderFilesTab();

  return h('div', { class: `pane rail${S.narrowPane === 'rail' ? ' show' : ''}` },
    railGrip(),
    // Above the tabs and outside them: the game is what the rail is about, and
    // it used to be a tab you had to leave the files to see.
    renderPreview(),
    h('div', { class: 'pad row' },
      h('button', { class: 'quiet only-narrow', text: '←', onclick: () => { S.narrowPane = 'chat'; render(); } }),
      h('div', { class: 'tabs' },
        tab('files', 'Files'), tab('versions', 'Versions'),
        tab('scoreboard', 'Scoreboard'))),
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
  // The open game lends the studio its four colours, as an inline style on the
  // shell — the chat pane, its buttons, the composer, the drawer and the rail
  // read them and nothing else does. A game that names none of them leaves the
  // studio's own defaults standing, so a partial look is fine.
  const app = h('div', {
    class: `app${S.sidebar ? '' : ' side-closed'}${isChat() ? ' no-rail' : ''}`,
    style: [`--rail:${S.railWidth}px`, ...LOOK_ROLES
      .filter((name) => S.look[name])
      .map((name) => `--look-${name}:${S.look[name]}`)].join(';'),
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
