// The Share page's scoreboard section: the kept scores for this game, with
// the admin's three moves — delete one, delete all, and the per-game switch
// — plus the best score, read by the strip under the preview. All of it
// talks to the studio origin: the games listener never reads a cookie, so
// nothing over there moderates.

import { h } from './dom.js';
import {
  S, send, api, say, render, problem,
} from './main.js';

export async function loadScores() {
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

export function renderScoreboardTab() {
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

// The best anybody has scored, for the strip under the preview. Only when the
// board is on and the scores happen to be loaded — a number that is sometimes
// absent is better than a request fired to fill a label.
export const bestScore = () => (S.project.scores_on !== 0 && S.scores?.length ? S.scores[0].score : null);

export const showScore = (n) => n.toLocaleString();
