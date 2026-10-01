## 15. Deferred to v1

- Counting tokens rather than bytes. The byte caps bound the request, but a
  request's real cost is only visible after the fact, in `usage`.
- Viewer counts (exists in `new-y`; message reactions and unread *markers*
  are built now — a dot, and `@n` for a mention, §3. What is still deferred is
  a **count** of unread messages: the dot says something happened in there and
  not how much). Typing previews are **not** here — they are permanently out
  (§2).
- ~~Web push~~ — **built** (§6, §7, ideas/notifications.md). VAPID and
  `aes128gcm` are hand-rolled in `server/push.js` against the RFCs' own
  worked examples, since `new-y` gets both from the `web-push` package and
  this studio has no runtime dependency.
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
- A licence on the *studio collection*. Decided 2026-09-02: it records none
  and whoever drew a picture keeps the copyright, which is right for a few
  trusted people. Worth asking again if the studio grows, if a published
  game's art has to say where it came from, or if anybody wants to take art
  out of here and use it elsewhere — "no licence" also means nobody has been
  given permission (§3, ideas/studio-collection.md).
- Moderating the studio collection with a queue. Today it is "an admin can
  take anything out", which suits a few trusted people and would not suit
  more. Same trigger as the licence.
- `git push` to a remote so a game can be published elsewhere.
