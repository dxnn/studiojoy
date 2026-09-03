# Unbridled Joy

The studio's name, and the wordmark: UNBRIDLED, the little controller lying
between them, JOY. The directory and the npm package are still `gamestudio`
— they are paths, not names.

A private studio where a few trusted people and DeepSeek-backed agents build
browser games together. A **project** is a chat thread and, unless it is a
plain chat, a versioned working tree of files under `games/<slug>/`. Agents
read the tree and edit it with tools; every edit is a git commit. Games are
publicly playable on a second origin; the studio needs a login.

## Source of truth

`spec.md` is the design-of-record: data model, routes, files on disk, the
studio library and templates, agent orchestration, SSE events, limits, auth,
accepted tradeoffs, invariants. Read it before any non-trivial change.

- **§14** is DeepSeek's API behaviour as *measured*, not assumed. Don't
  re-guess it.
- **§17** is the client: what a render destroys, the URL as the view, and the
  traps behind each.

`GLOSSARY.md` is the naming authority. `TODO.md` is the build order. `ideas/`
holds plans and sketches. Completed work is git history, not this file.

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
- `npm run unarchive -- <slug>` — ⚠️ the *only* way an archived game comes
  back: archiving is one way from the studio, the originator's alone, and
  never a published game's (spec.md §11). With no slug it lists what is
  archived.
- `npm run backup -- [dest]` — one consistent copy of the database
  (`VACUUM INTO`), safe while the studio runs. The game trees recover
  themselves from git; the chats and accounts only live here.
- `npm run sweep` — bring every game's studio library up to date: missing
  libraries added, held ones raised, the game's own files never touched.
  One studio-authored commit per game; archived games skipped. Run it on
  the machine holding the games, ideally while the studio is quiet.

Ports default to 8100 (studio) and 8101 (games). 

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

spec.md §12 is the tested list. These are the ones a change is most likely to
walk into, each paid for once already.

- `server/files/paths.js` is the security boundary. Everything touching a file
  goes through it. It returns a reason for tools, throws a 400 for routes. It
  also owns `isLibraryPath`: `studio/` is readable by agents and never writable
  by them.
- Every git command except `init` is pinned with `--git-dir`/`--work-tree` and
  carries `-c core.quotePath=false`. Unpinned, git walks upward and finds
  whatever repo encloses `GAMES_DIR` — in development that's this checkout.
  Unquoted, a path with an accent comes back escaped and matches nothing.
- The games listener never reads the `session` cookie and serves nothing but
  static files, the catalog, the wrapper, and the scoreboard and achievement
  routes. It exists to be a separate origin (spec.md §7).
- ⚠️ Two headers on the catalog are load-bearing — `frame-ancestors 'none'`
  and `COOP: same-origin` — because a password form now shares an origin with
  LLM-written game code.
- Write-and-commit is serialised per project through `files/mutex.js`.
- ⚠️ A save is written at once and committed later, as the project's **pending
  commit** (`files/pending.js`, spec.md §5). Anything that commits directly, or
  reads the tree into history — a helper's write, a move, a restore, a fork —
  lands it first, inside the mutex, or a commit carries somebody else's
  uncommitted work under the wrong name. The preview follows `files.changed`
  (the write); Versions follows `version.new` (the commit).
- A score, a personal best and an achievement are rows in SQLite, never files:
  a run commits nothing, restarts no preview, and never enters an agent's
  context or thrashes its prompt cache.
- A reasoning trace is never persisted and never replayed into a later fire.
  The one time one enters a request is the thinking cap's hand-on — the same
  fire, once, as text — and the receipt keeps a placeholder for it (spec.md §8).
- `Humans only` is enforced where a helper would be *put in*
  (`assertBotsAllowed`), not where one would answer: a room that promises
  nobody is listening keeps that promise at the door. `Building` is the
  **builder**'s room and is refused at the same door: its one seat, no `+`,
  no rename, and the builder itself goes nowhere else (spec.md §3, §8).
- ⚠️ The **sizing** ask rides the last user message *after* everything else on
  it. Ahead of an attachment it was swamped, and anywhere but the last message
  it would break the cache prefix the fire shares with it (spec.md §8, §14).
- ⚠️ The preamble in `orchestrator.js` names every capability **by the words on
  the button**, and `orchestrator.test.js` asserts each name — so renaming a
  button without updating the prompt fails a test. A capability an agent is
  not told about may as well not exist.
- ⚠️ The quiz, story and achievements editors are shape-locked: a stray extra
  key on an answer, a scene or a rule costs somebody their editor. The
  preamble says so, and the shape modules are shared rather than restated.
- ⚠️ A game's type is `projects.type`, a column rather than a file, so no
  `write_file` can change which editors somebody sees.
- ⚠️ The studio library's **compatibility law** (spec.md §4): a library version
  N+1 must run every game that ran N. `npm run sweep` raises every game at
  once and cannot know better; break it and the fix is by hand, game by game.
- A library is *named* to an agent rather than sent — each one's top comment
  block rides the preamble as its API note, read from the game's own copy.
  ⚠️ screens.js's is 3,035 bytes against a 3,072 cap: condense before adding
  to it. The notes are followed by the **shape of a game**, which is what says
  a game is expected to *make* those calls rather than merely being able to;
  every line of it is gated on the manifest, and both halves are tested.
- The ambient file block lives in the **system prompt**, after the brief and
  the agent description, never on the last user message; the order inside it
  and the history trim boundary hold still between fires. All of it is for the
  prompt cache, and all of it was measured (spec.md §8, §14).
- The client's rules are spec.md §17. The three most often walked into: a new
  `.scroll` container needs a `data-scroll` name; nothing calls `fetch`
  directly, `send()` does; and an `onclick` that opens something must return
  its promise all the way up, or Back stops working.
- ⚠️ `rename-file` is the dialog for a *file's* name and `rename` is the
  *game's*. The two are one click apart in the interface.

## Dev-environment gotchas

- **`GAMES_DIR` must live outside this checkout when running locally.** The
  sandbox refuses to *create* a `.git` directory beneath the project root, so
  `git init` inside `./games/` fails with EPERM. Use
  `GAMES_DIR=$TMPDIR/gamestudio-games`. Deployed, `./games` is fine.
  Committing into a game repo that *already* exists under `games/<slug>/` does
  work, which is how a helper's result gets carried back from a temp
  `GAMES_DIR` into this checkout.
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
  `&` cannot be stopped by anything in the session — it squats on its port
  until a human kills it. Instead run it as one Bash call with
  `run_in_background: true` and **no** `&`; the harness owns the process, and
  `TaskStop` with the task id it hands back really does release the port.
  Stop it in the same turn that started it, and quote the **task id**, not the
  PID, in anything you report: `kill <pid>` is denied. (`pkill -f` matches the
  *relative* command line, `server/index.js`, so a pattern with the full path
  in it silently matches nothing.)
- **Pick the port after looking, not before.** Collisions are normal here and
  the "already in use" message is telling the truth; `lsof -nP -iTCP
  -sTCP:LISTEN | grep node` lists what is up. ⚠️ **Two of those are the
  operator's and must never be killed or reused:** 8090 is `new-y`, and
  **8100/8101 is the operator's own running studio** — the defaults, which is
  exactly why they look like an abandoned test. `ps` is restricted to this
  session's own processes, so a PID from `lsof` cannot be identified by
  reading its command line: never tell the operator to kill something on the
  strength of its port number. Only ever offer up a task id this session
  started.
- A migrated game is verified in a browser at
  `localhost:8080/fam/gamestudio/games/<slug>/index.html`, which needs no
  studio running.

## Audience and direction

The studio is used by kids. That shapes the interface, not the engineering:
every technical affordance is present (file tree, versions, diffs, reasoning
traces, model choice), but user-facing strings are plain language and
destructive actions confirm first. The UI says **helper** where the code says
**agent** — see GLOSSARY.md, and don't let "helper" leak into the code.

Three conventions to keep. **A link looks at something, a button changes
something** (`Show changes`, `All files`, `Versions` and every path in a diff
are `button.link`; `Add a file` is a bordered button, and anything that
changes one *thing* — a scene, a line, a file, a version, a helper — is an
item in that thing's `···`, in one order, absent when it may not be pressed).
Anything a control reveals opens **in the row it belongs to**, not at the
foot of the list — one open at a time, and the same control closes it again
with its label
flipped rather than a second control appearing. And **what lights up is what
can be clicked**: a row that highlights under the pointer opens on a click
anywhere in it, or it does not highlight at all.

Nothing in the bar over a conversation is ever greyed out — a button you
cannot press is a question, and the answer (somebody else's game, an archived
one, a room that takes no helpers) is not one a bar can give. Controls that
cannot be pressed are left out instead.

The studio is dark, always: `public/style.css` sets `color-scheme: dark` and
there is no light theme to fall back to — the games are dark and the previews
are dark, and a light shell around them read as two applications. Four colour
roles carry it. **Cyan is the studio's own voice** (New game, the open tab, the
active row) and stays cyan whatever game is open; **pink is a helper**; **gold
is a number worth looking at** — a score, a version — and nothing else;
**crimson is danger** and nothing else. A game's own four (`primary`, `accent`,
`highlight`, `deep` in its `config/look.js`) colour that game's surfaces only:
the chat pane, the composer, the mode row, the rail. ⚠️ Gold is the one
to police — the moment it appears on something that is not a number, the
direction stops working.

## Current state

Complete, green, and running on a real server. What exists, with where it is
specified:

- Projects are games or chats. A game holds several chats and is born with
  `Humans only` and `Building`; a chat project is one room (§3, §6). Helpers
  belong to a chat, with a chatty switch, a cooldown and a thinking level (§8).
- **The builder**: the studio's own helper, in every game's `Building` and
  nowhere else, with nobody else in there. It sizes each message first — one
  small call, no tools, thinking off — and does a big ask as a **plan** of two
  to six **pieces**, one fire each at thinking `none`, each a fresh context
  narrowed to its own files, each its own short row and commit, shown as a
  checklist that ticks. A message mid-plan pauses it; the next sizing carries
  on, sets aside or replaces it. Open rooms with people's helpers are
  unchanged. Measured in §14 on 2026-09-03; designed in ideas/planner.md (§8).
- Accounts split into **studio access** and players behind a waiting list; one
  admin role, per-person allowances over a studio-wide budget; games have
  authors and an **open** flag (§3, §10, §11).
- The games origin serves the catalog, each game through the wrapper, the
  scoreboard and achievements, and a **players page** per game (§6, §7). The
  catalog says how *you* are doing on each card. The preview reloads itself
  on every write — and on nothing else: the frame lives outside the rendered
  tree (§17) — and reports its own errors and moments back.
- Six studio libraries — input, sound, sprites, screens, moments,
  achievements — copied into every game at creation and raised by
  `npm run sweep` (§4).
- Two templates carry their own editors, so a game can be made with no helper
  at all: the quiz, and the visual novel with a guide that builds a story by
  asking one question at a time (§4).
- **Microhelpers**: the guide's *Fill it in for me* and *Make one for me* —
  one request, one answer, nothing kept, through the same two token walls a
  reply goes through and billed to whoever pressed. No message row anywhere
  (§6, §10).
- The **standard set** (`public/story-art/`) is picked from a shelf — a strip
  on the guide's picture card, and a dialog with a filter behind
  `Pick a picture…` on a scene's Picture field in the rail — one file, one
  commit. 33 portraits and 9 backgrounds, all CC0 (Kenney and Stealthix).
  Beside it the **studio collection**: pictures people here have added, on
  the same shelf, put there by `Copy…` on a picture's row under Code.
  ⚠️ Bytes in the row so `npm run backup` covers them, and ⚠️ no licence
  recorded — whoever drew it keeps it (§3).
- A scene takes **music** (`assets/music/`, looped, carried into the next
  scene naming the same track) and a **sound step** — a noise among the lines
  rather than a key on the scene. ⚠️ Scene-level `sound:` still plays but is
  never written back, so an existing visual novel needs its own `js/story.js`
  brought forward before its story is re-saved (§6).
- The centre pane is one **mode** at a time — Chat, a game type's editors
  (Write, Questions), Pics, Hear, Code, Share — in a row of pills over it;
  the rail is the preview, and under it the selected thing's fields. Pics
  shows every picture by kind (a visual novel's Characters and Places, every
  game's sprites and dressing) and opens one full width in the pixel editor;
  Hear lists sounds over music and puts the sound editor in the rail; Code is
  the tree, opening text and config forms; Share is the link, the versions,
  the scoreboard and the achievements editor as one page. The pixel editor,
  the sound editor, the story and the quiz save themselves; Code's text editor
  keeps Save. Everything done to a thing is behind its one `···` (§6,
  ideas/calm-shell.md).

Open questions:

- Touch schemes and the story editor are browser-checked at phone width but
  have never been felt on a real phone. Both are TODO lines.
- Networked multiplayer is unbuilt and no longer blocked — the scoreboard
  settled whether the games origin can hold state. See `ideas/next-five.md`.
- Deferred by choice: spec.md §15. Typing previews are permanently out (§2).

## Git policy (overrides global)

You manage git directly in this project. The global "manual git" rule does
NOT apply here. `git push` remains denied at the permission layer; the user
handles pushing.

Workflow:

- Commit after each meaningful change passes its tests. One logical change
  per commit.
- Stage only the files relevant to the change. Use `git add <path>`, never `git add .`.
- **A feature's docs ride its last commit, not each one.** spec.md,
  GLOSSARY.md and the TODO line land together in the commit that finishes the
  job — which is what the global "same commit, no exceptions" rule asks for
  anyway. Editing spec.md four times across four commits costs four reads of
  its neighbourhood and buys nothing.
- Conventional commit messages: feat:, fix:, refactor:, docs:, test:, chore:.
  First line under 72 chars. Body if useful, omitted if not.
- Never commit on red. If a test was passing and now isn't, fix the test or
  the code before committing — do not commit broken state.
- Do not include AI attribution in commit messages.
