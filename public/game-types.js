// The game types: what a template grows into once the studio knows what a
// game *is*. A type decides which editors the centre pane offers beside the
// chats — a tab each, taking the whole pane the way a chat does — and this is
// the one place they are registered, so a second editor for a type, or a type
// with four, is one entry each. The type itself is `projects.type`, set at
// creation from the template and never a file in the tree (spec.md §3); the
// templates' index.json stays the manifest of what a type starts from.

import { renderStoryEditor } from './story-form.js';

export const GAME_TYPES = {
  'visual-novel': {
    editors: [{
      id: 'story',
      label: 'Story',
      what: 'The whole story as scenes and lines — no code needed',
      render: renderStoryEditor,
    }],
  },
};

// The editors a project of this type brings, in tab order. A free-form game —
// null type, or one the studio has no entry for — brings none.
export const editorsFor = (type) => GAME_TYPES[type]?.editors ?? [];
