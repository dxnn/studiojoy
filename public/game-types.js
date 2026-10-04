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

import {
  renderStoryEditor, renderStoryInspector, loadStory, parkStory, saveStory, storyChanged,
  selectScene, dropStageImages,
} from './story-form.js';
import { renderQuizEditor } from './quiz-form.js';
import {
  renderAdventureEditor, renderAdventureInspector, loadAdventure, parkAdventure, saveAdventure,
  adventureChanged, selectAdventureScene, dropAdventureSizes,
} from './adventure-form.js';
import {
  renderTrackEditor, renderTrackInspector, loadTrack, parkTrack, trackChanged,
} from './track-form.js';
import {
  renderWorldEditor, renderWorldInspector, loadWorld, parkWorld, worldChanged,
} from './world-form.js';
import { isWorldPath } from './world-editor.js';
import {
  renderLevelEditor, renderLevelInspector, loadLevel, parkLevel, levelChanged,
  levelView, selectLevel,
} from './level-form.js';
import { isLevelPath } from './level-editor.js';
import { isStoryPath } from './story-editor.js';
import { isAdventurePath } from './adventure-editor.js';
import { isTrackPath } from './track-editor.js';
import { renderGameDesign, loadDesign, designChanged } from './game-design-form.js';
import { DESIGN_FILE } from './game-design.js';
import { S } from './main.js';

// Beyond `render`, an editor over a file of its own says how the studio
// carries it, and main.js, stream.js and files-tab.js ask every editor the
// game's type brings rather than naming any (ideas/modularity.md):
//
//   isPath(p)      the file is this editor's — a change to it is `changed`,
//                  and under Code it opens as plain text only
//   load()         read it into the editor's state, on opening the game
//   park()         keep unsaved work aside on leaving the game
//   saveDirty(opts)  write it if there is unsaved work, on leaving a mode, the
//                  game or the page — only an editor that saves itself has
//                  one; the rest keep their own button and are parked
//   changed()      the file changed on disk
//   reset()        the game is being left: its state, and anything cached
//   inspector()    the rail, while this editor is showing
//   view / applyView(v)  the one thing it adds to the address — a scene —
//                  and landing on it; `applyView(null)` is the first
//   viewParam      that thing's name in the address and in the preview's,
//                  when it is not `scene`: the level editor's is `level`
//
// ⚠️ Every hook reads its module's bindings when called, never when this
// table is built: those modules import main.js, which imports this one.
// A scene's key in the address, unless it is the first: a link to a story
// means its front door.
const sceneView = (st) => {
  const first = st?.model?.scenes[0]?.key;
  return st?.scene && st.scene !== first ? st.scene : null;
};

export const GAME_TYPES = {
  // Not a template: a game born in Game Design, until Make it gives it one
  // (server/design.js). Its one editor is the cards, over SPEC.md.
  design: {
    editors: [{
      id: 'design',
      label: 'Game Design',
      what: 'A few questions before anything is built, and then how it is made',
      render: renderGameDesign,
      isPath: (p) => p === DESIGN_FILE,
      load: () => loadDesign(),
      changed: () => designChanged(),
      reset: () => { S.design = null; },
    }],
  },
  'visual-novel': {
    editors: [{
      id: 'story',
      label: 'Write',
      what: 'The whole story as scenes and lines — no code needed',
      render: renderStoryEditor,
      isPath: (p) => isStoryPath(p),
      load: () => loadStory(),
      park: () => parkStory(),
      saveDirty: (opts) => (S.story?.dirty ? saveStory(opts) : null),
      changed: () => storyChanged(),
      reset: () => { S.story = null; dropStageImages(); },
      inspector: () => renderStoryInspector(),
      view: () => sceneView(S.story),
      applyView: (scene) => selectScene(scene ?? S.story?.model?.scenes[0]?.key),
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
      isPath: (p) => isAdventurePath(p),
      load: () => loadAdventure(),
      park: () => parkAdventure(),
      saveDirty: (opts) => (S.adventure?.dirty ? saveAdventure(opts) : null),
      changed: () => adventureChanged(),
      reset: () => { S.adventure = null; dropAdventureSizes(); },
      inspector: () => renderAdventureInspector(),
      view: () => sceneView(S.adventure),
      applyView: (scene) => selectAdventureScene(scene ?? S.adventure?.model?.scenes[0]?.key),
    }],
  },
  racing: {
    editors: [{
      id: 'track',
      label: 'Track',
      what: 'The track, drawn by dragging its points, and what sits on the road — no code needed',
      render: renderTrackEditor,
      isPath: (p) => isTrackPath(p),
      load: () => loadTrack(),
      // Saved on its own button, so what is unsaved is parked whole.
      park: () => parkTrack(),
      changed: () => trackChanged(),
      reset: () => { S.track = null; },
      inspector: () => renderTrackInspector(),
    }],
  },
  knockdown: {
    editors: [{
      id: 'world',
      label: 'World',
      what: 'Everything in the world — drag crates, stone and targets about, no code needed',
      render: renderWorldEditor,
      isPath: (p) => isWorldPath(p),
      load: () => loadWorld(),
      // Saved on its own button, like the track, so what is unsaved is parked.
      park: () => parkWorld(),
      changed: () => worldChanged(),
      reset: () => { S.world = null; },
      inspector: () => renderWorldInspector(),
    }],
  },
  rollball: {
    editors: [{
      id: 'level',
      label: 'Level',
      what: 'The maze from above — paint walls, holes, coins, the start and the goal, no code needed',
      render: renderLevelEditor,
      isPath: (p) => isLevelPath(p),
      load: () => loadLevel(),
      // Saved on its own button, like the track, so what is unsaved is parked.
      park: () => parkLevel(),
      changed: () => levelChanged(),
      reset: () => { S.level = null; },
      inspector: () => renderLevelInspector(),
      viewParam: 'level',
      view: () => levelView(),
      applyView: (n) => selectLevel(n),
    }],
  },
};

// Every editor any type brings, for the studio's own bookkeeping — leaving a
// game resets them all, whatever the game being left was.
export const allEditors = () => Object.values(GAME_TYPES).flatMap((t) => t.editors);

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
// one — the labels moved, the row did not. A game in Game Design has no
// Controls: how it is held is one of the cards, and Make it writes the file.
export const modesFor = (project) => (!project || project.kind === 'chat'
  ? [CHAT_MODE]
  : [
    CHAT_MODE, ...editorsFor(project.type),
    PICS_MODE, HEAR_MODE, project.type === 'design' ? null : CONTROLS_MODE,
    CODE_MODE, VERSIONS_MODE, SHARE_MODE,
  ].filter(Boolean));
