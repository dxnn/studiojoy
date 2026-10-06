// The tweaks beside the preview, over the DOM stand-in (spec/ §6, §17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { install, all, element } from './dom-stand-in.js';

// ⚠️ Before main.js, which reads `document` on the way in.
const root = install();

// The one file the tweaks read: a game's config/play.js.
const PLAY = `// How the game plays.
const PLAY = {
  LIVES: 3, // how many times you can be hit
};
`;
globalThis.fetch = async () => ({
  ok: true, status: 200, headers: new Headers(), text: async () => PLAY,
});

const { S } = await import('../public/main.js');
const { renderTweaks } = await import('../public/tweaks.js');

test('a number left is lit in place, not by a render that takes the button being pressed', async () => {
  S.project = {
    slug: 'tank', can_edit: true, archived: false, type: null, agents: [],
  };
  S.slug = 'tank';
  S.files = [{ path: 'config/play.js', mime: 'text/javascript', size: PLAY.length, text: true }];
  renderTweaks();
  // The file is read on the first render and the fields come on the next.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  const field = all(renderTweaks()).find((n) => n.attrs.id === 'tweak.config/play.js.PLAY.LIVES');
  assert.ok(field, 'LIVES is a field');

  // A number is left by pressing something else — Save, Undo — and its change
  // arrives between that press and its release. A render then replaces the
  // button under the pointer, and the click never happens.
  const onScreen = element('div');
  root.replaceChildren(onScreen);
  field.value = '5';
  field.handlers.get('change')({ currentTarget: field });
  assert.equal(root.children[0], onScreen, 'leaving a number did not render');
});
