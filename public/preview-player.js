// The preview player's controls (server/preview-player.js, ideas/dreams.md
// §3): the preview is always that player — its own clock, never on a board —
// and these say what it is doing: running or paused, one frame on, how fast.
// Per tab and per game, sent again whenever the preview loads, since a reload
// is a new page that knows nothing.

import { h } from './dom.js';
import { S, render, say, previewWindow } from './main.js';
import { gamesOrigin } from './telemetry.js';
import { liveTweaks } from './tweaks.js';

// The one savepoint each game has, by slug: what Pin took — the game's State
// as text and where its random numbers stood — kept here rather than in the
// preview, so a reload of the game does not lose it. Per tab; Pin again
// replaces it.
const savepoints = new Map();

const UNPINNED = {
  'no-state': 'This game keeps its run outside State, so there is nothing to pin yet.',
  'not-plain': 'This game keeps something in State that is not plain data — a picture, a function or a library\'s object — so it cannot be pinned.',
  'not-a-save': 'That pin is from a game shaped differently from this one now.',
};

const SPEEDS = [1, 0.5, 0.25];
const SPEED_WORDS = { 1: '1×', 0.5: '½×', 0.25: '¼×' };

function tell(data) {
  const frame = previewWindow();
  const origin = gamesOrigin();
  if (!frame || !origin) return;
  try {
    frame.postMessage({ gamestudio: 'player', ...data }, origin);
  } catch {
    // A frame between pages; it asks again when it has loaded.
  }
}

// The settings and the tweaks (tweaks.js) — and, to a page that has just
// loaded, the place an editor is trying (tryFrom, below).
function settle({ loaded = false } = {}) {
  const trying = S.player.trying;
  const jump = loaded && trying?.mode === S.mode ? trying.fields : null;
  tell({
    paused: S.player.paused, speed: S.player.speed, tweaks: liveTweaks(), ...(jump ? { jump } : {}),
  });
}

// A tweak tried, saved or dropped: the preview is told the whole set again.
export const settlePlayer = () => settle();

// "Try this scene" and "Try it": the preview opened again on a fresh page and
// put where the editor says, by the savepoint's own way — `fields` laid over
// the game's State once it has loaded, and kept as the pin. Held while that
// editor is showing, so a save from it lands back on the scene being worked
// on, as ?scene= used to; each editor knows its template's fields, the way it
// knows the file it edits. There is no way in from the game's own address any
// more, so a player cannot skip ahead.
export function tryFrom(fields) {
  S.player.trying = { mode: S.mode, fields };
  S.previewOpen = true;
  S.previewNonce += 1;
}

// What the preview says: a new page asking for its settings — a save, a
// commit, another game — a pin taken, or why one could not be.
window.addEventListener('message', (event) => {
  const origin = gamesOrigin();
  if (!origin || event.origin !== origin) return;
  const data = event.data;
  if (!data || data.slug !== S.slug) return;
  if (data.gamestudio === 'player-ready') settle({ loaded: true });
  if (data.gamestudio === 'player-pinned' && typeof data.savepoint?.file === 'string') {
    savepoints.set(S.slug, { file: data.savepoint.file, seed: Number(data.savepoint.seed) || 0 });
    render();
  }
  if (data.gamestudio === 'player-unpinned') say(UNPINNED[data.reason] ?? UNPINNED['no-state'], true);
});

export function renderPlayerControls() {
  const { paused, speed } = S.player;
  return [
    h('button', {
      class: `icon${paused ? ' on' : ''}`, text: paused ? '▶' : '⏸',
      title: paused ? 'Carry on' : 'Pause the game',
      onclick: () => { S.player.paused = !paused; settle(); render(); },
    }),
    paused ? h('button', {
      class: 'icon', text: '⏭', title: 'One frame on', onclick: () => tell({ step: true }),
    }) : null,
    h('button', {
      class: `icon${speed === 1 ? '' : ' on'}`, text: SPEED_WORDS[speed],
      title: 'How fast the game runs here — press for slower',
      onclick: () => {
        S.player.speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
        settle();
        render();
      },
    }),
    // One savepoint a game: Pin takes it, again replaces it, and Back puts
    // the game there with the numbers as they are now.
    h('button', {
      class: 'icon', text: '📌',
      title: 'Pin this moment, to come back to it',
      onclick: () => tell({ pin: true }),
    }),
    savepoints.has(S.slug) ? h('button', {
      class: 'icon', text: '↩',
      title: 'Back to the pinned moment, with the numbers as they are now',
      onclick: () => tell({ back: savepoints.get(S.slug) }),
    }) : null,
  ];
}
