## 17. The client

One page, no framework, no build step. `render()` builds the whole tree from
`S` and replaces it. Everything below follows from that one sentence, and
every rule here was found by breaking it.

⚠️ **The shell starts the studio; `main.js` does not start itself.**
`public/index.html` imports `start` and calls it. Importing the module used
to fire it — ask the server who you are, open the stream — so `npm test`
could not load any file that renders, and the *three conventions* could only
ever be checked by eye in a browser. They are tests now
(`test/conventions.test.js`) over a hand-rolled DOM stand-in
(`test/dom-stand-in.js`, under 300 lines with its comments): what lights up is what can be
clicked, nothing is greyed where a row would have to explain why, one thing
open at a time in the row it belongs to, and gold only on a number. Three of
them every surface keeps, and `conventionBreaks` reads them off
`public/css/` rather than a list by hand: a node a `:hover` rule lights up
is pressable, every `.scroll` has a `data-scroll` name, and whatever a
`var(--num)` rule colours reads as a number. `press` hands back what an
onclick returned, so an opener is asked for its promise. Controls, Pics,
Hear, Share (the achievements editor and the board), Versions, the story
editor and the mode row are held to them (`test/pics.test.js` for Pics), and
the first run found Controls' shape rows lighting up in a game nobody could
change. The @ menu is checked the same way
(`test/at-menu.test.js`) — through the composer's own keydown handler rather
than its own function, or the two would pass having never been wired
together. ⚠️ Each
one was held to the only standard a convention test has — the bug put back,
the test watched failing, the bug taken out again — because a convention
test that cannot fail is decoration. ⚠️ Zero dependencies still holds: a
hundred lines against jsdom, which is a browser. What genuinely needs one —
layout, computed colour, a real pointer — stays a Playwright check by hand,
and that list is now short. `install()` runs before the import, because the
client still reads `document` and the stored rail width on the way in.

### What a render destroys

A render throws away every node, so anything the browser was keeping on one
is gone unless it is snapshotted and put back.

- **The caret and the text of whatever is being typed in.** `focusSnapshot`
  holds the composer and any control with an id, found again by it; the
  sidebar's filter box loses its second character without that, because
  every keystroke re-renders the pane it is in. ⚠️ So a field that must
  survive a background render carries an id — and a write to *anybody's* game
  is one, so in a busy studio that is every few seconds. The config form's
  are `cfg.` and the value's path (`cfg.TRACKS.1.width`), and it writes each
  keystroke into the open file rather than waiting for `change`, or the
  rebuilt field comes back with what the file said before the typing; the
  quiz's and the achievements' fields do the same. ⚠️ A field that turns what
  is typed into something else — a controls name's spaces into dashes, an
  adventure's thing into a key, a story's scene or mood name — still writes
  on `change`, since doing it mid-word takes the space before the next word
  arrives. ⚠️ But Chrome fires a field's `change` and then its `blur` when a
  render takes it away, synchronously and while it is still in the page
  (measured 2026-10-02), so such a field commits whatever half a word it
  holds at that moment, and an emptied one comes back as its stand-in: a
  new mood read "mood" again when its own autosave landed. So every one of
  them — the story's scene and mood names, the adventure's scene, thing and
  switch names, a drawn button's name in Controls — goes through
  `typedField` (`public/typed.js`): what is typed waits there, shown again by
  the rebuilt field while it stands for the same value in the same game, and
  `change` and `blur` are looked at only once the render is over, ignored
  when a field with the same id came straight back under the fingers. A
  rebuilt field sends no `change` when it is left, so leaving commits too.
  `test/typed.test.js` holds it. And nothing is taken from a field's words as they are
  typed — an achievement's id comes from its name on Save — because leaving
  a field is no sign it is finished.
  The dialog's fields need none of this: the dialog is one node, re-appended.
- **Every scroller's position.** A `.scroll` container needs a `data-scroll`
  name or it jumps to the top on the next render.
- **The open dialog**, which is built once and re-appended as the same node,
  never rebuilt mid-decision — a background render used to wipe what was
  being typed into it. ⚠️ Re-appending is still a leave and a return, and
  leaving the document empties a scroller, so the dialog's box is a named one
  (`dialog`) and so is the shelf grid inside it (`shelf`): a banner leaving
  six seconds after it arrived used to send Modify image back to its top
  while its bottom was being set. The focus restore that follows uses
  `preventScroll`, since `focus()` otherwise scrolls the control into view —
  centred, in Chrome — after the snapshot has already put the scroller back.
- **The @ menu over the composer**, for the same reason the composer itself
  survives a render: it is one node on the body, painted in place and never
  through `render()`. Rendering it would rebuild the whole thread on every
  keystroke of a name — and the composer is the one box in the studio that is
  typed into while helpers are writing into the pane behind it. ⚠️ Its keys
  are read *before* the composer's own handler, or Enter sends half a
  sentence instead of picking the name. `chats.js`.
- **The preview iframe** — which is why it is no longer in the tree. ⚠️ An
  `<iframe>` reloads the moment it leaves the document, so while it lived in
  the tree every render restarted the game: a banner arriving and leaving six
  seconds later, a line typed in the story editor, a file opened on the
  right. The one frame is appended to the body once and never moved; the tree
  holds a placeholder of its size where it was, and `placePreview` lays the
  fixed frame over the placeholder's rectangle after every render, on resize,
  on any scroll and while the rail is dragged — hidden while the placeholder
  is hidden, unloaded to `about:blank` when the preview is folded or no game
  is open. The problems panel and the moments panel are still painted in
  place, never through `render()`: the game does restart on every commit, and
  a report that rendered would render a report. ⚠️

Streamed text is painted at most once per animation frame (`paintSoon`),
never per delta: repainting the box and forcing a reflow ~90 times a second
grows with the trace and froze the page right at the thinking cap. The trace
panel sticks to the newest thought unless the reader has scrolled up, and the
elapsed line (`thinking, 2m 14s`) counts off the deltas themselves, not a
timer. Checked at 87,000 characters of trace. A file being written moves the
same line by its arrival (`agent.tool` with `bytes`, §9) and the sizing call
names itself on it: every movement there is something that arrived.

### The URL is the view

`?mode=`, `?file=`, `?version=`, `?chat=` and `?scene=` carry what you are
looking at, so a link sends it and a reload comes back to it. Written
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
behind. Three places do it — `All files changed (n)`, the Share pill, and a
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

⚠️ **A save hears its own write.** A save's own `files.changed` lands around
the moment its PUT is answered — measured 8 ms after the headers, while the
editor was still reading the body and so still held the work as unsaved — and
was taken for somebody else's: "changed while you were working on it" after
every stroke of the pixel editor, seen 2026-10-02. Every save of the open file
goes through `putOpenFile` (`files.js`), which holds the path in `saving`
until the body is read, so the caller sets `savedAt` with no event able to
land between; the handler takes a write as its own while the path is there or
for five seconds after `savedAt`, and neither warns nor re-reads. Somebody
else's write in that window is still caught, because every save carries
If-Match and the next one is refused.

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

The composer is emptied on send, but the words never rest on that alone: a
message paints into the pane the moment it is sent, pending, from
`S.pending` (`stream.js`'s `pendingMapFor`, the same per-chat-buffer shape as
a streaming reply's `liveMapFor`) — not waiting on the **stream** to echo it
back, which is what used to lose a message on a bad connection: the POST
could land and be broadcast while the SSE was mid-reconnect and missed it,
and nothing but a reload would show it again. `applyMessage` (`stream.js`)
now runs the moment the POST answers, from its own response, and a second
time — a no-op, guarded by id — if the SSE echo still arrives. A send that
truly fails is never removed either: the pending bubble turns to a marked
"could not send", pressed to try again in place. Nothing else in the studio
holds something git cannot recover.

### Panes

- **A phone is views, one at a time, under a head that holds still.** At
  860px and under the three panes take turns (`S.narrowPane`) — the games
  list whenever no game is open, at `/` or Back to it, since the empty
  centre's "on the left" has no left there — and
  `renderPhoneHeader` draws one **phone header** above whichever of the
  centre and the rail is showing — a row of the shell's grid, so a long
  editor or a field scrolled up for a keyboard moves the pane under it and
  never the header. It is the game's bar on one row — ☰, the name, which is
  what gives way, and the game's ··· — and the **view changer** under it: ‹
  and › step through the
  modes and wrap, the mode you are on is named between them with its `what`
  under it (a pill's title, which a phone has no hover to read), and Preview
  is the rail, lit and reading *Close preview* while it is up. The wide bar,
  its published whisper and the pills are hidden at that width; an arrow
  pressed on the rail goes to the next mode in the centre. ⚠️ A pick whose
  fields live only in the rail — a character under See, a sound under Hear,
  *Try this scene* — goes to the rail too, or on a phone it does nothing
  anybody can see. ⚠️ No mode is taller than its pane: Write's guide, stage
  and steps were, and its bar hung off the foot of the screen, so on a phone
  that column is one scroller (`story-main`, named) with the bar held at its
  foot. `test/phone-header.test.js` holds what each control says;
  `test/ui/narrow.ui.js` holds the geometry.
- `MEDIA_KINDS` in `public/files-tab.js` is the one list to extend when the
  studio should show a new kind of file.
- A picture opens on **one** click under Pics as it always did under Code, so
  `S.pick` is a *person* and nothing else; the picture the rail describes is
  `S.open` (§6).
- The preview reloads itself: every `files.changed` bumps `previewNonce`, which
  is in the iframe's `src`, so a helper's write, a save or an upload all
  restart the game — on the write, not on the commit, which for a save comes
  later (§5). There is no Reload button. Nothing else restarts it: the `src`
  is set only when that address changes (`showPreview`), and the frame never
  leaves the document (above). `version.new` is the other half — a commit
  landed — and it refreshes Versions and the open file's count, never the
  frame.
- The preview's **shape** (§6) is `placePreview`'s arithmetic rather than a
  CSS `aspect-ratio`: the placeholder's height and the frame's width are both
  written from the shape, the rail's width and half the window's height, and
  the width goes on the wrap as `--frame-w` so the foot matches the frame.
  ⚠️ Both writes are guarded against writing the value they already hold —
  this runs on every scroll event in the window, and a style write before a
  rectangle read is a forced reflow each time.
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
  width and the overlay shears off the text. It is also the one thing measured
  against a field, so it carries the touchscreen size below.
- ⚠️ **No field's text is under 16px on a touchscreen.** iOS Safari zooms the
  page in when it focuses one that is, and leaves it zoomed until somebody
  pinches back out — the studio's fields were 12 to 15px, so tapping the
  composer left the studio ~7% wider than the phone, on every message. One
  rule in `base.css` under `@media (pointer: coarse)`, `!important` because it
  has to beat every surface's own type scale including one written later, and
  the code editor's `<pre>` twin follows it in `code-editor.css` or the
  colours shear. Not `maximum-scale=1` in the viewport meta, which stops the
  same zoom by taking pinch zoom away from Android: the page stays zoomable on
  purpose. `test/ui/touch-fields.ui.js` holds it — the sign-in form, a game,
  and the editor and its twin — and asserts the coarse pointer before reading
  anything, because a check for a rule behind a media query that runs without
  the query passes while testing nothing.
- ⚠️ **A box with no words in it declares a `display`.** `width` and `height`
  do not apply to a non-replaced *inline* box, so a sized-and-coloured empty
  `<span>` is 0px wide and paints nothing — no background will save it. It
  works by accident inside a flex parent, which blockifies it: the unread dot
  showed in the sidebar (`.srow` is flex) and was invisible on a chat pill
  (a plain `<button>`) for three days in production. `.unread` says
  `display: inline-block` and `test/style.test.js` holds it there. The failure
  looks like nothing rather than like a mistake, which is the same reason the
  undefined-`var()` check exists.
- ⚠️ In the story editor a button's click bubbles to the row it was in *after*
  the button has already moved the line and rendered, so a row ignores button
  clicks; fields still select the row in place, because a render would close
  the select as it opened. A reload keeping the story on screen until the new
  file lands is the same discipline as above — §6 has the story editor's own
  case.
