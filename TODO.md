# TODO

v0 is built and green. `spec.md` is the design-of-record; §15 lists what was
deliberately deferred.

- try a two-helper game (a builder plus a critic) and see whether the
  bot-to-bot dampening makes the second one useless in practice
- ask a helper to move flip-for-what onto the input module, the way space-racer
  went; then check whether either game wants a sound effect now that one can be
  made without leaving the studio
- let a person lock a game file: helpers get its API note, not its bytes,
  and cannot write it (ideas/api-notes.md)
- give each game its own four colours in its `config/look.js` — they all wear
  the studio's default crimson until somebody picks (GLOSSARY: *look*)
- the move-and-collect template, then the point-and-click adventure — each
  with its own editor mode where one fits (ideas/templates.md)
- the spot picker for adventures: drag a box on the open picture, it writes
  the spot into config/scenes.js (ideas/templates.md)
- networked multiplayer: a turn-based room relay on the games origin — see
  ideas/next-five.md. The boundary rules it needs (no cookie, its own rate
  limit, caps) are settled and tested by the scoreboard now
- pull space-racer's colours out of its drawing code into `config/look.js` (a
  game refactor, so ask a helper to do it rather than doing it by hand)
- migrate `redwolf-radness` — still one big file, so this is a rebuild rather
  than a move (fun-slide went this way live: `2a6821d` in its repo)
- revisit the deferred control schemes — point-and-click, and normal, the
  DOM-buttons one (ideas/control-schemes.md, "Deferred, and why")
- offer the Top 10 on `Screens.title()` — every game refetches /_scores by
  hand today (the screens library's one surviving open question)
- interpret `:wave:`-style emoji shortcodes in messages (deferred from the
  reactions build; new-y has none to copy, so the map is ours to write)
- replay the in-flight reply to a tab that connects mid-fire — the server
  holds the streamed text already; a reload today shows only what arrives
  after it (spec.md §9). The other half: a tab that reconnects refetches only
  the file tree, so a live row whose fire ended while it was away never clears
- ! give a helper three thinking settings instead of two — full, low, off —
  and start game-building helpers on low. Measured: at the default effort an
  ambitious request produced output once in nine runs, the trace filling
  whatever budget it was given (spec.md §14, the cliff)
- ! bound a helper's thinking: a fire whose trace passes a ceiling with no tool
  call yet is on course to spend nine minutes and produce nothing, so stop it
  there and re-fire with thinking off rather than letting it run out. Raising
  max_tokens is not the fix — the trace grows to fill it
- the Thinking panel shows the top of the trace and nothing ever scrolls it, so
  a long think looks stopped — stick it to the newest thought, and say on the
  dots line how long it has been going
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token (bounded to logout now), in-memory lockouts,
  no rate limit outside login, and sessions that never expire or rotate
