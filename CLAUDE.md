# Game Studio

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

- `npm test` — 365 tests. `node:test` against `:memory:` SQLite, a temp
  `GAMES_DIR`, and a scripted fake LLM. No network, no API key.
- `npm start` — needs `DEEPSEEK_API_KEY`; fails fast without it.
- `npm run smoke` — one live DeepSeek round trip; needs the key, not in `npm test`.
- `npm run adduser -- <email> "<Name>"` — the only way accounts exist.

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
  and every scroller's position. A new `.scroll` container needs a
  `data-scroll` name or it will jump to the top on the next render.

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

## Current state

v0 is complete and green at 365 tests. Verified live end to end: a message in
the UI produces a streamed reasoning trace, a `write_file` call, one git
commit authored as the agent, a `files.changed` event, and a reloaded preview
of a playable game on the public origin.

Since v0: a project is a game or a **chat** (`projects.kind`). A chat has no
working tree and nothing on disk, so every file route, the games origin, and
the agent's tools and context all refuse or omit it.

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

Every part of a request is now bounded, and nothing is dropped in silence: the
brief is cut at 32 KB with a note, a pin is priority rather than exemption so
the file block cannot exceed `AMBIENT_BYTES`, the tool loop stops at 512 KB of
appended messages and continues from a fresh context, and a trimmed transcript
carries a `[studio]` marker saying how many messages are missing. Still bytes,
not tokens — spec.md §8 has the table that shows the sum cannot reach the
window.

Agents are asked for **project documents** (`BRIEF.md`, `SPEC.md`, `TODO.md`),
a `config/` directory, and many small source files rather than one enormous
`index.html`. Prompt only: nothing scaffolds those files. Not yet seen against a
live model — two of the four games are still single-file, and both agents with
file tools had descriptions ordering a layout of their own until this session.

Art can be put in from the studio: `+ Upload` beside `+ New file`, or
a drop onto the file tree, both landing in a dialog that shows the path each
file will take before anything is sent. Client-side only — the `PUT` route
already took raw bytes. Files go to `assets/`, one commit each, and the
preamble now names that folder so a helper references art rather than inventing
a path. An **asset** opens in the pane as the picture, sound or video itself.
Browser-checked end to end, including drag-and-drop, a name collision and an
oversized file being refused before upload, one commit per new file and none for
an identical replace, and the bytes coming back byte-identical on the public
games origin.

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
square. All four games now carry the file. `+ Upload` takes any file — nothing on
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

`studio/` in a game's tree is the **studio library**: the studio's own code,
copied in rather than shared, with `studio/studio.json` recording which version
each game has. Copied because a symlink is a path out of the sandbox that git
stores as a dangling blob, and a submodule gives a broken game to anyone who
clones without `--recursive`. Two rules carry it, both tested: ⚠️ a helper may
read it and never write it, and it is *named* to an agent rather than sent — so
an engine costs the ambient block one line, not its source. `+ Controls` installs
or updates it and disappears once the game is current. spec.md §4 has the
argument. The **input module** is the first library: one call,
`Input.held("left")`, covers the keyboard, a game controller and a touchscreen,
for one player or two. `+ Make a sound` renders a
`.wav` from a preset and a row of sliders, and `+ Draw a picture` opens a PNG
as a grid of squares. Both are arithmetic in `public/` rather than Web Audio or
a live canvas API, so what is played or shown is what gets saved, and both are
checked in `npm test` with no browser.

Browser-checked end to end: three commits from `+ Controls` with the tags in
front of the game's own script, a real `.wav` and a real 16×16 PNG on disk,
`held`/`pressed`/`axis` and player two on the games origin, `pressed` true for
exactly one frame, and the touch overlay appearing on a coarse pointer and
driving the game. Not checked with a real controller — no hardware here; the
pad paths are covered by fake pads in `test/input-template.test.js`.

Couch multiplayer is what the input module buys. Networked multiplayer and
scoreboards are not built and both need the games origin to hold state and take
its first write — see `ideas/next-five.md`.

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

`space-racer` and `flip-for-what` are migrated (their own repos, committed as
`Daddy`): settings moved into `config/`, and space-racer's on-screen words moved
into `config/words.js`. Colours are still inline in its drawing code — pulling
those out is a game refactor, not a migration. Both verified in a browser via
the static server at `localhost:8080/fam/gamestudio/games/<slug>/index.html`,
which needs no studio running.

The ambient file block lives in the **system prompt**, after the brief and the
agent description, not on the last user message. Measured
(`tmp/probe-cache.mjs`): behind the transcript it cached 0% between fires,
ahead of it 100% when no file changed. Runtime errors stay on the last user
message — they change every playthrough. `BRIEF.md` is in both places by
design; spec.md §8 says why.

The URL is the view. `?tab=`, `?file=` and `?version=` carry the rail — which
tab, which file, which version's changes — so a link sends what you are
looking at and a reload comes back to it. Written by `render()`, read by the
same code on load and on Back; the server never looks at the query (spec.md
§6). Every view is its own entry, so Back closes a file, and inside one game it
does that without refetching the project — `openProject` clears the pins and
the traces. `replaceState` only while following an address that already exists.
⚠️ Never written while signed out, or the deep link would be gone by the time
the sign-in form was answered.

Browser-checked end to end: a link followed while signed out survives the sign
in and lands on the filtered version list; Back walks tab → file → file →
version and keeps the pins; a Back out of unsaved work asks the same question
the ✕ asks and puts the file's own address back if the answer is no; one click
on `All files changed (3)` is one entry, not two; and both that click and a
`?version=` link put the row at the top of a list of thirty-one. The whole file
row opens the file — checked by clicking the size — and the pin checkbox
still does not.

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
