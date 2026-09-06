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
- Viewer counts, web push, a count of unread messages. Deferred (§15) — the
  unread *marker* itself is built (§3).
- Full-text search over messages or files.
- Public read access to chat, files, or the project list (§7).
