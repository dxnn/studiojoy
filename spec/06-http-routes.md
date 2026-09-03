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
| POST | `/api/projects` | `{name, slug?, kind?, template?}` | create row, and for a game its directory and git repo; slug derived from name when omitted; `kind` defaults to `game`; `template` copies a game-template starter tree in as a third commit — games only, validated against `public/game-templates/index.json`; no template means the blank start page instead. Answers with the project plus `chats` and `chat` — the conversation to open: `Building`, where the *builder* is waiting, and a chat project's one room |
| GET | `/api/projects/:slug` | — | project, attached agents, recent messages |
| PATCH | `/api/projects/:slug` | `{name?, scores_on?}` | rename (display name only), and the scoreboard switch; a rename needs the project open, the switch is moderation and works archived |
| GET | `/api/projects/:slug/scores` | — | every kept score with id and time, best first, plus the switch: `{scores, scores_on}` |
| DELETE | `/api/projects/:slug/scores/:id` | — | delete one score; there is no undo — scores are not files |
| DELETE | `/api/projects/:slug/scores` | — | delete them all |
| GET | `/api/projects/:slug/achievements` | — | each definition in `config/achievements.js` with how many players hold it: `{achievements: [{id, name, how, icon, players}]}`; a read, so anybody in the studio; the *achievements editor*'s structural read |
| GET | `/api/collection` | — | the *studio collection*: `{art: [{id, file, kind, name, who?, mood?, by, made_here, mine, created_at}]}`. ⚠️ No `licence` on any of them — see §3 |
| POST | `/api/collection?kind=&name=&who=&mood=` | raw PNG bytes | add a picture, ≤ 2 MB. Refuses anything but a PNG, a background that is not landscape, and ⚠️ a portrait whose width is a whole multiple of its height. Broadcasts `collection.changed` |
| GET | `/api/collection/:id` | — | the bytes. The one studio read that may be cached hard (`immutable`): a row's bytes never change |
| DELETE | `/api/collection/:id` | — | take it out — whoever added it, or an admin. ⚠️ The only copy; games that picked it keep theirs |
| POST | `/api/projects/:slug/story/fill` | `{sentence, scene: {key, about}, cast: [{key, name, about}], lines: [{who, say}]}` | the *fill*: a sentence about what happens back as `{lines: [{who, say}], tokens}` in the story's own keys. An editor's, like every change to a game |
| POST | `/api/projects/:slug/story/picture` | `{kind, name?, about?, colours?}` | the drawn *stand-in*: `{svg, width, height, tokens}` — a flat SVG at the size `kind` (`portrait` 128², `background` 480×270) wants. The browser draws and saves it; the server writes nothing |
| POST | `/api/projects/:slug/archive` | — | archive, one way: the *originator*'s alone, refused while the game is published (§11). The pending commit lands first. Unarchiving is `npm run unarchive` |
| POST | `/api/projects/:slug/authors` | `{user_id}` | add an editor; 404 for anybody deleted or without `studio_access` |
| DELETE | `/api/projects/:slug/authors/:user_id` | — | drop an editor |
| POST | `/api/projects/:slug/open` | `{open_edit: bool}` | open the game to every account, or close it to its editors |
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
from the server's answer, so a refused value goes back to what it was. A
panel of rows each wanting its own Save was a form pretending to be a list.

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
| PUT | `/api/projects/:slug/files/*path` | raw request body is the content; honours `If-Match`; creates or updates; written at once, committed with the project's *pending commit* (§5) — answers `{path, size, etag, pending}` |
| POST | `/api/projects/:slug/commit` | land the pending commit now: the client saying it is leaving. `{commit}`, null when nothing was owed |
| DELETE | `/api/projects/:slug/files/*path` | commits, the pending commit first |
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

- **Four folders under `assets/`, by what the file is.** A short noise goes to
  `assets/sounds/`, a whole track to `assets/music/`, a *strip* to
  `assets/sprites/`, any other picture to `assets/images/`, and anything else
  to `assets/`. The folder is not tidiness: the sound player and the sprites
  library resolve a plain name inside the first and the third, so
  `Sound.play("laser")` and `Sprites.draw(ctx, "hero", x, y)` find a file
  nobody had to path out — and a picture that does not move is in
  `assets/images/`, drawn by its whole path, because it is not what that call
  is for; music likewise, since a track's ending varies. The agent preamble
  names all four. A dropped file is **measured** before the dialog opens: a
  picture's shape says whether it is a strip, and audio's length says whether
  it is a noise or a tune — over ten seconds is music, which is the same kind
  of guess as the strip test and wrong for a wav of music or a long sting. The
  dialog then shows the path each file will take before anything is sent, and
  one box overrules every one of them for the drop that belongs somewhere else
  entirely. Anything that will not decode goes where the ones that cannot be
  measured go.
- **The filename is tidied, not trusted.** Lowercased, runs of non-alphanumerics
  to one dash, extension kept, and `checkProjectPath` validates the result
  regardless. Two files that tidy to one name are refused rather than one
  quietly overwriting the other.
- **One commit per file.** A dozen sprites make a dozen versions, exactly as a
  dozen agent writes would. Batching them would need a route that takes several
  files, and nothing else in the app wants one.

An asset opens as the thing itself — a picture in the *pixel editor* full width
under Pics or Code, a sound's sliders or player in the rail under Hear, an
`img`, `audio` or `video` pointed at the studio's own read route for anything
the studio cannot edit. An
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
  versioning working against the drawing rather than for it. The picture saves
  itself two seconds after a stroke and the colours go with it (§5, the
  *pending commit* is what made that affordable); the bar says which is on
  its way. There is no Save.

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
splices that span, so comments, alignment and every other byte survive. Four
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
- **A comment belongs to one value.** It is read from the raw text — a `//`
  inside a string is not a comment — and only counts as a value's own if it
  follows that value with nothing but a comma or a closing semicolon between,
  or if it sits above a line that value's own text starts. `{ width: 320,
  height: 200 };  // the play area` describes the group, so both fields inside
  it show no note rather than repeating that one.

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

**Everything you can do to the whole game is behind one `···` beside its
name** — Rename, Fork, Editors, the games list, Add chat, Archive — each an
item that opens its dialog, and each absent rather than greyed for anybody who
may not press it: Fork is everybody's; Rename, Editors, the games list and Add
chat are an editor's; Archive is the *originator*'s, and only while the game
is out of the games list (§11). Nothing to offer means no `···`. The bar
itself holds state and nothing else: the padlock, the `archived` tag, and a
whisper saying whether the game is in the games list. This reverses an
earlier decision — three buttons at the end of the bar, and a drawer under
the name before that — for a reason that is no longer local: every thing in
the studio has one `···` (ideas/calm-shell.md), and the game is a thing.

**Every thing has one `···`, on its row, and nothing else that changes it.**
A scene, a line, a choice, a mood, a file, a version, a helper in a chat, the
chat you are in: each row ends in a `···` holding what can be done to that
thing, in one order — Rename, Duplicate, then what is its own (Start here,
Move up, Move down, Bring back), Delete last in crimson — and holding
nothing the reader may not press: an item that would be refused is absent,
and a thing with nothing to offer has no `···`. What *looks* at a thing stays
a link on the row (`Show changes`, `All files changed`, a scene's *comes
from*); what makes a new one stays a bordered button where it lands (`Add a
file`, `+ Add a scene`). One `Duplicate…` covers the three places a file can
go — this game, another, or a picture into the *studio collection* — with
the dialog asking where (formerly a `Copy…` beside it, before that `Copy
to…` and `Share to studio…`). `more()` in `main.js` is the one
implementation; `S.menu` holds which is open, keyed by the thing, so a
render keeps it, and a click anywhere else closes it.

**The inspector** (a working name, ideas/calm-shell.md) is the rail under the
preview, holding the selected thing's fields when the mode has one: in the
story editor a scene's name, ways in, note, picture and music, a person's
name and note, the title screen's two lines. It is where the mock put the
fields, and what lets the centre be what happens rather than what things are
called. Its fields keep the ids the focus snapshot knows (§17), so the caret
survives a render there the way it does in the centre. A file has none: its
bar in the centre already says what it is.

**The row under it is the mode row**: one pill per surface the centre can
show, in the order the type gives (`modesFor` in `public/game-types.js`) —
**Chat**, then the type's editors (**Write** for a visual novel), then
**Pics**, **Hear**, **Controls**, **Code** and **Share**. A chat project is one room and has no row. Which is
showing is the centre's one piece of state (`S.mode`), in the address as
`?mode=`, remembered per game; a game opens on what the address says, else
what this browser remembers, else its type's first editor, else Chat. There
is no Play: the preview lives in the rail and only there, so the
ask-commit-reload-play loop stays one pane away whatever mode is up. Leaving
a mode lands the game's *pending commit* (§5).

**The body of the centre pane is the mode's.** Chat is the chat's own row —
its pills, the helpers listening in the one showing and the `+` that calls
another in (⚠️ each its own horizontal scroller, so a studio's worth of chats
and a crowd of helpers give way to each other rather than one pushing the
other off the end) — over the thread and the composer. An **editor** is a
surface a *game type* brings, one mode each — `public/game-types.js` maps
`projects.type` to its editors, one entry each, and that file is the whole
registry — taking the whole pane the way the chat does. Code is the file list
with the open file's editor under it, as the rail's Files tab was; Share is
one page — the game's address and whether it is in the games list, then the
versions, the scoreboard and the achievements, each keeping the rendering it
had as a rail tab, in one scroller. `S.chat` is untouched by the mode, so the
chat behind another mode keeps filling, a mention lands as a mark on the Chat
pill rather than being read, and pressing the pill paints what arrived. The
*story editor* is the first editor (below); a type may bring several. Old
addresses still read: `?edit=` is a mode, `?tab=files` is Code, the other
tabs are Share.

**Pics and Hear are the game's files by kind, not by folder.** Pics is cards:
for a visual novel, **Characters** — one per *cast* member, wearing their first
mood — over **Places**, the backgrounds with how many scenes use each; for
every game, **Sprites** (a strip wears its first frame), **Pictures**, the
three *reserved images* under **Studio dressing** with what each dresses, and
**Other pictures** last, so nothing the tree holds is missing here. A card
pressed once is selected into the inspector — where it lives, how big it is,
*Draw on it*, and *Pick a picture…* or *Pick a face…* to swap it from the
*shelf*; pressed again it opens full width in the *pixel editor*, the bar's ✕
the way back to the cards. Hear is rows, sounds over music, each with a way to
hear it; the open one's *sound editor* — or a player, for one not made here —
lands in the rail, a column of sliders where a column fits, and the same row
closes it. Each has its maker at the top: *Add a picture* is the add-file
dialog narrowed to drawing and uploading, *Make a sound* and *Upload a sound*
the same for sounds. The tree is still Code's, and a file asked for from
anywhere else opens under Code.

**Questions** is the quiz's editor as a mode: the mode is `config/questions.js`
— arriving opens it, and its bar has no ✕ because there is nowhere to close it
to — and the form saves itself like the story does.

**Controls** is how the game is held, the same way: the mode is
`config/controls.js`, it opens on arriving, its bar has no ✕, and it saves
itself. Two halves. The **shape** is one wide row per thing the studio offers,
in the registry's order and its words — the same four New game asks about
(§4) — with the *arcade* family opening into its three manners underneath,
and only while the game wears one of them: one open at a time, in the row it
belongs to. The row the game already wears is cyan and *is not a button*,
because a greyed-out row is a question a row cannot answer; neither is any of
them in a game you may not change. Picking one writes `SCHEME` and nothing
else — ⚠️ never the bindings, whose left-hand words are the game's own and are
in its code by name, and ⚠️ not the notes above it either, which still
describe the shape the game was seeded with (a TODO line).

Then **what each player does**: a row per verb with its bindings as chips,
the verb read-only for the same reason. A verb **opens in the row it belongs
to**, one at a time, into a row per binding — the chip, what it is in a
player's words ("the space bar", "the controller's right stick pushed left"),
and *Take it out* in its `···` — over the three ways to add one. A key is
**pressed** rather than picked out of a list of a hundred: the button installs
one `keydown` listener that takes itself off with the first key, Esc calls it
off, and the friendly name is what gets written (`key:space`, not a space
nobody can see). A controller button and something-on-the-screen are selects
of the shape's own vocabulary, so a shape can only be given what it draws;
a drawn button's row also carries its **name** — the words on the button,
starting as the verb's own — and *it latches* (`touch:` ↔ `toggle:`), which
only a drawn one gets, because a key or a pad button staying momentary is
what keeps the desktop feel the same.

The shape's two knobs sit under it: `BUTTON_SIDE` where anything is drawn and
`STICK_DEADZONE` where a thumb works a stick, ⚠️ **written the first time one
is used** — a file seeded for a shape without them never declared them, and
`input.js` reads `"right"` and `0.35` for itself until one is there.

Under the verbs, every binding this shape has not got — a `stick:` in a swipe
game, a drawn button in a `none` one — said in words, and *Take it out* in its
`···` there too; the same chips are struck
through in the verb rows above, or a row would show a control that looks like
it works. And one check over the whole file: a shape that draws something and
bindings that never name it is a game nobody can play on a phone, which is
exactly what picking a shape causes, since the bindings are left alone. This
is what declaring the shape was for — a file claiming `swipe-tap` while
binding six drawn buttons has left its shape, and the panel is where that
gets said.

⚠️ Shape-locked like the quiz: `CONTROLS` must be a group of players, each a
group of things to do, each **one line** of bindings. A list where a line
belongs, or anything the config reader will not touch, falls back through the
generic form to the text with the reason said. A declaration the panel does
not know — a game that grew its own — is named at the foot rather than
hidden. The model is `public/controls-editor.js`, shared with `npm test`; the
panel is `public/controls-form.js`. Like the quiz's, both render wherever the
file is open, Code included: one renderer reached two ways is not two
surfaces, which is the thing the *story editor*'s rule is actually about.

**A game a person makes is open** — the whole studio may change it — and an
editor closes it in the `Editors` dialog, which puts a padlock in front of its
name. This is a studio of a few people who trust each other: a game nobody else
may touch should be a decision somebody made rather than the state everything
starts in. A fork is a new game and starts open too, whatever the original was.
⚠️ Stated at the INSERT rather than as the column's default, which stays 0: a
database written before this already has the column, and SQLite cannot change a
default after the fact. Chat projects stay closed — they have no working tree,
and `open_edit` there is about who may start chats in somebody's conversation.

**The rail is the running game and nothing else**: the preview, with `Open`
and `Hide` on the frame because both act on the game, and under it the
problems and the moments the game reported. Folded, it is one row that still
plays, remembered per browser. `Reload` is gone: a save already reloads it.
The four tabs that used to sit under it — Files, Versions, Scoreboard,
Achievements — are modes of the centre now (above), and the file editors
that opened under Files open by kind: a picture under Pics or Code, a sound
in the rail under Hear, everything else under Code.

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
names carry the colour; the shapes are the ones `public/css/` and the
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
network is one console warning, never an error. Each award is also said on the
window as an `achievement` event (`{ id, name, how, icon }`), kept or not:
the screens library keeps them from one game over to the next and lists them
under the score as *Won this run* (`WORDS.won`), a late one landing on the
screen as it arrives, so the game-over screen agrees with the toasts.
`Achievements.mine()` is the `/_achievements` GET for a trophy screen. It **seeds** `config/achievements.js`
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

#### Picking the control scheme

Which `config/controls.js` a game is seeded with is a choice made when the
game is made, the way its type is: New game asks **How is it played?** beside
"Start from", and the answer is the game's *control scheme*. The two are
deliberately unalike after that. A type is `projects.type`, a column, so no
`write_file` can change which editors somebody sees; a scheme has to be a
file, because `input.js` reads `SCHEME` inside the running game — which is
also why it is the one of the two that stays changeable afterwards.

`public/templates/index.json` is the registry: one entry per scheme with the
words the dialog shows and the seed file it starts from, and it doubles as the
validation list the way `game-templates/index.json` does for templates. Three
things it settles:

- **A request names a key, never a path.** `POST /api/projects` takes
  `scheme`, checked against the registry before anything touches the disk;
  the seed path comes from the registry and is held against a plain-name
  pattern. ⚠️ A name shaped like a path is a 400, not a read of another file.
- **A family is an interface grouping, not a word in the file.** `offer` is
  what the dialog lists, and an entry naming a family — **Arcade** — stands
  for the family: it is offered in the family's own words and the game starts
  as the family's first manner (`stick-buttons`), narrowed to two sticks or
  buttons-only in the panel afterwards. `SCHEME` is always one concrete
  shape, because a file claiming to be arcade would not say which shape a
  phone actually gets, and "explicit is checkable" is the whole reason the
  declaration exists rather than being inferred from the bindings.
- **The default is the null controller**, which draws nothing. The registry's
  `default` and the input library's own `seeds[].from` — what an install with
  no choice at all writes — must name the same file; `test/schemes.test.js`
  holds the two together, because they are the only two places that could
  disagree about it.

A template may fix its own scheme (`scheme` in `game-templates/index.json`):
the quiz and the visual novel both say `none`, since a game of buttons is
pressed rather than steered, and the dialog then takes the question away
rather than offering a choice it would overrule. An explicit scheme still
wins over a template's — a quiz you steer is a stranger game, not a mistake.
`scaffoldLibraries` takes the override as a map from a seed's destination to
where it is copied from, so `npm run sweep` never learns about schemes at
all: it cannot replace a seed that exists, which is the same rule.

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
leaves "a game with no page" a state still worth testing. It loads every
library the game holds, the input module included. That one used to be left
out — a plain page had no *control scheme* because it had nothing to steer,
and on a phone `input.js` drew a stick and buttons over its two lines — and
what answers that now is the shape being a choice: the null controller draws
nothing, and a game whose maker picked an arcade shape wants the two tags
from its first minute rather than after a helper has noticed.

A `BRIEF.md` is committed with the page, from the same directory and copied
byte for byte (§8, Project documents). Every template ships one; a game made
without a template had none, and nothing else says which tags *this* page
carries, or which `SCHEME` the game was made with and that somebody chose it.

`index.json` also names each template's **heart**: the file the studio opens
the new game on, because a template with an editor of its own is made in that
editor rather than asked for. The *builder* is in a template game's `Building`
like any game's, and answers what is typed there; opening on the heart is what
keeps it out of the way until somebody wants it.

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

The **achievements editor** is the third, and the first that every game has:
`config/achievements.js` is seeded into every game (§4), so its editor is not
a template's but the studio's own, the **Achievements** part of Share — the
list of what a player can earn, one open in its own row with its name, how to
get it, an icon and the *moment* and test it waits for; `+ Add an
achievement`; `Take it out`, with a confirm that says how many players keep
what they earned. Like the quiz and the story it regenerates the whole file
with the seed's comments and is byte-identical on an untouched save; a file
that outgrows the shape keeps its tab, which says why and offers the text.
Under Files the file opens as plain text and nothing else — the story editor's
rule: one surface writes it. It reads two things no field can: how many
players hold each achievement (`GET /api/projects/:slug/achievements`),
painted in place, and the moments the *reporter* has heard this game say this
session (§8), offered where a rule names one and flagged where a rule names
one never heard. Explicit Save with `if-match` and an `achievements-conflict`
dialog on a 409; unsaved edits are parked per game the way the story's are.
`?mode=share` is its address. The libraries and the seed reach an
existing game through the *sweep*; the `<script>` tags in its `index.html`
and its own `Moments.say()` calls stay a helper's job, as the preamble says.

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
the paths a `files.changed` names. Under it the **steps**: what happens in the
scene, top to bottom — one row per line, the selected one open in place with
who, mood and the words, rows dragged into order by a handle or moved from
the row's `···` (Move up, Move down, Delete); then the exit — the player
chooses, go straight on, or the end, each choice with its own `···` — and the
scene's problems. What the scene *is* — its name (renaming brings every way in
with it), the *comes from* links, the note about it, its picture and its
music — is the **inspector**'s, in the rail under the preview (below); what
can be done to it whole — *Start here*, *Duplicate*, *Delete*, the last
absent while something leads here — is the `···` on its row in the strip. A
selected person shows their moods and the file
each expects. Typing repaints the stage and the status in place; anything that
changes the shape renders.

Like the quiz editor it regenerates the whole file and is byte-identical on
an untouched save. It still says the five things no single field can: a scene
nothing leads to, a way out pointing at a scene that is gone, a switch nothing
sets, a picture or portrait the game does not have, and a mood the cast does
not have. **No Save button**: the story saves itself two seconds after the
last edit and sooner on the way out of a field, a scene, the editor or the
game, with `if-match` and a `story-conflict` dialog on a 409; a save is a
write and a preview reload, and its commit is the project's *pending commit*
(§5), which is what made an editor that saves itself affordable. The pixel
editor, the sound editor and the quiz form save themselves the same way,
because every state they pass through is a picture, a sound or a quiz; Code's
text editor keeps its Save, because half-typed code is a broken game the
*reporter* would post and the helpers would read. The bar's whisper says
*Saved* or *Saving…*. *Show the text* saves first and opens
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

**The title screen** is a row in the strip above the scenes — the first thing
a player sees, and the one thing here that is not a scene. Its two lines, the
title and the one under it, are `config/words.js`'s: read the way the config
form reads (`titleWords`) and spliced back in place by Save (`withTitleWords`,
a commit of its own, made first), so the End, the buttons and the how-to-play
line stay that form's and are one link away on the right. Until this row the
only way to change "My Story" was to find the file in the rail. A words file a
helper has reshaped past the two lines shows no row rather than a wrong one,
and a save whose story text is unchanged makes no story commit. **Duplicate**
is in a scene's `···` beside Delete: a copy right after it under the next
free name, its lines and choices its own. The shape has no lines after a
choice on purpose, so a choice that keeps the player where they are — "the
door is locked", still in the hall — is a second scene, and Duplicate is how
one is made without retyping it.

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
edit to the model and selects what it changed; the autosave writes it, as
always. The card is built once per question and re-appended by later renders, like a
dialog, so a helper's reply landing does not wipe what is being typed.

A picture is a file, so the guide's four ways to one commit at once: **Draw
it** writes a blank PNG at the path the story expects and opens it in the
pixel editor under Code; **Upload one** takes any picture from this device and
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

#### Music, and sound as a step

Two ways to be heard, and the difference is whether it belongs to the scene or
to a moment in it.

**Music** is `music:` on a scene — a whole path under `assets/music/`, like
`picture:` and unlike `sound:`, because a track arrives as whatever the file
was and there is no one ending a bare name could be given. The player calls
`Sound.loop(track, 0.4)` on entering a scene and stops the previous one only
when it differs, so the same track **carries from one scene into the next
without restarting** — the sound library already leaves a running loop alone,
which is why this needed no library change and no sweep. Quieter than a noise,
because people are talking over it.

**A sound is a step among the lines**: an entry in `lines` that is only
`{ sound: "page" }`, sitting wherever the noise should happen. It plays the
moment it is passed and the story carries straight on — waiting for a tap
would leave the box empty for a beat — and a noise written after the last
spoken line plays as the scene is left, on the tap or the choice that leaves
it. `isSoundStep` is the one field that tells the two kinds apart, and they
live in one list so a noise drags in between two lines and back out again
with the same `moveLine`.

⚠️ **Scene-level `sound:` is the older shape** and meant "at the start". The
editor reads it as a sound step in front of the lines and **never writes it
back**, so opening an old story and saving it moves the sound into the
timeline where it can be dragged. The template's player still plays the old
key, so a story nobody has re-saved is unchanged — and because a template is
the game's own code with no sweep behind it, every existing visual novel needs
its `js/story.js` brought forward by hand or its sound goes quiet on that
first save. There was one (`bloop-s-quest-two-the-questening`), and it was.

On the stage a noise has nothing of its own to show, so `stageFor` keeps the
words that are still on screen and names the sound beside them. The guide
counts *said* lines (`saidIn`), so a scene holding nothing but a door slam is
still a scene nobody has written yet.

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
moment ago and the save may not have gone in yet — so a disk read would be
asking about a scene that is not there yet. It is the author's own words going into a prompt billed
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

The **shelf** is how it is picked: the pictures of the kind being asked for.
Two places, because the guide stops asking the moment a scene has a picture,
so without the second the set could never be used to *change* one: a row that
scrolls sideways across the top of the guide's picture card, before the field
and the buttons; and a **dialog with a filter** behind `Pick a picture…` on
the scene's Picture field in the inspector — a grid of every picture of that
kind, the shipped set and the collection together, found by name or by who
made it, because forty-two pictures before anybody adds one is not a strip
(ideas/calm-shell.md). ⚠️ Picking copies the bytes to the path the *story* expects,
not to the set's own landing path, so the set says what a picture looks like
and the story says what it is called: "Mila, worried" becomes
`assets/sprites/ben-normal.png` when that is the face being asked for. The
credit and the licence ride the banner as well as the tooltip. The index is
read once a session and only a good read is held; the shelf is filled in when
it lands rather than through `render()`, because the card is one node kept for
as long as its question stands. A plain `<img src>` is right for these, unlike
a game's own files, whose routes send `no-store`.

Pictures only: a sound has `+ Make a sound`, which beats a shelf of stock
ones, and an example is the only thing that uses the set's `sound` kind today.

What it holds: 33 portraits and 9 backgrounds, all CC0. The studio's own
three-and-three from the example story, 30 animal faces by **Kenney** (the
`Round` variant of the animal pack — one face each, no moods), and 6 pixel-art
scenes by **Stealthix**. Two styles that do not match each other, which is a
known compromise: the alternative was three faces.

`test/story-art.test.js` is what keeps a growing set honest — every entry's
file present and in the folder its kind lands from, every licence named, a
portrait's file named for its `who` and `mood`, and every example's art listed
in `art` rather than merely present. The shape rules are deliberately loose,
because real art does not arrive at the studio's own 480×270 and 128² and the
studio scales: a background must be landscape, and ⚠️ **a portrait must not be
a whole multiple of its own height** — it is copied into `assets/sprites/`,
where the sprites library reads that shape as a *strip* of square frames, so a
2:1 portrait would animate instead of standing still with nothing in the story
saying why. Exact squareness was the rule until real art arrived; every animal
in the set is slightly off-square.

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

`Rename…` is in the file's `···` on its row under Code, with `Duplicate…`
and `Delete…`, and takes the whole path, so it also moves: `sprite.png` to
`art/hero.png` is the same one commit. The dialog says what the new name
will mean before it happens, and ⚠️ crossing into or out of `studio/` gets
its own sentence, because that is the one move that changes who may edit the
file rather than only where it lives. It is allowed either way — the
library is refused to *agents*, not to people (§4) — but not silently.

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
| GET, HEAD | `/` | the catalog: the studio's front door, in its own dark dress — wordmark, halftone, hairline. Published games as cards, names escaped, each wearing its `hero.png` when its tree holds one (§6) under a dark wash and its board's best score in gold; signed in, each card also says how *you* are doing — your *personal best* (gold, a score) and your trophies against what the game's `config/achievements.js` defines (`★ 3 of 7`, not gold: a count is not a score), counting only ids the file still defines. Sign-in and ask-to-join for the signed-out, name and sign-out for the signed-in. Under each card, *Scores & trophies* links to the game's players page. ⚠️ Sent with `frame-ancestors 'none'` and `COOP: same-origin` (§7) |
| GET, HEAD | `/:slug/_players` | the game's **players page** (`catalog.js`): one *personal best* per person, the game's achievements with who holds each — *nobody yet* when nobody does — and under those the board's top 100, the viewer's own rows marked in cyan. Nothing about scores while the game's `scores_on` is off (a moderated board is not public in either direction, as for both `_scores` routes); the trophies stay, because earned is forever. Removed accounts are joined out; a run posted before the sign-in shows under the name it was posted with. A plain 404 for anything that is not a game's. Same headers as the catalog: no form here, but one posture for the two studio-authored pages |
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
