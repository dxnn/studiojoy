## 3. Data model

All timestamps are ISO-8601 UTC strings (`new Date().toISOString()`), never
epoch milliseconds. Counter columns reset on UTC date boundaries.

### `users`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `email` | TEXT UNIQUE NOT NULL | login handle |
| `password_hash` | TEXT NOT NULL | scrypt, includes salt + params |
| `display_name` | TEXT NOT NULL | shown in the studio and used as the git author name; ≤ 100 chars, and every door that sets one refuses the path validator's control and format characters (§4). ⚠️ Never said by the games origin — that is `alias` |
| `alias` | TEXT, unique `COLLATE NOCASE` | what every scoreboard shows and the only name the games origin says; `Alias <id>` until somebody picks one (`server/alias.js`) |
| `created_at` | TEXT NOT NULL | |

A row here is an account, and it comes in two kinds: with `studio_access = 1`
(and `deleted = 0`) it is **studio access** — the studio's door opens to it —
and with the bit off it is a **player account**: the games origin signs it in,
its scores wear its alias (§6), and every studio door is shut. Every account
from before the bit existed is a studio one; what the waiting list makes is a
player.

⚠️ **The alias is the account's public name, and the name never crosses.**
Every account is made holding `Alias <id>` (`fillDefaultAliases`, at both
places a row is made and on every boot); ids are never reused, so that is
unique by construction. A person changes theirs from their own name in the
studio's sidebar (`PATCH /api/me`), an admin anybody's in the panel — so a
player, who has no studio, asks an admin — and both go through one door,
`setAlias`, which refuses: nothing, more than 24 characters (a board row's
width), the control and format characters names refuse, the person's own
name or its first word, `Alias <n>` for anybody's `n` but their own, and one
another account already holds, ignoring case. A guard, not a wall: `Sam123`
goes through. There is no route for it on the games origin: one there could
be called by any game's code with a signed-in player's cookie attached (§7).
Arriving (2026-10-04), the column rewrote every signed-in player's board rows
to `Alias <id>` and deleted the rows from before sign-in, which held typed
names and had no account to give an alias.

⚠️ **Taking somebody out of the studio never deletes the row.** It sets
`deleted = 1` and drops their sessions, and touches nothing else. Their
messages, the games they author, their `project_authors` rows, their allowance
and what they spent are all still there, so `npm run restoreuser -- <email>`
clears the bit and gives back the same person.

⚠️ **And it is not something anybody can click.** There is no route and no
button: `npm run deluser -- <email>` is the only way out, going through
`removeAccount` in `server/auth.js`, and `restoreuser` the only way back.
Adding an account is everyday and belongs in the panel; taking one out is
rare and about a person rather than a setting, so it costs a terminal
rather than a red button next to Save and Password. The panel's other
refusals stay where they are: the studio still keeps at least one admin
(`isLastAdmin`, asked by the panel before it demotes and by `deluser`
before it removes).

⚠️ **`deluser -- <email> --scores` is the one real delete a person asks
for.** It also takes every board row they posted, their personal bests and
their achievements (`removePlayerScores` in `server/scores.js`), so a removed
player leaves every board at once rather than row by row in each game's
panel. `restoreuser` brings the account back and none of those; a backup is
the only way to them. The flag also works on somebody already removed.

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
| `display_name` | TEXT NOT NULL | ≤ 100 chars, no control or format characters (the path validator's class, §4) — the account's name, which only the studio sees; the account starts with `Alias <id>` on the boards |
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
| `thinking` | TEXT NOT NULL DEFAULT `'low'` | **thinking level**: `full`, `low`, `none` (§14) |
| `builtin` | INTEGER NOT NULL DEFAULT 0 | 1 = the *builder*, the studio's own (below) |
| `created_by` | INTEGER NOT NULL → users | display only; confers no ownership |
| `deleted` | INTEGER NOT NULL DEFAULT 0 | soft delete |
| `created_at` | TEXT NOT NULL | |

Agents are **studio-global**, not per-user: any account may create, edit,
delete, or attach any agent. This is the "zero account complexity" rule
applied to agents as well as projects.

The one exception is the **builder** (`server/builder.js`): a reserved row with
`builtin = 1` whose name, description and thinking are the code's,
written onto the row on every open so an upgraded studio gets the new words.
`GET /api/agents` leaves it out, `PATCH` and `DELETE` answer 403 for it, no
attach route and no `@mention` puts it anywhere, no detach route takes it
out, and it sits in every room of a game's but `Humans only` — `Building`
and every chat added to the game after it, each a **builder room**
(`chats.builder`) that takes nobody else. Made the first time a game is,
since `created_by` has to be somebody; a helper a person had already called
Builder is renamed `Builder (helper)`, never removed. What it does that an
ordinary helper does not is §8's.

`CREATE UNIQUE INDEX idx_agents_name ON agents (name) WHERE deleted = 0` —
unlike `new-y`, names are unique, so an `@mention` resolves to exactly one
agent. Soft delete (rather than hard) because `messages.agent_id` must keep
resolving so old chat history still renders the agent's name.

`thinking` replaced a `reasoning` boolean, which the migration backfills from
and then drops. It was kept written-but-unread for a while so a rollback would
find something true in it; one bit cannot hold three states, so `low` — the
default, and the level that writes files where full effort writes none (§14) —
came back as `full`, which is the failure the levels exist to prevent.

There is no file-tools switch. Until 2026-09-15 `file_tools` said whether a
helper could write, and a helper with it off was a critic that read the tree
and talked; since then a person's helper lives in a *chat project*, where
there is no tree to read, and the only helper in a game is the builder, so
the bit decided nothing anywhere and the migration drops it. The tools are
the builder's by construction (§8).

### `projects`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `slug` | TEXT UNIQUE NOT NULL | `[a-z0-9-]{1,40}`; the directory name under `GAMES_DIR` **and** the public URL path |
| `name` | TEXT NOT NULL | ≤ 200 chars |
| `kind` | TEXT NOT NULL DEFAULT 'game' | `game` or `chat` |
| `type` | TEXT | the game's **type**, a template's key (`visual-novel`, `quiz`, `arcade`, `adventure`, `racing`): which *editors* the centre pane offers and how helpers are briefed (§6, §8). Null is a free-form game |
| `archived` | INTEGER NOT NULL DEFAULT 0 | |
| `published` | INTEGER NOT NULL DEFAULT 0 | listed in the public catalog at `/` on the games origin |
| `scores_on` | INTEGER NOT NULL DEFAULT 1 | the per-game scoreboard switch: off, both `/_scores` routes answer 404 and the preamble stops naming the board; the rows are kept |
| `created_by` | INTEGER NOT NULL → users | the **originator**: the one account that may archive the game (§11). Display otherwise |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT | when the game last changed: its tree or its row, never its chat. What the sidebar sorts each group on (§6) |
| `stage` | INTEGER NOT NULL DEFAULT 0 | how many **stamps** the game holds on its **arc** (§6, `public/arc.js`): a person's judgement, moved one at a time by `POST /stage`. A column and never a file, so no `write_file` can move it |
| `announce` | INTEGER NOT NULL DEFAULT 0 | set on exactly one row: the studio's **announcements**, a chat project (below) |

**The announcements** (`server/announcements.js`, 2026-10-02) are one chat
project with `announce = 1`: one room, `bots = 0`, made once the studio has an
admin to have made it — when it starts, and when its first account is made —
with the slug `announcements` unless a game already has it. ⚠️ Only an admin
writes in it or changes it (`canEdit`, and the message route's own refusal,
since a room with no helpers is otherwise everyone's to talk in); nobody
archives it; everybody reads it and reacts. The flag, not the name, is what
makes it the announcements, so an admin renaming it changes nothing else.

`updated_at` is stamped from one hook on the broker (`watchChanges`, the
same place web push hangs) on every `files.changed` and `project.updated`:
seventeen routes broadcast one of those, and the eighteenth is the one that
would forget to stamp it. A `version.new` is a write's commit landing, already
counted; a message is talk, and does not count. Set to `created_at` on
insert. ⚠️ A game from before the column is dated from its newest message,
else its making — a migration cannot ask git — and the next change corrects it.

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
| `builder` | INTEGER NOT NULL DEFAULT 0 | 1 = a **builder room**: the *builder*'s one seat, and no other helper may be put in it. Every room in a game but `Humans only` |
| `created_at` | TEXT NOT NULL | |

One conversation inside a project. Every game is born with two: `Humans only`
(`bots = 0`), which is the one a bare GET opens on, and `Building`
(`builder = 1`), a builder room, with the builder already in it — and the
one a new game is answered with, so the first thing typed is answered. Every
chat added to a game (`Add chat…`) is another builder room under the name it
was given — a place to build the next thing, the builder seated at once. A
game may have up to 20. ⚠️ Since 2026-09-15 a game has **no room for a
person's helper**: those live in *chat projects*, blind to any tree, which is
the simpler shape for a kid to hold — the game is where the Builder is, a
chat is where a chatbot is. There is no delete: a chat holds what people said
in it, and nothing else in the studio throws words away.

**The upgrade** (`intoBuilderRooms`): every room in a game that takes helpers
and is not yet the builder's becomes one — its name and every word said in
it kept, the builder seated, the helpers people had put there detached
(their rows in `chat_agents` deleted; nothing else). Runs on every open,
idempotent. Two earlier shapes come forward the same way: the `Building` that
`intoChats` gave every project, and the `Old building` an earlier upgrade
made beside a fresh `Building` when people's helpers were in it, so a game
may have two builder rooms from birth. ⚠️ `intoChats` used to make `Building`
only where there was a thread or line-up to carry into it, which left a game
nobody had talked in yet with nowhere the builder could ever be put. The
condition belongs to what moves, not to whether the chat exists.

⚠️ The upgrade also detaches anybody but the builder from a room that is
*already* a builder room. Until 2026-09-15 an `@name` in `Building` seated
that helper there, and `Building` was the builder's already, so the pass
over the other rooms never reached it: found 2026-09-28, with a person's
helper committing to a game made ten days after the rule, on a server still
running the code from before it. `fireAgent` refuses the same seat as a
second lock — in a builder room only the `builtin` row ever fires — since a
seat there gets the builder's whole path, file tools included.

⚠️ Whether a helper may be put in a chat is one rule, `takesHelpers`:
`bots = 1` and not a builder room — which is to say a chat project's one room
and nothing in a game. It is read at the attach route (`assertBotsAllowed`)
and at a mention's call-in alike, where a helper would be **put in** rather
than where one would answer. A room that promises nobody is listening has to
keep that promise at the door; an eligibility-time check would be one
forgotten call away from a helper sitting in it silently. Until 2026-09-15
the call-in read `bots` alone, and a name typed in `Building` put a helper
there.

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
nothing references these rows (cooldown state is disposable), so no
soft-delete dance is needed here.

### `messages`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER NOT NULL → projects | |
| `chat_id` | INTEGER NULL → chats | which conversation. Nullable in the column only so a database from before chats can be upgraded in place; every row written since has one |
| `user_id` | INTEGER NULL → users | set for human messages; the API adds `user_name` beside it, read at the time it is served rather than stored, so the thread says what somebody is called today. The client has no user list to look one up in — an agent's name it can resolve, a person's it cannot |
| `agent_id` | INTEGER NULL → agents | set for agent messages |
| `kind` | TEXT NULL | NULL = normal message; `'system'` = server-inserted banner; `'plan'` = the *builder*'s plan card, with a `plans` row behind it (§8) |
| `plan_message_id` | INTEGER NULL | set on a *piece*'s row: the plan card it lives behind. The thread and history leave such a row out — the card stands for it, its body rewritten as pieces land — and the card fetches it by id when its line is opened (§6, §8). Rows from before the column are filed under their card from the plan on upgrade |
| `body` | TEXT NOT NULL | utf-8, ≤ 32 KB for a person's; for an agent's reply, the **reply** — the last turn's words (§8) |
| `working` | TEXT NULL | the reply's **working**: what the agent said on the way to `body`, every turn's words but the last. Kept here, shown behind a panel and fetched on open, never in the body and never replayed into a later fire (§8). NULL on a reply said in one breath and on anything but an agent reply |
| `tokens` | INTEGER NULL | what the fire that produced this reply cost; NULL for anything a person or the studio wrote |
| `trimmed` | INTEGER NULL | how many earlier messages the history budget kept out of this reply's context; NULL when none were, and on anything but an agent reply |
| `created_at` | TEXT NOT NULL | |

`CHECK (NOT (user_id IS NOT NULL AND agent_id IS NOT NULL))` — never both.
A normal message has exactly one set. A `'system'` banner has `user_id` NULL
and `agent_id` set to the agent it concerns (or NULL for project-level
banners); clients render it centred with no author pill.

There is no per-project participant indirection: humans have no per-project
participant row, so messages point straight at `users` / `agents`.

A **reasoning trace** is never stored here. See §8.

**The upgrade to `working`.** A reply from before the column existed is every
turn's words joined into one body — up to 160 KB, replayed into every later
fire in its chat. When the column is added, `splitLongReplies` in `db.js`
gives each agent reply over 4 KB the cut the loop would have made: the last
paragraph stays as `body` and the rest moves into `working`. Once, lossless,
and only for walls — a shorter reply, a person's message and a long reply with
no paragraph break are left as they are.

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
counts double. Index on `message_id`.

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
mentions.js` resolves both kinds of name with one rule — normalise to
lowercase alphanumerics, match the whole name or a prefix of at least two
characters — so `@Robin` reaches Robin Fox the same way `@Level` reaches
Level Designer. Never for the person who wrote it, and never for an agent
reply, since agents aren't told who the people are and a helper echoing a
name shouldn't ring a bell.

A row rather than an event, since the mark must outlive the tab that was
open when it landed; per chat rather than per project, since reading one
conversation says nothing about another. `POST …/chats/:id/seen` is the
only thing that clears it, and only its own rows. ⚠️ Not a side effect of
the GET that opens a chat: a read that writes is one somebody else's tab
can trip, and the client needs the same call for a mention landing in the
chat already on screen.

Counts ride the payloads that are already drawn per person — `mentions` on each
project in `GET /api/projects` and on each chat in the project detail — and the
`message.new` broadcast carries `mentions: [user_id]` so a tab that is not
looking can paint its own mark without refetching.

### `chat_reads`

| column | type | notes |
|---|---|---|
| `user_id` | INTEGER NOT NULL → users | |
| `chat_id` | INTEGER NOT NULL → chats | |
| `last_read_message_id` | INTEGER NOT NULL DEFAULT 0 | the newest message id this person has read here |

PK `(user_id, chat_id)`. The generic "something is unread" flag underneath
`mentions`' "you were named" one: `unread` on a project in `GET /api/projects`
and on each chat in the project detail is true when that chat holds a message
from somebody else newer than this row says, `server/reads.js`'s `chatHasUnread`
/ `projectHasUnread`. `POST …/chats/:id/seen` stamps this alongside clearing
`mentions`, so opening a chat clears both together; the client mirrors it the
same way it mirrors a mention — optimistically, on the same `message.new`
broadcast, never for a message the reader wrote themselves.

### `push_subscriptions`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER NOT NULL → users | |
| `endpoint` | TEXT UNIQUE NOT NULL | the address the browser's own push service gave it |
| `p256dh` | TEXT NOT NULL | the browser's public key, base64url — what a message is encrypted to |
| `auth` | TEXT NOT NULL | sixteen bytes of its secret, base64url |
| `created_at` | TEXT NOT NULL | |
| `announcements_only` | INTEGER NOT NULL DEFAULT 0 | the bell is off in that browser: it is told what is said in the **announcements** and nothing else |

One row per browser that has pressed the bell and been given permission (§6,
`server/notify.js`). ⚠️ `endpoint` is UNIQUE and not `(user_id, endpoint)`: a
browser has one subscription, so a second person signing in on the same one
takes the row over — which is right, since the first can no longer be reached
there and two rows would send them somebody else's messages.

⚠️ It is the one thing a plain `npm run deluser` really **deletes** (`--scores`
deletes scores too, above). Everything else
about a removed account stays (`users.deleted` is the door, §11) because it
is a record of what they made; this is a capability rather than a record, and
a push reaches a browser rather than a session, so a row left behind would
keep telling somebody who has been taken out what is being said here.
Subscribing again is one press if they come back. A row also goes the moment
the push service answers 404 or 410, which means the browser dropped it on
its side.

⚠️ Nothing here records whether somebody *wants* notifications. That is a
browser preference (`gs.notify`) and not a column, because permission is per
browser: a row saying yes on a laptop that has denied it is a row that lies.
Having a row here means a browser asked. ⚠️ The switch being off no longer
means it unsubscribed (2026-10-02): off keeps the row with
`announcements_only = 1`, so the announcements still reach it, and every open
of a browser that has said yes renews one of the two kinds. Only a browser
that never said yes has no row.

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

### `plans`

| column | type | notes |
|---|---|---|
| `message_id` | INTEGER PK → messages | the plan card: a message of kind `'plan'` by the *builder* |
| `project_id` | INTEGER NOT NULL → projects | |
| `chat_id` | INTEGER NOT NULL → chats | |
| `request` | TEXT NOT NULL | the human message the plan answers, as typed |
| `pieces` | TEXT NOT NULL | JSON: `[{title, files, what, status, message_id, note}]` — `status` is `todo`, `running` or `done`; `note` is the piece's **headline**, the closing paragraph of its reply (§8) |
| `summary` | TEXT NULL | the plan's words: one paragraph saying what the game or the change is, the planner's at first and the person's once changed (§8) |
| `assumptions` | TEXT NULL | JSON: the one-sentence decisions the planner made where the request left things open, each the person's to change or remove |
| `begun` | INTEGER NOT NULL DEFAULT 0 | a plan for the rest of something a fire started on, which is how its head reads |
| `edited` | INTEGER NOT NULL DEFAULT 0 | a person changed it since the sizing wrote it, so Build sizes their words again rather than running them as written |
| `built_by` | INTEGER NULL → users | who pressed Build it, whose day the build is charged to |
| `status` | TEXT NOT NULL | `running`, `paused`, `done`, `dropped` |
| `created_at`, `updated_at` | TEXT NOT NULL | |

What the builder's **sizing** split a big request into and how far it has got
(§8). The pieces are JSON because a piece is read and written whole and nothing
queries inside one; each carries its `status` (`todo`, `done`), the id of the
message row its fire left, and the one-line `note` that row said, which later
pieces are told. `messagePublic` puts `plan: {status, summary, assumptions,
edited, pieces}` on the card's message — each piece with its `note` and
`writes`, the paths its row wrote, read from `message_writes` — and
`plan.update` (§9) carries the same shape as a piece starts and as it lands,
with the card's `body` rewritten from it (§8). `status` runs `draft` (a plan
of two or more, waiting for Build it) → `queued` (pressed, not yet picked up)
→ `running` → `done`, with `paused` and `dropped` beside; a plan of one is
born `running`. On open a `running` plan is `paused` and a `queued` one is
`draft` again.
`paused` is what an interruption leaves — and what opening the database does to
every `running` plan, since the process that was running it is gone.

Index `idx_plans_chat ON plans (chat_id, status)`, for the one lookup the
sizing makes: the newest paused plan in the chat.

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

### `project_shots`

| column | type | notes |
|---|---|---|
| `project_id` | INTEGER PK → projects | one row per game, replaced rather than added to |
| `mime` | TEXT NOT NULL | `image/jpeg`, `image/png` or `image/webp` — checked, never taken from the frame's word |
| `bytes` | BLOB NOT NULL | the picture, ≤ `MAX_SHOT_BYTES` |
| `version` | TEXT NOT NULL | the commit the frame was drawn from, cleaned like the reporter's own mark |
| `at` | TEXT NOT NULL | when it was taken |

The last frame of the game somebody was watching, taken when they sent a
message and handed to a helper by `look_at_game` (§8). A **shot** is like a
score: it happens while somebody plays, it commits nothing, it enters no
version and it restarts no preview. ⚠️ A row and not a file for exactly that
reason — a file would be a commit, a preview reload and a line in history.

One per project and no history: the only question it answers is *what does it
look like now*, and yesterday's frame answers nothing. ⚠️ It is in the
database, so `npm run backup` carries it; at 30–80 KB a game that is
affordable, and it is the reason the reporter scales to 768px rather than
sending what the canvas measures.

### `scores`

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | ties rank by it: earlier post wins |
| `project_id` | INTEGER NOT NULL → projects | |
| `user_id` | INTEGER → users | who posted it; nullable only because the column came later — the rows from before sign-in went when aliases came (`users`) |
| `name` | TEXT NOT NULL | a copy of the poster's **alias**, so a board is one read; `setAlias` moves the copies with it |
| `score` | INTEGER NOT NULL | a JS-safe integer; bigger is better |
| `created_at` | TEXT NOT NULL | |

A game's scoreboard, posted **by a signed-in player** from inside the running
game and served back by the games origin (§6). The name is the account's
alias — whatever a body still carries is ignored, which keeps every game
written before the sign-in working the moment its player signs in. Pruned to the best 100
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
inside the running game and served back by the games origin (§6). Like
`scores`, it lives here rather than in the working tree, for the same reason
(above). Unlike a score it is the same kind of thing as a *personal best*:
`INSERT OR IGNORE` on the composite key, so earning one twice is a no-op, and
⚠️ **permanent** — no route deletes a row, no button, no per-row ✕ like the
scoreboard has. The definitions are **not** here: they are the game's own
`config/achievements.js`, read from the working tree per request (§6), so
removing one from the file leaves the rows and simply shows them nowhere
until the id comes back. Renaming an id orphans everybody's, which is why the
*achievements editor* derives an id from the name once and never lets it
change. Backed up the same way as `scores`, and taken with them by
`npm run deluser -- <email> --scores` (above).

⚠️ Forgeable exactly as a *score* is: the rule was met in the browser, which is
the only witness, and a rule evaluated in game code is one anyone can satisfy
from devtools. The server never sees a *moment* — only the unlock a rule
produced — and accepts it for the same reason it accepts a score.

### `collection_art`

| column | type | note |
|---|---|---|
| `id` | INTEGER PK | |
| `kind` | TEXT NOT NULL | `portrait`, `background` or `sprite` — a character, a place or a thing in the interface |
| `name` | TEXT NOT NULL | what the *shelf* calls it, ≤ 60 |
| `who`, `mood` | TEXT NOT NULL DEFAULT `''` | a portrait's suggested file name; empty otherwise |
| `bytes` | BLOB NOT NULL | the picture itself |
| `mime` | TEXT NOT NULL | `image/png`; PNG is the only kind kept |
| `width`, `height` | INTEGER NOT NULL | measured server-side from the IHDR |
| `added_by` | INTEGER NOT NULL | → `users.id` |
| `by_name` | TEXT NOT NULL | the display name at the time |
| `created_at` | TEXT NOT NULL | |

The **studio collection**: art people here have added, offered on the same
shelf as the shipped *standard set* (§6). Every account may add and read; a
row is taken out by whoever added it or by an admin.

⚠️ **The bytes are in the row rather than in a directory, and that is the
point.** A game's tree recovers itself from git and the shipped set is in this
repo, but a picture somebody drew here exists nowhere else. `npm run backup` is
a `VACUUM INTO` of this database and nothing else, so in a row it is already
protected and in a directory beside `games/` it would be outside both the git
safety net and the backup.

⚠️ **No licence column, on purpose.** Whoever drew it keeps their copyright and
the studio neither asks for a grant nor records one — the shelf says *made here
by Ada* and stops. The shipped half still carries `by` and `licence`, because
that half is other people's CC0 work; a contributed entry carries `made_here`
and no `licence` at all, so nothing can quietly print one. Decided
2026-09-02; TODO.md carries a line to revisit it, because a *published* game
carries those bytes out of the studio.

`by_name` is copied rather than resolved through `users`, unlike a message's
author: a credit on a picture is a statement about who drew it, not about what
that person is called today.

⚠️ Unlike an *achievement* this really is a delete — the row is the only copy,
and there is no Versions to come back from. It is safe to offer only because
picking copies the bytes into the game: a game that used a picture keeps its
own, and taking the row out reaches back into nothing.

### `studio_state`

Single row, `id = 1`.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK CHECK (id = 1) | |
| `tokens_used_today` | INTEGER NOT NULL DEFAULT 0 | all agents, all projects |
| `budget_reset_at` | TEXT NOT NULL | advances to next UTC midnight on first use after rollover |
| `daily_token_budget` | INTEGER NULL | the studio-wide wall; null = the built-in default |
| `default_agent_id` | INTEGER NULL → agents | the former *starter helper*; written and read by nothing now |

One studio-wide daily budget rather than `new-y`'s per-user accounting —
agents aren't owned by anyone, and the purpose here is narrower: stop a
runaway tool loop from draining the API key.

The *builder* fills that role now, for every game and by construction
(`chats`, §8); the column stays only so a rollback lands on its feet, the way
`agents.reasoning` did.
