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
| GET | `/api/me` | — | current user, `alias` included |
| PATCH | `/api/me` | `{alias}` | your own settings — only the alias so far, through `setAlias` (§3); a refusal is a 400 saying why. Opened from your own name in the sidebar's bottom row (*Your settings*). ⚠️ No twin on the games origin (§7) |
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
| POST | `/api/projects` | `{name, slug?, kind?, template?, scheme?, design?}` | create row, and for a game its directory and git repo; slug derived from name when omitted; `kind` defaults to `game`; `template` copies a game-template starter tree in as a third commit — games only, validated against `public/game-templates/index.json`; no template means the blank start page instead. `design: true` — what New game sends — is a game born in **Game Design**: type `'design'`, the blank page, the default scheme, and `Humans only` alone; 400 beside a template or a scheme, which the cards decide. Answers with the project plus `chats` and `chat` — the conversation to open: `Building`, where the *builder* is waiting, `Humans only` for a game in Game Design, and a chat project's one room |
| POST | `/api/projects/:slug/design` | `{template?, scheme?, libraries?}` | Game Design's **Make it**, an editor's, once (409 after): the template's tree over the blank page — or none — the scheme's seed, the extras, and `SPEC.md` as the answers over the template's own spec, every heading of that one level down; all one commit, `make it: <title>`, the pending commit landed first. A template decides its own scheme and extras, as at creation; without one they are the body's, checked against the two indexes. Then the type is set, `Building` opened with the builder, and the answer is the project with `chats` and `chat` (`Building`) |
| GET | `/api/projects/:slug` | — | project, attached agents, recent messages |
| PATCH | `/api/projects/:slug` | `{name?, scores_on?}` | rename (display name only), and the scoreboard switch; a rename needs the project open, the switch is moderation and works archived |
| GET | `/api/projects/:slug/scores` | — | every kept score with id and time, best first, plus the switch: `{scores, scores_on}`. Each row is its alias as `name` and the account's name as `real`, for Share's *Show real names* — this origin only |
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
| PATCH | `/api/admin/users/:id` | any of `display_name`, `alias`, `daily_tokens`, `admin`, `studio_access`, `password` | change one; the alias goes through the same `setAlias` as a person's own, after any new name; the bit off ends their studio sessions, off-for-an-admin is 409, a password change ends both kinds of session |
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
| POST | `/api/projects/:slug/chats` | `{name}` | a new *builder room* under that name, the builder seated; games only, 409 for a chat project |
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
| POST | `/api/agents` | `{name, description, thinking?}` | create. A `model` or a `file_tools` from an old tab is ignored, never honoured |
| PATCH | `/api/agents/:id` | any of the above | update; 403 for the builder |
| DELETE | `/api/agents/:id` | — | soft delete; detaches from all projects; 403 for the builder |
| POST | `/api/projects/:slug/chats/:chat_id/agents` | `{agent_id, chatty?}` | put a helper in a *chat project*'s room; 409 anywhere in a game — `Humans only` and every *builder room* — and for the builder itself |
| PATCH | `/api/projects/:slug/chats/:chat_id/agents/:agent_id` | `{chatty}` | update |
| DELETE | `/api/projects/:slug/chats/:chat_id/agents/:agent_id` | — | take out; 409 for the builder, whose seat is the room's |

#### Messages

| method | path | body | effect |
|---|---|---|---|
| POST | `/api/projects/:slug/messages` | `{body, context_paths?: string[]}` | post a human message; fires eligible agents (§8) |
| GET | `/api/projects/:slug/messages` | `?before=<id>&limit=<n>` | page backwards through history; a *piece*'s row is left out, as it is from the project detail — its plan card stands for it (§8) |
| GET | `/api/messages/:id` | — | one message, as the thread would carry it. For a *piece*'s row, which lives behind its plan card and is opened from it (§8); anything readable is readable by anybody signed in, as the thread is |
| PATCH | `/api/plans/:id` | `{summary?, assumptions?, pieces?}` | change a plan's words while it is `draft` or `paused` (409 otherwise): the pieces given are the ones still to do, the done ones stay; each held to the sizing's own shapes, an empty list 400. The game's editors' to do, as the room is; broadcasts `plan.update` and marks the plan edited (§8) |
| POST | `/api/plans/:id/build` | — | Build it, or Carry on for a paused plan: the plan becomes the builder's next fire in its room, charged to whoever pressed; 202, or 409 while the builder is mid-fire there or the plan is not waiting (§8) |
| POST | `/api/projects/:slug/errors` | `{version, errors: [{message, location}]}` | record what the running game reported (§8); `version` is the commit the reporter was built with and the report is dropped unless it is HEAD; games only, allowed on an archived one |
| PUT | `/api/projects/:slug/shot` | `{data, version}` | keep the frame of the running game the preview just drew, for `look_at_game` (§8); `data` is a base64 `image/jpeg`, `image/png` or `image/webp` data URI, decoded and capped here and never trusted; one row per game, replaced; nothing broadcast |
| GET | `/api/messages/:id/receipt` | — | `{breakdown, prompt_held}`: what that reply was given and what each request cost (§8); a *plan card*'s is its pieces' as one — the last piece's context, every request in order, `pieces` counted — and `/prompt` on a card is its last piece's; 404 for a message with no receipt, a card with no piece landed included |
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
| POST | `/api/projects/:slug/libraries` | `{name}` — an **extra** studio library into the game, the studio's bytes, one commit `added the <name> library`; 400 for a name that is not an extra, 409 if held (§4) |

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
Twelve choices worth naming:

- **What it draws is smaller than what it opens.** `MAX_DRAWN` is 256 and
  `MAX_SIDE` is 1024: a picture made here is at most 256 a side — and at most
  256 per *frame* of a strip, whose whole width is still held to `MAX_SIDE` —
  while anything uploaded up to 1024 still opens to be drawn on. The line is
  where the editor already changes character: past 256 it stops blocking the
  pixels up (`chunky` in `renderDrawing`) because the picture is being shown
  at or below its own size, and a one-pixel brush is thinner than the pane can
  show. Above the line what comes out is a photograph drawn by hand rather
  than pixel art, so the studio does not offer to make one.

- **`Modify image…` is how a picture changes whole** (`modify-image` in
  `dialogs.js`; ideas/pixel-editor.md, item 4; formerly *Make pixel art*):
  in any picture's `···`, and offered by Upload before the bytes land for a
  picture over `MAX_SIDE`, the one kind the editor cannot open. Three
  sections, each headed by its own switch and each optional — **Crop**, a box
  dragged around the part wanted; **Resize**, the longest side brought to one
  of the editor's sizes or to 512 or `MAX_SIDE`, for a backdrop or a hero
  that is not pixel art and still wants cutting down; **Recolor**, every
  pixel snapped to the game's palette with every edge made hard — the result
  shown blocked up before anything is written, with the note saying what size
  was boxed and what it becomes. Touching what is under a switch turns it on
  (dragging a box, picking a size) and the switch turns it off without losing
  the box or the size, which is how a crop is undone. Everything starts off —
  the dialog opens on the picture as it is and the button waits until one
  switch is on — except for a picture over `MAX_SIDE`, which comes in with
  Resize on at `MAX_SIDE`, the one change that has to happen. Four
  operations in `pixel-editor.js`, each tested without a screen — a crop, a
  box-average shrink weighted by alpha, the nearest palette colour, and
  posterize — and `modifyPicture`, the three sections as one call. The dialog
  works on a working copy fitted into `MAX_SIDE`, so a 4,000-wide photo's box
  moves at the speed of a finger, and a picture over `MAX_SIDE` comes down to
  it whether or not Resize is on, which the note says. ⚠️ Not an undo step —
  a step is indexes into a picture of one width — so it **replaces** the
  file: the same path for a PNG, the old bytes a version; a `.jpg` becomes
  the `.png` of the same name and the `.jpg` is deleted, as under Rename,
  since only a PNG keeps see-through parts — the write and then the delete,
  two commits, and the dialog says the game will have to ask for the new
  name. Duplicate first is how to keep both. Under `assets/sprites/` a result
  a whole multiple wider than tall comes out one pixel narrower, as the
  guide's `asPng` does, so the sprites library does not play it.

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
- **The picture has a box of its own and the canvas fills it**, so there is
  no letterbox and the pointer maths is a division. `.picture-box` is given
  both sides in pixels off one scale by
  `renderDrawing`, the edge and the frame lines are inset on it, and `.media`
  centres it while it is smaller than the pane and scrolls it once it is
  bigger — which is the whole of panning. ⚠️ Sizing by `width: 100%` and a
  capped height is what squashes: a canvas has an intrinsic size, so that
  draws a 16-square sprite at 16 by 7. Both sides in pixels is exact.

- **A freehand stroke is stamped one pixel behind the pointer**, so that
  **pixel-perfect** can drop the corners a hand did not mean: where three
  pixels in a row make an L, the middle one goes and a clean diagonal step is
  left (`isCorner` in `pixel-editor.js`). ⚠️ The question cannot be asked
  until the pixel *after* the middle one arrives, which is why the stroke lags
  rather than being filtered afterwards — filtering afterwards means
  un-drawing pixels already in the step, and a stroke that crosses itself
  makes that the wrong answer. The lag is one pixel of movement and a tap that
  never moves is only ever the held pixel, flushed when the pointer lifts.
  It applies **at one pixel across only**, with no switch: wider than that the
  doubling is inside the brush and invisible, and dropping a corner would thin
  the stroke. The lag runs either way, so there is one stroke path rather than
  two. A deliberate square corner is what Rectangle is for.

- **A shape is dragged out and exists nowhere until it lands.** Line,
  Rectangle and Ellipse (`SHAPES` in `drawing.js`, `drawRect` and
  `drawEllipse` in `pixel-editor.js`) are drawn from the pointer going down to
  where it is now — two corners, neither of them a centre, which is what a
  hand is actually doing. While the pointer is down the shape is on a **preview
  canvas** over the picture, drawn by *the same call* that will land, into a
  scratch picture; the real picture is not touched and no step is opened, so
  an abandoned shape costs a clear and a landed one is one Undo. ⚠️ `spotOf`
  answers in the picture's coordinates and the preview holds one frame of a
  strip, so the frame's offset comes off for the preview and stays on for the
  real thing. **Fill it in** (`S.drawPrefs.filled`) is the rectangle's and the
  ellipse's alone and is left out for everything else. Filled and outline come
  out of one arithmetic rather than two — the outline is the boundary pixels,
  the fill is the span between that boundary's own ends on each row — so
  turning it on cannot move the shape's edge by a pixel. The ellipse is
  Bresenham's bounding-box form, which gets odd and even diameters both right.
  **Everywhere** (`S.drawPrefs.everywhere`, `replaceColour`) is Fill's alone in
  the same way: every pixel of the clicked colour rather than only the ones
  joined to it, one Undo. It goes through the clip like every tool, so on one
  frame of a strip it means that frame and *Whole strip* means all of them.

- **Zoom is Fit or a whole number of screen pixels per picture pixel**
  (`ZOOMS` in `drawing.js`, `S.drawPrefs.zoom`). Fit is as big as the pane
  allows and is where a picture opens; `−` and `+` step from whatever the
  scale currently is, so the first press from Fit changes something you can
  see instead of jumping to 1×. A zoom holds the middle of the view still,
  survives the pane resizing under it, and is a standing choice like the tool
  and the brush. A trackpad pinch — a wheel with ctrl held — zooms; a plain
  wheel scrolls the pane. One finger draws, so two are how a picture bigger
  than its pane is moved about, and a second finger landing ends the stroke
  the first one started rather than bending it. ⚠️ Ending it there must not
  render: a render replaces the canvas under the fingers still on it.
  From 8 screen pixels a square (`GRID_FROM`), Fit included, a **grid** shows
  the lines between squares, with **Every 8** in the bar beside the zoom for a
  brighter line every eighth square — left out while there is no grid. It is
  an SVG in the picture's own units (`gridPath`) with one-screen-pixel
  strokes, so each line is placed on its own square's edge, at a fractional
  Fit too, and nothing is sized by hand; display only, like the edge.
  The canvas's floor against the tools' is
  `clamp(min(150px, 25vh), calc(100vh - 470px), 320px)` — too small a floor
  and the canvas goes to nothing, which is no canvas at all since a pointer
  has to land on it; too big a one and the palette had 24px to live in on a
  phone held sideways.
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
  Save. The seven tools are icons, with words on `title` and `aria-label` so
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
is a row that lies; the browser's answer outranks the switch. Absent where
`Notification` does not exist — except an iPhone or iPad in a Safari tab
(`navigator.standalone === false`), where it only exists for the studio opened
from the Home Screen: there the bell is offered and its press says so, for the
same reason as the next sentence. ⚠️ Offered while the browser is
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

⚠️ **The announcements reach a bell that is off** (2026-10-02). Off is
quieter rather than silent: pressing the bell off subscribes the browser
again with `announcements_only: true` instead of unsubscribing it, every open
renews that wherever the browser has said yes, and an announcement is shown
in a hidden tab with the bell off too. So an announcement goes to every
subscription and anything else to the bell-on ones (`audience` in
`server/notify.js`). The bell says so in its title. A browser that never said
yes is the one place an announcement cannot reach, past its mark.

**The announcements are pinned over the sidebar** — above the search box and
the tabs, outside every list and every filter, with 📣 in front of the name
and the last thing said under it — because it is the studio talking to
everybody rather than another conversation to look for. It opens like any
chat project; it lights up in the studio's cyan while something in it is
unread, over the mark every row wears. Its composer is an admin's: anybody
else reads *Only an admin writes here. You can still react.*, and there is no
`+` for a helper and no Archive in its `···`.

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

⚠️ **Every push shows a notification, a studio window on screen included.**
Until 2026-10-01 the worker skipped one while a window was visible, taking
that for the exemption `userVisibleOnly` allows. WebKit allows none: a push
that shows nothing gets its subscription revoked, so every iPhone, iPad and
Mac Safari would have lost push the first few times somebody spoke while
it was open. In a studio this quiet the banner is wanted anyway — it is
what is being said in the rooms you do not have open. A hidden tab shows
rung 1's and the push's, and the shared `tag` collapses them into one.
⚠️ **The studio subscribes again on every open with the bell on**
(`renewPush`), because the bell reads permission and preference rather than
the subscription and would go on saying 🔔 over one the browser had dropped.
The server takes a repeat as an update to the same endpoint. ⚠️ **404 or 410 from the
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
collects **stamps** in the order its type sets: seven for the arcade, eight
for a visual novel — story where the loop is, reading aloud where tuning is —
five for a quiz, and a blank game takes the arcade's seven with the question a
template would have answered in front — whose check, a `SPEC.md`, Game Design
has usually ticked already. A game still in Game Design has no `Building`, so
no card.
The card numbers them from their position — *Step 3* — so no stamp's name
carries a number of its own. ⚠️ The stamps themselves — their ids,
their order and every word on them — are `public/arc.js` and are not repeated
here: they are the wording of a card a kid reads, reworded whenever the words
are wrong, and a list of them in the design-of-record is a second truth that
goes stale the first time somebody improves a sentence. The tests hold the
ids for the same reason. Each stamp is one principle real game makers hold,
in a kid's words, with what makers say about it, the **checks** the studio
ticks from the
tree and the row (names, never a file's bytes), and two or three **asks** —
pressed, the request lands in the composer, unsent, so a kid learns what to
ask for by asking for it. The stamp is the person's call: *This one's earned*
moves `projects.stage` (§3) by one, the card's `···` takes one back, and the
checks are hints, never gates — publishing never waits for a stamp. Editors
press; everybody sees. The head is the fold (per game in `prefs`), and with
every stamp earned the card is gone — a done game has nothing left to guide —
and the last stamp's take-back goes with it, a price accepted on 2026-09-30.
Building only,
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

**A `:name:` in a message becomes its emoji on the way out**
(`public/shortcodes.js`, decided 2026-10-02): the thousand emoji used most,
by Unicode's 2021 frequency ranking, under every name GitHub's gemoji gives
each, typed into the file under gemoji's MIT notice. ⚠️ Less four, because
kids use the studio: 🖕 🔞 🔫 🚬 under any name, and 💩 as `:poop:` and
`:hankey:` but not its third — 996 emoji, 1,029 names, held by a test that
asks of the emoji rather than the names. It happens
in the browser, in `sendMessage`, before the pending bubble is drawn, so what
shows while it sends is what was sent; the stored body holds the emoji and
never the name, and the server takes it like any other text, cap included.
Any case; never with a letter or digit against either side, so `10:30:45`
and `1:100:1` stay as typed; never inside backticks, where code pasted for a
helper is meant character for character. A reaction is untouched — its
palette is a fixed twenty (§10).

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

With nothing more specific selected, the inspector is the **tweaks**
(`public/tweaks.js`, 2026-10-04; until then the scores and achievements,
which live under Share alone now): the game's tuning files under the preview
— every `config/` file but the ones that are content with editors of their
own — as the config form's own rows, `config/play.js` open and the rest a
click away. A value changed there is **tried**, not saved: it goes into the
running game at once, the preview player writing it into the live object
(`PLAY.GRAVITY = 600`; a `const` that is a plain number cannot be written to
and keeps what the file says), its row lit cyan with a dot, and it is kept in
this browser for this game. Every new page of the preview is handed the
tweaks before the game's own code runs — each file's the moment that file has
run, from the games origin's own copy the player keeps — so a reload keeps
them, and so does Back to a pin. Kept as values where they sit, never as a
copy of the file, so somebody else's change to the same file meanwhile
stands: **Save them** splices each tweak into the file as it is then and
writes it, and **Undo** drops them all and reloads the preview, since a value
written into a running game cannot be taken back out. The rail is meant to be
the preview player's alone; what the editors keep in it is to move into the
centre (TODO.md). **Make some with the builder**, which this section once
carried for a game with no achievements, is beside *+ Add an achievement*
under Share. It opens the game's builder room called *Achievements* — making
it the first time, Building when the game already has every room it may —
with the ask waiting in the composer, unsent. An achievement is a rule over
the moments a game says, and saying them is code, so the first ones are the
builder's job rather than the form's.

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
file is the mode. **On a phone the row is the view changer** (§17): ‹ and › step
through the same modes in the same order and wrap, the one you are on is
named between them with its `what` under it, and Preview beside them opens
the rail and closes it again.

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
mood) over **Places** (backgrounds, with scene counts); for an *adventure*,
**Places** then **Things** (the pictures its spots pick up); for every game,
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
order and words — the same ones Game Design's *How do you play it?* offers (§4) — with the
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

The libraries under `studio/` — the seven in the core set and the physics
and render3d extras, what each does, the manifest, the compatibility law, the sweep, and
picking a game's control scheme — are documented separately, in
spec/06-studio-library.md.

### Game Design

New game asks a name and nothing else (decided 2026-10-04, ideas/dreams.md
§2): the game is born in **Game Design**, type `'design'` (§3), holding the
blank page, the default control scheme, and `Humans only` — no `Building`,
since nothing is decided yet to build — and it opens on its one editor, the
**Game Design** pill (`game-design-form.js` over `game-design.js`). Its modes
leave out Controls: how the game is held is one of the cards.

The pane is the story guide's posture as a whole page. One card at a time,
the next read off `SPEC.md`, each answer that card's `## ` section of it, so
the cards work on a spec somebody has been editing by hand and the only state
is the file. *Not sure yet* is always an answer. The six every game is asked:
**What do you do?** (seven choices, one per template, and *Something else…*),
**Who are you?**, **Where does it happen?**, **What are you trying to do?**,
**What gets in your way?**, **How does it end?** — and when the first answer
names no template, three more: **How do you play it?** (the six schemes in a
kid's words), **Flat or 3D?** and **Do things fall and bounce?** (the two
extras). What has been answered sits over the card, a row each with
*Change*.

Under them, **How it's made**: what Make it would make, from a table — the
first answer's template, or a blank page with the free-form cards' scheme and
engines — no model anywhere. *Start from* overrules it with any template or a
blank page. The button reads *Skip to making it* until every card is answered
and **Make it** after; both are `POST /api/projects/:slug/design`, which
writes it all as one version, opens `Building`, and the game opens where a
game of its kind opens (its editor, else `Building` with a template's heart
under Code). Another tab sees the type change on `project.updated` and opens
the game again. A spec editor for coming back to the cards later is a
different thing and not built. Jev — a typed-decision model — for reading a
*Something else…* answer is planned, not built.

### Game templates

A **game template** is a starter tree: Game Design's *How it's made* picks
one (or the API's `template`), and the chosen template's files are copied in
server-side right after the library scaffold, as one commit. From then on they are the game's own — no version,
no updates — unlike a library, since genre code must stay editable: "add a
timer to my quiz" has to land in files a helper can change, not behind the
`studio/` write-wall. Not a fork either: a fork copies history and attached
agents; a template wants a clean thread and current libraries.
`public/game-templates/` is the source (distinct from `public/templates/`,
the seeds); its `index.json` carries the dialog's words and is the
validation list. Every template follows one shape: a remixable heart in a
config file, a pre-written `BRIEF.md` and `SPEC.md`, the library script tags
already in `index.html`, a `js/robot.js` teaching the preview's **robot** to
play it (below), and placeholder assets the studio's own makers can
replace. Server-side copying is byte-safe, so templates can ship sounds and
pictures.

"A blank page" — the dialog's other, default choice — is one page, committed
after the library scaffold like a template, from
`public/game-templates/blank/index.html`; a game with no `index.html` is
nothing the games origin can serve. That page is the one thing under
`game-templates/` not copied byte for byte (`{{name}}` becomes the game's
name, escaped), and is absent from `index.json` since the dialog already
offers it as the empty choice. It loads every library the game holds — the
core set, since a blank game holds no extra —
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
agents could not see pictures then (§14; they can since 2026-09-12, and still
cannot measure one) — a visual novel has no coordinates anywhere, so nothing
about it was blocked on eyes. Building it first also settled the vocabulary
the adventure inherits, `set`/`need` rather than the sketch's `flip`. The
adventure itself is at the end of this section.

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
saves first, then reloads the preview and puts it on the scene through the
*preview player*'s savepoint — `{playing, scene, line: 0}` laid over the
game's State and pinned (`tryFrom`, below) — held while the editor shows, so
each save's reload lands back there. The game takes no way in from its own
address any more: a player cannot skip to an ending with `?scene=`. ⚠️
Unsaved edits park per game on leaving and return while the file's etag
still matches, so a mis-click in the sidebar can't cost a scene; a changed
file drops them with a word. ⚠️ A reload after a save keeps the story on
screen until the new one is read, so the address isn't written without its
scene as a spurious history entry. It keeps the person whose card is open
too: a save's own `files.changed` often lands after its PUT has answered,
and the re-read closed the card mid-edit. On a phone *Try this scene* also
goes to the rail, where the preview is.

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
`Modify image…` for a picture, and `Delete…`, and takes the whole path, so
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

#### The point-and-click adventure

The **adventure** is the fourth template (`public/game-templates/adventure/`,
key `adventure`, built 2026-09-15 from ideas/point-and-click.md). Its heart
is `config/scenes.js`, `SCENES` alone: each **scene** a `picture`, an
optional `about`, and its **spots** — a box on the picture,
`at: [x, y, width, height]` in the picture's own pixels, and exactly one of
`go` (to a scene), `say` (a line, or a list read one at a time) or `take`
(an **item**, which may `say` as it goes). Any spot may `need` a *switch*,
`set` one, and play a `sound`; a take is gone once taken unless `keep: true`,
and taking an item sets a switch of the item's own name, so a locked door
`need`s the key by name. A click lands on the first spot, top to bottom,
whose box holds the point and whose need is met — two spots on one box with
different needs are a door locked and then not — or on nothing, and the box
says *Nothing happens.* What the player carries is a strip in the top corner:
`assets/sprites/<item>.png`, or the word until there is one. A scene with no
spots is the end, the visual novel's rule reused rather than a key added. DOM
like the story: the picture is an `<img>` drawn to fit, and `js/adventure.js`
lays its spots layer over exactly the drawn part of it, so a click's place in
the layer is a place in the picture's pixels on any screen. It fixes the null
*control scheme* — the pointer is the control and a touchscreen needs nothing
drawn — and the pad-driven cursor stays a TODO line of the input library's.
Ships empty and pictureless; the **example**, *The Key and the Cake*
(`story-art/examples/key-adventure.js`, `examples.key` in the set's index),
is four scenes on the standard set's porch, hall, kitchen and dawn sky, with
a plain *stand-in* drawn for each of its two items when it is put in.

The **adventure editor** (`public/adventure-editor.js` the model,
`public/adventure-form.js` the interface, the **Scenes** mode) is the story
editor's three regions with the stage doing more. The strip: every scene
with its problems and its tail (*3 spots* / *the end*), then the **Things** —
the items, each saying whether it has a picture. The **stage** is the scene's
picture with every spot drawn on it as a box in the game's primary colour,
sized by the editor to the biggest box of the picture's shape that fits so
the picture fills it exactly and a box's percentages are the picture's own
pixels; **dragging a box on the picture makes a spot**, dragging a box's
middle moves it, its corner grip resizes it, and a tap on one opens its row.
Under it one row per spot — *goes to* / *says* / *picks up*, then its target,
its words or its item, then *only if*, *remembers* and a sound — and the
scene's problems; the bar carries the whisper, *Show the text* and *Try this
scene*. The rail holds the scene's name, ways in, note and picture (with
*Pick a picture…* to the shelf and the picture's size), an item's picture
with *Draw one* / *Pick a thing…*, or the title screen's two lines. It saves
itself like the story's, regenerates the file (byte-identical on an untouched
save), parks unsaved edits per game, and has its own conflict dialog. ⚠️ The
checks read the whole graph and what the editor has learned of the pictures'
sizes: a scene nothing leads to, a `go` to a scene that is gone, a switch
nothing sets, an item with no picture (said by the path it wants), a sound
not in the game, a spot under an earlier one asking for the same thing (the
first wins every time, so it can never be clicked — different needs are the
locked door and fine), and **a spot off the edge of its picture**, the one a
picture replaced by a smaller one causes. Its guide asks where the adventure
starts, what that looks like (the shelf, Draw it, Upload one, a plain card —
no *Make one for me*, which is the story's), what is there to click on
(answered on the stage, or *The adventure ends here*), then every scene a
spot leads to but nobody has made, then a picture for each item. Pics shows
an adventure's **Places** then its **Things**. ⚠️ Helpers are told what a
spot is and **never to write or change an `at`** (§8): a helper can look at
a picture and cannot measure it, and a box guessed from a look is
confidently wrong, so it adds a spot with any other change and asks the
person to drag its box into place.

#### The racing game

The **racing template** is the fifth (`public/game-templates/racing/`, key
`racing`, "A racing game", built 2026-09-15 from ideas/racing-template.md):
laps on a closed track against rivals, with the track the thing a kid most
wants to change. Its heart is `config/track.js`: `TRACK` — `width`, the
`points` the road passes through in order in the game's own 960 × 600
world, closing back to the first on its own, and `start`, which point the
start line sits at — and `THINGS`, what sits on the road, each a `kind`
(`rock`, `boost`, `puddle`), an `at` and a `size`. The road is the closed
polyline through the points stroked `width` wide, and **one distance test is
the whole physics of "off the track"**: a car, or a thing, is on the road
when it is within half the width of the nearest segment — the same test the
editor's checks read, so the game and the editor agree. `config/play.js` is
the feel (turn, thrust, drag, top and boost speed, the rivals' speed and
wobble, what the grass, a rock, a pad and a puddle do, laps, the countdown,
par and place points); `config/words.js` the words and the place names;
`config/look.js` the four colours, the road's and the size. ⚠️ It is the one
template that **ships its own `config/controls.js`** — `buttons`, with
`left`/`right` as the big pair under one thumb and `GO` plus a latching
`BOOST` under the other — because no seed says those words; the registry
fixes the same scheme, the seed lands first and the template's copy lands
over it, which is also what an explicit `scheme` on creation is overwritten
by. `js/race.js` measures the road once (each segment's length and where it
starts round the loop), draws it once to its own canvas, counts a lap when
the car's progress wraps forwards past the start and uncounts one backwards,
runs rivals down the centreline in lanes with a wobble and rubber-banding,
and finishes on `Screens.title` with `post` and `board`: the score is ten
points a second under `PAR` plus `PLACE_POINTS` a rival beaten, bigger being
better on the board. Moments: `lap`, `bash`, `boost`, `finished` (the time),
`place`, `score`; the shipped achievements are rules over them. Its four
sounds — `engine` looped while GO is held, `bash`, `boost`, `lap` — are made
by the studio's own sound maker so each opens in the sound editor; a car
drawn at `assets/sprites/car.png` replaces the triangle. `test/racing-
template.test.js` holds the shape: every studio call in its place, every
verb the game asks for bound in its own controls file, every achievement
over a moment it says, and the shipped track one the editor reads clean.

The **track editor** (`public/track-editor.js` the model and geometry,
`public/track-form.js` the interface, the **Track** mode) is the canvas: the
game's world, drawn by the studio from the unsaved model — the road at its
width, the start line, what is on it — with the **points as handles**, a
thumb's size on screen whatever the canvas is scaled to. Drag a handle to
move it; click on the road between two handles to add a point there, already
in hand; drag a rock, a pad or a puddle to move it; Delete takes the selected
one out, never below three points. The column beside it holds the width as a
slider, how long the loop is, **On the road** — a row per thing and a button
to drop each kind, landing on the road nearest the middle — and the checks;
the rail holds the selected point's or thing's own numbers, *Start here*, and
the way to take it out. ⚠️ **Explicit Save**, unlike the story's and the
adventure's: a half-dragged track is a race nobody can finish, and Save is
what puts the preview on the new road; *Try it* saves first. Regenerates the
file (byte-identical on an untouched save), parks unsaved edits per game,
`if-match` and a conflict dialog on 409. Its checks are what only the whole
track can say: the road **crosses itself** (two non-neighbouring segments
intersect, drawn in crimson where they do), a segment **shorter than the road
is wide** (a kink), a thing **off the road** where no car can meet it, the
start on a point that is gone, and — when `config/play.js` reads in the plain
shape — a track so short a rival laps it before the countdown ends. Helpers
are told the track is drawn and **never to type or change the points** (§8):
a track written from numbers is a track nobody drove. The interface says
**On the road** for what the file calls `THINGS`, because *thing* is already
the interface's word for a picture a spot picks up or a sprite on the shelf.

⚠️ The track editor's canvas is the **plan canvas** now (`public/plan-canvas.js`,
since 2026-09-22), shared with the world editor below: the canvas in world
pixels, the pointer mapped through the drawn box, the drag held by pointer
capture, handles measured in screen pixels, Delete for the selected thing.
The canvas takes focus when pressed — the preview's game holds the keyboard
otherwise, and Delete never reached the studio — and Delete is answered only
while a plan canvas is on screen. On a phone the canvas keeps its own height
and the column under it scrolls (`css/plan-editor.css`).

#### Knock it down

The **knock-it-down template** is the sixth (`public/game-templates/knockdown/`,
key `knockdown`, "Knock it down", built 2026-09-22 from ideas/modularity.md)
and the first born holding an **extra**: its index entry names `libraries:
["physics"]`, so creation installs the physics library beside the core set.
A sling, a pile of crates and stone, and targets in it; a few shots to knock
every target down. Its heart is `config/bodies.js`: `BODIES`, each a `kind`
(`box`, `block`, `ball`, `target`), an `at` (its middle), a `size` —
`[wide, tall]` for the square kinds, a radius for the round ones — and, for
the square ones only, an `angle` in degrees; and `SLING`, `{ at }`, where the
shots come from. ⚠️ A `block` is the one kind that never moves, and the file
does not say `still`: the game adds it when it builds the level, so the kind
is the one truth. `config/play.js` is the feel (shots, gravity, bounce,
friction, the shot's size and weight, how hard the sling throws and how far
it pulls, the aiming dots, how hard a target must be hit — `POP` — how long a
shot waits for the dust to settle, and the points). The scheme is `none` and
the template ships its own `config/controls.js`: the sling is pulled on the
canvas with a finger or a mouse — pressed anywhere, so a small screen needs no
precise first touch — and the keys turn the aim, change how hard, and fire.
`js/knock.js` builds the level with `Physics.build`, steps it, knocks a target
down on a hit at `POP` or harder or when it leaves the world, ends a shot when
`Physics.moving()` is false or `SETTLE` runs out, and finishes on
`Screens.title` with `post` and `board`. Moments: `shot`, `crash`, `pop`,
`cleared` (the shots it took), `score`. Its three sounds — `hit`, `pop`,
`fling` — are the sound maker's. A target drawn at
`assets/sprites/target.png` replaces the face. `test/knockdown-template.test.js`
holds the shape and ⚠️ runs the shipped pile through the real physics for
three seconds: nothing moves and nothing is hit hard, because a pile that
falls before the first shot is a game that plays itself.

The **world editor** (`public/world-editor.js` the model and geometry,
`public/world-form.js` the interface, the **World** mode) is the plan canvas
over the bodies, drawn from the unsaved model with the sling as the game
draws it. Drag a thing by wherever it was pressed to move it; the chosen
one's white dot sizes it (a rectangle's corner in its own turned frame, a
round thing's edge); drag the sling; Delete takes the chosen one out. The
column holds a button per kind — dropped in the middle of the sky — a row per
thing and the checks; the rail holds the chosen thing's kind, place, size and
turn, or with nothing chosen the sling's place. Explicit Save, like the
track's. Its checks: **nothing to knock down**, **nothing still** (no block,
so everything falls off the bottom), a body **past the edge of the world**,
two bodies **starting inside each other** — measured by separating axes for
two rectangles, the nearest point for a ball against one — which the physics
throws apart on the first frame (two blocks may overlap: neither moves), the
**sling inside something**, and more than 60 things, past which a phone
crawls. Helpers are told the world is built by hand and **never to type or
change a body's `at`, `size` or `angle`** (§8). The interface says **Crate**
and **Stone** where the file says `box` and `block`.

#### Roll a ball

The **roll-a-ball template** is the seventh (`public/game-templates/rollball/`,
key `rollball`, "Roll a ball", built 2026-09-23) and the first game in 3D: it
is born holding the **render3d** extra, and its page is the one whose own
code is a module (`js/roll.js`, after `studio/render3d.js`, after every
classic script). A ball on mazes seen from behind, rolled to each goal with
coins on the way, a goal taking it on to the next level. Its heart is
`config/level.js`: `LEVELS`, the levels in the order they are played, each
rows of characters seen from above, the top row the far end — `#` a wall, `.`
floor, a space a hole, `S` the start, `G` the goal, `o` a coin — the
move-and-collect heart ideas/templates.md sketched; and `SQUARES`, the game's
**kinds of square**, each a letter the six do not use with exactly
`{ name, colour, solid }`. A short row reads as ending in holes, since a
text editor is apt to trim trailing spaces. The game draws every kind of
square in its colour before it does anything — a block the ball bumps into
when `solid`, a marker on the floor when not — and runs its letter's function
in `ON_SQUARE` (`js/roll.js`) when the ball rolls onto one, so a new kind is
seen the moment it is painted and the builder only writes what it does. The
run starts on the first level, always — `?level=` is gone from the game, so
nobody skips ahead — and *Try it* puts the preview on the level being painted
through State: `{playing, at, coins: null}`, no coins being how the game
knows to arrive at that level fresh. The coins and the clock carry across, a
level's goal says `level` with its number, and the last one's is the end
(`LEVEL`, one level, was the shape until 2026-09-28; the editor declines it,
and the one game made from it was brought forward by hand). A level with
no `S` starts the ball on its first floor square. `config/play.js` is the feel (the
ball's size, push, top speed, friction, brake, bounce, falling, how close a
coin must be, respawn, points), `config/look.js` the colours, the walls'
height and where the camera sits. Scheme `stick-buttons`, its own
`config/controls.js`: the stick rolls it, a round **STOP** button brakes. The
rolling is the game's own — a circle on the grid, pushed out of each wall
square it overlaps and keeping `BOUNCE` of the speed it hit with, dropping
when the square under its middle is a hole — because a few lines say that
better than an engine would; three.js only draws, the floor and the walls one
`Render3D.boxes` call each, drawn afresh on `Render3D.clear()` as each
level begins. Moments: `coin`, `fall`, `level` (the one just finished),
`goal` (the run's time), `score`; sounds `coin`, `fall`, `goal`. `test/rollball-template.test.js`
holds the shape; the game itself was played in a WebGL browser through the
Playwright MCP tools, where the shot was read back lit.

The **level editor** (`public/level-editor.js` the model, `public/level-form.js`
the interface, the **Level** mode) is the plan canvas as a tile painter: the
chosen level from above, a square a cell — walls pale, floor dark, the start
and the goal in the game's `primary` and `accent`, a coin pale rather than
gold (gold is a number in the studio), a kind of square in its own colour
with its letter, as a block when solid. Over the palette, **Levels**: a row
each, the chosen one lit and in the address as `?level=` past the first,
Duplicate, Move earlier, Move later and Delete in its `···` (never the last
one), and `+ Add a level`, which puts a walled room with a start and a goal
after the chosen one, so a new level is one the ball can already finish.
Pick what a square is — Wall, Floor, Hole, Coin, Start, Goal, or a row under
**Made up for this game** — then click or drag to paint; a second Start or
Goal moves the first. `+ A new kind of square` takes the next free letter,
a name to change and a colour, and the rail is where it is named, coloured
and made solid; its `···` has Delete only while no level uses it, since a
letter SQUARES no longer names would shut the editor out of the file. `+ Row`, `− Row`, `+ Column`, `− Column`
grow and shrink the grid at the near end and the right, between 3 and 24 a
side; squares the ball can never reach are dimmed. The plan canvas takes its
shape from the grid and is never much taller than a track's. Explicit Save,
like the track's; *Try it* saves, then puts the preview on the chosen level
through the preview player's savepoint, as *Try this scene* does (the
editor's `viewParam` is the studio's address alone now). Its checks, per level, with each
level's count on its row: no start or more than one, no goal or more than
one, the goal the ball **cannot roll to** (a search from the start, four ways,
never through a wall, a solid kind of square or over a hole), coins it cannot
reach, and a level past 24 a side. ⚠️ No studio surface draws 3D: the plan is flat, and *Try it*
is where the level is seen as the game draws it.

### Games origin (`GAMES_PORT`)

| method | path | effect |
|---|---|---|
| GET, HEAD | `/` | the catalog: the studio's front door, in its own dark dress — wordmark, halftone, hairline. Published games as cards, names escaped, each wearing its `icon.png` before its name and its `hero.png` behind, when its tree holds them (§6), the hero under a dark wash, and its board's best score in gold; signed in, each card also says how *you* are doing — your *personal best* (gold, a score) and your trophies against what the game's `config/achievements.js` defines (`★ 3 of 7`, not gold: a count is not a score), counting only ids the file still defines. Sign-in and ask-to-join for the signed-out, alias and sign-out for the signed-in. Under each card, *Scores & trophies* links to the game's players page. ⚠️ Sent with `frame-ancestors 'none'` and `COOP: same-origin` (§7) |
| GET, HEAD | `/:slug/_players` | the game's **players page** (`catalog.js`): one *personal best* per person, the game's achievements with who holds each — *nobody yet* when nobody does — and under those the board's top 100, the viewer's own rows marked in cyan. Nothing about scores while the game's `scores_on` is off (a moderated board is not public in either direction, as for both `_scores` routes); the trophies stay, because earned is forever. Everybody on it is their alias, board, bests and trophy holders alike; removed accounts are joined out. A plain 404 for anything that is not a game's. Same headers as the catalog: no form here, but one posture for the two studio-authored pages |
| GET, HEAD | `/:slug/_assets` | what the game has in `assets/`, live from disk: `{files: [{path, size, mime}]}` sorted by path, nothing outside `assets/` and never a path the validator refuses. `no-store`, like the game's own files, because live is the point. A plain 404 for anything that is not a game's. The preamble names it (§8), so a game can find its own pictures and sounds without a hand-kept list |
| GET | `/_me` | who is signed in, for game code: `{user: {name}}` or `{user: null}`, never an error. ⚠️ `name` is the **alias**: the key every game and the screens library read stayed, its value changed (§3) |
| POST | `/_login` | `{email, password}` → set the `player` cookie, answer `{user: {name}}`, `name` the alias as above. Any account still in, either kind; same lockouts, dummy-hash path and undisclosing 401 as `/api/login` (§11) |
| POST | `/_logout` | delete the player session, clear the cookie |
| POST | `/_signup` | `{name, email, password}` → a `signups` row (§3), rate-limited per IP; answers 202 `{waiting: true}` whether or not it wrote, so the form never says what an address is to this studio |
| GET, HEAD | `/robots.txt` | `Disallow: /` for every crawler: the games are for whoever was sent the link and the boards were never meant for the whole internet, and a hostname with a certificate is in public logs whether it is linked or not. No slug holds a dot, so no game can shadow it |
| GET, HEAD | `/:slug/_studio.html` | the wrapper: the project's `index.html` with the reporter and its commit injected (§8), and after it the **preview player** (`server/preview-player.js`, below); the game's `js/robot.js`, when it has one, last of all; 404 when there is no `index.html` |
| GET, HEAD | `/:slug/` | `<GAMES_DIR>/<slug>/index.html` |
| GET, HEAD | `/:slug/*path` | that file from the project directory |
| GET, HEAD | `/_scores/:slug` | the game's scoreboard, best first: `{scores: [{name, score}, …]}`, 10 unless `?limit=` asks for up to 100 |
| POST | `/_scores/:slug` | add one entry `{score}` under the signed-in player's alias; 401 with nobody signed in; ten a minute per player; answers 201 `{rank}` — null when it missed the board (§3, §10) |
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
The studio shows it as the Scoreboard part of Share, in aliases like
everywhere else, with *Show real names* — a link, since it changes how the
list reads and not the board — flipping it to who is behind each one and
back. That is the studio's to know and never the games origin's (§7).

**The preview player** (since 2026-10-04, ideas/dreams.md §3). The studio's
preview is a player of its own, different from anybody playing the game:
always debugging and never on a board — no switch, and only there. The script
injected after the reporter owns the game's time: the timestamps
`requestAnimationFrame` hands it, `performance.now()`, `Date.now()`,
`setTimeout`, `setInterval` and `Math.random()` (a seeded stream with a state
of its own) all come from it, so the preview's foot can **pause** a game,
step it **one frame on** (exactly 1/60 s) and run it at **½×**, **¼×**,
**4×** or **16×** — every canvas game, unchanged, its timers included. A
timer runs at the top of the frame it comes due in; one that throws is thrown
again on a real timer, so the reporter files it and the frame goes on. A
person at 1× or slower gets the time that really passed in one frame, so slow
motion is smooth; fast, and whenever the robot plays, time goes in **whole
frames** of exactly 1/60 s, as many as are owed and at most four times the
speed in one real frame — the rest let go when a machine cannot keep up — so
a run is the same run however fast the machine is. Above 1× every
`AudioContext` the page made is suspended (its own `resume()` held off) and
an element's `play()` skipped. Paused, speed and the robot are per game in
the tab and survive a reload: a new page posts `player-ready` and the studio
answers with them. A game's own callback that throws is let
through, so the reporter still files it against the game's line. It answers
the boards itself, in the page: a `POST` to `/_scores` is `{rank: null,
preview: true}` and to `/_achievements` `{new: true, preview: true}` — the
game-over screen shows, an achievement toasts every time it is met — `/_me`
is a player called **Preview**, and asking what this player has earned
answers nothing yet. ⚠️ Only `fetch` and `sendBeacon` are answered; a game's
own `XMLHttpRequest` to a board still reaches it. A line under the preview
says its scores and achievements never count.

**Pin** (📌) and **Back** (↩) are the preview player's **savepoint**: the
game's `State.save()` and where its random stream stood, found by name
through an indirect `eval` since `State` is a `const` on the page. One a game,
Pin again replacing it, kept by the studio per tab (`public/preview-player.js`)
so a reload of the game does not lose it. Back is `State.load()` and the
stream put back; the clock is left alone — it only goes forward, so no game is
handed a frame from before its last — and a paused game is drawn once with no
time passing, so the moment shows without moving. The tweaks stay as they
are, which is the point. A game with no State, or with something in it that
is not plain, says so under the preview in words rather than pinning half of
it.

**Try** goes through the savepoint too — not a way in of its own (decided
2026-10-04). *Try this scene* in the story and the adventure, *Try it* in
their guides and in the level editor, call `tryFrom(fields)`: the preview
reloads, and once the new page has loaded the player lays the editor's
fields over the game's State, loads it and pins it, so Back comes there as
well. It replaces the pin, which is fine — trying a scene is not tuning the
last one. The fields are the template's, which the editor knows the way it
knows the file it edits: `{playing, scene, line: 0}` for the story,
`{playing, scene, lines: []}` for the adventure, `{playing, at, coins: null}`
for Roll a ball. Held while that editor is showing, so a save's reload lands
back on the scene, as `?scene=` used to. ⚠️ No template takes a way in from
its own address (`test/state-templates.test.js`): a player cannot skip ahead.

**The robot** (🤖, since 2026-10-04, ideas/dreams.md §4) is the preview
player's own player: it plays the game for whoever is watching, run after
run, and keeps playing through a save's reload. Its hands are key events —
player one's verbs in `config/controls.js`, each sent as its first key
(`FALLBACK`'s arrows, Space and Enter without one) — which the input library
and a game's own listeners hear alike, and taps with the coordinates a
finger would give, dispatched on whatever is under the point. Untaught, it
holds a few verbs at a time for a spell each, never both ways of a pair, with
Start now and then and a tap mid-page every four seconds; where `SCHEME` is
`none` and the page shows a button, it taps one of those instead. On a
`Screens` title or game-over screen it lets go and taps **Start** after a
second and a half. Its choices come from a seeded stream of its own, so the
game's dice are the same whoever plays, and every savepoint — the pin too —
carries that stream and what its hands were doing. A person's own (trusted)
key or tap stops it: your hands take over.

A game **teaches** it with `js/robot.js`, which only the wrapper loads — last,
after the game's own scripts, when the file exists (`ROBOT_FILE` in
`server/reporter.js`) — so nobody playing ever does. `Robot` is the preview
player's, not a library: `Robot.play(fn)` hands `fn` State every frame, and
its answer is the verbs to hold, a thing on the page to tap (in its middle),
or `{x, y}` to tap there; after a tap it waits 0.6 s before deciding again.
`Robot.random()` is its dice. Every template ships one
(`test/robot-templates.test.js`), and the builder's preamble says how to write
one. ⚠️ A teacher that keeps anything of its own between frames breaks the
replay below; the template comments say so.

While it plays it keeps a **rolling savepoint** of its own every two seconds,
the last three, taken between frames like a pin — never the pin itself (Dann:
"one savepoint" keeps things simple for the kids, it does not stop the studio
doing more behind them). When code of the game's throws — a window `error`,
which a failed picture or sound never is — it stops and hands the studio the
oldest, a moment four to six seconds back, with the error's words. Under the
preview, in place of the board note, *The robot broke the game: …* and **Go
to just before it broke**, which loads that moment paused and makes it the
pin; 🤖 again carries on from there and breaks it again. ⚠️ Checked in the
MCP browser: replays from one moment break at the same frame every time, and
within one frame of the run that found it. Timers pending at a savepoint are
not part of it, so a game timed by `setTimeout` replays less exactly. A
teacher that throws stops the robot too, its error filed against
`js/robot.js` like any other file's.

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
