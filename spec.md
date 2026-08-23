# Game Studio v0 — specification

## 1. Goals

A small private studio where a few trusted people and DeepSeek-backed agents
build browser games together. Each **game project** is a chat thread plus a
versioned working tree of files. Agents see the project's files, can be handed
specific ones as context, and edit them with tools. Every edit is a git commit.
Finished games are publicly playable; everything else requires a login.

Modelled on `new-y` (chat + agents + SSE streaming + injectable collaborators),
with three structural departures: files are a mutable working tree rather than
immutable blobs, human membership is implicit rather than per-conversation, and
the LLM is DeepSeek rather than Anthropic.

## 2. Non-goals (v0)

- Signup, email verification, password reset, invites. Accounts are created
  with a CLI script by the operator.
- Per-user permissions of any kind. Presence in `users` is the only bit: any
  account can read and edit every project, agent, and file.
- Scale. One process, SQLite, synchronous `git` subprocesses.
- Branching or merging. History is linear per project; restore is a new commit.
- Real-time collaborative editing. Last write wins, guarded by an ETag check.
- **Typing previews. Dropped permanently, not deferred** — `new-y` streams
  keystrokes between humans; this app does not, and won't. Agent responses do
  stream (§9).
- Viewer counts, message reactions, web push, unread counts. Deferred (§15).
- Full-text search over messages or files.
- Public read access to chat, files, or the project list (§7).

## 3. Data model

All timestamps are ISO-8601 UTC strings (`new Date().toISOString()`), never
epoch milliseconds. Counter columns reset on UTC date boundaries.

### `users`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `email` | TEXT UNIQUE NOT NULL | login handle |
| `password_hash` | TEXT NOT NULL | scrypt, includes salt + params |
| `display_name` | TEXT NOT NULL | shown in UI and used as the git author name |
| `created_at` | TEXT NOT NULL | |

Presence in this table **is** studio access. There is no role, flag, or
enabled column — to revoke access, delete the row and its sessions.

### `sessions`

| column | type | notes |
|---|---|---|
| `token` | TEXT PK | 32 random bytes, base64url, stored verbatim |
| `user_id` | INTEGER NOT NULL → users | |
| `created_at` | TEXT NOT NULL | |

Sessions do not expire in v0.

### `agents`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT NOT NULL | `@mention` handle; unique among non-deleted |
| `description` | TEXT NOT NULL | system prompt, appended to the studio preamble; ≤ 8 KB |
| `model` | TEXT NOT NULL DEFAULT `'deepseek-v4-flash'` | `deepseek-v4-flash` or `deepseek-v4-pro` (§14) |
| `reasoning` | INTEGER NOT NULL DEFAULT 1 | 0 sends `reasoning_effort: 'none'` |
| `file_tools` | INTEGER NOT NULL DEFAULT 1 | may the agent write files |
| `created_by` | INTEGER NOT NULL → users | display only; confers no ownership |
| `deleted` | INTEGER NOT NULL DEFAULT 0 | soft delete |
| `created_at` | TEXT NOT NULL | |

Agents are **studio-global**, not per-user: any account may create, edit,
delete, or attach any agent. This is the "zero account complexity" rule
applied to agents as well as projects.

`CREATE UNIQUE INDEX idx_agents_name ON agents (name) WHERE deleted = 0` —
unlike `new-y`, names are unique, so an `@mention` resolves to exactly one
agent. Soft delete (rather than hard) because `messages.agent_id` must keep
resolving so old chat history still renders the agent's name.

`file_tools` is a genuine per-agent switch rather than a model capability
gate — both DeepSeek models support function calling (§14). An agent with
`file_tools = 0` is a critic: it reads the project and talks, but cannot edit.

### `projects`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `slug` | TEXT UNIQUE NOT NULL | `[a-z0-9-]{1,40}`; the directory name under `GAMES_DIR` **and** the public URL path |
| `name` | TEXT NOT NULL | ≤ 200 chars |
| `kind` | TEXT NOT NULL DEFAULT 'game' | `game` or `chat` |
| `archived` | INTEGER NOT NULL DEFAULT 0 | |
| `published` | INTEGER NOT NULL DEFAULT 0 | listed in the public catalog at `/` on the games origin |
| `created_by` | INTEGER NOT NULL → users | display only |
| `created_at` | TEXT NOT NULL | |

The slug is immutable in v0 — renaming it would move the directory and break
public game URLs. `name` is freely editable.

`kind = 'chat'` is a project with the game taken out: same thread, same
attached agents, same eligibility and cooldown rules, but **no working tree**.
Nothing is created on disk for it, so every route that reaches the filesystem
refuses it with 409, its slug is not served on the games origin, a message in
it may not carry `context_paths`, and its agents are offered no file tools and
no file block in their context (§8). The column is added by
`addColumnIfMissing`, so an existing database upgrades with every row a game.

There is no `system_prompt` column. Project-level standing instructions live
in `BRIEF.md` at the project root: a plain file in the working tree, so it gets
version history, edits in the same editor as everything else, and can be
updated by an agent as the design evolves. When present it is injected into
every agent's context (§8).

### `project_agents`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER NOT NULL → projects | |
| `agent_id` | INTEGER NOT NULL → agents | |
| `chatty` | INTEGER NOT NULL DEFAULT 0 | responds to every human message, not just mentions |
| `cooldown_until` | TEXT NULL | null = no active cooldown |
| `response_pending` | INTEGER NOT NULL DEFAULT 0 | dirty bit (§8) |
| `attached_by` | INTEGER NOT NULL → users | |
| `attached_at` | TEXT NOT NULL | |

`UNIQUE (project_id, agent_id)`. Hard delete on detach — nothing references
these rows (cooldown state is disposable), so `new-y`'s soft-delete dance
isn't needed here.

### `messages`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER NOT NULL → projects | |
| `user_id` | INTEGER NULL → users | set for human messages; the API adds `user_name` beside it, read at the time it is served rather than stored, so the thread says what somebody is called today. The client has no user list to look one up in — an agent's name it can resolve, a person's it cannot |
| `agent_id` | INTEGER NULL → agents | set for agent messages |
| `kind` | TEXT NULL | NULL = normal message; `'system'` = server-inserted banner |
| `body` | TEXT NOT NULL | utf-8, ≤ 32 KB |
| `tokens` | INTEGER NULL | what the fire that produced this reply cost; NULL for anything a person or the studio wrote |
| `trimmed` | INTEGER NULL | how many earlier messages the history budget kept out of this reply's context; NULL when none were, and on anything but an agent reply |
| `created_at` | TEXT NOT NULL | |

`CHECK (NOT (user_id IS NOT NULL AND agent_id IS NOT NULL))` — never both.
A normal message has exactly one set. A `'system'` banner has `user_id` NULL
and `agent_id` set to the agent it concerns (or NULL for project-level
banners); clients render it centred with no author pill.

`new-y`'s `sender_participant_id` indirection is gone: humans have no
per-project participant row, so messages point straight at `users` / `agents`.

A **reasoning trace** is never stored here. See §8.

Index `idx_messages_project ON messages (project_id, id)`.

### `message_context`

| column | type | notes |
|---|---|---|
| `message_id` | INTEGER NOT NULL → messages | |
| `path` | TEXT NOT NULL | project path pinned by the human |

PK `(message_id, path)`. Records which files a human explicitly pinned on that
turn. Drives the context chips in the UI and the pin rules in §8.

### `message_writes`

| column | type | notes |
|---|---|---|
| `message_id` | INTEGER NOT NULL → messages | the agent turn that did the writing |
| `path` | TEXT NOT NULL | |
| `action` | TEXT NOT NULL | `'create'` \| `'update'` \| `'delete'` |
| `bytes` | INTEGER NOT NULL | size after the write; 0 for delete |
| `commit_sha` | TEXT NOT NULL | the commit this turn produced |

PK `(message_id, path)`. Rendered as file chips beneath an agent's reply, each
linking to that commit's diff for that path. Git holds the same information,
but recording it keeps the chat render a pure DB read.

`messages.tokens` is charged by the same formula as the daily budget (§8) and
is shown under the reply in the UI. It exists because a reply that continued
itself three times costs three times as much and nothing else said so.

`messages.trimmed` shares that line under the bubble — "1,204 tokens · did not
see the first 3 messages". Same principle: the agent is told where its
transcript was cut (§8), and this is how the person is told. Recorded per reply
rather than per project because the trim is a property of the fire, and stating
it retrospectively is the only version that is exactly true.

### `runtime_errors`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER NOT NULL → projects | |
| `commit_sha` | TEXT NOT NULL | the version of the game that produced it |
| `message` | TEXT NOT NULL | ≤ 500 chars, control characters stripped |
| `location` | TEXT NOT NULL | project path and line, e.g. `js/game.js:41`; `console` or empty when there is none |
| `times` | INTEGER NOT NULL DEFAULT 1 | repeats collapse into this rather than new rows |
| `at` | TEXT NOT NULL | last seen |

What the game said while it was running (§8, runtime error feed). At most 20
rows per project, oldest evicted first.

Every row is stamped with the commit the reporting page's bytes came from (§8),
and only rows matching the current HEAD are ever shown. A fix moves HEAD, so
the broken version's problems retire themselves and no commit path has to
remember to clear them. Rows for other commits are deleted the next time
anything is reported for that project.

### `studio_state`

Single row, `id = 1`.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK CHECK (id = 1) | |
| `tokens_used_today` | INTEGER NOT NULL DEFAULT 0 | all agents, all projects |
| `budget_reset_at` | TEXT NOT NULL | advances to next UTC midnight on first use after rollover |

One studio-wide daily budget rather than `new-y`'s per-user accounting —
agents aren't owned by anyone, and the purpose here is narrower: stop a
runaway tool loop from draining the API key.

## 4. Files on disk

Each project owns a directory `<GAMES_DIR>/<slug>/`. The **working tree** on
disk is the source of truth for file content — there is no `files` table. The
listing is a `readdir`, and the same bytes are what the public plays.

### Path validation (⚠️ security boundary)

A **project path** is the API's identifier for a file inside the working tree.
It must satisfy all of:

- Non-empty, ≤ 200 characters, `/`-separated, relative.
- No leading `/`, no backslashes, no C0 control characters or DEL.
- No Unicode format characters anywhere: soft hyphen, zero-width
  spaces and joiners, bidi overrides, BOM. macOS treats several as
  ignorable, so `.gi<ZWSP>t` opens the real `.git` directory, and a bidi
  override makes a filename render as something other than what it is.
- No empty segments (`a//b`), no segment equal to `.` or `..`.
- No segment equal to `.git`, compared case-insensitively — that is the
  repository's own metadata. Note this is equality, not a prefix test:
  `.gitignore` and `.gitattributes` are ordinary files and stay allowed,
  and the format-character ban above is what closes the spoofing route that
  a prefix test would otherwise be needed for.
- No segment with leading or trailing whitespace.
- ≤ 8 path segments.

The validator returns a reason string rather than throwing, so a tool can
hand an LLM its own correction; route handlers use a wrapper that converts
the reason to a 400.

After validation the path is resolved against the project directory and the
result must still be inside it (prefix comparison including a trailing
separator). Both checks run on every read, write, delete, move, and public
serve. Symlinks are never created by the app; a symlink placed by hand is not
followed for serving (`lstat` check).

### Caps

- Per file: 10 MB.
- Per project: 200 MB total, 500 files.
- Injected into an agent's context: see §8.

### Mime for serving

Chosen from the extension, not from any client claim:

`.html .css .js .mjs .json .txt .md .csv .svg .png .jpg .jpeg .gif .webp .ico
.mp3 .ogg .wav .webm .woff .woff2 .ttf`

Any other extension is stored normally but served as
`application/octet-stream` with `Content-Disposition: attachment`.

## 5. Version control

One git repository per project, at the project directory root.

- On create: `git init -q`, then an empty initial commit, so `git log` never
  fails on a fresh project.
- Every mutation commits before the HTTP response returns. There is no
  uncommitted state visible to the API.
- Committer identity is passed per invocation — `git -c user.name=… -c
  user.email=… commit …` — so the app never depends on, or writes to, the
  operator's global git config. Humans commit as their display name and email;
  an agent commits as `<agent name> <slug>@agent.gamestudio.local`.
- Every git subprocess runs with `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_TERMINAL_PROMPT=0` so hooks, templates,
  and credential helpers from the host can't interfere.
- ⚠️ …and with `-c core.quotePath=false`. Git escapes every non-ASCII byte in a
  path it prints, so `café.png` comes back from `log --name-only` as
  `"caf\303\251.png"` — a name that matches nothing in the file listing, which
  is read from the filesystem. A studio used by kids will have those names, and
  the versions list compares the two.
- One commit per agent turn, covering every file that turn wrote — history
  reads as one entry per exchange rather than one per tool call. Human editor
  saves are one commit each.
- Restore never rewrites history: read the old blob, write it to the working
  tree, commit as a new commit.
- **Rollback** is restore one scope up: every file goes back to how it was at
  some commit, anything made since is removed, and the lot lands as one new
  commit. Same rule — history is never rewritten, which is what makes a
  rollback itself undoable by rolling back again. The tree is written with a
  single `git checkout <sha> -- .` rather than a blob read per path; the
  deletions go through `removeFileAt` so they tidy the directories they empty.
  Rolling back to a commit whose tree already matches is a no-op, not an empty
  commit. What it deliberately is *not* is `git revert`: undoing one commit in
  the middle of history can conflict, and a merge conflict has no answer in an
  interface used by kids.

### Serialization

All mutations for a project are serialized through an in-process per-project
promise chain (a `Map<slug, Promise>` mutex). This is what makes concurrent
agents safe: without it, agent A's `git add` could sweep up agent B's
half-written file. Agents still *stream* concurrently — only the write+commit
step is exclusive.

Two agents editing the *same* file in the same turn is a logical lost update:
the second write wins and the first is preserved only in git history. Accepted
in v0.

The database and the git repo are two stores with no transaction between them.
Nothing cross-references, so the failure mode is benign: a crash between write
and commit leaves a file that the next commit picks up. The invariant that
matters (§12) is that no HTTP response reports success before its commit
lands.

## 6. HTTP routes

Two listeners in one process, on two origins (§7).

### Studio origin (`PORT`)

All `/api` routes require a valid `session` cookie and return JSON unless
noted. A request for an unknown project slug gets 404. A write to an archived
project gets 409. A JSON body must be declared `Content-Type:
application/json` (parameters and case ignored) or the request is a 415
before its handler runs — that check is a security boundary, not hygiene (§7).

#### Auth

| method | path | body | effect |
|---|---|---|---|
| POST | `/api/login` | `{email, password}` | set cookie, return user |
| POST | `/api/logout` | — | delete session, clear cookie |
| GET | `/api/me` | — | current user |

There is no signup route. Accounts come from `npm run adduser`.

#### Projects

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/projects` | — | all projects incl. archived, with last-message preview |
| POST | `/api/projects` | `{name, slug?, kind?}` | create row, and for a game its directory and git repo; slug derived from name when omitted; `kind` defaults to `game` |
| GET | `/api/projects/:slug` | — | project, attached agents, recent messages |
| PATCH | `/api/projects/:slug` | `{name}` | rename (display name only) |
| POST | `/api/projects/:slug/archive` | `{archived: bool}` | archive or unarchive |
| POST | `/api/projects/:slug/fork` | `{name, slug?}` | copy the working tree and its history into a new game, carrying the attached agents but not the thread; games only |
| POST | `/api/projects/:slug/publish` | `{published: bool}` | list or unlist the game in the public catalog; games only |

#### Agents

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/agents` | — | all agents |
| POST | `/api/agents` | `{name, description, model?, reasoning?, file_tools?}` | create |
| PATCH | `/api/agents/:id` | any of the above | update |
| DELETE | `/api/agents/:id` | — | soft delete; detaches from all projects |
| POST | `/api/projects/:slug/agents` | `{agent_id, chatty?}` | attach |
| PATCH | `/api/projects/:slug/agents/:agent_id` | `{chatty}` | update |
| DELETE | `/api/projects/:slug/agents/:agent_id` | — | detach |

#### Messages

| method | path | body | effect |
|---|---|---|---|
| POST | `/api/projects/:slug/messages` | `{body, context_paths?: string[]}` | post a human message; fires eligible agents (§8) |
| GET | `/api/projects/:slug/messages` | `?before=<id>&limit=<n>` | page backwards through history |
| POST | `/api/projects/:slug/errors` | `{version, errors: [{message, location}]}` | record what the running game reported (§8); `version` is the commit the reporter was built with and the report is dropped unless it is HEAD; games only, allowed on an archived one |

#### Files

| method | path | notes |
|---|---|---|
| GET | `/api/projects/:slug/files` | recursive listing: `[{path, size, mime, modified_at}]`, sorted |
| GET | `/api/projects/:slug/files/*path` | raw bytes, `ETag: "<sha256>"` |
| PUT | `/api/projects/:slug/files/*path` | raw request body is the content; honours `If-Match`; creates or updates; commits |
| DELETE | `/api/projects/:slug/files/*path` | commits |
| POST | `/api/projects/:slug/files/move` | `{from, to}` — `git mv`, commits |

`PUT` takes a **raw body**, not `multipart/form-data`. That removes the need
to hand-roll multipart parsing and fits a file tree better than an upload
endpoint: the browser reads a dropped `File` and `PUT`s its bytes at the path
it should occupy.

`If-Match` carries the ETag from the last `GET`. On mismatch the server
returns 409 with the current content, so the editor can't silently clobber an
agent's write while you had the file open. Omitting the header forces the
write.

`+ Upload` puts **any** file into the game the same way: the studio reads the
dropped or picked `File` and `PUT`s its bytes, one request and one commit per
file. Client-side only; no route knows an upload from an edit, and no route
knows one kind of file from another — `checkProjectPath` validates the shape of
a path and never its extension, so nothing had to change to accept a `.zip`
beyond the button that used to claim it took pictures and sounds.

What the pane can *show* is the separate question, answered by `MEDIA_KINDS` in
`main.js`: one entry per kind, matched in order, and the only place a new kind
gets added. A file no entry matches is described plainly with a link to save it,
since the server already serves an unknown extension as a download (§4). Three
choices worth naming:

- **`assets/` by default, and the agent preamble says so.** A folder the
  helpers already reference is worth more than a folder nobody agreed on. The
  dialog shows the path each file will take before anything is sent, so where
  the file lands is a decision rather than something to undo — which matters
  more now that an upload is not necessarily art.
- **The filename is tidied, not trusted.** Lowercased, runs of non-alphanumerics
  to one dash, extension kept, and `checkProjectPath` validates the result
  regardless. Two files that tidy to one name are refused rather than one
  quietly overwriting the other.
- **One commit per file.** A dozen sprites make a dozen versions, exactly as a
  dozen agent writes would. Batching them would need a route that takes several
  files, and nothing else in the app wants one.

An asset opens in the pane as the thing itself — `img`, `audio` or `video`
pointed at the studio's own read route — because there is nothing to edit. An
agent never sees its bytes (§8), and `write_file` takes text, so a helper can
point a game at `assets/hero.png` but cannot create or change it.

An asset can also be **made** here rather than added, by two tools that end in
the same `PUT`, at the same tidied path, in one commit each.

`+ Make a sound` opens the **sound maker**: a preset, a row of sliders with a
comment on each, and a `.wav`. The render is arithmetic in
`public/sound-maker.js` rather than Web Audio — a few hundred samples per
millisecond of blip, then the 44 bytes of a PCM header — which buys two things.
The studio plays the encoded bytes, so what is heard is what is saved rather
than a live approximation of it; and the whole thing is checked in `npm test`
without a browser, which no `AudioContext` would allow.

`+ Draw a picture` makes a transparent PNG at the size asked for and opens it
in the **pixel editor**, which is also simply how a PNG opens: up to 1024 a
side, saved at exactly the size it arrived. Pixels are RGBA, as a canvas keeps
them, so opening an uploaded picture loses nothing. The tools are in
`public/pixel-editor.js` and are arithmetic over bytes for the same reason the
sound maker is; the canvas, the pointer and `toBlob` stay in `main.js`. Five
choices worth naming:

- **There is no look-only view of a picture.** There was, behind a link, and it
  showed the picture at exactly the same size as the editor did — a control
  whose only effect was to cost a click. A PNG too big to draw on stays on
  screen as a picture with the reason underneath, which is the one case where
  the two differ.
- **The picture comes out of the file, not out of the studio's memory.** Every
  open re-reads the bytes, so a version brought back from history is what gets
  drawn on.
- **Which tool, how wide and what colour live outside the open file.** A save
  is a commit, a commit is a `files.changed`, and that re-opens the file
  underneath the editor — so anything held per-file is thrown away every time
  someone saves. The picture and its undo stack are per-file; the choices are
  not.
- **The canvas element fills its box and the picture is fitted inside it.**
  Sizing it by width and height instead squashes it: a canvas has an intrinsic
  size, so a definite width with a capped height gives a 16-square sprite drawn
  16 by 7. The pointer maths takes the resulting empty strip back off.
- **The palette is the game's, and it is built rather than chosen from.**
  Thirty-two colours in `PALETTE` in the game's own `config/look.js` — two rows
  of sixteen, greys then rainbow then the ones with character. The chosen square
  is both what the pencil draws with and what the colour box and the eyedropper
  write into, so taking a colour off a picture is how the palette fills up.

  Being a *config file* is the point rather than an implementation detail: a
  colour change is a commit on the game, it appears in Versions, a helper reads
  the same list, and the file opens as a config form of thirty-two colour
  fields. The first draft kept it in `localStorage`, which made a game's colours
  a property of whichever browser had drawn in it.

  A game with no `look.js` is shown the studio's own thirty-two and the first
  change writes the file. A `look.js` that exists but holds no `PALETTE` — a
  game's own drawing colours belong there too — has one appended rather than
  being overwritten. Otherwise each changed colour is a splice of that one
  value, so every comment and every colour nobody touched survive.

  **Colour changes are batched.** They are held in memory and written when the
  picture is saved, when the editor is left for another file, or on `pagehide`
  with `keepalive` for the tab simply closing — because a plain `fetch` is
  cancelled on unload and `sendBeacon` cannot `PUT`. Writing each one as it
  happened turned eyedropping six colours into six commits, which is the
  versioning working against the drawing rather than for it. One Save covers the
  picture, the colours, or both, and the pane says which is waiting.

  The four tools are icons; the words stay on `title` and `aria-label`, so
  nothing is only a picture.

- **A step is the pixels it changed, not a copy of the picture.** One gesture —
  a stroke from pointer down to up, or a fill — records each pixel it touched
  with its colour on both sides. That is a few kilobytes for a stroke at any
  picture size, where a copy would be 4 MB, and it is what makes redo possible
  at all: undo writes the old colours back, redo writes the new ones. The
  recording happens inside `setPixel`, the one function every tool goes through,
  so a tool added later gets undo by existing.

  The alternative was a stack of actions replayed over the base image. It stores
  less, but `floodFill` is O(area) — replaying thirty fills to step back one is
  seconds of work, which is why it would have needed periodic keyframes.
  Diffing costs O(pixels changed) in both directions: measured in a browser, a
  fill of a 670×330 background took 57 ms and undoing it took 8 ms.

  ⚠️ Undo applies its entries **last to first**. A stroke that crosses itself
  writes the same pixel twice, so that pixel has two entries: the first holds
  the colour it really started as, the second holds what the first left behind.
  In record order, undo would stop at the middle colour.

- **Both stacks together are bounded by bytes**, because one case is genuinely
  large: flooding a whole 1024-square picture is twelve bytes a pixel — a 4-byte
  index and 4 bytes of colour each side — so 12 MB. One step is always kept
  however big, since the alternative is a fill that cannot be undone.

A conflict is reported rather than merged. The save carries `If-Match` like the
text editor, but two pictures cannot be offered side by side in a dialog, and
nothing but a person writes a PNG — so a 409 says what happened and changes
nothing.

In **Versions**, a commit that touched a picture shows it as a thumbnail
without being asked, and opening the row shows it whole. The unified diff of a
PNG is the sentence "Binary files differ", which is git talking about itself
rather than about the game; the patch is now rendered only when it has a hunk
in it. `logCommits` carries the paths each commit touched — from `--name-only`
in the same process, because fifty extra git invocations to discover that a
version has no picture in it would cost more than the feature is worth.

A file matching `config/<name>.js` opens as a **config form** — one labelled
field per value, with the value's own comment beside it — instead of as text.
Entirely client-side: `public/config-file.js` reads the `const NAME = value;`
subset (§8) and returns each value with its span in the source, and an edit
splices that span, so comments, alignment and every other byte survive. Three
rules hold it together:

- **Nothing is executed.** No `eval`, no `new Function`. Config files are
  written by LLMs and by kids and are served from the games origin; running one
  in the studio would hand game code the studio's own context (§7).
- **All or nothing.** A file holding anything outside the subset — a function, a
  sum, a template literal — opens as text with a line number, rather than a form
  showing the part it understood and hiding the rest.
- **A value it writes is a value it can read.** A number field validates against
  the same pattern the reader accepts, so the form cannot produce a file it would
  then refuse to open.

Each edit re-reads the file and finds the value by path rather than reusing the
last render's offsets: a splice moves every offset behind it, and re-rendering
the pane per keystroke would replace the Save button under the pointer.

### The studio library

`studio/` is a reserved directory in a game's working tree holding the studio's
own **libraries** — the input module today, a sprite library or an engine later.
It is served like any other file, committed like any other file, and cloned with
the repository. `studio/studio.json` is its **manifest**: library name to the
version this game has.

**Copied, not shared.** The alternatives were considered and rejected on
evidence:

- A **symlink** into a shared directory fails twice. `listTree` uses `lstat` and
  refuses to follow one on purpose — a symlink in a tree served from a public
  origin is a path out of the sandbox — and git stores it as a blob holding the
  target path, so a clone elsewhere gets a dangling link.
- A **submodule** records the version in history, which is the good part, but a
  plain `git clone` without `--recursive` yields empty directories: a broken
  game, for games meant to be copied and published. It would also grow a case in
  every git call the app makes — `listTree`, the write routes, `restoreTree`,
  `fork`, project creation — and needs network at create time.
- A **shared route** on the games origin is one copy always current, and makes a
  game that only runs inside this studio.

So: real bytes, in the tree, in the history. The cost is drift — every game can
sit on its own version — and the manifest is what makes drift visible instead of
silent. `+ Controls` reads `public/studio-lib/index.json`, writes the library's
files under `studio/`, records the version, and adds the `<script>` tags. The
same button says **Update controls** when the game holds an older version, and
**is not there at all** once the game is current: it used to sit with nothing to
do, which reads as a button that does not work.

Two rules make it a library rather than a folder, and both are load-bearing:

- ⚠️ **A helper may read it and may not write it.** `isLibraryPath` in
  `paths.js` — the security boundary — and `write_file`, `patch_file` and
  `delete_file` refuse with a reason it can act on. A helper that could write it
  would fork a shared engine into one game, and the drift would be invisible
  because nothing else reads that copy. A person may write it: that is how it is
  installed, and it is their tree.
- **It is named to an agent, never sent.** `listTree` flags library files, and
  the ambient block lists them under `STUDIO LIBRARY` with a total size instead
  of their contents (§8). An engine an agent cannot edit is also one it does not
  need in front of it, and sending it would eat the budget the game's own code is
  competing for. `read_file` still reaches it. Pinning a library file is
  disabled in the file tree for the same reason.

`config/controls.js` is **not** part of the library: it is the game's own
bindings, seeded once from `public/templates/` and never replaced, because it
holds buttons somebody chose. `seeds` in the index is that distinction.

The module reads its bindings through `try`/`catch` rather than assuming
`CONTROLS` is there, so a game whose `index.html` loads only one of the two
files falls back to a playable default instead of throwing on the first frame.

#### History

| method | path | notes |
|---|---|---|
| GET | `/api/projects/:slug/history` | `?path=&limit=` — commits, newest first: `{sha, short, author, subject, at, paths}` |
| GET | `/api/projects/:slug/history/:sha/*path` | file content at that commit |
| GET | `/api/projects/:slug/diff/:sha` | the whole commit: `{sha, paths, patch}` |
| POST | `/api/projects/:slug/restore` | `{sha, path}` — write the old content, new commit |
| POST | `/api/projects/:slug/rollback` | `{sha}` — the whole tree back to that commit, new commit; returns `{commit, restored, removed}`, with `commit: null` when the tree already matched |

**A version is always sent whole.** `?path=` on the log selects which commits
come back and nothing else: `paths` names every file each one touched, and the
diff route has no filter at all. Narrowing to one file — its part of the patch,
its picture, nothing else — is done by the reader, in `public/patch.js`.

A **rename** is one section under two names — git heads it `a/<old> b/<new>` —
so `patchFor` matches either side, and a move with nothing else in it, which has
no hunk and no picture to show, is rendered as *Renamed to &lt;path&gt;*, or
*Renamed from* when the reader is standing on the destination, rather than as an
empty drawer.

`Rename` sits in the open file's bar and takes the whole path, so it also
moves: `sprite.png` to `art/hero.png` is the same one commit. The dialog says
what the new name will mean before it happens, and ⚠️ crossing into or out of
`studio/` gets its own sentence, because that is the one move that changes who
may edit the file rather than only where it lives. It is allowed either way —
the library is refused to *agents*, not to people (§4) — but not silently.

The reason is that the two halves have to agree. Git's pathspec filters the
*names* along with the commits, so a log scoped to one file used to report
every version of it as a one-file version: a nine-file refactor read from one
of its files looked like it changed nothing else, and there was nothing to
click through to. The fix could have been a second count beside the filtered
list, and was for one commit; sending the whole thing and narrowing in the UI
is the same information with one field, one endpoint and no way for the two to
disagree. The cost is one extra `git log --no-walk` over the page's shas —
never one call per commit — and a filtered drawer fetching a patch bigger than
it shows.

#### Stream

| method | path | notes |
|---|---|---|
| GET | `/api/stream?tab=<id>` | one SSE per tab; `: ping` heartbeat every 25 s |

The stream is also how the client knows it is connected at all: `error` fires on
the drop and on every retry, `open` when the studio is back. A request that
cannot be sent says so too, but only the stream reopening clears it, because the
stream is the one connection held open. While it is down the studio says **Not
connected** at the top of the window and stays usable — nothing typed is thrown
away, and a message refused by a dead connection stays in the composer.

#### Static

`GET /` and `GET /p/:slug` serve `public/index.html` for client-side routing.
Other paths serve from `public/`.

The rest of the view is in the query string, which the server never reads:
`?tab=play|versions` (absent means Files), `?file=<path>` — the open file under
Files, the filter under Versions — and `?version=<sha>` for the changes opened
in the Versions list. The client writes it from its own state on every render
rather than at each click, so no control can forget to, and every view is an
entry of its own: Back walks back through the files, tabs and versions opened
inside a game the way it walks back through games. `replaceState` is used only
while *following* an address the browser already has — the load, Back itself —
where a push would duplicate the entry being arrived at.

Reading it back is the same code path on load and on Back, and it takes away
what the address does not say as well as putting in what it does: Back out of a
file closes it. Within one game the rail moves on its own rather than the
project being refetched, because reopening a project clears the pins, the
reasoning traces and anything mid-stream. A part that no longer exists — a
deleted file, a commit past the end of the list — simply does not open.

### Games origin (`GAMES_PORT`)

| method | path | effect |
|---|---|---|
| GET, HEAD | `/` | the catalog: published games, names escaped |
| GET, HEAD | `/:slug/_studio.html` | the wrapper: the project's `index.html` with the reporter and its commit injected (§8); 404 when there is no `index.html` |
| GET, HEAD | `/:slug/` | `<GAMES_DIR>/<slug>/index.html` |
| GET, HEAD | `/:slug/*path` | that file from the project directory |

No authentication, no cookies read, no `/api` surface, no directory index.
Other methods get 405. Archived projects stay playable. `Cache-Control:
no-store` throughout, so iterating on a game shows fresh bytes on reload
without cache-busting.

Two of those four are not the project's own bytes. Neither reads a cookie and
neither writes anything: the catalog is built from slugs and published flags,
and the wrapper is one file plus one `git rev-parse`. `_studio.html` is
reserved in every project — a working tree containing a file of that name has
it shadowed and never served.

⚠️ The wrapper is the one unauthenticated route that spawns a process. It is
cheap and read-only, but it is a bigger amplification than a file read, and it
sits alongside the "no rate limiting outside login" tradeoff in §11.

## 7. Origins and the game-code security boundary

⚠️ Game code is written by an LLM and served to the public. If it ran on the
studio's origin, its JavaScript could call `/api/*` with the operator's
session cookie and delete every project.

So the studio and the games are served on **separate origins** by two
listeners in the same process. `localhost:8100` and `localhost:8101` are
distinct origins to the browser: `fetch('/api/…')` from a game hits the games
server (which has no such route), each origin gets its own `localStorage` — so
games keep working save state, which a `CSP: sandbox` approach would have cost
— and no studio response is *readable* from a game, because the studio sends
no `Access-Control-Allow-Origin`. There is no CORS configuration here to
loosen, and adding one is what would turn a blind write into a read.

⚠️ What two ports on one hostname do **not** buy is a withheld cookie.
Cookies are not port-scoped (RFC 6265 §8.5), so a session set for `localhost`
is sent to `localhost:8101` as well; and `SameSite` keys on scheme plus
registrable domain while ignoring port, so `:8101` → `:8100` counts as
same-site and `Lax` does not restrain it. Game code therefore cannot read the
studio API, but it can reach it with the operator's session attached. Three
things bound that today: the games listener has no route that reads a cookie,
so a replayed session drives nothing there (tested); `readJson` answers 415 to
any body not declared `application/json` (tested), so a forged `POST` either
carries a CORS-safelisted type like `text/plain` — sent without preflight,
bounced before its handler runs — or declares JSON and needs a preflight the
studio never grants; and every other write method (`PUT`, `PATCH`, `DELETE`)
preflights regardless of its declared type. What a page on another origin can
still drive is `POST /api/logout`, the one `POST` that reads no body — a
forged one costs the operator a sign-in and nothing else. Separate hostnames
in production remove the shared cookie domain that makes even that reachable.

In production the two listeners sit behind separate hostnames
(`studio.example.com`, `games.example.com`), and `GAMES_URL` names the games
one. Left unset — the default — the studio derives the games origin from each
request's own `Host`: same hostname, `GAMES_PORT` in place of `PORT`. So no
hostname is configured anywhere and the studio answers correctly at every name
it can be reached by; reached at `chunk.local:8100`, it plays games at
`chunk.local:8101`. Only the hostname is taken from `Host` — the scheme is
always `http`, the port is always `GAMES_PORT` — and a `Host` that is not a
plausible hostname yields no games origin at all, making `play_url` `null`
rather than a URL built around a guess.

Header posture:

- Studio origin: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, no `X-Powered-By`.
- Games origin: `nosniff` and `Referrer-Policy: no-referrer` only —
  deliberately **not** `X-Frame-Options`, because the studio embeds the game
  in a preview iframe.

No CSRF token in v0: the session cookie is `HttpOnly`, `SameSite=Lax`,
`Secure` when `NODE_ENV=production`. The content-type guard above stands in
for it — a token would close the logout residue and nothing else.

## 8. Agent orchestration

### Eligibility

On each human message, every attached agent is evaluated. Eligible if
`chatty = 1` **or** the body contains an `@mention` matching the agent's name
(case-insensitive). Agent messages never make agents eligible — bot-to-bot
dampening — but agents do see each other's messages as context.

### Dirty bit + cooldown

Unchanged from `new-y` §8, keyed on `project_agents.id`:

1. Set `response_pending = 1`.
2. If this agent is already mid-fire, stop — the in-flight fire re-checks the
   flag when it finishes.
3. Else if `cooldown_until` is null or past, fire now.
4. Else schedule a wake at `cooldown_until`.

Cooldown is 5 s, measured from the *end* of a response. Wake timers live in an
in-process `Map`; a restart loses scheduled wakes (accepted).

### Fire

1. Clear the pending flag, mark the agent as firing.
2. Check the studio budget. If exhausted, post a `'system'` banner and return
   without calling the API.
3. Build context (below).
4. Run the tool loop, streaming `agent.stream.chunk` deltas as they arrive.
5. Persist one `messages` row, one git commit covering every file the turn
   wrote, and one `message_writes` row per path.
6. Add the turn's tokens to `studio_state`.
7. Broadcast `message.new`, `agent.stream.end`, and `files.changed`.
8. Unmark firing, set `cooldown_until = now + 5 s`, re-check the pending flag.

### Context

DeepSeek's context window is 1,048,576 tokens (§14) — three orders of
magnitude more headroom than the original design assumed. So an agent is given
the **whole project** by default rather than only the files a human
remembered to attach. Pinning becomes emphasis, not the sole channel.

The system prompt is, in order:

The system prompt is, in order, **most stable part first** — the ordering is
what prompt caching pays for (below):

1. A fixed studio preamble: what this app is, the project slug, the path rules
   from §4, how each tool behaves, a nudge to prefer `patch_file` over
   rewriting whole files, the project documents and file layout it is expected
   to keep (below), and a note that games run on a separate origin so absolute
   URLs back to the studio will not resolve.
2. `BRIEF.md`'s content, if the file exists, cut to `BRIEF_BYTES` with a note
   saying where it was cut.
3. The agent's `description`.
4. The **file tree**: every path with its size. A path already on disk that §4
   validation refuses is listed and marked `[cannot be opened: …]`: no tool can
   touch it and the games origin will not serve it, so an agent that could not
   see it would have no way to explain why it 404s at runtime.
5. The **files**, each emitted exactly once between
   `--- FILE: <path> (<size>) ---` and `--- END FILE ---` markers. Pinned
   files come first and are labelled with who pinned them. Binary files are
   listed as `[binary: <path>, <size>]` — the agent learns they exist without
   receiving bytes it cannot read.

`BRIEF.md` therefore arrives twice: once as item 2, capped, and once in the
file block as an ordinary file. That is deliberate rather than an oversight —
one filename special-cased out of the file block would be a silent omission of
exactly the kind §8 otherwise refuses to make, and a typical brief is 2 KB
duplicated at a 100% cache hit rate.

The final user message carries, in order:

1. The **runtime errors** for the current commit, one per line, omitted
   entirely when there are none (below).
2. The human's message body.

Errors sit here rather than with the files because they change on every
playthrough: in the system prompt they would invalidate the file block behind
them on every fire.

A **pinned file** is a path in the current turn's `context_paths`, or in
either of the previous two human turns'. Pinning is **priority, not
exemption**: pinned files are offered to the byte cap first, then the rest,
each group smallest-first, so the largest files are the ones dropped and the
whole block is bounded by `AMBIENT_BYTES`. Content is always read fresh from
disk at fire time, never from the message the human sent. Dropped files are
named in the prompt with a note to call `read_file`.

Earlier chat turns map to OpenAI roles: this agent's own messages become
`assistant`, everyone else's become `user` prefixed with `[Name] `. History is
trimmed oldest-first to fit its budget, and the seam is marked twice — a
`[studio]` turn at the front of the transcript saying how many messages are not
shown, and `messages.trimmed` on the reply, which the UI renders under the
bubble (§3). Silence there was the one drop in the whole context that nobody was
told about, agent or human: a dropped file is named, a trimmed conversation just
began later than it had before. Past turns'
tool calls are not replayed — only the persisted reply text — so history stays
compact and no stale `tool_call_id` can dangle.

Budgets, in one constants block so they are easy to retune:

| constant | value | ≈ tokens | governs |
|---|---|---|---|
| `AMBIENT_BYTES` | 400 KB | ~115 K | the whole file block, pinned included |
| `HISTORY_BYTES` | 200 KB | ~57 K | replayed chat turns |
| `BRIEF_BYTES` | 32 KB | ~9 K | `BRIEF.md` in the system prompt |
| `LOOP_GROWTH_BYTES` | 512 KB | ~146 K | what the tool loop may add per fire |
| total request | ~1.2 MB | ~350 K | worst case, everything binding at once |

Every one of these is measured in **bytes, not tokens**, and they are
independent and additive: nothing counts tokens or checks the sum against the
1 M-token ceiling. The table is the proof that the sum cannot reach it. The
caps that matter are the last two — before them, `BRIEF.md` and the tool loop
were the two places one fire could grow without limit.

Prompt caching is why the file block is in the system prompt and not on the
last user message, where it used to be. Measured against the live API with a
62 KB project (`tmp/probe-cache.mjs`), on 24.5 K-token prompts:

| case | cache hit |
|---|---|
| turn 2 of one fire, file block on the last user message | 99% |
| the next fire, file block on the last user message | **0%** |
| the next fire, file block in the system prompt, no file changed | **100%** |
| the next fire, file block in the system prompt, one file changed | 0% |

On the last user message the block sat behind the whole transcript, so the
history arriving in front of it moved it and every fire was charged as a full
miss — 0%, not even the preamble, because the surviving prefix was too short to
register. In the system prompt the prefix a second fire matches on includes the
files. A file changing is a total miss in either position, so this one is never
worse. The 62 KB measured is well under `AMBIENT_BYTES`; a 400 KB system prompt
has not been tried.

### Project documents

The preamble asks an agent with file tools for a shape rather than leaving it
to guess one, because left to guess it writes a single enormous
`index.html` — the games built here before the preamble asked were exactly
that, one of them 62 KB in one file, which is also the file most likely to be cut off
half-written (§14). So it asks for `index.html` holding markup only, `css/`,
and one file per part of the game under `js/`, a few hundred lines each.

`config/` is the part a person tunes without reading code: `play.js` for
movement and timings, `world.js` for level or board data, `look.js` for colours
and sizes, `words.js` for every string the player sees, `controls.js` for which
button does what (§6, Files). The preamble asks for
plain `const NAME = value;` declarations — numbers, strings, booleans, and
lists or groups of those, with a comment on each value — because the studio
opens these files as a **config form** rather than as text (§6, Files).

Agents change config files whenever the game needs it; the earlier idea that
they should never rewrite one was wrong, since adding a level or a line of
dialogue *is* the job. Two narrower rules replace it: keep the comment when you
change a value, because that comment is what makes the file readable by a
ten-year-old; and prefer `patch_file` for a single value. A human editing at the
same time is not a prompt problem at all — it is the `If-Match` conflict already
in the file routes (§6), which the form uses like the text editor does.

The preamble also names **every studio affordance an agent cannot reach on its
own**, by the words on the button. An agent that does not know a person can draw
a sprite in one click writes the game without one, and an agent that does not
know `js/input.js` exists writes its own `keydown` handler beside it — so the
capability may as well not exist. That makes the preamble the place these are
kept in step, and `test/orchestrator.test.js` asserts each one is present:

| what an agent cannot do | what it is told to say |
|---|---|
| make or change a picture or a sound | ask for the path by name, and name the button: `+ Draw a picture`, `+ Make a sound`, `+ Upload` |
| add the *input module* | `+ Controls`, and meanwhile call `Input.held` rather than reading keys |

One exception is worth stating, because it is easy to get wrong in both
directions: `.svg` is in the text extensions, so `write_file` and `patch_file`
do work on it and an agent *can* make that one kind of picture. The preamble
says so, and says a sprite is still a person's job.

Three **project documents** live at the root, next to the code. They are notes
for the people and agents working on the game and never part of the game
itself:

| file | what it holds | when it is written |
|---|---|---|
| `BRIEF.md` | the file map: what each file is for, how the pieces fit | whenever a file is added, moved, or repurposed |
| `SPEC.md` | what the game is and how it works: rules, controls, screens, settled decisions | when a decision changes |
| `TODO.md` | one task per line | only when the list is long enough to be worth staging |

`BRIEF.md` is the only one injected into the system prompt (above), which is
why it is capped and why the preamble asks for it to stay short. `SPEC.md` and
`TODO.md` ride in the ambient file block like any other file — small, so
smallest-first selection always includes them, and pinnable when a human wants
to point at one.

Nothing scaffolds these files. An agent writes them when the project is worth
them, which is also the answer to whether a new project should be created with
a `BRIEF.md`: no.

### Reasoning traces

Both models emit `reasoning_content` — a **reasoning trace** — alongside the
reply when `reasoning = 1`. It streams as its own `agent.stream.reasoning`
event and renders in a dimmed collapsible block.

It is **never persisted** to `messages.body` and **never sent back** in a
later request's history. Both rules matter: it would bloat the database and
DeepSeek's own guidance is not to feed traces back as context. What survives a
turn is the reply text and the file writes.

### Runtime error feed

An agent cannot be shown its game. DeepSeek rejects every image content shape
(§14), so this is not a matter of producing a screenshot — it could not be
sent. Everything an agent learns about the running game therefore arrives as
text, and this is the channel.

The **reporter** is a small script that runs inside the game. It is not a file
in the working tree and not a tag in the game's markup: the games listener
serves the project's own `index.html` with the reporter injected at a reserved
path, `/<slug>/_studio.html` (§6), and the studio's preview iframe points
there. The **wrapper** is that document. Nothing else uses it — the public
plays `/<slug>/`, whose bytes are exactly what is on disk.

The studio cannot inject the script from the browser: `contentDocument` is null
across origins, and anything that let the studio reach into the frame would let
the frame reach back into the studio (§7). Server-side injection is the only
place this can happen, which turns out to be the better place anyway — no game
is edited, none can lose it, no agent has to know it exists, and every game
that predates the feature reports without being touched.

Inside the game the reporter catches uncaught errors, failed resource loads
(capture phase — a `<script>` that 404s never reaches `window` otherwise) and
`console.error`, and posts each distinct one to `window.parent`. It reports
only when framed, never throws, and sends each distinct problem once per page
load, capped at 20 — a game that throws inside its animation loop would
otherwise report sixty times a second.

Each report carries the **commit the wrapper was built from**. That is what
files a problem against the code that actually caused it rather than against
whatever HEAD happens to be when the report lands, and it is why a fixed error
cannot come back as a current one: `POST /errors` drops any report whose
version is not HEAD, because the preview is already reloading and anything
still broken will say so again. The wrapper reads HEAD *before* reading
`index.html`, so a commit landing in between makes the version older than the
bytes — losing a report, which is safe, rather than mislabelling one, which is
not.

The studio page checks the sender's origin against the games origin and the
message's slug against the open project, batches for 500 ms, and posts. The
list is broadcast as `game.errors` and painted into the Play tab **without a
re-render**: rebuilding the tree rebuilds the preview iframe, which restarts the
game, which reports its problems again — a loop that does not settle. This is
the same reason a streaming reply mutates its nodes.

Two things the wrapper does not cover. A game that navigates its frame to a
second page leaves the wrapper behind and stops reporting until it returns. And
what the studio previews differs from what the public plays by exactly one
injected script — close enough for every practical purpose, not identical.

⚠️ Everything in this feed is text from LLM-written game code, arriving over
`postMessage` from a public origin. It is capped, stripped of control
characters, and only ever rendered as text — but it does reach an agent's
context, so a game can put words in front of its own helpers. It could already
do that by writing a file, so this adds reach, not a new capability.

### Tools

Offered whenever `file_tools = 1`. No model gating is needed — both DeepSeek
models support function calling, including parallel calls in a single turn
(§14), so an agent can write several files at once and cut loop iterations.

| tool | args | behaviour |
|---|---|---|
| `write_file` | `path, content` | create or overwrite, whole file |
| `patch_file` | `path, old_text, new_text` | exact replace; errors unless `old_text` occurs exactly once |
| `read_file` | `path` | a file the byte cap dropped, or one at an older commit |
| `delete_file` | `path` | remove; recoverable from git |

Every tool validates its path per §4 and returns an error string to the model
on violation rather than throwing — a confused agent gets a correction, not a
dead turn.

Bounded loop: at most 24 assistant turns, 40 tool calls, and
`LOOP_GROWTH_BYTES` of appended messages per fire. On hitting any of the three
the turn ends with a `'system'` banner noting it stopped early.
Both numbers are runaway guards, not a work allowance — the daily token budget
is what caps cost. The original 8/12 proved too tight in use: the "stopped
after 8 turns without finishing" banner became routine. DeepSeek usually emits
one or two calls per turn, so turns bind first and 12 tool calls were rarely
reached, while a whole small game — an `index.html`, a stylesheet, four or
five scripts, and a read or two before patching — needs more than eight. The
preamble states both numbers to the model so it can batch its calls and wrap
up rather than being cut off mid-file.

The byte guard is the one that bounds the request itself. Everything else in
the context is capped once per fire; the loop is the part that grows as it runs
— 40 reads at 128 KB each, plus every file it writes echoed back in the
assistant turn that wrote it, which is the only route by which a single fire
could have walked the model's window. On hitting it the loop stops rather than
dropping earlier messages: a dropped message orphans a `tool_call_id`, and the
recovery is a continuation, which rebuilds its context from disk and so starts
light again.

Running out of turns is not the end of the reply. The agent may **continue**
itself up to 3 times, counted from the last human message and reset by the
next one, so a half-built game finishes without a human typing "keep going".
A continuation is armed by posting the `'system'` banner and setting
`response_pending` again: a `'system'` row enters the transcript as a user
turn (§8, Context), which is exactly what gives the next fire something to
answer — without one, the agent's own reply would be the newest turn and the
fire would no-op. The daily token budget is rechecked before each one.

`max_tokens` is set to the full 65536 ceiling per request, not to a lower cost
guard. **`completion_tokens` counts the reasoning trace as well as the reply
and the tool call arguments**, so a cap set below the ceiling mostly rations
thinking and leaves the files whatever is left over. Measured on "make me a
tank game" against `deepseek-v4-flash`: at 32768, 25,004 tokens went to
reasoning, the fifth `write_file` was cut off mid-arguments, and the game
would have been committed with a missing script. The same prompt at 65536
spent 38,590 on reasoning and finished all eight files with
`finish_reason: 'tool_calls'`. The earlier claim here — that 32 K carries
roughly 130 KB of markup, so truncation is not a practical concern — assumed
the whole allowance was available to file content, and was wrong.

Truncation is still detected, and now recovered from rather than only
reported. A tool call cut off mid-arguments wrote **nothing** — the JSON never
parsed, so there was no path and no content — but the model's own reply says
it wrote the file. So the orchestrator feeds it a studio note saying the call
was cut and nothing was saved, and the loop continues so it can write the file
again in smaller pieces. Only a cut still outstanding when the loop ends
produces the `'system'` banner; one that a later turn rewrote successfully is
not a missing file and is not reported. Non-streaming truncation drops the
tool call entirely; the streaming path can deliver partial argument fragments,
so both cases are handled.

### Budget

`studio_state.tokens_used_today` accumulates

```
prompt_cache_miss_tokens
  + ceil(prompt_cache_hit_tokens / 10)
  + completion_tokens
```

Cached prompt tokens are counted at a tenth to mirror DeepSeek's cache
pricing. Note that `prompt_tokens` already includes the cached ones, so
summing it with the hit count would double-charge — the miss/hit split is the
correct input (§14).

`completion_tokens` includes `completion_tokens_details.reasoning_tokens`; the
trace is discarded but it was still billed, so it is still counted.

If `budget_reset_at` has passed, the counter resets to 0 and the timestamp
advances to the next UTC midnight. Over budget: a `'system'` banner per failed
check, no API call.

## 9. SSE events

One stream per tab at `/api/stream`. Because every studio account can see
every project, **every event goes to every connected tab** and the client
filters on `project_slug`. This deletes `new-y`'s membership lookup in the
broker entirely.

| event | payload |
|---|---|
| `project.new` | `{slug, name}` |
| `project.updated` | `{slug, name, archived}` |
| `message.new` | full message: `{id, project_slug, user_id, user_name, agent_id, kind, body, created_at, tokens, trimmed, context_paths, writes}` |
| `agent.stream.start` | `{project_slug, agent_id}` |
| `agent.stream.reasoning` | `{project_slug, agent_id, delta}` — reasoning trace, rendered dimmed and collapsible, never persisted |
| `agent.stream.chunk` | `{project_slug, agent_id, delta}` — reply text |
| `agent.tool` | `{project_slug, agent_id, tool, path}` — drives a live "writing game.js…" indicator |
| `agent.stream.end` | `{project_slug, agent_id, message_id?, error?}` |
| `files.changed` | `{project_slug, paths: string[]}` — client refreshes the tree and reloads the preview iframe |
| `game.errors` | `{project_slug, errors: [{id, message, location, times, at}]}` — the whole current list, not a delta |

`files.changed` is what makes the studio feel live: an agent writes a file and
the game in your preview pane reloads.

## 10. Limits

- Message body: 32 KB (utf-8 bytes).
- JSON request body: 64 KB. Raw file `PUT` body: 10 MB.
- Email: 254 chars. Display name: 100. Project name: 200. Slug: 40.
- Agent name: 100. Agent description: 8 KB.
- Project path: 200 chars, 8 segments.
- Files per project: 500. Bytes per project: 200 MB.
- Agents attached per project: 10.
- Runtime errors: 20 per project, 20 per report, 500 chars of message and 200
  of location each; 20 distinct problems per page load in the reporter itself.
- Agent cooldown: 5 s per `(project, agent)`.
- Agent fire: ≤ 24 assistant turns, ≤ 40 tool calls, ≤ 512 KB of messages
  appended by the tool loop, ≤ 3 continuations per human message (§8).
- Context sent per fire: ~700 KB of text before the tool loop and ~1.2 MB with
  it, all of it bounded (§8), against a 1,048,576-token model ceiling.
- Brief injected into the system prompt: 32 KB, cut with a note (§8).
- Output per request: `max_tokens = 65536`, which is the model ceiling — a
  lower cap rations the reasoning trace, not the files (§8, §14).
- Studio token budget: `DAILY_TOKEN_BUDGET`, default 5,000,000 per UTC day.
- Login lockout: per email 10 failures / 5 min → 5 min lock; per IP 20
  failures / 5 min → 10 min lock. In-memory, resets on restart.

## 11. Auth details

- Passwords: `scrypt` (`node:crypto`), 16-byte salt, N=16384, r=8, p=1,
  64-byte key, stored as `scrypt$<N>$<r>$<p>$<salt_b64>$<key_b64>`.
- Sessions: 32 random bytes base64url in a `session` cookie — `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Secure` iff `NODE_ENV=production`, no `Max-Age`.
- Constant-time login: an unknown email is still verified against a cached
  dummy hash so timing doesn't disclose existence.
- Account creation: `npm run adduser -- <email> "<Display Name>"` prompts for
  a password on stdin with echo off. `npm run deluser -- <email>` removes the
  user and their sessions.

### Accepted security tradeoffs (v0)

- **No CSRF token.** `SameSite=Lax` plus the `readJson` content-type guard
  (§7), which bounds a cross-site forgery to `POST /api/logout`.
- **Lockout state is in-memory.** A restart clears all lockouts.
- **Sessions never expire.** No `Max-Age`, no rotation: a session lasts until
  `deluser` removes its row or the browser loses the cookie. Expiry and
  rotation are deferred to v1 (§15) and belong to the same gate as the rest
  of this list.
- **No rate limiting outside login.** An authenticated user can flood message
  posts and file writes; bounded only by the token budget and size caps. The
  trust boundary here is the account list, which the operator controls by hand.
- **`.svg` is served to the public.** On the games origin that's harmless —
  scripts inside it can't reach the studio origin or its cookie.
- **Binary files are trusted by extension.** No magic-number validation;
  `nosniff` plus the extension-derived Content-Type covers the obvious cases.
- **Agents can delete files.** `delete_file` is offered because git makes it
  recoverable. A misbehaving prompt can still empty a working tree, and
  recovery is a manual `restore` per path.
- **The whole working tree goes to DeepSeek on every fire.** Ambient context
  (§8) means anything committed to a project — including a stray file with
  something private in it — is sent to a third-party API. The mitigation is
  scope, not code: projects hold game source, nothing else.

## 12. Invariants

Tests enforce each of these.

- Every path accepted by the API resolves inside its project directory, and no
  path with a `.git`-prefixed segment is ever read, written, or served. ⚠️
- The games listener never reads a cookie, never writes, and serves nothing
  but a project's own files, the catalog, and the wrapper — and the wrapper is
  that project's own `index.html` with a script in front of it. ⚠️
- No HTTP response reports a successful file mutation before its git commit
  has landed.
- At most one write+commit runs at a time per project.
- A `messages` row never has both `user_id` and `agent_id` set.
- No reasoning trace is ever written to `messages.body` or replayed into a
  later request.
- An agent message never makes an agent eligible to respond.
- An agent whose `cooldown_until` is in the future cannot post a message.
- `studio_state.tokens_used_today` is monotone non-decreasing within a UTC day,
  and `budget_reset_at` is always strictly in the future of the value used to
  compute it.
- An archived project rejects every write with 409, while its game stays
  publicly served.
- A project's git repository has at least one commit from the moment the
  project exists.
- A chat has nothing on disk: no directory is created for it, every route that
  would reach one answers 409, and the games origin answers 404 for its slug
  even if a directory with that name exists.

## 13. Configuration

| variable | default | notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | required; the server fails fast at boot without it |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | the host also answers without the `/v1` prefix |
| `PORT` | `8100` | studio listener; 8090 is left free for `new-y`, which both defaults to and is expected to run alongside this |
| `GAMES_PORT` | `8101` | games listener |
| `GAMES_URL` | unset | overrides play/preview links; unset derives them from each request's `Host` on `GAMES_PORT` |
| `DB_PATH` | `gamestudio.db` | |
| `GAMES_DIR` | `games` | |
| `DAILY_TOKEN_BUDGET` | `5000000` | |
| `TRUST_PROXY` | unset | set to `1` behind a reverse proxy so the per-IP login limiter sees real client addresses |

`node:sqlite` is experimental in Node 25, so the start script passes
`--disable-warning=ExperimentalWarning`.

## 14. DeepSeek API — verified behaviour

Measured against the live API on 2026-08-12, not assumed. Every finding below
replaced a guess, and three of the original five guesses were wrong.

### Models

`GET /v1/models` returns exactly two: **`deepseek-v4-flash`** and
**`deepseek-v4-pro`**. A bad model id is rejected with a message naming those
two, so they are the canonical set.

The familiar `deepseek-chat` and `deepseek-reasoner` names still resolve, but
they are undocumented compatibility aliases, both served by
`deepseek-v4-flash`. They differ only in reasoning: `deepseek-chat` returns no
trace, `deepseek-reasoner` does. This app uses the canonical ids and controls
reasoning explicitly instead.

### Reasoning

Reasoning is **on by default** on both canonical models.
`reasoning_effort: 'none'` turns it off; `thinking: {type: 'disabled'}` also
works. Unrecognised parameters are silently ignored rather than rejected
(`enable_thinking: false` had no effect), so parameter support cannot be
probed by looking for an error.

The intermediate effort levels did not behave monotonically on a trivial
prompt — `'minimal'` and `'low'` both produced *more* trace than the default.
So this app exposes reasoning as a per-agent boolean, not an effort ladder:
omit the parameter for on, send `'none'` for off.

In streaming, `delta.reasoning_content` arrives interleaved and ahead of
`delta.content`. `completion_tokens_details.reasoning_tokens` reports the cost.

### Tools

**Both** models support function calling — the original guess that
`deepseek-reasoner` could not was wrong, which removes the per-model
capability gate the earlier draft specified. Parallel tool calls in one
assistant turn work: a two-file request produced two `write_file` calls.

Streaming tool calls arrive as `delta.tool_calls[]` fragments keyed by
`index`, with `id` and `function.name` on the first fragment and
`function.arguments` accumulating across the rest. Reassembling by index and
parsing at the end works. The `role: 'tool'` + `tool_call_id` result round trip
works, and an assistant message with `content: null` alongside `tool_calls` is
accepted.

Truncation mid-tool-call is cleaner than Anthropic's: the non-streaming
response omits `tool_calls` entirely rather than returning partial JSON. The
streaming path still needs the unparseable-buffer guard, because fragments are
delivered before the cut.

### Limits

- **Context: 1,048,576 tokens.** A 160 K-token prompt was accepted without
  complaint; overshooting produced `This model's maximum context length is
  1048576 tokens`. The earlier 64 K assumption was wrong by 16×, and §8's
  context strategy was rewritten because of it.
- **Output: 65,536 tokens**, and that is also the default when `max_tokens` is
  omitted — a request with no `max_tokens` ran to exactly 65536 and stopped
  with `finish_reason: 'length'`. Oversized `max_tokens` values are clamped
  silently rather than rejected, so the parameter cannot be used to discover
  the ceiling.
- **`max_tokens` bounds the reasoning trace and the reply together**, because
  `completion_tokens` includes `completion_tokens_details.reasoning_tokens`.
  Measured on "make me a tank game" (`deepseek-v4-flash`, reasoning on):
  25,004 of 32,768 tokens went to reasoning, leaving ~7.7 K for tool call
  arguments — the fifth `write_file` was cut off mid-arguments. The same
  prompt at 65,536 spent 38,590 on reasoning and emitted all eight
  `write_file` calls intact, the largest carrying 17,710 characters of
  content. Reasoning cost scales with the prompt's ambition, so it cannot be
  budgeted around; the ceiling is the only safe setting. This is why §8 sets
  `max_tokens` to 65536 rather than to a lower cost guard.
- `finish_reason: 'length'` fires reliably on truncation.

### Images

**Not supported.** Both content-part shapes are rejected before the model is
reached: `{type: 'image_url', image_url: {url}}` returns 400 `unknown variant
'image_url', expected 'text'`, and the Anthropic-style `{type: 'image',
source: {...}}` returns 400 `unknown variant 'image'`. The deserializer
accepts only `text`, so this is not a model capability gate that a different
model id would lift.

The consequence is architectural: an agent cannot be shown what its game looks
like. Screenshots are not merely awkward to produce without a headless browser
— they could not be sent even if we had them. Anything an agent learns about
its running game has to arrive as text, which is what the runtime error feed
is for (§8).

### Usage and caching

```json
{ "prompt_tokens": 4018, "completion_tokens": 1, "total_tokens": 4019,
  "prompt_tokens_details": { "cached_tokens": 3968 },
  "completion_tokens_details": { "reasoning_tokens": 16 },
  "prompt_cache_hit_tokens": 3968, "prompt_cache_miss_tokens": 50 }
```

Caching is automatic on a repeated prefix — a second identical 4018-token
prompt reported 3968 cached. `prompt_tokens` is the **total**, hits plus
misses, which is why §8's budget formula uses the split rather than
`prompt_tokens`.

### Errors

`{"error": {"message", "type", "param", "code"}}`, with 400 for an invalid
model and 401 for a bad key. Straightforward to surface.

### Dev-environment note

This sandbox reaches the network only through a CONNECT proxy at
`localhost:63983`; DNS does not resolve directly. `curl` picks the proxy up
from `$https_proxy` automatically, but Node's `fetch` ignores those variables
unless started with **`node --use-env-proxy`**. That flag is a local
development detail only — the deployed server talks to DeepSeek directly, and
the test suite never touches the network.

## 15. Deferred to v1

- Counting tokens rather than bytes. The byte caps bound the request, but a
  request's real cost is only visible after the fact, in `usage`.
- Viewer counts, message reactions, web push, unread markers (all exist in
  `new-y`). Typing previews are **not** here — they are permanently out (§2).
- Public read-only chat. (A public game index is no longer deferred: `/` on
  the games origin is the catalog, listing games whose `published` flag is
  set. Publishing changes findability, not access — every game has always
  been playable by link, §7.)
- Editing or deleting messages.
- Full-text search over messages and files.
- Slug rename with a redirect from the old public URL.
- Session expiry and rotation; CSRF tokens; persistent lockout state.
- Per-file locking so two agents can't lose an update on the same file.
- Before-and-after for a changed picture. A version's pictures now show as
  thumbnails and open whole (§6), but each is the picture *at that commit*, not
  a comparison with the one before it.
- A dependency-free in-browser code editor with syntax highlighting; v0 ships a
  plain `<textarea>`.
- Asset pipeline: sprite sheets, audio conversion, minification.
- Cross-project agent memory.
- `git push` to a remote so a game can be published elsewhere.
- Per-agent `reasoning_effort` beyond on/off, if the levels ever behave
  monotonically.

## 16. Shape of the implementation

Zero runtime dependencies: `node:http`, `node:sqlite`, `node:crypto`,
`node:child_process` for git. No build step, no framework, no `npm install`.

```
server/
  index.js        boot: env, db, two listeners
  app.js          createApp({db, broker, llm, gamesDir, ...}) -> handler
  games.js        createGamesApp({db, gamesDir}) -> handler
  db.js           MIGRATIONS array + addColumnIfMissing + tx()
  auth.js         scrypt, sessions, requireAuth
  broker.js       SSE fan-out to every tab
  budget.js       studio-wide daily counter
  http/
    router.js     method + :param/*wildcard matching
    body.js       JSON and raw body readers with caps
    static.js     extension mime table, traversal-safe serve
  reporter.js     the injected script, and the wrapper it goes into (§8)
  runtime.js      what the running game reported, per project
  files/
    paths.js      project-path validation (§4)
    tree.js       recursive listing, caps
    git.js        per-project repo: init, commit, log, show, diff, mv
    mutex.js      per-project serialization
  llm/
    deepseek.js   SSE -> {delta|reasoning|tool_use|end} iterator
    tools.js      the four file tools
  agents/
    orchestrator.js  dirty bit, cooldown, tool loop, context builder
    mentions.js
  routes/         auth, projects, agents, messages, errors, files, history, stream
public/
  index.html      shell
  main.js         the SPA's core: state, transport, URL, stream, the file,
                  drawing and history actions, and render()
  dom.js          h(), and the icon buttons
  sidebar.js  chat.js  versions.js  config-form.js  dialogs.js  upload.js
                  one pane or feature each, importing the core from main.js
  config-file.js  patch.js  pixel-editor.js  sound-maker.js
                  pure logic, shared with npm test
  style.css
bin/
  adduser.js  deluser.js  backup.js
test/
```

Signup, email, push, reactions, typing, unread counts, and per-user
permissions (all present in `new-y`) are absent on purpose.

Tests use `node:test` against `:memory:` SQLite, a temp `GAMES_DIR`, and a
scripted fake LLM client, so the suite needs no network and no API key. The
one place a live key is required is a manual smoke script, kept out of
`npm test`.
