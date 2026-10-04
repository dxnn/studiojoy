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
import { writeEditorFile } from './editor-file.js';
import { askForAchievements } from './chats.js';

// The way to a game's first achievements, beside the form and in the empty
// rail: a builder room about them with the ask waiting (chats.js). A button,
// because it makes a room rather than looking at one.
// ⚠️ Returned, not fired: it opens something (see syncUrl). Absent while the
// game is in Game Design, which has no builder until Make it.
export const makeAchievementsButton = () => (S.project?.type === 'design' ? null : h('button', {
  class: 'quiet tiny', text: 'Make some with the builder',
  title: 'Open a builder room about achievements, with the ask ready to send',
  onclick: () => askForAchievements(),
}));

// Which row is open, for which game — a different game opens closed.
let opened = { slug: null, index: null };
// Holders and joy per id, per game, and the reader's own stash of chips and
// whether they may put them here — fetched once a tab open, painted in place.
const counts = new Map(); // slug -> { players, joy: Map(id -> n), stash, canPut, at }
const COUNTS_FRESH_MS = 30 * 1000;
let countNodes = new Map(); // id -> the span showing the count
let joyNodes = new Map(); // id -> the gold span showing the joy it gives
// Unsaved edits, parked per game on the way out and put back on return while
// the file is still the one they were made on — the story editor's bargain.
const parked = new Map(); // slug -> { model, etag }

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// What an achievement's joy can be set to here (Dann, 2026-10-04). The
// interface's limit only — the studio takes any whole number of chips — so
// changing it is this line.
const JOY_LEVELS = [1, 5, 10, 20];

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
  // The words are kept as typed, spaces and all, until here. A new one's id
  // comes from its whole name, here too: taken as the name was typed, every
  // achievement would be called `c`, and ⚠️ Chrome blurs the field a render
  // takes away, so leaving the field is no sign the name is finished.
  const { entries } = st.model;
  for (const a of entries) {
    a.name = a.name.trim();
    a.how = a.how.trim();
    a.icon = a.icon.trim();
    if (!a.id && a.name) a.id = freshId(a.name, entries.filter((x) => x !== a));
  }
  const text = achievementsText(st.model);
  // Typed and typed back: no commit that changes nothing.
  if (text === st.text && !force) {
    st.dirty = false;
    render();
    return true;
  }
  st.saving = true;
  const etag = await writeEditorFile(ACHIEVEMENTS_FILE, text, {
    etag: st.etag, force, editor: 'achievements', noun: 'achievements',
  });
  st.saving = false;
  if (etag === null) return false;
  // Only the tab that asked may finish the job: the commit is a files.changed,
  // and the game may have changed under it since.
  if (S.achievements === st) {
    st.etag = etag;
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

// Into the model as it is typed, and found again by its id: a write to
// anybody's game renders the whole studio, and a field that only committed
// on `change` came back from that render empty-handed and without its caret.
const field = (id, value, placeholder, oninput, extra = {}) => {
  const input = h('input', { type: 'text', class: 'cfg-text', id, placeholder, oninput, ...extra });
  input.value = value;
  return input;
};

const countText = (n) => (n === undefined ? '' : n === 0 ? 'nobody yet' : plural(n, 'player'));

const joyText = (n) => (n ? `${n} joy` : '');

function paintCounts(slug) {
  const have = counts.get(slug);
  if (!have) return;
  for (const [id, node] of countNodes) node.textContent = countText(have.players.get(id) ?? 0);
  for (const [id, node] of joyNodes) paintJoy(node, have.joy.get(id));
}

// Gold only while there is a number in it: an achievement with no chips on
// it shows nothing there at all.
function paintJoy(node, n) {
  node.textContent = joyText(n);
  node.className = n ? 'ach-joy' : '';
}

// The rail's default summary reads the same counts, snapshotted at game-open
// rather than repainted live — a glance, not the editor.
export const countsFor = (slug) => counts.get(slug)?.players;

export async function loadCounts(slug) {
  const have = counts.get(slug);
  if (have && Date.now() - have.at < COUNTS_FRESH_MS) return;
  counts.set(slug, {
    players: have?.players ?? new Map(), joy: have?.joy ?? new Map(),
    stash: have?.stash ?? null, canPut: have?.canPut ?? false, at: Date.now(),
  });
  const res = await api('GET', `/api/projects/${slug}/achievements`);
  if (!res.ok || !Array.isArray(res.body?.achievements)) return;
  const could = have?.canPut;
  counts.set(slug, {
    players: new Map(res.body.achievements.map((a) => [a.id, a.players])),
    joy: new Map(res.body.achievements.map((a) => [a.id, a.joy ?? 0])),
    stash: res.body.stash ?? null,
    canPut: res.body.can_put === true,
    at: Date.now(),
  });
  paintCounts(slug);
  // Whether chips can go on is a control, not a number: an open row grows
  // or loses it, and only a render does that.
  if (could !== (res.body.can_put === true) && S.slug === slug) render();
}

// Chips from the stash onto one achievement, for good (server/joy.js).
async function putChips(slug, a, chips) {
  const res = await api('POST', `/api/projects/${slug}/achievements/${encodePath(a.id)}/chips`, { chips });
  if (!res.ok) { say(res.body?.error ?? NO_CONNECTION, true); return; }
  const have = counts.get(slug);
  if (have) {
    have.joy.set(a.id, res.body.joy);
    have.stash = res.body.stash;
  }
  say(`“${a.name}” gives ${res.body.joy} joy now, to everybody who earns it.`);
  render();
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
      text: `${ACHIEVEMENTS_FILE} is open as text under Taste. Close it there to change the achievements here.`,
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
  joyNodes = new Map();
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

  const whenRow = (a, i) => {
    const moment = field(`ach-moment-${i}`, a.when?.moment ?? '', 'a moment the game says', (e) => {
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
      id: `ach-test-${i}`,
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
    // A half-typed number is never kept: it waits for the next keystroke, and
    // is put back to the rule's own when the field is left.
    const setValue = (e, leaving) => {
      const raw = e.currentTarget.value;
      if (numeric) {
        const n = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(n)) {
          if (leaving) e.currentTarget.value = String(a.when.value);
          return;
        }
        a.when.value = n;
      } else {
        a.when.value = /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw;
      }
      commit(st);
    };
    const value = !a.when || a.when.test === 'any' ? null : h('input', {
      class: 'cfg-text ach-value',
      id: `ach-value-${i}`,
      type: numeric ? 'number' : 'text',
      step: numeric ? 'any' : null,
      placeholder: numeric ? 'a number' : 'a word or a number',
      oninput: (e) => setValue(e, false),
      onchange: (e) => setValue(e, true),
    });
    if (value) value.value = String(a.when.value);
    return h('div', { class: 'row ach-when' },
      h('span', { class: 'cfg-name mono', text: 'Happens when' }),
      moment, test, value);
  };

  // What it gives, and — for one of a published game's editors with chips in
  // their stash — the way to raise it (server/joy.js). Chips stay where they
  // are put, so the words say so before a button is pressed.
  const joyRow = (a) => {
    const have = counts.get(slug);
    const gives = have?.joy.get(a.id) ?? 0;
    const note = (text) => h('span', { class: 'hint muted', text });
    let more = [];
    if (!a.id) {
      more = [note('Save it first, and then chips can go on it.')];
    } else if (!S.project.published) {
      more = [note('Publish the game and its editors can put chips on this: each chip is one joy for everybody who earns it.')];
    } else if (have?.canPut) {
      // The levels above where it is now that the stash can reach, each
      // putting on exactly the chips it takes to get there.
      const higher = JOY_LEVELS.filter((level) => level > gives);
      const reachable = higher.filter((level) => level - gives <= have.stash);
      more = reachable.length
        ? [
          note('Make it'),
          ...reachable.map((level) => h('button', {
            class: 'quiet tiny', text: `${level} joy`,
            title: `Puts ${level - gives} ${level - gives === 1 ? 'chip' : 'chips'} on it from your stash`,
            onclick: () => putChips(slug, a, level - gives),
          })),
          note(`${have.stash} in your stash · they stay on it for good`),
        ]
        : [note(!higher.length
          ? `${gives} joy is the most an achievement gives.`
          : `${have.stash} in your stash — not enough for ${higher[0]} joy yet. Ten more chips come every Monday.`)];
    }
    return [
      h('div', { class: 'row ach-joy-row' },
        h('span', { class: 'cfg-name mono', text: 'Joy' }),
        h('span', { class: 'hint', text: gives ? `Gives ${gives} joy to everybody who earns it.` : 'Gives no joy yet.' })),
      more.length ? h('div', { class: 'row wrap ach-chips-row' }, ...more) : null,
    ];
  };

  const card = (a, i) => {
    const isOpen = opened.index === i;
    const problems = own(a);
    const count = h('span', { class: 'hint muted ach-count', text: countText(counts.get(slug)?.players.get(a.id)) });
    if (a.id) countNodes.set(a.id, count);
    // What it gives whoever earns it, in gold: a number worth looking at.
    const joy = h('span');
    paintJoy(joy, counts.get(slug)?.joy.get(a.id));
    if (a.id) joyNodes.set(a.id, joy);
    const head = h('div', {
      class: 'ach-row',
      onclick: () => { opened.index = isOpen ? null : i; render(); },
    },
    h('span', { class: 'ach-icon', text: a.icon || '·' }),
    h('span', { class: `aname${a.name ? '' : ' muted'}`, text: a.name || '(no name yet)' }),
    problems.length ? h('span', { class: 'hint warn', text: '⚠', title: problems.join('\n') }) : null,
    h('span', { class: 'hint muted', text: ruleText(a) }),
    joy,
    count);
    if (!isOpen) return h('div', { class: 'ach-card' }, head);

    const idNode = h('span', {
      class: 'hint muted mono', text: a.id ? `id: ${a.id}` : 'the id comes from the name, on Save',
    });
    const body = h('div', { class: 'ach-open' },
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'Name' }),
        // As typed, and trimmed on Save: trimmed as it is typed, a render
        // landing just after a space would take the space.
        field(`ach-name-${i}`, a.name, 'What it is called', (e) => {
          a.name = e.currentTarget.value;
          commit(st);
        }, { maxlength: 60 })),
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'How to get it' }),
        field(`ach-how-${i}`, a.how, 'What a player does to earn it, in their words', (e) => {
          a.how = e.currentTarget.value;
          commit(st);
        }, { maxlength: 200 })),
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'Icon' }),
        field(`ach-icon-${i}`, a.icon, '🏆', (e) => { a.icon = e.currentTarget.value; commit(st); }, { maxlength: 8, class: 'cfg-text ach-icon-field' })),
      whenRow(a, i),
      h('p', {
        class: 'hint muted',
        text: heard.size
          ? `The game has said: ${[...heard.keys()].join(' · ')}`
          : 'Play the game in the preview and the moments it says show up here.',
      }),
      ...joyRow(a),
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
      h('div', { class: 'row wrap' },
        h('button', {
          class: 'quiet tiny', text: '+ Add an achievement', disabled: frozen(),
          onclick: () => {
            entries.push({ id: '', name: '', how: '', icon: '', when: null });
            opened.index = entries.length - 1;
            commit(st);
            render();
          },
        }),
        entries.length || frozen() ? null : makeAchievementsButton()),
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
