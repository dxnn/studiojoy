# The calm shell

(Dann, 2026-09-02: "The studio is way too busy. I want it to have many fewer
buttons." The mock-up is `extra/calm/` — gitignored, so this note has to stand
without it. Its layout is the point; the logo, the background and the type
are stubs.)

## What is busy, counted

A visual novel with a file open shows roughly twenty controls before any
content, in three tab strips and four bars:

- **Sidebar**: `+ New game`, Search, Games · Chats · Crew, `«`, Sign out.
- **The game's bar**: `☰`, `🔒`, `✎`, `Fork`, the publish button, `Editors`,
  and `Reopen` on an archived game.
- **The row under it**: `Add chat`, the chat pills, an editor pill with a
  hairline, the helper chips each with `✕`, and `+`.
- **The rail**: `Open`, `Hide ▲`, Files · Versions · Scoreboard ·
  Achievements, `Add a file`, `Unpin all`, a pin box on every row, and the
  open file's bar — `Rename`, `Duplicate`, `Copy to…`, `Share to studio…`,
  `Delete`, `✕` — over an editor with `Save` and `Save and close`.
- **The story editor**: `+ Add a scene`, `+ Add someone`, and on every scene
  `Start here`, `Duplicate`, `Remove`; on every line `≡ ▲ ▼ ✕`; on every choice
  `✕`; `Show the text`, `Try this scene`, `Save`.

The mock replaces all of it with five things: **one row of modes**, **one
primary button**, **one `···` on every thing**, **one pane for the selected
thing**, and **a whisper where a status used to be a button**.

## The shape

Three panes, as now. What changes is what each one is for.

- **The sidebar** stays as it is. It is already the mock's left rail.
- **The centre** is the game's name with its `···` and the publish whisper,
  then the **mode row**, then the mode's body, then a bottom bar: the saved
  whisper, `Undo` when there is something to undo, and the mode's one primary
  button at the right.
- **The rail** is the preview as today — `Open`, `Hide ▲`, the problems and
  moments panels painted in place — and under it, when something is selected,
  that thing's fields and its `···` (the *inspector*, name not settled). No
  tabs. Nothing selected, the rail is the running game and nothing else. At
  phone width the inspector overlays, as the mock has it.

The rule the bar already follows carries into every menu: **an item you may
not press is absent, never greyed**. `frozen()` stops disabling controls and
starts leaving them out.

## Modes come from the type

`public/game-types.js` already maps a type to its editors. It grows to map a
type to its modes, in order:

| type | modes |
|---|---|
| free-form (null) | Chat · Pics · Hear · Code · Share |
| visual novel | Chat · Write · Pics · Hear · Code · Share |
| quiz | Chat · Questions · Pics · Hear · Code · Share |

An *editor* becomes one kind of mode — Write is the story editor, Questions
the quiz editor. `?mode=` replaces `?tab=` and `?edit=` in the address;
`?chat=`, `?scene=`, `?file=` and `?version=` keep their meanings inside a
mode. A game opens on what the address says, else what this browser
remembers, else its type's first editor, else Chat — the rule as now with
"mode" for "editor".

**Play is not a mode.** Decided 2026-09-02: the preview lives in the rail
and only there, so the loop — ask, commit, reload, play, ask — stays one pane
away whatever mode is open. What the mock's Play held besides the frame
(scores, achievements) goes to Share; what it reported (problems, moments) is
the rail's already.

The primary button is one per mode: Chat → `Send`, Write → `Add a scene`,
Pics → `Add a picture`, Hear → `Add a sound`, Code → `Add a file`, Share →
`Publish` or `Take it down`. An editor's button is absent for everybody else.

## Where the chat goes

**Chat is the first mode.** The thing Dann is least sure of; try it and see.

Inside it: the chat pills (Humans only, Building, the rest) with the helper
chips at the right, then the thread, then the composer — whose `Send` is the
mode's primary button. `Add chat` goes behind the game's `···`. The `+` that
puts a helper in stays beside the chips: in a new game it is the commonest
press there is, and absent in Humans only rather than greyed. A chip's `✕`
goes behind the chip: press a helper to see its state (chatty, thinking
level) and to take it out.

The cost is that a reply lands while you are in Write. Two things make it
survivable, both built: the *mark* on the Chat pill says words arrived, and
the preview in the rail reloads on the commit, so the work itself is seen
from any mode. If a week of use says the mark is not enough, the fallback is
the mock's inspector slot: the thread in the rail while nothing is selected.

## Where files go: by kind, not by folder

The tree stops being the way in. Three modes each show one kind of thing,
and the tree survives as the last of them.

- **Pics** — every picture in the game, grouped by what it is. For any game:
  *Sprites* (`assets/sprites/`, strips shown as their first frame), *Pictures*
  (`assets/images/`), and the three *reserved images* by what each dresses.
  For a visual novel, *Characters* over *Places*: a character is a `CAST`
  entry with its moods as one card, a place is a background. Cards, as the
  mock has them. Pressing a card selects it into the inspector; pressing the
  picture on a selected card opens it in the centre in the *pixel editor*,
  full width — ideas/editors-in-the-centre.md, arriving by another road. `Add
  a picture` is the *add-file* dialog narrowed to pictures: draw one, upload
  one, or pick one from the *shelf*.
- **Hear** — sounds (`assets/sounds/`) over music (`assets/music/`): a row each
  with `▶`, the name and the *sound note*. Selecting a studio-made sound puts
  the *sound editor*'s preset, shape and sliders in the inspector, where a
  column of sliders fits; a sound from elsewhere gets the player. `Add a
  sound` makes a blip and selects it, as now.
- **Code** — the tree as it is today: folders, the pin boxes, the library rows,
  `Unpin all` when there are pins. A file opens in the centre as coloured text
  or a *config form*. `js/story.js` and `config/quiz.js` show here as text; Write
  and Questions are their editors. `BRIEF.md` and the *studio library* live
  here and nowhere else.

⚠️ The **words on the buttons are in the preamble** and `orchestrator.test.js`
asserts each one. `Add a file`, `Pick a picture`, `Share to studio…`,
`Editors`, `Bring everything back` — every move or rename in this plan is a
preamble edit in the same change, or the suite goes red and a helper tells a
kid to press a button that is not there.

## `···` on every thing

One menu shape, one order, items absent when they do not apply, danger last
in crimson:

> Rename · Duplicate · Copy… · Start here · Delete

**One `Copy…`, and the dialog asks where.** `Copy to…` and `Share to
studio…` were two menu items for one act: this file, somewhere else. The copy
dialog offers *another game* (the list, as `Copy to…` has now) and, for a
picture, *the studio's collection* (the name and who drew it, as `Share to
studio…` asks now). Same two routes behind it; one word in front of them.

The things: the game, a chat, a helper chip, a scene, a line, a choice, a
character, a mood, a picture, a sound, a file, a version. What each loses:

- the open file's six-button bar → the file's `···` in the inspector;
- a scene's `Start here`, `Duplicate`, `Remove` → its `···`; the `≡` grip stays,
  it is a handle and not a button;
- a line's `▲ ▼ ✕` → *Move up*, *Move down*, *Delete* in its `···`; a choice's
  `✕` likewise;
- a version row's `Bring this file back` and `Bring everything back` → its `···`;
- the game's three *game actions* and the pencil → the game's `···`.

**The game's `···`**: Rename, Fork, Editors…, Publish or Take it down, Add
chat, Archive…. Fork is everybody's; Rename, Editors, Publish and Add chat are
an editor's; Archive is the originator's (below). The padlock and the publish
whisper stay as *state* next to the name; nothing about them is a button
outside the menu. This reverses a recorded decision — "three buttons and their
own state do not need hiding" (spec.md §6) — because the reason is no longer
local: every thing in the studio has one `···`, and the game is a thing.

### Archive

Decided 2026-09-02, and the same shape as `deluser` / `restoreuser`
(the studio's rule that the rare, hard-to-reverse operation lives in a
terminal, not behind a button):

- **Archive is in the game's `···`, with a confirmation dialog** that says
  what archiving does: no more edits, still playable, still in the catalog's
  history, and only somebody at the terminal brings it back.
- **Only the originator may archive** — `projects.created_by`, which spec.md
  §3 calls "display only" today and which becomes load-bearing. Not
  authors, not an open game's whole studio: taking a game out is about the
  game, not about editing it. An originator who has been *removed* leaves a
  game nobody can archive from the interface; the terminal can.
- **A published game cannot be archived.** Take it down first, in the same
  menu. A game people can find in the catalog is not a game to quietly stop.
- **Unarchive is `npm run unarchive -- <slug>`**, a new `bin/` script in the
  pair pattern: with no slug it lists what is archived. `Reopen` leaves the
  interface. `POST /api/projects/:slug/archive` loses its boolean and becomes
  one-way, checking `created_by` and `published`; §6's route row, §11's rules
  and §12's invariant list all change with it.

## The inspector

The rail, below the preview, for the selected thing. Selecting is a click on
the thing's row or card; the same click again deselects; `✕` in its head does
too. The fields by kind:

- **scene** — its name, its `about` note, its picture, its music. The picture
  and music rows move here from the scene's body in the centre, which keeps
  the stage, the lines and the choices as the mock lays them out.
- **character** — name, moods (each a picture), and its `about`.
- **picture** — where it lives, and *Swap it for…*.
- **sound** — the *sound editor*.
- **file** — where it lives, size, versions of it.

**Pickers open the shelf.** A picture or a music field shows the current one
as a thumbnail and a name, and pressing it opens the *shelf* as a dialog with
a filter — the standard set, the studio collection and this game's own
pictures. Not chips: the mock's chips are a stub for three pictures and there
are forty-two before anybody adds one. This is the TODO line about the shelf
outgrowing a strip, answered.

## Saving: write promptly, commit lazily

Decided 2026-09-02. The mock autosaves and says `saved` where the studio has
`Save`. Every write today is a commit, and a commit costs three things the
spec has already measured: a Versions row, a preview restart, and a
prompt-cache miss for every helper from that file onward (§5, §8, §17).
Scores went into SQLite for exactly this. So an edit reaches the tree on one
clock and history on another:

| event | delay |
|---|---|
| a keystroke in a text field | written on blur, or 2 s after typing stops |
| a stroke, a slider, a `···` action | written 2 s after the last one |
| tree write → commit | 45 s idle, or leaving the scene, the mode or the game |
| a helper about to fire | commit first, always |
| fork, rollback, restore, diff, the versions list | commit first, always |

- **The tree takes the edit; the commit waits.** One commit squashes the run.
  Its author is the person who typed, so Versions keeps telling the truth.
- ⚠️ **A fire commits the person's pending edits first, as the person's
  commit**, inside the *project mutex* and before the fire reads its context.
  The helper sees what was typed, and the helper's own commit never swallows
  a person's work under its name. Same before anything that reads history.
- **The preview reloads on the write, debounced, not on the commit.** §17's
  "every commit bumps `previewNonce`" becomes "every write". `files.changed`
  already fires from the write routes; the Versions list refreshes on the
  commit, which is a second event or a flag on the first — decide at build.
- **Spec §5 changes.** "No uncommitted state visible to the API" becomes: a
  response that says saved has the bytes on disk; the commit may follow. A
  crash inside the window loses the *attribution* of one person's last
  forty-five seconds, never the bytes — the next commit picks them up, which
  is §5's accepted failure mode already.
- **Code's text editor keeps `Save`.** Half-typed code is a broken game: the
  preview would reload into a syntax error, the *reporter* would post it, and
  the helpers would read it. Autosave belongs where every intermediate state
  is a valid thing — a story, a picture, a sound, a form field on blur.
- **`Undo` in the bottom bar** undoes the last `···` action — a delete, a
  move, a duplicate — while it is still uncommitted; typing has the field's
  own ⌘Z and the pixel editor its own stack. Older than that is Versions. One
  undo, one history.
- The story editor's parked edits, the stale check ("changed underneath —
  Save will ask") and `Save and close` go with the button.

## Build order

Four steps, each green on its own, each with the spec and glossary changes
in the same commit.

1. **Lazy commits.** Server: a pending commit per project inside the mutex,
   the commit-first rule before a fire and before history reads,
   `npm run unarchive`'s sibling if any. Client: the story editor loses
   `Save` and gains the whisper; `previewNonce` on write. spec.md §5, §17;
   `files.test.js`, `orchestrator.test.js`.
2. **The mode row and the rail without tabs.** Chat as a mode; Files into
   Code, Versions · Scoreboard · Achievements into Share; the game's `···`
   with Archive, the confirmation, the one-way route and `bin/unarchive.js`;
   `Reopen` gone; `?mode=`. Surfaces move, none is redesigned. spec.md §3, §6
   "The shell", §11, §12; GLOSSARY *mode*, *editor*, *game actions*, *view*.
3. **`···` on every thing, and the inspector.** The file bar, the scene and
   line and choice buttons, the version rows; the scene's picture and music
   into the inspector; the shelf as a dialog with a filter. The preamble's
   button names. spec.md §6; GLOSSARY *shelf*, *game actions* pruned.
4. **Pics and Hear.** The by-kind views; Characters and Places; the pixel
   editor and the text editor opening in the centre; the `:has(.drawing)`
   preview rule and the rail-width workarounds dropped. ideas/
   editors-in-the-centre.md moves to tmp/ with this step. spec.md §6, §17
   "Panes"; GLOSSARY *pixel editor*, *sound editor*, *cast*.

## Open questions

- **The inspector's name.** Used here for want of one; not in the glossary
  until it is chosen.
- **Share carries six sections** — the link and its state, Editors, Versions,
  Scoreboard, Achievements. If it reads as a heap, the players' half
  (Scoreboard, Achievements) becomes a *Players* mode, the studio side of the
  *players page*. Default: one mode, fewer pills.
- **`config/look.js`** is a config form under Code. A colours card at the top
  of Pics would put the game's four colours where its pictures are; decide
  after step 4 is felt.
- **Phone width.** The mode row scrolls sideways; the rail overlays; the
  sidebar as today. The story editor at 390px is already a TODO line and this
  changes its layout, so re-check after step 3.
- **Chat as a mode**, after a week.
