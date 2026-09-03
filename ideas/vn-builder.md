# The visual novel as a game type: editors, the guide, the fill

Dann, 2026-09-01, three conversations. First: the story editor should be the
game's main surface, TyranoBuilder the model. Second: templates should become
**game types** that decide the interface and how helpers help; the author
should be *prompted* through the story rather than handed an empty tool or a
half-baked one to dismantle; every step gets a "fill it in for me"; stand-in
art should be makeable on the spot; a standard set of characters and
backgrounds should be found. Third, settling the layout: **an editor is a tab
in the centre pane beside the chats**, taking the whole pane the way a chat
does — no narrow chat beside it, no drawer, the sidebar and the rail as they
are. Missing a helper's reply while on the scene tab is no worse than missing
it while on another chat's, and a type may bring three or four editors. This
is the plan for all of it, in build order. Nothing here is built.

## What TyranoBuilder gets right, and what of it fits

TyranoBuilder's editor is three regions: a **scene list**, the open scene as a
**vertical list of components** run top to bottom (text, character, background,
sound, choice, jump), and a **stage** showing what the player sees at the
selected component, with its parameters beside it. Drag-and-drop throughout;
the preview runs from where you are.

What fits now, without touching the story's shape: the three regions, the
stage, selecting a step and seeing it, dragging lines into order, jumping to
where a choice leads. What does not fit yet: components our shape has no word
for — a person standing left or right, two people up at once, music across
scenes, a picture change mid-scene. Each is a change to `config/story.js`'s
shape *and* to the template's `js/story.js` (see the end). What TyranoBuilder
does not have and we do: the five structural checks, and the guide.

## 1. A game type

A **game type** is what a template grows into: recorded on the project, and
deciding which **editors** the centre offers, how helpers help (a section of
the preamble, the built-in fills), the guide, and the standard art. The
template — the starter tree — is one part of a type.

- `projects.type TEXT NULL`, `addColumnIfMissing`. Set at creation from
  `body.template`; copied by fork. Null is a free-form game — everything made
  so far — and stays the default: nothing changes for a game that has no type.
  Values are the `index.json` keys (`visual-novel`, `quiz`).
- Games made from the visual novel before the column: `projectPublic` fills a
  null type in once, from the tree (`config/story.js` present →
  `visual-novel`, `config/questions.js` → `quiz`), and writes it back. One
  read of the tree per project, once ever.
- Not a file in the tree, on purpose: a helper must not be able to change
  which editors somebody sees with a `write_file`.
- `index.json` stays the type's manifest — title, what, heart, starter tree.
  The studio code for a type lives in `public/` beside the rest, registered
  in one place: `public/game-types.js` maps a type to its editors —
  `{ 'visual-novel': { editors: [{ id: 'story', label: 'Story', render }] } }`
  — so a second editor for a type, or a type with four, is one entry each.
  The quiz can get a centre editor the same way later; today its form opens
  in the rail and stays there.
- The preamble gains a per-type section: for a visual novel, what the story
  file is, that the editor is shape-locked (already said), that pictures are
  asked for by their story name. `orchestrator.test.js` asserts it.

GLOSSARY: **game type** (new); *game template* narrows to "the type's starter
tree"; **editor** (new): a centre-pane surface a game type brings, a tab
beside the chats, taking the whole pane; the *story editor* is one.

## 2. The centre pane: chats and editors as tabs

The row over the conversation already holds the chat pills. An editor is one
more pill — first in the row, before the chats, with a hairline between them
so the two kinds read as two kinds. Which tab is showing is the centre's one
piece of state: a chat, or an editor. The game bar above stays exactly where
it is, whatever the tab; the sidebar stays; the rail stays. The whole layout
change is *the body of the centre pane is a chat or an editor*.

- **On a chat tab**: the row is as today — `Add chat`, the pills, the helper
  chips, `+`. **On an editor tab**: `Add chat` and the pills, and nothing at
  the right — the chips and the `+` are the open chat's, and no chat is open.
- **The chat behind the editor is still the chat**: `S.chat` stays what it
  was, the composer keeps its draft, the live buffers keep filling, a mention
  puts its mark on the pill. Switching back paints what arrived.
- **Which tab a game opens on**: the address if it says, else what is
  remembered for this game, else the type's first editor for a game that has
  one and the front door for a game that does not. `prefs('chat-<slug>')`
  widens to remember an editor id as well as a chat id. A new visual novel
  opens on the story editor with the guide's first question; the heart file no
  longer opens in the rail.
- **URL**: `?edit=story` when an editor is showing, and `?scene=<key>` for the
  selected scene when it is not the first; `?chat=` is absent while an editor
  is up (Back to the chat is the address without `?edit=`). `applyView` reads
  both; an unknown editor id falls back to the chat.
- **Narrow**: nothing new — the centre pane is the pane it always was.
- **A story that has grown past the shape** keeps its tab; the tab's body
  says *config/story.js has grown past the story editor — open it on the
  right* with the reason. The type decides the tabs; the file's shape decides
  what a tab can show.
- **In the rail `config/story.js` opens as plain text** — the form is gone,
  the editor is in the middle. While that text is open the story tab's body
  says so and waits.

## 3. The story editor

Full-width centre, TyranoBuilder's regions inside one tab:

```
 bar:   🔒 Name ✎                       [Fork] [Published!] [Editors]
 row:   [Add chat]  [Story] │ [Humans only] [Building]
 ┌─────────────┬───────────────────────────────────────────────┐
 │ SCENES  6·2 │  guide: "Knock" leads to the hall. What does  │
 │ ▸ porch  st │  the hall look like?  [ ........ ] [Make one] │
 │   window    ├───────────────────────────────────────────────┤
 │   hall  ⚠1 │                  stage                        │
 │   kitchen   │      picture · portrait · name · words        │
 │   tea       ├───────────────────────────────────────────────┤
 │   away      │ hall                  comes from: porch, window
 │ + Add scene │ ▤ Picture   hall.png                          │
 │             │ ♪ Sound     page                              │
 │ PEOPLE      │ ▣ Mila·happy  Oh! I thought you had forgotten.│
 │   Mila      │ ▣ the story   The house smells of toast…      │
 │   The cat   │ + Add a line                                  │
 │ + Add       │ ⇢ Then: go straight on to  kitchen →          │
 └─────────────┤ Saved · Show the text · Try this scene · [Save]
```

**The scene strip** (left, ~200px): every scene — name, `⚠ n`, its tail
(*3 choices* / *→ hall* / *the end*), *starts here* on the first — then the
**cast** under a second head; `+ Add a scene`, `+ Add someone`; the checks'
total at the top. Inside the editor rather than a rail tab: the centre is full
width now, so the strip costs the scene nothing; an editor that carries its own
navigation is self-contained, which is what lets a type bring several without
each wanting a rail tab; and the rail stays about files, versions and scores.
(Dann asked whether scenes and people could be a rail tab. They could; with
the editor full-width the reason to has gone.)

**The guide's card** (§4), when it has a question, at the top of the main
column.

**The stage**: what the player sees at the selected **step**, drawn by the
studio from the *unsaved* model — instant, no commit. The scene's picture
(contain, bottom-aligned), the line's portrait, the speaker's name in the
look's accent, the words in a box along the bottom in the deep colour; on the
exit step the choices as buttons (a `need`ed one wearing *only if …*),
*→ kitchen* for a go, nothing after an ending's last line. ~38% of the pane,
min 180px. Images from the file routes, held as object URLs in a small cache
keyed by path (the reserved-images pattern: the routes send `no-store`),
dropped for the paths a `files.changed` names. A missing picture is the deep
colour, and the problems list says which. One muted line under it: *Close to
what the player sees — Try this scene shows the real thing.* A heavily
restyled `css/style.css` will not be reflected, and it says so once.

**The steps**: the scene as rows read top to bottom, the way TyranoBuilder's
scene reads. The scene's header — its name (renaming brings every way in
with it), *comes from: porch, window* as links that jump, *Start here* on a
non-first scene (moves it to the front; order only decides where the story
starts, so no dragging scenes), *Remove* (disabled while something leads
here). `Picture` and `Sound`: one row each — a select over `assets/images/`
and `assets/sounds/*.wav`, a thumbnail beside the picture, ▶ beside the
sound; fixed rows, since in our shape they are the scene's. One row per
**line**: portrait thumbnail, the speaker (or *the story*), the words. The
selected row opens **in place** — the studio's rule — with who, mood, the
words as a textarea, ▲ ▼ ✕; typing repaints the stage's words in place, no
render. Rows drag into order (`draggable`, an insertion line); ▲ ▼ are the
keyboard's way. `+ Add a line`. The **exit**: *Then* — the player chooses /
go straight on to / the story ends here; choices as sub-rows with the words,
*goes to* (select, and a `→` that jumps), *remembers*, *only if*; selecting
the exit puts the choices on the stage. Then the scene's problems, from
`storyChecks`.

A selected **person** takes the main column: the stage shows their portrait at
the selected mood; the rows are their name, one row per mood with its
thumbnail and the file it expects, `+ Add a mood`, ✕ (disabled while they
still speak).

**The bar under it**: *Saved* / *Not saved yet*, *Show the text* (opens
`config/story.js` as text in the rail, saving first if there is anything to
save), *Try this scene* (saves first if needed, then reloads the preview at
`?scene=` — TyranoBuilder does the same before its preview; a commit per try
is a deliberate act where a commit per click through the steps would not be),
**Save**. Explicit Save like every editor here: a save is a commit and a
preview reload, so autosave would be a commit a keystroke.

## 4. The guide

Not an empty tool and not a half-baked story: the author is walked through by
questions, one at a time, each writing into the story. **Deterministic**: the
next question is a function of what the story is missing, and the story
editor's checks already know what that is. The guide is the checks, asked as
questions with an answer box. So it works on a new story, on a half-built one,
and on one somebody has been hand-editing for a week, and needs no state of
its own beyond what the author skipped (a set per game in `prefs`, cleared by
*Ask me again*).

The card asks one thing. The order, roughly:

1. *Who is the main character?* → a name → a cast key, one mood. *How do they
   usually look?* → a picture: from the standard set (§6), *Draw*, *Upload*,
   *Make one for me* (§5), or *Later*.
2. *Where does the story start?* → a place name → the first scene. *What does
   it look like?* → the same four ways to a picture.
3. *What happens first?* → a line or two, typed, or *Fill it in for me* (§5)
   from a sentence about what happens.
4. *Who else is there?* → another person, or *Nobody yet*.
5. *What do they say to each other?* → lines, typed or filled.
6. *Then what?* → the player chooses (each choice: its words, and *where does
   it lead?* → a new scene by name), the story goes straight on to a new
   scene, or the story ends.
7. Every scene the story points at but has not filled — a choice's target with
   no lines, a scene with no picture — comes back round as its own question:
   *"Knock" leads to the hall. What does the hall look like?*
8. Nothing missing → *Your story is ready. ▶ Try it*, and the card goes away.

Answering selects what it changed, so the stage and the steps follow the
guide. Every answer is an edit to the model — Save commits, as always. The
author can ignore the card and click around; it re-asks from the model.

Two things follow. **The template ships empty**: no cast, one scene with no
lines, so the first thing an author meets is the first question — and
`js/story.js` gets one line so an empty story shows the title and *the end*
rather than an empty stage. **The Mila story becomes an example**, one click
in the guide (*Put in an example story*) — its five pictures move into the
standard set (§6) and come with it.

GLOSSARY: **guide** (new).

## 5. Fill it in for me, and stand-ins

Both are the studio's own small requests to the model: no helper row, no chat,
no tools, no transcript, no file block — a **tiny prompt** built from the
story. Server-side, because the key never reaches a browser, and through the
same two walls every reply goes through: the studio budget and the author's
allowance (spec/ §10). Billed to whoever pressed the button.

**Fill**: `POST /api/projects/:slug/story/fill` with the scene key and the
author's sentence. The prompt is the cast (names, a line about each), the
scene (its place, a line about it), the lines said so far in it, and the
sentence. Flash, thinking off, a small `max_tokens`, JSON out:
`[{who, say}]` in the story's own keys. The answer is *inserted as lines the
author can edit or delete*; nothing is committed until Save. The "line about"
a person or a place is where the tiny prompt gets its material, so the shape
grows two optional keys — `about` on a cast member, `about` on a scene — which
the game ignores and the editor shows as one field. The one shape change in
this plan, and it is ours (`storyModel`, the serializer, the test).

**Stand-ins**: two rungs, so creation never gets stuck. The **plain stand-in**
costs nothing and never fails: a flat card in the look's colours with the
place or person's name on it, drawn by the studio and saved as the PNG the
story already expects. *Make one for me* is the second rung:
`POST /api/projects/:slug/story/picture` with a description and a kind
(background or portrait) asks for a simple flat SVG — a few shapes, the
look's colours, no text — at the size the kind wants; the studio probes it in
an `<img>` (the svg-live pattern: no scripts run, nothing loads), draws it to
a canvas and saves it as `.png` under the name the story expects. Portraits
stay `assets/sprites/<who>-<mood>.png`, the game stays as it is, the pixel
editor opens the result like any other picture. A reply that is not an SVG, or
one that will not draw, falls back to the plain stand-in with a banner. It
will not be good art — it is what lets the author carry on until they draw or
upload the real one.

Neither is a *fire*: no message row, no receipt, no eligibility, no cooldown.
Tokens count on `user_tokens` and `studio_state` the way a fire's do. A new
`llm.complete()` beside `llm.stream()` — one non-streamed request, JSON body
— is the only addition to the DeepSeek client; the fake LLM in the tests
scripts it.

These are the same idea ideas/achievements.md reaches at its end and TODO.md
calls a *microhelper*: a fixed-purpose helper the studio ships rather than a
row somebody makes. The fill and the picture maker would be its second and
third, and smaller than the first — no tools, one request, JSON back. If that
word is adopted, they wear it; the buttons keep their own words either way.

GLOSSARY: **fill** and **stand-in** (new). The UI never says "prompt" or
"model": the buttons say *Fill it in for me* and *Make one for me*.

## 6. The standard set

Characters and backgrounds an author can pick without drawing. Not in the
template tree: the template is copied whole into every new game, so a set of
any size would bloat every repository. It lives studio-side under `public/`
like `studio-lib/`, listed in an `index.json` (name, kind, who made it,
licence), and one picture is **copied into the game when picked** — one file,
one commit, the import route's pattern — so the game's repository holds
exactly the art it uses. The five template pictures move into it as its first
entries. Finding the rest is a TODO line: CC0 first, kid-safe, small, one
style or two that sit together, portraits with several moods each.

## State and plumbing

- `S.editor`: `null` for a chat, else the editor id showing (`'story'`).
  `S.chat` is untouched by it. `renderChat` renders the body from the type's
  editor when `S.editor` is set and the thread otherwise; the room row shows
  the editor pills before the chat pills and hides the chips on an editor.
- `S.story`: `null` for a game that is not this type; else
  `{ text, etag, model, dirty, scene, step, person }`, or `{ grown: reason }`
  when the file will not read. `step` is
  `'scene' | 'picture' | 'sound' | <line index> | 'exit'`.
- `loadStory()` runs with `loadPalette` in `openProject`, before `applyView`,
  so `?edit=` and `?scene=` can land. Re-run on a `files.changed` naming the
  file unless `dirty`, in which case the banner says the story changed
  underneath and Save will ask — which also covers our own save's event
  arriving before the PUT answers.
- `saveStory()`: PUT with `if-match`; 409 opens a `story-conflict` dialog —
  *Keep theirs* reloads, *Keep mine* forces. Success: etag, `dirty = false`,
  `previewNonce += 1`.
- **Unsaved edits are parked per game** when the game is left and put back on
  return while the file's etag still matches; otherwise dropped with a banner.
  The composer's words are the one other thing git cannot recover, and a
  mis-click in the sidebar must not cost a scene. (Text files in the rail
  still drop on leaving; unchanged.)
- URL: `?edit=<id>`, `?scene=<key>`. Written by `urlNow`, read by
  `applyView`. Switching tab or scene is a navigation and its own entry;
  selecting a step is not. Closes the `?scene=` TODO.
- `S.tryScene` stops depending on `S.open`.
- Pure and tested in `story-editor.js`: `stageFor(model, key, step)`,
  `leadingTo`, `moveLine`, `startAt`, `nextQuestion(model, paths, skipped)`.
  The interface in `story-form.js`, rewritten (the file keeps its name; its
  header will say it is no longer a form).

## Build order

All four steps are built and green. Two TODO lines outlive the plan: the
phone-width re-check from step 1, and finding more art for the standard set —
step 4 built the shelf that picks from it, not the pictures. spec/ and
GLOSSARY.md are the state; this file is the argument.

1. **Type + the editor tab + the builder.** The column and the backfill;
   `game-types.js`; the editor pill and the centre body; the strip, stage,
   steps and editor bar; `?edit=` and `?scene=`; the rail's story.js as text;
   a new visual novel opening on its editor. `npm test` for the pure helpers;
   the browser check against a fake-LLM studio (as `tmp/trace-studio.mjs`
   boots one): the tab beside the chats, the chips coming and going with it,
   a reply arriving behind the editor and its pill marking a mention, the
   stage following the steps, drag and ▲▼, Save is one commit and the preview
   reloads, `?edit=`/`?scene=` on reload and Back, a free-form game unchanged,
   the text open in the rail, a grown story.
2. **The guide, plain stand-ins, the empty template, the example.** No model
   calls yet; the `about` keys; `nextQuestion` tested against the shipped
   example and an empty story.
3. **Fill and Make one for me.** `llm.complete`, the two routes, the two
   walls, the fake LLM scripting both; the SVG probe-and-rasterise.
4. **The standard set** — the TODO to find it, then the studio-side library
   and the pick-and-copy.

## Decided

(Dann, 2026-09-01 — every default taken.)

1. An editor is a tab beside the chats, taking the whole centre pane. No
   narrow chat, no drawer; the sidebar and the rail stay as they are.
2. The scene list lives inside the story editor, not in a rail tab.
3. The term stays **story editor**. New terms, to enter GLOSSARY.md in the
   build that introduces each: **game type** and **editor** (step 1),
   **step** and **stage** (step 1), **guide** (step 2), **fill** and
   **stand-in** (step 3). Each is surfaced in that response's TERMS.
4. The template ships empty; the Mila story becomes the one-click example and
   its pictures seed the standard set (step 2).
5. Built in a fresh session, in the build order above, one step per session
   or so.

## For the build session

- Read CLAUDE.md, then spec/ §3 (`projects`), §4 (templates and the
  heart), §6 (the shell, the game templates section, the view and the URL),
  §8 (the preamble), then this file. The code to know before touching
  anything: `public/main.js` (`S`, `openProject`, `applyView`/`urlNow`,
  `render`, `renderFilesTab`'s editor branch), `public/chat.js`
  (`renderChatTabs`, `renderChat`), `public/story-editor.js` and
  `public/story-form.js`, `public/dialogs.js` (`new-project`),
  `server/routes/projects.js` (create, `projectPublic`), `server/db.js`
  (`addColumnIfMissing`).
- `git status` first. Several sessions edit this tree at once; read a
  file's diff before staging it, and stage only your own hunks' files.
- ⚠️ The achievements build (ideas/achievements.md) also edits the visual
  novel template — its `index.html` tags and `js/story.js` saying its
  moments. Step 2 here empties the same template's story and touches
  `js/story.js` too. Whichever lands second rebases on the other's template;
  neither owns it.
- The existing `renderStoryForm` is the reference for every field's words and
  behaviour — keep the words, change the shape. `story-editor.test.js`'s
  byte-identical round trip must stay green through the `about` keys: absent
  keys write nothing.
- Every button the preamble gains is asserted in `orchestrator.test.js`, like
  the two editors before it.
- Docs are part of each step, not after it: spec/ §3 (the column), §6 (the
  shell and templates sections — the centre's tabs, the editor, the URL's
  `?edit=`/`?scene=`), §8 (the type section of the preamble), §10 and §16 for
  step 3; GLOSSARY.md per the terms above; CLAUDE.md's current state; and the
  TODO.md line deleted in the same commit as the last step, the standard-set
  line staying until step 4.

## Later: growing the shape

Each is a change to `config/story.js`'s shape and to `js/story.js`, and each
costs the editor a step kind and the game a rule. In the order they seem worth
it: where a person stands (`at: "left" | "right"`, portraits staying up —
TyranoBuilder's Join / Exit); music across scenes (`music:` on a scene,
`sound:` stays the one-shot); a picture change mid-scene; letters one at a
time and a back button (both in the template's SPEC.md already); numbers
where a switch is yes or no.
