// The rail's Achievements tab: config/achievements.js as a list, one open in
// its own row — name, how to get it, icon, and the moment and test it waits
// for — no code in sight. The model reading and file writing is
// achievements-editor.js; this is the form, and the loading, parking and
// saving around it, the way story-form.js holds the story's. Field edits mark
// the state dirty in place without a render (a render would replace the field
// under the fingers); opening a row, adding and removing render, because the
// shape changed.
//
// Two things the form knows that no field can: how many players hold each
// one, from the studio (GET /api/projects/:slug/achievements), filled in place
// when the answer comes; and which moments the game has been heard to say
// this session (momentsFor in main.js), offered where a rule names one.
//
// Its state is S.achievements: {text, etag, model, dirty, saving, stale} while
// the file reads as achievements, {grown: reason} when it does not (missing:
// true when the game has no such file), or null before the tab has been
// opened. Under Files the same file opens as plain text and nothing else —
// this tab is the one surface that writes it.

import {
  ACHIEVEMENTS_FILE, achievementsModel, achievementsText, achievementChecks, freshId, TESTS,
} from './achievements-editor.js';
import { h } from './dom.js';
import {
  S, render, send, say, api, frozen, encodePath, NO_CONNECTION,
} from './main.js';
import { momentsFor } from './telemetry.js';
import { chooseFile, refreshFiles } from './files.js';

// Which row is open, for which game — a different game opens closed.
let opened = { slug: null, index: null };
// Holders per id, per game, fetched once a tab open and painted in place.
const counts = new Map(); // slug -> { players: Map(id -> n), at }
const COUNTS_FRESH_MS = 30 * 1000;
let countNodes = new Map(); // id -> the span showing the count
// Unsaved edits, parked per game on the way out and put back on return while
// the file is still the one they were made on — the story editor's bargain.
const parked = new Map(); // slug -> { model, etag }

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* Loading and saving --------------------------------------------------------- */

// Read the file off the disk into S.achievements. Run when the tab is first
// opened and when the file changes underneath.
export async function loadAchievements() {
  const slug = S.slug;
  if (!S.files.some((f) => f.path === ACHIEVEMENTS_FILE)) {
    S.achievements = { grown: `${ACHIEVEMENTS_FILE} is not in this game`, missing: true };
    return;
  }
  const kept = parked.get(slug);
  parked.delete(slug);
  const res = await send(`/api/projects/${slug}/files/${encodePath(ACHIEVEMENTS_FILE)}`);
  if (S.slug !== slug) return;
  if (!res.ok) {
    S.achievements = {
      grown: res.status === 0 ? NO_CONNECTION : `the studio could not read ${ACHIEVEMENTS_FILE}`,
    };
    return;
  }
  const text = await res.text();
  if (S.slug !== slug) return;
  const etag = res.headers.get('etag');
  const read = achievementsModel(text);
  if (!read.ok) {
    S.achievements = { grown: read.reason };
    return;
  }
  if (kept && kept.etag === etag) {
    S.achievements = { text, etag, model: kept.model, dirty: true };
    return;
  }
  if (kept) {
    say(`${ACHIEVEMENTS_FILE} changed since you were last here, so the achievements you had not saved were dropped.`, true);
  }
  S.achievements = { text, etag, model: { entries: read.entries }, dirty: false };
}

// Called on the way out of a game, before the slug moves.
export function parkAchievements() {
  const st = S.achievements;
  if (!S.slug || !st?.model || !st.dirty) return;
  parked.set(S.slug, { model: st.model, etag: st.etag });
}

// The file changed on disk — a helper's commit, a version brought back, a save
// as text under Files. Re-read it, unless there is unsaved work here, in which
// case the work stays and Save will ask before overwriting. Our own save's
// commit arrives this way too, usually before the PUT answers: while a save is
// in flight the answer to it is the truth, so the event is left alone.
export function achievementsChanged() {
  const st = S.achievements;
  if (!st || st.saving) return;
  if (st.model && st.dirty) {
    st.stale = true;
    say(`${ACHIEVEMENTS_FILE} changed while you were working on it. What you have is still here — Save will ask before overwriting.`);
    render();
    return;
  }
  loadAchievements().then(render);
}

// True when it landed. A 409 opens the conflict dialog, which comes back here
// with force or through discardAchievements.
export async function saveAchievements({ force = false } = {}) {
  const st = S.achievements;
  if (!st?.model) return false;
  const text = achievementsText(st.model);
  // Typed and typed back: no commit that changes nothing.
  if (text === st.text && !force) {
    st.dirty = false;
    render();
    return true;
  }
  const headers = { 'content-type': 'text/plain' };
  if (!force && st.etag) headers['if-match'] = st.etag;
  st.saving = true;
  const res = await send(`/api/projects/${S.slug}/files/${encodePath(ACHIEVEMENTS_FILE)}`, {
    method: 'PUT', headers, body: text,
  });
  const body = await res.json().catch(() => null);
  st.saving = false;
  if (res.status === 409) {
    S.dialog = { kind: 'achievements-conflict' };
    render();
    return false;
  }
  if (!res.ok) {
    say(res.status === 0 ? NO_CONNECTION : (body?.error ?? 'Could not save the achievements.'), true);
    return false;
  }
  // Only the tab that asked may finish the job: the commit is a files.changed,
  // and the game may have changed under it since.
  if (S.achievements === st) {
    st.etag = body.etag;
    st.text = text;
    st.dirty = false;
    st.stale = false;
  }
  S.previewNonce += 1;
  await refreshFiles();
  say(`Saved ${ACHIEVEMENTS_FILE}.`);
  return true;
}

// Keep theirs: the unsaved work goes, and the file on disk is read again.
export async function discardAchievements() {
  if (S.achievements) S.achievements.dirty = false;
  await loadAchievements();
  render();
}

/* The form ------------------------------------------------------------------- */

function commit(st) {
  st.dirty = true;
  const save = document.getElementById('ach-save');
  if (save) save.disabled = false;
  const status = document.getElementById('ach-status');
  if (status) status.textContent = 'Not saved yet';
}

const field = (value, placeholder, onchange, extra = {}) => {
  const input = h('input', { type: 'text', class: 'cfg-text', placeholder, onchange, ...extra });
  input.value = value;
  return input;
};

const countText = (n) => (n === undefined ? '' : n === 0 ? 'nobody yet' : plural(n, 'player'));

function paintCounts(slug) {
  const have = counts.get(slug);
  if (!have) return;
  for (const [id, node] of countNodes) node.textContent = countText(have.players.get(id) ?? 0);
}

// The rail's default summary reads the same counts, snapshotted at game-open
// rather than repainted live — a glance, not the editor.
export const countsFor = (slug) => counts.get(slug)?.players;

export async function loadCounts(slug) {
  const have = counts.get(slug);
  if (have && Date.now() - have.at < COUNTS_FRESH_MS) return;
  counts.set(slug, { players: have?.players ?? new Map(), at: Date.now() });
  const res = await api('GET', `/api/projects/${slug}/achievements`);
  if (!res.ok || !Array.isArray(res.body?.achievements)) return;
  counts.set(slug, {
    players: new Map(res.body.achievements.map((a) => [a.id, a.players])), at: Date.now(),
  });
  paintCounts(slug);
}

// The tab's body: the form, or the reason there is not one.
export function renderAchievementsTab() {
  const st = S.achievements;
  const note = (...nodes) => [h('div', { class: 'pad hint muted' }, ...nodes)];
  if (!st) return note(h('p', { text: 'Reading the achievements…' }));
  if (st.grown) {
    return note(
      h('p', {
        text: st.missing
          ? `${st.grown} — npm run sweep gives it one.`
          : `${ACHIEVEMENTS_FILE} has grown past the achievements editor — ${st.grown}.`,
      }),
      st.missing ? null : h('p', {}, h('button', {
        class: 'link', text: 'Show the text', onclick: () => chooseFile(ACHIEVEMENTS_FILE),
      })),
    );
  }
  // One editor for the file at a time: while its text is open under Files,
  // this one waits rather than saving over what is typed there.
  if (S.open?.path === ACHIEVEMENTS_FILE) {
    return note(h('p', {
      text: `${ACHIEVEMENTS_FILE} is open as text under Code. Close it there to change the achievements here.`,
    }));
  }
  return [h('div', { class: 'editor' }, ...renderAchievementsForm(st))];
}

function renderAchievementsForm(st) {
  const { model } = st;
  const { entries } = model;
  const slug = S.slug;
  const heard = momentsFor(slug);
  const checks = achievementChecks(model, heard, counts.get(slug)?.players);
  if (opened.slug !== slug) opened = { slug, index: null };
  countNodes = new Map();
  loadCounts(slug);

  const ruleText = (a) => {
    if (!a.when) return 'from the code';
    const words = TESTS.find(([key]) => key === a.when.test)[1];
    if (a.when.test === 'any') return `when ${a.when.moment} happens`;
    if (a.when.test === 'times') return `when ${a.when.moment} has happened ${a.when.value} times`;
    return `when ${a.when.moment} ${words} ${a.when.value}`;
  };
  // The checks about one row, for its marker.
  const own = (a) => checks.filter((c) => c.includes(a.name ? `“${a.name}”` : 'no name yet'));

  const whenRow = (a) => {
    const moment = field(a.when?.moment ?? '', 'a moment the game says', (e) => {
      const name = e.currentTarget.value.trim();
      const had = Boolean(a.when);
      if (!name) a.when = null;
      else if (a.when) a.when.moment = name;
      else a.when = { moment: name, test: 'any', value: undefined };
      commit(st);
      // A rule appearing or going is a shape change: the test box beside it
      // wakes or sleeps with it, and only a render does that.
      if (had !== Boolean(a.when)) render();
    }, { list: 'ach-moments' });
    const test = h('select', {
      disabled: !a.when,
      onchange: (e) => {
        const key = e.currentTarget.value;
        a.when = { moment: a.when.moment, test: key, value: key === 'any' ? undefined : key === 'is' ? '' : 1 };
        commit(st);
        render();
      },
    }, TESTS.map(([key, words]) => {
      const option = h('option', { value: key, text: words });
      if (key === (a.when?.test ?? 'any')) option.selected = true;
      return option;
    }));
    const numeric = a.when && a.when.test !== 'is' && a.when.test !== 'any';
    const value = !a.when || a.when.test === 'any' ? null : h('input', {
      class: 'cfg-text ach-value',
      type: numeric ? 'number' : 'text',
      step: numeric ? 'any' : null,
      placeholder: numeric ? 'a number' : 'a word or a number',
      onchange: (e) => {
        const raw = e.currentTarget.value;
        if (numeric) {
          const n = Number(raw);
          if (!Number.isFinite(n)) { e.currentTarget.value = String(a.when.value); return; }
          a.when.value = n;
        } else {
          a.when.value = /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw;
        }
        commit(st);
      },
    });
    if (value) value.value = String(a.when.value);
    return h('div', { class: 'row ach-when' },
      h('span', { class: 'cfg-name mono', text: 'Happens when' }),
      moment, test, value);
  };

  const card = (a, i) => {
    const isOpen = opened.index === i;
    const problems = own(a);
    const count = h('span', { class: 'hint muted ach-count', text: countText(counts.get(slug)?.players.get(a.id)) });
    if (a.id) countNodes.set(a.id, count);
    const head = h('div', {
      class: 'ach-row',
      onclick: () => { opened.index = isOpen ? null : i; render(); },
    },
    h('span', { class: 'ach-icon', text: a.icon || '·' }),
    h('span', { class: `aname${a.name ? '' : ' muted'}`, text: a.name || '(no name yet)' }),
    problems.length ? h('span', { class: 'hint warn', text: '⚠', title: problems.join('\n') }) : null,
    h('span', { class: 'hint muted', text: ruleText(a) }),
    count);
    if (!isOpen) return h('div', { class: 'ach-card' }, head);

    const idNode = h('span', {
      class: 'hint muted mono', text: a.id ? `id: ${a.id}` : 'the id comes from the name',
    });
    const body = h('div', { class: 'ach-open' },
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'Name' }),
        field(a.name, 'What it is called', (e) => {
          a.name = e.currentTarget.value.trim();
          if (!a.id && a.name) {
            a.id = freshId(a.name, entries.filter((x) => x !== a));
            idNode.textContent = `id: ${a.id}`;
          }
          commit(st);
        }, { maxlength: 60 })),
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'How to get it' }),
        field(a.how, 'What a player does to earn it, in their words', (e) => {
          a.how = e.currentTarget.value.trim();
          commit(st);
        }, { maxlength: 200 })),
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'Icon' }),
        field(a.icon, '🏆', (e) => { a.icon = e.currentTarget.value.trim(); commit(st); }, { maxlength: 8, class: 'cfg-text ach-icon-field' })),
      whenRow(a),
      h('p', {
        class: 'hint muted',
        text: heard.size
          ? `The game has said: ${[...heard.keys()].join(' · ')}`
          : 'Play the game in the preview and the moments it says show up here.',
      }),
      h('div', { class: 'row' },
        idNode,
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'quiet tiny', text: 'Take it out', disabled: frozen(),
          onclick: () => {
            S.dialog = {
              kind: 'remove-achievement',
              name: a.name,
              players: counts.get(slug)?.players.get(a.id) ?? 0,
              remove: () => {
                entries.splice(i, 1);
                opened.index = null;
                commit(st);
              },
            };
            render();
          },
        })));
    return h('div', { class: 'ach-card on' }, head, body);
  };

  return [
    h('div', { class: 'scroll cfg', 'data-scroll': 'cfg' },
      h('datalist', { id: 'ach-moments' },
        ...[...heard.keys()].map((name) => h('option', { value: name }))),
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'Achievements' }),
        h('span', {
          class: 'hint muted',
          text: `what a player can earn, kept forever · ${plural(entries.length, 'achievement')}`,
        })),
      ...entries.map(card),
      h('button', {
        class: 'quiet tiny', text: '+ Add an achievement', disabled: frozen(),
        onclick: () => {
          entries.push({ id: '', name: '', how: '', icon: '', when: null });
          opened.index = entries.length - 1;
          commit(st);
          render();
        },
      }),
      ...checks.map((say) => h('p', { class: 'hint warn', text: `⚠ ${say}` }))),
    h('div', { class: 'editor-bar row' },
      h('span', { class: 'hint muted', id: 'ach-status', text: st.dirty ? 'Not saved yet' : 'Saved' }),
      st.stale ? h('span', { class: 'hint warn', text: 'changed underneath — Save will ask' }) : null,
      h('div', { class: 'spacer' }),
      // Saves first: the text opening on the Files tab is the file on disk,
      // and what was typed here must not be a second, unsaved version of it.
      h('button', {
        class: 'link', text: 'Show the text',
        onclick: async () => {
          if (st.dirty && !(await saveAchievements())) return;
          await chooseFile(ACHIEVEMENTS_FILE);
        },
      }),
      h('button', {
        class: 'filled', id: 'ach-save', text: 'Save',
        disabled: !st.dirty || frozen(),
        onclick: () => saveAchievements(),
      })),
  ];
}
