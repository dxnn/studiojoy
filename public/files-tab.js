// Code: the file tree and the open file's editor under it — a config file as
// fields, the quiz or Controls in their own editors, plain text with syntax
// colour and an SVG's live preview, or a picture/sound handed to their own
// editors. The same renderOpenFile also fills the rail under Pics and Hear.

import { h } from './dom.js';
import { langFor, tokenize } from './highlight.js';
import { makeDropTarget } from './upload.js';
import { isConfigPath, renderConfigForm } from './config-form.js';
import { parseConfigFile } from './config-file.js';
import { isQuizPath, quizModel } from './quiz-editor.js';
import { renderQuizForm } from './quiz-form.js';
import { isControlsPath, controlsModel } from './controls-editor.js';
import { renderControlsForm } from './controls-form.js';
import { isStoryPath } from './story-editor.js';
import { isAchievementsPath } from './achievements-editor.js';
import {
  S, render, frozen, sizeText, more, EDITOR_AREA, showMode, hasEditor, encodePath,
} from './main.js';
import {
  chooseFile, closeOpenFile, saveOpenFile,
} from './files.js';
import { loadHistory } from './history.js';
import { renderDrawing } from './drawing.js';
import { renderSoundEditor } from './sound-editor.js';

// A picture or sound has nothing to edit, so the pane shows the thing itself.
// The source is the same authenticated read the editor uses, and that route
// sends no-store, so a replaced file never shows the bytes it had before.
// How the pane shows a file that is not text. One entry per kind, matched in
// order, and the only place a new kind of file has to be added — which is the
// point of it being a list rather than a run of ifs. `mimeForPath` on the server
// decides what a file is; this decides what to do about it.
const MEDIA_KINDS = [
  { kind: 'picture', when: (mime) => mime?.startsWith('image/'), show: (src, path) => h('img', { src, alt: path }) },
  { kind: 'sound', when: (mime) => mime?.startsWith('audio/'), show: (src) => h('audio', { src, controls: true }) },
  { kind: 'video', when: (mime) => mime?.startsWith('video/'), show: (src) => h('video', { src, controls: true }) },
];

export function renderMedia({ path, mime }) {
  const src = `/api/projects/${S.slug}/files/${encodePath(path)}`;
  const kind = MEDIA_KINDS.find((k) => k.when(mime));
  if (kind) return h('div', { class: 'media grow' }, kind.show(src, path));
  // Anything the studio has no way to show is still a real part of the game and
  // still readable — the server sends an unknown type as a download, so the
  // link is the honest thing to offer instead of an apology.
  return h('div', { class: 'pad muted grow' },
    h('p', { text: 'The studio has no way to show this one, but it is part of the game like any other file.' }),
    h('p', {}, h('a', { href: src, download: path.split('/').pop() }, 'Save it to open somewhere else')));
}

// How big a file can be and still be recoloured on every keystroke without
// the keystroke feeling it. Past this the editor is the plain textarea again.
const HIGHLIGHT_MAX = 128 * 1024;

// The text editor's colours: the same characters tokenized and painted on a
// <pre> underneath, with the textarea's own ink turned transparent — so the
// caret, the selection, the focus snapshot and the save flow all still belong
// to the textarea, and what is typed is exactly what is saved. Repainted in
// place on input rather than through render(), like every other live surface;
// the repaint listener lands after the oninput that stores the content, so it
// reads what was just typed.
function codeBox(area, path) {
  const lang = langFor(path);
  if (!lang || area.value.length > HIGHLIGHT_MAX) return area;
  const pre = h('pre', { class: 'code-hl', 'aria-hidden': 'true' });
  const paint = () => {
    pre.replaceChildren();
    for (const tok of tokenize(area.value, lang)) {
      pre.append(tok.cls ? h('span', { class: `tok-${tok.cls}`, text: tok.text }) : tok.text);
    }
    // A <pre> swallows a final newline where a textarea shows an empty last
    // line; the extra space keeps their bottoms level.
    if (area.value.endsWith('\n')) pre.append(' ');
  };
  area.addEventListener('input', paint);
  area.addEventListener('scroll', () => {
    pre.scrollTop = area.scrollTop;
    pre.scrollLeft = area.scrollLeft;
  });
  paint();
  return h('div', { class: 'code' }, pre, area);
}

// An .svg is text that draws a picture, so the editor shows both: the picture
// above the code, redrawn as you type — repainted in place on input like the
// colours underneath it, never through render(). The swap goes through an
// offscreen probe so a half-typed tag keeps the last drawing that worked
// instead of flashing a broken image. In an <img> an SVG runs no scripts and
// loads nothing, which is what makes painting unsaved text safe.
function svgPreview(area) {
  const img = h('img', { alt: 'The picture this file draws' });
  const show = () => {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(area.value)}`;
    const probe = new Image();
    probe.onload = () => { img.src = url; };
    probe.src = url;
  };
  area.addEventListener('input', show);
  show();
  return h('div', { class: 'media svg-live' }, img);
}

/* The file list ------------------------------------------------------------ */

// Which top-level folders are folded shut, per game, for this session. Not a
// view: a fold is how you read a long list, not somewhere a link can send you.
const closedDirsBySlug = new Map();

export function closedDirs() {
  let set = closedDirsBySlug.get(S.slug);
  if (!set) { set = new Set(); closedDirsBySlug.set(S.slug, set); }
  return set;
}

export const dirOf = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : null);

// A dot per row, coloured by what the file is for: the page the game starts
// at, the code, the library it may not change. Everything else — art, sounds,
// words — keeps the muted default, because a colour per extension is a legend
// nobody reads. Gold is not here on purpose: it means a number or a version
// everywhere else in the studio, and a file is neither.
function fileDot(f) {
  const colour = f.library ? 'var(--ok)'
    : f.path === 'index.html' ? 'var(--accent)'
      : /\.(js|css|json|html)$/i.test(f.path) ? 'var(--agent)'
        : null;
  return h('span', { class: 'fdot', style: colour ? `background:${colour}` : null });
}

export function renderFilesTab() {
  const fileRow = (f, top) => h('div', {
    class: `file${top ? ' inset' : ''}${S.open?.path === f.path ? ' open' : ''}${f.unreachable ? ' unreachable' : ''}${f.library ? ' library' : ''}`,
    // The whole row opens the file, not just the name on it. The row is what
    // lights up under the pointer, and the size, the gap and the padding used
    // to be lit and dead at the same time. An unreachable row does neither.
    // The open file's own row closes it again — the same control both ways,
    // like Show changes / Hide changes — through the same unsaved-work
    // question the ✕ asks.
    onclick: f.unreachable ? null : () => (
      S.open?.path === f.path ? closeOpenFile() : chooseFile(f.path)
    ),
  },
  h('input', {
    type: 'checkbox',
    // Pinning a library file would push the thing deliberately kept out of a
    // helper's context straight back into it.
    title: f.library
      ? 'A studio library — helpers can call it without being shown it'
      : 'Pin this file so helpers look at it',
    checked: S.pinned.has(f.path),
    disabled: f.unreachable || f.library,
    // Its own control, inside a row that is also one: pinning a file is not
    // asking to open it.
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => {
      if (e.currentTarget.checked) S.pinned.add(f.path);
      else S.pinned.delete(f.path);
      render();
    },
  }),
  fileDot(f),
  // No handler of its own — the click reaches the row. Still a button so the
  // row can be got at by keyboard. Inside a folder the row shows the rest of
  // the path — the folder's own row already says the front of it.
  h('button', { class: 'fname', text: top ? f.path.slice(top.length + 1) : f.path, disabled: f.unreachable }),
  h('span', { class: 'fsize', text: sizeText(f.size) }),
  f.unreachable ? null : fileMore(f.path));

  // The list is sorted by path, so a folder's files are already contiguous:
  // one header row where each top-level folder starts, and its files hidden
  // while it is folded shut. One level, on purpose — the studio asks helpers
  // for small flat trees, and js/lib/x.js under a js/ header still says lib/.
  const closed = closedDirs();
  const rows = [];
  let group = null;
  for (const f of S.files) {
    const top = dirOf(f.path);
    if (top !== group) {
      group = top;
      if (top !== null) {
        const inside = S.files.filter((x) => dirOf(x.path) === top);
        const bytes = inside.reduce((n, x) => n + x.size, 0);
        const shut = closed.has(top);
        rows.push(h('div', {
          class: 'file dir',
          onclick: () => {
            if (shut) closed.delete(top);
            else closed.add(top);
            render();
          },
        },
        // Square and amber against the files' round dots, which is the whole
        // difference between a folder row and a file row at a glance.
        h('span', { class: 'fdot' }),
        h('button', { class: 'fname', text: `${shut ? '▸' : '▾'} ${top}/` }),
        h('span', {
          class: 'fsize',
          text: `${inside.length} file${inside.length === 1 ? '' : 's'} · ${sizeText(bytes)}`,
        })));
      }
    }
    if (top !== null && closed.has(top)) continue;
    rows.push(fileRow(f, top));
  }

  // With a file open the list shrinks to about five rows and the editor takes
  // everything else; with nothing open the list fills the pane. On a phone
  // `short` is narrower still — the list goes altogether and the editor has
  // the pane, because five rows and a header over a keyboard left about four
  // lines of the file (code-tree.css). ✕ in the editor's bar is the way back
  // to the list, the way it already is under Pics.
  const tree = h('div', { class: `tree scroll${S.open ? ' short' : ''}`, 'data-scroll': 'files' },
    rows.length ? rows : h('div', {
      class: 'pad muted',
      text: 'No files yet. Ask a helper to make one, or drop a file here.',
    }));
  if (!frozen()) makeDropTarget(tree);

  return [
    // One button, four ways in. The four used to sit here in a row that
    // wrapped to two lines in a narrow rail and put the rarest of them beside
    // the commonest; which kind of file you are adding is a question, so it is
    // asked in a dialog.
    // It carries `short` for the same reason the list does: it belongs to the
    // list, so on a phone it goes with it.
    h('div', { class: `pad row wrap tree-top${S.open ? ' short' : ''}` },
      frozen() ? null : h('button', {
        class: 'quiet tiny', text: 'Add a file',
        title: 'Make a file, upload one, draw a picture or make a sound',
        onclick: () => { S.dialog = { kind: 'add-file' }; render(); },
      }),
      h('div', { class: 'spacer' }),
      S.pinned.size
        ? h('button', { class: 'quiet tiny', text: 'Unpin all', onclick: () => { S.pinned.clear(); render(); } })
        : null),
    tree,
    renderOpenFile(),
  ];
}

// What can be done to a file, on its row under Code or its card under Pics
// or Hear (spec.md §6). Duplicate is not gated on frozen(): its dialog can
// send the copy to another game instead, and copying out of a game takes
// nothing from it — the rights that matter are the destination's, which the
// dialog minds.
export function fileMore(path) {
  const picture = S.files.find((f) => f.path === path)?.mime?.startsWith('image/');
  return more(`file:${path}`, [
    !frozen() && { text: 'Rename…', onPick: () => { S.dialog = { kind: 'rename-file', path }; render(); } },
    { text: 'Duplicate…', title: 'In this game, into another one, or a picture into the studio\'s collection', onPick: () => { S.dialog = { kind: 'duplicate-file', path }; render(); } },
    !frozen() && picture && { text: 'Make pixel art…', title: 'Cut it down, shrink it to a sprite’s size and use the game’s colours', onPick: () => { S.dialog = { kind: 'pixel-art', path }; render(); } },
    !frozen() && { text: 'Delete…', danger: true, onPick: () => { S.dialog = { kind: 'delete-file', path }; render(); } },
  ], { label: `More about ${path}` });
}

// The open file's editor, full width: the pixel editor, the sound editor, a
// player, the quiz form, a config form, or the text (spec.md §6). Under Code
// it sits below the tree; under Pics it is the whole pane while a picture is
// open, and under Questions it is the mode. Null with nothing open.
export function renderOpenFile() {
  if (!S.open) return null;
  {
    // One bar for every kind: the file's name, its versions, and the way out
    // — except under Questions, where the file is the mode and there is
    // nowhere to close it to.
    const bar = h('div', { class: 'bar' },
      h('div', { class: 'title mono', text: S.open.path }),
      h('div', { class: 'spacer' }),
      // The count is on the link because it is the thing worth knowing before
      // clicking it: one version means there is nothing to compare, and twelve
      // means this file has a story. Plain "Versions" until the number lands,
      // rather than a 0 that would be a lie for a file that exists.
      h('button', {
        class: 'link tiny',
        text: S.open.versions
          ? `${S.open.versions} version${S.open.versions === 1 ? '' : 's'}`
          : 'Versions',
        onclick: () => { showMode('versions'); return loadHistory(S.open.path); },
      }),
      // Rename, Duplicate and Delete are the file's ··· on its row or card
      // (spec.md §6); the bar is the file's name, its versions, and the way
      // out — except under Questions and Controls, where the file is the
      // mode and there is nowhere to close it to.
      S.mode === 'quiz' || S.mode === 'controls' ? null : h('button', {
        class: 'icon tiny', text: '✕', title: 'Close this file',
        // Wrapped, not passed: closeOpenFile's first argument is the file to
        // open next, and handing it the click event asked for a file named
        // "[object PointerEvent]" instead of closing anything.
        onclick: () => closeOpenFile(),
      }));

    // A config file opens as fields rather than code, unless it holds something
    // the reader will not touch, or you asked to see the text. Before that,
    // two files have an editor of their own here: config/questions.js in the
    // quiz shape as the quiz editor — the whole game as a form — and
    // config/controls.js as the Controls panel. Both fall back through the
    // generic form to the text as the file outgrows each reader, and both
    // render wherever the file is open, Code included: one renderer reached
    // two ways is not two surfaces. Two other files are the exception and
    // open here as plain text and nothing else: the story, in a game with the
    // story editor — its editor is Write, with a model of its own — and the
    // achievements, whose editor is under Share. A form there would be a
    // second thing writing the same file.
    const inEditor = (isStoryPath(S.open.path) && hasEditor('story')) || isAchievementsPath(S.open.path);
    const parsed = isConfigPath(S.open.path) && S.open.content !== null && !inEditor
      ? parseConfigFile(S.open.content)
      : null;
    const quiz = isQuizPath(S.open.path) && S.open.content !== null && !S.open.asText
      ? quizModel(S.open.content)
      : null;
    const controls = isControlsPath(S.open.path) && S.open.content !== null && !S.open.asText
      ? controlsModel(S.open.content)
      : null;

    if (S.open.content === null) {
      const refused = S.drawRefused ?? S.soundRefused;
      return h('div', { class: 'editor' }, bar,
        S.draw ? renderDrawing() : S.sound ? renderSoundEditor() : renderMedia(S.open),
        refused ? h('div', { class: 'pad hint muted', text: refused }) : null);
    }
    if (quiz?.ok) return h('div', { class: 'editor' }, bar, ...renderQuizForm(quiz));
    if (controls?.ok) return h('div', { class: 'editor' }, bar, ...renderControlsForm(controls));
    if (parsed?.ok && !S.open.asText) {
      const outgrown = (quiz && !quiz.ok && quiz.reason)
        || (controls && !controls.ok && controls.reason);
      return h('div', { class: 'editor' }, bar,
        outgrown
          ? h('div', { class: 'pad hint muted', text: `Showing every field because ${outgrown}.` })
          : null,
        renderConfigForm(parsed.decls));
    }
    {
      const area = h('textarea', {
        id: EDITOR_AREA,
        spellcheck: 'false',
        oninput: (e) => {
          S.open.content = e.currentTarget.value;
          S.open.dirty = true;
          for (const id of ['save-btn', 'save-close-btn']) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
          }
        },
      });
      area.value = S.open.content;
      return h('div', { class: 'editor' },
        bar,
        // Why a config file is showing as text: either you asked, or it holds
        // something the form will not pretend to understand — or it is the
        // story, whose editor is in the middle.
        parsed && !parsed.ok
          ? h('div', { class: 'pad hint muted' }, `Showing the text because ${parsed.reason}.`)
          : null,
        inEditor
          ? h('div', {
            class: 'pad hint muted',
            text: isAchievementsPath(S.open.path)
              ? 'This is the text behind the achievements under Smell. Close it here to go back to editing there.'
              : 'This is the text behind Write. Close it here to go back to editing there.',
          })
          : null,
        /\.svg$/i.test(S.open.path) ? svgPreview(area) : null,
        codeBox(area, S.open.path),
        h('div', { class: 'editor-bar row' },
          h('span', { class: 'hint muted', text: S.open.dirty ? 'Not saved yet' : 'Saved' }),
          h('div', { class: 'spacer' }),
          parsed?.ok
            ? h('button', {
              class: 'link', text: 'Show the fields',
              onclick: () => { S.open.asText = false; render(); },
            })
            : null,
          h('button', {
            class: 'filled', id: 'save-btn', text: 'Save',
            disabled: !S.open.dirty || frozen(),
            onclick: () => saveOpenFile(),
          }),
          // Closes only once the save really landed: a conflict or a failure
          // keeps the file open with the words still in it.
          h('button', {
            class: 'filled ok', id: 'save-close-btn', text: 'Save and close',
            disabled: !S.open.dirty || frozen(),
            onclick: async () => { if (await saveOpenFile()) closeOpenFile(); },
          })));
    }
  }
}
