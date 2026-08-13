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
| `archived` | INTEGER NOT NULL DEFAULT 0 | |
| `created_by` | INTEGER NOT NULL → users | display only |
| `created_at` | TEXT NOT NULL | |

The slug is immutable in v0 — renaming it would move the directory and break
public game URLs. `name` is freely editable.

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
| `user_id` | INTEGER NULL → users | set for human messages |
| `agent_id` | INTEGER NULL → agents | set for agent messages |
| `kind` | TEXT NULL | NULL = normal message; `'system'` = server-inserted banner |
| `body` | TEXT NOT NULL | utf-8, ≤ 32 KB |
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
- One commit per agent turn, covering every file that turn wrote — history
  reads as one entry per exchange rather than one per tool call. Human editor
  saves are one commit each.
- Restore never rewrites history: read the old blob, write it to the working
  tree, commit as a new commit.

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
project gets 409.

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
| POST | `/api/projects` | `{name, slug?}` | create row, directory, and git repo; slug derived from name when omitted |
| GET | `/api/projects/:slug` | — | project, attached agents, recent messages |
| PATCH | `/api/projects/:slug` | `{name}` | rename (display name only) |
| POST | `/api/projects/:slug/archive` | `{archived: bool}` | archive or unarchive |

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

#### History

| method | path | notes |
|---|---|---|
| GET | `/api/projects/:slug/history` | `?path=&limit=` — commits, newest first: `{sha, short, author, subject, at, paths?}` |
| GET | `/api/projects/:slug/history/:sha/*path` | file content at that commit |
| GET | `/api/projects/:slug/diff/:sha` | `?path=` — unified diff text |
| POST | `/api/projects/:slug/restore` | `{sha, path}` — write the old content, new commit |

#### Stream

| method | path | notes |
|---|---|---|
| GET | `/api/stream?tab=<id>` | one SSE per tab; `: ping` heartbeat every 25 s |

#### Static

`GET /` and `GET /p/:slug` serve `public/index.html` for client-side routing.
Other paths serve from `public/`.

### Games origin (`GAMES_PORT`)

| method | path | effect |
|---|---|---|
| GET, HEAD | `/:slug/` | `<GAMES_DIR>/<slug>/index.html` |
| GET, HEAD | `/:slug/*path` | that file from the project directory |

No authentication, no cookies read, no `/api` surface, no directory index, no
project list. Other methods get 405; `/` gets 404. Archived projects stay
playable. `Cache-Control: no-store` throughout, so iterating on a game shows
fresh bytes on reload without cache-busting.

## 7. Origins and the game-code security boundary

⚠️ Game code is written by an LLM and served to the public. If it ran on the
studio's origin, its JavaScript could call `/api/*` with the operator's
session cookie and delete every project.

So the studio and the games are served on **separate origins** by two
listeners in the same process. `localhost:8100` and `localhost:8101` are
distinct origins to the browser: the session cookie does not travel to the
games listener, `fetch('/api/…')` from a game hits the games server (which has
no such route), and each origin gets its own `localStorage` — so games keep
working save state, which a `CSP: sandbox` approach would have cost.

In production the two listeners sit behind separate hostnames
(`studio.example.com`, `games.example.com`). `GAMES_URL` tells the studio how
to build play and preview links.

Header posture:

- Studio origin: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, no `X-Powered-By`.
- Games origin: `nosniff` and `Referrer-Policy: no-referrer` only —
  deliberately **not** `X-Frame-Options`, because the studio embeds the game
  in a preview iframe.

No CSRF token in v0: the session cookie is `HttpOnly`, `SameSite=Lax`,
`Secure` when `NODE_ENV=production`. Same accepted tradeoff as `new-y`.

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

1. A fixed studio preamble: what this app is, the project slug, the path rules
   from §4, how each tool behaves, a nudge to prefer `patch_file` over
   rewriting whole files, and a note that games run on a separate origin so
   absolute URLs back to the studio will not resolve.
2. `BRIEF.md`'s content, if the file exists.
3. The agent's `description`.

The final user message carries, in order:

1. The **file tree**: every path with its size.
2. The **files**, each emitted exactly once between
   `--- FILE: <path> (<size>) ---` and `--- END FILE ---` markers. Pinned
   files come first and are labelled with who pinned them. Binary files are
   listed as `[binary: <path>, <size>]` — the agent learns they exist without
   receiving bytes it cannot read.
3. The human's message body.

A **pinned file** is a path in the current turn's `context_paths`, or in
either of the previous two human turns'. Pinned files are never dropped by the
byte cap; unpinned ones are dropped largest-first when the cap binds. Content
is always read fresh from disk at fire time, never from the message the human
sent.

Earlier chat turns map to OpenAI roles: this agent's own messages become
`assistant`, everyone else's become `user` prefixed with `[Name] `. History is
trimmed oldest-first to fit its budget. Past turns' tool calls are not
replayed — only the persisted reply text — so history stays compact and no
stale `tool_call_id` can dangle.

Budgets, in one constants block so they are easy to retune:

| constant | value | ≈ tokens |
|---|---|---|
| `AMBIENT_BYTES` | 400 KB | ~115 K |
| `HISTORY_BYTES` | 200 KB | ~57 K |
| total request | ~700 KB | ~200 K |

That leaves the 1 M-token ceiling four-fifths unused, deliberately: the cap
here is about cost and latency, not capability. Prompt caching (§14) makes a
stable prefix cost a tenth on subsequent turns, so a large ambient context is
cheap to keep re-sending as long as the tree is unchanged — which argues for
emitting files in a stable order, and the tree listing before the volatile
message body.

### Reasoning traces

Both models emit `reasoning_content` — a **reasoning trace** — alongside the
reply when `reasoning = 1`. It streams as its own `agent.stream.reasoning`
event and renders in a dimmed collapsible block.

It is **never persisted** to `messages.body` and **never sent back** in a
later request's history. Both rules matter: it would bloat the database and
DeepSeek's own guidance is not to feed traces back as context. What survives a
turn is the reply text and the file writes.

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

Bounded loop: at most 8 assistant turns and 12 tool calls per fire. On hitting
either limit the turn ends with a `'system'` banner noting it stopped early.

`max_tokens` is set to 32768 per request. The model's ceiling is 65536 and
omitting the parameter uses all of it (§14); an explicit lower value is a cost
guard, not a capability limit. At 32 K output tokens a single `write_file` can
carry roughly 130 KB of markup, so whole-game-in-one-call truncation — a real
hazard under the 8 K assumption this spec previously carried — is no longer a
practical concern.

Truncation is still detected and reported. When a turn ends with
`finish_reason = 'length'`, or when streamed tool-call arguments fail to
parse, the orchestrator posts a `'system'` banner so a missing file never
reads as a backend bug. Non-streaming truncation drops the tool call entirely;
the streaming path can deliver partial argument fragments, so both cases are
handled.

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
| `message.new` | full message: `{id, project_slug, user_id, agent_id, kind, body, created_at, context_paths, writes}` |
| `agent.stream.start` | `{project_slug, agent_id}` |
| `agent.stream.reasoning` | `{project_slug, agent_id, delta}` — reasoning trace, rendered dimmed and collapsible, never persisted |
| `agent.stream.chunk` | `{project_slug, agent_id, delta}` — reply text |
| `agent.tool` | `{project_slug, agent_id, tool, path}` — drives a live "writing game.js…" indicator |
| `agent.stream.end` | `{project_slug, agent_id, message_id?, error?}` |
| `files.changed` | `{project_slug, paths: string[]}` — client refreshes the tree and reloads the preview iframe |

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
- Agent cooldown: 5 s per `(project, agent)`.
- Agent fire: ≤ 8 assistant turns, ≤ 12 tool calls.
- Context sent per fire: ~700 KB of text (§8), against a 1,048,576-token
  model ceiling.
- Output per request: `max_tokens = 32768`, model ceiling 65536.
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

- **No CSRF token.** `SameSite=Lax` only, as in `new-y`.
- **Lockout state is in-memory.** A restart clears all lockouts.
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
- The games listener exposes nothing but static reads under a project
  directory, and never reads a cookie. ⚠️
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

## 13. Configuration

| variable | default | notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | required; the server fails fast at boot without it |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | the host also answers without the `/v1` prefix |
| `PORT` | `8100` | studio listener; 8090 is left free for `new-y`, which both defaults to and is expected to run alongside this |
| `GAMES_PORT` | `8101` | games listener |
| `GAMES_URL` | `http://localhost:<GAMES_PORT>` | used to build play/preview links |
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
- `finish_reason: 'length'` fires reliably on truncation.

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

- Viewer counts, message reactions, web push, unread markers (all exist in
  `new-y`). Typing previews are **not** here — they are permanently out (§2).
- Public read-only chat or a public game index.
- Editing or deleting messages.
- Full-text search over messages and files.
- Slug rename with a redirect from the old public URL.
- Session expiry and rotation; CSRF tokens; persistent lockout state.
- Per-file locking so two agents can't lose an update on the same file.
- Diff view for binary files (images render as before/after rather than text).
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
  routes/         auth, projects, agents, messages, files, history, stream
public/
  index.html      shell
  main.js         the whole SPA
  style.css
bin/
  adduser.js  deluser.js
test/
```

Rough size: ~1,800 lines of server, ~1,200 of client, ~1,200 of tests. About
half of `new-y`, because signup, email, push, reactions, typing, unread
counts, and per-user permissions are all absent.

Tests use `node:test` against `:memory:` SQLite, a temp `GAMES_DIR`, and a
scripted fake LLM client, so the suite needs no network and no API key. The
one place a live key is required is a manual smoke script, kept out of
`npm test`.
