// The game types: what a template grows into once the studio knows what a
// game *is*. A type decides which editors the centre pane offers — a mode
// each, taking the whole pane the way the chat does — and this is the one
// place they are registered, so a second editor for a type, or a type with
// four, is one entry each. The type itself is `projects.type`, set at
// creation from the template and never a file in the tree (spec.md §3); the
// templates' index.json stays the manifest of what a type starts from.
//
// Around the editors sit the modes every game has (spec.md §6): the chat
// first, then pictures, sounds, controls, the tree, the versions and the
// public face. `modesFor` is the row over the centre, in order.
//
// ⚠️ The **buttons are named for the senses** — Speak, See, Hear, Touch,
// Taste, Recall, Smell — and the code is not: every id, every comment and
// every route says chat, pics, hear, controls, code, versions and share, and
// so does the preamble a helper reads. Same split the studio already keeps
// between *helper* and `agent` (CLAUDE.md), and deliberate: it is here to be
// tried on the people who use the studio, and a word on a pill is the cheap
// half to change. ⚠️ Which means a helper will still say "open Controls" to
// somebody looking at a button that says Touch — the known price of trying
// it, and the first thing to fix if the names stay.

import { renderStoryEditor } from './story-form.js';
import { renderQuizEditor } from './quiz-form.js';
import { renderAdventureEditor } from './adventure-form.js';

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
  adventure: {
    editors: [{
      id: 'adventure',
      label: 'Scenes',
      what: 'Every scene and the spots on its picture — draw a box to make one, no code needed',
      render: renderAdventureEditor,
    }],
  },
};

// The editors a project of this type brings, in row order. A free-form game —
// null type, or one the studio has no entry for — brings none.
export const editorsFor = (type) => GAME_TYPES[type]?.editors ?? [];

// ⚠️ `what` is doing more work than a tooltip usually does: Smell, Taste and
// Recall say nothing about what is behind them, so the words under the pointer
// are the whole of the explanation. Keep them saying what the surface holds.
const CHAT_MODE = { id: 'chat', label: 'Speak', what: 'Talk with the people and helpers in this game' };
const PICS_MODE = { id: 'pics', label: 'See', what: 'Every picture in the game, by what it is' };
const HEAR_MODE = { id: 'hear', label: 'Hear', what: 'The sounds and the music' };
const CONTROLS_MODE = {
  id: 'controls', label: 'Touch', what: 'How the game is held, and what each button does',
};
const CODE_MODE = { id: 'code', label: 'Taste', what: 'Every file in the game — the code itself' };
const VERSIONS_MODE = {
  id: 'versions', label: 'Recall', what: 'Every past version of this game, and a way back to one',
};
const SHARE_MODE = {
  id: 'share', label: 'Smell', what: 'The link people play it on, the scoreboard and the achievements',
};

// The row of modes over a project's centre pane. A chat project is one room
// and has only the chat; a game has the chat, its type's editors, then Pics,
// Hear, Controls, Code, Versions and Share. Controls sits after the two that
// are about what a game is made of and before the tree, because it is about
// how the game is played rather than what is in it. The order is the old
// one — the labels moved, the row did not.
export const modesFor = (project) => (!project || project.kind === 'chat'
  ? [CHAT_MODE]
  : [
    CHAT_MODE, ...editorsFor(project.type),
    PICS_MODE, HEAR_MODE, CONTROLS_MODE, CODE_MODE, VERSIONS_MODE, SHARE_MODE,
  ]);
