// The preview player's controls (server/preview-player.js, ideas/dreams.md
// §3): the preview is always that player — its own clock, never on a board —
// and these say what it is doing: running or paused, one frame on, how fast.
// Per tab and per game, sent again whenever the preview loads, since a reload
// is a new page that knows nothing.

import { h } from './dom.js';
import { S, render, previewWindow } from './main.js';
import { gamesOrigin } from './telemetry.js';

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

const settle = () => tell({ paused: S.player.paused, speed: S.player.speed });

// A new page in the preview — a save, a commit, another game — asks.
window.addEventListener('message', (event) => {
  const origin = gamesOrigin();
  if (!origin || event.origin !== origin) return;
  if (event.data?.gamestudio === 'player-ready' && event.data.slug === S.slug) settle();
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
  ];
}
