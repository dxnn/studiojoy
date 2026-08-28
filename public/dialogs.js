// Every dialog in the studio, behind one dialogFor(S.dialog). A dialog is a
// decision in progress: the address is held while one is open (see syncUrl),
// and the actions a dialog fires live in main.js — this file is the questions.
// The sound maker is here too, because the dialog is the whole of it.

import { h } from './dom.js';
import { SIZES, MAX_SIDE, clampSide } from './pixel-editor.js';
import {
  SOUND_PARAMS, SOUND_PRESETS, WAVES, soundFrom, randomSound, soundBytes,
} from './sound-maker.js';
import { ASSET_DIR, assetPath, writeFiles, uploadPlan, uploadFiles } from './upload.js';
import {
  S, api, say, render, urlAs, openProject, loadProjects, loadAgents,
  syncAttached, attachAgent, openFile, saveOpenFile, createFile, renameFile,
  duplicateFile, deleteFile, restore, rollback, createPicture, LIBRARY_DIR,
  deleteScore, clearScores,
} from './main.js';

/* Sounds ------------------------------------------------------------------ */

// Plain words for the four shapes, with the real name kept: a ten-year-old
// picks "buzzy", and the one who wants to know what a square wave is can see
// it. Same bargain as helper/agent.
const WAVE_WORDS = {
  square: 'Buzzy (square)', saw: 'Sharp (saw)', sine: 'Smooth (sine)', noise: 'Noisy (noise)',
};

const SOUND_WORDS = {
  pickup: 'Pick up', laser: 'Laser', explosion: 'Explosion', powerup: 'Power up',
  hit: 'Hit', jump: 'Jump', blip: 'Blip',
};

let soundUrl = null;

// The bytes played are the bytes that would be saved, so there is no way to
// hear one thing and keep another. The last URL is let go on the next play
// rather than on a timer: an object URL held forever is a leak, and one
// revoked too early is a sound that will not play twice.
function playSound(params) {
  if (soundUrl) URL.revokeObjectURL(soundUrl);
  soundUrl = URL.createObjectURL(new Blob([soundBytes(params)], { type: 'audio/wav' }));
  new Audio(soundUrl).play().catch(() => { /* a browser that will not autoplay */ });
}

async function saveSound(params, name) {
  const path = assetPath(ASSET_DIR, `${name || 'sound'}.wav`);
  const body = new Blob([soundBytes(params)], { type: 'audio/wav' });
  const { failure } = await writeFiles([{ path, body }]);
  if (failure) { say(failure, true); return; }
  say(`Saved ${path}.`);
  await openFile(path);
}

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
    return wrap(chat ? 'New chat' : 'New game',
      h('label', { text: 'What is it called?' }), name,
      h('label', { text: 'Web address (letters, numbers and dashes)' }), slug,
      chat ? h('p', { class: 'hint muted', text: 'A chat is just for talking — no files, no game.' }) : null,
      err,
      h('div', { class: 'actions' }, cancel, h('button', {
        class: 'filled', text: 'Make it',
        onclick: async () => {
          const body = { name: name.value.trim(), kind: chat ? 'chat' : 'game' };
          if (slug.value.trim()) body.slug = slug.value.trim();
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

  if (d.kind === 'sound') {
    const sliders = new Map();
    const readouts = new Map();

    const wave = h('select', {
      onchange: (e) => { d.sound.wave = e.currentTarget.value; playSound(d.sound); },
    }, WAVES.map((w) => h('option', { value: w, text: WAVE_WORDS[w] })));

    const name = h('input', { placeholder: 'laser' });
    name.addEventListener('input', () => { d.name = name.value; d.named = true; });

    const shown = (p) => (p.step >= 1 ? String(Math.round(d.sound[p.key])) : d.sound[p.key].toFixed(2));

    // Painted in place rather than through render(), which would rebuild the
    // slider under the thumb that is dragging it — the same trap as the
    // problems panel.
    const paint = () => {
      for (const p of SOUND_PARAMS) {
        sliders.get(p.key).value = d.sound[p.key];
        readouts.get(p.key).textContent = shown(p);
      }
      wave.value = d.sound.wave;
      name.value = d.name;
    };

    const knobs = h('div', { class: 'knobs' }, SOUND_PARAMS.map((p) => {
      const readout = h('span', { class: 'knob-value mono' });
      const slider = h('input', {
        type: 'range', min: p.min, max: p.max, step: p.step,
        // Dragging moves the number beside it; letting go is what plays the
        // sound, so a slow drag is not forty overlapping sounds.
        oninput: (e) => {
          d.sound[p.key] = Number(e.currentTarget.value);
          readout.textContent = shown(p);
        },
        onchange: () => playSound(d.sound),
      });
      sliders.set(p.key, slider);
      readouts.set(p.key, readout);
      return h('label', { class: 'knob' },
        h('span', { class: 'knob-name', text: p.label }),
        slider,
        readout,
        h('span', { class: 'knob-note hint muted', text: p.comment }));
    }));

    // A preset renames the file too, until someone types a name of their own.
    const load = (sound, called) => {
      d.sound = sound;
      if (called && !d.named) d.name = called;
      paint();
      playSound(d.sound);
    };
    paint();

    return wide('Make a sound',
      h('div', { class: 'row wrap' },
        Object.keys(SOUND_PRESETS).map((n) => h('button', {
          class: 'quiet tiny', text: SOUND_WORDS[n] ?? n, onclick: () => load(soundFrom(n), n),
        })),
        h('button', { class: 'quiet tiny', text: 'Surprise me', onclick: () => load(randomSound()) })),
      h('label', { text: 'Shape' }), wave,
      knobs,
      h('label', { text: 'Call it' }), name,
      h('p', { class: 'hint muted', text: 'It lands in assets/ as a .wav, one version like anything else.' }),
      h('div', { class: 'actions' },
        cancel,
        h('button', { class: 'quiet', text: 'Play', onclick: () => playSound(d.sound) }),
        h('button', {
          class: 'filled', text: 'Save it',
          onclick: async () => {
            const { sound, name: called } = d;
            close();
            await saveSound(sound, called);
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
