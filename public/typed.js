// A field that commits when it is left rather than as it is typed — a name
// that becomes a key, spaces turned to dashes or underscores — and so holds
// the old value in the model until then (spec.md §17).
//
// ⚠️ A render taking such a field away mid-word fires its change and then its
// blur — Chrome, synchronously, while it is still in the page — so a field
// that committed on change was renamed to half a word by any background
// render, and an emptied one came back as its stand-in: a new mood read
// "mood" again when its own autosave landed. What is typed waits here
// instead, shown again by the rebuilt field while it still stands for the
// value it was typed over, in the same game. The change and the blur are
// looked at once the render is over: a field that came straight back under
// the fingers was a render, not somebody leaving. And a field rebuilt
// mid-word sends no change when it is left — nobody typed in *it* — which is
// why leaving it commits too.
//
// Returns the value to show and the three handlers to put on the input.

import { S } from './main.js';

let typing = null;

export function typedField(id, from, commit) {
  const slug = S.slug;
  const held = typing?.id === id && typing.slug === slug && typing.from === from;
  const left = (e) => {
    const el = e.currentTarget;
    setTimeout(() => {
      if (typing?.id !== id || typing.slug !== S.slug) return;
      if (!el.isConnected && document.activeElement?.id === id) return;
      const { text } = typing;
      typing = null;
      commit(text);
    });
  };
  return {
    value: held ? typing.text : from,
    on: {
      oninput: (e) => { typing = { id, slug, from, text: e.currentTarget.value }; },
      onchange: left,
      onblur: left,
    },
  };
}
