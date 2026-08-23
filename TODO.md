# TODO

v0 is built and green. `spec.md` is the design-of-record; §15 lists what was
deliberately deferred.

- try a two-helper game (a builder plus a critic) and see whether the
  bot-to-bot dampening makes the second one useless in practice
- watch a live helper build with the new prompt: does it actually write
  `BRIEF.md`/`SPEC.md` and split the game up, or still emit one big page. (The
  input half of this question is answered — see space-racer's `e1fcbeb`.)
- ask a helper to move flip-for-what onto the input module, the way space-racer
  went; then check whether either game wants a sound effect now that one can be
  made without leaving the studio
- second library, to prove `studio/` is a shape and not a special case for
  input.js — a sprite sheet reader or a sound player is the small end of it
- a studio-wide "which games are behind" view. Per-project the button already
  says Update; across games there is nowhere that shows it
- scoreboards and networked multiplayer both need the games origin to hold
  state and to take its first write — see ideas/next-five.md. Scoreboards is
  the cheap pilot: it settles the rules (no cookie, its own rate limit, caps)
  that multiplayer needs anyway
- pull space-racer's colours out of its drawing code into `config/look.js` (a
  game refactor, so ask a helper to do it rather than doing it by hand)
- migrate `fun-slide` and `redwolf-radness` — both are still one big file, so
  this is a rebuild rather than a move; good first test of the new preamble
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token (bounded to logout now), in-memory lockouts,
  no rate limit outside login, and sessions that never expire or rotate
