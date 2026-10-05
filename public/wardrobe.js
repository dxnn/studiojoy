// The wardrobe (ideas/dreams.md §6, server/gear.js): your avatar — a head, a
// body and legs — and the gear to dress it in. Wear what you own; buy what
// other people made, for joy; and draw new pieces, three a week, in the pixel
// editor's gear mode, where every tool stays inside the slot's shape. Opened
// from the Crew tab, and at /wardrobe, so it is a place you can go back to.

import { h } from './dom.js';
import {
  S, render, api, send, say, openProject, prefs, urlAs,
} from './main.js';
import { SLOTS } from './gear-shapes.js';
import { avatarFigure, gearSrc, bareOf } from './avatar.js';
import {
  renderDrawing, startGearDrawing, pictureBlob, lightPaper,
} from './drawing.js';
import { loadPeople } from './people.js';

const SLOT_WORDS = { head: 'Head', body: 'Body', legs: 'Legs' };
const ANOTHER = { head: 'another head', body: 'another body', legs: 'other legs' };
const DRAW_WORDS = { head: 'Draw a head', body: 'Draw a body', legs: 'Draw some legs' };

// Leaving whatever game was open, the usual way, and arriving here.
// ⚠️ Returned all the way up: it opens a place (spec/ §17).
export async function openWardrobe() {
  // Leaving the game and arriving here are one step, so one Back undoes it.
  await urlAs('hold', () => openProject(null));
  S.wardrobe = { drawing: null, data: null };
  S.narrowPane = 'chat';
  await loadWardrobe();
}

export async function loadWardrobe() {
  const res = await api('GET', '/api/gear');
  if (!S.wardrobe) return;
  if (res.ok) S.wardrobe.data = res.body;
  else say(res.body?.error ?? 'Could not open the wardrobe.', true);
  render();
}

// Leaving: a piece half drawn is let go with the wardrobe.
export function closeWardrobe() {
  if (!S.wardrobe) return;
  S.wardrobe = null;
  if (S.draw?.gear) { S.draw = null; S.palette = null; }
}

async function wear(slot, id) {
  const res = await api('PUT', '/api/me/avatar', { [slot]: id });
  if (!res.ok) { say(res.body?.error ?? 'Could not put that on.', true); return; }
  S.me.avatar = res.body;
  if (S.wardrobe?.data) S.wardrobe.data.wearing = res.body;
  // The crew list and the chat draw everybody from it, you included.
  await loadPeople();
  render();
}

async function buy(piece) {
  const res = await api('POST', `/api/gear/${piece.id}/buy`);
  if (!res.ok) { say(res.body?.error ?? 'Could not buy that.', true); return; }
  S.me.joy = res.body.joy;
  say(`“${piece.name}” is yours.`);
  await loadWardrobe();
}

function startDrawing(slot) {
  S.wardrobe.drawing = { slot, name: '', with: companions(slot) };
  startGearDrawing(slot);
  render();
}

// The other two pieces the one being drawn is seen with: what you wear in
// each place, else somebody's piece for it at random, else the bare shape.
function companions(slot) {
  const { gear, wearing } = S.wardrobe.data;
  const out = {};
  for (const other of SLOTS.filter((s) => s !== slot)) {
    const choices = gear.filter((g) => g.slot === other);
    out[other] = wearing[other] ?? choices[Math.floor(Math.random() * choices.length)]?.id ?? null;
  }
  return out;
}

// The next piece for that place, everybody's in turn and then the bare shape.
function tryNext(slot) {
  const ids = [...S.wardrobe.data.gear.filter((g) => g.slot === slot).map((g) => g.id), null];
  const at = ids.indexOf(S.wardrobe.drawing.with[slot]);
  S.wardrobe.drawing.with[slot] = ids[(at + 1) % ids.length];
  render();
}

// The piece being drawn in its place on a figure, with the other two around
// it, so where a neck or a waist meets the next piece shows while it is
// drawn. The live one is a canvas copied off the picture every frame, the way
// the strip's loop is, stopping once it leaves the page. The other two are
// pressed to try the next piece in that place. On the paper the canvas has.
function inContext(st) {
  const { slot } = st.drawing;
  const { width, height } = S.draw.picture;
  const live = h('canvas', { class: slot, width, height });
  const ctx = live.getContext('2d');
  let seen = false;
  const loop = () => {
    if (live.isConnected) seen = true;
    else if (seen) return;
    const picture = S.draw?.picture;
    if (picture) ctx.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const other = (s) => {
    const id = st.drawing.with[s];
    const g = S.wardrobe.data.gear.find((x) => x.id === id);
    return h('button', {
      class: 'gear-try',
      title: `${g ? `“${g.name}”` : 'Nothing'} — press to try ${ANOTHER[s]}`,
      onclick: () => tryNext(s),
    }, h('img', { class: s, src: id ? gearSrc(id) : bareOf(s), alt: '' }));
  };
  return h('div', { class: 'gear-context' },
    h('div', { class: `avatar-figure context${lightPaper() ? ' paper-light' : ''}` },
      SLOTS.map((s) => (s === slot ? live : other(s)))),
    h('span', { class: 'hint muted', text: 'Press the others to try them' }));
}

function stopDrawing() {
  S.wardrobe.drawing = null;
  S.draw = null;
  S.palette = null;
  render();
}

async function makeIt() {
  const { slot, name } = S.wardrobe.drawing;
  if (!name.trim()) { say('Give it a name first.', true); return; }
  const body = await pictureBlob(S.draw.picture);
  const res = await send(`/api/gear?slot=${slot}&name=${encodeURIComponent(name.trim())}`, {
    method: 'POST', headers: { 'content-type': 'image/png' }, body,
  });
  const answer = await res.json().catch(() => null);
  if (!res.ok) { say(answer?.error ?? 'Could not make that.', true); return; }
  stopDrawing();
  say(`“${answer.name}” is in the wardrobe — yours, and everybody else's to buy.`);
  await loadWardrobe();
}

// One piece: its picture, its name, who made it.
const piece = (g, ...after) => h('div', { class: 'gear-piece' },
  h('img', { class: `gear ${g.slot}`, src: gearSrc(g.id), alt: '' }),
  h('span', { class: 'gear-name', text: g.name }),
  h('span', { class: 'hint muted', text: g.mine ? 'by you' : `by ${g.maker}` }),
  ...after);

export function renderWardrobe() {
  const st = S.wardrobe;
  const data = st.data;
  // The centre pane's own shell, as the studio with no game open has it: the
  // bar, and on a phone the way back to the list.
  const head = h('div', { class: 'bar' },
    h('button', { class: 'quiet only-narrow', text: '☰ Games', onclick: () => { S.narrowPane = 'games'; render(); } }),
    !S.sidebar && h('button', {
      class: 'icon only-wide', text: '☰', title: 'Show games and helpers',
      onclick: () => { S.sidebar = true; prefs.set('sidebar', 'open'); render(); },
    }),
    h('div', { class: 'title', text: 'Your wardrobe' }),
    data ? h('span', { class: 'wardrobe-joy', text: `${data.joy} joy` }) : null);
  const pane = (...kids) => h('div', { class: `pane chat wardrobe${S.narrowPane === 'chat' ? ' show' : ''}` }, head, ...kids);

  if (st.drawing) {
    const { slot } = st.drawing;
    const name = h('input', {
      type: 'text', class: 'cfg-text gear-name-field', maxlength: '40', placeholder: 'What it is called',
      'aria-label': 'Its name',
      oninput: (e) => { st.drawing.name = e.currentTarget.value; },
    });
    name.value = st.drawing.name;
    return pane(
      h('p', { class: 'hint pad', text: `${SLOT_WORDS[slot]}: draw inside the shape — outside it, nothing sticks.` }),
      h('div', { class: 'gear-drawing' },
        renderDrawing({
          bar: [
            name,
            h('button', { class: 'filled', text: 'Put it in the wardrobe', onclick: () => makeIt() }),
            h('button', { class: 'quiet tiny', text: 'Never mind', onclick: () => stopDrawing() }),
          ],
        }),
        inContext(st)));
  }

  if (!data) return pane(h('p', { class: 'pad hint muted', text: 'Opening the wardrobe…' }));

  const yours = data.gear.filter((g) => g.owned);
  const theirs = data.gear.filter((g) => !g.owned);
  const left = data.makes_a_week - data.made_this_week;

  // What you are wearing, and what else of yours could go in each place. The
  // piece worn is lit, because pressing it again takes it off.
  const wearRow = (slot) => {
    const worn = data.wearing[slot];
    const mine = yours.filter((g) => g.slot === slot);
    return h('div', { class: 'wear-row' },
      h('span', { class: 'cfg-name mono', text: SLOT_WORDS[slot] }),
      mine.length
        ? h('div', { class: 'row wrap' }, ...mine.map((g) => h('button', {
          class: `gear-pick${worn === g.id ? ' on' : ''}`,
          title: worn === g.id ? `Take off “${g.name}”` : `Wear “${g.name}”`,
          onclick: () => wear(slot, worn === g.id ? null : g.id),
        }, h('img', { class: `gear ${slot}`, src: gearSrc(g.id), alt: '' }), h('span', { text: g.name }))))
        : h('span', { class: 'hint muted', text: 'Nothing yet — draw one, or buy one below.' }));
  };

  const body = h('div', { class: 'scroll wardrobe-body', 'data-scroll': 'wardrobe' },
    h('section', { class: 'wardrobe-you' },
      avatarFigure(data.wearing, { size: 'big' }),
      h('div', { class: 'col' }, ...SLOTS.map(wearRow))),

    h('section', {},
      h('h3', { text: 'Make something' }),
      left > 0
        ? h('div', { class: 'row wrap' },
          ...SLOTS.map((slot) => h('button', { text: DRAW_WORDS[slot], onclick: () => startDrawing(slot) })),
          h('span', { class: 'hint muted', text: `${left} more this week — yours for nothing, and everybody else's to buy for ${data.price} joy` }))
        : h('p', { class: 'hint muted', text: `You have made ${data.makes_a_week} this week. More on Monday.` })),

    h('section', {},
      h('h3', { text: 'Everybody\'s gear' }),
      theirs.length
        ? h('div', { class: 'gear-grid' }, ...theirs.map((g) => piece(g,
          data.joy >= data.price
            ? h('button', { class: 'quiet tiny', text: `Buy for ${data.price} joy`, onclick: () => buy(g) })
            : h('span', { class: 'hint muted', text: `${data.price} joy` }))))
        : h('p', { class: 'hint muted', text: 'Nothing here you do not already have — yet.' })),

    yours.length
      ? h('section', {},
        h('h3', { text: 'Yours' }),
        h('div', { class: 'gear-grid' }, ...yours.map((g) => piece(g))))
      : null);

  return pane(body);
}
