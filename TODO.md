# TODO

v0 is built and green. `spec.md` is the design-of-record; §15 lists what was
deliberately deferred.

- try a two-helper game (a builder plus a critic) and see whether the
  bot-to-bot dampening makes the second one useless in practice
- decide whether `BRIEF.md` should be created automatically with a new project
- upload files from the studio (drag onto the file tree; the PUT route already
  takes raw bytes, so this is client-side only)
- move the ambient file block into the system prompt (spec.md §15). Measured:
  0% cache hit where it is now on a second fire, 100% there when no file
  changed. Reorders every context, so it wants its own commit
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token, in-memory lockouts, no rate limit outside login
- ⚠️ make `readJson` require `Content-Type: application/json`. It parses any
  body today, so a `text/plain` POST is CORS-safelisted, skips preflight, and
  reaches every write route with the operator's cookie attached from a game on
  the same hostname (spec.md §7). One guard restores the preflight barrier;
  it's a behaviour change, so it wants its own commit
