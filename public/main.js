// Unbridled Joy — the client's core. Vanilla, no build step, no framework.
// Structural changes re-render a pane; streaming text mutates live nodes in
// place so a long reply doesn't rebuild the thread on every chunk.
//
// This file holds what everything else leans on — the state, the transport,
// the URL and the boot sequence — plus render(), which composes the panes
// that live in the modules beside it: dom.js, sidebar.js, chat.js,
// versions.js, config-form.js, sound-form.js, dialogs.js, upload.js, and the
// feature modules a game's project state is split across: stream.js (the SSE
// connection and streaming replies), telemetry.js (what a running game
// reports), files.js (the file lifecycle), drawing.js (the pixel editor and
// the game's colours), sound-editor.js, files-tab.js (Code), pics-hear.js,
// history.js (Versions), scoreboard.js, chats.js and people.js.

import { h } from './dom.js';
import { isFileDrag } from './upload.js';
import { QUIZ_FILE } from './quiz-editor.js';
import {
  loadAchievements, parkAchievements, renderAchievementsTab,
} from './achievements-form.js';
import { renderControlsEditor } from './controls-form.js';
import {
  loadStory, parkStory, saveStory, dropStageImages, selectScene,
  renderStoryInspector,
} from './story-form.js';
import { editorsFor, modesFor } from './game-types.js';
import { renderVersionsTab } from './versions.js';
import { renderChat } from './chat.js';
import { renderSidebar, wordmark } from './sidebar.js';
import { dialogFor } from './dialogs.js';
import {
  setReservedImages, loadReservedImages, chooseFile, closeOpenFile, openFile,
  openControls, syncIcons,
} from './files.js';
import {
  loadPalette, flushPalette, lookFileWith, LOOK_FILE, LOOK_ROLES,
} from './drawing.js';
import { renderFilesTab } from './files-tab.js';
import { renderPicsMode, renderHearMode, renderPickInspector } from './pics-hear.js';
import {
  loadHistory, loadDiff, historyNeedsLoad, keepDiffInView,
} from './history.js';
import { loadScores, bestScore, showScore, renderScoreboardTab } from './scoreboard.js';
import { readChat, openChat, stickToBottom, sendMessage } from './chats.js';
import { renderProblems, renderMoments, resetGameNodes } from './telemetry.js';
import { loadPeople } from './people.js';
import { connectStream, liveMapFor } from './stream.js';

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
  // Which mode the centre pane is in (public/game-types.js, spec.md §6):
  // 'chat', an editor's id, 'code' or 'share'. S.chat is untouched by it: the
  // chat behind another mode is still the chat, filling and marking while
  // that mode is up.
  mode: 'chat',
  // Which ··· is open, if any: 'game' for the one beside the game's name.
  menu: null,
  // The story editor's state while the open game has one: {text, etag, model,
  // dirty, scene, step, person}, {grown: reason} when the file will not read
  // as a story, or null (story-form.js).
  story: null,
  // The achievements editor's state once Share has been opened: {text, etag, model,
  // dirty}, {grown: reason} when the file will not read as achievements, or
  // null (achievements-form.js).
  achievements: null,
  // The studio's control scheme registry, once the Controls panel has asked
  // for it: what it offers, the families, and the words for each. The
  // studio's own rather than a game's, so it outlives opening another game.
  schemes: null,
  // Which verb is open in the Controls panel — `player1/fire` — and which,
  // if any, is waiting for a key to be pressed. One at a time, like a row's
  // changes in the versions list.
  controlsVerb: null,
  controlsKey: null,
  files: [],
  // What the game said when it ran, for the version of the files on disk now.
  errors: [],
  pinned: new Set(),
  open: null, // {path, content, etag, dirty, conflict}
  // What Pics has selected into the inspector: {kind: 'picture', path} or
  // {kind: 'person', key}. Hear's selection is the open sound itself.
  pick: null,
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
  // The open game's chat.png and hero.png, and every game's icon.png for the
  // sidebar, keyed by slug — reserved images, as object URLs. See the
  // "reserved images" section for why they are held rather than pointed at.
  images: { chat: null, hero: null },
  icons: new Map(),
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
  // Which message's emoji palette is open, or null. One at a time, and in
  // state rather than only in the DOM so a background render reopens it.
  reactionPicker: null,
  dialog: null,
  banner: null,
  // A state, not an event: false from the moment something fails to reach the
  // studio until the live stream is back. A banner would time out and leave
  // somebody typing into a studio that cannot hear them.
  connected: true,
  previewNonce: 0,
  // "Try this scene" in the story editor: the scene the preview opens into.
  // Read only while an editor is up, and cleared with the game.
  tryScene: null,
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
export const EDITOR_AREA = 'editor-area';
// The sidebar's filter box. Every keystroke in it re-renders the pane it is
// in, so without this it would lose the caret on its own second character.
export const SIDE_SEARCH = 'side-find';
// The story editor's fields are every one of these too: a helper's reply
// landing behind the editor renders, and the line being typed must not lose
// its caret to it. They carry ids starting story-.
const keepsFocus = (id) => id === EDITOR_AREA || id === SIDE_SEARCH || Boolean(id?.startsWith('story-'));

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
  if (el !== composerBox && !keepsFocus(el?.id)) return null;
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
export function setConnected(on) {
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
export const problem = (res, fallback) => (res.status === 0 ? NO_CONNECTION : fallback);

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

// Addresses from before the mode row (spec.md §6): `?edit=` named an editor
// and `?tab=` a rail tab. Still read, never written; `?tab=play` and any
// other stranger fall back to the game's own default.
const modeFromOld = (edit, tab) => edit ?? (tab === 'files' ? 'code'
  : tab === 'versions' ? 'versions'
    : ['scoreboard', 'achievements'].includes(tab) ? 'share' : null);

// The URL is the view: which game, which mode, which file, which version — so
// what someone is looking at is always the thing they can send to somebody
// else. `file` is whichever file the mode is about: the open one under Code,
// the filter on Versions' list. One name because it is one idea.
const viewFromUrl = () => {
  const q = new URLSearchParams(location.search);
  return {
    mode: q.get('mode') ?? modeFromOld(q.get('edit'), q.get('tab')),
    file: q.get('file'), version: q.get('version'),
    chat: q.get('chat'), scene: q.get('scene'),
  };
};

// An editor id the open game's type actually brings, or null.
const editorOf = (id) => (editorsFor(S.project?.type).some((e) => e.id === id) ? id : null);
export const hasEditor = (id) => editorOf(id) === id;
// A mode the open project has, or null. An unknown one in an address falls
// back to the chat rather than to an empty pane.
const modeOf = (id) => (modesFor(S.project).some((m) => m.id === id) ? id : null);
// The editor the centre is showing, when the mode is one.
export const editorShowing = () => editorsFor(S.project?.type).find((e) => e.id === S.mode) ?? null;

// Which mode the centre is in, remembered per game. Leaving one is where a
// version belongs: the last lines typed go in, and then the game's pending
// commit lands (spec.md §5). Not awaited — the surface changes now, and the
// timer lands it if this did not.
export function showMode(id) {
  const mode = modeOf(id) ?? 'chat';
  if (S.slug && S.mode !== mode) {
    (S.story?.dirty ? saveStory() : Promise.resolve()).then(() => commitNow());
  }
  S.mode = mode;
  S.menu = null;
  if (S.slug) prefs.set(`mode-${S.slug}`, mode);
}

// Share shows what the public holds, so arriving there reads it: the scores,
// fresh every time because the public posts while the studio idles, and the
// achievements.
export async function loadShare() {
  await loadScores();
  if (!S.achievements || S.achievements.grown) await loadAchievements();
}

// The game owes history whatever has been saved since its last version
// (spec.md §5). Said on the way out — of the game, the editor, a scene, the
// tab — so a version is where the work stopped rather than 45 seconds later.
// `keepalive` is for the tab closing, where a plain fetch is cancelled.
export function commitNow(slug = S.slug, { keepalive = false } = {}) {
  // An archived game owes nothing — archiving landed it — and refuses the ask.
  if (!slug || S.project?.archived) return Promise.resolve();
  return send(`/api/projects/${slug}/commit`, { method: 'POST', keepalive })
    .catch(() => { /* the idle timer lands it if this did not */ });
}

// One ··· per thing (spec.md §6): the button, and while it is open, its menu
// — items in one order, each `{text, onPick, danger?, title?}`, with anything
// the reader may not press left out by the caller rather than greyed here.
// Which one is open is `S.menu`, keyed by the thing, so a render keeps it;
// the listener at the foot of this file closes it on a click anywhere else.
// Clicks stop here: the row a ··· sits in usually opens something on a click.
export function more(key, items, { label = 'More', small = true } = {}) {
  const list = items.filter(Boolean);
  if (list.length === 0) return null;
  const open = S.menu === key;
  const button = h('button', {
    class: `icon more-dots${small ? ' tiny' : ''}${open ? ' on' : ''}`, text: '···',
    title: label, 'aria-label': label,
    'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false',
    onclick: (e) => {
      e.stopPropagation();
      S.menu = open ? null : key;
      menuOpenedAt = performance.now();
      render();
    },
  });
  const menu = open ? h('div', { class: 'menu', role: 'menu' }, list.map((item) => h('button', {
    class: `menu-item${item.danger ? ' danger' : ''}`, text: item.text, title: item.title, role: 'menuitem',
    onclick: (e) => { e.stopPropagation(); S.menu = null; return item.onPick(); },
  }))) : null;
  if (menu) placeMenu(button, menu);
  return h('div', { class: 'more' }, button, menu);
}

// A menu is fixed to the viewport and put beside its button once both are on
// screen: inside a scrolling list an absolutely placed menu is clipped by the
// list, and a row near the foot of the pane opens upward instead of into the
// fold. Hidden until placed, so it never flashes at the corner first.
let menuOpenedAt = 0;
function placeMenu(button, menu) {
  requestAnimationFrame(() => {
    if (!button.isConnected || !menu.isConnected) return;
    const r = button.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = r.bottom + 4 + height <= window.innerHeight;
    menu.style.top = `${below ? r.bottom + 4 : Math.max(4, r.top - 4 - height)}px`;
    menu.style.right = `${Math.max(4, window.innerWidth - r.right)}px`;
    menu.classList.add('placed');
  });
}

// A pill pressed. Held and awaited: Share reads before it shows, and a render
// on the way there would write the mode's address without what it is about.
// ⚠️ The promise goes all the way up to the onclick (see syncUrl).
export async function openMode(id) {
  await urlAs('hold', async () => {
    showMode(id);
    if (S.mode === 'share') await loadShare();
    if (S.mode === 'versions' && historyNeedsLoad(null)) await loadHistory(null);
    // Questions is the quiz file: arriving opens it.
    if (S.mode === 'quiz' && S.open?.path !== QUIZ_FILE) await chooseFile(QUIZ_FILE);
    if (S.mode === 'controls') await openControls();
  });
  render();
}

// The inverse of applyView, and written in the same two branches so the pair
// can be read against each other.
function urlNow() {
  if (!S.slug) return '/';
  const q = new URLSearchParams();
  // What the centre shows. A mode other than the chat, and what it is about —
  // the story's scene when it is not the first, Code's open file, Share's
  // filter and version; or which conversation, unless it is the one the
  // project opens on — a link to a game means its front door, and a chat is a
  // place inside it. Never both: a mode stands in front of whichever chat was
  // open, so Back to the chat is the address without ?mode=.
  if (S.mode !== 'chat') {
    q.set('mode', S.mode);
    if (S.mode === 'story') {
      const first = S.story?.model?.scenes[0]?.key;
      if (S.story?.scene && S.story.scene !== first) q.set('scene', S.story.scene);
    }
    if (['code', 'pics', 'hear'].includes(S.mode) && S.open) q.set('file', S.open.path);
    if (S.mode === 'versions') {
      if (S.historyPath) q.set('file', S.historyPath);
      if (S.diff) q.set('version', S.diff.sha);
    }
  } else if (S.chat && S.chats.length > 1 && S.chat.id !== S.chats[0].id) {
    q.set('chat', String(S.chat.id));
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

// Put the centre where a URL says, and take away what it does not say — Back
// out of a file has to close it. Every part is optional, and a part that is
// no longer there — a deleted file, a commit off the end of the list — simply
// does not open; the rest of the view still arrives.
async function applyView({
  mode, file, version, chat, scene,
}) {
  // The mode first: it is the only part of the view a chat-kind project has,
  // and switching it replaces the thread the rest of this is arranged around.
  // A mode other than the chat stands in front of whichever chat is open and
  // leaves it alone; the chat mode's chat is the address's, else the one the
  // project opens on.
  const want = modeOf(mode) ?? 'chat';
  if (want === 'chat') {
    const wanted = chat === null || chat === undefined ? S.chats[0]?.id : Number(chat);
    if (wanted && wanted !== S.chat?.id) await openChat(wanted);
  }
  showMode(want);
  // The scene the address names, else the first: a missing ?scene= is the
  // address talking, the same as a missing ?file=. Undefined is no address at
  // all — a game opened from the sidebar — and leaves the reader where the
  // story was loaded, parked edits and their place included.
  if (want === 'story' && scene !== undefined) {
    selectScene(scene ?? S.story?.model?.scenes[0]?.key);
  }
  if (isChat()) return;
  const path = file ?? null;
  if (want === 'versions') {
    if (historyNeedsLoad(path)) await loadHistory(path);
    if (version !== (S.diff?.sha ?? null)) {
      // Arriving at a version is arriving at its row, which a link can drop
      // you thirty rows above.
      if (version) await loadDiff(version, { goTo: true });
      else S.diff = null;
    }
  } else if (want === 'share') {
    await loadScores();
    if (!S.achievements || S.achievements.grown) await loadAchievements();
  } else if (want === 'code' || want === 'pics' || want === 'hear') {
    // Back is a way out of a file as much as into one, and either way it goes
    // through the same question the ✕ asks when there is unsaved work. Answer
    // that no and the file stays open, so the next render puts its own address
    // back — a duplicate entry is a smaller price than losing what was typed.
    if (path && path !== S.open?.path) await chooseFile(path);
    else if (!path && S.open) closeOpenFile();
  } else if (want === 'quiz') {
    // The mode is the file.
    if (S.open?.path !== QUIZ_FILE) await chooseFile(QUIZ_FILE);
  } else if (want === 'controls') {
    await openControls();
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

// Called by the shell rather than on the way in (index.html). ⚠️ Importing
// this file must not start the studio: a module that asks the server who you
// are and opens a stream the moment it is loaded cannot be imported by
// `npm test`, and that is what keeps every render function in here untested.
// The rest of what this file does at import — a listener, an iframe, reading
// the stored rail width — a fake DOM can stand in for; a fire cannot.
export async function start() {
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
  if (res.ok) {
    S.projects = res.body;
    syncIcons();
  }
}

export async function loadAgents() {
  const res = await api('GET', '/api/agents');
  if (res.ok) S.agents = res.body;
}

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

// The address is render()'s to write — opening a game only sets the state.
// Wrap the call in urlAs('replace', …) when it is not a navigation.
export async function openProject(slug, { view = null } = {}) {
  // Half-typed text belongs to the game it was typed in, so it is parked
  // here on the way out and put back on the way in.
  if (S.slug) S.drafts.set(S.slug, composerBox.value);
  composerBox.value = slug ? (S.drafts.get(slug) ?? '') : '';
  // Story lines typed in the last two seconds go in now — the autosave is
  // that far behind the typing — and are parked against the game being left
  // only if that failed. Achievements edits are parked as they always were,
  // put back on return while the file is still the one they were made on.
  if (S.story?.dirty) await saveStory();
  parkStory();
  parkAchievements();

  // Colours changed in the editor belong to the game being left, so they go in
  // before the slug does — and then the game's version lands, with them in it.
  await flushPalette();
  await commitNow(S.slug);

  // The centre pane's mode and the two editors' state are the game's; all are
  // settled again below for the one being opened.
  S.mode = 'chat';
  S.menu = null;
  S.story = null;
  S.achievements = null;
  S.tryScene = null;
  dropStageImages();

  if (!slug) {
    S.slug = null;
    S.project = null;
    S.files = [];
    S.errors = [];
    S.open = null;
    S.palette = null;
    setReservedImages({ chat: null, hero: null });
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
  // Where the Games and Chats tabs come back to. One per list, because they
  // are two lists and each remembers its own place — clicking Chats after an
  // afternoon in a game should land in the conversation you left, not in the
  // game you are already looking at. Keyed by the tab's own id.
  prefs.set(res.body.kind === 'chat' ? 'last-chats' : 'last-games', slug);
  S.chats = res.body.chats ?? [];
  S.chat = res.body.chat ?? null;
  if (S.chat) prefs.set(`chat-${slug}`, S.chat.id);
  // Which mode the centre opens in: the address if it says — a mode by name,
  // or a chat, which is the chat mode — else what is remembered for this game,
  // else the type's first editor for a game that has one and the chat for a
  // game that does not. Settled before the first paint, so the address written
  // then is the one that stays rather than one entry on the way to it.
  const remembered = prefs.get(`mode-${slug}`, null);
  const mode = view?.mode ?? (view?.chat !== null && view?.chat !== undefined
    ? 'chat'
    : (remembered ?? editorsFor(res.body.type)[0]?.id ?? 'chat'));
  S.mode = modeOf(mode) ?? 'chat';
  S.files = res.body.files;
  S.errors = res.body.errors ?? [];
  S.pinned = new Set();
  S.open = null;
  S.pick = null;
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
  // Opening the chat is reading it. Behind another mode it is not on screen,
  // so its marks wait for the pill to be pressed.
  if (S.mode === 'chat') readChat();
  S.palette = null;
  // Off with the last game's dressing before the first paint, like the
  // palette: this game's own arrives with its colours below.
  setReservedImages({ chat: null, hero: null });
  // An open receipt belongs to a message in the game being left.
  S.receipt = null;
  // And so does an open verb in Controls, and any question it was asking.
  S.controlsVerb = null;
  S.controlsKey = null;
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
    await loadReservedImages();
    // And the story, when this game has the editor for it — before applyView,
    // so ?edit= and ?scene= have something to land on.
    if (hasEditor('story')) await loadStory();
    render();
  }
  // A game remembered on Share has to fetch what Share shows now. Waiting for
  // the next click is what made the list look empty until you left it and
  // came back.
  // ⚠️ The chat is named explicitly, whatever the view says: it was settled
  // above, and applyView reads a missing chat as "the one the project opens
  // on". Left out, this call undid the remembered chat a beat after opening
  // it — the game appeared in the conversation you left it in and then
  // switched itself to Humans only. Back and Forward still reset, because
  // there the missing chat is the address talking. The mode is named for the
  // same reason.
  await applyView({
    ...(view ?? {}), chat: S.chat?.id, mode: S.mode, scene: view?.scene,
  });
}

window.addEventListener('popstate', followUrl);

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

/* Render: the preview and the rail ----------------------------------------- */

// ⚠️ The game must not restart on every render. render() rebuilds the whole
// tree, and an <iframe> reloads the moment it leaves the document — so while
// the frame lived in the tree, every render was a reload: a banner arriving
// and leaving six seconds later, a line typed in the story editor, a file
// opened on the right, all restarted the game (spec.md §17). So the one frame
// is appended to the body once and never moved. The tree holds a placeholder
// of its size where it used to be, and the frame is a fixed box laid over the
// placeholder's rectangle — measured again after every render, on resize, on
// any scroll and while the rail is dragged — hidden while the placeholder is
// hidden or gone, and unloaded (about:blank) when the preview is folded away
// or no game is open, so a game never runs silently behind a chat.
const previewFrame = h('iframe', { class: 'preview-frame live', title: 'Game preview' });
document.body.append(previewFrame);
let previewSlot = null;
let previewSrc = '';

// Only an address that changed is set, so only a nonce bump — a commit — or
// a different game reloads the frame.
function showPreview(url) {
  if (previewSrc === url) return;
  previewSrc = url;
  previewFrame.src = url;
}

function placePreview() {
  const box = previewSlot?.isConnected ? previewSlot.getBoundingClientRect() : null;
  // A placeholder under display:none — a picture open, a phone showing the
  // chat — measures as nothing, so a hidden placeholder is a hidden frame:
  // hidden, never unloaded, exactly as the frame in the tree used to be.
  const shown = Boolean(box && box.width > 0 && box.height > 0);
  previewFrame.style.display = shown ? '' : 'none';
  if (!shown) return;
  Object.assign(previewFrame.style, {
    top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`,
  });
}

// After a render: no placeholder on screen means no game to show.
function settlePreview() {
  if (!previewSlot) showPreview('about:blank');
  placePreview();
}
window.addEventListener('resize', placePreview);
document.addEventListener('scroll', placePreview, true);

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
  // "Try this scene" adds the game's own ?scene= — a template that honours it
  // opens straight into that scene, and one that does not ignores it. Held
  // while the editor is up, so a save from it lands back in the scene being
  // worked on; cleared with the game.
  const scene = editorShowing() && S.tryScene ? S.tryScene : null;
  const url = `${S.project.play_url}_studio.html?v=${S.previewNonce}`
    + (scene ? `&scene=${encodeURIComponent(scene)}` : '');
  // Folded, the frame is unloaded rather than hidden: a collapsed preview is
  // not a game running silently in the background.
  showPreview(S.previewOpen ? url : 'about:blank');
  // The frame's place in the tree: a box of its size the live frame is laid
  // over (placePreview, above).
  previewSlot = S.previewOpen ? h('div', { class: 'preview-frame slot' }) : null;
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
    previewSlot,
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
    renderProblems(),
    renderMoments());
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
      // The live frame follows the rail's edge as it moves.
      placePreview();
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

// The rail is the running game, and under it the selected thing (spec.md §6):
// the preview with what the game reported, then the inspector — the fields of
// whatever the centre's mode has selected, when it has one. The four tabs that
// used to sit here — Files, Versions, Scoreboard, Achievements — are modes of
// the centre now.
function renderRail() {
  if (!S.project) return h('div', { class: 'pane rail' }, railGrip());
  return h('div', { class: `pane rail${S.narrowPane === 'rail' ? ' show' : ''}` },
    railGrip(),
    // On a phone the rail is a pane of its own, and this is the way back.
    h('div', { class: 'pad row only-narrow' },
      h('button', { class: 'quiet', text: '←', onclick: () => { S.narrowPane = 'chat'; render(); } })),
    renderPreview(),
    renderInspector());
}

// The selected thing's fields, for the mode that has one: the story editor's
// scene, person or title screen; Pics' picture or person; Hear's open sound.
function renderInspector() {
  if (editorShowing()?.id === 'story') return renderStoryInspector();
  if (S.mode === 'pics' || S.mode === 'hear') return renderPickInspector();
  return null;
}

// The centre's body for every mode but the chat, whose thread and composer
// are chat.js's. An editor is its type's; Code is the file list with the open
// file's editor under it, as the rail's Files tab was; Share is a page.
export function renderModeBody() {
  const editor = editorShowing();
  if (editor) return editor.render();
  if (S.mode === 'pics') return renderPicsMode();
  if (S.mode === 'hear') return renderHearMode();
  if (S.mode === 'controls') return renderControlsEditor();
  if (S.mode === 'code') return renderFilesTab();
  if (S.mode === 'versions') return renderVersionsTab();
  if (S.mode === 'share') return renderShareMode();
  return null;
}

// Share: the game's public face — the address and whether it is in the games
// list, then the scoreboard and the achievements (spec.md §6). Each was a tab
// of the rail; here they are sections of one page in one scroller, each
// keeping the rendering it had.
function renderShareMode() {
  const p = S.project;
  const section = (label) => h('div', { class: 'section-label', text: label });
  return h('div', { class: 'share scroll', 'data-scroll': 'share' },
    section('The link'),
    h('div', { class: 'pad link-card' },
      // A link looks at something: the game, where the public plays it.
      h('a', {
        class: 'play-link mono', href: p.play_url, target: '_blank', rel: 'noopener', text: p.play_url,
      }),
      h('p', {
        class: 'hint muted',
        text: p.published
          ? 'It is on the games page, where everybody sees it. Anyone with the link can play it.'
          : 'Anyone with the link can play it. It is not on the games page.',
      }),
      p.mine && !p.archived ? h('button', {
        class: 'quiet tiny',
        text: p.published ? 'Take it out of the games list' : 'Put it in the games list',
        onclick: () => { S.dialog = { kind: 'publish' }; render(); },
      }) : null),
    section('Scoreboard'), renderScoreboardTab(),
    section('Achievements'), renderAchievementsTab());
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
  // Rebuilt by the Play tab if it is on screen; cleared means an arriving
  // problem or moment has nothing live to paint into and needs a full render.
  resetGameNodes();
  // The live frame's placeholder is rebuilt with the tree, or not at all.
  previewSlot = null;
  root.replaceChildren();

  if (S.loading) {
    root.append(h('div', { class: 'auth-page' }, h('p', { class: 'muted', text: 'Loading…' })));
    settlePreview();
    return;
  }
  if (!S.me) {
    root.append(renderAuth());
    settlePreview();
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
  // The tree is on screen and laid out, so the live frame can be put over
  // its placeholder — or taken away with it.
  settlePreview();
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

// An open ··· closes when anything outside it is pressed, and on Escape. Its
// own items close it themselves on the way to their dialog. ⚠️ On click, not
// mousedown: a render between the two replaces the node under the pointer,
// and the click that was meant for a pill never fires.
document.addEventListener('click', (e) => {
  if (S.menu && !e.target.closest?.('.more')) { S.menu = null; render(); }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.menu) { S.menu = null; render(); }
});
// A menu is fixed to the viewport (placeMenu), so a list scrolling under it
// would leave it floating beside nothing: scrolling closes it. Not the scroll
// the opening render itself causes, putting every scroller back where it was.
document.addEventListener('scroll', () => {
  if (S.menu && performance.now() - menuOpenedAt > 200) { S.menu = null; render(); }
}, { capture: true, passive: true });

// Closing the tab is not a switch and nothing else would catch it, so the last
// chance to keep the colours and the last story lines is here, and then to
// land the game's version. `keepalive` is what lets a request outlive the
// page — a plain fetch is cancelled on unload, and sendBeacon cannot PUT.
window.addEventListener('pagehide', () => {
  if (!S.slug) return;
  if (S.palette?.dirty) {
    const text = lookFileWith(S.palette.colours);
    if (text !== null) {
      send(`/api/projects/${S.slug}/files/${encodePath(LOOK_FILE)}`, {
        method: 'PUT', body: text, keepalive: true,
      }).catch(() => { /* the page is going away regardless */ });
    }
  }
  if (S.story?.dirty) saveStory({ keepalive: true });
  commitNow(S.slug, { keepalive: true });
});
