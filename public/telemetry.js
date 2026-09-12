// What the running game says while it plays: problems and moments, both
// forwarded by the reporter the games listener injects (spec.md §7) — the
// studio cannot reach into the preview frame either, so postMessage is the
// only way either one arrives, and everything arriving is text written by
// LLM-authored game code, checked before it is believed. Both panels are
// painted in place under the preview rather than through render(): the
// iframe reloads the moment it leaves the document, so a render at the wrong
// moment would restart the game and make it say the same thing again.

import { h } from './dom.js';
import { S, api, previewWindow } from './main.js';

/* Problems the game reported --------------------------------------------- */

const MAX_ERROR_BATCH = 20;
const ERROR_BATCH_MS = 500;
const errorQueue = [];
let errorTimer = null;
// The commit the queued problems came from. The reporter is built with it, so
// it names the code that actually broke rather than whatever has been
// committed since.
let errorVersion = null;
// The live nodes of the problems panel, while the Play tab is on screen.
let problemNodes = null;

/* Moments the game said ---------------------------------------------------- */

// What the running game said happened (GLOSSARY: *moment*), forwarded by the
// reporter in batches — the latest value per name and how often it was said.
// Kept per game for the session, so the achievements editor can offer the
// moments this game has been seen to say. ⚠️ Painted in place like the
// problems panel: a moment said at startup, drawn through render(), would
// rebuild the iframe, restart the game and say it again.
const MOMENT_NAME = /^[a-z0-9-]{1,40}$/;
const MAX_MOMENT_NAMES = 100;
const momentsSeen = new Map(); // slug -> Map(name -> {value, times})
let momentNodes = null;

export const momentsFor = (slug) => momentsSeen.get(slug) ?? new Map();

// The value as the moments library would have heard it, or undefined: this is
// text from inside the frame, and a game can dispatch the event itself.
function momentValue(v) {
  if (v === true || v === null || v === undefined) return true;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.length <= 100) return v;
  return undefined;
}

function noteMoments(list) {
  if (!Array.isArray(list) || !S.slug) return;
  let seen = momentsSeen.get(S.slug);
  if (!seen) {
    seen = new Map();
    momentsSeen.set(S.slug, seen);
  }
  for (const m of list.slice(0, 50)) {
    if (!m || typeof m.name !== 'string' || !MOMENT_NAME.test(m.name)) continue;
    const value = momentValue(m.value);
    if (value === undefined) continue;
    const had = seen.get(m.name);
    if (!had && seen.size >= MAX_MOMENT_NAMES) continue;
    const times = Number.isInteger(m.times) && m.times > 0 ? m.times : 1;
    seen.set(m.name, { value, times: (had?.times ?? 0) + times });
  }
  paintMoments();
}

function gamesOrigin() {
  if (!S.project?.play_url) return null;
  try {
    return new URL(S.project.play_url).origin;
  } catch {
    return null;
  }
}

async function flushErrors() {
  errorTimer = null;
  const slug = S.slug;
  const version = errorVersion;
  const errors = errorQueue.splice(0, errorQueue.length).slice(0, MAX_ERROR_BATCH);
  if (!slug || errors.length === 0) return;
  // The reply comes back as a game.errors broadcast, so the list is rendered
  // from one place whichever tab reported it.
  await api('POST', `/api/projects/${slug}/errors`, { version, errors });
}

/* A frame of the game ------------------------------------------------------ */

// What a helper is shown when somebody says the game looks wrong (spec/ §8,
// `look_at_game`). The reporter draws it inside the frame; this asks for it
// and puts it on the server.
//
// ⚠️ Asked for at one moment only — a message being sent — so the picture is
// the one the person was looking at as they typed. Nothing is captured while
// somebody is simply playing.
const SHOT_WAIT_MS = 500;
let waitingForShot = null;

// Resolves with a data URI, or null: no preview open, a game with no canvas,
// a frame that has not finished loading. None of those is worth telling
// anybody about — the tool says plainly that there is no picture.
export function grabShot(slug) {
  const origin = gamesOrigin();
  const frame = previewWindow();
  if (!origin || !frame || slug !== S.slug) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (data) => {
      if (waitingForShot !== done) return;
      waitingForShot = null;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => done(null), SHOT_WAIT_MS);
    waitingForShot = done;
    try {
      frame.postMessage({ gamestudio: 'shoot' }, origin);
    } catch {
      done(null);
    }
  });
}

// Take one and store it, if there is one to take. Awaited before a message is
// sent, so the fire it starts can see it; the optimistic bubble is already on
// screen, so the half-second ceiling is invisible.
export async function keepShot(slug) {
  const shot = await grabShot(slug);
  if (!shot) return;
  // A look is nobody's emergency: a failure here must never stop the message
  // it rode in front of.
  try {
    await api('PUT', `/api/projects/${slug}/shot`, { data: shot.data, version: shot.version });
  } catch {
    // The message is the thing that matters.
  }
}

window.addEventListener('message', (event) => {
  const origin = gamesOrigin();
  if (!origin || event.origin !== origin) return;
  const data = event.data;
  if (!data || data.slug !== S.slug) return;
  if (data.gamestudio === 'shot') {
    // Only ever the one asked for. `data` is a string from inside the frame;
    // the server is what decides whether it is a picture.
    if (waitingForShot) {
      waitingForShot(
        typeof data.data === 'string'
          ? { data: data.data, version: String(data.version ?? '') }
          : null,
      );
    }
    return;
  }
  if (data.gamestudio === 'moment') {
    noteMoments(data.moments);
    return;
  }
  if (data.gamestudio !== 'error') return;
  const version = String(data.version ?? '');
  // A different version means the preview reloaded, so anything still queued
  // describes bytes that are gone.
  if (version !== errorVersion) {
    errorQueue.length = 0;
    errorVersion = version;
  }
  errorQueue.push({
    message: String(data.message ?? ''),
    location: String(data.location ?? ''),
  });
  // A game that breaks on load usually breaks several times at once; one
  // round trip for the burst is enough.
  if (errorTimer === null) errorTimer = setTimeout(flushErrors, ERROR_BATCH_MS);
});

// Whether the problems panel is on screen right now — the game.errors event
// repaints it in place when it is, and falls back to a full render when it is
// not (the Play tab is not the one showing, or nothing has rendered it yet).
export const problemPanelLive = () => !!problemNodes;

// render() clears both before rebuilding the tree: rebuilt by the Play tab if
// it is on screen, and null otherwise means an arriving problem or moment has
// nothing live to paint into and needs a full render instead.
export function resetGameNodes() {
  problemNodes = null;
  momentNodes = null;
}

// What the game reported while someone was playing it. Shown here because
// this is where you were when it happened; the helpers get the same list as
// text on the next message, which is the only way they can ever see it.
//
// The panel is built empty and filled in place, so a problem arriving mid-game
// never costs a re-render — see the game.errors event.
export function paintProblems() {
  if (!problemNodes) return;
  const { box, list } = problemNodes;
  box.hidden = S.errors.length === 0;
  list.replaceChildren(...S.errors.map((e) => h('div', { class: 'problem' },
    e.location ? h('span', { class: 'where', text: e.location }) : null,
    h('span', { text: e.message }),
    e.times > 1 ? h('span', { class: 'muted', text: ` (${e.times} times)` }) : null)));
}

export function renderProblems() {
  const list = h('div', { class: 'problem-list' });
  const box = h('div', { class: 'problems' },
    h('div', { class: 'problems-head', text: 'The game ran into trouble' }),
    list,
    h('div', { class: 'hint muted', text: 'Your helpers can see this. Ask them to fix it.' }));
  problemNodes = { box, list };
  paintProblems();
  return box;
}

// What the game has said so far, under the problems: a chip per moment name
// with its latest value, so somebody writing an achievement can see the names
// the game actually says. Built empty and filled in place, like the problems.
function paintMoments() {
  if (!momentNodes) return;
  const { box, list } = momentNodes;
  const seen = momentsFor(S.slug);
  box.hidden = seen.size === 0;
  list.replaceChildren(...[...seen].map(([name, m]) => h('span', {
    class: 'moment', title: `said ${m.times} ${m.times === 1 ? 'time' : 'times'}`,
  },
  h('span', { class: 'mname', text: name }),
  m.value === true ? null : h('span', { class: 'mvalue', text: String(m.value) }),
  m.times > 1 ? h('span', { class: 'muted', text: `×${m.times}` }) : null)));
}

export function renderMoments() {
  const list = h('div', { class: 'moment-list' });
  const box = h('div', { class: 'moments' },
    h('div', { class: 'moments-head', text: 'The game said' }),
    list);
  momentNodes = { box, list };
  paintMoments();
  return box;
}
