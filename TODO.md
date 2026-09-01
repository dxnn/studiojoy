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
  with its own editor mode where one fits (ideas/templates.md). The visual
  novel went first and settled the vocabulary they inherit: a *scene*, and
  `set`/`need` on a *switch* rather than the `flip` the adventure sketch had
- ! make the visual novel a game type: the story editor in the centre, the
  conversation left, a Story tab in the rail, then the guide, fill and
  stand-ins — ideas/vn-builder.md, in its build order; it also carries
  `?scene=` and the phone-width re-check
- find a standard set of characters and backgrounds for the visual novel:
  CC0 first, kid-safe, small files, one or two styles that sit together,
  portraits with several moods each — kept studio-side and copied into a
  game when picked, never in the template tree (ideas/vn-builder.md §5)
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
- ask a helper to move space-racer to the buttons scheme, and its hand-rolled
  menus onto Screens.title — its screens still sit under the drawn controls
- ask a helper to move asteriskoids' own title and game-over screens onto
  Screens.title, so the drawn controls step aside there too
- ! deploy input v5 / screens v5: npm run sweep on the studio machine, then
  re-try the five touch complaints on the real phone (text selection and feel
  were never checkable headless)
- offer the Top 10 on `Screens.title()` — every game refetches /_scores by
  hand today (the screens library's one surviving open question); since the
  sign-in build a title screen also wants the `/_me` dance — signed out, show
  the sign-in link instead of posting
- show personal bests beside the Top 100 — tracked per (game, person) in
  `personal_bests` since the sign-in build, displayed nowhere yet
- add `--scores` to `npm run deluser` so a removed player's rows leave every
  board too — today they stay, and the panel deletes per row, per game
  (ideas/scoreboard-trust.md, rung 1)
- build achievements: `config/achievements.js` and its editor, the
  achievements library, `/_achievements` on the games origin, score-given
  ones awarded on a score post, and the helper prompt (ideas/achievements.md)
- ask a helper to move one real game onto the signed-in scoreboard flow
  (`/_me`, `{score}` posts, the sign-in link) and see how the preamble text
  holds up in practice
- interpret `:wave:`-style emoji shortcodes in messages (deferred from the
  reactions build; new-y has none to copy, so the map is ours to write)
- replay the in-flight reply to a tab that connects mid-fire — the server
  holds the streamed text already; a reload today shows only what arrives
  after it (spec.md §9). The other half: a tab that reconnects refetches only
  the file tree, so a live row whose fire ended while it was away never clears
- ! watch the first real fires on the new `low` default and see whether the
  games come out as good — the measurement scored whether files got written,
  not whether they were any good (spec.md §14, the caveat)
- drop `agents.reasoning` once the thinking level has stuck in production; it
  is written and never read, kept only so a rollback lands on its feet
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token (bounded to logout now), in-memory lockouts,
  no rate limit outside login, and sessions that never expire or rotate
