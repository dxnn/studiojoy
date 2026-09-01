# Unbridled Joy

The studio's name, and the wordmark: UNBRIDLED, the little controller lying
between them, JOY. The directory and the npm package are still `gamestudio`
— they are paths, not names.

A private studio where a few trusted people and DeepSeek-backed agents build
browser games together. Each **game project** is a chat thread plus a
versioned working tree of files under `games/<slug>/`. Agents read the tree
and edit it with tools; every edit is a git commit. Games are publicly
playable, the studio needs a login.

## Source of truth

`spec.md` is the v0 design-of-record: data model, routes, SSE events, limits,
accepted tradeoffs, invariants. Read it before any non-trivial change. §14 is
DeepSeek's API behaviour as *measured*, not assumed — don't re-guess it.

`GLOSSARY.md` is the naming authority. `TODO.md` is the build order.

## Commands

- `npm test` — the full suite. `node:test` against `:memory:` SQLite, a temp
  `GAMES_DIR`, and a scripted fake LLM. No network, no API key.
- `npm start` — needs `DEEPSEEK_API_KEY`; fails fast without it.
- `npm run smoke` — one live DeepSeek round trip; needs the key, not in `npm test`.
- `npm run adduser -- <email> "<Name>"` — makes an account without a studio
  running; the admin panel does the same from a browser.
- `npm run deluser -- <email>` — ⚠️ the *only* way somebody leaves the studio:
  no route, no button. A soft delete: `users.deleted = 1` and their sessions,
  never a DELETE. `npm run restoreuser -- <email>` is the undo; with no email
  it lists who is out.
- `npm run backup -- [dest]` — one consistent copy of the database
  (`VACUUM INTO`), safe while the studio runs. The game trees recover
  themselves from git; the chats and accounts only live here.
- `npm run sweep` — bring every game's studio library up to date: missing
  libraries added, held ones raised, the game's own files never touched.
  One studio-authored commit per game; archived games skipped. Run it on
  the machine holding the games, ideally while the studio is quiet.

Ports default to 8100 (studio) and 8101 (games). 8090 is deliberately left
alone: `new-y` defaults to it and is expected to be running at the same time.

Running locally in this sandbox, both gotchas below apply at once:

```sh
export GS=$TMPDIR/gamestudio-dev
echo hunter2 | DB_PATH=$GS/db node bin/adduser.js you@example.com "You"
NODE_OPTIONS=--use-env-proxy DEEPSEEK_API_KEY=$(cat tmp/deepseek.key) \
  DB_PATH=$GS/db GAMES_DIR=$GS/games npm start
```

No build step, no linter, no dependencies. Node ≥ 24, ESM.

`deploy/` is the runbook for a real server: pm2 definition, env template,
push-to-deploy hook. One process serves both hostnames, so it is one repo and
one pm2 app — the thing every generic guide gets wrong here.

## Invariants worth keeping

- `server/files/paths.js` is the security boundary. Everything touching a file
  goes through it. It returns a reason for tools, throws a 400 for routes. It
  also owns `isLibraryPath`: `studio/` is readable by agents and never writable
  by them.
- Every git command except `init` is pinned with `--git-dir`/`--work-tree`.
  Unpinned, git walks upward and finds whatever repo encloses `GAMES_DIR` —
  in development that's this checkout.
- The games listener never reads a cookie and serves nothing but static files
  from a project directory. It exists to be a separate origin (spec.md §7).
- Write-and-commit is serialised per project through `files/mutex.js`.
- A reasoning trace is never persisted and never replayed into a later request.
- `render()` replaces the whole tree, so anything the browser keeps on a node
  is lost unless it is snapshotted and put back: the composer's text and caret,
  every scroller's position, and the open dialog — which is built once and
  re-appended as the same node, never rebuilt mid-decision, because a
  background render used to wipe what was being typed into it. A new `.scroll`
  container needs a `data-scroll` name or it will jump to the top on the next
  render.
- ⚠️ Opening a file is several awaits long — bytes, then for a picture a decode
  and the palette, for a sound a second read — so clicks overlap. `openFile`
  takes a token and every step after an await drops its result if a newer open
  has started; `startDrawing` and `startSound` belong to the open that called
  them. Without that, two clicks in the list left whichever request finished
  last on screen, which is how one picture ended up under another one's name.
- ⚠️ Nothing calls `fetch` directly. `send()` does, and answers with status 0
  instead of throwing when there is no connection, so every `if (!res.ok)`
  already written covers a dead network. A failed request also sets
  `S.connected = false`, which paints a pill at the top of the window until the
  **stream** reopens — the SSE is the only thing holding a connection open, so
  it is what says whether there is one. A banner would have timed out and left
  somebody typing into a studio that could not hear them. That is the whole of what a dropped
  connection used to look like: a picture pane blank with nothing said, a click
  that did nothing, a message wiped out of the composer.
- Files are renamed through `POST /files/move` and copied through
  `POST /files/duplicate`; neither is an agent tool — agents get by with
  read/write/patch/delete, and the `move_file` this note used to credit never
  existed. The dialog is `rename-file`; ⚠️ `rename` is the *game's* name and
  has been since before this, and the two are one click apart in the interface.
- The composer is emptied on send but the words come back if the send fails —
  into the box if it is still empty and still that game, otherwise into that
  game's draft, never over anything newer. Nothing else in the studio holds
  something git cannot recover.

## Dev-environment gotchas

- **`GAMES_DIR` must live outside this checkout when running locally.** The
  sandbox refuses to *create* a `.git` directory beneath the project root, so
  `git init` inside `./games/` fails with EPERM. Use
  `GAMES_DIR=$TMPDIR/gamestudio-games`. Deployed, `./games` is fine.
  Narrower than it used to read here: committing into a game repo that already
  exists under `games/<slug>/` does work, which is how a helper's result gets
  carried back from a temp `GAMES_DIR` into this checkout.
- Outbound network goes through a CONNECT proxy and DNS does not resolve.
  `curl` reads `$https_proxy` on its own; Node's `fetch` needs
  `node --use-env-proxy`. `npm run smoke` carries the flag; `npm test` never
  needs it; **`npm start` needs `NODE_OPTIONS=--use-env-proxy`** or every
  agent reply fails with ENOTFOUND, because the server is the one calling
  DeepSeek. Deployed, none of this applies.
- `node:sqlite` has no `db.transaction()` and rejects a nested `BEGIN`; use
  `tx()` from `server/db.js`, which guards against nesting.
- **Start a server as a tracked background task. Never with `&`.** The sandbox
  denies `kill` and every Bash call is a fresh shell, so a server started with
  `&` cannot be stopped afterwards by anything in the session — it squats on
  its port until a human kills it, and the operator ends up chasing PIDs.

  Instead run it as one Bash call with `run_in_background: true` and **no** `&`.
  The harness owns the process, and `TaskStop` with the task id it hands back
  really does terminate it and release the port — verified, not assumed:

  ```
  Bash({ command: "... node server/index.js", run_in_background: true })
    -> "Command running in background with ID: buircfi4s"
  ...do the browser check...
  TaskStop({ task_id: "buircfi4s" })   # process gone, port free
  ```

  Stop it in the same turn that started it. Quote the **task id**, not the PID,
  in anything you report: the id is the handle that works, and `kill <pid>` is
  denied. (`pkill -f` matches the *relative* command line, `server/index.js`, so
  a pattern with the full path in it silently matches nothing — worth knowing
  for the cleanup instructions a human will have to run.)

- **Pick the port after looking, not before.** `PORT` collisions are normal
  here and the "already in use" message is telling the truth. `lsof -nP -iTCP
  -sTCP:LISTEN | grep node` lists what is up.

  ⚠️ **Two of those are the operator's and must never be killed or reused:**
  8090 is `new-y`, and **8100/8101 is the operator's own running studio** — the
  defaults, which is exactly why they look like an abandoned test. `ps` is
  restricted to this session's own processes, so a PID from `lsof` cannot be
  identified by reading its command line: do not tell the operator to kill
  something on the strength of its port number. Only ever offer up a task id
  this session started.

## Audience

The studio is used by kids. That shapes the interface, not the engineering:
every technical affordance is present (file tree, versions, diffs, reasoning
traces, model choice), but user-facing strings are plain language and
destructive actions confirm first. The UI says **helper** where the code says
**agent** — see GLOSSARY.md, and don't let "helper" leak into the code.

Three conventions to keep. **A link looks at something, a button changes
something** (`Show changes`, `All files`, `All files changed (n)`, `Versions`
and every path in a diff are `button.link`; `Bring this file back` is a
bordered button). Anything a control reveals opens **in the row it belongs
to**, not at the foot of the list — one open at a time, and the same control
closes it again with its label flipped (`Show changes` / `Hide changes`)
rather than a second control appearing. And **what lights up is what can be
clicked**: a row that highlights under the pointer opens on a click anywhere
in it, or it does not highlight at all.

The studio is dark, always: `public/style.css` sets `color-scheme: dark` and
there is no light theme to fall back to — the games are dark and the previews
are dark, and a light shell around them read as two applications. Four colour
roles carry it. **Cyan is the studio's own voice** (New game, the open tab, the
active row) and stays cyan whatever game is open; **pink is a helper**; **gold
is a number worth looking at** — a score, a version — and nothing else;
**crimson is danger** and nothing else. A game's own four (`primary`, `accent`,
`highlight`, `deep` in its `config/look.js`) colour that game's surfaces only:
the chat pane, the composer, the game's actions, the rail. ⚠️ Gold is the one
to police — the moment it appears on something that is not a number, the
direction stops working.

## Current state

v0 is complete and green. Verified live end to end: a message in
the UI produces a streamed reasoning trace, a `write_file` call, one git
commit authored as the agent, a `files.changed` event, and a reloaded preview
of a playable game on the public origin.

Since v0: a project is a game or a **chat** (`projects.kind`). A chat has no
working tree and nothing on disk, so every file route, the games origin, and
the agent's tools and context all refuse or omit it.

People can be called by name too. Clicking a human in the sidebar's Crew tab
drops `@Firstname` into the composer, and an `@` in a human message leaves that
person a **mark** — the cyan `@n` on the game, the chat and the conversation
pill — until they open the chat it was said in. `server/mentions.js` is now
both halves: the same rule that makes a helper eligible resolves a person's
name. A mark is a `mentions` row, so it survives the tab; ⚠️ clearing it is its
own route (`…/chats/:id/seen`), not a side effect of the GET that opens a chat,
because the client also needs it when a mention lands in the chat on screen.
Nothing an agent writes ever leaves one.

An `@` also **calls a helper in**. Naming one that is not in the chat puts it
there — `callAgentsIn`, in the same transaction as the message, waiting to be
called rather than chatty, and the orchestrator wakes it on that very message
because the `@` that let it in is the `@` that makes it eligible. ⚠️ Only where
helpers are allowed: `Humans only` lets nobody in this way either, and the
ten-per-chat cap holds, the named-past-it staying out rather than the message
being refused. Who came rides out on `message.new` as `joined`, so every tab
grows the chip; the other way in is the `+` at the right of the bar, whose
dialog is every helper not already there.

The studio has one role, **admin** (`users.admin`), and it is about running the
studio rather than about games: accounts, names, passwords, per-person
**allowances** and the studio-wide budget, all in Studio settings on the Crew
tab. The first account has it; ⚠️ the studio keeps at least one, and a password
set there ends that person's sessions. Tokens now have two walls — the
studio-wide budget and a person's `daily_tokens` — and a reply is billed to
whoever asked for it, so one person running out stops their helpers and nobody
else's (spec.md §10). Within a tenth of your allowance, the token line under
the newest reply says how much is left, in gold — drawn from `/api/me`, which
is re-read after a reply, so it is your own day and no message ever carries
somebody's allowance. `bin/adduser.js` still works and makes the first account
an admin.

⚠️ Taking somebody out of the studio is a **soft delete** — `users.deleted`,
plus their sessions, and not one row more (spec.md §3) — and ⚠️ it is a
terminal job: `npm run deluser` is the only way out, there is no
`DELETE /api/admin/users/:id` and no Remove in the panel. Adding an account is
an everyday thing and stays in the panel; removing one is rare, is about a
person rather than a setting, and a red button beside Save and Password invites
the press. `removeAccount`/`restoreAccount`/`isLastAdmin` in `server/auth.js`
are the shared parts, so the two scripts and the panel's demote guard say the
same thing.

Access minds the bit (login, `userForToken`, `GET /api/users`, the panel,
resolving an `@`, being added as an author); history does not, so their
messages still carry their name. Everything else stays put, including their
`project_authors` rows, which is what makes `npm run restoreuser` give back
the same person — the old hard delete had to strip those first and then refuse
outright if they were a game's only author, and neither step could be undone.
Two consequences on purpose: the address stays theirs, so `adduser` and the
panel answer it by pointing at the restore rather than starting a second
account; and a game whose only author was removed shows no editors and can be
changed by nobody until they are back.

A file can be copied **between games**: `Copy to…` on the open file's bar, or
`POST /files/import` — the bytes as they are now, one commit in the game it
lands in, no history and no link. Reading the source is every account's, so the
only rights checked are the target's.

The preview reloads itself. There is no Reload button and has not been since
the reskin: every commit bumps `previewNonce`, which is in the iframe's `src`,
so a helper's write, a save or an upload all restart the game on their own.

Games have **authors** now — ⚠️ **editors** everywhere a person can read, and
`author` in the code, the database and the wire — and the studio is no longer
flat: an account reads everything and changes only games it authors, or games
marked **open**. Open is what a game a person makes starts as, forks included;
an editor turns it off in the `Editors` dialog and the game wears a 🔒 in front
of its name from then on. The column's default is still 0 — an existing
database has the column already and SQLite will not change a default
afterwards — so creation states the value instead. `canEdit` is the rule and
`requireProject({ write: true })` is the single place it is applied; a route
that means to be an exception says `anyone: true`. ⚠️ Two exceptions, both
deliberate: anyone may talk in any game's human-only chat, and the author list
stays authors-only even when the game is open — open is about the work, not
about who decides. The sidebar's Games tab sorts into Yours, Open to everyone
and Everyone else's; `frozen()` in the client is `archived || !can_edit`, which
is why everything that was disabled for an archived game is disabled for
somebody else's. Every existing project got its creator as its author.

A game holds several **chats** — conversations, `chats` in the database.
Every game is born with two: `Humans only`, which it opens on, and `Building`. ⚠️
`Humans only` is human only, and that is enforced where a helper would be *put in*
(`assertBotsAllowed`), not where one would answer: a room that promises nobody
is listening keeps that promise at the door. A helper belongs to a chat rather
than a game — `chat_agents`, with the chatty switch, the cooldown and the dirty
bit all per chat — and its transcript, its pins and its history floor are that
chat's alone. The URL carries `?chat=`; the browser remembers the last one per
game. A database from before this upgrades in place: `intoChats` gives every
project both chats and moves its thread and helpers into `Building`, then drops
`project_agents`; a database still carrying `Just us` has that row renamed.
⚠️ Both chats unconditionally — the first version made `Building` only where
there was something to carry, which left a game nobody had talked in yet with
nowhere a helper could be put. Tested against a hand-built old database and
against that shape.

A **chat project** is one room and not that shape: one chat, taking helpers,
wearing the project's name and renamed with it — no front door in front of it,
no second one to switch to, so the bar over it holds nothing but who is
listening. `startRoom` makes it, `POST /chats` refuses a second, and
`intoOneRoom` brings the ones made before this forward: the oldest chat
survives, everything said in the others moves into it in id order — global and
climbing with time, so the thread reads back chronologically — and only the
emptied rooms are deleted. Run against a copy of the live database: both chat
projects collapsed with all their messages and their helper, and no game's two
chats moved.

Nothing in the bar over a conversation is ever greyed out: `Add chat` and the
`+` that puts a helper in are left out when they cannot be pressed. A button
you cannot press is a question, and the answer — somebody else's game, an
archived one, twenty chats already, a room that takes no helpers — is not one
a bar can give.

A new game is not born empty of people either: the **starter helper**
(`studio_state.default_agent_id`, picked in Studio settings beside the budget)
joins its `Building` chat, chatty, and the create answer carries `chats` and
`chat` so the studio opens there rather than on the front door. A setting
rather than a name in the code — helpers are rows people make, rename and
delete — so nobody is a real answer, and a deleted helper reads as nobody
instead of failing every creation. Games only, and ⚠️ through
`assertBotsAllowed` like every other way a helper is put in a chat.

⚠️ Remembering the chat needs both halves. `openProject` resolves it —
`view.chat`, else `prefs('chat-<slug>')`, else the front door — and then
**names it to `applyView`**, which reads a missing chat as "the one the project
opens on". Without that the game appeared in the conversation you left it in
and switched itself to `Humans only` a beat later. Back and Forward still
reset, because there a missing `?chat=` is the address talking.

Browser-checked, not just intended: on the games origin `document.cookie` is
empty and `localStorage` works, and the studio cannot read into the preview
iframe. ⚠️ Read that first one narrowly — `document.cookie` is empty because
the session is `HttpOnly`, not because the browser withheld it. On two ports of
one hostname the cookie *is* sent to the games origin; see spec.md §7.

Play and preview links are derived per request from `Host` (same hostname,
`GAMES_PORT`), so no hostname is configured anywhere. `GAMES_URL` overrides it
for the separate-hostname deployment and is normally unset.

Helpers can now see the game break. The preview iframe loads
`/<slug>/_studio.html` — the **wrapper**: that game's own `index.html` with the
**reporter** and the current commit injected by the games listener. Nothing is
added to any working tree, no agent is told about it, and every game already
has it. The reporter posts uncaught errors, failed loads and `console.error`
to the studio page, which files them against the commit the wrapper was built
from; a report whose version is no longer HEAD is dropped rather than
mislabelled (spec.md §8). Browser-checked end to end, including that the public
page is byte-identical to the file on disk.

Two traps worth remembering. Rendering rebuilds the preview iframe, which
restarts the game, which reports again — so the problems panel is painted in
place, never through `render()`. And the studio cannot inject anything into the
frame from the browser; that it has to happen server-side is the boundary
working, not an obstacle.

What a reply cost is on `messages.tokens` and under the bubble.

Messages take **reactions** now: emoji pills under any bubble, the fixed
twenty behind a `+`, the headcount on the pill and who on its tooltip, yours
outlined in the game's primary. One route
(`POST /api/messages/:id/reactions/toggle`), one delta event
(`message.reaction`), and one idempotent merge shared by the optimistic click
and the SSE echo — new-y's design transplanted, keyed by user instead of
participant (spec.md §3, §6, §9). Anyone signed in may react to anything,
archived included: a reaction is talk about the work, not a change to it. A
reaction is never a message and never reaches an agent. `:wave:`-style
shortcodes were deferred to TODO.md — new-y has none to copy.

An `.svg` opens as the picture over the text that draws it: the preview
redraws on every keystroke, in place like the syntax colours, and a
half-typed tag keeps the last drawing that worked — the swap goes through an
offscreen probe. Client-only; Versions already showed SVG thumbnails.

Every part of a request is now bounded, and nothing is dropped in silence: the
brief is cut at 32 KB with a note, a pin is priority rather than exemption so
the file block cannot exceed `AMBIENT_BYTES`, the tool loop stops at 512 KB of
appended messages and continues from a fresh context, and a trimmed transcript
carries a `[studio]` marker saying how many messages are missing. A long tool
chain also **sheds**: DeepSeek re-bills its own accumulated reasoning on every
continuation (spec.md §14), so once carrying the pile costs more than
re-paying the visible tail, the loop drops it with a one-line `[studio]` user
note, counted on the reply's receipt. Still bytes,
not tokens — spec.md §8 has the table that shows the sum cannot reach the
window.

Thinking is bounded too, and that one was not a guess: measured with the
studio's own preamble and tools in front of it, an ambitious request at full
effort produced **no file, no word and no tool call in eight of nine runs** —
the trace expands to fill whatever `max_tokens` allows, so raising the ceiling
buys a longer silence rather than a finished game (spec.md §14). So a helper
has a **thinking level** — `full`, `low` or `none` on `agents.thinking`, "How
much to think first" in the dialog — and new helpers start on `low`, which
wrote files on every run at half the budget where full effort wrote none.
Behind it, the **thinking cap** stops any turn whose trace runs past
`THINKING_CAP_CHARS` with nothing else produced, and asks that same turn again
with thinking off; a `'system'` banner says so, and the abandoned attempt is
billed to nobody because usage only arrives with the end of a stream.
⚠️ `agents.reasoning`, the boolean this replaced, is still written and never
read, so a rollback lands on its feet — droppable once this has stuck.

Two things a nine-minute think taught about the interface. The trace panel is a
few lines tall and a trace runs to hundreds, so it now sticks to the newest
thought unless somebody has scrolled up to read, and the line under the name
counts — `thinking, 2m 14s` — off the deltas themselves rather than a timer.
Browser-checked against a fake helper thinking for twenty seconds
(`tmp/trace-studio.mjs`): the box followed 16,171 pixels of trace and stayed
followed, a reader parked at 400 was left there, and returning to the bottom
started it following again. Before that the box showed the first ten lines for
as long as the helper thought, which is the whole of what a working reply
looked like when it looked broken. A third thing a 129-second one taught:
streamed text is painted at most once per animation frame (`paintSoon` in
`main.js`), never per delta — repainting the whole box ~90 times a second and
forcing a reflow each time grew with the trace and froze the page right at the
thinking cap. Re-checked against the same harness at 87,000 characters: still
following, parked still parked, resume mid-stream works, page responsive.

Agents are asked for **project documents** (`BRIEF.md`, `SPEC.md`, `TODO.md`),
a `config/` directory, and many small source files rather than one enormous
`index.html`. Prompt only: nothing scaffolds those files. Validated live:
handed fun-slide as a rebuild, a helper wrote `BRIEF.md`/`SPEC.md`, a commented
`config/` set and small `js/` files in one commit (`2a6821d` in its repo), and
the game played clean afterwards.

Art can be put in from the studio: `+ Upload` under **Add a file** — the one
button above the file list, whose dialog holds all four of `+ New file`,
`+ Upload`, `+ Draw a picture` and `+ Make a sound`, with the preamble naming
the button and the four choices by exactly those words — or
a drop onto the file tree, both landing in a dialog that shows the path each
file will take before anything is sent. Client-side only — the `PUT` route
already took raw bytes. Files go under `assets/` by what they are — a sound to
`assets/sounds/`, a strip to `assets/sprites/`, any other picture to
`assets/images/` — one commit each, and the preamble names all three so a
helper references art rather than inventing a path. A dropped picture is
decoded before the dialog opens, because only its shape says whether it is a
strip; the folder box is empty and overrules every row at once when a drop
belongs somewhere else. An **asset** opens in the pane as the picture, sound or video itself.
Browser-checked end to end, including drag-and-drop, a name collision and an
oversized file being refused before upload, one commit per new file and none for
an identical replace, and the bytes coming back byte-identical on the public
games origin.

Games wear their own **reserved images**: three optional PNGs at the tree
root — `chat.png` tiled behind the conversation, `hero.png` behind the bar
over it and on the game's catalog card once published, `icon.png` in front of
the game's name in the sidebar — each under a wash of the game's `deep`
colour, and no image is simply the studio's own look. Root on purpose, so a
sprite sharing a name cannot become the studio's dressing: the upload dialog
routes the three names there ahead of the strip check, and the preamble names
them so a helper asks instead of filing a wallpaper under `assets/images/`.
⚠️ The client holds them as object URLs replaced on `files.changed`, never as
a `src` pointed at the file routes — those send no-store, and a background
rebuilt by every render would refetch on every keystroke; `has_icon` on the
project list is what keeps the sidebar from probing every game for an icon it
does not have. Browser-checked end to end: all three uploaded in one drop
(hero.png strip-shaped and still landing at the root), the studio redressing
live and on reload, a game without them unchanged, a deleted icon vanishing
from the sidebar while another game was open, and the published card wearing
the hero on the catalog.

A picture opens as the **pixel editor** — there is no separate look-only view,
because it showed the same picture at the same size. Up to 1024 a side, so a
backdrop is as editable as a sprite, and saved at exactly the size it arrived.
A version that touched a picture shows it as a thumbnail in Versions without
being asked, and opening the row shows it whole; a unified diff of a PNG was
only ever git talking about itself.

The four tools and undo/redo are icons with the words on `title`/`aria-label`.
The **palette** is `PALETTE` in the game's own `config/look.js` — 32 colours, two
rows of 16 — so changing a colour is a commit on the game rather than a setting
in one browser. The colour box and the eyedropper both write into the chosen
square. Every game carries the file. `+ Upload` takes any file — nothing on
the server ever cared about extensions — and `MEDIA_KINDS` in `main.js` is the
one list to extend when the studio should show a new kind.

Undo and redo work a gesture at a time and store the pixels a gesture changed,
not a copy of the picture — kilobytes per stroke at any size. ⚠️ Undo walks its
entries backwards, and that is load-bearing: a stroke crossing itself records
the same pixel twice, and in record order it would stop at the mid-stroke
colour. spec.md §6 has the argument, and why replaying an action stack was the
other option.

A `config/*.js` file opens as a **config form** — a field per value, the
value's comment beside it — parsed by `public/config-file.js` without being
executed, and saved by splicing the one value so comments survive. Anything
outside the plain-value subset falls back to the text editor with a reason.
Browser-checked end to end, including a nested edit inside a table: one
character changed on disk, one commit.

Code files open coloured — comments, strings, numbers, keywords, tags — by the
studio's own tokenizer (`public/highlight.js`, pure, covered in `npm test`),
painted on a `<pre>` behind a transparent-ink textarea. The textarea is still
the only editor, so caret, drafts, dirty state and save are untouched. ⚠️ Token
styles may change `color` only: a bold or italic glyph is a different width
and the overlay shears off the text. Regex literals are plain on purpose, and
past 128 KB the editor is plain again (spec.md §6).

`studio/` in a game's tree is the **studio library**: the studio's own code,
copied in rather than shared, with `studio/studio.json` recording which version
each game has. Copied because a symlink is a path out of the sandbox that git
stores as a dangling blob, and a submodule gives a broken game to anyone who
clones without `--recursive`. Two rules carry it, both tested: ⚠️ a helper may
read it and never write it, and it is *named* to an agent rather than sent — so
an engine costs the ambient block one line, not its source. It also documents
itself: each held library's top comment block rides the preamble as its **API
note**, read from the game's own copy so it matches the held version — adding
a library needs no orchestrator edit (spec.md §4). Every game is born
holding it — creation scaffolds the library in one commit
(`server/files/library.js`) — and is kept current by the **sweep**:
`npm run sweep` on the machine holding the games adds what each non-archived
game lacks and raises what it holds, one studio-authored commit per game,
never touching seeds or anything else of the game's own. ⚠️ Safe only under
the **compatibility law** (spec.md §4): a library version N+1 must run every
game that ran N — break it and the fix is by hand, game by game. There is no
update path from inside the studio, and no `+ Controls`-style buttons; the
preamble names the script tags instead, because writing `index.html` is the
one part a helper does itself.
The suite's games are born empty on purpose:
`setup()` points `publicDir` at a fixture with no libraries, and one test in
`api-projects.test.js` covers the real scaffold. spec.md §4 has the
argument. The **input module** is the first library: one call,
`Input.held("left")`, covers the keyboard, a game controller and a touchscreen,
for one player or two. The **sound player** is the second — `Sound.play("laser")`
plays `assets/sounds/laser.wav` with overlap, loops and mute, and a missing file or a
blocked autoplay is a warning, never an error — which also proved the shape:
it needed no orchestrator edit, only its file, its `index.json` entry, and the
Files-tab offer buttons going generic. The **sprites library** is the third:
one sprite is one file, `Sprites.draw(ctx, "hero", x, y)` draws
`assets/sprites/hero.png`, and a PNG whose width is a whole multiple of its height is
a **strip** of square frames played on a shared clock — no registry, no config
file, the shape of the picture is the declaration. A strip opens in the pixel
editor one frame at a time: frame buttons, a live looping preview, Copy/Paste
frame, a toggleable ghost of the frame before, tools clipped to the open frame
(the clip lives in pixel-editor.js's one bounds check), and "Whole strip" to
draw across everything. `+ Draw a picture` offers a frame count.
The **screens library** is the fourth and the first presentational one:
`Screens.hint()` is the how-to-play line as a string, derived at call time
from `config/controls.js` and the device — keys, the scheme's touch shape, or
controller buttons when one is in — with `WORDS.howToPlay` overriding it
verbatim. `Screens.title({ onStart })` is the phone-fit title screen — the
name clamped so it cannot overflow a narrow screen, the panel auto-margined
inside a scrolling box so it centres when it fits and scrolls from the top
when tall (the two asteriskoids failures), safe-area padding, the hint, one
focused button that Enter or Space presses — and with a `score` it is the
game-over screen. ⚠️ That button takes a capture-phase key listener of its
own (v5), and the reason is worth keeping: the input library binds `key:enter`
to start and `key:space` to fire and calls `preventDefault` on every bound key
from a *bubble*-phase window listener, so the focused button never saw the key
meant to press it — the title screen was mouse-only in every game loading
`input.js`, which is all of them. Capture runs first; it takes the default
itself so a game without input.js does not also activate the button and start
twice, and the listener goes away with the screen. Found while building the
visual novel, fixed in the library rather than around it. Words from `WORDS`/arguments, colours from `LOOK`, stable `screens-`
classes for a game's own css, `{ close }` returned for games that start from
`Input.pressed("start")`; it sits under the touch overlay, so the drawn
controls stay on top. `Screens.chips({ Score: 12 })` is the HUD strip pinned
to the top of the screen: built once, only changed text touched, so calling
it every frame is fine; each call says the whole strip and `chips({})`
clears it; values wear the look's highlight and taps fall through to the
game. All three surfaces browser-checked at phone size against the long
asteriskoids name — the library that was ideas/game-header.md is complete.

Screens v6 answers the last three things asked of it (spec.md §4).
⚠️ **A game's own css now wins**, which it did not before: `injectStyle()`
appends to `<head>`, after the game's `<link>`, so at equal specificity the
library took every tie — a game could not restyle a screen without
`!important`. Every rule it injects is now inside `@layer screens`, and an
unlayered rule beats a layered one at any specificity in any order. Its
variables are layered `:root` defaults, overridden the same way; the four
`LOOK` colours stay inline on the node and beat a stylesheet, which is right —
they are the game's own `config/look.js`. Where `LOOK` names nothing the game
can set `--screens-primary` from css instead, which is most games.

The **default** is the studio's form in the game's colour: halftone dots, a
hairline in the game's own three, a panel card, the filled pill with a glow,
Space Grotesk with Space Mono on every number — and the fallbacks are the
studio's four rather than white-on-black. The **typefaces are in the tree**,
four `.woff2` beside the library under OFL (`studio/fonts-license.txt`): 60 KB
held, 41 KB fetched by an ASCII page, because `unicode-range` is Google's own.
⚠️ A relative `url()` in an injected `<style>` resolves against the *document*,
so the paths come from `document.currentScript.src`.

And it carries **snippets** — nodes it builds and the game places.
`Screens.board()` is the scoreboard, fetched by the library, with asteriskoids'
neighbours bracket built in (four above, your row, four below, real ranks; its
own version repeated four already-shown rows at rank 11). `Screens.rows()` is a
label-and-value list, `Screens.signin()` is who is playing or the link to sign
in, and `Screens.me()`/`Screens.post()` are underneath. `title({ score,
post: true, board: true })` is the whole game-over dance in one line. ⚠️ Gold
stays a score: the board's score column and a chip value, never a rank, a name
or a `rows()` value. Browser-checked end to end at 1280 and 360: the layer
proved against a game stylesheet that restyles the name and squares the panel,
latin-ext fetched only for `ő`, the bracket at ranks 1–10 · 16–24 with 20 lit,
and signed out the post 401ing into the sign-in link instead of a bracket.
`+ Make a sound` renders a
`.wav` from a preset and a row of sliders, and `+ Draw a picture` opens a PNG
as a grid of squares. Both are arithmetic in `public/` rather than Web Audio or
a live canvas API, so what is played or shown is what gets saved, and both are
checked in `npm test` with no browser.

A `.wav` the studio wrote opens as the **sound editor** — the sliders that made
it — because the numbers ride inside the file as a JSON comment in its
`LIST`/`INFO`/`ICMT` chunk, which every player skips and the samples never
feel. So making a sound and changing one a week later are one surface:
`+ Make a sound` asks nothing at all, writes a blip to `assets/sounds/` under a
free name, and opens it — the name is a better question once you have heard it,
and Rename is in the same bar. A `.wav` from anywhere else has no note, so it opens as the player with the
reason underneath, and nothing in a note is trusted — a value no slider could
produce is the default instead. Editing an asset beside a file would have come
apart on the first rename; spec.md §6 has the argument. Browser-checked end to
end: made, changed, saved, closed, reopened with the slider where it was left,
and one commit each way.

Browser-checked end to end, back when the install button existed: three commits
with the tags in front of the game's own script, a real `.wav` and a real 16×16 PNG on disk,
`held`/`pressed`/`axis` and player two on the games origin, `pressed` true for
exactly one frame, and the touch overlay appearing on a coarse pointer and
driving the game. Not checked with a real controller — no hardware here; the
pad paths are covered by fake pads in `test/input-template.test.js`.

Touch has **control schemes**: `SCHEME` in `config/controls.js` names the
physical shape — `buttons`, `one-button`, `swipe-tap`, `stick-buttons`,
`dual-stick` — and the input library (v5) draws that shape (GLOSSARY:
*control scheme*; ideas/control-schemes.md is the design, "The fifth" its
latest section). The virtual stick is analog into the same `axis()` the pad
sticks feed; a flick is surfaced for exactly one update; one-button makes the
whole screen the button; every preset binds start into its primary touch
control. `buttons` is the phone-test answer for thrust-and-turn ships and
also what no `SCHEME` means — the legacy unnamed shape is retired, and a
legacy `controls.js` renders the same under it. `toggle:NAME` is a drawn
button that latches (tap on, tap off, `held()` between; drops on blur and
under a Screens screen), so turn + thrust + fire fit on two thumbs;
`BUTTON_SIDE = "left"` mirrors any layout. ⚠️ Buttons are geometry in
input.js — centres and radii hit-tested by arithmetic with a halo, nearest
centre winning — so thumbs rock across neighbours without lifting and the
same maths runs headless in `npm test`; the DOM is only paint, and there is
no per-button pointer capture to reintroduce. Screens v4 marks the body
`screens-open` while a title/game-over screen is up: the drawn controls hide,
latches drop, and its Start button relays one frame of `start` through the
window for poll-style games. The default seed is the stick-buttons preset;
`controls-<scheme>.js` beside it for templates — nothing in the studio picks
a scheme yet. ⚠️ The input header is the API note, ~2.6 KB against the
orchestrator's cap, raised to 3 KB for it: condense before adding, or the
tail is cut. Node-tested in `test/input-schemes.test.js`, browser-checked on
a forced coarse pointer (tmp/touch-check/, real PointerEvents: rocking,
halos, latching, hide-and-relay, and asteriskoids playing on its swept
copy); not yet felt on a real phone — that re-test is queued in TODO.md.
Asteriskoids is migrated (buttons scheme, FIRE latches); space-racer and the
hand-rolled-screens follow-ups are TODO lines.

**Game templates** are live: New game offers "Start from", a starter tree
copied in as a third commit and the game's own code from then on (spec.md §4).
The quiz is the first, and it carries its own editor — `config/questions.js`
in the quiz shape opens as the **quiz editor**, the whole game as a form, no
helper needed; outgrown, it falls back to the config form, then the text.

The **visual novel** is the second, and it is where the point of a template
stops being "a head start" and becomes "no helper at all". `config/story.js`
holds `CAST` and `SCENES` — a picture, an optional sound, lines said one at a
time, then exactly one of three exits: `choices` branch, `go` carries straight
on, neither is an ending; a choice may `set` a **switch** and one that `need`s
one is only offered once something has. DOM rather than a canvas, because a
story is mostly text; sound and screens, not input or sprites. ⚠️ It went
before the point-and-click adventure on purpose: the two share scenes and
switches, but an adventure's spots are rectangles on a picture and helpers
cannot see pictures — a visual novel has no coordinates at all. It also
settled the shared word: `set`/`need`, not the `flip` the adventure sketch had.

It opens as the **story editor**: the scenes as a list, one open in its own
row, the cast a peer section. Two things are its own. Renaming a scene brings
every way in with it. And it holds the whole graph and the file list at once,
so it says five things no field can — a scene nothing leads to, a way out
pointing at a scene that is gone, a switch nothing sets, a picture or portrait
the game does not have, a mood the cast does not have. `Try this scene`
reloads the preview at the game's own `?scene=`: the studio only puts the
parameter on the iframe `src`, and honouring it is four lines in the template.
The quiz editor grew the same structural read, because the bug in a quiz is
never a typo — it is three endings nobody can reach.

Two things follow from "no helper at all". A template's `index.json` entry
names its **heart**, and creating the game opens that file rather than a chat.
And the **starter helper** joins a template game *not chatty* — there by name,
silent until called — because a helper answering the first thing said in a
game that is already made is noise with a token bill on it.

⚠️ The two editors are shape-locked, and the preamble says so: a stray extra
key on an answer or a scene costs somebody their editor. `orchestrator.test.js`
asserts both names are in the prompt.

The move-and-collect and point-and-click templates are queued in TODO.md, each
owed its own editor mode where one fits (ideas/templates.md).

The other choice, "A blank page", used to mean a blank *directory* — and a game
with no `index.html` is nothing the games origin can serve, so a new game
answered `{"error":"not found"}` until a helper had written one. It is now the
**blank start**: `public/game-templates/blank/index.html`, committed after the
library scaffold, carrying the game's name and the script tags for what the
game holds. Not in `index.json` — the dialog already offers it as the empty
choice — and the one page there that is not copied byte for byte, since
`{{name}}` becomes the game's name, escaped. Read from `publicDir` like every
other scaffold, so the suite's fixture writes nothing and "a game with no page"
stays a state worth testing. Browser-checked: `Bats & Balls` plays on the games
origin with the ampersand escaped in both the title and the heading.

Couch multiplayer is what the input module buys. Networked multiplayer is not
built; the games origin holding state and taking a write is no longer the
blocker — the scoreboard settled that. See `ideas/next-five.md`, which also
tiers persistent worlds.

Every game has a **scoreboard**: `GET`/`POST /_scores/<slug>` on the games
origin. Rows live in SQLite, never the working tree, so a score commits
nothing, restarts no preview, and never enters an agent's context or thrashes
its prompt cache. Best 100 kept per game, every field capped, posts
rate-limited per player (spec.md §3, §6, §10). ⚠️ Posting takes a signed-in
player now, and the name on the row is the account's — a body's `name` is
ignored, so old games work again the moment their player signs in; the
*score* stays forgeable, the client being the run's only witness. Each post
also raises that person's `personal_bests` row in the same transaction, which
survives the top-100 pruning and is displayed nowhere yet (TODO.md). The
preamble teaches `/_me`, the `{score}` post, and the sign-in link to offer
when `user` is null; `orchestrator.test.js` asserts each. Tested in
`test/scores.test.js`, not yet exercised by a real game in a browser.

The games origin has a **front door** now. The catalog at `/` is the studio's
own dress — wordmark, halftone, hairline, dark always, hero cards kept, each
board's best score in gold — rendered whole by `server/catalog.js`, with
sign-in, `Ask to join` and sign-out on it (browser-checked end to end). The
accounts behind it split in two: **studio access** (`users.studio_access`,
the panel's `In the studio`/`Games only` toggle; every pre-existing account
has it) and **player accounts** without it, which the **waiting list** makes —
`POST /_signup` writes a `signups` row, the panel's `Waiting to join` section
approves it into a games-only account or turns it away, both decisions kept
as audit columns, never a DELETE. Players sign in over their own `player`
cookie and `player_sessions` (90 days; the games listener still never reads
`session`), and the bit is minded everywhere `deleted` is: studio login, the
crew, mentions, authorship. ⚠️ Two headers on the catalog are load-bearing —
`frame-ancestors 'none'` and `COOP: same-origin` — because a password form
now shares an origin with LLM-written game code, and a game could otherwise
read the form out of a frame or an opened window (spec.md §7). ⚠️ An admin
never loses the bit; taking it needs the admin bit taken first.

The preamble names every one of these by the words on the button, because a
capability an agent is not told about may as well not exist. `orchestrator.js`
carries the text and `orchestrator.test.js` asserts each name, so renaming a
button without updating the prompt fails a test.

Tested live, once, and it worked: `space-racer` was handed to a helper with
nothing but *"should work with a game controller and on a tablet, not just the
arrow keys"*. It deleted its own `keydown` listeners, moved to `Input.axis`,
`held` and `pressed`, and added menu and result-screen navigation — which is
what a controller actually needs and what nobody asked for. 40k tokens, three
files, one commit (`e1fcbeb` in that repo). Browser-checked afterwards on both
origins: keyboard and a fake pad each drive it, and steering is analog now.

Which games still need migrating lives in TODO.md, not here. Two things about
migrations worth keeping: pulling colours out of drawing code into
`config/look.js` is a game refactor rather than a migration, and a migrated
game is verified in a browser via the static server at
`localhost:8080/fam/gamestudio/games/<slug>/index.html`, which needs no studio
running.

The ambient file block lives in the **system prompt**, after the brief and the
agent description, not on the last user message. Measured
(`tmp/probe-cache.mjs`): behind the transcript it cached 0% between fires,
ahead of it 100% when no file changed. Inside the block, contents come
least-recently-modified first and the size-stamped tree last, pins ride the
last user message, and the history trim boundary holds still between fires —
all for the same cache. Measured (`tmp/probe-order.mjs`): DeepSeek serves a
prefix only back to a divergence depth it has already seen, so the first fire
after an edit pays in full and the fires after it — the same files edited
again — hit 94%, against 0% forever with the tree in front (spec.md §8, §14).
Runtime errors stay on the last user message — they change every playthrough.
`BRIEF.md` is in both places by design; spec.md §8 says why.

The URL is the view. `?tab=`, `?file=` and `?version=` carry the rail — which
tab, which file, which version's changes — so a link sends what you are
looking at and a reload comes back to it. Written by `render()`, read by the
same code on load and on Back; the server never looks at the query (spec.md
§6). Every view is its own entry, so Back closes a file, and inside one game it
does that without refetching the project — `openProject` clears the pins.
`replaceState` only while following an address that already exists.
⚠️ Never written while signed out, or the deep link would be gone by the time
the sign-in form was answered.

⚠️ Which of the three it does is a mode held only for the duration of an
`await`, so **every render a followed URL causes has to happen inside that
await**. A render that lands afterwards writes the wrong address as a new
entry: `closeOpenFile` firing `openFile` without returning it is what made Back
toggle between the last two files instead of walking back through them. An
`onclick` that opens something must return its promise all the way up. The
address is also held while a dialog is open — a decision in progress is not a
view to link to, and that is what stops a Back out of unsaved work from
overwriting the entry it was going to.

The same rule the other way round: **anything that reaches a view in more than
one step wraps them in `urlAs('hold', …)`**, or each step leaves an entry
behind. Three places do it — `All files changed (n)`, the Versions tab, and a
file chip under a reply — and each ends with `loadDiff(sha, {goTo: true})` so
the row it opened is the row you are looking at. A background event uses
`replace` for the same reason: a helper's commit landing is not somewhere the
reader navigated to.

Browser-checked end to end: a link followed while signed out survives the sign
in and lands on the filtered version list; three files opened in turn walk back
one at a time with `history.length` never moving, and so does file → versions →
version → whole version; Forward retraces the same way; a Back out of unsaved
work asks the same question the ✕ asks, holding the address until it is
answered; pins survive Back; one click on `All files changed (3)` is one entry,
not two; and both that click and a `?version=` link put the row at the top of a
list of thirty-one. The whole file row opens the file — checked by clicking the
size — and the pin checkbox still does not.

A version is fetched whole and narrowed by the reader. `?path=` on the history
route picks the commits and nothing else — `paths` always names every file a
commit touched — and the diff route has no filter at all; `public/patch.js`
takes one file's section out of the patch. Git's pathspec filters the names
along with the commits, which is what made a nine-file refactor look like a
one-file commit when read from one of its files, with no way to click through
to the rest (spec.md §6). ⚠️ Every git call also passes
`-c core.quotePath=false`, or a path with an accent in it comes back escaped
from `log --name-only` and matches nothing in the file listing, which is read
from disk. Browser-checked against a copy of flip-for-what: `All files changed
(9)` on Alice's refactor, one diff section when filtered and nine when not, no
sprite thumbnails in a code file's history, and `assets/café.txt` linking
through to the file.

A version of a sound is playable where it stands: any `.wav` (or `.mp3`,
`.ogg`, `.m4a`) a commit touched gets a player in its row and in the open
drawer, pointed at the read-at-a-commit route, preloading metadata only.
⚠️ It sits beside the row's controls, never inside the button that opens them
— a player is a control, and pressing play must not open the changes.

The history route answers `{ commits, total }`, not a bare array. `total` is a
`rev-list --count`, and the open file's bar says `12 versions` instead of
`Versions` — fetched with `limit=1` when the file opens, and refreshed on any
`files.changed` for that file, including the one your own save makes, which
reaches the browser before the answer to the `PUT` does.

The interface is the 6a direction (the handoff and its stylesheet were in
`extra/`, which is gitignored — `public/style.css` is the copy that counts).
What it moved, beyond colour: the sidebar is one list at a time behind
**Games / Chats / Crew** tabs with a filter box — Crew being the humans over
the helpers, from `GET /api/users` (names, no addresses); Games and Chats each
go back to the one you last had open (`last-games`/`last-chats` in prefs,
written by `openProject`), because a tab called Chats looks like it opens a
chat, and ⚠️ `pickTab` returns that promise all the way to the `onclick` so the
address is written inside the navigation; the whole-game actions
left the foot of the Play tab for the game's own bar; the **Play tab is gone** — the preview lives at the top of the rail and
folds to a row that still plays and still opens the game in its own tab; and a game's `config/look.js` can name four
colours the studio wears while that game is open. The design's own `support.js`
is a React runtime from the tool that produced it and has no place here.

⚠️ Two things the reskin depends on. The typefaces come from Google Fonts via a
`<link>` in `index.html`: both stacks fall back to the system's, so a studio
that cannot reach the font host is plainer and nothing else. And the sidebar's
filter box is in `focusSnapshot`'s list beside the composer and the editor —
every keystroke re-renders the pane it is in, so without that it would lose the
caret on its own second character.

Deferred by choice: spec.md §15. Typing previews are permanently out (§2).

## Git policy (overrides global)
You manage git directly in this project. The global "manual git" rule does
NOT apply here. `git push` remains denied at the permission layer; the user
handles pushing.

Workflow:
- Commit after each meaningful change passes its tests. One logical change
  per commit.
- Stage only the files relevant to the change. Use `git add <paths>`, not
  `git add .` or `git add -A`. Do not sweep up unrelated edits.
- Before committing, run `git diff --staged` and verify the diff is exactly
  what you intend. If something unintended is staged, `git restore --staged
  <path>` to unstage.
- Conventional commit messages: feat:, fix:, refactor:, docs:, test:, chore:.
  First line under 72 chars. Body if useful, omitted if not.
- Never commit on red. If a test was passing and now isn't, fix the test or
  the code before committing — do not commit broken state.
- Do not include AI attribution in commit messages.
