// The arc at the top of Building (spec.md §6, ideas/doneness.md): the stamps
// this game holds, the next one to earn — its principle, what makers say, the
// checks the studio ticks from the tree, and the things to ask the builder for
// — and the one button that earns it. The stamp is the person's call; the
// checks are hints, never gates. Folds to its row of dots per game (prefs), so
// a room being used for talking is not crowded by it.
//
// In the studio's own voice: cyan for an earned stamp and never gold, because
// a stamp is not a number.

import { h } from './dom.js';
import {
  S, api, say, render, prefs, frozen, more, isChat,
} from './main.js';
import { arcFor, checks } from './arc.js';
import { askBuilder } from './chats.js';

const key = () => `arc-${S.slug}`;
const folded = () => prefs.get(key(), 'open') === 'closed';

async function setStage(stage) {
  const res = await api('POST', `/api/projects/${S.slug}/stage`, { stage });
  if (!res.ok) { say(res.body?.error ?? 'Could not change that.', true); return; }
  S.project.stage = stage;
  render();
}

export function renderArcCard(p) {
  // Games only, and only in the builder's room: the arc is a list of things to
  // ask for, and Building is where asking happens.
  if (isChat() || !S.chat?.builder) return null;
  const arc = arcFor(p.type);
  const stage = Math.min(p.stage ?? 0, arc.length);
  const next = arc[stage] ?? null;
  // A done game has nothing left to guide, so the card goes — and the last
  // stamp's take-back with it, which is the price, and accepted.
  if (!next) return null;
  const editor = !frozen();
  const shut = folded();

  const dots = h('div', { class: 'arc-dots', 'aria-label': `${stage} of ${arc.length} stamps` },
    arc.map((s, i) => h('span', {
      class: `arc-dot${i < stage ? ' earned' : ''}`, title: s.name, text: i < stage ? '●' : '○',
    })));
  // The head is the fold: the same control, its caret flipped, as the sidebar's
  // groups.
  const head = h('button', {
    class: `arc-head${shut ? '' : ' open'}`,
    'aria-expanded': shut ? 'false' : 'true',
    title: shut ? 'Show the arc' : 'Fold the arc away',
    onclick: () => { prefs.set(key(), shut ? 'open' : 'closed'); render(); },
  },
  dots,
  // "Step 3: It loops!" — the number is this stamp's place in the arc, written
  // here rather than typed into its name (public/arc.js), so the words are
  // free to change and a stamp can move. `data-stamp` is the same identity in
  // a form a test can hold, since the words are not one.
  h('span', { class: 'arc-next', 'data-stamp': next.id, text: `Step ${stage + 1}: ${next.name}` }),
  h('span', { class: 'caret', text: shut ? '▾' : '▴' }));
  // One way backwards, for a press by mistake; absent for anybody who may not
  // press it, and with nothing to take back.
  const menu = editor && stage > 0
    ? more(`arc:${S.slug}`, [
      { text: 'Take the last stamp back', title: `Un-earn “${arc[stage - 1].name}”`, onPick: () => setStage(stage - 1) },
    ], { label: 'More about the arc' })
    : null;

  let body = null;
  if (!shut) {
    const ticks = checks(next, { files: S.files ?? [], project: p });
    body = h('div', { class: 'arc-body' },
      h('div', { class: 'arc-principle', text: next.principle }),
      h('div', { class: 'arc-makers muted', text: next.makers }),
      ticks.length
        ? h('ul', { class: 'arc-checks' }, ticks.map((t) => h('li', { class: t.ok ? 'ok' : null },
          h('span', { class: 'arc-tick', text: t.ok ? '✓' : '○' }), t.text)))
        : h('div', { class: 'arc-checks muted', text: 'Nothing to tick here — this one is yours to judge.' }),
      editor ? h('div', { class: 'arc-actions' },
        h('span', { class: 'muted', text: 'Ask the builder:' }),
        next.asks.map((a) => h('button', {
          class: 'tiny', text: a.label, title: 'Puts the request in the box below — change it, or send it as it is',
          onclick: () => askBuilder(a.text),
        })),
        h('div', { class: 'spacer' }),
        // The studio's ordinary button size, not `tiny`: this is the one
        // button on the card a kid presses on a phone, and a thumb wants 32px
        // (test/ui/arc-card.ui.js). The asks beside it stay small — a row of
        // them at full size would push the earn button off the line.
        h('button', {
          class: 'filled', text: 'This one’s done ✓', title: `Give the game its “${next.name}” stamp`,
          onclick: () => setStage(stage + 1),
        })) : null);
  }
  return h('div', { class: 'arc' }, h('div', { class: 'arc-bar' }, head, menu), body);
}
