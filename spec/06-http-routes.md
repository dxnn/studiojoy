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

There is no signup route **on this origin**: studio accounts come from
`npm run adduser` and the admin panel, and the games origin's public sign-up
only feeds a waiting list whose approval makes a player account (§3,
`signups`). Login requires `studio_access = 1`; a player account takes the
unknown-email path, same as a removed one. `/api/users` lists who is *in the
studio* for the sidebar's Crew tab — players excluded — and carries no
address: a list of names needn't be a list of emails to do its job.

#### Projects

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/projects` | — | all projects incl. archived, with last-message preview; each game says whether `icon.png` is at its root (`has_icon`) — the one *reserved image* the sidebar needs for games not open (§6) |
| POST | `/api/projects` | `{name, slug?, kind?, template?}` | create row, and for a game its directory and git repo; slug derived from name when omitted; `kind` defaults to `game`; `template` copies a game-template starter tree in as a third commit — games only, validated against `public/game-templates/index.json`; no template means the blank start page instead. Answers with the project plus `chats` and `chat` — the conversation to open: `Building`, where the *builder* is waiting, and a chat project's one room |
| GET | `/api/projects/:slug` | — | project, attached agents, recent messages |
| PATCH | `/api/projects/:slug` | `{name?, scores_on?}` | rename (display name only), and the scoreboard switch; a rename needs the project open, the switch is moderation and works archived |
| GET | `/api/projects/:slug/scores` | — | every kept score with id and time, best first, plus the switch: `{scores, scores_on}` |
| DELETE | `/api/projects/:slug/scores` | — | delete them all; there is no undo — scores are not files. ⚠️ The board's only deletion: one row has no route, deliberately |
| GET | `/api/projects/:slug/achievements` | — | each definition in `config/achievements.js` with how many players hold it: `{achievements: [{id, name, how, icon, players}]}`; a read, so anybody in the studio; the *achievements editor*'s structural read |
| GET | `/api/collection` | — | the *studio collection*: `{art: [{id, file, kind, name, who?, mood?, by, made_here, mine, created_at}]}`. ⚠️ No `licence` on any of them — see §3 |
| POST | `/api/collection?kind=&name=&who=&mood=` | raw PNG bytes | add a picture, ≤ 2 MB. Refuses anything but a PNG, a background that is not landscape, and ⚠️ a portrait whose width is a whole multiple of its height; a sprite may be any shape, a strip included. Broadcasts `collection.changed` |
| GET | `/api/collection/:id` | — | the bytes. The one studio read that may be cached hard (`immutable`): a row's bytes never change |
| DELETE | `/api/collection/:id` | — | take it out — whoever added it, or an admin. ⚠️ The only copy; games that picked it keep theirs |
| GET | `/api/push/key` | — | the VAPID public key, which a browser needs before it can subscribe at all. ⚠️ **404 when no keys are configured**, which the client reads as "push is not set up here" and says nothing about |
| POST | `/api/push/subscribe` | `{endpoint, keys: {p256dh, auth}}` | remember where to reach this browser (`push_subscriptions`, §3). ⚠️ `endpoint` is UNIQUE, so a second person on the same browser takes the row over — the first can no longer be reached there. 404 like the above when push is not set up |
| POST | `/api/push/unsubscribe` | `{endpoint}` | forget it. ⚠️ Scoped to the caller, so knowing somebody's endpoint is not a way to switch their notifications off. 204 whether there was a row or not — turning a thing off should never fail |
| POST | `/api/projects/:slug/story/fill` | `{sentence, scene: {key, about}, cast: [{key, name, about}], lines: [{who, say}]}` | the *fill*: a sentence about what happens back as `{lines: [{who, say}], tokens}` in the story's own keys. An editor's, like every change to a game |
| POST | `/api/projects/:slug/story/picture` | `{kind, name?, about?, colours?}` | the drawn *stand-in*: `{svg, width, height, tokens}` — a flat SVG at the size `kind` (`portrait` 128², `background` 480×270) wants. The browser draws and saves it; the server writes nothing |
| POST | `/api/projects/:slug/archive` | — | archive: the *originator*'s alone, refused while the game is published (§11). The pending commit lands first |
| POST | `/api/projects/:slug/unarchive` | — | the way back, the same person's alone (§11); 409 on a game that is not archived. Settles nothing — an archived tree owes no commit. `npm run unarchive` stays for a game whose originator has been removed |
| POST | `/api/projects/:slug/authors` | `{user_id}` | add an editor; 404 for anybody deleted or without `studio_access` |
| DELETE | `/api/projects/:slug/authors/:user_id` | — | drop an editor |
| POST | `/api/projects/:slug/open` | `{open_edit: bool}` | open the game to every account, or close it to its editors |
| POST | `/api/projects/:slug/stage` | `{stage: n}` | the arc's ratchet: how many *stamps* the game holds, one more or one fewer than now (409 otherwise), 0 to the arc's length; an editor's; a chat is 400. Broadcasts `project.updated` with `stage` |
| POST | `/api/projects/:slug/fork` | `{name, slug?}` | copy the working tree and its history into a new game — neither the thread nor the original's helpers come along; the copy has the *builder* in its own `Building` like any game; games only |
| POST | `/api/projects/:slug/publish` | `{published: bool}` | list or unlist the game in the public catalog; games only |

⚠️ The three author and open routes are the exception to **open**: they need
an *author*, not merely somebody who may write, even when the game is open.
Open is about the work, not about who decides (§11).

#### Running the studio

Every route here requires `users.admin`; everything else in the API is open to
any account (§11).

| method | path | body | effect |
|---|---|---|---|
| GET | `/api/admin/studio` | — | the people, what each has spent today, the studio-wide budget, and `waiting` — the undecided sign-ups |
| POST | `/api/admin/users` | `{email, display_name, password, daily_tokens?}` | add an account |
| PATCH | `/api/admin/users/:id` | any of `display_name`, `daily_tokens`, `admin`, `studio_access`, `password` | change one; the bit off ends their studio sessions, off-for-an-admin is 409, a password change ends both kinds of session |
| POST | `/api/admin/signups/:id/approve` | — | the waiting list's yes: makes the player account, marks the row; 404 once decided |
| POST | `/api/admin/signups/:id/refuse` | — | the waiting list's no: marks the row and keeps it (§3) |
| PATCH | `/api/admin/studio` | `{daily_token_budget}` | the wall around everybody. (`starter_agent_id` used to ride here too; the *builder* made it moot, §3) |

The panel has no Save buttons: every field saves itself on `change` — when
focus leaves it, so a half-typed number is never sent — and the row repaints
from the server's answer, so a refused value reverts.

⚠️ A password set here ends that person's sessions: a password changed because
somebody else knew it has to end the somebody else's session too.

⚠️ **There is no `DELETE /api/admin/users/:id`, and no Remove in the panel.**
Taking somebody out of the studio is `npm run deluser -- <email>` and nothing
else, undone with `npm run restoreuser` (§3, §11 has why). Every route above
refuses a person who is already out — the panel lists only the people still
in the studio, and a `PATCH` naming a removed id is a 404.

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
| GET | `/api/agents` | — | every agent people made — never the *builder*, which is in every game's `Building` already and goes nowhere else |
| POST | `/api/agents` | `{name, description, model?, thinking?, file_tools?}` | create |
| PATCH | `/api/agents/:id` | any of the above | update; 403 for the builder |
| DELETE | `/api/agents/:id` | — | soft delete; detaches from all projects; 403 for the builder |
| POST | `/api/projects/:slug/chats/:chat_id/agents` | `{agent_id, chatty?}` | put a helper in that chat; 409 for `Humans only`, for the builder's room, and for the builder itself |
| PATCH | `/api/projects/:slug/chats/:chat_id/agents/:agent_id` | `{chatty}` | update |
| DELETE | `/api/projects/:slug/chats/:chat_id/agents/:agent_id` | — | take out |

#### Messages

| method | path | body | effect |
|---|---|---|---|
| POST | `/api/projects/:slug/messages` | `{body, context_paths?: string[]}` | post a human message; fires eligible agents (§8) |
| GET | `/api/projects/:slug/messages` | `?before=<id>&limit=<n>` | page backwards through history; a *piece*'s row is left out, as it is from the project detail — its plan card stands for it (§8) |
| GET | `/api/messages/:id` | — | one message, as the thread would carry it. For a *piece*'s row, which lives behind its plan card and is opened from it (§8); anything readable is readable by anybody signed in, as the thread is |
| PATCH | `/api/plans/:id` | `{summary?, assumptions?, pieces?}` | change a plan's words while it is `draft` or `paused` (409 otherwise): the pieces given are the ones still to do, the done ones stay; each held to the sizing's own shapes, an empty list 400. The game's editors' to do, as the room is; broadcasts `plan.update` and marks the plan edited (§8) |
| POST | `/api/plans/:id/build` | — | Build it, or Carry on for a paused plan: the plan becomes the builder's next fire in its room, charged to whoever pressed; 202, or 409 while the builder is mid-fire there or the plan is not waiting (§8) |
| POST | `/api/projects/:slug/errors` | `{version, errors: [{message, location}]}` | record what the running game reported (§8); `version` is the commit the reporter was built with and the report is dropped unless it is HEAD; games only, allowed on an archived one |
| GET | `/api/messages/:id/receipt` | — | `{breakdown, prompt_held}`: what that reply was given and what each request cost (§8); 404 for a message with no receipt |
| GET | `/api/messages/:id/prompt` | — | the last request of that fire as plain text; 404 unless the message is the one reply in its project whose prompt is still held |
| GET | `/api/messages/:id/working` | — | what the helper said on the way to that reply — its *working*, every turn's words but the last — as plain text (§8); 404 when it said nothing more than the reply |
| POST | `/api/messages/:id/reactions/toggle` | `{emoji}` | toggle that emoji on that message for the signed-in person; answers `{action: 'add'\|'remove'}` and broadcasts `message.reaction` (§9) |

Message ids are global and every account sees every project (§3), so the two
receipt routes, the working route and the reaction toggle check only that
someone is signed in.
For the toggle that is deliberate: a reaction is talk about the work, not a
change to it, so neither authorship nor archiving stands in the way.

#### Files

| method | path | notes |
|---|---|---|
| GET | `/api/projects/:slug/files` | recursive listing: `[{path, size, mime, modified_at}]`, sorted |
| GET | `/api/projects/:slug/files/*path` | raw bytes, `ETag: "<sha256>"` |
| PUT | `/api/projects/:slug/files/*path` | raw request body is the content; honours `If-Match`; creates or updates; written at once, committed with the project's *pending commit* (§5) — answers `{path, size, etag, pending}` |
| POST | `/api/projects/:slug/commit` | land the pending commit now: the client saying it is leaving. `{commit}`, null when nothing was owed |
| DELETE | `/api/projects/:slug/files/*path` | commits, the pending commit first |
| POST | `/api/projects/:slug/files/move` | `{from, to}` — `git mv`, commits |
| POST | `/api/projects/:slug/files/duplicate` | `{from, to}` — copies the bytes into a new file, commits; 409 if `to` exists |
| POST | `/api/projects/:slug/files/import` | `{from_slug, from_path, to_path?}` — copies a file **in from another game**, commits; 409 if `to_path` exists |

`import` is the copy/paste between games: reading the source is every
account's, so only the destination's rights matter — `write: true` on
`:slug`, nothing on the source. Bytes only, no history, no link; the two
games stay strangers afterwards.

`PUT` takes a **raw body**, not `multipart/form-data` — no multipart parsing
to hand-roll, and it fits a file tree better than an upload endpoint: the
browser reads a dropped `File` and `PUT`s its bytes at the path it should
occupy.

`If-Match` carries the ETag from the last `GET`; on mismatch the server
returns 409 with the current content, so the editor can't silently clobber an
agent's write while you had the file open. Omitting the header forces the
write.

The tag is matched by the sha inside it, not byte for byte — comparing the
hash *is* the conflict check the header is for. A compressing proxy renames a
strong ETag per encoding (Caddy's `encode` suffixes it `-zstd`, stripped only
from `If-None-Match`; nginx's gzip weakens it to `W/"<sha>"`), so behind the
recommended Caddyfile every save 409'd as a phantom conflict until the
comparison allowed for the rename.

`+ Upload` — one of **Add a file**'s four choices — puts **any** file into
the game the same way: the studio `PUT`s the dropped or picked `File`'s
bytes, one request and one commit per file. Client-side only; no route
distinguishes an upload from an edit or one kind of file from another —
`checkProjectPath` validates a path's shape, never its extension, so
accepting a `.zip` needed no server change, only a button that no longer
claims to take just pictures and sounds. The dialog names each file the
Rename dialog's way: the name to type, the folder and the ending fixed around
it, one *Change the folder or the ending too* opening every row up to its
whole path; the folder starts as the one the file's kind goes to and the name
as the file's own, tidied (`assetPath`). Naming a file on the way in is the
same question as naming it later, so it is the same control. (formerly: one
folder box overruling every file at once, and no way to change a name.)

What the pane can *show* is separate, answered by `MEDIA_KINDS` in
`public/files-tab.js`: one entry per kind, matched in order — the only place
a new kind gets added. A file no entry matches gets a plain description with a link to
save it, since an unknown extension is already served as a download (§4).
Three choices worth naming:

- **Four folders under `assets/`, by what the file is** (named in the agent
  preamble): a short noise to `assets/sounds/`, a track to `assets/music/`, a
  *strip* to `assets/sprites/`, any other picture to `assets/images/`,
  anything else to `assets/`. Not tidiness: `Sound.play("laser")` and
  `Sprites.draw(ctx, "hero", x, y)` resolve a plain name inside the first and
  third folders unaided; a still picture or a track (whose ending varies)
  can't, so those are drawn by whole path instead. A dropped file is
  **measured** first — shape says strip, length says noise or tune (over ten
  seconds is music, as wrong for a long wav or sting as the strip test can
  be) — with one override box for whatever the guess gets wrong, and
  anything undecodable treated the same way.
- **The filename is tidied, not trusted.** Lowercased, runs of
  non-alphanumerics collapsed to one dash, extension kept, and
  `checkProjectPath` validates the result regardless. Two files that tidy to
  one name are refused, not silently overwritten.
- **One commit per file.** A dozen sprites make a dozen versions, exactly as a
  dozen agent writes would. Batching them would need a route that takes several
  files, and nothing else in the app wants one.

An asset opens as the thing itself — a picture in the *pixel editor* full
width under Pics or Code, a sound's sliders or player in the rail under Hear,
an `img`, `audio` or `video` pointed at the studio's own read route for
anything it cannot edit. An agent never sees its bytes (§8), and `write_file`
takes text, so a helper can point a game at `assets/sprites/hero.png` but
cannot create or change it.

A code file opens with its syntax coloured by the studio's own tokenizer
(`public/highlight.js`) rather than a library: comments, strings, numbers,
keywords, tags and attributes for `.js`/`.json`, `.css` and `.html`, else
plain. The mechanism is an overlay — the same characters tokenized onto a
`<pre>` behind a transparent-ink textarea — so the textarea stays the only
editor: caret, selection, focus snapshot, dirty state and save are untouched,
and a mistokenized read is a wrong colour, never a changed file. ⚠️ Token
styles may vary `color` only — a bold or italic glyph is a different width,
and the overlay must sit exactly on the text. A file past 128 KB stays
plain, and a JS regex literal stays plain too: telling `/` the operator from
`/` the regex needs a parser, and a wrong guess would paint the rest of the
line as a comment or string. The tokenizer is pure — no DOM — and covered by
`npm test`.

An asset can also be **made** here rather than added, by two tools that end in
the same `PUT`, at the same tidied path, in one commit each.

`+ Make a sound` asks two things — what it's called, and which preset it
starts from — writes the `.wav`, and opens it in the **sound editor**: a
preset row, a shape, and a slider per number with its comment beside it. The
render is arithmetic in `public/sound-maker.js` rather than Web Audio — a few
hundred samples per millisecond of blip, then a 44-byte PCM header — so what
the studio plays is what got saved, not a live approximation, and the whole
thing is checked in `npm test` without a browser, which no `AudioContext`
would allow.

The editor is also simply how a `.wav` opens, which is the point: a sound is
worth changing a week later, and samples can't be turned back into sliders.
So the numbers ride inside the file, as the **sound note** — a JSON comment
in a `LIST`/`INFO`/`ICMT` chunk, ~200 bytes, between `fmt ` and `data`. RIFF
is a list of chunks any player skips what it doesn't know, so the samples
stay byte for byte unchanged. Three choices worth naming:

- **In the file, not beside it.** A sidecar `laser.json` would break on
  rename, duplicate or restore, since those all move one file at a time.
- **A comment chunk rather than a private one.** `ICMT` is the documented
  place for a note about a sound, so any audio editor shows it instead of
  dropping it on save — a chunk of the studio's own invention would be
  invisible everywhere and no easier to write.
- **Nothing in the file is trusted.** The bytes may have been uploaded — a
  value the sliders couldn't have produced is replaced by the default, so a
  hand-edited note is a strange sound at worst, never a broken editor. A
  `.wav` with no note opens as the plain player it always did, with one line
  saying why.

`+ Draw a picture` makes a transparent PNG at the size asked for and opens it
in the **pixel editor**, which is also simply how a PNG opens: saved at
exactly the size it arrived. Pixels are RGBA, as a canvas keeps them, so an
uploaded picture loses nothing on open. The tools live in
`public/pixel-editor.js`, arithmetic over bytes for the same reason the sound
editor's are; the canvas, pointer and `toBlob` stay in `public/drawing.js`.
Seven choices worth naming:

- **What it draws is smaller than what it opens.** `MAX_DRAWN` is 256 and
  `MAX_SIDE` is 1024: a picture made here is at most 256 a side — and at most
  256 per *frame* of a strip, whose whole width is still held to `MAX_SIDE` —
  while anything uploaded up to 1024 still opens to be drawn on. The line is
  where the editor already changes character: past 256 it stops blocking the
  pixels up (`chunky` in `renderDrawing`) because the picture is being shown
  at or below its own size, and a one-pixel brush is thinner than the pane can
  show. Above the line what comes out is a photograph drawn by hand rather
  than pixel art, so the studio does not offer to make one.

- **`Make pixel art…` is how a picture too big for that comes down**
  (`pixel-art` in `dialogs.js`; ideas/pixel-editor.md, item 4): in any
  picture's `···`, and offered by Upload before the bytes land for a picture
  over `MAX_SIDE`, the one kind the editor cannot open. A box dragged around
  the part wanted (the crop), the longest side brought to one of the editor's
  sizes — or to 512 or `MAX_SIDE`, for a backdrop or a hero that is not pixel
  art and still wants cutting down (the shrink) — and, on by default, every
  pixel snapped to the game's palette with every edge made hard, the result
  shown blocked up before anything is written, with the note saying what size
  was boxed and what it becomes. The labels say *Crop* and *Shrink*, since
  those are the two things somebody comes looking for. Four
  operations in `pixel-editor.js`, each tested without a screen: a crop, a
  box-average shrink weighted by alpha, the nearest palette colour, and
  posterize. The dialog works on a working copy fitted into `MAX_SIDE`, so a
  4,000-wide photo's box moves at the speed of a finger. ⚠️ Not an undo step —
  a step is indexes into a picture of one width — so it writes: the same path
  for a PNG, the old bytes a version; a `.jpg` stays and the pixel art lands
  beside it as `.png`, since only a PNG keeps see-through parts. Under
  `assets/sprites/` a result a whole multiple wider than tall comes out one
  pixel narrower, as the guide's `asPng` does, so the sprites library does
  not play it.

- **There is no look-only view of a picture** — one would look identical to
  the editor, so it would cost a click for nothing. A PNG too big to draw on
  stays on screen as a picture with the reason underneath, which is the one
  case where the two differ.
- **The picture comes out of the file, not out of the studio's memory.** Every
  open re-reads the bytes, so a version brought back from history is what gets
  drawn on.
- **Which tool, how wide and what colour live outside the open file.** A save
  is a commit, a commit is a `files.changed`, which re-opens the file
  underneath the editor — so anything held per-file would be thrown away on
  every save. The picture and its undo stack are per-file; the choices are
  not.
- **The canvas element fills its box and the picture is fitted inside it.**
  Sizing it by width and height instead squashes it: a canvas has an
  intrinsic size, so a definite width with a capped height draws a 16-square
  sprite at 16 by 7. The pointer maths takes the resulting empty strip back
  off.
- **The palette is the game's, and it is built rather than chosen from.**
  Thirty-two colours in `PALETTE` in the game's own `config/look.js` — two
  rows of sixteen, greys then rainbow then the ones with character. The
  chosen square is both what the pencil draws with and what the colour box
  and the eyedropper write into, so lifting a colour off a picture is how the
  palette fills up.

  Being a *config file* is the point, not an implementation detail: a colour
  change is a commit on the game, appears in Versions, and a helper reads the
  same list — the file also opens as a config form of thirty-two colour
  fields (an earlier design's tradeoff: spec/alternatives.md). A game with no
  `look.js` sees the studio's own thirty-two, written on first change; a
  `look.js` with no `PALETTE` gets one appended rather than overwritten.
  Otherwise each changed colour is a splice of that one value, so every
  comment and untouched colour survives.

  **Colour changes are batched** — held in memory and written when the
  picture is saved, when the editor is left for another file, or on
  `pagehide` with `keepalive` for the tab simply closing (a plain `fetch` is
  cancelled on unload and `sendBeacon` can't `PUT`). Writing each one as it
  happened turned eyedropping six colours into six commits — versioning
  working against the drawing instead of for it. The picture saves itself two
  seconds after a stroke and the colours go with it (§5's *pending commit* is
  what makes that affordable); the bar says which is on its way. There is no
  Save. The four tools are icons, with words on `title` and `aria-label` so
  nothing is only a picture.

- **A step is the pixels it changed, not a copy of the picture.** One
  gesture — a stroke from pointer down to up, or a fill — records each pixel
  it touched with its colour on both sides: a few kilobytes for a stroke at
  any picture size, where a copy would be 4 MB, and what makes redo possible
  at all — undo writes the old colours back, redo the new ones. The recording
  happens inside `setPixel`, the one function every tool goes through, so a
  tool added later gets undo by existing. Measured in a browser: a fill of a
  670×330 background took 57 ms and undoing it took 8 ms (why not replay
  actions instead: spec/alternatives.md).

  ⚠️ Undo applies its entries **last to first**. A stroke that crosses itself
  writes the same pixel twice, so that pixel has two entries: the first holds
  the colour it really started as, the second holds what the first left behind.
  In record order, undo would stop at the middle colour.

- **Both stacks together are bounded by bytes**, because one case is
  genuinely large: flooding a whole 1024-square picture is twelve bytes a
  pixel — a 4-byte index and 4 bytes of colour each side — 12 MB. One step is
  always kept however big; the alternative is a fill that can't be undone.

A conflict is reported rather than merged. The save carries `If-Match` like the
text editor, but two pictures cannot be offered side by side in a dialog, and
nothing but a person writes a PNG — so a 409 says what happened and changes
nothing.

In **Versions**, a commit that touched a picture shows it as a thumbnail
unasked, and opening the row shows it whole. The unified diff of a PNG is the
sentence "Binary files differ" — git talking about itself, not the game — so
the patch renders only when it has a real hunk. `logCommits` carries the
paths each commit touched, from `--name-only` in the same process: fifty
extra git invocations just to learn a version has no picture would cost more
than the feature is worth.

A commit that touched a sound gets a player on the same terms, pointed at
the same read-at-a-commit route — a subject line can't say what a version of
a blip sounded like. It sits beside the row's controls, not inside the button
that opens them, since pressing play must not open the changes; it preloads
metadata only, so a version that deleted the sound removes its own row the
way a picture with nothing behind it does.

The history route answers `{ commits, total }` — a page of versions and how
many there are. The count, a `rev-list --count` beside the log, is what the
open file's bar says (`12 versions` rather than `Versions`, asked for with
`limit=1` on open) — worth knowing before deciding whether the list is worth
opening at all, rather than a page-size count quietly meaning "or more".

A file matching `config/<name>.js` opens as a **config form** — one labelled
field per value, its own comment beside it — instead of as text. Entirely
client-side: `public/config-file.js` reads the `const NAME = value;` subset
(§8), returns each value with its span in the source, and an edit splices
that span so comments, alignment and every other byte survive. Four rules
hold it together:

- **Nothing is executed.** No `eval`, no `new Function`. Config files are
  written by LLMs and by kids and are served from the games origin; running one
  in the studio would hand game code the studio's own context (§7).
- **All or nothing.** A file holding anything outside the subset — a function, a
  sum, a template literal — opens as text with a line number, rather than a form
  showing the part it understood and hiding the rest.
- **A value it writes is a value it can read.** A number field validates against
  the same pattern the reader accepts, so the form cannot produce a file it would
  then refuse to open.
- **A comment belongs to one value.** Read from the raw text — a `//` inside
  a string isn't a comment — and counted as a value's own only if it follows
  with nothing but a comma or closing semicolon between, or sits above the
  line that value's text starts. `{ width: 320, height: 200 };  // the play
  area` describes the group, so both fields show no note rather than
  repeating that one.

Each edit re-reads the file and finds the value by path rather than reusing the
last render's offsets: a splice moves every offset behind it, and re-rendering
the pane per keystroke would replace the Save button under the pointer.

#### The shell

Three panes: the sidebar, the conversation, the rail. Each choice is about
where a thing is reachable from, not how it looks.

**The sidebar is one list at a time** — Games, Chats, Crew — with tabs and a
filter box, not the three stacked foldable sections that fought each other
for the pane's height before. Crew is everyone in the studio, **Humans** over
**Helpers**, since both belong to the studio rather than a game, from `GET
/api/users` — names and ids, no addresses — read once at boot; the empty
state says where accounts come from, since nothing here makes one. The tab is
remembered per browser next to the rail width; the filter isn't, since a
stale filter is a list with things missing. The button above the tabs makes
whatever it holds, so `+ New chat` is never a click away.

**The studio can tell you things while you are away** (ideas/notifications.md).
A message landing in a room you are not reading already leaves a *mark*; if
the studio is not the thing on screen (`document.hidden`) it also shows an OS
**notification** — the game's name, then who said what, cut to one line. The
decision is `applyMessage`'s, the same one that sets the mark, so the two can
never disagree. One per conversation (`tag`, with `renotify`), so a helper
saying four things in a row is one line that keeps changing. Pressing it
focuses a studio tab and opens that conversation, or opens a window at
`/p/<slug>?chat=<id>` when there is no tab. ⚠️ It is shown through the
service worker's registration (§7) and wears the studio's icon, never the
game's: this is the studio talking, the same reason the sidebar stays cyan.

The switch is the bell in the `who` row — about you rather than about any
game, and that row is the only thing in the studio that is. Whether you want
them is remembered per browser (`gs.notify`) rather than stored, because
permission is per browser and a row saying yes on a laptop that has denied it
is a row that lies; the browser's answer outranks the switch. Absent entirely
where `Notification` does not exist. ⚠️ Offered while the browser is
*blocking* them, which is the one place the studio explains a control instead
of hiding it: unlike a greyed button in a bar, this one has a real answer to
give, and somebody who has pressed a bell twice with nothing happening
deserves to hear it. ⚠️ The permission is asked from the press and nowhere
else — asked without a gesture it resolves `denied` without a prompt, which
spends the one chance the browser gives, permanently.

**And when the studio is closed altogether**, through web push. A browser
that has said yes subscribes with the push service its vendor runs and hands
the studio the address and two keys of its own (`push_subscriptions`, §3);
the studio signs each send with **VAPID** (RFC 8292) and encrypts the body to
those keys with **`aes128gcm`** (RFC 8291), so the push service carries what
was said and cannot read it. Three routes: `GET /api/push/key`,
`POST /api/push/subscribe`, `POST /api/push/unsubscribe`. Everything is
hand-rolled in `server/push.js` against the RFCs' own worked examples,
because `new-y` gets it from the `web-push` package and this studio has no
runtime dependency at all.

⚠️ **No keys in the environment is a 404 on all three**, and the client reads
that as "nobody set push up here" and says nothing: a studio without them
still tells everybody whose tab is alive. ⚠️ The audience is **every studio
account except whoever spoke** — every account can see every project (§3),
which is the same reason the broker has no membership to filter on — narrowed
to whoever has a row, which is what having asked means. ⚠️ It hangs off
`broker.watchMessages` rather than sitting beside each `message.new`: three
places broadcast one, a push has to reach a browser with no connection at
all, and the fourth place is the one that would forget. Never awaited — a
slow push service must not hold up a reply landing in the thread.

⚠️ **The service worker suppresses a push when a window is visible**, which
is the one exemption `userVisibleOnly` allows: rung 1 stayed silent for
exactly that case and the marks are already saying it. A hidden tab shows
both, and the shared `tag` collapses them into one. ⚠️ **404 or 410 from the
push service drops the row** — the browser threw the subscription away and
every send after that is a request nobody will ever read. ⚠️ So does
`npm run deluser`: a push reaches a browser rather than a session, so it is
the one thing removing an account really deletes.

**Games come in four groups** — Yours, Open to everyone, Everyone else's, and
**Archived** last. The first three are about what you may *do* to a game, so
an archived one is only ever in the fourth whoever made it; it was italic
rows scattered through the other three until 2026-09-06, which put a game
nobody is working on any more in the list of games you are looking for. Each
group folds away behind its own heading — the heading *is* the control, its
caret flipped rather than a second control appearing, and it carries a count,
because a shut group with no number on it is a question. Open or shut is
remembered per browser (`gs.group-<id>`); Archived is shut until you open it
and the other three are open until you shut them. ⚠️ **A filter opens every
group and takes the headings' controls away**: a filter that hides a match
behind a shut heading is a filter that lies, and there is nothing left for
the control to do. A group with nothing in it is still absent entirely.
Within a group, the game that changed last comes first (`updated_at`, §3): a
write to its tree or a change to its row, never a message — a busy chat is
not a changed game. A `files.changed` from any game moves that game's row as
it lands, on the tab's own clock; a `project.updated` refetches the list
(§9). The line under a game's name still follows its newest message.

**The arc at the top of Building** (`public/arc-card.js`, `public/arc.js`,
ideas/doneness.md): how done a game is, apart from whether it is out. A game
collects **stamps** in the order its type sets — the arcade's run *It moves*,
*It loops*, *It looks like something*, *It feels good*, *It's fair*, *Someone
else played it*, *It's out*; a visual novel's put story where the loop is and
*Read it aloud* where tuning is; a quiz's are five; a blank game's start with
*What is it?* Each stamp is one principle real game makers hold, in a kid's
words, with what makers say about it, the **checks** the studio ticks from the
tree and the row (names, never a file's bytes), and two or three **asks** —
pressed, the request lands in the composer, unsent, so a kid learns what to
ask for by asking for it. The stamp is the person's call: *This one's earned*
moves `projects.stage` (§3) by one, the card's `···` takes one back, and the
checks are hints, never gates — publishing never waits for a stamp. Editors
press; everybody sees. The head is the fold (per game in `prefs`), and with
every stamp earned the card is its row of dots and one line. Building only,
because the arc is a list of things to ask the builder for, and the preamble
carries the same stamp so the builder's answers fit it (§8). Nothing about
stamps on the front page or in the sidebar, yet: doneness is the maker's.

**Typing an `@` in the composer opens the menu of everybody it could reach**
— the people, then the helpers, in the order the Crew tab lists them, each
with a line saying what naming them does. Arrows walk it, Enter or Tab picks,
Escape shuts it, and what has been typed after the `@` narrows it by the
server's own rule, so an email address in a message never opens it
(`server/mentions.js`, §3). A helper who is not in this room is offered too,
because naming one is what puts them in it — except where the `+` that does
the same thing is not offered either: the human-only room, the *builder*'s,
and a game this account may not change. An `@` is what makes a helper answer
at all and what leaves a person a mark, and the only way to find out a name
was mentionable used to be to guess it or go and click it in the sidebar.

**Everything you can do to the whole game is behind one `···` beside its
name** — Rename, Fork, Editors, Publish, Add chat, Archive, Unarchive —
absent rather than greyed for anybody who may not press it: Fork is
everybody's; Rename, Editors, Publish and Add chat are an editor's; Archive is
the *originator*'s, only while the game is unpublished, and Unarchive is the
same person's, only while it is archived (§11). Nothing to offer means no
`···`. Every item asks in a dialog and ends in an ellipsis — except Unarchive,
which asks nothing, because it undoes rather than does. The bar itself holds
only state: the padlock, the `archived` tag, and a whisper saying whether the
game is published.

**Every thing has one `···`, on its row, and nothing else that changes it.**
A scene, a line, a choice, a mood, a file, a version, a helper, the chat
you're in: each row's `···` holds what can be done to it, in one order —
Rename, Duplicate, then what is its own (Start here, Move up, Move down,
Bring back), Delete last in crimson — with nothing the reader may not press:
a refused item is absent, and a thing with nothing to offer has no `···`.
What *looks* at a thing is a link on the row (`Show changes`, `All files
changed`, a scene's *comes from*); what makes a new one is a bordered button
where it lands (`Add a file`, `+ Add a scene`). One `Duplicate…` covers all
three destinations a file can go — this game, another, or a picture into the
*studio collection*. `more()` in `main.js` is the one implementation;
`S.menu` holds which is open, keyed by the thing, so a render keeps it and a
click elsewhere closes it.

**The inspector** (a working name, ideas/calm-shell.md) is the rail under the
preview, holding the selected thing's fields when the mode has one: in the
story editor a scene's name, ways in, note, picture and music; a person's
name and note; the title screen's two lines — letting the centre be what
happens rather than what things are called. Its fields keep the ids the
focus snapshot knows (§17), so the caret survives a render there too. A file
has none: its bar in the centre already says what it is.

With nothing more specific selected, the inspector falls back to **how the
game is doing**: every achievement in `config/achievements.js` — icon, name
and how many people hold it, dimmed until somebody does — and then every
score on the board, the same two lists Share carries and in the same order,
read-only in both. The heading of each opens Share, where the real editor
lives; a summary is not where you go to change one. Each is absent rather
than empty — no achievements defined, or a board that is off or has nothing
on it, and that half simply is not there, the sidebar's rule about a group
with nothing in it.

⚠️ It was an icon strip with the name and the headcount on a `title` until
2026-09-06, which is nothing at all on a touchscreen: the studio is used on
phones, where there is no hover. Anything a row has to say goes in the row.
The best score stays in the preview's own foot as well — it is the number the
game is being played for, and it belongs on the frame rather than in a list
below it.

**The row under it is the mode row**: one pill per surface the centre can
show, in the order the type gives (`modesFor` in `public/game-types.js`) —
the chat, then the type's editors (**Write** for a visual novel), then
pictures, sounds, controls, the tree, the versions and the public face. A chat
project has no row. **The pill you are on, pressed again, closes the open
file** and leaves the mode: the way back to the cards, the rows or the tree
without reaching for the bar's ✕. Not under Questions or Controls, where the
file is the mode.

⚠️ **The pills are named for the senses; nothing else is.** They read
**Speak**, **See**, **Hear**, **Touch**, **Taste**, **Recall**, **Smell**,
in that same order — while every id, route, event and paragraph below keeps
`chat`, `pics`, `hear`, `controls`, `code`, `versions`, `share`, and so does
the preamble (§8). The same split the studio already keeps between *author*
and editor, and `agent` and helper, decided 2026-09-04 and **on trial**: it is
there to be tried on the people who use the studio, and a word on a pill is
the cheap half to change. Two of the seven are only a tooltip away from
meaning nothing — Smell is the game's public face and Taste is the tree — so
`what` on each mode is load-bearing rather than decoration. ⚠️ And one price
the other two splits do not pay: the preamble names two surfaces by the old
words, `Controls` and `Share`, so a helper can still tell somebody to "change
it in Controls" while the pill in front of them says Touch. Two strings in
`orchestrator.js` end that when the names stay. Which is showing is the centre's one piece of state
(`S.mode`), in the address as `?mode=`, remembered per game; a game opens on
what the address says, else what the browser remembers, else its type's
first editor, else Chat. There is no Play — the preview lives in the rail
only, so the ask-commit-reload-play loop stays one pane away regardless of
mode. Leaving a mode lands the game's *pending commit* (§5).

**The body of the centre pane is the mode's.** Chat is the chat's own row —
pills, the helpers listening and the `+` that calls another in (⚠️ each its
own horizontal scroller, so chats and helpers give way to each other rather
than one pushing the other off the end) — over the thread and composer. An
**editor** is a surface a *game type* brings, one mode each
(`public/game-types.js` maps `projects.type` to its editors — the whole
registry), taking the whole pane like the chat does. Code is the file list
with the open file's editor under it, as the rail's Files tab was; Versions
is every past version of the game — `git log`, one row a commit, each
opening its diff — its own mode now, no longer folded into Share; Share is
one page — the game's address and games-list status, then the achievements
and the scoreboard, each keeping the rendering it had as a rail tab. `S.chat` is
untouched by the mode, so the chat behind another mode keeps filling and a
mention marks the Chat pill rather than being read. The *story editor* is
the first editor (below); a type may bring several. Old addresses still
read: `?edit=` is a mode, `?tab=files` is Code, `?tab=versions` is Versions,
the rest are Share.

**Pics and Hear are the game's files by kind, not by folder.** Pics is
cards: for a visual novel, **Characters** (one per *cast* member, first
mood) over **Places** (backgrounds, with scene counts); for every game,
**Sprites** (first frame), **Pictures**, the three *reserved images* under
**Studio dressing**, and **Other pictures** last, so nothing the tree holds
is missing. ⚠️ A card pressed **once** opens full width in the *pixel
editor*, the bar's ✕ — or the pill pressed again — the way back, the file's
own `···` beside the ✕ since on a phone the card it came from is gone, and
the rail carries the open picture's fields — where it lives, what it dresses. Selecting into the rail first and
opening on the second click was a step that bought nothing: what the rail
showed was the same picture at a size nothing could be done with, and Code's
rows already went straight to the editor, so the two panes contradicted each
other about what a picture is. Hear is rows, sounds over music;
the open one's *sound editor* — or a player, for one not made here — lands
in the rail, closed by the same row. Each has its maker at the top. Pics'
is three buttons rather than a dialog — **Draw a picture**, **Upload a
picture** straight into the device's own picker, and **Add from the studio**,
the *shelf* (below) with every kind on it at once. Every way into Pics adds a
picture, so a dialog there was a menu whose every road led to one of three
places anyway; Code's *Add a file*, which really does choose between kinds,
keeps its dialog and its own copies of all three. *Add a sound* is that
dialog narrowed to uploading and the sliders — no shelf, which is pictures
only. The tree is still Code's — a file opened elsewhere still opens under
Code.

⚠️ **Studio dressing is the one section that shows with nothing in it**, with
**Add dressing** on its label row. The three are the only files in the studio
whose *name* is what makes them work, so nothing on any pane could ever have
said they exist: a game wearing none simply had no section, and the only way
to learn that a file called `hero.png` would show was to be told. The button
asks in two steps — which of the three, each with what it dresses and whether
one is there already, then drawn here on a blank canvas of the right shape,
brought from the device, or picked off the *shelf* — **Add from the studio**
again, every kind on it as under Pics, the one shelf whose pick lands under
the reserved name rather than its own. A picture from the device or the shelf
is made a `.png` whatever it arrived as and fitted (`asPng`, shared with the
story guide): the studio looks for these three by name, and a JPEG called
`hero.png` is a lie the browser happens to forgive. On a game nobody here may
change the section is absent again — an empty section with no button under it
is an offer that cannot be taken up.

**Questions** is the quiz's editor as a mode: `config/questions.js` opens on
arriving, its bar has no ✕ — nowhere to close it to — and the form saves
itself like the story does.

**Controls** is how the game is held, the same way: `config/controls.js`
opens on arriving, no ✕, saves itself. Two halves.

The **shape** is one wide row per thing the studio offers, in the registry's
order and words — the same four New game asks about (§4) — with the
*arcade* family opening into its three manners underneath while the game
wears one: one open at a time, in its row. The row already worn is cyan and
*not a button* — a greyed-out row is a question it can't answer — nor is
any row in a game you may not change. Picking one writes `SCHEME` only —
⚠️ never the bindings, whose left-hand words are the game's own code, and
⚠️ not the notes above it either, which still describe the shape it was
seeded with (a TODO line).

Then **what each player does**: a row per verb with its bindings as chips,
read-only for the same reason. A verb **opens in the row it belongs to**,
into a row per binding — the chip, its words for a player ("the space bar",
"the controller's right stick pushed left"), and *Take it out* in its `···`
— over the three ways to add one. A key is **pressed** rather than picked
from a list of a hundred: the button installs one `keydown` listener that
takes itself off with the first key, Esc cancels, and the friendly name is
what gets written (`key:space`, not a space nobody can see). A controller
button or on-screen control is a select of the shape's own vocabulary, so a
shape can only be given what it draws; a drawn button also carries its
**name** (starting as the verb's own) and *it latches* (`touch:` ↔
`toggle:`) — only a drawn one does, since a key or pad button staying
momentary keeps the desktop feel.

The shape's two knobs sit under it: `BUTTON_SIDE` where anything is drawn,
`STICK_DEADZONE` where a thumb works a stick — ⚠️ **written the first time
one is used**, since a shape seeded without them never declared them, and
`input.js` reads `"right"`/`0.35` for itself until one is there.

Under the verbs, every binding this shape lacks — a `stick:` in a swipe
game, a drawn button in a `none` one — is said in words, with *Take it out*
in its `···` too, and struck through in the verb rows above, or a row would
show a control that looks like it works. One check runs over the whole
file: a shape that draws something with bindings that never name it is
unplayable on a phone — exactly what picking a shape without rebinding
causes. That's what declaring the shape is for: a file claiming `swipe-tap`
while binding six drawn buttons has left its shape, and the panel says so.

⚠️ Shape-locked like the quiz: `CONTROLS` must be a group of players, each a
group of things to do, each **one line** of bindings. A list where a line
belongs, or anything the reader won't touch, falls back through the generic
form to the text with the reason said; a declaration the panel doesn't know
is named at the foot rather than hidden. The model is
`public/controls-editor.js`, shared with `npm test`; the panel is
`public/controls-form.js` — both render wherever the file is open, Code
included, since one renderer reached two ways isn't two surfaces (the
*story editor*'s rule).

**A game a person makes is open** — the whole studio may change it — until
an editor closes it in the `Editors` dialog, putting a padlock on its name.
This is a studio of people who trust each other: a game nobody else may
touch should be a decision somebody made, not the default. A fork starts
open too, whatever the original was. ⚠️ Stated at the INSERT rather than the
column's default (which stays 0), since a database from before already has
the column and SQLite can't change a default after the fact. A chat project
is everyone's by rule rather than by column (§11): nothing reads its
`open_edit`, so it wears no padlock and has no `Editors`.

**The rail is the running game, and no tabs**: the preview, `Open` and
`Hide` on the frame since both act on the game, and under it the problems
and moments it reported, then the inspector (above). Folded, it is one row
that still plays, remembered
per browser. The preview is a thing, so what changes it is in its own `···`:
the **shape** to try the game in — Normal (4:3), Wide (16:9), Phone (9:16),
Square — a tick on the one it is in, remembered per browser next to the rail
width. A game decides its own size from the window it is given
(`Screens.fit`), so giving it a phone's window is the only way to find out
what it does on one. The frame is the biggest box of that shape the rail's
width and half the window's height allow, centred, with the foot under it the
same width — a bar wider than the game it belongs to reads as a bar belonging
to something else. `Reload` is gone — a save already reloads it. Files, Versions,
Scoreboard and Achievements are modes of the centre now (above); the file
editors open by kind: a picture under Pics or Code, a sound in the rail
under Hear, everything else under Code.

**A game lends the studio its four colours** — its *look* — while it is
open. `config/look.js` is read once for both the *palette* and these; the
four are set on the shell as `--look-*`, read only by the chat pane, its
buttons, the composer, the game's actions and the rail. The sidebar stays
the studio's own cyan on purpose, so the studio never looks like whichever
game is open. ⚠️ Each value is checked before reaching a style attribute —
no colon or semicolon, so it can't close the declaration and open another,
and no `url()` or `var()`. A game naming none of them wears the studio's
defaults, so a partial look is fine; a helper's edit to `look.js` re-reads
unless the editor holds unsaved colours.

**Three picture names at a game's root are reserved images** — the studio's
dressing, not the game's: `chat.png` tiles behind the conversation,
`hero.png` backs the bar over it and the game's card in the catalog (§7),
`icon.png` sits before the game's name in the sidebar and on its card in the
catalog (§7). Root rather than
`assets/` on purpose, so a sprite happening to be named `icon.png` doesn't
become the studio's dressing; the upload dialog routes the three names to
the root the same way it routes a strip to `assets/sprites/`. All optional
— a game without one wears the studio's own look — and person-made like
any other picture; the preamble names them so a helper asks rather than
filing a wallpaper where nothing looks. They sit under a wash of the game's
`deep` colour in the studio, a plain dark one on the catalog card. The
client holds the open game's two, and every game's icon, as object URLs
replaced on `files.changed` and revoked on replace — the file routes send
`no-store`, and a background rebuilt by every render would refetch on
every keystroke; `has_icon` on the project list keeps the sidebar from
probing every game for an icon it lacks.

The six libraries under `studio/` — what each does, the manifest, the
compatibility law, the sweep, and picking a game's control scheme — are
documented separately, in spec/06-studio-library.md.

### Game templates

A **game template** is a starter tree: New game offers "Start from", and the
chosen template's files are copied in server-side right after the library
scaffold, as one commit. From then on they are the game's own — no version,
no updates — unlike a library, since genre code must stay editable: "add a
timer to my quiz" has to land in files a helper can change, not behind the
`studio/` write-wall. Not a fork either: a fork copies history and attached
agents; a template wants a clean thread and current libraries.
`public/game-templates/` is the source (distinct from `public/templates/`,
the seeds); its `index.json` carries the dialog's words and is the
validation list. Every template follows one shape: a remixable heart in a
config file, a pre-written `BRIEF.md` and `SPEC.md`, the library script tags
already in `index.html`, and placeholder assets the studio's own makers can
replace. Server-side copying is byte-safe, so templates can ship sounds and
pictures.

"A blank page" — the dialog's other, default choice — is one page, committed
after the library scaffold like a template, from
`public/game-templates/blank/index.html`; a game with no `index.html` is
nothing the games origin can serve. That page is the one thing under
`game-templates/` not copied byte for byte (`{{name}}` becomes the game's
name, escaped), and is absent from `index.json` since the dialog already
offers it as the empty choice. It loads every library the game holds,
including input, since a game's *control scheme* is chosen at creation: the
null controller draws nothing, and an arcade shape wants its two tags from
the first minute.

A `BRIEF.md` is committed with the page, copied byte for byte (§8, Project
documents) — every template ships one, and it's the only place saying which
script tags the page carries and which `SCHEME` was chosen.

`index.json` also names each template's **heart**: the file the studio opens
the new game on, since a template with its own editor is made in that editor
rather than asked for. The *builder* sits in a template game's `Building`
like any game's; opening on the heart just keeps it out of the way until
wanted.

The **quiz** template is the first, with its own editor: a quiz is a form
pretending to be a game. `config/questions.js` holds `QUESTIONS` (each answer
counting toward an ending) and `RESULTS`; while the file keeps that shape,
the studio opens it as the **quiz editor** — add and remove questions,
answers and endings, wire each answer to an ending by name, no code in
sight. Ending keys (`ending_4`) are internal wiring the editor invents and
never shows. Unlike the generic form's one-value splicing, the quiz editor
regenerates the whole file with the template's standard comments, so opening
and saving the shipped template is byte-identical (tested). A file that
outgrows the shape falls back to the generic form, then to text, and a
helper can grow it freely from there.

The **achievements editor** is the third, and the first every game has:
`config/achievements.js` is seeded into every game (§4), so its editor is
the studio's own — the **Achievements** part of Share: each achievement in
its own row with name, how to get it, an icon and the *moment* it waits for;
`+ Add an achievement`; `Take it out`, confirmed with how many players keep
what they earned. Like the quiz and story it regenerates the whole file and
is byte-identical on an untouched save; a file that outgrows the shape keeps
its tab with a reason and the text. Under Files it opens as plain text only
— one surface writes it. It reads two things no field can: how many players
hold each achievement (`GET /api/projects/:slug/achievements`), and the
moments the *reporter* has heard this game say this session (§8) — offered
where a rule names one, flagged where a rule names one never heard. Explicit
Save with `if-match` and a conflict dialog on 409; unsaved edits park per
game like the story's. The libraries and seed reach an existing game through
the *sweep*; `<script>` tags and `Moments.say()` calls stay a helper's job.

The **visual novel** is the second, and the one that says what a template is
for. Its heart is `config/story.js`: `CAST` (who speaks, and their moods) and
`SCENES`, each a picture, an optional sound, and lines said one at a time,
ending in exactly one of `choices` (branch), `go` (carry on), or neither
(end). A choice may `set` a switch; one that `need`s a switch is only
offered once something has set it. DOM rather than canvas, since a story is
mostly text that wants to wrap on a phone; it uses the sound and screens
libraries, neither input nor sprites.

⚠️ It came before the point-and-click adventure on purpose: the two share
scenes and switches, but an adventure's spots are rectangles on a picture and
agents cannot see pictures (§14) — a visual novel has no coordinates
anywhere, so nothing about it is blocked on eyes. Building it first also
settled the vocabulary the adventure inherits, `set`/`need` rather than the
sketch's `flip`.

A visual novel is the first **game type** (§3), edited in the **story
editor** — an *editor* in the centre pane, with TyranoBuilder's three regions
in one tab. The **scene strip** down the left — every scene with its
problems and tail (*3 choices* / *→ hall* / *the end*), then the cast — is
the editor's own navigation, letting a type bring several editors without
each wanting a rail tab. For the selected scene, the **stage** draws what the
player sees at the selected **step**, from the *unsaved* model, instantly and
without a commit (`stageFor` in `story-editor.js`, pure and tested); its
pictures are cached object URLs, dropped when `files.changed` names their
path. Under it, the **steps**: one row per line, dragged into order or moved
from its `···`, then the exit (choices, go, or end) and the scene's problems.
What the scene *is* — name, *comes from* links, note, picture, music — lives
in the **inspector** in the rail; what can be done to it whole (*Start
here*, *Duplicate*, *Delete*) is the `···` on its strip row.

Like the quiz editor it regenerates the whole file and is byte-identical on
an untouched save, and it says five things no single field can: a scene
nothing leads to, a dangling way out, a switch nothing sets, a missing
picture or portrait, and a mood the cast lacks. **No Save button** — the
story saves itself two seconds after the last edit or sooner on leaving a
field, scene, editor or game, with `if-match` and a conflict dialog on 409;
its commit is the project's *pending commit* (§5), which is what makes an
editor that saves itself affordable. The pixel editor, sound editor and quiz
form save themselves the same way, since every state they pass through is a
picture, sound or quiz; Code's text editor keeps its Save, since half-typed
code is a broken game the *reporter* would post. *Show the text* saves first
and opens the file as plain text — the editor is in the middle, and a form
there too would be a second surface writing the same file. *Try this scene*
saves first, then reloads the preview at the game's own `?scene=`. ⚠️
Unsaved edits park per game on leaving and return while the file's etag
still matches, so a mis-click in the sidebar can't cost a scene; a changed
file drops them with a word. ⚠️ A reload after a save keeps the story on
screen until the new one is read, so the address isn't written without its
scene as a spurious history entry.

**The title screen** is a row above the scenes — the one thing here that
isn't a scene. Its two lines are `config/words.js`'s, read and spliced back
by Save (`titleWords`/`withTitleWords`, its own commit made first), so the
rest of that form stays one link away. A words file reshaped past the two
lines shows no row rather than a wrong one. **Duplicate** sits in a scene's
`···` beside Delete: a copy under the next free name. The shape has no lines
after a choice on purpose, so "the door is locked, still in the hall" is a
second scene, and Duplicate is how one is made without retyping it.

The template **ships empty** — no cast, no scenes — so the first thing an
author meets is the **guide**: one card asking who the main character is,
how they look, where the story starts, what happens first, who else is
there, then where each scene leads, with every scene the story points at but
hasn't filled coming round as its own question. **Deterministic**:
`nextQuestion(model, paths, skipped)` in `story-editor.js` reads the next
question off the story and the file list — the same facts the checks read —
so the guide carries no state of its own beyond what the author set aside
(*Later*, cleared by *Ask me again*), and works on a new story, a half-built
one, or one hand-edited for a week. An ending looks like a scene without a
way out, so *Then what?* is asked once per such scene, and *The story ends
here* sets it aside. Every answer edits the model and the autosave writes it.

A picture is a file, so the guide offers four ways to it: **Draw it** (a
blank PNG opened in the pixel editor), **Upload one**, **Make one for me**
(below), or **A plain card for now** — a flat card in the game's *look*, a
round face or place drawn on canvas. It costs nothing and never fails, and
is where the drawn one falls back to.

The shape grows two optional keys, `about` on a cast member and a scene: a
line for the studio and its helpers (never the game), shown as one field and
doubling as what to draw on the picture card. Absent, it writes nothing, so
a story without it is byte-identical through a save.

#### Music, and sound as a step

Two ways to be heard, depending on whether it belongs to the scene or to a
moment in it.

**Music** is `music:` on a scene — a whole path under `assets/music/`, unlike
`sound:`, since a track has no one ending a bare name could give it. The
player calls `Sound.loop(track, 0.4)` on entering a scene and stops the
previous one only when it differs, so the same track **carries into the next
scene without restarting** — the sound library already leaves a running loop
alone, so this needed no library change. Quieter than a noise, since people
talk over it.

**A sound is a step among the lines**: an entry in `lines` that is only
`{ sound: "page" }`, playing the moment it's passed while the story carries
straight on (waiting for a tap would leave the box empty), or on leaving the
scene if written after the last line. `isSoundStep` tells the two kinds
apart; they share one list, so a noise drags between lines with the same
`moveLine`.

⚠️ **Scene-level `sound:` is the older shape**, meaning "at the start". The
editor reads it as a sound step in front of the lines and **never writes it
back** — saving an old story moves the sound into the draggable timeline, but
the template's player still plays the old key, so an unsaved story is
unchanged. Because a template is the game's own code with no sweep behind
it, every existing visual novel needs its `js/story.js` brought forward by
hand or its sound goes quiet on the first re-save.

On the stage a noise has nothing to show, so `stageFor` names it beside the
words still on screen. The guide counts *said* lines (`saidIn`), so a scene
holding only a door slam is still unwritten.

#### The two small asks

**Fill it in for me** and **Make one for me** are the studio's own requests
to the model: no helper row, chat, message, receipt, eligibility, cooldown,
tools, transcript or file block. One request, one answer, nothing kept —
`llm.complete()`, thinking off, a small `max_tokens`. Server-side, since the
key never reaches a browser, through the same two walls every reply goes
through: the studio-wide budget and the presser's own allowance, charged to
whoever pressed (§10). Neither is a *fire*, so neither leaves a row anywhere
but `user_tokens` and `studio_state`; the UI never says "prompt" or "model".

JSON is asked for in the system prompt and parsed by taking the outermost
braces, not through `response_format` — unmeasured by §14, and an
unrecognised parameter fails open there anyway, so the defensive parse is
needed regardless.

⚠️ **The story comes up from the browser, not off disk.** The guide works on
the unsaved model — the scene it asks about was likely made a moment ago and
may not be saved yet. It's the author's own words going into a prompt billed
to them, so the trust is theirs either way; every field is cut to a cap
rather than refused (§10), and a `who` the cast doesn't hold comes back as
the story narrating, so a fill can't leave a line said by nobody.

The **drawn stand-in** asks for a flat SVG at the kind's size and the game's
colours. The server checks only that it's plainly an SVG within 20 KB; the
browser probes it in an `<img>` (an SVG runs no scripts there, the same
probe the `.svg` editor uses, §7), draws it to canvas, and saves it as the
PNG the story expects — so the pixel editor opens it like any picture and
drawing over it is the next step. ⚠️ The probe is sized explicitly, since an
SVG with only a `viewBox` has no intrinsic size and draws as nothing. An
answer that won't draw falls back to the plain card; a refusal writes
nothing and lets its own banner stand.

These are the second and third *microhelper* — smaller even than the first
(the achievements helper): no tools, one request, JSON back.

The Mila story is the **example**: *Or put in an example story* on the first
card, while the story is empty, copies its seven files from the **standard
set** and saves the story with its endings marked meant.

#### The standard set

`public/story-art/` — pictures and sounds an author can use without drawing.
Studio-side rather than in the template tree (which is copied whole into
every game, so any size here would bloat every repository): one file copies
in when picked, one commit, no history or link back. `index.json` is the
registry: `art` (file, kind, name, `by`, `licence`, `who`/`mood` on a
portrait) and `examples`, whole stories the guide can insert.

The **shelf** is how it's picked, from four places — the guide stops asking
once a scene or a mood has a picture, so the others exist to *change* one: a
sideways-scrolling row on the guide's picture card; `Pick a face…` on a
mood's `···` in the story editor's person inspector, confirming first
(*Replace \<name\>'s \<mood\> face?*) when one is already drawn there;
`+ Pick a character from the shelf` / `+ Pick a picture from the shelf` in the
*Add a file* dialog, beside Upload and Draw — every picture of that kind,
shipped set and collection together, found by name or maker (forty-two
pictures is not a strip, ideas/calm-shell.md); and **Add from the studio**
under Pics, which asks for no kind at all and shows all three halves at once,
because a face, a place and a thing are three folders to the game and one
shelf to whoever is looking for a dragon — and still pictures only: the
index lists the example's page-turn sound beside them, and this shelf leaves
it out. The interface says **character** where the code says `portrait`, the
way it says **thing** for `sprite`; a **face** is one mood's picture of a
character, which is why a mood's `···` still says `Pick a face…` and the
dialog it opens is titled so. What people here made comes first on every
shelf — the guide's strip by order alone; the dialog under **Made here**,
with the rest under **Everything else**, all of the first and 120 of the
second — because in index order the collection sat behind the big set's
1,775 and past the cap, so a picture drawn here never showed until its name
was typed. The two labels appear only when there is something under each;
with nothing made here it is one grid. ⚠️ From the guide's card or a
mood's `···`, picking copies the bytes to the path the *story* expects, not
the set's own path — the set says what a picture looks like, the story says
what it's called ("Mila, worried" becomes `assets/sprites/ben-normal.png`);
from the other two there is no such path to expect, so it lands under a name
of its own, in the folder its kind belongs to — a face or a thing to
`assets/sprites/`, a picture to `assets/images/` — counted up past any
collision, and never over a file already there. Credit and licence ride the banner
and tooltip; the index is read once a session, the shelf filled in as it
lands rather than through `render()`, since the guide's card persists for as
long as its question stands. A plain `<img src>` works here, unlike a game's
own files, whose routes send `no-store`.

Pictures only — a sound has `+ Make a sound`, which beats stock ones.

What it holds: 33 portraits and 9 backgrounds, all CC0 — the studio's own
three-and-three from the example story, 30 animal faces by **Kenney**, and 6
pixel-art scenes by **Stealthix**.

`test/story-art.test.js` keeps a growing set honest: every file present in
the right folder, every licence named, a portrait's file matching its `who`
and `mood`, every example's art actually listed. ⚠️ A portrait must not be a
whole multiple of its own height — copied into `assets/sprites/`, that shape
reads as a *strip* of square frames to the sprites library, so a 2:1
portrait would animate instead of standing still.

#### The big set

`public/big-set/` — 1,775 CC0 pictures, written by `npm run pullart`
and committed. Where the standard set is 42 pictures somebody chose, this is
the half that is large and machine-gathered, so a kid can type a word and get
a picture with **no network, no key and no third party deciding what is
safe**. 5.3 MB; `index.json` is 350 KB, read once a session with the other
two halves.

One kind, `sprite` — one thing on a transparent background, landing in
`assets/sprites/`. A background or a portrait belongs in the standard set,
where somebody looked at it. The interface says **thing** (`Pick a thing`,
`+ Find a thing to put in` in *Add a file*); every id, route and paragraph
says `sprite`, the same split *editor*/author keeps. Pics' **Add from the
studio** reaches the same pictures without naming a kind, so the word only
has to be learnt by somebody working from Code.

Each entry carries `tags` on top of the standard set's fields — the pack's
own subject, or for a silhouette the words a kid would type. It is what makes
the set searchable at all: `Fish red` comes back for *underwater* and
`Triceratops` for *dinosaur*, and neither word is in either name. The shelf
dialog matches name, tags and maker, and ⚠️ draws at most **120** of the
shipped halves at a time with `loading="lazy"` — 1,775 `<img>` at once is a
second of layout for a grid nobody scrolls. The collection is never counted
against that: it is shown whole, above.

Three sources, all hand-listed in `bin/pullart.js` because ⚠️ **safety here is
the source list, not a filter**: a pack or a word is added by somebody who
looked at it, and there is no moderation queue behind that and none intended.

- **Kenney** — 16 packs, 1,685 pictures, shooter packs left out on purpose.
  The pack page is scraped for its zip and read with `bin/unzip.js`, which
  exists so no dependency has to.
- **PhyloPic** — 90 silhouettes, the only dinosaurs in the studio. ⚠️ Mostly
  CC BY, so its licence is checked per image and roughly half are left
  behind; ⚠️ its `filter_name` is lowercase and taxonomic — `owl` and `cow`
  answer 404 — so the list names taxa and carries the common word as a tag.
- **svgsilh** — up to 1,152 CC0 silhouettes, 12 for each of 96 game words,
  read through **the site's own search** (`bin/svgsilh.js`, tested against
  its real markup in `test/svgsilh.test.js`). `search/<word>-1.html` returns
  twenty RDFa cards, each carrying the file, its keywords and ⚠️ **its
  licence, from the people hosting it** — so `cards()` drops any card whose
  own `rel="license"` does not say CC0, rather than taking an aggregator's
  word about somebody else's file. The keywords are better tags than the
  search word alone: a tiger found under *animal* says *tiger* itself.
  **The word list is the curation**, which is why nobody has to audit its
  358,000 rows. ⚠️ Cloudflare refuses a datacenter address outright (403 on
  every path, `/svg/<id>.svg` included), so this source runs from a laptop or
  not at all.

This went through **Openverse** until its search went down on 2026-09-04 and
answered 504 to every query for an hour — filters or none, while its unsearched
endpoints answered in under two seconds. Reading svgsilh directly is one host
instead of two, no key, no published rate limit, and a licence one hop closer
to the file. The pull is a guest there all the same: it waits 400 ms between
requests, which is under ten minutes for the source.

It is the source most likely to refuse, so it goes **first**: a run that is
going to fail says so before sixteen pack downloads rather than after them.
It gives up after **four words in a row**,
because however it fails it fails on every word, and asking ninety more times
only makes knowing slower. A search page that answers *without cards on it* —
a 404 body, an interstitial, a challenge — counts as a failure rather than an
empty word, or a redesign would quietly write an empty source. ⚠️ Every fetch
carries a 30-second timeout, because Node's `fetch` waits forever and a host
that is *slow to refuse* costs more than one that refuses: without these rules
the Openverse outage was ninety minutes before the run said so, and with them
a refusal is seconds. It also stops if more than half its words fail overall.

svgsilh's half is kept as **SVG** — 2 KB against 40, and sharp at whatever
size is asked for. `artBytes()` rasterises one to PNG when somebody picks it,
through the same `<img>` probe the drawn *stand-in* uses (an SVG there runs no
scripts and loads nothing); every other entry is already a PNG and comes back
untouched. ⚠️ `svgBox()` reads the `viewBox` for the shape, because svgsilh's
files carry no width or height and an SVG with neither draws as nothing —
and it shaves a pixel off a whole multiple of its own height, because the
*strip* rule cannot be checked at pull time on a vector with no pixel size.

Nothing is resized by the pull — a decoder and an encoder is what that would
cost in a repository with no dependencies. Anything over 512 a side or 128 KB
(64 KB for an SVG) is skipped instead, and `asPng()` in the browser does the
fitting when somebody picks a bitmap, exactly as it does for an upload. Also
skipped: a picture that reads as a *strip*, and one whose name is a word and a
number (`characterBlue (13)`, `tile_0044`) — one of a run of near-identical
variants that would bury every picture somebody could have named.

`npm run pullart` is run on a machine that can reach the sources, like
`npm run sweep`, and never in `npm test`, which has no network. `--dry`
fetches everything and writes nothing, which is what a first run wants;
naming a source (`npm run pullart -- kenney`) pulls only that one.

⚠️ **Art belongs to whatever fetched it, and only a fetch that succeeded
replaces it.** A source declares what it is authoritative for this run —
Kenney *per pack*, the other two per source — and everything else in the set
is left byte for byte where it was. A picture the final index no longer names
is then deleted, so a picture dropped upstream still leaves rather than
lingering. This was "the set is written whole" until 2026-09-04, and that rule
was wrong twice in one afternoon: one host refusing took the other two down
with it and there was no way to pull the two that worked, and one pack's zip
timing out silently deleted its 27 pictures. The invariant worth having
survives at a finer grain, and the thing it was paying for turns out to be
free. A run only fails outright when **nothing** came back.

`test/big-set.test.js` checks what it left behind: every file
present, every picture drawable and under the caps, every silhouette carrying
a viewBox, no strips, no unsearchable names, every licence CC0 and credited in
`licences.txt`, and nothing on disk the index does not name.
`test/svg-box.test.js` covers the fit arithmetic, which is the half of the
rasterising that does not need a browser.

The quiz editor grew the same read, since a quiz's authoring bug is never a
typo: endings unreachable, or all fed by one answer.

The module reads its bindings through `try`/`catch` rather than assuming
`CONTROLS` exists, so a game loading only one of the two config files falls
back to playable rather than throwing on the first frame.

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

`Rename…` is in the file's `···` on its row under Code, with `Duplicate…`,
`Make pixel art…` for a picture, and `Delete…`, and takes the whole path, so
it also moves: `sprite.png` to
`art/hero.png` is the same one commit. The dialog says what the new name
will mean before it happens, and ⚠️ crossing into or out of `studio/` gets
its own sentence, because that is the one move that changes who may edit the
file rather than only where it lives. It is allowed either way — the
library is refused to *agents*, not to people (§4) — but not silently.

**Enter in a dialog's one text field presses its one filled button**, the way
a form submits — a new name, a new game's, a chat's (`submitOnEnter` in
`dialogs.js`). Only in a dialog with exactly one such field and one such
button: a page of fields with a button per row, Studio settings, is left to
its rows, and a textarea keeps Enter for a new line.

`Duplicate…` sits beside it and copies instead of moving, to one of three
places its own `Where to?` picks between: **this game** (the default), one
new file, one commit, the original untouched; **another game**, which opens
a second select for which one and calls `files/import` instead, the two
trees staying strangers to each other; or, for a picture, the **studio
collection** (§3), which calls `POST /api/collection` instead of either. The
name field for the first two is the *rename* dialog's own shape — just the
stem to begin with, the folder and ending fixed until "Change the folder or
the ending too" opens the whole path — pre-filled with a free `-copy` name
for this game, and the file's own name unchanged into another one, since
that tree has never heard of it. Landing in `studio/` gets the same sentence
a rename there gets. The within-game copy is made server-side from the bytes
on disk — so a picture duplicates without a round trip through the browser,
and unsaved editor text stays where it is, which the dialog says when it
applies — and its route refuses an occupied name rather than overwriting.

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
`?mode=<id>` for the centre's *mode* when it is not the chat — an editor's
id, `code` or `share` — with `?scene=<key>` for the story editor's selected
scene when it is not the first, `?file=<path>` for the open file under Code
or the filter on Share's versions, and `?version=<sha>` for the changes opened
there; or `?chat=<id>` for a conversation other than the one the project
opens on — never both, because a mode stands in front of whichever chat was
open, so Back to the chat is the address without `?mode=`. Addresses from
before are still read: `?edit=<id>` is a mode, `?tab=files` is Code, the
other tabs are Share, and `?tab=play` is nothing at all.
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
| GET, HEAD | `/` | the catalog: the studio's front door, in its own dark dress — wordmark, halftone, hairline. Published games as cards, names escaped, each wearing its `icon.png` before its name and its `hero.png` behind, when its tree holds them (§6), the hero under a dark wash, and its board's best score in gold; signed in, each card also says how *you* are doing — your *personal best* (gold, a score) and your trophies against what the game's `config/achievements.js` defines (`★ 3 of 7`, not gold: a count is not a score), counting only ids the file still defines. Sign-in and ask-to-join for the signed-out, name and sign-out for the signed-in. Under each card, *Scores & trophies* links to the game's players page. ⚠️ Sent with `frame-ancestors 'none'` and `COOP: same-origin` (§7) |
| GET, HEAD | `/:slug/_players` | the game's **players page** (`catalog.js`): one *personal best* per person, the game's achievements with who holds each — *nobody yet* when nobody does — and under those the board's top 100, the viewer's own rows marked in cyan. Nothing about scores while the game's `scores_on` is off (a moderated board is not public in either direction, as for both `_scores` routes); the trophies stay, because earned is forever. Removed accounts are joined out; a run posted before the sign-in shows under the name it was posted with. A plain 404 for anything that is not a game's. Same headers as the catalog: no form here, but one posture for the two studio-authored pages |
| GET, HEAD | `/:slug/_assets` | what the game has in `assets/`, live from disk: `{files: [{path, size, mime}]}` sorted by path, nothing outside `assets/` and never a path the validator refuses. `no-store`, like the game's own files, because live is the point. A plain 404 for anything that is not a game's. The preamble names it (§8), so a game can find its own pictures and sounds without a hand-kept list |
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
rows are kept — the switch, the admin's list, and delete-all live on the
studio origin under `/api`, because moderation is running the studio. A board
is moderated whole: **one score cannot be deleted**, by anybody, anywhere —
there is no route and no button, so the moves are switch it off or clear it.
The studio shows it as the Scoreboard part of Share.

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
