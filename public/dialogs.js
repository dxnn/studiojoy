// Every dialog in the studio, behind one dialogFor(S.dialog). A dialog is a
// decision in progress: the address is held while one is open (see syncUrl),
// and the actions a dialog fires live in main.js — this file is the questions.

import { h } from './dom.js';
import { SIZES, MAX_SIDE, clampSide } from './pixel-editor.js';
import {
  SOUND_DIR, IMAGE_DIR, SPRITE_DIR, uploadPlan, uploadFiles, openUpload,
} from './upload.js';
import {
  S, api, say, send, render, urlAs, openProject, loadProjects, loadAgents,
  syncAttached, attachAgent, openFile, saveOpenFile, saveAndClose, createFile,
  renameFile, duplicateFile, deleteFile, restore, rollback, createPicture,
  createChat, createSound, setAuthors, setOpenEdit, setPublished,
  frozen, loadStudio, studioChange,
  copyFileTo, LIBRARY_DIR, deleteScore, clearScores,
} from './main.js';

/* Render: dialogs -------------------------------------------------------- */

const inLibrary = (path) => path === LIBRARY_DIR || path.startsWith(`${LIBRARY_DIR}/`);

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

// The name a duplicate starts with: `-copy` before the extension, counting up
// past any name already taken, so the dialog never opens on a collision.
function duplicateName(from) {
  const slash = from.lastIndexOf('/');
  const dot = from.lastIndexOf('.');
  const cut = dot > slash + 1 ? dot : from.length;
  for (let n = 1; ; n += 1) {
    const to = `${from.slice(0, cut)}-copy${n > 1 ? `-${n}` : ''}${from.slice(cut)}`;
    if (!S.files.some((f) => f.path === to)) return to;
  }
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
    const slug = h('input', { placeholder: chat ? 'silly-ideas (optional)' : 'space-racer (optional)' });
    const err = h('p', { class: 'error' });

    // A starter tree instead of a blank page. The list arrives after the
    // dialog is built — the node persists, so the options land in place.
    const fromHint = h('p', { class: 'hint muted' });
    const from = h('select', {
      onchange: () => { fromHint.textContent = from.selectedOptions[0]?.dataset.what ?? ''; },
    }, h('option', { value: '', text: 'A blank page' }));
    if (!chat) {
      send('/game-templates/index.json').then(async (res) => {
        if (!res.ok) return;
        const { templates } = await res.json();
        for (const [key, t] of Object.entries(templates ?? {})) {
          const option = h('option', { value: key, text: t.title });
          option.dataset.what = t.what;
          from.append(option);
        }
      });
    }

    return wrap(chat ? 'New chat' : 'New game',
      h('label', { text: 'What is it called?' }), name,
      h('label', { text: 'Web address (letters, numbers and dashes)' }), slug,
      chat ? null : h('label', { text: 'Start from' }),
      chat ? null : from,
      chat ? null : fromHint,
      chat ? h('p', { class: 'hint muted', text: 'A chat is just for talking — no files, no game. One room, and you can call helpers into it by name.' }) : null,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => {
          const body = { name: name.value.trim(), kind: chat ? 'chat' : 'game' };
          if (slug.value.trim()) body.slug = slug.value.trim();
          if (!chat && from.value) body.template = from.value;
          const res = await api('POST', '/api/projects', body);
          if (!res.ok) { err.textContent = res.body?.error ?? 'Could not make that.'; return; }
          close();
          await loadProjects();
          // The answer says which conversation to open on — Building when the
          // starter helper is waiting there, the human-only one otherwise, and
          // for a chat project the one room it has. A new project has nothing
          // remembered about it, so without this a game would land on its
          // front door with nobody in the room.
          await openProject(res.body.slug, { view: { chat: res.body.chat?.id } });
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

  // Only reachable for a game that is already archived: nothing in the
  // interface archives one any more.
  if (d.kind === 'archive') {
    return wrap('Work on this again?',
      h('p', { text: 'You will be able to change files and talk to helpers again.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Reopen it',
        onclick: async () => {
          await api('POST', `/api/projects/${S.slug}/archive`, { archived: false });
          close();
          // Reopening the game you are already in is not somewhere new to go
          // Back from, even though it does clear the rail.
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
  if (d.kind === 'rename-file') {
    const path = h('input', { 'aria-label': 'New name' });
    path.value = d.path;
    const note = h('div', { class: 'hint muted' });
    const rename = h('button', { class: 'filled', text: 'Rename it' });
    // The name is the whole path, so a rename is also a move, and what that
    // will mean is said before it happens rather than found out afterwards.
    const check = () => {
      const to = path.value.trim();
      note.textContent = renameNote(d.path, to);
      rename.disabled = !to || to === d.path;
    };
    path.addEventListener('input', check);
    rename.addEventListener('click', async () => {
      const to = path.value.trim();
      close();
      await renameFile(d.path, to);
    });
    check();
    return wrap('Rename this file',
      h('label', { text: 'New name (use / for folders)' }), path, note,
      h('div', { class: 'actions' }, cancel, rename));
  }

  if (d.kind === 'duplicate-file') {
    const path = h('input', { 'aria-label': 'Name for the duplicate' });
    path.value = duplicateName(d.path);
    const note = h('div', { class: 'hint muted' });
    const make = h('button', { class: 'filled', text: 'Duplicate it' });
    const check = () => {
      const to = path.value.trim();
      note.textContent = duplicateNote(d.path, to);
      make.disabled = !to || to === d.path;
    };
    path.addEventListener('input', check);
    make.addEventListener('click', async () => {
      const to = path.value.trim();
      close();
      await duplicateFile(d.path, to);
    });
    check();
    // The copy is made from the disk, so words still only in the editor are
    // named here rather than quietly left out of it.
    const dirty = S.open?.path === d.path && (S.open.dirty || S.draw?.dirty);
    return wrap('Duplicate this file',
      h('label', { text: 'Name for the duplicate (use / for folders)' }), path, note,
      dirty ? h('p', { class: 'hint muted', text: 'Your unsaved changes stay here — the duplicate is of the last save.' }) : null,
      h('div', { class: 'actions' }, cancel, make));
  }

  // Four ways to put a file in the game, behind the one button above the file
  // list. The names are the ones the agent preamble tells a helper to ask for
  // by — renaming one here means renaming it there.
  if (d.kind === 'add-file') {
    // The picker is what makes uploading work on a tablet, where there is
    // nothing to drag from. It lives in the dialog now, with the button that
    // opens it; the dialog node outlives every render, so it stays connected.
    const picker = h('input', {
      type: 'file', multiple: true, hidden: true,
      onchange: (e) => {
        const files = [...e.currentTarget.files];
        // Cleared so picking the same file twice in a row still fires.
        e.currentTarget.value = '';
        // The upload dialog replaces this one, so there is nothing to close.
        if (files.length) openUpload(files);
      },
    });
    const choice = (label, what, onclick) => h('button', { class: 'choice', onclick },
      h('span', { class: 'cname', text: label }),
      h('span', { class: 'cwhat', text: what }));

    return wrap('Add a file',
      h('div', { class: 'choices' },
        choice('+ New file', 'An empty file you name yourself — code, notes, anything.',
          () => { S.dialog = { kind: 'new-file' }; render(); }),
        choice('+ Upload', 'Any file from this device. Pictures and sounds go to assets/.',
          () => picker.click()),
        choice('+ Draw a picture', 'A sprite or a backdrop, square by square.',
          () => { S.dialog = { kind: 'draw-new', size: 64, name: 'sprite' }; render(); }),
        // Straight to the sliders. There is nothing to ask first: a sound you
        // have not heard yet cannot be named, and everything else about it is
        // in the pane.
        choice('+ Make a sound', `A .wav from a row of sliders, into ${SOUND_DIR}/.`,
          () => { close(); createSound(); })),
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
    const budget = h('input', { type: 'number', min: '0', class: 'cfg-num' });
    const starter = h('select', { title: 'Joins the Building chat of every new game' });
    const box = h('div', { class: 'col' });

    const number = (value) => (value === null || value === undefined ? '' : String(value));

    const paint = () => {
      const data = S.admin;
      if (!data) { list.replaceChildren(h('div', { class: 'muted', text: 'Reading…' })); return; }
      budget.value = number(data.budget.limit);
      // Rebuilt each paint: a helper made or deleted while this is open
      // should be in the list, and an empty value is a real answer — nobody.
      starter.replaceChildren(
        h('option', { value: '', text: 'Nobody' }),
        ...S.agents.map((a) => h('option', { value: String(a.id), text: a.name })),
      );
      starter.value = number(data.starter_agent_id);
      list.replaceChildren(...data.people.map((person) => {
        const name = h('input', { value: person.display_name });
        name.value = person.display_name;
        const allowance = h('input', {
          type: 'number', min: '0', class: 'cfg-num',
          placeholder: 'no limit',
          title: 'Tokens this person’s helpers may spend in a day',
        });
        allowance.value = number(person.daily_tokens);
        // ⚠️ Three buttons, and no Remove. Taking somebody out of the studio
        // is `npm run deluser -- <email>` at a terminal and nothing else — a
        // red button beside Save and Password invites the press, and no click
        // can show what leaving means. There is no route behind it either
        // (spec.md §11).
        return h('div', { class: 'person' },
          name,
          h('span', {
            class: 'hint muted mono',
            title: 'Spent today',
            text: `${person.spent_today.toLocaleString()} today`,
          }),
          allowance,
          h('button', {
            class: 'quiet tiny', text: 'Save',
            onclick: () => studioChange('PATCH', `/users/${person.id}`, {
              display_name: name.value.trim(),
              daily_tokens: allowance.value === '' ? null : Number(allowance.value),
            }).then(paint),
          }),
          h('button', {
            class: `quiet tiny${person.admin ? ' on' : ''}`,
            text: person.admin ? 'Admin' : 'Make admin',
            title: person.admin ? 'Can run the studio' : 'Let them run the studio',
            onclick: () => studioChange('PATCH', `/users/${person.id}`, {
              admin: !person.admin,
            }).then(paint),
          }),
          h('button', {
            class: 'quiet tiny', text: 'Password',
            title: 'Give them a new password',
            onclick: () => {
              const next = window.prompt(`A new password for ${person.display_name}`);
              if (next) studioChange('PATCH', `/users/${person.id}`, { password: next }).then(paint);
            },
          }));
      }));
    };

    const email = h('input', { placeholder: 'them@example.com' });
    const who = h('input', { placeholder: 'Their name' });
    const pass = h('input', { placeholder: 'A password they can remember' });
    box.append(
      h('div', { class: 'section-label', text: 'In the studio' }),
      list,
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
      h('div', { class: 'section-label', text: 'Every new game starts with' }),
      h('div', { class: 'person' },
        starter,
        h('span', { class: 'hint muted', text: 'waiting in the game’s Building chat' }),
        h('button', {
          class: 'quiet tiny', text: 'Save',
          onclick: () => studioChange('PATCH', '/studio', {
            daily_token_budget: budget.value === '' ? null : Number(budget.value),
            starter_agent_id: starter.value === '' ? null : Number(starter.value),
          }).then(paint),
        })),
      h('div', { class: 'section-label', text: 'The whole studio, in a day' }),
      h('div', { class: 'person' },
        budget,
        h('span', { class: 'hint muted', text: 'tokens a day for everybody together' }),
        h('button', {
          class: 'quiet tiny', text: 'Save',
          onclick: () => studioChange('PATCH', '/studio', {
            daily_token_budget: budget.value === '' ? null : Number(budget.value),
          }).then(paint),
        })),
    );

    if (!S.admin) loadStudio().then(paint);
    paint();
    return wide('Studio settings',
      h('p', { class: 'hint muted', text: 'Everyone here can read every game and talk in every “Humans only”. A daily limit is how many tokens that person’s helpers may spend; leave it empty for no limit of their own.' }),
      box,
      h('div', { class: 'actions' },
        h('button', { class: 'filled', text: 'Done', onclick: close })));
  }

  // Publishing is one click away in the bar, so the button there is a status
  // and this is where it is actually done. Both ways round: the games list is
  // the only thing either changes — a link to the game has always worked and
  // still will.
  if (d.kind === 'publish') {
    const listed = Boolean(S.project.published);
    return wrap(listed ? 'Take it out of the games list?' : 'Put it in the games list?',
      h('p', {
        text: listed
          ? 'Everybody sees this game on the games page. Take it out and only people with the link will find it — the link still works, and the game still plays.'
          : 'The games page is what everybody sees at the games address. Put it in and this game is on it.',
      }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: listed ? 'danger' : 'filled',
        text: listed ? 'Take it out' : 'Put it in',
        onclick: async () => {
          close();
          await setPublished(!listed);
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

  // A file into another game. The list is the games you may change: copying
  // out of this one takes nothing from it, so what decides is where it lands.
  if (d.kind === 'copy-to') {
    const games = S.projects.filter((p) => p.kind !== 'chat' && p.slug !== S.slug && p.can_edit);
    const where = h('select', {}, games.map((p) => h('option', { value: p.slug, text: p.name })));
    const name = h('input');
    name.value = d.path;
    const err = h('p', { class: 'error' });
    if (games.length === 0) {
      return wrap('Copy this file into another game',
        h('p', { text: 'There is no other game you can change. A game you are an editor of, or one that is open to everyone, can take a copy.' }),
        h('div', { class: 'actions' }, h('button', { class: 'filled', text: 'Close', onclick: close })));
    }
    return wrap('Copy this file into another game',
      h('label', { text: 'Which game?' }), where,
      h('label', { text: 'Call it' }), name,
      h('p', { class: 'hint muted', text: 'The bytes are copied as they are now. The two games stay strangers — this one keeps its file, and neither one hears about the other again.' }),
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Copy it',
        onclick: async () => {
          const to = name.value.trim();
          if (!to) { err.textContent = 'Give it a name.'; return; }
          close();
          await copyFileTo(where.value, d.path, to);
        },
      })));
  }

  if (d.kind === 'delete-file') {
    return wrap(`Delete ${d.path}?`,
      h('p', { text: 'You can always bring it back from Versions.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete it',
        onclick: async () => { close(); await deleteFile(d.path); },
      })));
  }

  // Unlike a file, a deleted score has no Versions to come back from: scores
  // live in the database, not the working tree, so both of these say so.
  if (d.kind === 'delete-score') {
    return wrap(`Delete ${d.score.name}'s score?`,
      h('p', { text: `${d.score.name} — ${d.score.score.toLocaleString()}. There is no bringing a score back.` }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete it',
        onclick: async () => { close(); if (await deleteScore(d.score.id)) render(); },
      })));
  }

  if (d.kind === 'clear-scores') {
    return wrap('Delete all the scores?',
      h('p', { text: 'The whole board, gone for good. The scoreboard itself stays on.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'danger', text: 'Delete them all',
        onclick: async () => { close(); if (await clearScores()) render(); },
      })));
  }

  if (d.kind === 'fork') {
    const name = h('input');
    name.value = `${S.project.name} copy`;
    const slug = h('input', { placeholder: 'leave empty to pick one for you' });
    const err = h('p', { class: 'error' });
    return wrap('Fork this game',
      h('p', { text: 'The new game starts with all the same files and helpers. The chat starts fresh.' }),
      h('label', { text: 'What is the fork called?' }), name,
      h('label', { text: 'Web address' }), slug,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Fork it',
        onclick: async () => {
          const body = { name: name.value.trim() };
          if (slug.value.trim()) body.slug = slug.value.trim();
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
