// The preview player's controls (server/preview-player.js, ideas/dreams.md
// §3 and §4): the preview is always that player — its own clock, never on a
// board — and these say what it is doing: running or paused, one frame on,
// how fast, and whether the robot is playing. Per tab and per game, sent again
// whenever the preview loads, since a reload is a new page that knows nothing.

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

const SPEEDS = [1, 0.5, 0.25, 4, 16];
const SPEED_WORDS = { 1: '1×', 0.5: '½×', 0.25: '¼×', 4: '4×', 16: '16×' };

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
    paused: S.player.paused,
    speed: S.player.speed,
    robot: S.player.robot,
    tweaks: liveTweaks(),
    ...(jump ? { jump } : {}),
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
    savepoints.set(S.slug, {
      file: data.savepoint.file, seed: Number(data.savepoint.seed) || 0, robot: data.savepoint.robot ?? null,
    });
    render();
  }
  if (data.gamestudio === 'player-unpinned') say(UNPINNED[data.reason] ?? UNPINNED['no-state'], true);
  // The robot stopped in the game: a person's hands took over, its teacher
  // went wrong, or the game broke — when it brings the moment before.
  if (data.gamestudio === 'player-robot' && data.on === false && data.reason !== 'studio') {
    S.player.robot = false;
    if (data.reason === 'broke') {
      const savepoint = typeof data.savepoint?.file === 'string' ? data.savepoint : null;
      S.player.broke = { message: String(data.message ?? ''), savepoint };
    }
    if (data.reason === 'taught') say('The robot\'s own code went wrong — the problem is in js/robot.js.', true);
    render();
  }
});

// What the robot found, under the preview, until it plays again: the game's
// own error, and — for a game on State — the way back to just before it.
export function renderRobotNote() {
  const broke = S.player.broke;
  if (!broke) return null;
  return h('div', { class: 'robot-note' },
    h('p', { class: 'hint', text: `🤖 The robot broke the game${broke.message ? `: ${broke.message}` : '.'}` }),
    // Paused there, so nothing moves on before somebody decides: ▶ to play
    // from it by hand, 🤖 to watch the robot break it the same way again.
    broke.savepoint ? h('button', {
      text: 'Go to just before it broke',
      title: 'Back to a moment a few seconds before, paused, as your pin — let the robot play from there to see it again',
      onclick: () => {
        savepoints.set(S.slug, broke.savepoint);
        S.player.broke = null;
        S.player.paused = true;
        settle();
        tell({ back: broke.savepoint });
        render();
      },
    }) : null);
}

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
      title: 'How fast the game runs here — press for the next speed: slower, then faster',
      onclick: () => {
        S.player.speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
        settle();
        render();
      },
    }),
    // The robot plays it for you, run after run, and keeps playing through a
    // save; your own key or tap takes over.
    h('button', {
      class: `icon${S.player.robot ? ' on' : ''}`, text: '🤖',
      title: S.player.robot ? 'Stop the robot' : 'Let the robot play',
      // Letting it play is letting the game run, so it carries on if paused.
      onclick: () => {
        S.player.robot = !S.player.robot;
        if (S.player.robot) { S.player.broke = null; S.player.paused = false; }
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
