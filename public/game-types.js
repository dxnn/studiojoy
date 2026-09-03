// The game types: what a template grows into once the studio knows what a
// game *is*. A type decides which editors the centre pane offers — a mode
// each, taking the whole pane the way the chat does — and this is the one
// place they are registered, so a second editor for a type, or a type with
// four, is one entry each. The type itself is `projects.type`, set at
// creation from the template and never a file in the tree (spec.md §3); the
// templates' index.json stays the manifest of what a type starts from.
//
// Around the editors sit the modes every game has (spec.md §6): Chat first,
// then Pics, Hear, Code and Share. `modesFor` is the row over the centre, in
// order.

import { renderStoryEditor } from './story-form.js';
import { renderQuizEditor } from './quiz-form.js';

export const GAME_TYPES = {
  'visual-novel': {
    editors: [{
      id: 'story',
      label: 'Write',
      what: 'The whole story as scenes and lines — no code needed',
      render: renderStoryEditor,
    }],
  },
  quiz: {
    editors: [{
      id: 'quiz',
      label: 'Questions',
      what: 'Every question, its answers and the endings — no code needed',
      render: renderQuizEditor,
    }],
  },
};

// The editors a project of this type brings, in row order. A free-form game —
// null type, or one the studio has no entry for — brings none.
export const editorsFor = (type) => GAME_TYPES[type]?.editors ?? [];

const CHAT_MODE = { id: 'chat', label: 'Chat', what: 'Talk with the people and helpers in this game' };
const PICS_MODE = { id: 'pics', label: 'Pics', what: 'Every picture in the game, by what it is' };
const HEAR_MODE = { id: 'hear', label: 'Hear', what: 'The sounds and the music' };
const CODE_MODE = { id: 'code', label: 'Code', what: 'Every file in the game' };
const SHARE_MODE = {
  id: 'share', label: 'Share', what: 'The link, the versions, the scoreboard and the achievements',
};

// The row of modes over a project's centre pane. A chat project is one room
// and has only the chat; a game has the chat, its type's editors, then Pics,
// Hear, Code and Share.
export const modesFor = (project) => (!project || project.kind === 'chat'
  ? [CHAT_MODE]
  : [CHAT_MODE, ...editorsFor(project.type), PICS_MODE, HEAR_MODE, CODE_MODE, SHARE_MODE]);
