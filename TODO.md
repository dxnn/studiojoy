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
- ! push the three migrated games — asteriskoids, vroooooooom and
  qiby-is-rizzing-at-you are committed locally and unpushed; the server needs
  its `receive.denyCurrentBranch=updateInstead` include first (deploy/README.md)
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
- replay the in-flight reply to a tab that connects mid-fire — the server
  holds the streamed text already; a reload today shows only what arrives
  after it (spec.md §9)
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token (bounded to logout now), in-memory lockouts,
  no rate limit outside login, and sessions that never expire or rotate
