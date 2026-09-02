# The editors move to the centre; the rail keeps the game

(Dann, 2026-09-01: "Maybe the editors (image, text, etc) should move to the
main space, so they're not crowded in with the preview, files, etc.")

## What is crowded, exactly

The rail is the preview and three tabs (spec.md §6, "The shell"). Under Files,
an open file *also* opens in the rail: coloured text, a config form, the pixel
editor, the sound editor or a media player, stacked under the preview and the
file list in a pane that defaults to 372px. Three fixes already bought room
inside that pane — the preview steps aside while a picture is open (the css
`:has(.drawing)` rule), the drag handle on the rail's edge, and at phone
width the tree hides behind an open editor. Each is a symptom of the same
thing: **the rail holds the file list and the file's editor at once**, and
one of them is always squeezed.

The centre already knows how to be an editor. The story editor is a *game
type*'s editor: one more pill in the row over the conversation, taking the
whole pane, the sidebar and the rail as they are (§6). The question is whether
a *file* can be opened the same way.

## The proposal

**A file opens in the centre as an editor tab; the rail shows the game and
its lists.**

- The rail: the preview, then Files · Versions · Scoreboard, exactly as now —
  but the Files tab is *only* the tree. Clicking a file opens it in the centre
  and highlights its row (what lights up is what can be clicked; what is open
  stays lit).
- The centre: an open file is a pill in the row over the conversation, beside
  the type's editors and before the chats — `hero.png`, `js/game.js` — with
  the same hairline between kinds of pill. Selecting it shows the pixel
  editor, the sound editor, the config form, the quiz editor or the text,
  full-width, with the file's bar (Rename, Duplicate, Delete, the version
  count, Save) where the story editor's bar is. Closing it (✕ on the pill,
  or Back) goes back to whichever chat or editor was under it.
- One file open at a time, as now — `S.open` stays one thing; the pill is
  how it is shown, not a second list. A second click on another file replaces
  it (unsaved work asks first, as now).
- `?file=` keeps its meaning in the address (§17) — it names the open file —
  and `?edit=` keeps naming a type's editor; the two are exclusive the way
  `?edit=` and `?chat=` are, because the centre shows one surface.

What it buys: a pixel editor as wide as the pane, so the 1-pixel brush on a
phone stops being the open question it is in TODO.md; a sound editor whose
sliders have a row each; code that wraps at a readable width; and a rail that
is always the game and the lists, never a squeezed third thing. And the
preview never steps aside again — the rule that hides it while a picture is
open goes.

## What it costs, and the traps (spec.md §17)

- **Two places want the same width.** The chat is the centre now; a person
  editing a sprite while a helper replies loses sight of the reply. The story
  editor already accepts this — a mention lands as a *mark* on the chat's
  pill — and the same answer holds: the chat fills behind the editor, the pill
  says so. Still, this is the change a person will feel first, and it is the
  one to watch in use.
- **Focus and scroll snapshots.** `focusSnapshot` keeps the file editor's
  caret across a render by the `editor-area` id; the id moves with the node,
  so nothing changes — but every `.scroll` container that moves needs its
  `data-scroll` name kept, or the code jumps to the top on the next render.
- **The URL is the view.** `openFile` pushes an entry; so does `showEditor`.
  A file opening in the centre must *replace* the editor surface (`S.editor`
  cleared, the way `openChat` clears it) rather than layering, or Back has
  two entries to walk for one click. And `closeOpenFile` returning its
  promise all the way up is the same rule as today, in a new place.
- **The pixel editor's canvas must stay open**: the three css rules that keep
  `.drawing` from collapsing to zero height (§6) were written for the rail's
  flex column and need restating for the centre's grid, or `spotOf` answers
  null for a 0-pixel canvas — which it does on purpose, so the failure is a
  brush that draws nothing rather than a frozen page. Check this first.
- **Phone width.** At 860px and under, the rail *is* the editor already (the
  tree hides). In the centre the same happens for free — the centre is the
  only pane on a phone — and the `only-narrow` ← button returns to the rail's
  list. Simpler than now, if anything.
- **Keyboard**: Escape closes the open file today. Same key, same meaning.

## What does not move

- The **story editor** and every type editor: they are already there.
- **Versions** and its diffs: a diff is about the game, not a file, and it
  belongs beside the version list. `patchFor` narrowing to one file keeps
  working from the open file's bar (`Show changes` opens Versions filtered).
- **Scoreboard**: it is the rail's, and it moderates the game.
- **Upload**, **+ New file**, **+ Draw a picture**, **+ Make a sound** stay
  at the top of the tree — they make files; the file then opens in the
  centre.

## A smaller step first

Before moving anything: **let the open file take the whole rail** — hide the
tree while a file is open (as the phone layout already does), with the file's
bar holding `← Files`. It is a css rule and one button, it removes the
squeeze, and living with it for a week says whether the crowding was the
tree or the width. If the width, the centre is the answer and this note is
the plan. If the tree, the smaller step was the fix.

## Build order (if the centre)

1. `S.open` renders in the centre when set; the rail's Files tab draws the
   tree only. The pill. Back and `?file=`. Escape.
2. The pixel and sound editors' layout at the new width (the canvas rules).
3. Drop the `:has(.drawing)` preview rule and the rail-width workarounds
   that were only there for the squeeze.
4. spec.md §6 "The shell" and §17 "Panes"; GLOSSARY *editor* grows a
   sentence (a file's editor is one too, now).

## Open question

Does the pill say the file's *path* or its *name*? `js/game.js` is a path a
kid can read; `hero.png` is a name. Path, truncated from the left, so two
`style.css` files are never one pill.
