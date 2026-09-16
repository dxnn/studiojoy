# TODO

v0 is built and green. `spec/` is the design-of-record; §15 lists what was
deliberately deferred.

- ⚠️ a bug report still sizes as a *reply* about one time in three. The
  symptom rule took it from roughly 3-in-9 to 7-in-9 (spec/ §14), which is
  better and not fixed; a kid reporting a broken game is the commonest ask
  there is. ⚠️ Do not tune the wording against three runs an ask — that fits
  the noise. It wants a bigger ask list and more reps before another go
- watch what the builder does with `look_at` and `look_at_game` now it can see
  (spec/ §8). Two questions a browser cannot answer: whether a *shot* taken
  only on send is the right moment, and whether "nobody has the game open"
  comes back often enough to be worth a second trigger
- a *shot* of a game drawn in HTML rather than on a canvas — every visual
  novel has none, so the one template a kid is most likely to be looking at
  is the one a helper cannot see. Wants an answer that is not a library
- the plan card's synopsis: one no-tools call over the pieces' headlines when
  a plan of two or more finishes, as the card's head (ideas/planner.md, step
  6, the small half)
- sub-pieces when a piece outruns its budget, one level deep. Today a piece
  that hits a limit is marked done and the next builds on half a job
  (`runPieces`, `onLimit: 'stop'`); a *small ask*'s overrun is already
  re-sized as a plan of the rest (`planRest`), so this is the same for a
  piece, nested (ideas/planner.md, step 6, the big half)

- now a real push has landed (2026-09-11, installed PWA on a phone), check the
  two things only a real one shows:
  whether the service worker's visible-window suppression is right on a phone
  (a PWA in the app switcher may not be `visible`), and whether the shared
  `tag` really does collapse rung 1's notification and the push into one on
  a hidden tab rather than showing two
- ask the builder to move flip-for-what onto the input module, the way
  space-racer went; then check whether either game wants a sound effect now
  that one can be made without leaving the studio
- let a person lock a game file: the builder gets its API note, not its
  bytes, and cannot write it (ideas/api-notes.md)
- give each game its own four colours in its `config/look.js` — they all wear
  the studio's default crimson until somebody picks (GLOSSARY: *look*)
- the move-and-collect template, with a map editor over `config/world.js`
  where one fits (ideas/templates.md)
- re-check the story editor at phone width: at 390px the scene strip stacks
  over the stage and both are tall. The *height* complaint only — sideways is
  checked now and clean (`test/ui/narrow.ui.js`), so what is left is what a
  browser cannot judge: whether two tall things stacked is usable. The last of
  ideas/vn-builder.md's step 1 — the type, the guide, the fill and both
  stand-ins are built and green, and step 4 (the standard set) is the line
  below
- ⚠️ revisit what a shared picture's licence is. Decided 2026-09-02: the
  *studio collection* records none at all and whoever drew it keeps their
  copyright, which is right for a studio of a few trusted people. It is worth
  asking again if the studio ever grows, if a published game's art needs to
  say where it came from, or if anybody wants to take art out of here and use
  it elsewhere — because "no licence" also means nobody has been given
  permission (spec/ §3, ideas/studio-collection.md)
- moderation of the studio collection is "an admin can take anything out" and
  no queue, which suits a few trusted people and would not suit more. Same
  trigger as the line above
- merge several pictures into one sprite sheet on the way into the studio
  collection — a thing's moods, angles or frames as one strip rather than a
  row each; today `Duplicate…` puts in one picture at a time (spec/ §3)
- the svgsilh half of `npm run pullart` is still written and never run: the
  1,775 pictures in `public/big-set/` are Kenney and PhyloPic, and neither
  `index.json` nor `licences.txt` has an svgsilh entry. No longer urgent —
  there is enough art (said 2026-09-11) — so this is only worth a laptop's
  ten minutes if somebody wants the ~1,100 silhouettes. Everything around the
  fetching *is* checked: the parser against the site's real markup
  (`test/svgsilh.test.js`), and the pick path in a browser against a stand-in
  silhouette (600×300 in, 255×128 PNG out, the strip shave firing). It
  refuses in three seconds from this sandbox, which is the Cloudflare 403
- live **summon**: an Openverse-backed search past the repo, server-proxied,
  restricted to subject-bounded CC0 sources. Designed and measured, unbuilt —
  the big set may turn out to be enough, which is why it waits (ideas/summon.md)
- the standard set is short of **moods**: 30 animal faces, one expression
  each, so a cast member cannot look happy and then worried. More CC0 faces
  with several moods, or the same animals redrawn — `npm test` checks the
  shape, and ⚠️ a portrait must never measure a whole multiple of its height
  or the sprites library animates it (spec/ §6)
- the shipped backgrounds are pixel art at 65×36 to 256×150, and the visual
  novel's `.picture` has no `image-rendering`, so they upscale softly.
  `image-rendering: pixelated` in the template's `css/style.css` is the fix
  and would suit every picture the studio's own editor makes — but it is a
  template, so it only reaches new games and each existing one by hand
- networked multiplayer: a turn-based room relay on the games origin — see
  ideas/next-five.md. The boundary rules it needs (no cookie, its own rate
  limit, caps) are settled and tested by the scoreboard now
- pull space-racer's colours out of its drawing code into `config/look.js` (a
  game refactor, so ask the builder to do it rather than doing it by hand)
- migrate `redwolf-radness` — still one big file, so this is a rebuild rather
  than a move (fun-slide went this way live: `2a6821d` in its repo)
- the point-and-click control scheme: `Input.point()`, an answer about
  coordinate space, and a drawn controller cursor (ideas/control-schemes.md,
  "Deferred, and why")
- let a controller drive a null-controller game's own buttons — pad and arrow
  focus-cycling with a loud focus ring. ⚠️ It cannot live in `input.js` as it
  is: a page of buttons has no frame loop to call `Input.update()`, so it
  wants a heartbeat of its own (ideas/control-schemes.md, "The sixth")
- ask the builder to move space-racer to the buttons scheme, and its
  hand-rolled menus onto Screens.title — its screens still sit under the
  drawn controls
- asteriskoids' upgrade chooser still sits under the drawn touch controls —
  the title and game-over screens step aside now, that one does not. It is
  the game's own screen, and `screens-open` is the library's class to set
- input v6 / screens v14 are swept onto the studio machine, and screens 14's
  own job is confirmed: iOS Safari's toolbars go on a sideways swipe up
  (2026-09-11). What is left is the five touch complaints on a real device —
  text selection and feel were never checkable headless — across all three
  `Screens.fit` games: asteriskoids, vroooooooom and redwolf-radness, the
  three that were cut off sideways (spec/ §4 — the other 17 size their canvas
  to the window and need nothing)
- add, rename and remove a *verb* in Controls. ⚠️ Left out on purpose: `left`,
  `thrust` and `boost` are the game's own words and `Input.held("thrust")` is
  in its code, so a rename in a form is a silent code break. It wants either
  the builder doing both halves or a search of the tree first
- when the shape changes, the notes at the top of `config/controls.js` still
  describe the shape the game was seeded with. Either the panel swaps that
  block for the new shape's, or the presets are made shape-neutral and the
  prose lives only in the panel — the second is smaller and loses the
  vocabulary a hand-editor wants (ideas/control-schemes.md, "Picking one")
- pinch to zoom the pixel editor. Two fingers pan it and the buttons zoom it
  (2026-09-11); a pinch changing the zoom about its own centre was left out to
  keep that change small, and wants the scroll maths pan does not
  (ideas/pixel-editor.md, 1)
- selection and move, then mirror, then flip, rotate and nudge
  (ideas/pixel-editor.md, 5–7). Everything through `setPixel`, so each is one
  undoable gesture for free, the way `pasteFrame` already is
- a grid over the pixel editor above about 8× zoom, with an optional every-8
  guide (ideas/pixel-editor.md, 8)
- replace a colour everywhere in a picture — the palette already edits in
  place, and this is the picture half of the same idea
  (ideas/pixel-editor.md, 9)
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
- ask the builder to move one real game onto the signed-in scoreboard flow
  (`/_me`, `{score}` posts, the sign-in link) and see how the preamble text
  holds up in practice
- interpret `:wave:`-style emoji shortcodes in messages (deferred from the
  reactions build; new-y has none to copy, so the map is ours to write)
- replay the in-flight reply to a tab that connects mid-fire — the server
  holds the streamed text already; a reload today shows only what arrives
  after it (spec/ §9). The other half: a tab that reconnects refetches only
  the file tree, so a live row whose fire ended while it was away never clears
- ! keep watching real plans in production. The first ones read well
  (2026-09-11), which settles the card and leaves the numbers: whether the
  pieces the sizing cuts are the right size, whether `none` pieces come out
  as good as `low` ones, and whether the small ask's 6-turn budget is right
  — a real small
  change that keeps outrunning it and getting planned means it is too tight,
  a "small" that fills it every time means the sizing is calling big things
  small (spec/ §8, `SMALL_TURNS`)
- hold the other surfaces to the conventions the way Controls is now
  (test/conventions.test.js): the story editor, the achievements editor,
  Pics, Hear, Share and the mode row itself — a `render` call and the same
  four assertions each. ⚠️ Two of the four rules still have nothing checking
  them: every `.scroll` has a `data-scroll` name, and an `onclick` that opens
  something returns its promise (callable, so assertable)
- keep the stylesheet honest on its own: a rule for a class nothing renders any
  more. ⚠️ Two ways to get this wrong, both met on 2026-09-03: a substring
  match hides a dead class behind a live *id* (`story-choice` inside
  `story-choice-0`, so nine rules read as seven), and splitting `class:`
  template literals naively calls a composed name dead (`tok-${cls}`,
  `ctl-shape${' manner'}` — 6 of 13, then 47 hits of which most were noise).
  A test that cries wolf gets ignored, so it wants the `${…}` handling right
  before it goes in
- ⚠️ before exposing this beyond a trusted group, revisit the v1 security list
  in spec/ §11: no CSRF token (bounded to logout now), in-memory lockouts,
  no rate limit outside login, and sessions that never expire or rotate
