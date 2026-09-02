// How config/achievements.js opens while it keeps the shape: the achievements
// as a list, one open in its own row — name, how to get it, icon, and the
// moment and test it waits for — no code in sight. The model reading and file
// writing is achievements-editor.js; this is the form. Field edits regenerate
// the file content in place without a render (a render would replace the
// field under the fingers); opening a row, adding and removing render,
// because the shape changed.
//
// Two things the form knows that no field can: how many players hold each
// one, from the studio (GET /api/projects/:slug/achievements), filled in place
// when the answer comes; and which moments the game has been heard to say
// this session (momentsFor in main.js), offered where a rule names one.

import {
  achievementsText, achievementChecks, freshId, TESTS,
} from './achievements-editor.js';
import { h } from './dom.js';
import {
  S, render, saveOpenFile, frozen, api, momentsFor,
} from './main.js';

// Which row is open, for which file — a different file opens closed.
let opened = { path: null, index: null };
// Holders per id, per game, fetched once a file open and painted in place.
const counts = new Map(); // slug -> { players: Map(id -> n), at }
const COUNTS_FRESH_MS = 30 * 1000;
let countNodes = new Map(); // id -> the span showing the count

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function commit(model) {
  S.open.content = achievementsText(model);
  S.open.dirty = true;
  const save = document.getElementById('save-btn');
  if (save) save.disabled = false;
  const status = document.getElementById('cfg-status');
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

async function loadCounts(slug) {
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

export function renderAchievementsForm(model) {
  const { entries } = model;
  const slug = S.slug;
  const heard = momentsFor(slug);
  const checks = achievementChecks(model, heard);
  if (opened.path !== S.open.path) opened = { path: S.open.path, index: null };
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

  const whenRow = (a, i) => {
    const moment = field(a.when?.moment ?? '', 'a moment the game says', (e) => {
      const name = e.currentTarget.value.trim();
      if (!name) a.when = null;
      else if (a.when) a.when.moment = name;
      else a.when = { moment: name, test: 'any', value: undefined };
      commit(model);
    }, { list: 'ach-moments' });
    const test = h('select', {
      disabled: !a.when,
      onchange: (e) => {
        const key = e.currentTarget.value;
        a.when = { moment: a.when.moment, test: key, value: key === 'any' ? undefined : key === 'is' ? '' : 1 };
        commit(model);
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
        commit(model);
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
          commit(model);
        }, { maxlength: 60 })),
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'How to get it' }),
        field(a.how, 'What a player does to earn it, in their words', (e) => {
          a.how = e.currentTarget.value.trim();
          commit(model);
        }, { maxlength: 200 })),
      h('div', { class: 'row' },
        h('span', { class: 'cfg-name mono', text: 'Icon' }),
        field(a.icon, '🏆', (e) => { a.icon = e.currentTarget.value.trim(); commit(model); }, { maxlength: 8, class: 'cfg-text ach-icon-field' })),
      whenRow(a, i),
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
                commit(model);
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
          commit(model);
          render();
        },
      }),
      ...checks.map((say) => h('p', { class: 'hint warn', text: `⚠ ${say}` }))),
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
        disabled: !S.open.dirty || frozen(),
        onclick: () => saveOpenFile(),
      })),
  ];
}
