# TODO

v0 is built and green. `spec.md` is the design-of-record; §15 lists what was
deliberately deferred.

- try a two-helper game (a builder plus a critic) and see whether the
  bot-to-bot dampening makes the second one useless in practice
- decide whether `BRIEF.md` should be created automatically with a new project
- upload files from the studio (drag onto the file tree; the PUT route already
  takes raw bytes, so this is client-side only)
- ! let helpers see the game running: a runtime error feed from the preview
  iframe into agent context. Screenshots are impossible, not just awkward —
  DeepSeek v4 rejects every image content shape (spec.md §14), so anything an
  agent learns about its running game has to arrive as text
- context management for a long game: history is the pressure, not files
  (measured: all three games total 104 KB, so the 400 KB ambient cap has never
  bound). Options are a rolling summary, a helper-maintained NOTES.md, or
  sending the tree listing plus only pinned and recently-written contents
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token, in-memory lockouts, no rate limit outside login
