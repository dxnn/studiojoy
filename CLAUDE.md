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

`spec/` is the design-of-record, one file per section: data model, routes,
files on disk, the studio library and templates, agent orchestration, SSE
events, limits, auth, accepted tradeoffs, invariants. Read it before any
non-trivial change.

- **§14** is DeepSeek's API behaviour as *measured*, not assumed. Don't
  re-guess it. ⚠️ But do check its dates: DeepSeek retired V4-Flash on
  2026-09-10 and the studio ran on its replacement for two days without
  noticing, because the old name still answers. Everything in §14 dated before
  then describes a model that no longer exists, and one of those findings —
  *images are not supported* — had already reversed. Two more were re-taken on
  2026-09-13: the **cliff**, which survives in a worse and different shape, and
  the **6 K prefix rule**, which is gone. On 2026-09-15 the **sizing** table,
  the **piece-shape** arms and the cliff's **rate** followed — `low` on a
  whole-game ask runs away 15 times in 16 — so every table on that page now
  has a V4.1 row under it.
- **§17** is the client: what a render destroys, the URL as the view, and the
  traps behind each.

`GLOSSARY.md` is the naming authority. `TODO.md` is the build order. `ideas/`
holds plans and sketches. Completed work is git history, not this file.

`probes/` holds the one-off scripts §14 is made of, tracked since 2026-09-13 —
they lived in gitignored `tmp/` before that, so the spec cited files nobody
else had. They are not in `npm test` and they cost money to run.
`probes/probe-prompt-eval.mjs` is how a change to the builder's prompt is
judged: the real orchestrator on ten fixed asks, a rule score, and pairs for
a blind judge, read against two runs of the old prompt (§14, about $0.50 a
run of thirty). ⚠️ Never a
key in there: `tmp/deepseek.key` or `$DEEPSEEK_API_KEY`, and `probes/*.key` is
ignored as a second lock.

## Commands

- `npm test` — the full suite. `node:test` against `:memory:` SQLite, a temp
  `GAMES_DIR`, and a scripted fake LLM. No network, no API key.
- `npm start` — needs `DEEPSEEK_API_KEY`; fails fast without it.
- `npm run smoke` — one live DeepSeek round trip; needs the key, not in `npm test`.
- `npm run ui` — the browser checks: real geometry, computed colour, a real
  pointer, at 390px and 1280px. Needs `npx playwright install chromium` once.
  Not in `npm test`. ⚠️ **A coding agent cannot run this** — Chrome's Mach
  port bootstrap is denied in the agent sandbox, with Playwright and with a
  hand-rolled driver alike. An agent writes these; a person runs them. What
  an agent *can* do is drive a throwaway studio through the Playwright MCP
  server, which is the operator's own process — see the last dev gotcha.
- The scripts below find the database through `DB_PATH`, then the studio's
  env file (`$STUDIO_ENV` or `~/apps/studio.env`), then `gamestudio.db` beside
  the code (`bin/env.js`), and print `using <file>` when the file answered.
  ⚠️ So on a machine that has that file, a script run without `DB_PATH` acts
  on the real studio. This laptop has none (checked 2026-10-01) — ⚠️ but it
  has the retired `gamestudio.db`, which still lists 12 games, and `./games`
  holds the production mirrors, so a script run here acts on those mirrors
  without saying so: `npm run sweep` did, 2026-10-04.
- `npm run adduser -- <email> "<Name>"` — makes an account without a studio
  running; the admin panel does the same from a browser.
- `npm run deluser -- <email>` — ⚠️ the *only* way somebody leaves the studio:
  no route, no button. A soft delete: `users.deleted = 1` and their sessions,
  never a DELETE. `npm run restoreuser -- <email>` is the undo; with no email
  it lists who is out. ⚠️ Add `--scores` and their board rows, bests and
  achievements really are deleted, which no restore gives back.
- `npm run unarchive -- <slug>` — brings an archived game back from a
  terminal. The studio does it too now: Archive and Unarchive are both in the
  game's `···`, both the originator's alone, and archiving is never a
  published game's nor a chat's — a chat with the bit from before is read as
  not archived (spec/ §11). The script is for the game the studio cannot
  reach — one whose originator has been removed. With no slug it lists what is
  archived.
- `npm run backup -- [dest]` — one consistent copy of the database
  (`VACUUM INTO`), safe while the studio runs. The game trees recover
  themselves from git; the chats and accounts only live here.
- `npm run pushkeys -- mailto:you@example.com` — the VAPID pair for **web
  push**, printed as the three lines `studio.env` wants. ⚠️ Run it **once**
  for a studio: the public half is what every browser subscribed with, so a
  new pair silently stops every one of them hearing anything — the push
  service keeps taking the message and nothing anywhere says so.
- `npm run pullart` — write the **big set** (`public/big-set/`): CC0 pictures
  from Kenney, PhyloPic and svgsilh, committed to this repo so a kid types a
  word and gets a picture offline. `--dry` fetches everything and writes
  nothing; `--list` fetches nothing at all; naming a source pulls only that
  one. ⚠️ Run it from a **laptop**: svgsilh sits behind Cloudflare, which
  refuses a datacenter address on every path. Not in `npm test`, which has no
  network. ⚠️ Art belongs to whatever fetched it and only a successful fetch
  replaces it — Kenney per *pack* — so a source or a pack that fails leaves
  its pictures exactly where they are and the rest of the pull still lands.
- `npm run sweep` — bring every game's studio library up to date: missing
  libraries added, held ones raised, the game's own files never touched.
  One studio-authored commit per game, archived games included (they stay
  playable). Run it on the machine holding the games, ideally while the
  studio is quiet — every `bin/` script now says which database and games
  folder it is about to touch, first.

Ports default to 8100 (studio) and 8101 (games). 

Running locally in this sandbox, both gotchas below apply at once:

```sh
export GS=$TMPDIR/gamestudio-dev
echo hunter2 | DB_PATH=$GS/db node bin/adduser.js you@example.com "You"
NODE_OPTIONS=--use-env-proxy DEEPSEEK_API_KEY=$(cat tmp/deepseek.key) \
  DB_PATH=$GS/db GAMES_DIR=$GS/games npm start
```

No build step, no linter, and **no runtime dependency**: `npm ci --omit=dev`
is all the studio needs to run. One devDependency, Playwright, and only
`npm run ui` touches it. Node ≥ 24, ESM.

`README.md` is the walkthrough for somebody running their own studio, and
`deploy/` the runbook behind it: pm2 definition, env template, push-to-deploy
hook. One process serves both hostnames, so it is one repo and one pm2 app —
the thing every generic guide gets wrong here.

⚠️ The repository is public on GitHub under MIT (decided 2026-10-01). No
production hostname, address or key goes in it: the operator's studio is
theirs alone, and the repo is for people running their own.

## Invariants worth keeping

spec/ §12 is the tested list. These are the ones a change is most likely to
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
  static files, the catalog, the wrapper, a live listing of each game's
  `assets/`, the scoreboard and achievement routes, and gear's pictures
  (`/_gear/:id`, for the makers' avatars on the catalog). It exists to be a
  separate origin (spec/ §7).
- ⚠️ Two headers on the catalog are load-bearing — `frame-ancestors 'none'`
  and `COOP: same-origin` — because a password form now shares an origin with
  LLM-written game code.
- ⚠️ The games origin never says an account's name, only its **alias**
  (`server/alias.js`, spec/ §7): a player there is an id and an alias and
  nothing more, and no route there changes either, since any game's code
  could drive it with its player's cookie. The wire key is still `name`.
- Write-and-commit is serialised per project through `files/mutex.js`.
- ⚠️ A save is written at once and committed later, as the project's **pending
  commit** (`files/pending.js`, spec/ §5). Anything that commits directly, or
  reads the tree into history — a helper's write, a move, a restore, a fork —
  lands it first, inside the mutex, or a commit carries somebody else's
  uncommitted work under the wrong name. The preview follows `files.changed`
  (the write); Versions follows `version.new` (the commit).
- ⚠️ **Cancel** (`toolset.putBack`, spec/ §8) undoes a fire by writing HEAD
  back over what it touched, and commits nothing. That is right only while a
  fire commits at its end and never before, and every write tool settles the
  pending commit first. A tool that commits mid-fire breaks Cancel silently.
- A score, a personal best and an achievement are rows in SQLite, never files:
  a run commits nothing, restarts no preview, and never enters an agent's
  context or thrashes its prompt cache. ⚠️ So are **chips** and **joy**
  (`ledger`, `server/joy.js`): joy is made only by holding an achievement
  of a published game — paid up to what it gives, never twice, editors
  included — chips only by the weekly grant, and no `write_file` can make
  either. ⚠️ Nor take away an achievement with joy on it: every write door
  asks `joyRefusal` (server/achievements.js), so a new door that writes
  `config/achievements.js` must ask it too.
- ⚠️ The preview is the **preview player** (`server/preview-player.js`,
  spec/ §6): always debugging, never on a board. It owns the game's clock,
  its timers (`setTimeout`, `setInterval`, `Date.now()`, `new Date()`, an
  event's `timeStamp`) and its random numbers, and answers `/_scores`,
  `/_achievements` and `/_me` inside the page — `fetch` and `sendBeacon`
  only. Its savepoint is `State.save()`, the random stream and the robot's;
  Back never moves the clock backwards, because every template's loop takes
  `dt` from it and only caps it from above. ⚠️ Time goes in whole 1/60 s
  frames at **every** speed (since 2026-10-05): slow motion is the same
  frames further apart, so a game counting per frame counts the same as at
  1×, and a robot's run replays. The builder is told to count by time, not
  by frame, which is the half that fixes a 120 Hz screen. ⚠️ It lives under **Play**, a mode, and
  off Play — or behind the list on a phone — it stays loaded and *paused*
  (`placePreview` tells it, when `playOnScreen` flips), never
  unloaded while a game is open: the builder's shot is taken from it when a
  message is sent from Speak — so a page that loads paused is handed one
  frame with no time in it, or that shot is a canvas nothing drew on. The
  fixed frame is cut to the scroller of Play's game side (`clip-path`), or
  scrolling it slides the frame over the pills. Beside the game from 700px
  of Play across, under it narrower, each side scrolling on its own, are
  the **tweaks**: config
  values tried in the running game, kept per browser, written only by Save
  (`public/tweaks.js`). A tweak reaches an object `const` live and never a
  plain-number one.
- A reasoning trace is never persisted and never replayed into a later fire.
  The one time one enters a request is the thinking cap's hand-on — the same
  fire, once, as text — and the receipt keeps a placeholder for it (spec/ §8).
- A reply's `body` is the **last** turn's words; what earlier turns said is
  its **working**, in its own column, never shown as the reply and never
  replayed. Joining the turns back into one body is how a 167 KB wall got
  replayed into every fire in a chat (spec/ §8).
- `Humans only` is enforced where a helper would be *put in*
  (`takesHelpers`, read by `assertBotsAllowed` and by a mention's call-in),
  not where one would answer: a room that promises nobody is listening keeps
  that promise at the door. ⚠️ Every other room in a game is a **builder
  room**, refused at the same door: the builder's one seat, no `+`, and the
  builder itself goes nowhere else and cannot be taken out. A person's helper
  lives in a chat project, blind — no tree, no tools, no preamble — so there
  is no file-tools switch anywhere (spec/ §3, §8; since 2026-09-15).
- ⚠️ The **sizing** ask rides the last user message *after* everything else on
  it. Ahead of an attachment it was swamped, and anywhere but the last message
  it would break the cache prefix the fire shares with it (spec/ §8, §14). The
  *shortness* of that last message is no longer part of the invariant: V4.1
  dropped the ~6,000-token penalty a long one used to cost (§14, 2026-09-13).
- ⚠️ The preamble in `orchestrator.js` names every capability and
  `orchestrator.test.js` asserts each name — a capability an agent is not told
  about may as well not exist. It names them by the **code's** words, which
  since 2026-09-04 are no longer the words on the pills: the buttons read
  Speak, See, Hear, Touch, Taste, Recall, Smell (spec/ §6, on trial). The two
  the preamble says out loud are `Controls` and `Share`, so a helper can point
  somebody at a button that is not there. Deliberate, and two strings from
  being over.
- ⚠️ The quiz, story and achievements editors are shape-locked: a stray extra
  key on an answer, a scene or a rule costs somebody their editor. The
  preamble says so, and the shape modules are shared rather than restated.
- ⚠️ A game's type is `projects.type`, a column rather than a file, so no
  `write_file` can change which editors somebody sees. `'design'` is a game
  still in **Game Design**: the one type that changes, once, by Make it — and
  it has no `Building` until then, which the boot migration (`intoChats`)
  must keep passing by.
- ⚠️ The studio library's **compatibility law** (spec/ §4): a library version
  N+1 must run every game that ran N. `npm run sweep` raises every game at
  once and cannot know better; break it and the fix is by hand, game by game.
- A library is *named* to an agent rather than sent — each one's top comment
  block rides the preamble as its API note, read from the game's own copy.
  The largest, screens.js's, is 2,387 bytes against a 4,096 cap since the
  2026-10-06 trim: say a call once, and raise the cap only when the
  alternative is deleting a call somebody can still make. Each note is led
  by its library's lines of the **shape of a game**, which is what says a
  game is expected to *make* those calls rather than merely being able to;
  they are its `shape` in `studio-lib/index.json`, gated on the manifest, and
  both halves are tested. The note is the calls and the shape is the
  expectation — neither repeats the other.
- The ambient file block lives in the **system prompt**, after the brief and
  the agent description, never on the last user message; the order inside it
  and the history trim boundary hold still between fires. All of it is for the
  prompt cache, and all of it was measured (spec/ §8, §14).
- The client's rules are spec/ §17. The three most often walked into: a new
  `.scroll` container needs a `data-scroll` name; nothing calls `fetch`
  directly, `send()` does; and an `onclick` that opens something must return
  its promise all the way up, or Back stops working.
- ⚠️ The pixel editor has **two** sizes: `MAX_DRAWN` (256) is the biggest it
  will make, per picture and per *frame* of a strip; `MAX_SIDE` (1024) is the
  biggest it will open, because uploads arrive bigger. Mixing them up makes a
  picture the editor will not open again (spec/ §6).
- ⚠️ No field's text is under 16px on a touchscreen — one `!important` rule in
  `base.css` under `@media (pointer: coarse)`, because under it iOS Safari
  zooms the page in on focus and leaves it there. A surface may still size its
  own fields for the desktop; the code editor's `<pre>` twin is the one thing
  that has to be raised alongside (spec/ §17).
- The stylesheet is one file per surface under `public/css/`, linked in order
  from `index.html`. Two of those positions are load-bearing: `base.css` first,
  because it sets the custom properties the rest read, and `narrow.css` last,
  because its media queries override rules of their own specificity. A new
  piece has to be linked or it is served and never loaded — `test/style.test.js`
  checks that the two lists match.
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
- **Seeing a studio change in a real browser** (the one check `npm run ui`
  cannot give an agent): the Playwright MCP tools drive a Chromium outside
  the sandbox. `mkdir -p $TMPDIR/gs-x/games`, `adduser` against
  `DB_PATH=$TMPDIR/gs-x/db`, start the studio as a tracked background task on
  a spare port pair with that `DB_PATH` and `GAMES_DIR`, sign in with the
  browser tools and drive it. ⚠️ Refs from a snapshot go stale on every
  background render, so once a page is live click by selector (`text=…`,
  `role=button[name="…"]`, `… >> nth=0`), not by ref. `browser_run_code_unsafe`
  gives `page.mouse` for a real drag on a canvas, and an in-page `fetch` PUT
  to `/api/projects/<slug>/files/x.txt` is a deterministic way to cause a
  background `files.changed` render. A file for `browser_file_upload` has to
  sit under `/tmp/claude/playwright/` or this checkout, and not be called
  `hero.png`, `icon.png` or `chat.png` — a reserved name lands as dressing and
  skips the over-1024 check. Stop the task and close the browser in the same
  turn. Checked 2026-09-07, when it caught a scroll jump no test could.

## Audience and direction

The studio is used by kids. That shapes the interface, not the engineering:
every technical affordance is present (file tree, versions, diffs, reasoning
traces, thinking levels), but user-facing strings are plain language and
destructive actions confirm first. The UI says **helper** where the code says
**agent**, **editor** where the code says `author`, and **Speak/See/Hear/
Touch/Taste/Recall/Smell** where the code says `chat`/`pics`/`hear`/
`controls`/`code`/`versions`/`share` — see GLOSSARY.md, and don't let either
side's words leak across. Anything a person reads takes the interface's word;
every id, comment, route and spec paragraph takes the code's.

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

The studio is dark, always: `public/css/base.css` sets `color-scheme: dark` and
there is no light theme to fall back to — the games are dark and the previews
are dark, and a light shell around them read as two applications. Four colour
roles carry it. **Cyan is the studio's own voice** (New game, the open tab, the
active row) and stays cyan whatever game is open; **pink is a helper**; **gold
is a number worth looking at** — a score, a version — and nothing else;
**crimson is danger** and nothing else. A game's own four (`primary`, `accent`,
`highlight`, `deep` in its `config/look.js`) colour that game's surfaces only:
the chat pane, the composer, the mode row, Play. ⚠️ Gold is the one
to police — the moment it appears on something that is not a number, the
direction stops working.

## Current state

Complete, green, and running on a real server. What exists, with where it is
specified:

- **Game Design** (§6, built 2026-10-04): New game asks a name, and the game
  is born in Game Design — cards asked one at a time into `SPEC.md`, then
  *How it's made* picks a template or none from a table and **Make it**
  (or *Skip to making it*) writes it all as one version and opens
  `Building`. Driven through the MCP browser at 1280 and 390, never on a
  finger. Jev for reading a *Something else…* answer is planned, not built.
- Projects are games or chats. A game is made with `Humans only` and
  `Building`, and every chat added to it is another **builder room** — the
  studio's helper seated, nobody else's let in — so a game is where the
  Builder is; a chat project is one room, and the one place a person's
  helper can be, blind to any tree (§3, §6). A helper belongs to a chat, with
  a chatty switch, a cooldown and a thinking level (§8).
- **The builder**: the studio's own helper, in every one of a game's builder
  rooms and nowhere else, with nobody else in there. It sizes each message first — one
  small call, no tools, thinking off, its rules in the preamble and a short
  trigger on the last message — and answers a remark as a **reply** and any
  change as a **plan** of one to six **pieces**, one fire each on the
  sizing's own prompt with fresh copies of what changed, each its own commit,
  its row filed behind the **plan card**, which is the one reply the thread
  shows: a checklist that ticks, each line a piece's title, the files it
  changed and its **headline**. A plan of one runs at once at the builder's
  level; a plan of two or more waits as a **draft** the person can change
  until **Build it**, and its pieces run at `none`. A message mid-plan pauses it; the
  next sizing carries on, sets aside or replaces it. Measured in §14 on
  2026-09-03 and 2026-09-06; designed in ideas/planner.md (§8).
- **Cancel** (§8, built 2026-10-05, a kid's ask): on any live reply, for
  whoever may write there, no confirmation. Stops the running fire — one
  piece, one small ask, one reply — and puts back every file it wrote; in a
  plan only that piece, and the plan pauses. Driven once in the MCP browser
  against live DeepSeek, mid-piece; never on a finger.
- Accounts split into **studio access** and players behind a waiting list; one
  admin role, per-person allowances over a studio-wide budget; games have
  authors and an **open** flag (§3, §10, §11).
- The games origin serves the catalog, each game through the wrapper, the
  scoreboard and achievements, a **players page** per game, and each game's
  `assets/` as a live listing at `_assets` (§6, §7). The catalog says how
  *you* are doing on each card, and wears each game's icon and hero. The preview reloads itself
  on every write — and on nothing else: the frame lives outside the rendered
  tree (§17) — and reports its own errors and moments back, and a **shot**:
  a frame of its canvas, drawn when somebody sends a message, which is what
  `look_at_game` hands a helper (§3, §8).
- Both the studio and the front page install as PWAs — a manifest and a
  service worker each, neither caching anything (§7). The studio's worker has
  one other job: showing a **notification** and handling a press on one, since
  a plain `new Notification` never fires on an installed iOS PWA.
- **The arc** (`public/arc.js`, `public/arc-card.js`, §6, ideas/doneness.md):
  how done a game is, apart from published. A game collects **stamps** in its
  type's order, each a game-making principle in a kid's words with checks the
  studio ticks from names and asks that land in the composer; the person
  presses to earn one (`projects.stage`, one at a time), the checks never
  gate, and the builder is told the stamp in one preamble line.
- **Notifications** (`public/notify.js`, §6, ideas/notifications.md): a
  message landing in a room you are not reading, while the studio is not the
  thing on screen. The same decision as the unread mark, made once in
  `applyMessage`. The switch is the bell in the sidebar's `who` row,
  remembered per browser.
- **Web push** reaches a studio that is closed (`server/push.js`,
  `server/notify.js`, §6). ⚠️ Hand-rolled VAPID and `aes128gcm` — `new-y`
  takes `web-push` off npm and this studio has no runtime dependency — so it
  is checked against the RFCs' own worked examples, never a live push
  service. `npm run pushkeys` makes the pair **once**: a new one silently
  stops every browser already subscribed from hearing anything. Three
  `VAPID_*` in the environment or none; without them the routes are 404 and
  only a live tab is told. Needs a secure origin.
- **The announcements** (`server/announcements.js`, §3, §6): one chat
  project with `announce = 1`, heading the Chats tab and pinned over the
  sidebar only while something in it is unread, written by an admin
  and read and reacted to by everybody. ⚠️ The bell off no longer
  unsubscribes: it keeps the browser for the announcements alone
  (`announcements_only`), so they reach everybody whose browser ever said
  yes. Built 2026-10-02 and driven in the MCP browser; no real push service
  has carried one yet.
- Seven studio libraries — state, input, sound, sprites, screens, moments,
  achievements — the **core set**, copied into every game at creation and
  raised by `npm run sweep` (§4). **State** (2026-10-04) is the run itself:
  everything a game changes while played lives in it as plain data, which
  is what the preview player's **Pin** and **Back** save and put back. The
  seven templates keep their run in it, and ⚠️ none takes a way in from its
  own address — *Try this scene* and *Try it* lay their fields over State
  through the savepoint, so a player cannot skip ahead. Every existing game
  was moved by hand and is live (2026-10-04, ideas/state-migration.md) —
  ⚠️ except eight archived ones, whose library commit is still to push. A
  game without State says it cannot be pinned. An **extra** goes only where a template
  names it or a person adds it, and the sweep never adds one. Two exist:
  **physics**, a façade over vendored planck.js, and **render3d**, one over
  vendored three.js — ⚠️ a module, so a game using it has its own code as a
  module too, and calls `Screens.fit` once, before `Render3D.start`, since
  the WebGL buffer is the canvas's width and height (§4). Each library carries its own shape lines and
  each type its own preamble paragraph, in the two index files, so neither
  needs an orchestrator edit (ideas/modularity.md). Screens owns how big a game is on the screen
  (`Screens.fit`) as well as its words: a game that sizes its own canvas on
  the window's width alone comes off the bottom of a sideways phone, which
  two of them did.
- Six templates carry their own editors, so a game can be made with no
  helper at all: the quiz; the visual novel, with a guide that builds a story
  by asking one question at a time; the **point-and-click adventure**
  (Scenes), whose spots are boxes dragged on the picture and whose guide asks
  the same way; the **racing game** (Track), whose track is points dragged
  on a canvas with explicit Save (§6, built 2026-09-15); **Knock it down**
  (World), a pile of physics bodies dragged and sized on the same **plan
  canvas** (§6, built 2026-09-22); and **Roll a ball** (Level), the first 3D
  game, a list of mazes painted square by square on that canvas, with
  **kinds of square** a game makes up (`SQUARES`, drawn before they do
  anything; `ON_SQUARE` is what they do) — no studio surface draws 3D, *Try
  it* is where it is seen (§6, 2026-09-23; levels 2026-09-28). The track, world
  and level editors' drags and 390px layout, Delete in the first two (a
  level is painted over, so it has none), and both new games,
  were driven through the Playwright MCP browser (WebGL included), which
  caught Delete never reaching the studio and the canvas squeezed to a
  sliver on a phone. ⚠️ The adventure's box-drag has
  still not been shown in any browser, and none of it has met a real finger.
- **The robot** (🤖 under the preview, spec/ §6, ideas/dreams.md §4, built
  2026-10-04): the preview player's own player, pressing a game's verbs as
  keys and tapping its buttons, run after run, at 1× to 16×. A game teaches
  it in `js/robot.js`, which only the wrapper loads; every template ships one
  and the builder is told how to write one. It keeps a rolling savepoint and,
  when the game throws, offers *Go to just before it broke*, which replays
  into the same break. Driven in the MCP browser on all five canvas and page
  templates and a game built to break; ⚠️ 16× reached about 7.7× there,
  headless Chromium's frame cap. *Is it too hard?*, the catalog card playing
  itself and Jev are later (TODO.md).
- **Joy and chips** (spec/ §3, ideas/dreams.md §5, built 2026-10-04): every
  author gets 10 **chips** a week into a **stash** of at most 50, and puts
  them on their published games' achievements — 1, 5, 10 or 20 joy in the
  editor, an interface limit only. Everybody who holds one gets that much
  **joy**, its editors too, and is topped up when it gives more (2026-10-05):
  a bounty, inflationary on purpose. Gold on the achievement,
  the toast (achievements library v3, so the sweep carries it), the catalog
  card's *joy to earn* and beside your alias; your settings show both. Driven
  in the MCP browser end to end.
- **Avatars** (spec/ §6, ideas/dreams.md §6, built 2026-10-04): a head, a
  body and legs, each a piece of **gear** drawn in the pixel editor's gear
  mode inside its shape — a mask no tool paints outside — three a person a
  week, the maker's for nothing, everybody else's for 20 joy spent to nobody.
  The **wardrobe** is the centre pane at `/wardrobe`, from the Crew tab; a
  crew row opens a person's whole avatar; heads in chat and the sidebar; the
  catalog card shows each game's maker. Driven in the MCP browser end to end
  at 1280 and 390, never on a finger.
- **Microhelpers**: the guide's *Fill it in for me* and *Make one for me* —
  one request, one answer, nothing kept, through the same two token walls a
  reply goes through and billed to whoever pressed. No message row anywhere
  (§6, §10).
- The **standard set** (`public/story-art/`) is picked from a shelf — a strip
  on the guide's picture card, and a dialog with a filter behind
  `Pick a picture…` on a scene's Picture field — one file, one
  commit. 33 portraits and 9 backgrounds, all CC0 (Kenney and Stealthix).
  Beside it the **studio collection**: pictures people here have added, on
  the same shelf and first on it, put there by `Duplicate…` in a picture's
  `···` (under Pics or Code) with *The studio's collection* as its destination.
  ⚠️ Bytes in the row so `npm run backup` covers them, and ⚠️ no licence
  recorded — whoever drew it keeps it (§3).
- The **big set** is the shelf's third half: 1,775 CC0 sprites in
  `public/big-set/`, written by `npm run pullart`, searched offline by
  name *and* `tags` — `Triceratops` comes back for *dinosaur*. ⚠️ Its safety
  is the hand-written source list in `bin/pullart.js`, not a filter, and there
  is no moderation queue behind it. Reached from `+ Find a thing to put in`
  under Code, and from **Add from the studio** under Pics, which names no
  kind and shows all three halves at once; the interface says **thing** where
  the code says `sprite` and **character** where it says `portrait` (spec/ §6). The svgsilh half is written and **never run** — this
  sandbox cannot reach svgsilh at all (Cloudflare 403) — so the first real
  pull is somebody's laptop and `--dry` is how to try it. Its parser is
  tested against the site's real markup, and it refuses in three seconds
  here, which is the failure looking right rather than the source working.
- A scene takes **music** (`assets/music/`, looped, carried into the next
  scene naming the same track) and a **sound step** — a noise among the lines
  rather than a key on the scene. ⚠️ Scene-level `sound:` still plays but is
  never written back, so an existing visual novel needs its own `js/story.js`
  brought forward before its story is re-saved (§6).
- **One pane** beside the sidebar (since 2026-10-05, spec/ §6 the shell):
  the rail is gone, because on a phone there was only ever room for
  one pane and on a wide screen neither could be closed. The centre is one
  **mode** at a time — Chat, a game type's editors (Write, Questions), Pics,
  Hear, Code, Share and, last, **Play**, the game — in a row of pills over it.
  The selected thing's fields open **in place**, under the row or cards they
  belong to, one at a time. Pics shows every picture by kind (a visual novel's
  Characters and Places, every game's sprites and dressing), opens one full
  width in the pixel editor, and adds one from three buttons rather than a
  dialog — Draw, Upload (straight into the device's picker) and Add from the
  studio; Hear lists sounds over music, a sound's editor under its row; Code is
  the tree, opening text and config forms — and on a phone an open file takes
  the whole pane, ✕ being the way back to the list; Share is the link, the versions,
  the scoreboard and the achievements editor as one page. The pixel editor,
  the sound editor, the story and the quiz save themselves; Code's text editor
  keeps Save. Everything done to a thing is behind its one `···` (§6,
  ideas/calm-shell.md). A picture opens on one click, wherever it is pressed;
  the preview's `···` holds the shape to try the game in, and *Try* opens
  Play. ⚠️ The pills are named for the senses — Speak, See, Hear, Touch,
  Taste, Recall, Smell, then plain Play — and nothing under them is (spec/
  §6). On a phone the bar and the pills are the **phone header**: the game's
  name and `···` on one row, and the **view changer**, ‹ mode ›, holding still
  over the centre (spec/ §17). Driven at 1280 and 390 in the MCP browser —
  the paused-off-Play clock measured from inside the game, the shot taken
  from Speak — never on a finger.
- Typing an `@` in the composer opens the menu of everybody it could reach,
  people over helpers, filtered by the server's own rule (§6). ⚠️ It reads its
  keys before the composer does, or Enter sends half a sentence.

Open questions:

- **The modes' names are on trial.** The pills read Speak, See, Hear, Touch,
  Taste, Recall, Smell since 2026-09-04; the code and the prompt did not move
  (spec/ §6). What settles it is what the people here do with them — whether
  Smell and Taste are learned or asked about every time. Ending the trial one
  way is a revert of one commit; ending it the other way is two strings in
  `orchestrator.js` and, if it is worth it, reordering the row into sense
  order (it is Speak See Hear Touch Taste Recall Smell today, because the
  labels moved and the row did not).
- **A transient info panel** sliding in from the right, for a selected thing,
  may come back one day — but it does not translate to a phone, which is why
  the rail went (2026-10-05). On a wide screen the chat and the game are a tab
  apart now; *Open*, the game in its own browser tab, is how to have both.
- Touch schemes and the story editor have never been felt on a real phone.
  `npm run ui` now holds what a machine can judge at 390px — no surface
  scrolls the page sideways, no field is under 16px, and a thumb really does
  slide between neighbouring drawn buttons — so what is left is the part it
  cannot: whether a finger can hit a pixel, and whether the story editor's
  two tall stacked things are usable. Both are TODO lines.
- Networked multiplayer is unbuilt and no longer blocked — the scoreboard
  settled whether the games origin can hold state. See `ideas/next-five.md`.
- **The builder's second chapter** (ideas/planner.md, decided 2026-09-06).
  Built: the sizing rules stand in the builder's preamble behind a short
  trigger, every fire in `Building` is the sizing's transcript plus one turn,
  and a piece runs on the sizing's own block with fresh copies on its turn —
  because ⚠️ a last user message over ~160 tokens cost the next request
  ~6,000 tokens of prefix on V4-Flash, and the sizing ask was 250 (§14). The
  first production receipt should read ~96% where it read 50%. ⚠️ That penalty
  does not exist on V4.1 (§14, 2026-09-13): the shape is kept because it is
  still the cheapest, not because it is forced. Also built: the plan
  as the one reply, piece rows behind the card, a plan of one for any change,
  and a plan of two or more waiting as a **draft** the person can change —
  summary, **assumptions**, pieces — behind one **Build it**, which writes
  `SPEC.md` from the plan's words when the game has none. Unbuilt: the
  synopsis and sub-pieces on overrun (step 6). ⚠️ The card's editing has
  been parsed and server-tested, and `test/ui/plan-card.ui.js` is written
  for it, but no browser has shown it yet.
- Deferred by choice: spec/ §15. Typing previews are permanently out (§2).

## Git policy (overrides global)

You manage git directly in this project. The global "manual git" rule does
NOT apply here. `git push` remains denied at the permission layer; the user
handles pushing.

Workflow:

- Commit after each meaningful change passes its tests. One logical change
  per commit.
- Stage only the files relevant to the change. Use `git add <path>`, never `git add .`.
- **A feature's docs ride its last commit, not each one.** spec/,
  GLOSSARY.md and the TODO line land together in the commit that finishes the
  job — which is what the global "same commit, no exceptions" rule asks for
  anyway. Editing spec/ four times across four commits costs four reads of
  its neighbourhood and buys nothing.
- Conventional commit messages: feat:, fix:, refactor:, docs:, test:, chore:.
  First line under 72 chars. Body if useful, omitted if not.
- Never commit on red. If a test was passing and now isn't, fix the test or
  the code before committing — do not commit broken state.
- Do not include AI attribution in commit messages.
