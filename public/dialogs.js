// Every dialog in the studio, behind one dialogFor(S.dialog). A dialog is a
// decision in progress: the address is held while one is open (see syncUrl),
// and the actions a dialog fires live in main.js — this file is the questions.

import { h } from './dom.js';
import { SIZES, MAX_SIDE, clampSide } from './pixel-editor.js';
import {
  SOUND_DIR, IMAGE_DIR, SPRITE_DIR, uploadPlan, uploadFiles, openUpload, assetPath, writeFiles,
} from './upload.js';
import {
  S, api, say, send, render, urlAs, openProject, loadProjects, loadAgents, frozen,
} from './main.js';
import { syncAttached, attachAgent, createChat } from './chats.js';
import {
  openFile, saveOpenFile, saveAndClose, createFile, renameFile, duplicateFile,
  deleteFile, setAuthors, setOpenEdit, setPublished, copyFileTo, LIBRARY_DIR,
  shareArt, unshareArt, RESERVED_IMAGES, DRESSING,
} from './files.js';
import { restore, rollback } from './history.js';
import { createPicture, createPictureAt } from './drawing.js';
import { createSound } from './sound-editor.js';
import { loadStudio, studioChange } from './people.js';
import { clearScores } from './scoreboard.js';
import { editorsFor } from './game-types.js';
import { STORY_FILE, discardStory, saveStory } from './story-form.js';
import { renderShelfDialog, artCredit, asPng } from './story-guide.js';
import { ACHIEVEMENTS_FILE } from './achievements-editor.js';
import { discardAchievements, saveAchievements } from './achievements-form.js';

/* Render: dialogs -------------------------------------------------------- */

const inLibrary = (path) => path === LIBRARY_DIR || path.startsWith(`${LIBRARY_DIR}/`);

// One way in, out of several: a big name and a line saying what it does. Three
// dialogs ask this shape of question — which kind of file, which dressing, and
// how that dressing is made — so the button they ask it with is one thing.
const choice = (label, what, onclick) => h('button', { class: 'choice', onclick },
  h('span', { class: 'cname', text: label }),
  h('span', { class: 'cwhat', text: what }));

// What a new name will mean. Crossing into or out of `studio/` is the one move
// that changes who may edit the file rather than only where it lives — helpers
// read the library and never write it — so that is said in as many words. The
// server allows it either way: it is your tree (spec.md §4).
function renameNote(from, to) {
  if (!to) return 'Type the name you want.';
  if (to === from) return 'That is the name it already has.';
  if (inLibrary(to) && !inLibrary(from)) {
    return `${LIBRARY_DIR}/ is the studio library: your helpers can read it but never `
      + 'change it, so putting this file there means they cannot edit it any more.';
  }
  if (inLibrary(from) && !inLibrary(to)) {
    return 'Out of the studio library, the library buttons will not keep this file '
      + 'up to date any more, and your helpers will be able to change it.';
  }
  return `The game will have to ask for ${to} instead — anything still pointing at `
    + 'the old name needs changing, and your helpers can do that for you.';
}

// A file's name in three pieces — the folder, the name, the ending — so a
// dialog can offer just the middle one. The ending starts at the last dot in
// the name and is never the name's first character: `.gitignore` is a name
// with no ending, not an ending with no name.
function splitName(path) {
  const slash = path.lastIndexOf('/') + 1;
  const dot = path.lastIndexOf('.');
  const cut = dot > slash ? dot : path.length;
  return { dir: path.slice(0, slash), stem: path.slice(slash, cut), ext: path.slice(cut) };
}

// The name a duplicate starts with: `-copy` before the extension, counting up
// past any name already taken, so the dialog never opens on a collision.
function duplicateName(from) {
  const { dir, stem, ext } = splitName(from);
  for (let n = 1; ; n += 1) {
    const to = `${dir}${stem}-copy${n > 1 ? `-${n}` : ''}${ext}`;
    if (!S.files.some((f) => f.path === to)) return to;
  }
}

// Where a piece of shelf art lands as a new file: its own name, slugified
// the way an upload's filename already is (assetPath), counted up past
// whatever is already there so adding one from the shelf never overwrites
// another file that landed on the same name.
function shelfDestination(folder, name) {
  const base = assetPath(folder, `${name}.png`);
  if (!S.files.some((f) => f.path === base)) return base;
  const { dir, stem, ext } = splitName(base);
  for (let n = 2; ; n += 1) {
    const to = `${dir}${stem}-${n}${ext}`;
    if (!S.files.some((f) => f.path === to)) return to;
  }
}

// What picking one off the shelf does, when nothing else is asked of it: a
// face or a thing is a sprite, a picture is one to look at, and the file takes
// the art's own name. What the story editor does instead is name the file the
// story already expects, which is why `place` is still a dialog's to override.
async function shelfPlace(a, blob) {
  const path = shelfDestination(a.kind === 'background' ? IMAGE_DIR : SPRITE_DIR, a.name);
  const { failure } = await writeFiles([{ path, body: blob }]);
  if (failure) { say(failure, true); return; }
  say(artCredit(a, path));
}

// What making the duplicate will mean. Landing it in `studio/` gets the same
// sentence a rename gets, and for the same reason (see renameNote); the rest
// of that note does not apply, because the original keeps its name.
function duplicateNote(from, to) {
  if (!to) return 'Type the name you want.';
  if (to === from) return 'That is the name it already has — the duplicate needs its own.';
  if (inLibrary(to)) {
    return `${LIBRARY_DIR}/ is the studio library: your helpers can read it but never `
      + 'change it, so a duplicate there is one they cannot edit.';
  }
  return `Makes a new file called ${to} holding what ${from} holds now. `
    + `${from} stays as it is.`;
}

export function dialogFor(d) {
  const close = () => { S.dialog = null; render(); };
  const wrap = (title, ...body) => h('div', { class: 'backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'dialog' }, h('h2', { text: title }), ...body));
  const cancel = h('button', { class: 'quiet', text: 'Cancel', onclick: close });
  // Room for a row of sliders. Everything else is a question with one answer
  // and stays narrow.
  const wide = (title, ...body) => {
    const node = wrap(title, ...body);
    node.firstChild.classList.add('wide');
    return node;
  };

  if (d.kind === 'new-project') {
    const chat = d.chat === true;
    const name = h('input', { placeholder: chat ? 'Silly ideas' : 'Space Racer' });
    const err = h('p', { class: 'error' });

    // How the game is held: its control scheme, picked here the way the type
    // is (spec.md §4). Unlike the type it can be changed afterwards, so this
    // is a starting point rather than the last word on it.
    const howHint = h('p', { class: 'hint muted' });
    const how = h('select', {
      onchange: () => { howHint.textContent = how.selectedOptions[0]?.dataset.what ?? ''; },
    });
    // A template that says which shape it is — the quiz and the story are
    // pressed rather than steered — hides the row instead of offering a
    // choice that would be overruled.
    const howRow = h('div', {}, h('label', { text: 'How is it played?' }), how, howHint);

    // A starter tree instead of a blank page. The list arrives after the
    // dialog is built — the node persists, so the options land in place.
    const fromHint = h('p', { class: 'hint muted' });
    const from = h('select', {
      onchange: () => {
        fromHint.textContent = from.selectedOptions[0]?.dataset.what ?? '';
        howRow.hidden = !!from.selectedOptions[0]?.dataset.scheme;
      },
    }, h('option', { value: '', text: 'A blank page' }));
    if (!chat) {
      send('/game-templates/index.json').then(async (res) => {
        if (!res.ok) return;
        const { templates } = await res.json();
        for (const [key, t] of Object.entries(templates ?? {})) {
          const option = h('option', { value: key, text: t.title });
          option.dataset.what = t.what;
          // The file the new game opens on: the one a person edits to change
          // the game. A template with an editor of its own puts you in it.
          if (t.heart) option.dataset.heart = t.heart;
          // A template that fixes how it is played takes the question away.
          if (t.scheme) option.dataset.scheme = t.scheme;
          from.append(option);
        }
      });
    }
    if (!chat) {
      send('/templates/index.json').then(async (res) => {
        if (!res.ok) return;
        const { offer, families, schemes, default: seeded } = await res.json();
        for (const key of offer ?? []) {
          // An entry naming a family stands for the family: it is offered in
          // the family's own words, and its first manner is what the game
          // starts as. Narrowing that down is the panel's job, because
          // SCHEME is always one concrete shape.
          const family = families?.[key];
          const value = family ? family.of?.[0] : key;
          if (!schemes?.[value]) continue;
          const option = h('option', { value, text: (family ?? schemes[value]).title });
          option.dataset.what = (family ?? schemes[value]).what;
          how.append(option);
        }
        if (seeded && schemes?.[seeded]) how.value = seeded;
        howHint.textContent = how.selectedOptions[0]?.dataset.what ?? '';
      });
    }

    return wrap(chat ? 'New chat' : 'New game',
      h('label', { text: 'What is it called?' }), name,
      chat ? null : h('label', { text: 'Start from' }),
      chat ? null : from,
      chat ? null : fromHint,
      chat ? null : howRow,
      chat ? h('p', { class: 'hint muted', text: 'A chat is just for talking — no files, no game. One room, and you can call helpers into it by name.' }) : null,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => {
          const body = { name: name.value.trim(), kind: chat ? 'chat' : 'game' };
          if (!chat && from.value) body.template = from.value;
          // Nothing sent while the row is away: the template's own is what
          // the server falls back to, and saying it here twice could only
          // disagree with it.
          if (!chat && !howRow.hidden && how.value) body.scheme = how.value;
          const heart = chat ? null : (from.selectedOptions[0]?.dataset.heart ?? null);
          const res = await api('POST', '/api/projects', body);
          if (!res.ok) { err.textContent = res.body?.error ?? 'Could not make that.'; return; }
          close();
          await loadProjects();
          // The answer says which conversation to open on — Building when the
          // starter helper is waiting there, the human-only one otherwise, and
          // for a chat project the one room it has. A new project has nothing
          // remembered about it, so without this a game would land on its
          // front door with nobody in the room.
          //
          // A template also opens where the game is made: a type with an
          // editor opens in that mode — its heart stays in Code's list rather
          // than opening there too, because two surfaces for one file is one
          // too many — and a template with a heart and no editor opens the
          // heart under Code, the quiz's form. Both steps under one hold, or
          // arriving would leave two entries behind and Back would land in
          // the empty half of it.
          const editor = editorsFor(res.body.type)[0]?.id ?? null;
          await urlAs('hold', async () => {
            await openProject(res.body.slug, { view: { chat: res.body.chat?.id, mode: editor } });
            if (heart && !editor) await openFile(heart);
          });
          render();
        },
      })));
  }

  if (d.kind === 'rename') {
    const name = h('input');
    name.value = S.project.name;
    return wrap('Rename game',
      h('label', { text: 'New name' }), name,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Rename',
        onclick: async () => {
          const res = await api('PATCH', `/api/projects/${S.slug}`, { name: name.value.trim() });
          if (!res.ok) { say(res.body?.error ?? 'Could not rename it.', true); return; }
          close();
          await loadProjects();
          // Reopening the game you are already in is not somewhere new to go
          // Back from, even though it does clear the rail.
          await urlAs('replace', () => openProject(S.slug));
        },
      })));
  }

  // The route refuses everybody but the person who made the game, and refuses
  // a published game — the ··· offers this only when both hold, so the
  // refusals here are for a game that changed under the menu. Coming back is
  // Unarchive in the same ···, which asks nothing (spec/ §11).
  if (d.kind === 'archive') {
    const chat = S.project.kind === 'chat';
    return wrap(chat ? 'Archive this chat?' : 'Archive this game?',
      h('p', {
        text: chat
          ? 'Nobody will be able to talk in it any more; what was said stays readable.'
          : 'Nobody will be able to change it or talk in it any more. People can still play it at its address, and its scores stay.',
      }),
      h('p', { class: 'hint muted', text: 'You can unarchive it again whenever you like — it is in the same ··· menu.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Archive it',
        onclick: async () => {
          const res = await api('POST', `/api/projects/${S.slug}/archive`);
          close();
          if (!res.ok) {
            say(res.body?.error ?? 'Could not archive it.', true);
            return;
          }
          // Said now rather than learnt from the refetch: the way out of a
          // game lands its pending commit, and an archived game refuses that.
          S.project.archived = true;
          // Archiving the game you are already in is not somewhere new to go
          // Back from, even though it changes what the bar offers.
          await urlAs('replace', () => openProject(S.slug));
        },
      })));
  }

  // The whole prompt behind a reply's receipt, exactly as it was sent.
  // Look-only, so the one action is Close.
  if (d.kind === 'prompt') {
    return wide('Everything sent to the helper',
      h('pre', { class: 'prompt-text', text: d.text }),
      h('div', { class: 'actions' },
        h('button', { class: 'quiet', text: 'Close', onclick: close })));
  }

  // `rename-file`, not `rename`: the game's own name has owned that one since
  // before this existed, and the two dialogs are a click apart.
  //
  // The box holds just the name to begin with. The folder before it and the
  // ending after it are shown but fixed, so nobody types `.js` to keep it —
  // and typing it anyway does not double it. One link opens the whole path
  // up; that is the mode where a rename is also a move, and what that will
  // mean is said before it happens rather than found out afterwards.
  if (d.kind === 'rename-file') {
    let parts = splitName(d.path);
    let whole = false;
    const path = h('input', { 'aria-label': 'New name' });
    const before = h('span', { class: 'fixed mono' });
    const after = h('span', { class: 'fixed mono' });
    const label = h('label');
    const note = h('div', { class: 'hint muted' });
    const more = h('button', { class: 'link tiny' });
    const rename = h('button', { class: 'filled', text: 'Rename it' });
    // What the file will be called, in either mode.
    const target = () => {
      const typed = path.value.trim();
      if (whole || !typed) return typed;
      const { dir, ext } = parts;
      const stem = ext && typed.length > ext.length && typed.toLowerCase().endsWith(ext.toLowerCase())
        ? typed.slice(0, -ext.length)
        : typed;
      return dir + stem + ext;
    };
    const check = () => {
      const to = target();
      note.textContent = renameNote(d.path, to);
      rename.disabled = !to || to === d.path;
    };
    const show = () => {
      label.textContent = whole ? 'New name (use / for folders)' : 'New name';
      before.textContent = whole ? '' : parts.dir;
      after.textContent = whole ? '' : parts.ext;
      more.textContent = whole ? 'Just the name' : 'Change the folder or the ending too';
      check();
    };
    // The name carries across: opened up, the box shows the whole of it as it
    // stands; closed again, the same name back in pieces.
    more.addEventListener('click', () => {
      const to = target() || d.path;
      whole = !whole;
      if (whole) path.value = to;
      else { parts = splitName(to); path.value = parts.stem; }
      show();
      path.focus();
    });
    path.addEventListener('input', check);
    rename.addEventListener('click', async () => {
      const to = target();
      close();
      await renameFile(d.path, to);
    });
    path.value = parts.stem;
    show();
    return wrap('Rename this file',
      label, h('div', { class: 'name-row' }, before, path, after), note, more,
      h('div', { class: 'actions' }, cancel, rename));
  }

  // Duplicate, to one of three places (spec.md §6): this game (the default),
  // another game, or — for a picture — the studio's collection, where every
  // game's shelf can pick it. `Where to?` picks between them; `Another game`
  // opens a second select for which one. ⚠️ The collection half says whose
  // the picture stays: nothing here asks for a licence and nothing records
  // one, because the studio does not need a grant to show somebody their own
  // drawing (ideas/studio-collection.md).
  if (d.kind === 'duplicate-file') {
    const picture = /\.png$/i.test(d.path);
    const games = S.projects.filter((p) => p.kind !== 'chat' && p.slug !== S.slug && p.can_edit);

    const where = h('select', {},
      h('option', { value: 'here', text: 'This game' }),
      games.length ? h('option', { value: 'game', text: 'Another game' }) : null,
      picture ? h('option', { value: 'studio', text: 'The studio\'s collection — for every game to pick from' }) : null);

    const gameSelect = h('select', {}, games.map((p) => h('option', { value: p.slug, text: p.name })));
    const gameRow = h('div', {}, h('label', { text: 'Which game?' }), gameSelect);

    // The name, in the Rename dialog's own style: just the stem to begin
    // with, folder and ending fixed, until "Change the folder or the ending
    // too" opens the whole path.
    let parts = splitName(d.path);
    let whole = false;
    const path = h('input', { 'aria-label': 'Name for the duplicate' });
    const before = h('span', { class: 'fixed mono' });
    const after = h('span', { class: 'fixed mono' });
    const nameLabel = h('label');
    const note = h('div', { class: 'hint muted' });
    const more = h('button', { class: 'link tiny' });
    const make = h('button', { class: 'filled', text: 'Duplicate it' });
    // The copy is made from the disk, so words still only in the editor are
    // named here rather than quietly left out of it.
    const dirty = S.open?.path === d.path && (S.open.dirty || S.draw?.dirty);

    const target = () => {
      const typed = path.value.trim();
      if (whole || !typed) return typed;
      const { dir, ext } = parts;
      const stem = ext && typed.length > ext.length && typed.toLowerCase().endsWith(ext.toLowerCase())
        ? typed.slice(0, -ext.length)
        : typed;
      return dir + stem + ext;
    };
    const check = () => {
      const to = target();
      if (where.value === 'game') {
        note.textContent = to
          ? 'The bytes are copied as they are now. The two games stay strangers — this one keeps its file, and neither one hears about the other again.'
          : 'Type the name you want.';
        make.disabled = !to;
      } else {
        note.textContent = duplicateNote(d.path, to);
        make.disabled = !to || to === d.path;
      }
    };
    const show = () => {
      nameLabel.textContent = whole ? 'Name it (use / for folders)' : 'Call it';
      before.textContent = whole ? '' : parts.dir;
      after.textContent = whole ? '' : parts.ext;
      more.textContent = whole ? 'Just the name' : 'Change the folder or the ending too';
      check();
    };
    // The name carries across: opened up, the box shows the whole of it as
    // it stands; closed again, the same name back in pieces.
    more.addEventListener('click', () => {
      const to = target() || d.path;
      whole = !whole;
      if (whole) path.value = to;
      else { parts = splitName(to); path.value = parts.stem; }
      show();
      path.focus();
    });
    path.addEventListener('input', check);
    // Switching destination gives the name field its own default again: the
    // free `-copy` name here, the file's own name unchanged into another game.
    const setName = (to) => {
      parts = splitName(to);
      whole = false;
      path.value = parts.stem;
      show();
    };

    const nameRow = h('div', {},
      nameLabel, h('div', { class: 'name-row' }, before, path, after), note, more,
      dirty ? h('p', { class: 'hint muted', text: 'Your unsaved changes stay here — the duplicate is of the last save.' }) : null);

    // Into the collection: what it is called there, what kind, and for a
    // face whose — which only suggests the file name it lands under when
    // picked, the way the shipped set's faces do. Left empty it is still
    // offered.
    const label = h('input');
    label.value = d.path.split('/').pop().replace(/\.png$/i, '').replace(/[-_]+/g, ' ');
    const kind = h('select', {},
      h('option', { value: 'portrait', text: 'A face — somebody in a story' }),
      h('option', { value: 'background', text: 'A place — somewhere a story happens' }));
    const who = h('input');
    who.placeholder = 'optional';
    const whoRow = h('div', {},
      h('label', { text: 'Who is it, in one word?' }), who,
      h('p', { class: 'hint muted', text: 'Only used to suggest a file name — "dragon" makes dragon-normal.png.' }));
    const studioFields = h('div', {},
      h('label', { text: 'What is it called?' }), label,
      h('label', { text: 'What kind of picture?' }), kind,
      whoRow,
      h('p', { class: 'hint muted', text: 'Every game in the studio can pick it from the shelf, and it will say you made it. It stays yours — the studio is not asking for it, and you can take it out again whenever you like.' }));
    const err = h('p', { class: 'error' });

    const sync = () => {
      gameRow.hidden = where.value !== 'game';
      nameRow.hidden = where.value === 'studio';
      studioFields.hidden = where.value !== 'studio';
      whoRow.hidden = kind.value !== 'portrait';
      if (where.value === 'studio') make.disabled = false;
      else check();
    };
    where.addEventListener('change', () => {
      setName(where.value === 'here' ? duplicateName(d.path) : d.path);
      sync();
    });
    kind.addEventListener('change', sync);
    setName(duplicateName(d.path));
    sync();

    make.addEventListener('click', async () => {
      if (where.value === 'studio') {
        const called = label.value.trim();
        if (!called) { err.textContent = 'Give it a name.'; return; }
        close();
        await shareArt(d.path, { kind: kind.value, name: called, who: who.value.trim() });
        return;
      }
      const to = target();
      if (!to) { err.textContent = 'Give it a name.'; return; }
      close();
      if (where.value === 'game') await copyFileTo(gameSelect.value, d.path, to);
      else await duplicateFile(d.path, to);
    });

    return wrap('Duplicate this file',
      h('label', { text: 'Where to?' }), where,
      gameRow, nameRow, studioFields, err,
      h('div', { class: 'actions' }, cancel, make));
  }

  // Four ways to put a file in the game, behind the one button above the file
  // list. The names are the ones the agent preamble tells a helper to ask for
  // by — renaming one here means renaming it there.
  if (d.kind === 'add-file') {
    // Hear asks for its own kind — `only` narrows the ways in and what the
    // picker offers; Code asks for any file. Pics used to ask for pictures
    // here and does not any more: uploading, drawing and the shelf are three
    // buttons of its own, because every one of its ways in is a picture and a
    // menu that only ever leads to the same three places is a click in the way.
    const only = d.only ?? null;
    // The picker is what makes uploading work on a tablet, where there is
    // nothing to drag from. It lives in the dialog now, with the button that
    // opens it; the dialog node outlives every render, so it stays connected.
    const picker = h('input', {
      type: 'file', multiple: true, hidden: true,
      accept: only === 'sound' ? 'audio/*' : null,
      onchange: (e) => {
        const files = [...e.currentTarget.files];
        // Cleared so picking the same file twice in a row still fires.
        e.currentTarget.value = '';
        // The upload dialog replaces this one, so there is nothing to close.
        if (files.length) openUpload(files);
      },
    });
    return wrap(only === 'sound' ? 'Add a sound' : 'Add a file',
      h('div', { class: 'choices' },
        only ? null : choice('+ New file', 'An empty file you name yourself — code, notes, anything.',
          () => { S.dialog = { kind: 'new-file' }; render(); }),
        choice('+ Upload',
          only === 'sound' ? 'A sound or a whole track from this device, into assets/.'
            : 'Any file from this device. Pictures and sounds go to assets/.',
          () => picker.click()),
        only === 'sound' ? null : choice('+ Draw a picture', 'A sprite or a backdrop, square by square.',
          () => { S.dialog = { kind: 'draw-new', size: 64, name: 'sprite' }; render(); }),
        // The shelf, as a source for a new file rather than a swap for an
        // existing one — picking copies the bytes in under the art's own
        // name, never over a file already drawn (spec.md §6). Where each kind
        // lands is `shelfPlace`, above, which is also what Pics' one button
        // uses for all three at once.
        only === 'sound' ? null : choice('+ Pick a face from the shelf', `A face from the studio's shelf, into ${SPRITE_DIR}/.`,
          () => { S.dialog = { kind: 'pick-picture', art: 'portrait' }; render(); }),
        only === 'sound' ? null : choice('+ Pick a picture from the shelf', `A picture from the studio's shelf, into ${IMAGE_DIR}/.`,
          () => { S.dialog = { kind: 'pick-picture', art: 'background' }; render(); }),
        // The *big set*: 1,775 CC0 things, found by typing a word rather than
        // by scrolling. Same dialog, same landing folder as a face — a thing
        // is a sprite, and the set's own test keeps every one of them out of
        // the shape the sprites library would animate.
        only === 'sound' ? null : choice('+ Find a thing to put in', `Search the studio's pictures — a fish, a rocket, a dinosaur — into ${SPRITE_DIR}/.`,
          () => { S.dialog = { kind: 'pick-picture', art: 'sprite' }; render(); }),
        // Straight to the sliders. There is nothing to ask first: a sound you
        // have not heard yet cannot be named, and everything else about it is
        // in the pane.
        choice('+ Make a sound', `A .wav from a row of sliders, into ${SOUND_DIR}/.`,
          () => { close(); createSound(); })),
      picker,
      h('div', { class: 'actions' }, cancel));
  }

  // The three pictures a game wears in the studio (spec.md §6). They are the
  // one kind of file whose *name* is what makes it work, so a dialog is the
  // only honest way to offer them: nothing in Pics or Code could tell you that
  // a file called hero.png would end up behind the game's name.
  if (d.kind === 'add-dressing') {
    return wrap('Studio dressing',
      h('p', {
        class: 'hint muted',
        text: 'Three pictures dress a game in the studio. Each one is optional, '
          + 'and the studio knows what each is for by its name.',
      }),
      h('div', { class: 'choices' }, RESERVED_IMAGES.map((path) => choice(
        DRESSING[path].name,
        S.files.some((f) => f.path === path)
          ? `${DRESSING[path].hint} There is one already — this replaces it.`
          : DRESSING[path].hint,
        () => { S.dialog = { kind: 'dressing', path }; render(); },
      ))),
      h('div', { class: 'actions' }, cancel));
  }

  // The second half of that question: drawn here, or from this device. A
  // picture from the device is made a .png whatever it arrived as — the studio
  // looks for these three by name, and a JPEG called hero.png would be a lie
  // the browser happens to forgive.
  if (d.kind === 'dressing') {
    const info = DRESSING[d.path];
    const [width, height] = info.draw;
    const picker = h('input', {
      type: 'file', hidden: true, accept: 'image/*',
      onchange: async (e) => {
        const file = e.currentTarget.files[0];
        e.currentTarget.value = '';
        if (!file) return;
        const body = await asPng(file, info.fit);
        if (!body) { say('The studio could not read that picture.', true); return; }
        close();
        const { failure } = await writeFiles([{ path: d.path, body }]);
        if (failure) { say(failure, true); return; }
        say(`Saved ${d.path}. The game wears it now.`);
      },
    });
    return wrap(info.name,
      h('p', { class: 'hint muted', text: `${info.hint} It is called ${d.path}, at the top of the game's files.` }),
      h('div', { class: 'choices' },
        choice('+ Draw it', `A blank ${width} × ${height} canvas, ready to draw on.`,
          async () => { close(); await createPictureAt(d.path, width, height); }),
        choice('+ Upload one', 'A picture from this device, saved under that name.',
          () => picker.click())),
      picker,
      h('div', { class: 'actions' }, cancel));
  }

  if (d.kind === 'new-file') {
    const path = h('input', { placeholder: 'js/game.js' });
    return wrap('New file',
      h('label', { text: 'Name it (use / for folders)' }), path,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => { close(); await createFile(path.value.trim()); },
      })));
  }

  // Nothing is sent until this is confirmed, so where each file lands is
  // visible before it lands there rather than being something to undo
  // afterwards. Any kind of file: what the studio can show it as is a separate
  // question, answered by MEDIA_KINDS when it is opened.
  if (d.kind === 'upload') {
    // Empty on purpose: each file already knows the folder its kind goes to,
    // and the rows below say so in full. Typing here overrules all of them at
    // once, which is the only thing one box can honestly do for a drop of
    // several kinds.
    const folder = h('input', { placeholder: 'each one goes where its kind goes' });
    const list = h('div', { class: 'plan' });
    const ok = h('button', { class: 'filled', text: 'Add it' });

    const paint = () => {
      const plan = uploadPlan(folder.value.trim(), d.items);
      list.replaceChildren(...plan.map((it) => h('div', {
        class: `plan-row${it.problem ? ' skip' : ''}`,
      },
      h('span', { class: 'mono', text: it.path }),
      h('div', { class: 'spacer' }),
      h('span', { class: 'hint muted', text: it.problem ?? it.note }))));
      ok.disabled = plan.every((it) => it.problem);
    };
    paint();
    folder.addEventListener('input', paint);
    ok.addEventListener('click', async () => {
      const plan = uploadPlan(folder.value.trim(), d.items).filter((it) => !it.problem);
      close();
      await uploadFiles(plan);
    });

    return wrap(d.items.length === 1 ? 'Upload this file' : `Upload ${d.items.length} files`,
      h('label', { text: `Which folder? Sounds go to ${SOUND_DIR}/, pictures to ${IMAGE_DIR}/, film strips to ${SPRITE_DIR}/ — put something here to send them all somewhere else instead.` }), folder,
      list,
      h('div', { class: 'actions' }, cancel, ok));
  }

  // Same shape as the upload dialog: everything it would write is on screen
  // before any of it is sent.
  if (d.kind === 'draw-new') {
    const name = h('input', { placeholder: 'sprite' });
    name.value = d.name;
    const size = h('select', {}, SIZES.map((n) => h('option', { value: n, text: `${n} × ${n}` })));
    size.value = String(d.size);
    // More than one frame makes a film strip: square frames side by side in
    // one file, which the sprites library plays by name.
    const frames = h('select', {}, [1, 2, 3, 4, 6, 8].map((n) => h('option', {
      value: n, text: n === 1 ? 'Just one' : `${n} frames`,
    })));
    const err = h('p', { class: 'error' });
    return wrap('Draw a picture',
      // Naming the unit is the whole point of this line: 32 means the file is
      // 32 pixels across, and a game usually draws a sprite that size much
      // bigger on screen. Picking a number here is picking the real size.
      h('label', { text: 'How big, in real pixels?' }), size,
      h('label', { text: 'Frames, if it should move' }), frames,
      h('label', { text: 'Call it' }), name,
      h('p', { class: 'hint muted', text: 'It starts see-through and lands in assets/ as a .png, exactly this many pixels across. Small numbers are easier to draw square by square; big ones are for backgrounds and title screens. More than one frame makes a film strip the sprites library can play.' }),
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Start drawing',
        onclick: async () => {
          const side = clampSide(size.value);
          const count = Number(frames.value);
          if (side * count > MAX_SIDE) {
            err.textContent = `${count} frames of ${side} is wider than ${MAX_SIDE} pixels — fewer frames, or a smaller size.`;
            return;
          }
          const called = name.value.trim();
          close();
          await createPicture(called, side * count, side);
        },
      })));
  }

  // Who may change this game. The studio's people on one side, this game's
  // authors on the other, and one button between them each way. ⚠️ Only an
  // author sees this at all — being able to work on an open game is not the
  // same as deciding who does.
  // Running the studio: who is in it, what each person's helpers may spend in
  // a day, and the wall around everybody. Only an admin can open it — the
  // button is not drawn for anybody else, and the server refuses regardless.
  //
  // Painted in place for the same reason as the authors dialog: a dialog node
  // outlives every render, so a rebuilt list would never appear.
  if (d.kind === 'studio') {
    const list = h('div', { class: 'plan' });
    const waitBox = h('div', { class: 'col' });
    const budget = h('input', { type: 'number', min: '0', class: 'cfg-num' });
    const box = h('div', { class: 'col' });

    const number = (value) => (value === null || value === undefined ? '' : String(value));
    // Whose row has the new-password field open, if anybody's. One at a time.
    let passwordFor = null;

    const paint = () => {
      const data = S.admin;
      if (!data) { list.replaceChildren(h('div', { class: 'muted', text: 'Reading…' })); return; }
      budget.value = number(data.budget.limit);
      // Every field saves itself the moment it is left — `change`, so a
      // half-typed number is never sent — and the row repaints from the
      // server's answer, so a refused value goes back to what it was. No Save
      // buttons: a panel of rows each wanting its own Save was a form
      // pretending to be a list.
      list.replaceChildren(...data.people.map((person) => {
        const name = h('input', {
          value: person.display_name,
          onchange: () => studioChange('PATCH', `/users/${person.id}`, {
            display_name: name.value.trim(),
          }).then(paint),
        });
        name.value = person.display_name;
        const allowance = h('input', {
          type: 'number', min: '0', class: 'cfg-num',
          placeholder: 'no limit',
          title: 'Tokens this person’s helpers may spend in a day',
          onchange: () => studioChange('PATCH', `/users/${person.id}`, {
            daily_tokens: allowance.value === '' ? null : Number(allowance.value),
          }).then(paint),
        });
        allowance.value = number(person.daily_tokens);
        // The one change that is typed and then set rather than a field saving
        // itself, so it opens in the row — the same button closes it again —
        // and not in a browser prompt box, which some browsers quietly refuse
        // and which gave no sign afterwards of having worked. Setting it ends
        // every session of theirs on both origins (spec.md §6), so the message
        // says so.
        const asking = passwordFor === person.id;
        const secret = asking ? h('input', {
          placeholder: 'A new password they can remember (6 or more)',
          'aria-label': `A new password for ${person.display_name}`,
        }) : null;
        const setPassword = async () => {
          const ok = await studioChange('PATCH', `/users/${person.id}`, { password: secret.value });
          if (!ok) return;
          passwordFor = null;
          paint();
          say(`${person.display_name} has a new password, and is signed out everywhere until they use it.`);
        };
        secret?.addEventListener('keydown', (e) => { if (e.key === 'Enter') setPassword(); });
        // ⚠️ Three buttons, and no Remove. Taking somebody out of the studio
        // is `npm run deluser -- <email>` at a terminal and nothing else — a
        // red button beside Password invites the press, and no click can show
        // what leaving means. There is no route behind it either (spec.md §11).
        return h('div', { class: 'person' },
          name,
          // The address is what they sign in with, and the one thing on the
          // row that tells two people with the same name apart.
          h('span', { class: 'hint muted mono', title: 'Signs in as', text: person.email }),
          h('span', {
            class: 'hint muted mono',
            title: 'Spent today',
            text: `${person.spent_today.toLocaleString()} today`,
          }),
          allowance,
          h('button', {
            class: `quiet tiny${person.admin ? ' on' : ''}`,
            text: person.admin ? 'Admin' : 'Make admin',
            title: person.admin ? 'Can run the studio' : 'Let them run the studio',
            onclick: () => studioChange('PATCH', `/users/${person.id}`, {
              admin: !person.admin,
            }).then(paint),
          }),
          // The toggle between the two kinds of account. Off, they sign in on
          // the games site and their scores wear their name — the studio's
          // door, crew list and games say nothing about them. The server
          // refuses to take the studio from an admin.
          h('button', {
            class: `quiet tiny${person.studio_access ? ' on' : ''}`,
            text: person.studio_access ? 'In the studio' : 'Games only',
            title: person.studio_access
              ? 'Can sign in to the studio — click to make them games-only'
              : 'Plays games and posts scores — click to let them into the studio',
            onclick: () => studioChange('PATCH', `/users/${person.id}`, {
              studio_access: !person.studio_access,
            }).then(paint),
          }),
          h('button', {
            class: `quiet tiny${asking ? ' on' : ''}`,
            text: asking ? 'Keep it' : 'Password',
            title: asking ? 'Leave their password as it is' : 'Give them a new password',
            onclick: () => {
              passwordFor = asking ? null : person.id;
              paint();
              list.querySelector('.person-more input')?.focus();
            },
          }),
          asking ? h('div', { class: 'person-more' },
            secret,
            h('button', { class: 'filled tiny', text: 'Set it', onclick: setPassword })) : null);
      }));
      // The waiting list: who asked to join from the games site. The whole
      // section is only there when somebody is — an empty list would be a
      // question nobody asked. `Let them in` makes a games-only account;
      // the toggle above is how they ever get more.
      waitBox.replaceChildren(...(data.waiting.length ? [
        h('div', { class: 'section-label', text: 'Waiting to join' }),
        ...data.waiting.map((w) => h('div', { class: 'person' },
          h('span', { text: w.display_name }),
          h('span', { class: 'hint muted mono', text: w.email }),
          h('button', {
            class: 'filled tiny', text: 'Let them in',
            title: 'Make them an account that plays games and posts scores',
            onclick: () => studioChange('POST', `/signups/${w.id}/approve`, {}).then(paint),
          }),
          h('button', {
            class: 'quiet tiny', text: 'Turn away',
            title: 'Say no to this one',
            onclick: () => studioChange('POST', `/signups/${w.id}/refuse`, {}).then(paint),
          }))),
      ] : []));
    };

    const email = h('input', { placeholder: 'them@example.com' });
    const who = h('input', { placeholder: 'Their name' });
    const pass = h('input', { placeholder: 'A password they can remember' });
    box.append(
      h('div', { class: 'section-label', text: 'Accounts' }),
      list,
      waitBox,
      h('div', { class: 'section-label', text: 'Add somebody' }),
      h('div', { class: 'person' }, who, email, pass, h('button', {
        class: 'filled tiny', text: 'Add them',
        onclick: async () => {
          const ok = await studioChange('POST', '/users', {
            display_name: who.value.trim(), email: email.value.trim(), password: pass.value,
          });
          if (!ok) return;
          who.value = ''; email.value = ''; pass.value = '';
          paint();
        },
      })),
      h('div', { class: 'section-label', text: 'The whole studio, in a day' }),
      h('div', { class: 'person' },
        budget,
        h('span', { class: 'hint muted', text: 'tokens a day for everybody together' })),
    );
    const saveStudio = () => studioChange('PATCH', '/studio', {
      daily_token_budget: budget.value === '' ? null : Number(budget.value),
    }).then(paint);
    budget.addEventListener('change', saveStudio);

    if (!S.admin) loadStudio().then(paint);
    paint();
    return wide('Studio settings',
      h('p', { class: 'hint muted', text: 'In the studio means reading every game and talking in every “Humans only”; games only means playing and posting scores under their name. A daily limit is how many tokens that person’s helpers may spend; leave it empty for no limit of their own.' }),
      box,
      h('div', { class: 'actions' },
        h('button', { class: 'filled', text: 'Done', onclick: close })));
  }

  // Publishing is one click away in the bar, so the button there is a status
  // and this is where it is actually done. Both ways round: the games page is
  // the only thing either changes — a link to the game has always worked and
  // still will.
  if (d.kind === 'publish') {
    const published = Boolean(S.project.published);
    return wrap(published ? 'Unpublish this game?' : 'Publish this game?',
      h('p', {
        text: published
          ? 'Everybody sees this game on the games page. Unpublish it and only people with the link will find it — the link still works, and the game still plays.'
          : 'The games page is what everybody sees at the games address. Publish this game and it is on it.',
      }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: published ? 'danger' : 'filled',
        text: published ? 'Unpublish it' : 'Publish it',
        onclick: async () => {
          close();
          await setPublished(!published);
        },
      })));
  }

  // Whether the game is open, and then who its editors are — one dialog,
  // because the lock in the bar is the first half of the answer and the names
  // are the second. `editors` in the interface, *authors* in the code and on
  // the wire (GLOSSARY).
  if (d.kind === 'authors') {
    // Painted in place, not through render(): a dialog is built once and
    // re-appended by every later render, so a rebuilt list would never appear.
    // Same reason the sliders and the upload plan paint themselves.
    const list = h('div', { class: 'plan' });
    const paint = () => {
      const authors = S.project.authors ?? [];
      const has = new Set(authors.map((a) => a.id));
      const open = Boolean(S.project.open_edit);
      // Only an editor decides who works on this game — being able to work on
      // it is not the same thing (see server/authors.js). Somebody who is only
      // here because the game is open reads the list and presses nothing.
      const yours = Boolean(S.project.mine);
      // Open or closed first, because it decides whether the names below are
      // the whole answer or only who decides.
      const switchRow = h('div', { class: 'plan-row switch' },
        h('button', {
          class: `act open${open ? ' on' : ''}`,
          disabled: !yours,
          title: open
            ? 'Anybody in the studio can change this game'
            : 'Only the people below can change this game',
          onclick: async () => {
            await setOpenEdit(!open);
            paint();
          },
        }, h('span', { class: 'dot' }), open ? 'Open to everyone' : 'Closed'),
        h('span', {
          class: 'hint muted',
          text: open
            ? 'Anybody in the studio can change it.'
            : 'It wears a lock, and only these people can change it.',
        }));
      const rows = S.people.map((person) => {
        const author = has.has(person.id);
        return h('div', { class: 'plan-row' },
          h('span', { text: person.display_name }),
          person.id === S.me.id ? h('span', { class: 'tag', text: 'you' }) : null,
          h('div', { class: 'spacer' }),
          h('button', {
            class: author ? 'quiet tiny' : 'filled tiny',
            text: author ? 'Remove' : 'Add',
            // The last author cannot go: the server refuses it too, and a
            // button that always answers with a red banner is worse than no
            // button at all.
            disabled: !yours || (author && authors.length <= 1),
            onclick: async () => {
              await setAuthors(author ? 'DELETE' : 'POST', person.id);
              paint();
            },
          }));
      });
      list.replaceChildren(switchRow, ...rows);
    };
    paint();
    return wrap('Editors',
      h('p', { class: 'hint muted', text: 'Anyone in the studio can read this game, play it and talk in \u201cHumans only\u201d. These are the people who can change it.' }),
      list,
      h('div', { class: 'actions' },
        h('button', { class: 'filled', text: 'Done', onclick: close })));
  }

  // A new chat always takes helpers: the one that does not is the one the
  // game was born with.
  if (d.kind === 'new-chat') {
    const name = h('input', { placeholder: 'Art, or Music, or Bug hunt' });
    return wrap('Start another chat',
      h('label', { text: 'What is it about?' }), name,
      h('p', { class: 'hint muted', text: 'A new chat can have helpers in it. The one called “Humans only” never can.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Start it',
        onclick: async () => {
          const called = name.value.trim();
          if (!called) return;
          close();
          await createChat(called);
        },
      })));
  }

  // The + at the right of the chat bar. Everyone in the studio who is not
  // already in this room, one click each — the other way in is to type their
  // name, which the note says, because a button is how you find out that the
  // typing works at all.
  if (d.kind === 'add-helper') {
    const list = h('div', { class: 'plan' });
    const paint = () => {
      const here = new Set((S.project?.agents ?? []).map((a) => a.agent_id));
      const rest = S.agents.filter((a) => !here.has(a.id));
      if (rest.length === 0) {
        list.replaceChildren(h('p', {
          class: 'hint muted',
          text: S.agents.length
            ? 'Every helper in the studio is already in this chat.'
            : 'There are no helpers yet. Make one with + New helper on the Crew tab.',
        }));
        return;
      }
      list.replaceChildren(...rest.map((agent) => h('div', { class: 'plan-row' },
        h('span', { text: agent.name }),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'filled tiny',
          text: 'Add',
          onclick: async () => {
            await attachAgent(agent);
            paint();
          },
        }))));
    };
    paint();
    return wrap('Put a helper in this chat',
      h('p', { class: 'hint muted', text: 'They will answer every message here. You can also call one in while you type — an @ and their name, the same way you call a person.' }),
      list,
      h('div', { class: 'actions' },
        h('button', { class: 'filled', text: 'Done', onclick: close })));
  }

  // A face is already drawn for this mood, so picking one from the shelf
  // would overwrite it in one click — the one confirmation between that
  // button and the shelf grid. An empty mood skips straight to the shelf,
  // because there is nothing there yet to lose.
  if (d.kind === 'replace-face') {
    return wrap(`Replace ${d.person}'s ${d.mood} face?`,
      h('p', { text: 'A face is already drawn for this mood. Picking one from the shelf overwrites it — you can still bring the old one back from Recall.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Replace it', onclick: d.proceed,
      })));
  }

  // The shelf, as a dialog with a filter: the story editor's way to a
  // picture from the standard set or the studio's collection (story-guide.js).
  // `art` names the kind on the shelf, or nothing for all of them at once;
  // `place` is what the story editor overrides, and everybody else takes the
  // one above.
  if (d.kind === 'pick-picture') {
    return renderShelfDialog({ ...d, place: d.place ?? shelfPlace }, { wide, cancel, close });
  }

  // A chat's name. The human-only one keeps its own — it is furniture, and
  // the words the studio uses for it — so the ··· that opens this is only on
  // a chat that takes helpers.
  if (d.kind === 'rename-chat') {
    const name = h('input');
    name.value = d.chat.name;
    return wrap('Rename this chat',
      h('label', { text: 'What is it about?' }), name,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Rename it',
        onclick: async () => {
          const called = name.value.trim();
          if (!called) return;
          close();
          const res = await api('PATCH', `/api/projects/${S.slug}/chats/${d.chat.id}`, { name: called });
          if (!res.ok) say(res.body?.error ?? 'Could not rename that chat.', true);
        },
      })));
  }

  // ⚠️ A real delete: the collection's row is the only copy, so unlike a
  // file there is no Versions to bring it back from. Games that already
  // picked it keep theirs, because picking copies the bytes in — which is
  // the thing that makes this safe to offer at all, and worth saying.
  if (d.kind === 'unshare-art') {
    return wrap(`Take ${d.art.name} out of the collection?`,
      h('p', { text: 'Nobody will be offered it again, and this is the only copy — there is no Recall to bring it back from.' }),
      h('p', { class: 'hint muted', text: 'Any game that already used it keeps its own copy. Taking it out here changes nothing in a game.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Take it out',
        onclick: async () => { close(); await unshareArt(d.art); },
      })));
  }

  if (d.kind === 'delete-file') {
    return wrap(`Delete ${d.path}?`,
      h('p', { text: 'You can always bring it back from Recall.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete it',
        onclick: async () => { close(); await deleteFile(d.path); },
      })));
  }

  // Unlike a file, a deleted score has no Versions to come back from: scores
  // live in the database, not the working tree, so this one says so.
  if (d.kind === 'clear-scores') {
    return wrap('Delete all the scores?',
      h('p', { text: 'The whole board, gone for good. The scoreboard itself stays on.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete them all',
        onclick: async () => { close(); if (await clearScores()) render(); },
      })));
  }

  // Taking an achievement out of the file hides what players earned rather
  // than deleting it: the earned rows are keyed by the id and come back with
  // it (spec.md §3), so the warning is about the players, not about data.
  if (d.kind === 'remove-achievement') {
    const who = d.players === 1 ? 'One player has' : `${d.players} players have`;
    return wrap(d.name ? `Take out ${d.name}?` : 'Take out this achievement?',
      h('p', {
        text: d.players
          ? `${who} earned it. They keep it, and see it again if an achievement with the same id comes back.`
          : 'Nobody has earned it yet.',
      }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Take it out',
        onclick: () => { close(); d.remove(); render(); },
      })));
  }

  if (d.kind === 'fork') {
    const name = h('input');
    name.value = `${S.project.name} copy`;
    const err = h('p', { class: 'error' });
    return wrap('Fork this game',
      h('p', { text: 'The new game starts with all the same files and helpers. The chat starts fresh.' }),
      h('label', { text: 'What is the fork called?' }), name,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Fork it',
        onclick: async () => {
          const body = { name: name.value.trim() };
          const res = await api('POST', `/api/projects/${S.slug}/fork`, body);
          if (!res.ok) { err.textContent = res.body?.error ?? 'Could not copy that.'; return; }
          close();
          await loadProjects();
          await openProject(res.body.slug);
        },
      })));
  }

  if (d.kind === 'close-file') {
    return wrap(`Close ${d.path}?`,
      h('p', { text: 'You changed this file and have not saved it yet. Closing loses those changes.' }),
      h('div', { class: 'actions' },
        h('button', { class: 'quiet', text: 'Keep editing', onclick: close }),
        h('button', {
          class: 'danger', text: 'Close without saving',
          // Awaited and always rendered: the dialog is still on screen until
          // something renders, and the file being opened next may take a
          // moment or fail. Same rule as closeOpenFile — whoever waits for the
          // close is waiting for the open.
          onclick: async () => {
            S.open = null;
            S.draw = null;
            S.drawRefused = null;
            S.dialog = null;
            render();
            if (d.then) await openFile(d.then);
          },
        }),
        // The way out that keeps the work, in the place the question is asked
        // — the same words and the same green as the button in the editor bar,
        // because it is the same button. Nothing to offer in an archived game,
        // where saving is off. This one closes the dialog first: the save may
        // put its own up — a conflict does — and a failure has something to
        // say that this dialog would be sitting in front of.
        frozen() ? null : h('button', {
          class: 'filled ok', text: 'Save and close',
          onclick: async () => { close(); await saveAndClose(d.then); },
        })));
  }

  if (d.kind === 'restore') {
    return wrap('Bring back this version?',
      h('p', { text: `${d.path} will go back to how it was at ${d.short}. Nothing is lost — this adds a new version.` }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Bring it back',
        onclick: async () => { close(); await restore(d.sha, d.path); },
      })));
  }

  if (d.kind === 'rollback') {
    return wrap('Bring the whole game back?',
      h('p', { text: `Every file goes back to how it was at ${d.short}. Anything made since then is taken away.` }),
      h('p', { text: 'Nothing is lost — this adds a new version, so you can come back from it too.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Bring it all back',
        onclick: async () => { close(); await rollback(d.sha); },
      })));
  }

  if (d.kind === 'conflict') {
    return wrap('This file changed while you were editing',
      h('p', { text: `A helper saved ${d.path} after you opened it. Which one do you want to keep?` }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'quiet', text: 'Keep theirs',
          onclick: async () => { close(); await openFile(d.path); },
        }),
        h('button', {
          class: 'filled', text: 'Keep mine',
          onclick: async () => { close(); await saveOpenFile({ force: true }); },
        })));
  }

  // The story editor's own conflict: the same question as a file's, asked
  // about the story rather than the text, because nobody here has seen the
  // text. Keep theirs re-reads the file; Keep mine writes over it.
  if (d.kind === 'story-conflict') {
    return wrap('The story changed while you were editing',
      h('p', { text: `A helper saved ${STORY_FILE} after you started. Which story do you want to keep?` }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'quiet', text: 'Keep theirs',
          onclick: async () => { close(); await discardStory(); },
        }),
        h('button', {
          class: 'filled', text: 'Keep mine',
          onclick: async () => { close(); await saveStory({ force: true }); },
        })));
  }

  // The same two answers for the Achievements tab.
  if (d.kind === 'achievements-conflict') {
    return wrap('The achievements changed while you were editing',
      h('p', { text: `A helper saved ${ACHIEVEMENTS_FILE} after you started. Which list do you want to keep?` }),
      h('div', { class: 'actions' },
        h('button', {
          class: 'quiet', text: 'Keep theirs',
          onclick: async () => { close(); await discardAchievements(); },
        }),
        h('button', {
          class: 'filled', text: 'Keep mine',
          onclick: async () => { close(); await saveAchievements({ force: true }); },
        })));
  }

  if (d.kind === 'new-agent' || d.kind === 'edit-agent') {
    const editing = d.kind === 'edit-agent';
    const name = h('input', { placeholder: 'Level Designer' });
    const description = h('textarea', {
      rows: '5',
      placeholder: 'You design fun levels. Keep things simple and playable.',
    });
    const model = h('select', {},
      h('option', { value: 'deepseek-v4-flash', text: 'Flash — quick' }),
      h('option', { value: 'deepseek-v4-pro', text: 'Pro — slower, better at hard things' }));
    // Three, not a checkbox: "a lot" is the setting that spends the whole
    // reply thinking and hands back nothing, so it is offered last and named
    // for what it costs rather than for what it sounds like (spec.md §14).
    const thinking = h('select', {},
      h('option', { value: 'low', text: 'A little — usually the best answer' }),
      h('option', { value: 'none', text: 'None — quickest, and gets straight to work' }),
      h('option', { value: 'full', text: 'A lot — can spend minutes thinking and write nothing' }));
    const fileTools = h('input', { type: 'checkbox', checked: true });
    if (editing) {
      name.value = d.agent.name;
      description.value = d.agent.description;
      model.value = d.agent.model;
      thinking.value = d.agent.thinking;
      fileTools.checked = d.agent.file_tools;
    }
    const err = h('p', { class: 'error' });
    return wrap(editing ? `Change ${d.agent.name}` : 'New helper',
      h('label', { text: 'Name (this is what you @ to call them)' }), name,
      h('label', { text: 'What should they be like?' }), description,
      h('label', { text: 'Brain' }), model,
      h('label', { text: 'How much to think first' }), thinking,
      h('label', { class: 'row' }, fileTools, ' Allowed to change files'),
      err,
      h('div', { class: 'actions' },
        editing
          ? h('button', {
            class: 'danger', text: 'Delete helper',
            onclick: () => { S.dialog = { kind: 'delete-agent', agent: d.agent }; render(); },
          })
          : null,
        editing ? h('div', { class: 'spacer' }) : null,
        cancel,
        h('button', {
          class: 'filled', text: editing ? 'Save' : 'Make helper',
          onclick: async () => {
            const body = {
              name: name.value.trim(),
              description: description.value.trim(),
              model: model.value,
              thinking: thinking.value,
              file_tools: fileTools.checked,
            };
            const res = editing
              ? await api('PATCH', `/api/agents/${d.agent.id}`, body)
              : await api('POST', '/api/agents', body);
            if (!res.ok) { err.textContent = res.body?.error ?? 'Could not save that helper.'; return; }
            close();
            await loadAgents();
            syncAttached();
            // You almost always make a helper because you want it in the game
            // you are looking at. Requiring a second "add to this game" click
            // was the trap that made a new studio look broken.
            if (!editing && S.slug && !S.project?.archived) await attachAgent(res.body);
            render();
          },
        })));
  }

  if (d.kind === 'delete-agent') {
    return wrap(`Delete ${d.agent.name}?`,
      h('p', { text: 'They will be removed from every game. What they already said stays in the chat.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete helper',
        onclick: async () => {
          await api('DELETE', `/api/agents/${d.agent.id}`);
          close();
          await loadAgents();
          syncAttached();
          render();
        },
      })));
  }

  return null;
}
