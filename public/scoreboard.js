// The Share page's scoreboard section: the kept scores for this game, with
// the admin's two moves — delete all, and the per-game switch. The board's
// rows are also the rail's, and the best of them is the number in the strip
// under the preview, so the rendering and the on/off test are exported rather
// than written twice. There is no deleting one score: the board goes whole or
// it stays. All of it talks to the studio origin: the games listener never
// reads a cookie, so nothing over there moderates.

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

// Whether the board is on, in one place. ⚠️ Two shapes reach here: the wire
// sends a boolean (`scores_on: row.scores_on === 1`) and the switch above
// writes one, but the column is 0/1 and a hand-written 0 would read as on
// under a `!== false` test. Both are asked about, because a board that is off
// showing a BEST is the studio contradicting itself.
export const scoresOn = () => S.project.scores_on !== false && S.project.scores_on !== 0;

// The board itself, rows or the reason there are none. Share's section and
// the rail's summary paint from this: two lists of the same scores that could
// disagree is two lists to keep right. Each row is its alias, as everywhere,
// or the person behind it when the studio has asked (`real` comes only from
// the studio origin's own route).
export function renderScoreList() {
  const rows = (S.scores ?? []).map((s, i) => h('div', { class: 'score-row' },
    h('span', { class: 'rank', text: `#${i + 1}` }),
    h('span', { class: 'sname', text: S.realNames && s.real ? s.real : s.name }),
    h('span', { class: 'sval mono', text: s.score.toLocaleString() }),
    h('span', { class: 'swhen', text: agoText(s.created_at) })));
  return rows.length ? h('div', { class: 'score-list' }, ...rows) : h('div', {
    class: 'pad muted',
    text: S.scores === null ? 'Loading…' : 'No scores yet.',
  });
}

export function renderScoreboardTab() {
  const on = scoresOn();
  return [
    h('div', { class: 'pad row wrap' },
      // A button, not a link: it changes what the public origin serves.
      h('button', {
        class: 'quiet tiny',
        text: on ? 'Turn the scoreboard off' : 'Turn the scoreboard back on',
        onclick: () => toggleScores(!on),
      }),
      // A link: it changes how the list reads, not the board.
      S.scores?.length ? h('button', {
        class: 'link',
        text: S.realNames ? 'Show aliases' : 'Show real names',
        onclick: () => { S.realNames = !S.realNames; render(); },
      }) : null,
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
    h('div', { class: 'scroll', 'data-scroll': 'scores' }, renderScoreList()),
  ];
}

// The best anybody has scored, for the strip under the preview. Only when the
// board is on and the scores happen to be loaded — a number that is sometimes
// absent is better than a request fired to fill a label.
export const bestScore = () => (scoresOn() && S.scores?.length ? S.scores[0].score : null);

export const showScore = (n) => n.toLocaleString();
