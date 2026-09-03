# TODO

v0 is built and green. `spec.md` is the design-of-record; §15 lists what was
deliberately deferred.

- ! paste the rewritten Buildermate Steve and Architect Alice descriptions into
  the Crew tab on the studio machine (ideas/agent-descriptions.md) — a
  description is a database row, so it does not ride the deploy the way the
  preamble half of this change does
- try a two-helper game (a builder plus a critic) and see whether the
  bot-to-bot dampening makes the second one useless in practice
- ask a helper to move flip-for-what onto the input module, the way space-racer
  went; then check whether either game wants a sound effect now that one can be
  made without leaving the studio
- let a person lock a game file: helpers get its API note, not its bytes,
  and cannot write it (ideas/api-notes.md)
- give each game its own four colours in its `config/look.js` — they all wear
  the studio's default crimson until somebody picks (GLOSSARY: *look*)
- the move-and-collect template, with a map editor over `config/world.js`
  where one fits (ideas/templates.md)
- ! the point-and-click adventure template and its editor — the spot picker
  is the editor, not a follow-up, because a helper cannot see a picture
  (ideas/point-and-click.md)
- ! the racing template: laps against rivals, and a track editor you draw
  with a finger over `config/track.js` (ideas/racing-template.md)
- re-check the story editor at phone width: at 390px the scene strip stacks
  over the stage and both are tall. The last of ideas/vn-builder.md's step 1
  — the type, the guide, the fill and both stand-ins are built and green,
  and step 4 (the standard set) is the line below
- ⚠️ revisit what a shared picture's licence is. Decided 2026-09-02: the
  *studio collection* records none at all and whoever drew it keeps their
  copyright, which is right for a studio of a few trusted people. It is worth
  asking again if the studio ever grows, if a published game's art needs to
  say where it came from, or if anybody wants to take art out of here and use
  it elsewhere — because "no licence" also means nobody has been given
  permission (spec.md §3, ideas/studio-collection.md)
- moderation of the studio collection is "an admin can take anything out" and
  no queue, which suits a few trusted people and would not suit more. Same
  trigger as the line above
- the standard set is short of **moods**: 30 animal faces, one expression
  each, so a cast member cannot look happy and then worried. More CC0 faces
  with several moods, or the same animals redrawn — `npm test` checks the
  shape, and ⚠️ a portrait must never measure a whole multiple of its height
  or the sprites library animates it (spec.md §6)
- the shipped backgrounds are pixel art at 65×36 to 256×150, and the visual
  novel's `.picture` has no `image-rendering`, so they upscale softly.
  `image-rendering: pixelated` in the template's `css/style.css` is the fix
  and would suit every picture the studio's own editor makes — but it is a
  template, so it only reaches new games and each existing one by hand
- networked multiplayer: a turn-based room relay on the games origin — see
  ideas/next-five.md. The boundary rules it needs (no cookie, its own rate
  limit, caps) are settled and tested by the scoreboard now
- pull space-racer's colours out of its drawing code into `config/look.js` (a
  game refactor, so ask a helper to do it rather than doing it by hand)
- migrate `redwolf-radness` — still one big file, so this is a rebuild rather
  than a move (fun-slide went this way live: `2a6821d` in its repo)
- the point-and-click control scheme: `Input.point()`, an answer about
  coordinate space, and a drawn controller cursor (ideas/control-schemes.md,
  "Deferred, and why")
- let a controller drive a null-controller game's own buttons — pad and arrow
  focus-cycling with a loud focus ring. ⚠️ It cannot live in `input.js` as it
  is: a page of buttons has no frame loop to call `Input.update()`, so it
  wants a heartbeat of its own (ideas/control-schemes.md, "The sixth")
- ask a helper to move space-racer to the buttons scheme, and its hand-rolled
  menus onto Screens.title — its screens still sit under the drawn controls
- asteriskoids' upgrade chooser still sits under the drawn touch controls —
  the title and game-over screens step aside now, that one does not. It is
  the game's own screen, and `screens-open` is the library's class to set
- ! deploy input v6 / screens v12: npm run sweep on the studio machine, then
  re-try the five touch complaints on the real phone (text selection and feel
  were never checkable headless)
- add, rename and remove a *verb* in Controls. ⚠️ Left out on purpose: `left`,
  `thrust` and `boost` are the game's own words and `Input.held("thrust")` is
  in its code, so a rename in a form is a silent code break. It wants either a
  helper doing both halves or a search of the tree first
- when the shape changes, the notes at the top of `config/controls.js` still
  describe the shape the game was seeded with. Either the panel swaps that
  block for the new shape's, or the presets are made shape-neutral and the
  prose lives only in the panel — the second is smaller and loses the
  vocabulary a hand-editor wants (ideas/control-schemes.md, "Picking one")
- draw on the real phone now the pane fits: a finger is not a pointer, so how
  big a sprite has to be before a 1-pixel brush is usable, and whether a stroke
  that starts off the canvas is a scroll, are both things headless cannot say
- a fourth screens snippet: the choices list, from asteriskoids' upgrade
  cards — deferred from the snippets build as much bigger than board/rows,
  and it wants a real second game asking for it first
- add `--scores` to `npm run deluser` so a removed player's rows leave every
  board too — today they stay, and the panel deletes per row, per game
  (ideas/scoreboard-trust.md, rung 1)
- run the achievements helper live against a real game once, the last step of
  the achievements build (ideas/achievements.md, "The achievements helper");
  the rest is built and green
- make the achievements helper a *microhelper*, now that the story's fill and
  drawn stand-in have shown the shape works (ideas/achievements.md, the last
  section). It wants tools, which those two do not, so it is the first one
  that is not a single request
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
- ! build small asks: a sizing call, one fire per step, and a standard builder
  chat that takes no other helper (ideas/planner.md) — four decisions and the
  names are still open there; spec.md §14 wants the four probes' tables
- drop `agents.reasoning` once the thinking level has stuck in production; it
  is written and never read, kept only so a rollback lands on its feet
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec.md §11: no CSRF token (bounded to logout now), in-memory lockouts,
  no rate limit outside login, and sessions that never expire or rotate
