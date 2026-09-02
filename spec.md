# Unbridled Joy v0 — specification

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

- Email verification, password reset, invites. Studio accounts are created
  with a CLI script or the admin panel; the games origin's public sign-up
  (§6) makes nothing by itself — it joins a waiting list an admin decides.
- Permissions finer than the four coarse bits that exist. `admin` runs the
  studio, `studio_access` says whether somebody is in it at all, a game's
  authors plus its `open` flag say who may change it, and `daily_tokens` is
  what they may spend (§11). There is nothing per-file, per-chat or
  per-agent, and every studio account reads everything.
- Scale. One process, SQLite, synchronous `git` subprocesses.
- Branching or merging. History is linear per project; restore is a new commit.
- Real-time collaborative editing. Last write wins, guarded by an ETag check.
- **Typing previews. Dropped permanently, not deferred** — `new-y` streams
  keystrokes between humans; this app does not, and won't. Agent responses do
  stream (§9).
- Viewer counts, web push, unread counts. Deferred (§15).
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
| `display_name` | TEXT NOT NULL | shown in UI and used as the git author name; ≤ 100 chars, and every door that sets one refuses the path validator's control and format characters (§4) — it is a scoreboard name |
| `created_at` | TEXT NOT NULL | |

A row here is an account, and it comes in two kinds: with `studio_access = 1`
(and `deleted = 0`) it is **studio access** — the studio's door opens to it —
and with the bit off it is a **player account**: the games origin signs it in,
its scores wear its name (§6), and every studio door is shut. Every account
from before the bit existed is a studio one; what the waiting list makes is a
player.

⚠️ **Taking somebody out of the studio never deletes the row.** It sets
`deleted = 1` and drops their sessions, and touches nothing else. Their
messages, the games they author, their `project_authors` rows, their allowance
and what they spent are all still there, so `npm run restoreuser -- <email>`
clears the bit and gives back the same person.

⚠️ **And it is not something anybody can click.** There is no route and no
button: `npm run deluser -- <email>` is the only way out, going through
`removeAccount` in `server/auth.js`, and `restoreuser` the only way back.
Adding an account is an everyday thing and belongs in the panel beside the
names and the allowances. Taking one out is rare, is about a person rather
than a setting, and a red button sitting next to Save and Password invites the
press — so it costs a terminal. The panel's other refusals stay where they
are: the studio still keeps at least one admin (`isLastAdmin`, asked by the
panel before it demotes and by `deluser` before it removes).

The bit is read on one side of a single line. **Access** minds it: the login
lookup, `userForToken`, `GET /api/users`, the admin panel's list, resolving an
`@` to a person, and being added to a game as an author. **History** does not:
a message still carries the name of whoever wrote it, exactly as a deleted
agent's replies still carry its name (§3, `agents`).

Two consequences taken on purpose:

- `email` stays UNIQUE across removed rows — SQLite cannot narrow a table
  constraint to a partial index after the fact, and the address should stay
  with the person anyway. `adduser` and `POST /api/admin/users` both answer a
  removed address by pointing at `restoreuser` rather than starting a second
  account for the same person.
- A game whose **only** author is removed is left with no editors and can be
  changed by nobody until they are restored. The old hard delete refused that
  case outright, because it could not be undone; this one can, and the remedy
  is the restore. `removeAuthor`'s "a game keeps at least one editor" counts
  only authors still in the studio, so the live one can never be the one that
  goes.

### `sessions`

| column | type | notes |
|---|---|---|
| `token` | TEXT PK | 32 random bytes, base64url, stored verbatim |
| `user_id` | INTEGER NOT NULL → users | |
| `created_at` | TEXT NOT NULL | |

Sessions do not expire in v0.

### `player_sessions`

| column | type | notes |
|---|---|---|
| `token` | TEXT PK | 32 random bytes, base64url |
| `user_id` | INTEGER NOT NULL → users | |
| `created_at` | TEXT NOT NULL | rows older than 90 days resolve to nobody and are swept on the way past |

Who is signed in on the games origin (§6): any account still in — either
kind — over a `player` cookie. ⚠️ Deliberately not `sessions` and not the
`session` cookie: in development the two listeners share a hostname, so both
cookies travel to both origins, and the separation has to live in the token
itself. A player token opens exactly three doors — post a score as yourself,
say who you are, sign out — and resolves to nothing on the studio origin.
Unlike studio sessions these expire, matching the cookie's `Max-Age`,
because the public is not the account list. Removal, a password change, and
the studio-access toggle each end the sessions they should: the first two
take both kinds, the toggle only the studio's.

### `signups`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `email` | TEXT UNIQUE NOT NULL | |
| `display_name` | TEXT NOT NULL | ≤ 100 chars, no control or format characters (the path validator's class, §4) — it will be a scoreboard name |
| `password_hash` | TEXT NOT NULL | scrypt, hashed at sign-up so approval needs nobody present |
| `created_at` | TEXT NOT NULL | |
| `approved_by` / `approved_at` / `approved_user_id` | | who let them in, when, and the account it made |
| `refused_by` / `refused_at` | | who turned them away, and when |

The waiting list: what `POST /_signup` on the games origin writes (§6), and
the only thing it can write. A row is not an account — an admin **approves**
it into a player account (`studio_access = 0`, never an admin) or **refuses**
it, from Studio settings. ⚠️ Both decisions are columns, never a DELETE: the
decided rows are the audit trail of who asked and who answered, shown
nowhere. `email` UNIQUE means one story per address, however it ended — a
second ask against a decided address answers the same 202 and writes
nothing, and an admin who changes their mind about a refusal makes the
account by hand in the panel.

### `agents`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT NOT NULL | `@mention` handle; unique among non-deleted |
| `description` | TEXT NOT NULL | system prompt, appended to the studio preamble; ≤ 8 KB |
| `model` | TEXT NOT NULL DEFAULT `'deepseek-v4-flash'` | `deepseek-v4-flash` or `deepseek-v4-pro` (§14) |
| `thinking` | TEXT NOT NULL DEFAULT `'low'` | **thinking level**: `full`, `low`, `none` (§14) |
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

`thinking` replaced a `reasoning` boolean, which the migration backfills from
and then drops. It was kept written-but-unread for a while so a rollback would
find something true in it; one bit cannot hold three states, so `low` — the
default, and the level that writes files where full effort writes none (§14) —
came back as `full`, which is the failure the levels exist to prevent.

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
| `type` | TEXT | the game's **type**, a template's key (`visual-novel`, `quiz`): which *editors* the centre pane offers and how helpers are briefed (§6, §8). Null is a free-form game |
| `archived` | INTEGER NOT NULL DEFAULT 0 | |
| `published` | INTEGER NOT NULL DEFAULT 0 | listed in the public catalog at `/` on the games origin |
| `scores_on` | INTEGER NOT NULL DEFAULT 1 | the per-game scoreboard switch: off, both `/_scores` routes answer 404 and the preamble stops naming the board; the rows are kept |
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

`type` is set at creation from the template and copied by a fork; a blank page
is null and stays so. A column rather than a file in the tree on purpose: a
helper must not be able to change which editors somebody sees with a
`write_file`. ⚠️ A game from before the column is marked `''` by the
migration — not yet looked at — and `projectPublic` answers it once from the
game's own tree, the type whose heart file (§6) it holds, writing the answer
back, null included. So a free-form game that later gains a `config/story.js`
is still free-form, and the tree is read for it once ever.

There is no `system_prompt` column. Project-level standing instructions live
in `BRIEF.md` at the project root: a plain file in the working tree, so it gets
version history, edits in the same editor as everything else, and can be
updated by an agent as the design evolves. When present it is injected into
every agent's context (§8).

### `users` — the columns that are not identity

| column | type | notes |
|---|---|---|
| `admin` | INTEGER NOT NULL DEFAULT 0 | may run the studio: add an account, rename one, set an allowance, decide the waiting list, hand out this bit |
| `studio_access` | INTEGER NOT NULL DEFAULT 1 | off, the account is a player only: games-origin login and the scoreboard, nothing in the studio. The panel's toggle; an admin never has it off |
| `daily_tokens` | INTEGER NULL | what this person's helpers may spend in a day. Null is no allowance of their own; a new account starts on `DEFAULT_DAILY_TOKENS` (1 M, ~25 replies), stated at creation because the column already exists everywhere and SQLite will not change a default afterwards |
| `deleted` | INTEGER NOT NULL DEFAULT 0 | taken out of the studio. Set, every door is shut and every row is kept; `restoreuser` clears it |

The first account made is an admin — somebody has to be able to make the
second — and an upgrade gives the bit to the lowest id. ⚠️ The studio keeps at
least one admin: demoting or removing the last is a 409, because a studio
nobody can run is one nobody can add an account to either. The count is of
admins **still in the studio**, so a removed one is not one of them.

`studio_access` is read on the same line as `deleted`, access minding it and
history not: studio login, `userForToken`, the crew list, resolving an `@` to
a person, and being added or counted as an author all take the bit; every
rendered name ignores it. Toggling it off ends the person's studio sessions
the way removal does — their player sessions stay, because the games origin
is still theirs — and the rows all stay, so toggling it back gives back the
same person, editor rows included. Making somebody an admin turns the bit on
with the promotion; taking the bit from an admin is refused (409) until the
admin bit goes first.

### `user_tokens`

| column | type | notes |
|---|---|---|
| `user_id` | INTEGER NOT NULL → users | |
| `day` | TEXT NOT NULL | UTC date, `YYYY-MM-DD` |
| `tokens` | INTEGER NOT NULL DEFAULT 0 | |

PK `(user_id, day)`. What one person's helpers spent on one day — no rollover
column per person, because a day that is not today is simply a row nothing
reads. Also the only record of who spent what, which is what the panel shows.

### `project_authors`

| column | type | notes |
|---|---|---|
| `project_id` | INTEGER NOT NULL → projects | |
| `user_id` | INTEGER NOT NULL → users | |
| `added_by` | INTEGER NOT NULL → users | |
| `added_at` | TEXT NOT NULL | |

PK `(project_id, user_id)`. Who may change a game. The person who made it is
its first author; an author adds the next one. A project that predates this
gets its `created_by`, which is the only honest answer the row holds.

⚠️ A game keeps at least one author: removing the last is a 409. A game with
none could be changed by nobody, and nobody could open it either.

`projects.open_edit` is the other half: 0 by default, and 1 means any account
in the studio may change it. It is an author's decision — see §11.

### `chats`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER NOT NULL → projects | |
| `name` | TEXT NOT NULL | ≤ 60 chars |
| `bots` | INTEGER NOT NULL DEFAULT 1 | 0 = human only: no *helper* may be put in it at all |
| `created_at` | TEXT NOT NULL | |

One conversation inside a project. Every project is born with two:
`Humans only` (`bots = 0`), which is the one it opens on, and `Building`, where
helpers can be put. A game may have up to 20. There is no delete: a chat holds
what people said in it, and nothing else in the studio throws words away.

⚠️ Both, unconditionally, and for an upgraded database too. `intoChats` used to
make `Building` only where there was a thread or a line-up to carry into it,
which left a game nobody had talked in yet with nowhere a helper could ever be
put. The condition belongs to what moves, not to whether the chat exists.

⚠️ `bots = 0` is enforced where a helper would be **put in** (`assertBotsAllowed`
on the attach route and on the fork's copy), not where one would answer. A room
that promises nobody is listening has to keep that promise at the door; an
eligibility-time check would be one forgotten call away from a helper sitting
in it silently.

Index `idx_chats_project ON chats (project_id, id)`.

### `chat_agents`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `chat_id` | INTEGER NOT NULL → chats | |
| `agent_id` | INTEGER NOT NULL → agents | |
| `chatty` | INTEGER NOT NULL DEFAULT 0 | responds to every human message, not just mentions |
| `cooldown_until` | TEXT NULL | null = no active cooldown |
| `response_pending` | INTEGER NOT NULL DEFAULT 0 | dirty bit (§8) |
| `attached_by` | INTEGER NOT NULL → users | |
| `attached_at` | TEXT NOT NULL | |

`UNIQUE (chat_id, agent_id)`. A helper is in a conversation, not in a game: the
line-up, the chatty switch, the cooldown and the dirty bit are all per chat,
because every one of them is about one conversation. Hard delete on detach —
nothing references these rows (cooldown state is disposable), so `new-y`'s
soft-delete dance
isn't needed here.

### `messages`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER NOT NULL → projects | |
| `chat_id` | INTEGER NULL → chats | which conversation. Nullable in the column only so a database from before chats can be upgraded in place; every row written since has one |
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

Indexes `idx_messages_project ON messages (project_id, id)` and
`idx_messages_chat ON messages (chat_id, id)` — the second is created after the
column, not with the other tables, because on an upgrade there is nothing to
index until the column exists.

**The upgrade.** A database written before chats has one thread per project and
its helpers on the project. `intoChats` in `db.js` gives each project the
human-only chat first, and — for a project that has messages or helpers — a
`Building` chat second, which takes every message and every helper as they
were. `project_agents` is then dropped rather than left to disagree with
`chat_agents`. It runs on every open and does nothing to a project that already
has chats. Covered by a test that builds the old shape in a file and opens it.

### `message_context`

| column | type | notes |
|---|---|---|
| `message_id` | INTEGER NOT NULL → messages | |
| `path` | TEXT NOT NULL | project path pinned by the human |

PK `(message_id, path)`. Records which files a human explicitly pinned on that
turn. Drives the context chips in the UI and the pin rules in §8.

### `message_reactions`

| column | type | notes |
|---|---|---|
| `message_id` | INTEGER NOT NULL → messages | |
| `user_id` | INTEGER NOT NULL → users | people only; an agent never reacts |
| `emoji` | TEXT NOT NULL | stored as given, ≤ 32 utf-8 bytes, unvalidated (§10) |
| `created_at` | TEXT NOT NULL | |

PK `(message_id, user_id, emoji)` — the key is the toggle: adding the same
emoji twice is a conflict, so taking one back is a DELETE and nothing ever
counts double (the pattern proved in `new-y`). Index on `message_id`.

`messagePublic` embeds the grouped result on every message as
`reactions: [{emoji, users: [{id, name}]}]` — ids for the "is this yours"
test, names for the tooltip, resolved at serve time like `user_name` and
equally blind to `deleted`. Groups stand in the order the first of each
landed, so a chip never moves when somebody joins it. Never part of an
agent's context: nothing an agent is sent reads this table, and a reaction
is never a message, so the thread's shape does not move when somebody reacts.

### `mentions`

| column | type | notes |
|---|---|---|
| `message_id` | INTEGER NOT NULL → messages | |
| `user_id` | INTEGER NOT NULL → users | the person the message called by name |
| `chat_id` | INTEGER NOT NULL → chats | |
| `project_id` | INTEGER NOT NULL → projects | denormalised, for the sidebar's count |
| `seen` | INTEGER NOT NULL DEFAULT 0 | |
| `created_at` | TEXT NOT NULL | |

PK `(message_id, user_id)`. One row per person an `@name` in a **human**
message reached, written in the same transaction as the message. `server/
mentions.js` resolves both kinds of name with one rule — normalise to lowercase
alphanumerics, match the whole name or a prefix of at least two characters — so
`@Robin` reaches Robin Fox the same way `@Level` reaches Level Designer. Never
for the person who wrote it, and never for an agent reply: agents are not told
who the people are, and a helper echoing a name should not ring a bell.

A row rather than an event, because the mark has to outlive the tab that was
open when it landed; per chat rather than per project, because reading one
conversation says nothing about what was said in another. `POST
…/chats/:id/seen` is the only thing that clears it, and it clears nobody else's
rows. ⚠️ Not a side effect of the GET that opens a chat: a read that writes is
one somebody else's tab can trip, and the client needs the same call for a
mention that lands in the chat already on screen.

Counts ride the payloads that are already drawn per person — `mentions` on each
project in `GET /api/projects` and on each chat in the project detail — and the
`message.new` broadcast carries `mentions: [user_id]` so a tab that is not
looking can paint its own mark without refetching.

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

### `message_receipts`

| column | type | notes |
|---|---|---|
| `message_id` | INTEGER PK → messages | the agent reply it accounts for |
| `project_id` | INTEGER NOT NULL → projects | for taking the previous prompt |
| `breakdown` | TEXT NOT NULL | JSON: bytes per context part, per-request token usage (§8) |
| `prompt` | TEXT | the last request as sent; NULL once a newer reply in the project fires |

The **receipt** behind the token note: what the fire was given and what each
request cost, captured when it fired because none of it can be recomputed
later — files change and the trim boundary moves. The breakdown is small and
kept on every reply; the prompt is a debugging aid, held only for the newest
reply in each project, so the table stays bounded by the message count rather
than growing by half a megabyte per reply. Never sent with the message list —
the client fetches it on the click that opens it.

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

### `scores`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | ties rank by it: earlier post wins |
| `project_id` | INTEGER NOT NULL → projects | |
| `user_id` | INTEGER → users | who posted it; NULL on every row from before sign-in existed |
| `name` | TEXT NOT NULL | the poster's account name, squeezed to 24 chars, control and format characters stripped — the doors refuse them now, the strip covers names stored before they did |
| `score` | INTEGER NOT NULL | a JS-safe integer; bigger is better |
| `created_at` | TEXT NOT NULL | |

A game's scoreboard, posted **by a signed-in player** from inside the running
game and served back by the games origin (§6). The name is the account's —
whatever a body still carries is ignored, which keeps every game written
before the sign-in working the moment its player signs in. Rows from before
keep the names they were posted under, `user_id` NULL. Pruned to the best 100
per project on every insert, so the table is bounded by construction — and a
post a full board already outranks is answered `rank: null` without being
written, the personal best still raised. It
lives here rather than in the working tree because a tree write is a commit:
scores as files would spam Versions, restart the preview on every
`files.changed`, and thrash the ambient block's prompt cache (§8).
`VACUUM INTO` backs it up with the chats and accounts; git cannot recover it.

⚠️ The **score** is still forgeable — the client is the only witness to the
run, and signing it would need a secret inside LLM-written game code, which
is no secret. What the sign-in ends is the *name* being anybody's: a game
can no longer post as somebody who was never there, though the game a player
is signed into can still post whatever number it likes as them. An accepted
cost for this studio (ideas/next-five.md).

### `personal_bests`

| column | type | notes |
|---|---|---|
| `project_id` | INTEGER NOT NULL → projects | PK with `user_id` |
| `user_id` | INTEGER NOT NULL → users | |
| `score` | INTEGER NOT NULL | this person's best ever on this game |
| `created_at` | TEXT NOT NULL | when that best was set |

One row per person per game, raised (never lowered) beside every `scores`
insert in the same transaction. It exists because the board keeps the best
100 *runs*: a personal best that was pruned off the board would otherwise be
gone. Nothing displays it yet — the board and this are meant to be shown
side by side later (TODO.md).

### `achievements`

| column | type | notes |
|---|---|---|
| `project_id` | INTEGER NOT NULL → projects | PK with `user_id`, `achievement` |
| `user_id` | INTEGER NOT NULL → users | who earned it |
| `achievement` | TEXT NOT NULL | the `id` from the game's `config/achievements.js` |
| `created_at` | TEXT NOT NULL | when they first earned it |

What a player has earned in a game, posted by the *achievements library* from
inside the running game and served back by the games origin (§6). Like the
scoreboard it lives here rather than in the working tree — an earned row is not
a commit, so it spams nothing and never enters an agent's context. Unlike a
score it is the same kind of thing as a *personal best*: `INSERT OR IGNORE` on
the composite key, so earning one twice is a no-op, and ⚠️ **permanent** — no
route deletes a row, no button, no per-row ✕ like the scoreboard has. The
definitions are **not** here: they are the game's own `config/achievements.js`,
read from the working tree per request (§6), so removing one from the file
leaves the rows and simply shows them nowhere until the id comes back. Renaming
an id orphans everybody's, which is why the *achievements editor* derives an id
from the name once and never lets it change. `VACUUM INTO` backs it up with the
chats and accounts; git cannot recover it. `npm run deluser --scores` should
take these with it when it is built (TODO.md).

⚠️ Forgeable exactly as a *score* is: the rule was met in the browser, which is
the only witness, and a rule evaluated in game code is one anyone can satisfy
from devtools. The server never sees a *moment* — only the unlock a rule
produced — and accepts it for the same reason it accepts a score.

### `studio_state`

Single row, `id = 1`.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK CHECK (id = 1) | |
| `tokens_used_today` | INTEGER NOT NULL DEFAULT 0 | all agents, all projects |
| `budget_reset_at` | TEXT NOT NULL | advances to next UTC midnight on first use after rollover |
| `daily_token_budget` | INTEGER NULL | the studio-wide wall; null = the built-in default |
| `default_agent_id` | INTEGER NULL → agents | the *starter helper*; null = nobody |

One studio-wide daily budget rather than `new-y`'s per-user accounting —
agents aren't owned by anyone, and the purpose here is narrower: stop a
runaway tool loop from draining the API key.

The **starter helper** is the one that joins every new game's `Building` chat,
chatty, at creation — so a new game is somewhere you can ask for something
rather than a room with nobody in it. A setting rather than a name in the
source: helpers are rows people make, rename and delete. Null is nobody, and
that is what a fresh studio has; a soft-deleted agent reads as null too, so a
helper taken out of the studio quietly stops joining instead of failing every
creation. Games only — a chat project has no working tree to build. It is read
and written in Studio settings, beside the budget, and it never reaches
`Humans only`: `joinStarter` goes through `assertBotsAllowed` like every other
way a helper is put in a chat.

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
| GET | `/api/users` | — | everyone in the studio: `{id, display_name}` only |

There is no signup route **on this origin**, and no route here ever makes
studio access from the outside: studio accounts come from `npm run adduser`
and the admin panel, and what the games origin's public sign-up feeds is a
waiting list whose approval makes a player account (§3, `signups`). Login
requires `studio_access = 1`; a player account takes the unknown-email path,
the same as a removed one. `/api/users` is a list of who is *in the studio*,
for the sidebar's Crew tab — players are not on it — and carries no address:
the studio is private, but a list of names does not need to be a list of
email addresses to do its job.

#### Projects

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/projects` | — | all projects incl. archived, with last-message preview; each game says whether `icon.png` is at its root (`has_icon`) — the one *reserved image* the sidebar needs for games not open (§6) |
| POST | `/api/projects` | `{name, slug?, kind?, template?}` | create row, and for a game its directory and git repo; slug derived from name when omitted; `kind` defaults to `game`; `template` copies a game-template starter tree in as a third commit — games only, validated against `public/game-templates/index.json`; no template means the blank start page instead. Answers with the project plus `chats` and `chat` — the conversation to open, `Building` when the *starter helper* joined it |
| GET | `/api/projects/:slug` | — | project, attached agents, recent messages |
| PATCH | `/api/projects/:slug` | `{name?, scores_on?}` | rename (display name only), and the scoreboard switch; a rename needs the project open, the switch is moderation and works archived |
| GET | `/api/projects/:slug/scores` | — | every kept score with id and time, best first, plus the switch: `{scores, scores_on}` |
| DELETE | `/api/projects/:slug/scores/:id` | — | delete one score; there is no undo — scores are not files |
| DELETE | `/api/projects/:slug/scores` | — | delete them all |
| GET | `/api/projects/:slug/achievements` | — | each definition in `config/achievements.js` with how many players hold it: `{achievements: [{id, name, how, icon, players}]}`; a read, so anybody in the studio; the *achievements editor*'s structural read |
| POST | `/api/projects/:slug/story/fill` | `{sentence, scene: {key, about}, cast: [{key, name, about}], lines: [{who, say}]}` | the *fill*: a sentence about what happens back as `{lines: [{who, say}], tokens}` in the story's own keys. An editor's, like every change to a game |
| POST | `/api/projects/:slug/story/picture` | `{kind, name?, about?, colours?}` | the drawn *stand-in*: `{svg, width, height, tokens}` — a flat SVG at the size `kind` (`portrait` 128², `background` 480×270) wants. The browser draws and saves it; the server writes nothing |
| POST | `/api/projects/:slug/archive` | `{archived: bool}` | archive or unarchive |
| POST | `/api/projects/:slug/authors` | `{user_id}` | add an editor; 404 for anybody deleted or without `studio_access` |
| DELETE | `/api/projects/:slug/authors/:user_id` | — | drop an editor |
| POST | `/api/projects/:slug/open` | `{open_edit: bool}` | open the game to every account, or close it to its editors |
| POST | `/api/projects/:slug/fork` | `{name, slug?}` | copy the working tree and its history into a new game, carrying the attached agents but not the thread; games only |
| POST | `/api/projects/:slug/publish` | `{published: bool}` | list or unlist the game in the public catalog; games only |

⚠️ The three author and open routes are the exception to **open**: they need
an *author*, not merely somebody who may write, even when the game is open.
Open is about the work, not about who decides (§11).

#### Running the studio

Every route here requires `users.admin`; everything else in the API is open to
any account (§11).

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/admin/studio` | — | the people, what each has spent today, the studio-wide budget, `starter_agent_id`, and `waiting` — the undecided sign-ups |
| POST | `/api/admin/users` | `{email, display_name, password, daily_tokens?}` | add an account |
| PATCH | `/api/admin/users/:id` | any of `display_name`, `daily_tokens`, `admin`, `studio_access`, `password` | change one; the bit off ends their studio sessions, off-for-an-admin is 409, a password change ends both kinds of session |
| POST | `/api/admin/signups/:id/approve` | — | the waiting list's yes: makes the player account, marks the row; 404 once decided |
| POST | `/api/admin/signups/:id/refuse` | — | the waiting list's no: marks the row and keeps it (§3) |
| PATCH | `/api/admin/studio` | `{daily_token_budget, starter_agent_id?}` | the wall around everybody, and who joins a new game; the helper is optional here — both settings share one Save, and leaving it out changes nothing |

⚠️ A password set here ends that person's sessions: a password changed because
somebody else knew it has to end the somebody else's session too.

⚠️ **There is no `DELETE /api/admin/users/:id`, and no Remove in the panel.**
Taking somebody out of the studio is `npm run deluser -- <email>` and nothing
else, undone with `npm run restoreuser` (§3, §11). Adding an account is an
everyday thing and belongs here; removing one is rare and costs a terminal on
purpose. Every route above refuses a person who is already out — the panel
lists only the people still in the studio, and a `PATCH` naming a removed id
is a 404.

#### Chats

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/projects/:slug/chats` | — | this project's conversations |
| POST | `/api/projects/:slug/chats` | `{name}` | a new one, always allowing helpers |
| PATCH | `/api/projects/:slug/chats/:chat_id` | `{name}` | rename |
| POST | `/api/projects/:slug/chats/:chat_id/seen` | — | clear your own *marks* on that chat |

`GET /api/projects/:slug` and `GET /api/projects/:slug/messages` both take
`?chat=`; `POST .../messages` takes `chat_id` in the body. Absent, all three
mean the chat the project opens on — so a client that knows nothing about
chats posts into the human-only one rather than into whichever one it guessed.
A chat id belonging to another project is a 404: from here it is simply not
one of this project's.

There is no route that deletes a chat.

#### Agents

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/agents` | — | all agents |
| POST | `/api/agents` | `{name, description, model?, thinking?, file_tools?}` | create |
| PATCH | `/api/agents/:id` | any of the above | update |
| DELETE | `/api/agents/:id` | — | soft delete; detaches from all projects |
| POST | `/api/projects/:slug/chats/:chat_id/agents` | `{agent_id, chatty?}` | put a helper in that chat |
| PATCH | `/api/projects/:slug/chats/:chat_id/agents/:agent_id` | `{chatty}` | update |
| DELETE | `/api/projects/:slug/chats/:chat_id/agents/:agent_id` | — | take out |

#### Messages

| method | path | body | effect |
|---|---|---|---|
| POST | `/api/projects/:slug/messages` | `{body, context_paths?: string[]}` | post a human message; fires eligible agents (§8) |
| GET | `/api/projects/:slug/messages` | `?before=<id>&limit=<n>` | page backwards through history |
| POST | `/api/projects/:slug/errors` | `{version, errors: [{message, location}]}` | record what the running game reported (§8); `version` is the commit the reporter was built with and the report is dropped unless it is HEAD; games only, allowed on an archived one |
| GET | `/api/messages/:id/receipt` | — | `{breakdown, prompt_held}`: what that reply was given and what each request cost (§8); 404 for a message with no receipt |
| GET | `/api/messages/:id/prompt` | — | the last request of that fire as plain text; 404 unless the message is the one reply in its project whose prompt is still held |
| POST | `/api/messages/:id/reactions/toggle` | `{emoji}` | toggle that emoji on that message for the signed-in person; answers `{action: 'add'\|'remove'}` and broadcasts `message.reaction` (§9) |

Message ids are global and every account sees every project (§3), so the two
receipt routes and the reaction toggle check only that someone is signed in.
For the toggle that is deliberate: a reaction is talk about the work, not a
change to it, so neither authorship nor archiving stands in the way.

#### Files

| method | path | notes |
|---|---|---|
| GET | `/api/projects/:slug/files` | recursive listing: `[{path, size, mime, modified_at}]`, sorted |
| GET | `/api/projects/:slug/files/*path` | raw bytes, `ETag: "<sha256>"` |
| PUT | `/api/projects/:slug/files/*path` | raw request body is the content; honours `If-Match`; creates or updates; commits |
| DELETE | `/api/projects/:slug/files/*path` | commits |
| POST | `/api/projects/:slug/files/move` | `{from, to}` — `git mv`, commits |
| POST | `/api/projects/:slug/files/duplicate` | `{from, to}` — copies the bytes into a new file, commits; 409 if `to` exists |
| POST | `/api/projects/:slug/files/import` | `{from_slug, from_path, to_path?}` — copies a file **in from another game**, commits; 409 if `to_path` exists |

`import` is the copy/paste between games. Reading the source is every
account's, so the only rights that matter are the ones on the game it lands
in: it takes `write: true` on `:slug` and nothing on the source. The bytes are
copied as they are — no history, no link, and the two games are strangers
afterwards.

`PUT` takes a **raw body**, not `multipart/form-data`. That removes the need
to hand-roll multipart parsing and fits a file tree better than an upload
endpoint: the browser reads a dropped `File` and `PUT`s its bytes at the path
it should occupy.

`If-Match` carries the ETag from the last `GET`. On mismatch the server
returns 409 with the current content, so the editor can't silently clobber an
agent's write while you had the file open. Omitting the header forces the
write.

The tag is matched by the sha inside it, not byte for byte. A compressing
proxy renames a strong ETag per encoding — Caddy's `encode` turns `"<sha>"`
into `"<sha>-zstd"` and strips its suffix from `If-None-Match` only, never
from `If-Match`; nginx's gzip weakens it to `W/"<sha>"` instead — so deployed
behind the recommended Caddyfile, every save of a compressed `GET`'s file
409'd as a phantom conflict until the comparison allowed for the rename. The
sha is a hash of the content, so comparing it *is* the conflict check the
header was for.

`+ Upload` — one of the four choices behind **Add a file**, the single button
above the file list — puts **any** file into the game the same way: the studio reads the
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

- **Three folders under `assets/`, by what the file is.** A sound goes to
  `assets/sounds/`, a *strip* to `assets/sprites/`, any other picture to
  `assets/images/`, and anything else to `assets/`. The folder is not tidiness:
  the sound player and the sprites library resolve a plain name inside the
  first two, so `Sound.play("laser")` and `Sprites.draw(ctx, "hero", x, y)`
  find a file nobody had to path out — and a picture that does not move is in
  `assets/images/`, drawn by its whole path, because it is not what that call
  is for. The agent preamble names all three. A dropped picture is decoded
  before the dialog opens, since only its shape can say which of the two it is;
  the dialog then shows the path each file will take before anything is sent,
  and one box overrules every one of them for the drop that belongs somewhere
  else entirely.
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
point a game at `assets/sprites/hero.png` but cannot create or change it.

A code file opens with its syntax coloured, by the studio's own tokenizer
(`public/highlight.js`) rather than a library: comments, strings, numbers,
keywords, tags and attributes for `.js`/`.json`, `.css` and `.html`, and
everything else plain. The mechanism is an overlay — the same characters
tokenized onto a `<pre>` behind a textarea whose ink is transparent — so the
textarea stays the only editor: caret, selection, focus snapshot, dirty state
and save are untouched, and a token read wrongly is a colour, never a change
to the file. ⚠️ Token styles may vary `color` alone — a bold or italic glyph
is a different width, and the overlay must sit exactly on the text. A file
past 128 KB stays plain, and a JavaScript regex literal is deliberately shown
plain: telling `/` the operator from `/` the regex needs a parser, and a wrong
guess would paint the rest of the line as a comment or string. The tokenizer
is pure — no DOM — and covered by `npm test`.

An asset can also be **made** here rather than added, by two tools that end in
the same `PUT`, at the same tidied path, in one commit each.

`+ Make a sound` asks two things — what it is called, and which preset it
starts from — writes the `.wav`, and opens it in the **sound editor**: a
preset row, a shape, and a slider per number with its comment beside it. The
render is arithmetic in `public/sound-maker.js` rather than Web Audio — a few
hundred samples per millisecond of blip, then the 44 bytes of a PCM header —
which buys two things. The studio plays the encoded bytes, so what is heard is
what is saved rather than a live approximation of it; and the whole thing is
checked in `npm test` without a browser, which no `AudioContext` would allow.

The editor is also simply how a `.wav` opens, which is the point: a sound is
worth changing a week later, and samples cannot be turned back into sliders.
So the numbers ride inside the file they made, as the **sound note** — a JSON
comment in a `LIST`/`INFO`/`ICMT` chunk, about 200 bytes, sitting between
`fmt ` and `data`. RIFF is a list of chunks and every player skips the ones it
does not know, so the sound is unchanged: the samples are byte for byte what
they would have been without it. Three choices worth naming:

- **In the file, not beside it.** A `laser.json` next to `laser.wav` would have
  been less code and would have come apart the first time somebody renamed,
  duplicated or restored one of the pair. `move`, `duplicate` and Versions all
  work on one file at a time, and none of them would have to learn about a
  second.
- **A comment chunk rather than a private one.** `ICMT` is the documented place
  for a note about a sound, so an audio editor shows it rather than dropping it
  on the next save. A chunk of the studio's own invention would have been
  invisible everywhere and no easier to write.
- **Nothing in the file is trusted.** The bytes may have been uploaded. A value
  that is not a number the sliders could have produced is replaced by the
  default, so a hand-edited note is a strange sound at worst, never a broken
  editor. A `.wav` with no note — anything made before this, or made anywhere
  else — opens as the player it always did, with one line saying why.

`+ Draw a picture` makes a transparent PNG at the size asked for and opens it
in the **pixel editor**, which is also simply how a PNG opens: up to 1024 a
side, saved at exactly the size it arrived. Pixels are RGBA, as a canvas keeps
them, so opening an uploaded picture loses nothing. The tools are in
`public/pixel-editor.js` and are arithmetic over bytes for the same reason the
sound editor is; the canvas, the pointer and `toBlob` stay in `main.js`. Five
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

A commit that touched a sound gets a player on the same terms, pointed at the
same read-at-a-commit route, because a subject line cannot tell you what a
version of a blip sounded like. It sits beside the row's controls rather than
inside the button that opens them: a player is a control, and pressing play
must not open the changes. It preloads metadata only, so a version that
deleted the sound removes its own row the way a picture with nothing behind it
does.

The history route answers `{ commits, total }`: a page of versions, and how
many there are. The count is a `rev-list --count` beside the log, and it is
what the open file's own bar says — `12 versions` rather than `Versions`,
asked for with `limit=1` when the file opens, because the number is worth
knowing before deciding whether the list is worth opening. A count that
stopped at the page size would be a number quietly meaning "or more".

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

#### The shell

Three panes: the sidebar, the conversation, the rail. The shape of each is
settled, and each choice is about where a thing is reachable from rather than
how it looks.

**The sidebar is one list at a time** — Games, Chats, Crew — with tabs over
it and a box that filters the one showing. Crew is everyone in the studio in
two kinds: **Humans** over **Helpers**, because both belong to the studio
rather than to a game. The people come from `GET /api/users`, which is names
and ids and deliberately no addresses; nothing in the interface makes an
account, so the list is read once at boot and the empty state says where
accounts come from. Three stacked foldable sections
fought each other for the height of the pane, and folding one to see another is
a decision nobody wanted to make twice. The tab is remembered per browser next
to the rail width; the filter is not, because a filter still in force tomorrow
is a list with things missing from it. The button above the tabs makes whatever
the open tab holds, so `+ New chat` is never a click away from the chats.

**The whole-game actions are three buttons at the end of the game's own bar** —
`Fork`, the publish status, `Editors`. Fork is everybody's; the other two are
an editor's, and are absent rather than disabled for anybody else, because a
button you may not press is a question you cannot answer. Renaming is not among
them — the pencil beside the name is. They were at the foot of the Play tab
first, then a drawer under the name; a drawer is somewhere to hide things, and
three buttons and their own state do not need hiding. The words that went with
them are gone with it: the padlock says whether the game is closed and the
publish button says whether it is listed, so "in the games list", "by Dann" and
"authors only" were three labels restating two buttons.

**The row under it is the conversation's**: `+chat` pinned at the left, the
chat pills, and the helpers listening in this chat at the right. ⚠️ The pills
and the helper chips are each their own horizontal scroller, so a studio's
worth of chats and a crowd of helpers give way to each other rather than one
pushing the other off the end.

**The body of the centre pane is a chat or an editor.** An **editor** is a
surface a *game type* brings — `public/game-types.js` maps `projects.type` to
its editors, one entry each, and that file is the whole registry — and it is
one more pill in the row over the conversation, before the chats with a
hairline between the two kinds, taking the whole pane the way a chat does: no
narrow chat beside it, no drawer, the sidebar and the rail as they are. Which
is showing is the centre's one piece of state (`S.editor`); `S.chat` is
untouched by it, so the chat behind an editor keeps filling, a mention lands
as a mark on its pill rather than being read, and pressing the pill paints
what arrived. On an editor's tab the right-hand end of the row is empty — the
chips and the `+` are the open chat's. A game opens on the address if it says
(`?edit=`, or `?chat=`, which is no editor), else what this browser remembers
for the game, else the type's first editor for a game that has one and the
chat for a game that does not; so a new visual novel opens on its story
editor, and a free-form game is exactly as it was. The *story editor* is the
first (below); a type may bring several.

**A game a person makes is open** — the whole studio may change it — and an
editor closes it in the `Editors` dialog, which puts a padlock in front of its
name. This is a studio of a few people who trust each other: a game nobody else
may touch should be a decision somebody made rather than the state everything
starts in. A fork is a new game and starts open too, whatever the original was.
⚠️ Stated at the INSERT rather than as the column's default, which stays 0: a
database written before this already has the column, and SQLite cannot change a
default after the fact. Chat projects stay closed — they have no working tree,
and `open_edit` there is about who may start chats in somebody's conversation.

**The rail is the preview and three tabs.** The preview is not a tab any more —
a game is what the rail is about, so it sits at the top of it whatever is open
underneath, with `Open` and `Hide` on the frame because both act on the running
game. Folded, it is one row that still plays, remembered per browser. `Reload`
is gone: a commit already reloads it, which is the sentence printed under it.
The share URL row is gone too — `Open` opens the address it would have printed.
What is left is **Files · Versions · Scoreboard**, and a `?tab=play` link from
before falls back to Files, where its preview now is.

**A game lends the studio its four colours** — its *look* — while it is open.
`config/look.js` is read once for both the *palette* and these; the four are
set on the shell as `--look-*`, and the chat pane, its buttons, the composer,
the game's actions and the rail are the only things that read them. The sidebar stays
the studio's own cyan on purpose: that is what stops the studio from looking
like whichever game is open. ⚠️ Each value is checked before it reaches a style
attribute — no colon or semicolon, so it cannot close the declaration and open
another, and no `url()` or `var()`. A game that names none of them wears the
studio's defaults, so a partial look is fine, and a helper's edit to `look.js`
re-reads it unless there are unsaved colours in the editor.

**Three picture names at a game's root are reserved images** — the studio's
dressing rather than the game's: `chat.png` tiles behind the conversation,
`hero.png` backs the bar over it and the game's card in the catalog (§7), and
`icon.png` sits before the game's name in the sidebar. Root rather than
`assets/` on purpose: a sprite that happens to be called `icon.png` must not
become the studio's dressing, and the upload dialog routes the three names to
the root the same way it routes a strip to `assets/sprites/`. All optional —
a game without one wears the studio's own look — and person-made like any
other picture; the preamble names them so a helper asks rather than filing a
wallpaper where nothing looks. In the studio they sit under a wash of the
game's `deep` colour, and on the catalog card under a plain dark one — the
front door wears the studio's own dark now, and no light surface is left
anywhere. The client holds the open game's
two, and every game's icon, as object URLs replaced on `files.changed` and
revoked on replace — the file routes send `no-store`, and a background
rebuilt by every render would refetch on every keystroke; `has_icon` on the
project list is what keeps the sidebar from probing every game for an icon
it does not have.

### The studio library

`studio/` is a reserved directory in a game's working tree holding the studio's
own **libraries** — the input module and the sound player today, a sprite
library or an engine later. It is served like any other file, committed like
any other file, and cloned with the repository. `studio/studio.json` is its
**manifest**: library name to the version this game has.

The **sound player** (`studio/sound.js`) is the second library, and the one
that proved the shape: it needed no orchestrator edit — its API note is its
file header — only the file and an `index.json` entry, which is still all a
fourth library would need. `Sound.play("laser")`
plays `assets/sounds/laser.wav` — the files the sound editor writes — with a pooled
element per shot, so rapid fire overlaps instead of dropping or cutting
itself, plus `loop`/`stop`/`mute`. A missing file or a not-yet-allowed
autoplay is one console warning, never an error: a game must not break over a
sound.

The **sprites library** (`studio/sprites.js`) is the third. One sprite is one
file: `Sprites.draw(ctx, "hero", x, y)` draws `assets/sprites/hero.png`, and a PNG
whose width is a whole multiple of its height is a **strip** — square frames
side by side, cycled by a shared clock (`Sprites.tick()` once a frame, 8 fps
unless the call says otherwise; `frame` pins one, `scale`/`flip` transform,
`frames` overrides the count for a non-square strip). No registry and no
config file — the shape of the picture says everything, the same
name-is-the-file rule as sound. A packed multi-sprite sheet was considered
and rejected: atlases exist for request counts and draw-call batching,
neither of which binds here, and the file is this studio's unit of naming,
versioning, diffing and thumbnailing — a kid edits `hero.png`, not a cell in
a sheet. Still loading draws nothing; missing warns once.

A strip opens in the pixel editor **one frame at a time**: frame buttons, a
small preview looping the whole strip live at the library's 8 fps while it is
drawn, Copy frame / Paste frame (one undoable gesture that goes through
`setPixel` like every tool), and a toggleable **ghost** — the frame before at
quarter strength, display-only, wrapping so frame one ghosts the last. The
tools are clipped to the open frame inside the one bounds check they all
share (`inside` in pixel-editor.js), so a wide brush cannot spill into the
neighbour and a fill cannot leak across the strip; undo jumps to the frame it
changed. "Whole strip" is the way back to drawing across everything, with the
frame boundaries as an overlay — one screen pixel at any zoom, never saved
into the picture. `+ Draw a picture` offers the frame count that makes a
strip.

The **screens library** (`studio/screens.js`) is the fourth, and the first
presentational one: `Screens.hint()`, the phone-fit `Screens.title()` and the
`Screens.chips()` HUD strip. Three decisions in it are worth writing down.

**Every rule it injects weighs exactly one element selector.** `injectStyle()`
appends a `<style>` to `<head>`, which is after the game's own `<link>` — so at
equal specificity the library won every tie, and a game could not restyle a
screen without `!important` or a specificity fight. Each rule is therefore
written `body :where(…)`: `:where()` contributes nothing, so the whole sheet
sits at 0-0-1. That single weight is what makes the three cases come out right,
and each of the three is a real game's stylesheet:

| the game's rule | weight | who wins | why it matters |
| --- | --- | --- | --- |
| `.screens-name { … }` | 0-1-0 | the game | it meant this |
| `button { … }` | 0-0-1 | the library, by being later | its page style should not eat the Start button |
| `* { margin: 0 }` | 0-0-0 | the library | a reset is not an opinion about a title screen |

⚠️ **A cascade layer is the wrong tool here, and worse than doing nothing.**
`@layer screens` was the first answer and it shipped for four versions. An
unlayered rule beats a layered one at *any* specificity, and the first line of
a game's stylesheet is almost always `* { margin: 0; padding: 0 }` — under a
layer that reset flattened every margin and padding on the screen, the panel
lost its `margin:auto` and sat squashed against the left edge with no rhythm
between anything. Bare `:where()` was the second answer and is 0-0-0, which
then lost the Start button to the game's own `button { … }`. Both were found in
a browser on asteriskoids; neither was visible in a harness page written
without a reset, which is the lesson worth keeping — **a styling contract is
only tested against a stylesheet that did not expect it.**

The library's variables are the deliberate exception: they are declared at
`:where(:root)`, specificity zero, so a game's own `:root` *replaces* a default
instead of fighting it. ⚠️ The four `LOOK` colours are the other exception —
those are set inline on the screen node and beat a stylesheet, which is right,
because they come from the game's own `config/look.js`. Where `LOOK` names
nothing the default stands and a game can set it from css instead.

**Its default is the studio's form in the game's colour.** The four `LOOK`
names carry the colour; the shapes are the ones `public/style.css` and the
catalog use — the halftone dots, a hairline across the top, a panel card, a
pill button with a glow under it, and every number in a mono face with tabular
figures. The fallbacks are the studio's own four rather than white-on-black,
because most games have not picked colours yet. ⚠️ Gold is policed here as
everywhere: the game-over score, a board score and a chip value, nothing else.

**It carries its own typefaces.** Space Grotesk and Space Mono (OFL 1.1,
`studio/fonts-license.txt`), the latin and latin-ext subsets, as four `.woff2`
files beside the library — about 60 KB in the tree, of which an ASCII page
fetches 41 KB, because the `unicode-range` on each face is Google's own. A
`<link>` to a font host was the alternative and was rejected on the same
grounds as the shared route below: it makes a game that only looks right while
somebody else's server is up. ⚠️ A relative `url()` in an injected `<style>`
resolves against the *document*, not the script, so the paths are derived from
`document.currentScript.src` and a game with a page in a subdirectory still
finds them.

The library also carries **snippets**: pieces of a screen it builds and the
game places. `Screens.board()` is the scoreboard — it calls `/_scores` itself,
marks the rank it is given, and brackets a rank that landed past the shown rows
with the four either side, numbered where they really are rather than from 1.
`Screens.rows()` is a label-and-value list, `Screens.signin()` is who is playing
or the link to the catalog, and `Screens.me()`/`Screens.post()` are the two
calls behind them. `title({ score, post: true, board: true })` is the whole
game-over dance in one line, which is what every game was writing by hand —
asteriskoids' version is where the bracket rule came from, and where the
off-by-four it had (a rank of 11 repeated four rows already shown) was fixed.
Signed out, the post answers 401 and the screen offers the sign-in link instead
of a name box (§6).

The **moments library** (`studio/moments.js`) is the fifth, and the smallest.
`Moments.say("name", value)` validates the name (slug-shaped, ≤ 40) and value
(a number, text ≤ 100, or nothing, which is `true`) and dispatches one
`CustomEvent("moment")` on the window; anything outside the shape is one
console warning per name and is dropped, so saying a moment every frame is
fine. `Moments.on(name, fn)` is sugar over `addEventListener` filtered by name.
The DOM event *is* the bus — the *reporter*, injected before any library loads,
hears every moment without the library existing, and so can anything later
(§8). Publishing is the game's; nothing in this library knows what an
*achievement* is.

The **achievements library** (`studio/achievements.js`) is the sixth. On load
it reads the game's own `ACHIEVEMENTS` (from `config/achievements.js`, loaded
before it), asks `/_achievements/<slug>` once for what this player already
holds, and subscribes to every moment a rule names. When a rule is first met —
or `Achievements.unlock("id")` is called — it posts the unlock and shows a
toast: DOM like Screens, `achievements-` classes, `body :where()` weighting so
the game's own css wins, the game's `primary`/`accent` and ⚠️ never its
`highlight` (gold stays a number). Signed out the toast still shows with a line
about signing in, and stores nothing; a missing file, an unknown id or a dead
network is one console warning, never an error. `Achievements.mine()` is the
`/_achievements` GET for a trophy screen. It **seeds** `config/achievements.js`
(an empty list with the shape commented) the way input seeds `controls.js`, so
every game that holds the library holds the file, and the *sweep* gives an
existing game both new files and the empty seed. ⚠️ The library carries its own
copy of the shape rules, because a classic script cannot import; a test runs
that copy and the server's shared `public/achievement-shape.js` over one list
so the two cannot drift (§16).

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
silent. **Every game is born holding the library**: creation scaffolds it
server-side (`server/files/library.js` reads `public/studio-lib/index.json`,
writes the files under `studio/`, seeds the game's companions, records the
versions) in one commit right after `init`. The sweep below is the same
install pointed at a game that already exists.

**Every game is kept current by the sweep.** An earlier shape of this section
pinned each game to the version it was born with: the per-library install
buttons (`+ Controls`, `+ Sounds`, `+ Sprites`) were deleted as ~150 lines
whose whole subject was games made before the current shape, and updating was
left to hand-edits over cloned repositories. The stated cost — "a bug fixed
in `studio/input.js` today reaches only games made after today, until
somebody sweeps" — came due in practice: the fleet split into generations,
and a helper asked to use a library its game lacked had no file and no API
note to find, because the note rides the manifest. `npm run sweep`
(`bin/sweep.js`), run on the machine holding the games, closes the gap:
every non-archived game gets the libraries it lacks and the current version
of the ones it holds, one readable, revertable commit per game, authored as
the studio (`studio@gamestudio.local` — the reserved-domain trick agent
commits use, so it never reads as a person). Seeds and every other file of
the game's own are never touched, and the `<script>` tags stay the
page-writer's job, named in the agent preamble.

⚠️ What makes the sweep safe is the **compatibility law**: a library version
N+1 must run every game that ran N — a release that cannot keep that promise
is not a version bump, it is a new library under a new name. The escape
hatch is the fleet's size: if the law ever has to break, the games are few
enough to fix by hand, one repo at a time. Two refusals guard the edges: a
manifest holding a version newer than the studio's own is left alone (a
rolled-back studio, not a game to fix), and an archived game is skipped — it
catches up on the first sweep after it is reopened. The manifest is still
what makes drift answerable — `studio/studio.json` says what each game
holds — the sweep is just the thing that reads it fleet-wide.

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
- **It documents itself with an API note.** The comment block at the top of
  `studio/<name>.js` is reproduced in the preamble for each library the game's
  manifest holds — read from the *game's own copy*, so the note matches the
  version the game has, and capped so a note stays a note. Adding a library to
  the studio teaches every helper about it with no orchestrator edit. A game
  that holds no library gets no note and nothing pointed at: there is nothing
  to add from in here.
- **A note closes its surface.** It says its calls are the whole of it, and
  names the things the library deliberately lacks — no init, no unlock, no
  registry. Observed in a real migration trace: what an agent porting
  hand-rolled code goes looking for is the equivalents of what it had, and a
  note that only lists what exists leaves every absence reading as
  uncertainty — the agent re-read the source "to be safe" despite recalling
  the note correctly. Stating the negative space is what makes the note
  authoritative enough not to re-check.

`config/controls.js` is **not** part of the library: it is the game's own
bindings, seeded once from `public/templates/` and never replaced, because it
holds buttons somebody chose. `seeds` in the index is that distinction.

### Game templates

A **game template** is a starter tree: New game offers "Start from", and the
chosen template's files are copied in server-side right after the library
scaffold, as one commit ("start from the quiz template"). From then on they
are the game's own — no version recorded, no update ever offered — unlike a
library, because genre code has to stay editable: "add a timer to my quiz"
must land in files a helper can change, not behind the `studio/` write-wall.
Not a fork either: a fork copies history and attached agents; a template
wants a clean thread and current libraries. `public/game-templates/` is the
source (distinct from `public/templates/`, the seeds); its `index.json`
carries the dialog's words and is the validation list. Every template follows
one shape: its remixable heart in a config file the forms can open, a
pre-written `BRIEF.md` and `SPEC.md` so helpers know the map from the first
fire, the library script tags already in `index.html` so a newborn shows no
Update offers, and placeholder assets the studio's own makers can replace.
Server-side copying is byte-safe, so templates can ship sounds and pictures.

"A blank page" — the dialog's other choice, and its default — used to mean a
blank *directory*, and a game with no `index.html` is nothing the games origin
can serve: the preview and the play link both answered `{"error":"not found"}`
until a helper had written one. It is now one page, committed after the library
scaffold like a template, from `public/game-templates/blank/index.html`. That
page is the one thing under `game-templates/` that is not copied byte for byte
— `{{name}}` becomes the game's name, escaped — and it is deliberately absent
from `index.json`, because the dialog already offers it as the empty choice.
Read from `publicDir` like every other scaffold, so a `public/` without it
writes nothing: that is what keeps the suite's games born empty, and what
leaves "a game with no page" a state still worth testing.

`index.json` also names each template's **heart**: the file the studio opens
the new game on, because a template with an editor of its own is made in that
editor rather than asked for. For the same reason the *starter helper* joins a
template game **not chatty** — present and callable by name, silent until
somebody wants it. A game with no template still gets a chatty one: there, the
first thing typed is the whole point.

The **quiz** template is the first, and it comes with its own editor: a quiz
is a form pretending to be a game. `config/questions.js` holds `QUESTIONS`
(each answer counting toward an ending) and `RESULTS`; when the file still
has that shape, the studio opens it as the **quiz editor** — add and remove
questions, answers and endings, wire each answer to an ending by name, no
code in sight. Ending keys are internal wiring the editor invents
(`ending_4`) and never shows. Unlike the generic form's one-value splicing,
the quiz editor regenerates the whole file with the template's standard
comments — it is the authoring surface for that one file, and opening then
saving the shipped template is byte-identical (tested). A file that outgrows
the shape — extra declarations, weights, code — falls back to the generic
form with a reason, then to the text, and a helper can grow it freely from
there.

The **visual novel** is the second, and the one that says what a template is
for. Its heart is `config/story.js`: `CAST` — who speaks, and their moods —
and `SCENES`, each a picture, an optional sound, and lines said one at a time,
followed by exactly one of three exits: `choices` branch, `go` carries
straight on, neither ends the story. A choice may `set` a switch, and one that
`need`s a switch is only offered once something has set it. It is DOM rather
than a canvas, because a story is mostly text and text wants to wrap on a
phone; it uses the sound and screens libraries and neither input nor sprites.

⚠️ It came before the point-and-click adventure on purpose. The two share
scenes and switches, but an adventure's spots are rectangles on a picture and
agents cannot see pictures (§14) — a visual novel has no coordinates anywhere,
so nothing about it is blocked on eyes. Building it first also settles the
vocabulary the adventure inherits, `set`/`need` on a switch rather than the
`flip` the sketch had.

A visual novel is the first **game type** (§3), and its `config/story.js` is
edited in the **story editor**: an *editor* in the centre pane (the shell,
above) rather than a form in the rail, with TyranoBuilder's three regions
inside one tab. The **scene strip** down the left — every scene with its
problems and its tail (*3 choices* / *→ hall* / *the end*), then the cast —
is the editor's own navigation, which is what lets a type bring several
editors without each wanting a rail tab. For the selected scene, the
**stage** shows what the player sees at the selected **step**, drawn by the
studio from the *unsaved* model — instant, no commit: the scene's picture,
the line's portrait and speaker, the words along the bottom, and on the exit
step the choices, the go or the end (`stageFor` in `story-editor.js`, pure and
tested). Its pictures are object URLs in a cache keyed by path — the
reserved-images pattern, since the file routes send `no-store` — dropped for
the paths a `files.changed` names. Under it the **steps**: the scene as rows
read top to bottom — its name (renaming brings every way in with it), *comes
from* links, *Start here*, *Remove* (disabled while something leads here);
the picture and the sound; one row per line, the selected one open in place
with who, mood and the words, rows dragged into order by a handle or moved
with ▲ ▼; then the exit — the player chooses, go straight on, or the end —
and the scene's problems. A selected person shows their moods and the file
each expects. Typing repaints the stage and the status in place; anything that
changes the shape renders.

Like the quiz editor it regenerates the whole file and is byte-identical on
an untouched save. It still says the five things no single field can: a scene
nothing leads to, a way out pointing at a scene that is gone, a switch nothing
sets, a picture or portrait the game does not have, and a mood the cast does
not have. Explicit **Save**, like every editor here — a save is a commit and a
preview reload, so autosave would be a commit a keystroke — with `if-match`
and a `story-conflict` dialog on a 409. *Show the text* saves first and opens
the file as plain text in the rail, where it is now text and nothing else —
the editor is in the middle, and a form there too would be a second surface
writing the same file — while the tab's body says so and waits. *Try this
scene* saves first, then reloads the preview at the game's own `?scene=` —
the studio only puts the parameter on the iframe's `src`; honouring it is the
template's four lines, and a game that does not ignores it. A story that has
grown past the shape keeps its tab, and the tab's body says why and offers
the text on the right: the type decides the tabs, the file's shape decides
what a tab can show. ⚠️ Unsaved edits are parked per game when the game is
left and put back on return while the file's etag still matches — the
composer's words are the one other thing git cannot recover, and a mis-click
in the sidebar must not cost a scene; a file changed underneath drops them
with a word. ⚠️ A reload after a save keeps the story on screen until the new
one is read: nulling it for the length of a fetch let a render write the
address without its scene as a new history entry, and the reload write it back
as another.

The template **ships empty** — no cast, no scenes — so the first thing an
author meets is the **guide**'s first question, and `js/story.js` treats a
scene with nothing in it as the end, so an empty story shows its title and
then The End rather than a blank stage. The guide is one card at the top of
the scene column asking one thing: who the main character is, how they look,
where the story starts, what that looks like, what happens first, who else is
there, then where each scene leads — and every scene the story points at but
has not filled comes round as its own question, saying how it is reached
(*“Knock” leads to the hall. What does the hall look like?*). **Deterministic**:
`nextQuestion(model, paths, skipped)` in `story-editor.js` reads the next
question off the story and the game's file list, the same facts the checks
read, so the guide needs no state of its own beyond what the author set aside
(*Later*, a set per game in prefs, cleared by *Ask me again*) and works on a
new story, a half-built one and one hand-edited for a week. An ending looks
like a scene without a way out, so *Then what?* is asked once per such scene
and *The story ends here* is the answer that sets it aside. Every answer is an
edit to the model and selects what it changed; Save commits, as always. The
card is built once per question and re-appended by later renders, like a
dialog, so a helper's reply landing does not wipe what is being typed.

A picture is a file, so the guide's four ways to one commit at once: **Draw
it** writes a blank PNG at the path the story expects and opens it in the
rail's pixel editor; **Upload one** takes any picture from this device and
saves it as a PNG at that path; **Make one for me** asks the studio to draw
one (below); and **A plain card for now** is the **plain stand-in** — a flat
card in the game's *look*, the deep colour, a primary border, a round face for
a person, the name in white, drawn on a canvas (128×128 for a face, 480×270
for a place). It costs nothing and never fails, which is what keeps a story
from getting stuck on art, and it is where the drawn one falls back to.

The shape grows two optional keys, `about` on a cast member and on a scene: a
line about them for the studio and its helpers, which the game never reads
and the editor shows as one field on the open person or scene — and on the
picture card, where it doubles as what to draw. Absent keys write nothing, so
a story without them is byte-identical through a save.

#### The two small asks

**Fill it in for me** and **Make one for me** are the studio's own requests to
the model: no helper row, no chat, no message, no receipt, no eligibility, no
cooldown, no tools, no transcript and no file block. One request built from
the story, one answer, nothing kept — `llm.complete()`, thinking off, a small
`max_tokens`. Server-side, because the key never reaches a browser, and
through the same two walls every reply goes through: the studio-wide budget
and the presser's own allowance, charged to whoever pressed (§10). Neither is
a *fire*, so neither leaves a row anywhere but `user_tokens` and
`studio_state`. The UI never says "prompt" or "model"; the buttons keep their
own words.

JSON is asked for in the system prompt and parsed by taking the outermost
braces, not requested through `response_format` — §14 measured what this API
does and that was never one of the things measured, and an unrecognised
parameter fails open there, so the defensive parse would be needed anyway.

⚠️ **The story comes up from the browser, not off the disk.** The guide works
on the unsaved model — the scene it is asking about is usually one made a
moment ago and Save is a commit — so a disk read would be asking about a scene
that is not there yet. It is the author's own words going into a prompt billed
to them, so the trust is theirs either way; what matters is that it is
bounded, and every field is cut to a cap rather than refused (§10). A `who`
the cast does not hold comes back as the story narrating, so a fill cannot
leave a line said by nobody for the checks to flag straight back.

The **drawn stand-in** asks for a flat SVG at the size the kind wants and the
game's own colours. The server checks only that the answer is plainly an SVG
and within 20 KB; the browser probes it in an `<img>` — where an SVG runs no
scripts and loads nothing, the same probe the `.svg` editor paints unsaved
text through (§7) — draws it to a canvas and saves it as the PNG the story
already expects, so the pixel editor opens it like any other picture and
drawing over it is the next thing rather than a fresh start. ⚠️ The probe is
constructed at the size it should be: an SVG carrying only a `viewBox` has no
intrinsic size and left to itself draws as nothing. An answer that will not
draw falls back to the plain card, saying so; a refusal — not yours to change,
out of tokens, no connection — writes nothing and lets its own banner stand.

These are the second and third *microhelper*: a fixed-purpose helper the studio
ships rather than a row somebody makes, the achievements helper being the
first. Smaller than it, too — no tools, one request, JSON back.

The Mila story is the **example**: *Or put in an example story* on the first
card while the story is still empty copies its seven files in from the
**standard set** and writes and saves the story, marking its endings as meant.

#### The standard set

`public/story-art/` — pictures and sounds an author can put into a visual
novel without drawing. Studio-side rather than in the template tree, which is
copied whole into every new game, so a set of any size would bloat every
repository; one file is copied in when it is picked, one commit, no history
and no link back, and a game's repository holds exactly the art it uses.
`index.json` is the whole registry: `art` (file, kind, name, `by`, `licence`,
and `who`/`mood` on a portrait) and `examples`, whole stories the guide can
put in, each naming the art it uses.

The **shelf** is how it is picked: the pictures of the kind the guide's
question wants, in a row across the top of the picture card, before the field
and the buttons — the cheapest answer and the only one that is somebody's
actual drawing. ⚠️ Picking copies the bytes to the path the *story* expects,
not to the set's own landing path, so the set says what a picture looks like
and the story says what it is called: "Mila, worried" becomes
`assets/sprites/ben-normal.png` when that is the face being asked for. The
credit and the licence ride the banner as well as the tooltip. The index is
read once a session and only a good read is held; the shelf is filled in when
it lands rather than through `render()`, because the card is one node kept for
as long as its question stands. A plain `<img src>` is right for these, unlike
a game's own files, whose routes send `no-store`.

Only the guide picks from it, and only pictures: a sound has `+ Make a sound`,
which beats a shelf of stock ones, and an example is the only thing that uses
the set's `sound` kind today. `test/story-art.test.js` is what keeps a growing
set honest — every entry's file present and in the folder its kind lands from,
every licence named, a background 480×270 and a portrait square, a portrait's
file named for its `who` and `mood`, and every example's art listed in `art`
rather than merely present. Finding more of it — CC0 first, kid-safe, small,
one or two styles that sit together, portraits with several moods each — is
the TODO line that outlives this build.

The quiz editor grew the same read, because the authoring bug in a quiz is
never a typo: four endings of which three are unreachable, or one a single
answer feeds.

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

`Duplicate` sits beside it and copies instead of moving: one new file, one
commit, the original untouched. The copy is made server-side from the bytes on
disk — so a picture duplicates without a round trip through the browser, and
unsaved editor text stays where it is, which the dialog says when it applies.
The route refuses an occupied name rather than overwriting, the dialog opens
already holding a free one (`-copy` before the extension, counting up), and a
duplicate landing in `studio/` gets the same sentence a rename there gets.

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
`?tab=versions|scoreboard` — absent means Files, and a `?tab=play` link from
before the Play tab was retired falls back to Files, which is where its
preview is anyway — `?file=<path>` for the open file under Files or the filter
under Versions, and `?version=<sha>` for the changes opened
in the Versions list. The centre pane's surface is there too: `?chat=<id>`
for a conversation other than the one the project opens on, or `?edit=<id>`
for an *editor* with `?scene=<key>` for the story editor's selected scene when
it is not the first — never both, because an editor stands in front of
whichever chat was open, so Back to the chat is the address without `?edit=`.
Switching tab or scene is a navigation and its own entry; selecting a step
inside a scene is not. The client writes it from its own state on every render
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

An open dialog is a decision in progress, and two rules keep it one. The
address is held while it is open, so Back out of unsaved work cannot overwrite
the entry it was going to. And the dialog's node is built once and re-appended
by every later render rather than rebuilt — a background render (a helper's
commit landing, the banner timer firing) used to replace the form and wipe
what was being typed into it. Focus and caret are snapshotted across a render
for a dialog's controls the same way as for the composer.

### Games origin (`GAMES_PORT`)

| method | path | effect |
|---|---|---|
| GET, HEAD | `/` | the catalog: the studio's front door, in its own dark dress — wordmark, halftone, hairline. Published games as cards, names escaped, each wearing its `hero.png` when its tree holds one (§6) under a dark wash and its board's best score in gold; sign-in and ask-to-join for the signed-out, name and sign-out for the signed-in. ⚠️ Sent with `frame-ancestors 'none'` and `COOP: same-origin` (§7) |
| GET | `/_me` | who is signed in, for game code: `{user: {name}}` or `{user: null}`, never an error |
| POST | `/_login` | `{email, password}` → set the `player` cookie, answer `{user: {name}}`. Any account still in, either kind; same lockouts, dummy-hash path and undisclosing 401 as `/api/login` (§11) |
| POST | `/_logout` | delete the player session, clear the cookie |
| POST | `/_signup` | `{name, email, password}` → a `signups` row (§3), rate-limited per IP; answers 202 `{waiting: true}` whether or not it wrote, so the form never says what an address is to this studio |
| GET, HEAD | `/:slug/_studio.html` | the wrapper: the project's `index.html` with the reporter and its commit injected (§8); 404 when there is no `index.html` |
| GET, HEAD | `/:slug/` | `<GAMES_DIR>/<slug>/index.html` |
| GET, HEAD | `/:slug/*path` | that file from the project directory |
| GET, HEAD | `/_scores/:slug` | the game's scoreboard, best first: `{scores: [{name, score}, …]}`, 10 unless `?limit=` asks for up to 100 |
| POST | `/_scores/:slug` | add one entry `{score}` under the signed-in player's own name; 401 with nobody signed in; ten a minute per player; answers 201 `{rank}` — null when it missed the board (§3, §10) |
| GET | `/_achievements/:slug` | what this game defines and what the signed-in player has: `{achievements: [{id, name, how, icon, got}]}` in the file's order, `got` the ISO time they earned it or null — null throughout when nobody is signed in |
| POST | `/_achievements/:slug` | `{id}` → 201 `{new: bool}` when it counts; 401 with nobody signed in; 404 for an id the file does not define; twenty a minute per player (§3, §10) |

The `/_achievements` routes are the origin's **third write** and sit in the
scoreboard's posture: a plain 404 for anything that is not a game's, no cookie
but the player's, every dimension bounded. The definitions are read from the
game's own `config/achievements.js` on every request — parsed, never run, by
the client's own `parseConfigFile` (§16) — so a helper's edit is live at once
and a *fork* carries its achievements with it. The server never sees a
*moment*, only the unlock a rule produced in the browser. Archived games keep
handing them out; a chat is a 404. The earned rows have no route on this origin
— no list, no delete — because earned is forever (§3). The studio side is one
route, `GET /api/projects/:slug/achievements`, which returns each definition
with how many players hold it, for the *achievements editor*.

A game whose `scores_on` switch is off answers the same plain 404 on both
`/_scores` routes: a moderated board is not public in either direction. The
rows are kept — the switch, the admin's list, and per-row deletion all live
on the studio origin under `/api`, because moderation is running the studio.
The studio shows it as the rail's Scoreboard tab.

The underscore routes cannot collide with a game: an underscore is not legal
in a slug. No `/api` surface, no directory index, any other method 405.
Archived projects stay playable — and keep taking scores. `Cache-Control:
no-store` throughout, so iterating on a game shows fresh bytes on reload
without cache-busting.

⚠️ The one cookie this listener reads is its own `player` cookie, backed by
`player_sessions` (§3) — never `session`, which still opens nothing here.
Everything a player token can do, LLM-written game code running in that
player's browser can do silently with it; that is why the authenticated
surface is exactly three routes, and why the biggest of them is "post a
score as yourself" — which is what the game was going to do anyway. The
game files themselves are served to anybody, signed in or not, exactly as
before.

The catalog, the wrapper, and the scoreboard are not the project's own bytes.
`_studio.html` is reserved in every project — a working tree containing a
file of that name has it shadowed and never served.

⚠️ The origin's writes are the scoreboard and the waiting list, each one
bounded table, never a working tree — so a score commits nothing, restarts
no preview, and never enters an agent's context, and a sign-up is a row an
admin has to turn into anything. Both hold the rules a public write needs:
every field capped (§10), a 1 KB `application/json`-only body, and their own
rate limits — per player for a score, per address for a sign-up — in-memory
like the lockouts (§11); `/_login` carries the login lockouts themselves. A
score is keyed by the player because every post has an account behind it
and a household shares one address: siblings on one wifi were sharing one
ration of ten.

"Per address" is only true if the address is. Deployed, everyone arrives from
the reverse proxy, so this listener reads `X-Forwarded-For` under the same
`TRUST_PROXY` flag as the login limiter (§13) and shares its rule: unproxied
the header is ignored, because a client that can name its own address can
name a fresh one per request and never be limited. Unset behind a proxy, the
limits still hold — as one bucket for everybody, so the whole world shares
five sign-up asks in ten minutes and one `/_login` lockout. Scores, keyed by
player, never notice.

⚠️ And an IPv6 address is not a client. Every residential connection holds a
/64 at least, so a limiter keyed on the whole address is stepped around with
a fresh one per request, each a new map entry. `clientIp` folds an IPv6
address to its /64 before anything keys on it — the login lockouts on both
origins and the sign-up limiter — so the household is the bucket. IPv4 stays
whole, the `::ffff:` mapped form included.

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
things bound that today: the games listener has no route that reads the
`session` cookie — the one cookie it reads is its own `player` cookie, which
resolves only `player_sessions` — so a replayed studio session drives nothing
there (tested); `readJson` answers 415 to
any body not declared `application/json` (tested), so a forged `POST` either
carries a CORS-safelisted type like `text/plain` — sent without preflight,
bounced before its handler runs — or declares JSON and needs a preflight the
studio never grants; and every other write method (`PUT`, `PATCH`, `DELETE`)
preflights regardless of its declared type. What a page on another origin can
still drive is `POST /api/logout`, the one `POST` that reads no body — a
forged one costs the operator a sign-in and nothing else. Separate hostnames
in production remove the shared cookie domain that makes even that reachable.

⚠️ Player sign-in put a password form on the origin that serves LLM-written
code, and that is the new edge of this boundary. A game is same-origin with
the catalog, so left alone it could iframe `/` — or script a window it
opened onto it — and read the form as it is typed, and for a studio person
the password typed there is the studio password. Two headers on the catalog
close both hands: `Content-Security-Policy: frame-ancestors 'none'` (the
studio frames games, never the catalog, so nothing legitimate breaks) and
`Cross-Origin-Opener-Policy: same-origin`, which severs the opener handle so
`window.open('/')` from a game hands back a window it cannot touch. What a
game *can* still do is drive the three authenticated routes with its
player's cookie — post a score as them, read their first name at `/_me`,
log them out — which is the accepted floor: a game already speaks for its
player, and the token opens nothing anywhere else. The player cookie is
`HttpOnly`, `SameSite=Lax`, `Secure` in production, `Max-Age` 90 days, like
the studio's but expiring (§11).

⚠️ Nor is the cookie scoped to the game that is open. Every game shares this
origin, so game A can post to game B's board as its player — and no credential
kept in the browser could have been scoped either, since game A could as well
have asked for game B's token. The row names the player, not the game's
author; per-row deletion in the Scoreboard tab is the answer, and the only
real scoping would be an origin per game, a deployment change nobody has
needed (ideas/scoreboard-trust.md).

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
  in a preview iframe. The catalog page alone adds `frame-ancestors 'none'`
  and `COOP: same-origin`, for the password form above.

No CSRF token in v0: the session cookie is `HttpOnly`, `SameSite=Lax`,
`Secure` when `NODE_ENV=production`. The content-type guard above stands in
for it — a token would close the logout residue and nothing else.

## 8. Agent orchestration

### Eligibility

On each human message, the helpers **in that chat** are evaluated — nobody
else's conversation is woken by it. Eligible if `chatty = 1` **or** the body
contains an `@mention` matching the agent's name (case-insensitive). Agent
messages never make agents eligible — bot-to-bot dampening — but agents do see
each other's messages as context.

The human-only chat has no helpers to evaluate, by construction rather than by
a filter here: nothing can be written into `chat_agents` for it. A fire's
transcript, its pins and its history floor are all that chat's, so a helper
sees the conversation it is in and no other.

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
   to keep (below), a section for the game's *type* when it has one — a visual
   novel is told what `config/story.js` is, that the person writes it in the
   "story editor" tab beside the chat, and that a picture is asked for by the
   name the story gives it — and a note that games run on a separate origin so
   absolute URLs back to the studio will not resolve. Fixed per project rather
   than per fire, so it caches like the rest.
2. `BRIEF.md`'s content, if the file exists, cut to `BRIEF_BYTES` with a note
   saying where it was cut.
3. The agent's `description`.
4. The **files**, each emitted exactly once between
   `--- FILE: <path> (<size>) ---` and `--- END FILE ---` markers, least
   recently modified first: the files being worked on sit at the tail, so a
   commit invalidates the cached prefix from the oldest file it touched
   rather than from the top of the block.
5. The **file tree**, last: every path with its size, binary files as
   `[binary: <path>, <size>]` — the agent learns they exist without receiving
   bytes it cannot read — plus the left-out and library lists. A path already
   on disk that §4 validation refuses is listed and marked
   `[cannot be opened: …]`: no tool can touch it and the games origin will not
   serve it, so an agent that could not see it would have no way to explain
   why it 404s at runtime. The tree carries every size, so it changes whenever
   any file does — which is why it trails the contents: at the head of the
   block, where it used to sit, it re-billed every file behind it as a cache
   miss on every commit.

`BRIEF.md` therefore arrives twice: once as item 2, capped, and once in the
file block as an ordinary file. That is deliberate rather than an oversight —
one filename special-cased out of the file block would be a silent omission of
exactly the kind §8 otherwise refuses to make, and a typical brief is 2 KB
duplicated at a 100% cache hit rate.

The final user message carries, in order:

1. The **runtime errors** for the current commit, one per line, omitted
   entirely when there are none (below).
2. A line naming the **pinned files**, omitted when nothing is pinned.
3. The human's message body.

Errors and pins sit here rather than with the files because they change on
every playthrough and on every human turn: in the system prompt they would
invalidate the file block behind them on every fire.

A **pinned file** is a path in the current turn's `context_paths`, or in
either of the previous two human turns'. Pinning is **priority, not
exemption**: pinned files are offered to the byte cap first, then the rest,
each group smallest-first, so the largest files are the ones dropped and the
whole block is bounded by `AMBIENT_BYTES`. Pinning decides selection, never
emission: the block keeps its stable order and the last user message is what
names the pins, because a label inside the block moved with every human turn
and re-billed everything behind it as a cache miss. Content is always read
fresh from disk at fire time, never from the message the human sent. Dropped
files are named in the prompt with a note to call `read_file` — a dropped
*pinned* file is still named as pinned, since it is still what the human is
pointing at.

Earlier chat turns map to OpenAI roles: this agent's own messages become
`assistant`, everyone else's become `user` prefixed with `[Name] `. History is
trimmed oldest-first to fit its budget — and past it, back to half, so the
boundary can then hold still: a seam cut exactly to the cap moved one message
per fire, and the seam line at the transcript's front re-billed the whole
transcript as a cache miss every time. The boundary only advances, held in
memory per project; a restart re-derives it, which costs one fire of misses.
The seam is marked twice — a
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
files.

A file changing is subtler, and was measured separately against the real
space-racer tree (`tmp/probe-order.mjs`, 10 K-token prompts). The cache serves
a partial prefix only back to a **branch point** — a depth where an earlier
request already diverged (§14) — so the *first* edit at a given depth is a
full miss under any ordering. But a working session edits the same files fire
after fire, and with the contents coldest-first and the tree last, that depth
stops moving:

| case | tree first, alphabetical (old) | coldest-first, tree last |
|---|---|---|
| next fire, no file changed | 100% | 100% |
| first edit of the tail file | 0% | 0% |
| second edit of the same file | 0% | 42% |
| third and every later edit | 0% | **94%** |

The old shape diverged at the size-stamped tree a few blocks in, so its branch
point bought almost nothing and an edited fire was a full miss forever. The
62 KB measured is well under `AMBIENT_BYTES`; a 400 KB system prompt has not
been tried.

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
| make or change a picture or a sound | ask for the path by name, and name the button — `Add a file`, and which of its choices: `+ Draw a picture`, `+ Make a sound`, `+ Upload` |
| change a *studio library* | call it, say what needs changing, and load it with its `<script>` tag when writing `index.html` |

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
reply unless the agent's **thinking level** is `none`. It streams as its own
`agent.stream.reasoning` event and renders in a dimmed collapsible block, stuck
to the newest thought: the block is a few lines tall and a trace runs to
hundreds, so left alone it shows the first ten lines for as long as the helper
thinks, which is what made a working nine-minute reply look like a stopped one.
The line under the name counts the thinking — `thinking, 2m 14s` — off the
deltas themselves rather than a timer, so it stops when they do.

Thinking is bounded twice. The level (§14) decides how hard it thinks at all,
and the **thinking cap** stops a turn whose trace runs past
`THINKING_CAP_CHARS` (35,000 — near 10 K tokens at 3.5 characters each, about
90 seconds at the rate measured in §14) with nothing else produced: the stream
is closed, the same turn is asked again with thinking off, and a `'system'`
banner says so. The cap is characters rather than tokens because
`reasoning_tokens` is only reported when the stream ends, by which time the
whole allowance is spent. It is off once the turn produces content or a tool
call, since a trace interleaved with real output is a turn that is working.

The cap sits above the traces `'low'` actually produces (1,597 and 6,886
tokens in §14's runs), so what it mostly catches is a helper left on `'full'`.

⚠️ **`max_tokens` is not the dial to turn here, and lowering it is worse than
leaving it.** The trace is generated before the reply and the tool calls, so a
smaller ceiling rations the *files*, not the thinking: measured at 32,768, one
run spent 25,004 on reasoning and had its fifth `write_file` cut off
mid-arguments, committing a game with a file missing, where the same prompt at
65,536 finished all eight cleanly (§14). A capped trace is a visible failure
with a banner on it; a truncated tool call is a silent one.

The abandoned attempt does not count as a turn but **is** charged, from
`tokensForChars` over the trace the stream watched go past. No usage frame
arrives for a stream nobody let finish, so there is nothing exact to bill;
the tokens were generated and the key is paying for them regardless. Only the
trace is estimated — the prompt behind it was billed too and there is no count
to put on it — so the studio still undercounts a capped turn, by less.

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
list is broadcast as `game.errors` and painted into the panel under the preview
**without a re-render**: rebuilding the tree rebuilds the preview iframe, which
restarts the game, which reports its problems again — a loop that does not
settle. This is the same reason a streaming reply mutates its nodes. The panel
is rendered whether or not the preview is folded away, because problems from
before it was folded are still the answer to why the game is broken.

The same reporter also forwards the game's **moments** — what `Moments.say()`
dispatches on the window (§4, *moments library*). It listens for the `moment`
event, so it hears every one without knowing the library exists, and posts the
latest value per name a few times a second, at most fifty names a batch. The
studio keeps them per game for the session and paints a chip per name under the
problems panel — **in place, never through `render()`**, for the same reason the
problems are: a moment said at startup, drawn through a render, would rebuild
the frame, restart the game and say it again. The point of showing them is the
*achievements editor*, which offers the names the game has been seen to say. A
moment reaches the studio page only; it never reaches an agent's context (a
score is the model — talk about the work, not the work), and the games origin
never sees one, only the unlock a rule made of it (§3, §6).

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

The HTTP client's timeout is an **idle guard**, re-armed every time bytes
arrive, not a deadline on the whole request: it fires only when nothing has
arrived for two minutes, and surfaces as an `LlmError` naming the stall. It
used to be a hard ten-minute ceiling, which is exactly how long a healthy
big turn — a full reasoning trace plus several files — can stream, so it
aborted real replies mid-flight. Between chunks the gap is sub-second, and
the longest legitimate silence is prompt processing before the first token,
seconds even on a full cache miss. It is re-armed by **bytes**, not by
content, which is only safe because the stream carries no keep-alive frames —
measured, since a single comment frame every few seconds would hold the guard
open for ever (§14).

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

A stream that dies mid-fire — the connection dropped, the request aborted —
is salvaged rather than discarded. Whatever was said up to the failure is
persisted as the message, files already written are committed and credited
to it, and a `'system'` banner says the helper was cut off. No automatic
continuation: retrying a dead upstream can loop on the failure, so carrying
on is the human's call. Only a fire with nothing said and nothing written
ends as a bare `agent.stream.end {error: true}` with no message row — and
when a row lands, the end event carries its id and no error flag, because
the client treats an error after `message.new` as a fresh live entry that
nothing would ever clear.

⚠️ **A fault that is not the stream ends the fire the same way.** A fire is
called from a timer and its caller can only print, so anything thrown between
the start event and the end event — a git commit that cannot take the lock, a
database that will not write, a full disk — used to end as a console line with
the browser still saying "Thinking…" for ever: the start event had gone out
and nothing was ever going to answer it. None of those are the stream failing,
so none of them reached the salvage path above. A `catch` around the whole
fire now emits `agent.stream.end {error: true}` — but only if a start event
went out, since an error end with nothing live *creates* the ghost entry the
paragraph above is about — and then posts a `'system'` banner. The end event
goes first, because it is the part that cannot fail while the database is a
candidate for what just broke.

The other silence it closes: a fire that ends cleanly having produced no
prose, no files and no limit — the model simply said nothing — used to emit a
bare end event that took the live entry away and left no word behind. It gets
a `'system'` banner too. Nothing an agent does should be able to remove the
row without replacing it with a sentence.

A long chain **sheds** its reasoning pile. DeepSeek re-attaches everything it
has said in the current tool-call chain — reasoning included — to every
continuation, billed as cached input (§14), so a marathon fire pays a tenth
of an ever-growing pile on each request. When another round is coming and
carrying the pile a few more rounds (`SHED_HORIZON_ROUNDS`) would cost more
than re-paying the visible tail once, the loop appends a one-line `[studio]`
housekeeping note as a user turn — the same shape as the cut notice — which
closes the chain and drops the pile from billing. Both sides of the rule are
runtime-visible: the pile from `reasoning_tokens` per request, the shed's
price from the bytes appended since the last one. A floor
(`SHED_FLOOR_TOKENS`, 8k) keeps short fires from ever shedding. The note is
never persisted, and the receipt counts the sheds.

Every persisted reply also leaves a **receipt** (`message_receipts`, §3):
the context half is captured in `buildContext` — bytes per system-prompt part,
files sent whole and left out, transcript size and trim — and the fire adds
per-request usage (cache hit, miss, output, one entry per turn) and the loop's
appended bytes. The prompt itself is captured at the top of each turn, before
the request is made, so what is stored is exactly what the last request
carried — the loop appends tool results it may never send. It is rendered as
labelled plain text, not the JSON body, and no reasoning trace is in it,
because a trace is never in a request to begin with. The UI opens all of this
from the token note under the bubble; cached tokens are shown counting a
tenth, so the lines visibly sum to the note.

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
| `message.new` | full message: `{id, project_slug, user_id, user_name, agent_id, kind, body, created_at, tokens, trimmed, context_paths, writes, reactions}` |
| `message.reaction` | `{project_slug, chat_id, message_id, user_id, user_name, emoji, action: 'add'\|'remove'}` — a delta, applied by the same idempotent merge as the reacting tab's own optimistic click |
| `agent.stream.start` | `{project_slug, agent_id}` |
| `agent.stream.reasoning` | `{project_slug, agent_id, delta}` — reasoning trace, rendered dimmed and collapsible, never persisted |
| `agent.stream.chunk` | `{project_slug, agent_id, delta}` — reply text |
| `agent.tool` | `{project_slug, agent_id, tool, path}` — drives a live "writing game.js…" indicator |
| `agent.stream.end` | `{project_slug, agent_id, message_id?, error?}` |
| `chats.changed` | `{project_slug}` — a chat was added or renamed; the client refetches the list rather than being sent it |
| `files.changed` | `{project_slug, paths: string[]}` — client refreshes the tree and reloads the preview iframe |
| `game.errors` | `{project_slug, errors: [{id, message, location, times, at}]}` — the whole current list, not a delta |

`files.changed` is what makes the studio feel live: an agent writes a file and
the game in your preview pane reloads.

A streaming reply exists nowhere but the tabs watching the stream until the
fire ends, so the client buffers it **per game** and never clears a buffer on
a project switch: an event for a game that is not on screen still lands in
its buffer and paints nothing, and switching back mid-fire shows everything
said so far. A reload is still a loss — the server has nothing to replay —
and a reasoning trace is never persisted at all (§8).

## 10. Limits

**Two token walls.** The studio-wide daily budget is the outer one and stops a
runaway loop draining the API key, whoever set it off; a person's
`daily_tokens` is the inner one, so one person cannot spend everybody's day.
Both are set in the admin panel; the studio-wide one falls back to the built-in
5,000,000 when nothing has been set.

Within a tenth of your allowance, the line under the newest reply says so —
in the same grey line that already says what that reply cost, and in gold,
which is what a number worth looking at is coloured everywhere else. It is
drawn from `/api/me` alone, re-read after a reply that could have moved it, so
it is your own day and never anybody else's: no message carries an allowance,
and a thread cannot leak one.

A reply is billed to **whoever asked for it**: the newest human message in that
chat when the fire started. An agent has no owner to bill, and the person whose
turn it is is the one who wanted the answer — a continuation goes on the same
person's day, because it is the rest of their answer. Out of allowance, their
helpers answer with a `[studio]` note naming them and the studio carries on for
everybody else.

- Message body: 32 KB (utf-8 bytes).
- Reaction emoji: 32 bytes (utf-8), no codepoint validation — a ZWJ sequence
  and a `:shortcode:` string are both accepted, equality is bytewise. The
  client offers a fixed set of twenty and renders with `textContent`, so a
  forged string is inert and no worse than a message body.
- JSON request body: 64 KB. Raw file `PUT` body: 10 MB.
- Email: 254 chars. Display name: 100. Project name: 200. Slug: 40.
- Agent name: 100. Agent description: 8 KB.
- Project path: 200 chars, 8 segments.
- Files per project: 500. Bytes per project: 200 MB.
- Chats per game: 20. Agents attached per chat: 10 — a helper belongs to a
  chat, not to a game, so both caps are per conversation.
- Runtime errors: 20 per project, 20 per report, 500 chars of message and 200
  of location each; 20 distinct problems per page load in the reporter itself.
- Agent cooldown: 5 s per `(chat, agent)` — it lives on `chat_agents`.
- Agent fire: ≤ 24 assistant turns, ≤ 40 tool calls, ≤ 512 KB of messages
  appended by the tool loop, ≤ 3 continuations per human message (§8).
- Context sent per fire: ~700 KB of text before the tool loop and ~1.2 MB with
  it, all of it bounded (§8), against a 1,048,576-token model ceiling.
- Brief injected into the system prompt: 32 KB, cut with a note (§8).
- Output per request: `max_tokens = 65536`, which is the model ceiling — a
  lower cap rations the reasoning trace, not the files (§8, §14).
- Studio token budget: `DAILY_TOKEN_BUDGET`, default 5,000,000 per UTC day.
- Login lockout: per email 10 failures / 5 min → 5 min lock; per IP 20
  failures / 5 min → 10 min lock. In-memory, resets on restart. The games
  origin's `/_login` carries its own pair with the same numbers.
- Wherever an address is a key, an IPv6 address counts as its /64 (§6).
- Scoreboard: score a JS-safe integer, the name the account's squeezed to
  24 chars, best 100 rows kept per game, `?limit=` ≤ 100, body 1 KB; posts
  10 / min / player, in-memory like the lockouts; a post a full board
  already outranks is never written.
- Achievements: `config/achievements.js` read only up to 64 KB; per entry
  id ≤ 40 (slug), name ≤ 60, `how` ≤ 200, icon ≤ 32 bytes (the reaction cap),
  ≤ 50 entries; an entry outside the shape is skipped, not refused. Unlocks
  20 / min / player, body 1 KB, in-memory like the scoreboard's.
- The story's two small asks (§6): sentence and `about` ≤ 500 chars, a cast
  member's `about` ≤ 200 and their name ≤ 100, ≤ 20 of them, the last ≤ 40
  lines of the scene at ≤ 500 chars each, ≤ 4 colours each matching a plain
  colour pattern. Back: ≤ 12 lines at ≤ 500 chars, or ≤ 20 KB of SVG.
  `max_tokens` 1024 for a fill and 2048 for a picture. Everything sent is cut
  to its cap rather than refused; everything back past one is dropped. **No
  rate limit of their own** — the two token walls are the walls, and the
  button goes quiet while an ask is out.
- Sign-up: 5 / 10 min / IP; name ≤ 100 chars and control-free, password
  6–200 chars, email ≤ 254; body 1 KB, as is `/_login`'s.
- Player sessions: 90 days, cookie `Max-Age` and row age both.

## 11. Auth details

- Passwords: `scrypt` (`node:crypto`), 16-byte salt, N=16384, r=8, p=1,
  64-byte key, stored as `scrypt$<N>$<r>$<p>$<salt_b64>$<key_b64>`.
- Sessions: 32 random bytes base64url in a `session` cookie — `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Secure` iff `NODE_ENV=production`, no `Max-Age`.
- Player sessions: the same shape in a `player` cookie on the games origin,
  with a 90-day `Max-Age` and a matching row-age check (§3). The two never
  cross: each origin resolves only its own table, so neither token is worth
  anything to the other side.
- The waiting list: `POST /_signup` validates and hashes up front, writes a
  `signups` row, and answers the same 202 whether or not it wrote — a public
  form does not disclose what an address is to this studio. Approval and
  refusal are admin routes on the studio origin (§6); approval makes a
  player account with the password chosen at sign-up.
- Constant-time login: an unknown email is still verified against a cached
  dummy hash so timing doesn't disclose existence.
- Account creation: `npm run adduser -- <email> "<Display Name>"` prompts for
  a password on stdin with echo off, and the admin panel does the same thing
  from a browser.
- ⚠️ Account **removal** is a terminal job and only a terminal job — no route,
  no button. `npm run deluser -- <email>` sets `users.deleted = 1` and drops
  their sessions, never a DELETE (§3); `npm run restoreuser -- <email>` puts
  them back, and with no email it lists who is out. `deluser` refuses the last
  admin, the same wall the panel keeps against demoting one. The asymmetry is
  the point: adding somebody is an everyday thing, taking somebody out is not,
  and a red button beside Save invites a press that a `cd` and a command
  do not.
- A removed account takes the unknown-email path at login: the same 401, the
  same dummy-hash derivation, so the form does not say who was taken out. A
  player account takes it at the *studio* door for the same reason — which
  kind of account an address carries is not the form's to say. On the games
  origin both kinds sign in, and a removed account neither.

### Who may change what

The studio has exactly one role: `users.admin`, which is about running the
studio — accounts, names, passwords, allowances, the studio-wide budget — and
nothing about games. An admin has no more right to somebody's game than
anybody else; authorship is a separate question with a separate answer.

**Studio access** — `users.studio_access`, which every account had implicitly
before the bit existed — gets you into the studio and lets you **read** all
of it: every game, every version, every conversation, every file. That is
deliberate — the studio's people are a handful who know each other, and a
studio where you cannot see how somebody's game works is not a studio. A
player account has none of that: it is a name on scoreboards and a games-
origin login, and inside the studio it exists only as a row in the admin
panel, where the toggle can make it either kind.

**Changing** a game takes being one of its **authors** — the person who made
it, plus anyone an author has added — or the game being **open**, which its
authors set when they want the whole studio in it. `canEdit` in
`server/authors.js` is the whole rule, and `requireProject({ write: true })`
in `routes/helpers.js` is the one place it is applied: a route says it writes,
and saying so is what makes it refuse. A route that means to be an exception
says `anyone: true` and takes the check itself.

Two exceptions, both on purpose:

- ⚠️ **The human-only chat of every game is everyone's.** Anyone in the studio
  may post in it, whoever's game it is. Talking to the people here is not
  editing their game, and a game you can see but cannot say a word about is a
  strange thing to be able to see. Every other chat takes the game's own rule.
- ⚠️ **The author list is authors-only, even when the game is open.** Open
  means anybody may work on it, not that anybody may decide who does — so
  `POST /authors`, `DELETE /authors/:id` and `POST /open` all require
  authorship rather than editability. Without that, "open" would be a door
  anybody could lock behind them.

**Forking is not editing.** A copy takes nothing from the original, so anyone
who can read a game can copy it; the copy belongs to whoever made it, and is
not open even if the original was.

The client mirrors the rule rather than enforcing it: `frozen()` in `main.js`
is `archived || !can_edit`, and every control that was disabled for an
archived game is disabled for somebody else's. The server is what refuses.

### Accepted security tradeoffs (v0)

- **No CSRF token.** `SameSite=Lax` plus the `readJson` content-type guard
  (§7), which bounds a cross-site forgery to `POST /api/logout`.
- **Lockout state is in-memory.** A restart clears all lockouts.
- **Studio sessions never expire.** No `Max-Age`, no rotation: a session
  lasts until a removal, a password change, or the studio-access toggle
  deletes its row, or the browser loses the cookie. Expiry and rotation are
  deferred to v1 (§15) and belong to the same gate as the rest of this list.
  Player sessions are the exception, 90 days, because their door is public.
- **No rate limiting outside login, the scoreboard and the sign-up.** An
  authenticated user can flood message posts and file writes on a game they
  may change; bounded only by the token budget and size caps. The trust
  boundary here is the account list, which the operator and the admins
  control by hand — the waiting list widens who can *ask*, never who gets
  in. The public writes are rate limited because their writers are the
  public, not the account list (§6, §10).
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
- The games listener never reads the `session` cookie — the `player` cookie
  is the only one, it resolves only `player_sessions`, and neither origin's
  token means anything to the other. It serves nothing but a project's own
  files, the catalog, the wrapper — that project's own `index.html` with a
  script in front of it — and the scoreboard and achievements; its writes are
  scoreboard, personal-best, achievement and waiting-list rows: bounded
  tables, never a working tree. ⚠️
- An `achievements` row is never deleted by any route, and the definitions
  behind it live only in the game's `config/achievements.js`, read per request
  and never in a table: removing a definition hides its rows, it does not drop
  them. ⚠️
- A `signups` row is never an account and never deleted: only an admin's
  approval makes the account, with game access only, and a decision is
  columns on the row. ⚠️
- No HTTP response reports a successful file mutation before its git commit
  has landed.
- At most one write+commit runs at a time per project.
- Taking somebody out of the studio deletes no row. Their sessions go — both
  kinds — and `users.deleted` is set; every path that grants access minds
  that bit, and every rendered name does not, so the removal is undone by
  clearing it. `studio_access` is read on the same access-only line. ⚠️
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
| `TRUST_PROXY` | unset | set to `1` behind a reverse proxy so the login lockouts and the sign-up limiter see real client addresses instead of the proxy's |

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
That reading is what kept this app on a per-agent boolean for as long as it
was; the tool measurements below overturned it, and the setting is now a
three-way **thinking level** (`full`, `low`, `none`).

In streaming, `delta.reasoning_content` arrives interleaved and ahead of
`delta.content`. `completion_tokens_details.reasoning_tokens` reports the cost.

Re-measured on a *heavy* prompt on 2026-08-31 (`tmp/probe-keepalive.mjs`,
`tmp/probe-thinking.mjs`), because the trivial-prompt numbers above turned out
to describe noise rather than the case that matters:

- **The stream carries no comment frames.** Zero non-`data:` lines in a
  45-second, 1.3 MB stream, and the longest gap between reads was 439 ms. The
  idle guard below therefore cannot be held open by a keep-alive, and a
  two-minute silence really is a dead stream. This was a guess until now.
- **Reasoning streams at ~90 tokens/s, ~320 bytes of SSE per token.** At the
  65,536 ceiling that is **~12 minutes and ~20 MB** for one turn's trace, all
  of which the studio re-broadcasts to every connected tab, one frame per
  delta (§9).
- **The whole allowance can go to the trace.** 4096 of 4096 completion tokens
  were reasoning, no content, no tool call, `finish_reason: 'length'`. So a
  helper that "thought too long and did nothing" has not timed out and has not
  faulted: it reached the output ceiling while still thinking. The
  `hitLength && changed.length === 0` banner (§8) is the only thing that says
  so.
- **Still no ladder in the middle.** With no tools in play: baseline 1316
  reasoning tokens, `'minimal'` 692, `'low'` 482, `'medium'` 3643, `'high'`
  675 — one sample each, and the spread between neighbours is larger than any
  trend. But that is not the same question as whether the *ends* matter; see
  the tool measurements below, where they matter more than anything else on
  this page. `'none'` is a real zero.
- **A reasoning budget parameter remains unmeasured**, not disproven.
  `thinking: {budget_tokens}`, `max_reasoning_tokens` and
  `reasoning_max_tokens` each produced a trace within run-to-run variance of
  the baseline at n=1, and unknown parameters are ignored silently, so nothing
  can be concluded either way from that.

### ⚠️ Thinking against tools: the cliff

The measurement this studio most needed and did not have. The studio's own
preamble, its file tools, and one ambitious open request — *"Build me a tank
game. Two players, split screen, destructible walls, power-ups."* — against
`deepseek-v4-flash` (`tmp/probe-do-more.mjs`, `tmp/probe-tools-effort.mjs`,
2026-08-31):

| effort | `max_tokens` | runs | reasoning / output | tool calls | first call at | wall |
| --- | --- | --- | --- | --- | --- | --- |
| default | 8192 | 4 of 4 | 8192 / 8192 | **0** | never | 59–91 s |
| default | 16384 | 4 of 5 | 16384 / 16384 | **0** | never | 114–131 s |
| default | 16384 | 1 of 5 | 13679 / 16321 | 6 | 67 s | 82 s |
| `'low'` | 8192 | 1 of 2 | 6886 / 8192 | 3 | 56 s | 62 s |
| `'low'` | 8192 | 1 of 2 | 1597 / 3185 | 3 | 16 s | 24 s |
| `'none'` | 8192 | 1 of 1 | 0 / 803 | 2 | 1 s | 7 s |

Two findings, and the first one is the important one:

**⚠️ At the default effort the trace expands to fill whatever it is given, and
produces nothing when it does.** Nine runs at the default: 8192 became 8192 of
reasoning, 16384 became 16384, and **one run in nine** stopped thinking (at
13679) and wrote its six files. The appetite is not a fixed size the budget
either covers or does not — raising `max_tokens` mostly buys a longer silence,
which is why the studio's 65536 is no protection and is the setting this
failure happened under. There is no partial credit either: a run that does not
finish thinking writes no file, says no word and calls no tool, so the failure
is a cliff rather than a slope. From the outside it cannot be told from a hang
— at the 90–125 tokens/s measured here, a full 65536 of thinking is **nine to
twelve silent minutes** ending in an empty reply. That is what "the helper
thought too long and did nothing" is, and no timeout is involved.

**`reasoning_effort` is the lever, and the trivial-prompt measurement above
hid it.** At the same 8192 where the default wrote nothing, `'low'` wrote three
files on both runs, and `'none'` wrote two in seven seconds for 803 output
tokens. Between default and `'low'` the difference is not a rung on a ladder;
it is files against nothing. The run-to-run spread inside `'low'` is still
wide (6886 and 1597), so it bounds the thinking loosely, not tightly.

**The prompt is not the lever.** A rule added to the preamble telling it to
write its plan into `TODO.md` rather than hold it — that its thinking is
discarded and re-billed while a file is kept and cached, and that a turn
producing no file produced nothing — changed nothing at either budget: four
runs, zero tool calls, same as the preamble without it. The self-note strategy
it was pointing at already exists (`TODO.md` is in the preamble, and a
continuation rebuilds context from disk), and it is not what is missing. The
model does not decline to write its plan down; it never reaches the point of
writing anything at all.

A caveat kept deliberately: these arms were scored on whether tool calls came
out, not on whether the game was any good. `'none'` wrote the fewest bytes of
the three that acted, and how much prose each wrote was not measured. `'low'`
has two runs behind it and `'none'` one, against nine at the default — enough
to show the direction, not enough to size it.

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

Partial prefixes are served only back to a **branch point**: a depth at which
an earlier request already diverged. A request that diverges at a *new* depth
reports zero hits however long its shared prefix is — and that miss is what
creates the branch the requests after it hit on. Measured in
`tmp/probe-order.mjs` (2026-08-23): the first edit of a file deep in a
10 K-token system prompt scored 0%, the second 42%, the third and fourth 94%,
in 64-token blocks; a pure extension of a previous request (history appended,
nothing changed) always scored ~100%. Spacing the requests 20 s apart measured
identically to back-to-back, so this is structure, not write latency. §8's
file-block ordering exists because of this: the win is not the first fire
after an edit, it is every fire after that one, provided the divergence depth
holds still.

Within one tool-call chain, the model's own output — the **reasoning trace
included** — is re-attached server-side to the next request's prompt and
billed as input, even though the client never sends it back: a continuation's
prompt grows by the previous request's `completion_tokens`, not by the bytes
the client appended (measured in `tmp/probe-reasoning-replay.mjs`,
2026-08-28, and visible in any multi-request receipt). It **accumulates** —
every earlier round's trace stays in the prompt until the chain closes — and
rides the prefix cache at a tenth, so a long fire pays a tenth of an
ever-growing pile on every request: roughly quadratic in the round count. A
`role: 'user'` message **closes the chain and sheds the whole pile** from
billing (measured: the prompt shrank by the accumulated trace), at the price
of the branch point moving — the loop's tail re-pays once. §8's invariant
that a trace is never replayed is about the client and still holds: nothing
stores or sends one; this is the API's own accounting.

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
- Viewer counts, web push, unread markers (all exist in `new-y`; message
  reactions are built now, §3). Typing previews are **not** here — they are
  permanently out (§2).
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
- A real in-browser code editor: line numbers, auto-indent, bracket matching.
  The editor is still a plain `<textarea>` — the dependency-free syntax
  colours behind it (§6) are the highlighting half of this item, done.
- Asset pipeline: sprite sheets, audio conversion, minification.
- Cross-project agent memory.
- `git push` to a remote so a game can be published elsewhere.

## 16. Shape of the implementation

Zero runtime dependencies: `node:http`, `node:sqlite`, `node:crypto`,
`node:child_process` for git. No build step, no framework, no `npm install`.

```
server/
  index.js        boot: env, db, two listeners
  app.js          createApp({db, broker, llm, gamesDir, ...}) -> handler
  games.js        createGamesApp({db, gamesDir}) -> handler
  catalog.js      the games origin's front door, server-rendered whole (§6)
  db.js           MIGRATIONS array + addColumnIfMissing + tx()
  auth.js         scrypt, studio sessions, requireAuth, remove/restore account
  players.js      the player cookie, player_sessions, the waiting list
  authors.js      who may change a game: canEdit, requireAuthor (§11)
  chats.js        a conversation inside a project; requireChat,
                  assertBotsAllowed, and the per-chat caps
  mentions.js     one rule resolves a helper's name and a person's (§8)
  starter.js      the starter helper that joins a new game's Building chat
  broker.js       SSE fan-out to every tab
  budget.js       studio-wide daily counter
  http/
    router.js     method + :param/*wildcard matching
    body.js       JSON and raw body readers with caps
    static.js     extension mime table, traversal-safe serve
    respond.js    HttpError, and the JSON refusal the router turns it into
    origin.js     play and preview links derived per request from Host (§7)
  util/
    html.js       escaping shared by the catalog and the blank start page
    text.js       codepoint ranges rather than a regex, so no invisible bytes
    time.js       the next UTC midnight, for the budget's lazy rollover
  reporter.js     the injected script, and the wrapper it goes into (§8)
  runtime.js      what the running game reported, per project
  scores.js       the scoreboard: top, submit, the shared rate limiter
  achievements.js the earned rows, and the defs read from config/achievements.js
                  through public/config-file.js — ⚠️ the first server import from
                  public/. parseConfigFile is pure (no eval), and the shape it
                  reads with, public/achievement-shape.js, is the same module the
                  achievements editor uses, so the games origin and the form
                  cannot disagree about which entries are valid.
  story.js        the two small asks (§6): the fill's and the stand-in's tiny
                  prompts, the two walls around each, and the charge. Not a
                  fire — nothing here writes a row but user_tokens.
  files/
    paths.js      project-path validation (§4)
    tree.js       recursive listing, caps
    git.js        per-project repo: init, commit, log, show, diff, mv
    mutex.js      per-project serialization
    library.js    the studio library scaffolded into a tree, and the sweep (§4)
    templates.js  a game template's starter tree, copied in at creation (§4)
  llm/
    deepseek.js   SSE -> {delta|reasoning|tool_use|end} iterator, and
                  complete() for one whole answer with no stream at all
    tools.js      the four file tools
  agents/
    orchestrator.js  dirty bit, cooldown, tool loop, context builder
  routes/         auth, admin, projects, agents, chats, messages, achievements,
                  errors, files, history, story, helpers, stream
public/
  index.html      shell
  main.js         the SPA's core: state, transport, URL, stream, the file,
                  drawing and history actions, and render() (§17)
  dom.js          h(), and the icon buttons
  sidebar.js  chat.js  versions.js  config-form.js  sound-form.js
  dialogs.js  upload.js  achievements-form.js  quiz-form.js  story-form.js
  story-guide.js
                  one pane or feature each, importing the core from main.js
  game-types.js   which editors a game's type puts in the centre pane (§6)
  config-file.js  patch.js  pixel-editor.js  sound-maker.js  highlight.js
  achievements-editor.js  achievement-shape.js  quiz-editor.js  story-editor.js
                  pure logic, shared with npm test (achievement-shape.js also
                  imported by the server, above)
  studio-lib/     the studio library's source: index.json, and a directory per
                  library — copied into a game, never served to one (§4)
  templates/      a library's seeds: config/controls.js per control scheme,
                  config/achievements.js — written once, never replaced (§4)
  game-templates/ a starter tree per template, plus the blank start page (§4)
  story-art/      the standard set the example story copies in (§4)
  style.css
bin/
  adduser.js  deluser.js  restoreuser.js  backup.js  sweep.js  smoke.js
  prompt.js
test/
```

Email, web push, typing previews and unread counts (all present in `new-y`)
are absent on purpose — the first three permanently, the last deferred
(§2, §15).

Tests use `node:test` against `:memory:` SQLite, a temp `GAMES_DIR`, and a
scripted fake LLM client, so the suite needs no network and no API key. The
one place a live key is required is a manual smoke script, kept out of
`npm test`.

## 17. The client

One page, no framework, no build step. `render()` builds the whole tree from
`S` and replaces it. Everything below follows from that one sentence, and
every rule here was found by breaking it.

### What a render destroys

A render throws away every node, so anything the browser was keeping on one
is gone unless it is snapshotted and put back.

- **The caret and the text of whatever is being typed in.** `focusSnapshot`
  holds the composer, the file editor and the sidebar's filter box; the box
  loses its second character without that, because every keystroke
  re-renders the pane it is in.
- **Every scroller's position.** A `.scroll` container needs a `data-scroll`
  name or it jumps to the top on the next render.
- **The open dialog**, which is built once and re-appended as the same node,
  never rebuilt mid-decision — a background render used to wipe what was
  being typed into it. ⚠️
- **The preview iframe**, which is rebuilt and so restarts the game, which
  reports again. The problems panel and the moments panel are therefore
  painted in place, never through `render()`, or a report renders a report. ⚠️

Streamed text is painted at most once per animation frame (`paintSoon`),
never per delta: repainting the box and forcing a reflow ~90 times a second
grows with the trace and froze the page right at the thinking cap. The trace
panel sticks to the newest thought unless the reader has scrolled up, and the
elapsed line (`thinking, 2m 14s`) counts off the deltas themselves, not a
timer. Checked at 87,000 characters of trace.

### The URL is the view

`?tab=`, `?file=`, `?version=`, `?chat=`, `?edit=` and `?scene=` carry what
you are looking at, so a link sends it and a reload comes back to it. Written
by `render()`, read by the same code on load and on Back. The server never
looks at the query.

Every view is its own entry, so Back closes a file; inside one game it does
that without refetching the project. Three modes:

| mode | when |
|---|---|
| push | the default: a view the reader navigated to |
| replace | following an address that already exists, and background events — a helper's commit landing is not somewhere anybody went |
| hold | a decision in progress, and multi-step navigation |

⚠️ **The mode is held only for the duration of an `await`, so every render a
followed URL causes has to happen inside that await.** A render that lands
afterwards writes the wrong address as a new entry. Concretely: an `onclick`
that opens something must return its promise all the way up — `closeOpenFile`
firing `openFile` without returning it is what made Back toggle between the
last two files instead of walking back through them, and `pickTab` returns
its promise to the `onclick` for the same reason.

⚠️ The same rule the other way round: **anything that reaches a view in more
than one step wraps them in `urlAs('hold', …)`**, or each step leaves an entry
behind. Three places do it — `All files changed (n)`, the Versions tab, and a
file chip under a reply — and each ends with `loadDiff(sha, {goTo: true})` so
the row it opened is the row you are looking at.

The address is also held while a dialog is open: that is what stops a Back
out of unsaved work from overwriting the entry it was going to. ⚠️ And it is
never written while signed out, or a deep link would be gone by the time the
sign-in form was answered.

Remembering a chat needs both halves. `openProject` resolves it — `view.chat`,
else `prefs('chat-<slug>')`, else the project's front door — and then **names
it to `applyView`**, which reads a missing chat as "the one the project opens
on". Without that the game appeared in the conversation you left it in and
switched itself to `Humans only` a beat later. Back and Forward still reset,
because there a missing `?chat=` is the address talking. `openProject`'s own
`applyView` passes `scene: undefined` rather than null, so a sidebar click
leaves parked story edits where the reader was while a followed address
resets to the first scene.

### Overlapping work

⚠️ Opening a file is several awaits long — bytes, then for a picture a decode
and the palette, for a sound a second read — so clicks overlap. `openFile`
takes a token and every step after an await drops its result if a newer open
has started; `startDrawing` and `startSound` belong to the open that called
them. Without that, two clicks in the list left whichever request finished
last on screen, which is how one picture ended up under another one's name.

### Transport

⚠️ Nothing calls `fetch` directly. `send()` does, and answers with status 0
instead of throwing when there is no connection, so every `if (!res.ok)`
already written covers a dead network. A failed request also sets
`S.connected = false`, which paints a pill at the top of the window until the
**stream** reopens — the SSE is the only thing holding a connection open, so
it is what says whether there is one. A banner would have timed out and left
somebody typing into a studio that could not hear them. Without it a dropped
connection looked like a picture pane blank with nothing said, a click that
did nothing, and a message wiped out of the composer.

The composer is emptied on send but the words come back if the send fails —
into the box if it is still empty and still that game, otherwise into that
game's draft, never over anything newer. Nothing else in the studio holds
something git cannot recover.

### Panes

- `MEDIA_KINDS` in `main.js` is the one list to extend when the studio should
  show a new kind of file.
- The preview reloads itself: every commit bumps `previewNonce`, which is in
  the iframe's `src`, so a helper's write, a save or an upload all restart the
  game. There is no Reload button.
- ⚠️ The three reserved images are held as object URLs replaced on
  `files.changed`, never as a `src` pointed at the file routes — those send
  `no-store`, and a background rebuilt by every render would refetch on every
  keystroke. `has_icon` on the project list keeps the sidebar from probing
  every game for an icon it does not have.
- ⚠️ `spotOf` answers null for a canvas of no size: the arithmetic gives NaN,
  and `drawLine` walks towards NaN forever — a frozen page rather than a
  missed stroke. See §6 for the three css rules that keep the canvas open.
- ⚠️ The syntax overlay is a `<pre>` behind a transparent-ink textarea, so a
  token style may change `color` only: a bold or italic glyph is a different
  width and the overlay shears off the text.
- ⚠️ In the story editor a button's click bubbles to the row it was in *after*
  the button has already moved the line and rendered, so a row ignores button
  clicks; fields still select the row in place, because a render would close
  the select as it opened. And the story on screen stays put while a reload
  reads the file — nulling it for a fetch let a render write the address
  without its scene as a new entry, and the reload write it back as another.
