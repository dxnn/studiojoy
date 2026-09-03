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
  deadBindings, deadReason, controlsChecks, sayBinding, screenOptions,
  keyNameFor, isArrow, PAD_NAMES, hasSide, hasDeadzone,
  setScheme, setBindings, setKnob, CONTROLS_FILE,
} from './controls-editor.js';
import { h } from './dom.js';
import {
  S, render, more, frozen,
} from './main.js';
import { renderOpenFile } from './files-tab.js';
import { saveOpenFileSoon } from './files.js';

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
// A select that is really a button with a list behind it: the label sits in
// front, picking one does the thing, and it goes back to the label so the
// next pick reads the same.
function pickOne(label, options, onPick) {
  return h('select', {
    class: 'ctl-add',
    onchange: (e) => {
      const { value } = e.currentTarget;
      e.currentTarget.value = '';
      if (value) onPick(value);
    },
  }, h('option', { value: '', text: label }), options.map(
    (o) => h('option', { value: o.value, text: o.label }),
  ));
}

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

  // A verb and everything that does it, and open it to change them. The word
  // on the left is never editable: it is the game's own, and
  // Input.held("thrust") is somewhere in its code. A binding this shape has
  // not got is struck through here as well as listed below, or the row would
  // show a control that looks like it works.
  const verbRow = (who, { verb, bindings }) => {
    const key = `${who}/${verb}`;
    const open = S.controlsVerb === key;
    const row = h('div', { class: `ctl-verb${open ? ' on' : ''}${ro ? '' : ' opens'}` },
      h('span', { class: 'cfg-name mono', text: verb }),
      h('div', { class: 'row wrap' }, bindings.length === 0
        ? h('span', { class: 'hint muted', text: 'nothing does this' })
        : bindings.map((b) => h('span', {
          class: `ctl-chip mono${deadReason(shape, b) ? ' dead' : ''}`, text: b.raw,
        }))));
    if (ro) return row;
    // The whole row opens, because the whole row lights up.
    row.onclick = () => {
      S.controlsVerb = open ? null : key;
      S.controlsKey = null;
      render();
    };
    return open
      ? h('div', { class: 'ctl-open' }, row, verbEditor(who, verb, bindings))
      : row;
  };

  // What is open under a verb: a row per binding with its own ···, then the
  // three ways to add one. Clicks stop here — the row above opens and closes
  // on a click, and a press on a field inside it must not close it.
  const verbEditor = (who, verb, bindings) => {
    const write = (next) => commit(setBindings(S.open.content, who, verb, next));
    const raws = bindings.map((b) => b.raw);
    const swap = (i, raw) => write(raws.map((r, at) => (at === i ? raw : r)));

    const bindingRow = (b, i) => {
      // A button with a word on it: the two that are not are the whole-screen
      // one and the four the shape draws as arrows.
      const drawn = (b.kind === 'touch' || b.kind === 'toggle')
        && b.name !== 'screen' && !isArrow(b.name);
      const why = deadReason(shape, b);
      const name = drawn ? h('input', {
        class: 'cfg-text ctl-name',
        onchange: (e) => {
          const typed = e.currentTarget.value.trim().replace(/\s+/g, '-');
          if (typed) swap(i, `${b.kind}:${typed}`);
          else e.currentTarget.value = b.name;
        },
      }) : null;
      if (name) name.value = b.name;
      return h('div', { class: 'ctl-binding row' },
        h('span', { class: `ctl-chip mono${why ? ' dead' : ''}`, text: b.raw }),
        name,
        // A drawn button can latch: tap on, tap off, held in between. Only a
        // drawn one — a key or a pad button stays momentary, which is what
        // keeps the desktop feel the same.
        drawn ? h('label', { class: 'row hint' },
          h('input', {
            type: 'checkbox', checked: b.kind === 'toggle',
            onchange: (e) => swap(i, `${e.currentTarget.checked ? 'toggle' : 'touch'}:${b.name}`),
          }),
          h('span', { text: 'it latches' })) : null,
        h('span', { class: 'hint muted', text: why ?? sayBinding(b) }),
        h('div', { class: 'spacer' }),
        more(`binding:${who}:${verb}:${i}`, [{
          text: 'Take it out',
          onPick: () => write(raws.filter((_, at) => at !== i)),
        }], { label: `More about ${b.raw}` }));
    };

    const listening = S.controlsKey === `${who}/${verb}`;
    const screen = screenOptions(shape);
    const editor = h('div', { class: 'ctl-editor' },
      ...bindings.map(bindingRow),
      h('div', { class: 'row wrap ctl-adds' },
        // A key is pressed rather than picked out of a list of a hundred:
        // pressing the one you mean is the whole question. The listener is
        // installed by the click and takes itself off with the first key, so
        // nothing is watching the keyboard the rest of the time.
        h('button', {
          class: `quiet tiny${listening ? ' on' : ''}`,
          text: listening ? 'Press the key now — or Esc' : '+ A key',
          onclick: () => {
            if (listening) { S.controlsKey = null; render(); return; }
            S.controlsKey = `${who}/${verb}`;
            const asked = S.open.path;
            render();
            const heard = (e) => {
              window.removeEventListener('keydown', heard, true);
              // A second click on the button called it off, and a key pressed
              // afterwards belongs to whatever has the focus. The file is
              // checked too: without it a key pressed after leaving for
              // another game would be written into that game's own bindings.
              if (S.controlsKey !== `${who}/${verb}` || S.open?.path !== asked) return;
              e.preventDefault();
              S.controlsKey = null;
              const name = e.key === 'Escape' ? null : keyNameFor(e.key);
              if (name) write([...raws, `key:${name}`]);
              else render();
            };
            window.addEventListener('keydown', heard, true);
          },
        }),
        pickOne('+ A controller button', PAD_NAMES.map((n) => ({ value: `pad:${n}`, label: n })),
          (value) => write([...raws, value])),
        screen.length === 0
          ? h('span', { class: 'hint muted', text: 'This shape draws nothing to press.' })
          : pickOne('+ Something on the screen', screen, (value) => {
            // A drawn button's name starts as the verb's own word, which is
            // what a player would expect to read on it.
            write([...raws, value.endsWith(':') ? `${value}${verb.toUpperCase()}` : value]);
          })));
    editor.onclick = (e) => e.stopPropagation();
    return editor;
  };

  const playerBlock = (player) => h('div', { class: 'cfg-group' },
    h('div', { class: 'cfg-group-head' },
      h('span', { class: 'cfg-name mono', text: player.who }),
      h('span', {
        class: 'hint muted',
        text: player.who === 'player1'
          ? 'the keyboard, the first controller, and the screen'
          : 'the keyboard and the second controller — the screen is player 1\'s',
      })),
    h('div', { class: 'cfg-group-body' }, player.verbs.map((v) => verbRow(player.who, v))));

  // The two knobs a drawn shape has. Written the first time one is used: a
  // file seeded for a shape without them never declared them, and input.js
  // reads "right" and 0.35 for itself until one is there.
  const knobs = [];
  if (hasSide(shape)) {
    knobs.push(h('label', { class: 'cfg-row' },
      h('span', { class: 'cfg-name mono', text: 'BUTTON_SIDE' }),
      ro ? h('span', { class: 'mono hint', text: model.side ?? 'right' }) : pickOne(
        model.side === 'left' ? 'on the left' : 'on the right',
        [{ value: 'right', label: 'on the right' }, { value: 'left', label: 'on the left' }],
        (value) => commit(setKnob(S.open.content, 'BUTTON_SIDE', JSON.stringify(value))),
      ),
      h('span', { class: 'hint muted', text: 'which thumb the buttons are under; whatever moves the player takes the other' })));
  }
  if (hasDeadzone(shape)) {
    const field = h('input', {
      type: 'number', step: '0.05', min: '0', max: '0.95', class: 'cfg-num',
      disabled: ro,
      onchange: (e) => {
        const typed = Number(e.currentTarget.value);
        if (!Number.isFinite(typed) || typed < 0 || typed > 0.95) {
          e.currentTarget.value = String(model.deadzone ?? 0.35);
          return;
        }
        commit(setKnob(S.open.content, 'STICK_DEADZONE', String(typed)));
      },
    });
    field.value = String(model.deadzone ?? 0.35);
    knobs.push(h('label', { class: 'cfg-row' },
      h('span', { class: 'cfg-name mono', text: 'STICK_DEADZONE' }),
      field,
      h('span', { class: 'hint muted', text: 'how far a stick leans before it counts as pushed — small drifts on its own, big feels stiff' })));
  }

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
      ...knobs,
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'What each player does' }),
        h('span', { class: 'hint muted', text: 'press one to change what does it — the word on the left is the game\'s own, and its code asks for it by name' })),
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
