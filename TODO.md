# TODO

v0 is built and green. `spec.md` is the design-of-record; §15 lists what was
deliberately deferred.

- try a two-helper game (a builder plus a critic) and see whether the
  bot-to-bot dampening makes the second one useless in practice
- watch a live helper build with the new prompt: does it actually write
  `BRIEF.md`/`SPEC.md` and split the game up, or still emit one big page, and
  does it use `js/input.js` when it is in the file list rather than listening
  for keys beside it
- ask a helper to move space-racer and flip-for-what onto the input module, so
  a controller and a tablet work on the two games that are already migrated
- scoreboards and networked multiplayer both need the games origin to hold
  state and to take its first write — see ideas/next-five.md. Scoreboards is
  the cheap pilot: it settles the rules (no cookie, its own rate limit, caps)
  that multiplayer needs anyway
- pull space-racer's colours out of its drawing code into `config/look.js` (a
  game refactor, so ask a helper to do it rather than doing it by hand)
- migrate `fun-slide` and `redwolf-radness` — both are still one big file, so
  this is a rebuild rather than a move; good first test of the new preamble
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token, in-memory lockouts, no rate limit outside login
- ⚠️ make `readJson` require `Content-Type: application/json`. It parses any
  body today, so a `text/plain` POST is CORS-safelisted, skips preflight, and
  reaches every write route with the operator's cookie attached from a game on
  the same hostname (spec.md §7). One guard restores the preflight barrier;
  it's a behaviour change, so it wants its own commit
