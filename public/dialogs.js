// Every dialog in the studio, behind one dialogFor(S.dialog). A dialog is a
// decision in progress: the address is held while one is open (see syncUrl),
// and the actions a dialog fires live in main.js — this file is the questions.

import { h } from './dom.js';
import { SIZES, MAX_SIDE, clampSide } from './pixel-editor.js';
import { SOUND_PRESETS } from './sound-maker.js';
import { SOUND_WORDS } from './sound-form.js';
import { ASSET_DIR, uploadPlan, uploadFiles } from './upload.js';
import {
  S, api, say, send, render, urlAs, openProject, loadProjects, loadAgents,
  syncAttached, attachAgent, openFile, saveOpenFile, saveAndClose, createFile,
  renameFile, duplicateFile, deleteFile, restore, rollback, createPicture,
  createSound, LIBRARY_DIR, deleteScore, clearScores,
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
      chat ? h('p', { class: 'hint muted', text: 'A chat is just for talking — no files, no game.' }) : null,
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
          await openProject(res.body.slug);
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
    const folder = h('input', { placeholder: 'leave empty for the top of the game' });
    folder.value = ASSET_DIR;
    const list = h('div', { class: 'plan' });
    const ok = h('button', { class: 'filled', text: 'Add it' });

    const paint = () => {
      const plan = uploadPlan(folder.value.trim(), d.files);
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
      const plan = uploadPlan(folder.value.trim(), d.files).filter((it) => !it.problem);
      close();
      await uploadFiles(plan);
    });

    return wrap(d.files.length === 1 ? 'Upload this file' : `Upload ${d.files.length} files`,
      h('label', { text: 'Which folder? assets/ is where pictures and sounds go; anything else can go where it belongs.' }), folder,
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

  // Two questions, the same two the picture is asked: what it is called and
  // what it starts as. The sliders are not here — they are the pane the file
  // opens in, so making a sound and changing it a week later are one surface
  // rather than two.
  if (d.kind === 'sound') {
    const name = h('input', { placeholder: 'laser' });
    name.value = d.name;
    // The preset names the file too, until somebody types a name of their own.
    name.addEventListener('input', () => { d.named = true; });
    const preset = h('select', {
      onchange: (e) => {
        d.preset = e.currentTarget.value;
        if (!d.named) { d.name = d.preset; name.value = d.name; }
      },
    }, Object.keys(SOUND_PRESETS).map((n) => h('option', { value: n, text: SOUND_WORDS[n] ?? n })));
    preset.value = d.preset;
    return wrap('Make a sound',
      h('label', { text: 'Start from' }), preset,
      h('label', { text: 'Call it' }), name,
      h('p', { class: 'hint muted', text: 'It lands in assets/ as a .wav, one version like anything else, and opens with its sliders — a sound made here can be changed here whenever you like.' }),
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => {
          const called = name.value.trim();
          close();
          await createSound(preset.value, called);
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
    return wrap('Make a copy of this game',
      h('p', { text: 'The new game starts with all the same files and helpers. The chat starts fresh.' }),
      h('label', { text: 'What is the copy called?' }), name,
      h('label', { text: 'Web address' }), slug,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make the copy',
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
        S.project.archived ? null : h('button', {
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
    const reasoning = h('input', { type: 'checkbox', checked: true });
    const fileTools = h('input', { type: 'checkbox', checked: true });
    if (editing) {
      name.value = d.agent.name;
      description.value = d.agent.description;
      model.value = d.agent.model;
      reasoning.checked = d.agent.reasoning;
      fileTools.checked = d.agent.file_tools;
    }
    const err = h('p', { class: 'error' });
    return wrap(editing ? `Change ${d.agent.name}` : 'New helper',
      h('label', { text: 'Name (this is what you @ to call them)' }), name,
      h('label', { text: 'What should they be like?' }), description,
      h('label', { text: 'Brain' }), model,
      h('label', { class: 'row' }, reasoning, ' Think before answering'),
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
              reasoning: reasoning.checked,
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
