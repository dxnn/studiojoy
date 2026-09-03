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
