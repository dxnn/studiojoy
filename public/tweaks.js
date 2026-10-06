// Tweaks (ideas/dreams.md §3): the game's config files as fields under the
// preview, for trying numbers rather than changing them. A change goes into
// the running game at once — the preview player writes it into the live
// object, `PLAY.GRAVITY = 600` — and is kept in this browser for this game
// until Save writes it into the files or Undo drops it. Every new page of the
// preview is handed them before the game's own code runs, so a reload keeps
// them, and Back to a pin keeps them too, which is the point of both.
//
// Kept as values where they sit — a file, then the path to the value — never
// as a copy of the file: somebody else's change to the same file meanwhile is
// kept, because Save splices each tweak into the file as it is then.

import { h } from './dom.js';
import {
  S, send, say, render, frozen, prefs, encodePath,
} from './main.js';
import {
  parseConfigFile, literalFor, spliceValue, isConfigPath,
} from './config-file.js';
import { configRows, nodeAt } from './config-form.js';
import { settlePlayer } from './preview-player.js';

// The config files that are a game's content rather than its tuning: each has
// an editor of its own, or is a list nobody tunes a number in.
const CONTENT = new Set([
  'config/controls.js', 'config/achievements.js', 'config/story.js', 'config/scenes.js',
  'config/questions.js', 'config/track.js', 'config/bodies.js', 'config/level.js',
]);
const FIRST_OPEN = 'config/play.js';

export const tweakable = (path) => isConfigPath(path) && !CONTENT.has(path);

// The files as the tree has them, read when the rail first wants them, by
// game, and read again when one changes.
const texts = new Map(); // `${slug}:${path}` -> text
const reading = new Set();
const textOf = (path) => texts.get(`${S.slug}:${path}`);

async function readText(slug, path) {
  const key = `${slug}:${path}`;
  if (reading.has(key)) return;
  reading.add(key);
  const res = await send(`/api/projects/${slug}/files/${encodePath(path)}`);
  reading.delete(key);
  if (!res.ok) return;
  texts.set(key, await res.text());
  if (S.slug === slug) {
    refreshLive(slug, path);
    render();
  }
}

// This game's tweaks: `list` is {path: {key: {at, kind, raw}}}, what was
// changed where; `live` is {path: {NAME: value}}, the whole value of each
// declaration a tweak is in, as the preview player is handed it.
const KEY = (slug) => `tweaks-${slug}`;

function stored(slug = S.slug) {
  try {
    const got = JSON.parse(prefs.get(KEY(slug), '') || '{}');
    return { list: got.list ?? {}, live: got.live ?? {} };
  } catch {
    return { list: {}, live: {} };
  }
}

function keep(slug, tweaks) {
  for (const path of Object.keys(tweaks.list)) {
    if (!Object.keys(tweaks.list[path]).length) {
      delete tweaks.list[path];
      delete tweaks.live[path];
    }
  }
  prefs.set(KEY(slug), JSON.stringify(tweaks));
}

// What the preview player is handed: every tweaked declaration's whole value.
export const liveTweaks = () => stored().live;
const count = (tweaks = stored()) => Object.values(tweaks.list)
  .reduce((n, file) => n + Object.keys(file).length, 0);

// The file with every tweak of it spliced in, one at a time — each splice
// moves the offsets after it, so the file is read again before the next.
function tweakedText(text, fileTweaks) {
  let out = text;
  for (const t of Object.values(fileTweaks ?? {})) {
    const parsed = parseConfigFile(out);
    const node = parsed.ok ? nodeAt(parsed.decls, t.at) : null;
    const literal = node ? literalFor(t.kind, t.raw) : null;
    if (literal !== null) out = spliceValue(out, node, literal);
  }
  return out;
}

// The live values for one file, worked out again from its text as it is now.
function refreshLive(slug, path) {
  const tweaks = stored(slug);
  const text = texts.get(`${slug}:${path}`);
  if (!tweaks.list[path] || text === undefined) return;
  const parsed = parseConfigFile(tweakedText(text, tweaks.list[path]));
  if (!parsed.ok) return;
  const names = new Set(Object.values(tweaks.list[path]).map((t) => t.at[0]));
  tweaks.live[path] = Object.fromEntries(parsed.decls
    .filter((d) => names.has(d.name)).map((d) => [d.name, d.node.value]));
  keep(slug, tweaks);
}

// One value tried. Back to what the file says is no tweak at all.
function setTweak(path, at, kind, raw, input) {
  const text = textOf(path);
  const parsed = text === undefined ? null : parseConfigFile(text);
  const node = parsed?.ok ? nodeAt(parsed.decls, at) : null;
  if (!node || literalFor(kind, raw) === null) {
    if (input && node) input.value = String(tweakedValue(path, at, node));
    return;
  }
  const tweaks = stored();
  const key = at.join('.');
  tweaks.list[path] = tweaks.list[path] ?? {};
  if (String(raw) === String(node.value)) delete tweaks.list[path][key];
  else tweaks.list[path][key] = { at, kind, raw };
  keep(S.slug, tweaks);
  refreshLive(S.slug, path);
  settlePlayer();
  paintCount();
  // A value settled lights its row; one being typed waits, since a render
  // would replace the field under the keys. A box ticked renders — its change
  // comes with the click, once the press is over. ⚠️ A number left is lit in
  // place: it is left by pressing something else, and a render between that
  // press and its release replaced the button under it, so Save or Undo
  // pressed straight from a number did nothing (2026-10-05). The config form
  // under Code found the same (setConfigValue).
  if (input) paintRow(path, key, input);
  else if (kind === 'boolean') render();
}

const fileHead = (path, open, tried) => `${open ? '▾' : '▸'} ${path}${tried ? ` · ${tried} tried` : ''}`;

// One number's row and its file's count, patched as paintCount patches the
// total: the row is the field's, and the file's head is just before its body.
function paintRow(path, key, input) {
  const fileTweaks = stored().list[path] ?? {};
  input.closest('.cfg-row')?.classList.toggle('tweaked', Boolean(fileTweaks[key]));
  const head = input.closest('.tweaks-body')?.previousElementSibling;
  if (head) head.textContent = fileHead(path, true, Object.keys(fileTweaks).length);
}

function tweakedValue(path, at, node) {
  const t = stored().list[path]?.[at.join('.')];
  return t ? t.raw : node.value;
}

// The count and the two buttons, patched rather than rendered: a render on
// every keystroke would replace the field being typed in.
function paintCount() {
  const n = count();
  const status = document.getElementById('tweaks-count');
  if (status) status.textContent = n ? `${n} tried, not saved` : '';
  for (const id of ['tweaks-save', 'tweaks-undo']) {
    const button = document.getElementById(id);
    if (button) button.hidden = n === 0;
  }
}

// Save: every tweak spliced into its file as the file is now, and written.
// The writes reload the preview, which then has no tweaks to be handed.
async function saveTweaks() {
  const tweaks = stored();
  for (const [path, fileTweaks] of Object.entries(tweaks.list)) {
    const res = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`);
    if (!res.ok) { say(`Could not read ${path} to save the tweaks into it.`, true); return; }
    const text = tweakedText(await res.text(), fileTweaks);
    const put = await send(`/api/projects/${S.slug}/files/${encodePath(path)}`, {
      method: 'PUT', headers: { 'content-type': 'text/plain' }, body: text,
    });
    if (!put.ok) { say(`Could not save the tweaks into ${path}.`, true); return; }
  }
  keep(S.slug, { list: {}, live: {} });
  settlePlayer();
  say('Saved — the tweaks are in the game now.');
  render();
}

// Undo: nothing tried any more. The preview player puts every value it
// changed back to the file's at once, where the game is — no fresh page.
function undoTweaks() {
  keep(S.slug, { list: {}, live: {} });
  settlePlayer();
  render();
}

// A config file changed in the tree — a save from Code, a helper, another
// tab: read again, and the tweaks' values worked out over what it says now.
export function tweaksChanged(paths) {
  for (const path of paths) {
    if (!tweakable(path)) continue;
    texts.delete(`${S.slug}:${path}`);
    readText(S.slug, path);
  }
}

const opened = new Map(); // `${slug}:${path}` -> open or not, this visit

function renderFile(path) {
  const key = `${S.slug}:${path}`;
  const open = opened.has(key) ? opened.get(key) : path === FIRST_OPEN;
  const text = textOf(path);
  if (open && text === undefined) readText(S.slug, path);
  const fileTweaks = stored().list[path] ?? {};
  const tried = Object.keys(fileTweaks).length;
  const head = h('button', {
    class: 'link tweaks-file', text: fileHead(path, open, tried),
    onclick: () => { opened.set(key, !open); render(); },
  });
  if (!open) return head;
  if (text === undefined) return [head, h('div', { class: 'hint muted', text: 'Reading…' })];
  const parsed = parseConfigFile(tweakedText(text, fileTweaks));
  if (!parsed.ok) return [head, h('div', { class: 'hint muted', text: `Not as fields: ${parsed.reason}` })];
  const how = {
    set: (at, kind, raw, input) => setTweak(path, at, kind, raw, input),
    typing: () => {},
    id: (at) => `tweak.${path}.${at.join('.')}`,
    marked: (at) => Boolean(fileTweaks[at.join('.')]),
  };
  // `cfg` for the config form's own layout: these are its rows.
  return [head, h('div', { class: 'tweaks-body cfg' }, parsed.decls.map((d) => configRows(d.name, d.node, [d.name], how)))];
}

// Under the preview, when nothing in the centre has claimed the rail: the
// game's tuning files, one open to begin with.
export function renderTweaks() {
  const files = S.files.map((f) => f.path).filter(tweakable).sort((a, b) => (
    (a === FIRST_OPEN ? -1 : b === FIRST_OPEN ? 1 : a.localeCompare(b))));
  if (!files.length) return null;
  const n = count();
  return h('div', { class: 'scroll tweaks', 'data-scroll': 'tweaks' },
    h('div', { class: 'tweaks-head' },
      h('span', { class: 'section-label', text: 'Tweaks' }),
      h('span', { class: 'hint muted', id: 'tweaks-count', text: n ? `${n} tried, not saved` : '' })),
    h('p', {
      class: 'hint muted',
      text: 'Try numbers here: the game takes them at once, and nothing changes for good until you save.',
    }),
    ...files.flatMap((path) => [renderFile(path)].flat()),
    h('div', { class: 'row tweaks-bar' },
      h('button', {
        class: 'quiet tiny', id: 'tweaks-undo', text: 'Undo', hidden: n === 0,
        title: 'Back to the numbers the files say', onclick: undoTweaks,
      }),
      frozen() ? null : h('button', {
        class: 'filled tiny', id: 'tweaks-save', text: 'Save them', hidden: n === 0,
        title: 'Write these numbers into the game for good', onclick: saveTweaks,
      })));
}
