// Controls: how the game is held, as a mode of its own (public/game-types.js).
// The mode is the file — arriving opens config/controls.js — so the panel is
// the open file's editor with the tree left out, the way Questions is.
//
// Two halves. The shape: one row per thing the studio offers, the arcade
// family opening into its three manners underneath, and changing it writes
// one word. Then what each player does: a row per verb with its bindings, and
// under those every binding this shape cannot use, said in words. That last
// list is what declaring the shape was for — a file claiming swipe-tap while
// binding six drawn buttons has left its shape, and this is where that gets
// said rather than the game quietly not answering a thumb.
//
// The model reading and file writing is controls-editor.js; this is the form.

import {
  deadBindings, deadReason, controlsChecks, setScheme, setBindings, CONTROLS_FILE,
} from './controls-editor.js';
import { h } from './dom.js';
import {
  S, render, renderOpenFile, saveOpenFileSoon, more, frozen,
} from './main.js';

function commit(text) {
  if (text === null) {
    // The file stopped being readable between the render and the click, which
    // only a helper writing it underneath can do.
    render();
    return;
  }
  S.open.content = text;
  S.open.dirty = true;
  saveOpenFileSoon();
  render();
}

// The mode's own entry point: the file, once it is open.
export function renderControlsEditor() {
  if (S.open?.path === CONTROLS_FILE) return renderOpenFile();
  if (!S.files.some((f) => f.path === CONTROLS_FILE)) {
    return h('div', { class: 'pad' },
      h('p', { text: `This game has no ${CONTROLS_FILE}, so there is nothing here to change yet.` }),
      h('p', {
        class: 'hint muted',
        text: 'Every game made in the studio is born with one. A game from before '
          + 'the studio library gets one from the next sweep, and a helper can write '
          + 'one before that.',
      }));
  }
  return h('div', { class: 'pad muted' }, h('p', { text: `Opening ${CONTROLS_FILE}…` }));
}

// The words for a shape, from the registry. Unknown to it — a game holding a
// word the studio no longer offers — still gets a row, so the panel says what
// the game is rather than looking like it is something else.
function words(key) {
  const scheme = S.schemes?.schemes?.[key];
  if (scheme) return scheme;
  if (key === '') {
    return {
      title: 'Buttons only',
      what: 'This game was made before the shape was written down, and plays as drawn buttons.',
    };
  }
  return { title: key, what: 'The studio does not offer this shape any more.' };
}

// One choosable row: the name over what it does, the whole row a button
// because the sentence is as much of the choice as the name. Cyan while it is
// the one the game wears — the studio's own voice, not the game's.
//
// The row the game already wears is not a button at all, and neither is any
// of them in a game you may not change: a greyed-out row is a question, and
// "why can I not press this" has no answer a row can give.
function shapeRow({ title, what }, { on, indent = false, onPick }) {
  const cls = `ctl-shape${on ? ' on' : ''}${indent ? ' manner' : ''}`;
  const body = [
    h('span', { class: 'cname', text: title }),
    h('span', { class: 'cwhat', text: what }),
  ];
  if (on || frozen()) return h('div', { class: cls }, ...body);
  return h('button', { class: cls, onclick: onPick }, ...body);
}

export function renderControlsForm(model) {
  const registry = S.schemes ?? {};
  const shape = model.scheme;
  const ro = frozen();
  const pick = (key) => () => commit(setScheme(S.open.content, key));

  // What is offered, in the registry's order, with the family a manner
  // belongs to standing in for it. A shape the game holds but nobody offers
  // any more is offered too, once, so the row that is on is always there.
  const offer = registry.offer ?? [];
  const familyOf = (key) => offer.find((k) => registry.families?.[k]?.of?.includes(key)) ?? null;
  const here = familyOf(shape);
  const listed = new Set(offer.flatMap((k) => registry.families?.[k]?.of ?? [k]));

  const rows = [];
  for (const key of offer) {
    const family = registry.families?.[key];
    if (!family) {
      rows.push(shapeRow(words(key), { on: key === shape, onPick: pick(key) }));
      continue;
    }
    // The family stands for its manners: it is on when the game wears any of
    // them, and picking it from cold starts as the first.
    const on = here === key;
    rows.push(shapeRow(family, { on, onPick: pick(family.of[0]) }));
    // Its manners open in the row they belong to, one open at a time, which
    // here means only while the family is the one the game wears.
    if (!on) continue;
    for (const manner of family.of) {
      rows.push(shapeRow(words(manner), {
        on: manner === shape, indent: true, onPick: pick(manner),
      }));
    }
  }
  if (!listed.has(shape)) {
    rows.unshift(shapeRow(words(shape), { on: true, onPick: pick(shape) }));
  }

  // A verb and everything that does it. Read-only: the words on the left are
  // the game's own — Input.held("thrust") is somewhere in its code — so a
  // rename here would be a silent code break. A binding this shape has not
  // got is struck through here as well as listed below, or the row would show
  // a control that looks like it works.
  const verbRow = ({ verb, bindings }) => h('div', { class: 'ctl-verb' },
    h('span', { class: 'cfg-name mono', text: verb }),
    h('div', { class: 'row wrap' }, bindings.length === 0
      ? h('span', { class: 'hint muted', text: 'nothing does this' })
      : bindings.map((b) => h('span', {
        class: `ctl-chip mono${deadReason(shape, b) ? ' dead' : ''}`, text: b.raw,
      }))));

  const playerBlock = (player) => h('div', { class: 'cfg-group' },
    h('div', { class: 'cfg-group-head' },
      h('span', { class: 'cfg-name mono', text: player.who }),
      h('span', {
        class: 'hint muted',
        text: player.who === 'player1'
          ? 'the keyboard, the first controller, and the screen'
          : 'the keyboard and the second controller — the screen is player 1\'s',
      })),
    h('div', { class: 'cfg-group-body' }, player.verbs.map(verbRow)));

  const dead = deadBindings(model);
  const deadRow = ({ who, verb, binding, why }, i) => h('div', { class: 'ctl-verb' },
    h('span', { class: 'ctl-chip mono dead', text: binding.raw }),
    h('span', { class: 'hint muted', text: `${who} · ${verb} — ${why}` }),
    h('div', { class: 'spacer' }),
    ro ? null : more(`dead:${i}`, [{
      text: 'Take it out',
      onPick: () => {
        const line = model.players.find((p) => p.who === who)
          .verbs.find((v) => v.verb === verb).bindings
          .filter((b) => b.raw !== binding.raw)
          .map((b) => b.raw);
        commit(setBindings(S.open.content, who, verb, line));
      },
    }], { label: `More about ${binding.raw}` }));

  return [
    h('div', { class: 'scroll cfg', 'data-scroll': 'controls' },
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'How it is played' }),
        h('span', {
          class: 'hint muted',
          text: model.declared
            ? 'what a phone draws, and what a thumb can reach'
            : 'nothing says yet — pick one and it will be written down',
        })),
      h('div', { class: 'ctl-shapes' }, rows),
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'What each player does' }),
        h('span', { class: 'hint muted', text: 'the words on the left are the game\'s own, and its code asks for them by name' })),
      ...model.players.map(playerBlock),
      dead.length === 0 ? null : h('div', { class: 'cfg-group' },
        h('div', { class: 'cfg-group-head' },
          h('span', { class: 'cfg-name mono', text: 'These do nothing' }),
          h('span', { class: 'hint muted', text: 'bound to something this shape has not got' })),
        h('div', { class: 'cfg-group-body' }, dead.map(deadRow))),
      model.extra.length === 0 ? null : h('p', {
        class: 'hint muted',
        text: `This file also sets ${model.extra.join(', ')}, which is not shown here — `
          + 'open it under Code to change that.',
      }),
      // What the file as a whole says, under the bindings because that is
      // what it is about.
      ...controlsChecks(model).map((say) => h('p', { class: 'hint warn', text: `⚠ ${say}` }))),
    h('div', { class: 'editor-bar row' },
      h('span', {
        class: 'hint muted', id: 'cfg-status', text: S.open.dirty ? 'Saving…' : 'Saved',
      }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'link', text: 'Show the text',
        onclick: () => { S.open.asText = true; render(); },
      })),
  ];
}
