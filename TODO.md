# TODO

v0 is built and green. `spec.md` is the design-of-record; §15 lists what was
deliberately deferred.

- try a two-helper game (a builder plus a critic) and see whether the
  bot-to-bot dampening makes the second one useless in practice
- decide whether `BRIEF.md` should be created automatically with a new project
- upload files from the studio (drag onto the file tree; the PUT route already
  takes raw bytes, so this is client-side only)
- fork a game — `git clone --no-hardlinks` the working tree into a new slug
- publish a game — a `published` flag plus an index at `/` on the games origin;
  reverses the "no public game index" line in spec.md §15
- let helpers see the game running, not just its source: a runtime error feed
  from the preview iframe back into agent context
- ! decide whether an agent may continue itself after hitting the turn limit,
  bounded per human turn — without it every stall needs a human nudge
- context management for a long game: history is the pressure, not files
  (measured: all three games total 104 KB, so the 400 KB ambient cap has never
  bound). Options are a rolling summary, a helper-maintained NOTES.md, or
  sending the tree listing plus only pinned and recently-written contents
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token, in-memory lockouts, no rate limit outside login
