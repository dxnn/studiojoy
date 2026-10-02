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
- let the preview report a game that runs slowly, the way it reports an
  error: the reporter (`server/reporter.js`) times its own frames and files
  one problem when a game sits under ~24 a second for a few seconds while on
  screen, so the builder hears it from the device it was slow on. Doki Doki
  reached a frame a second on an older iPad and nobody but the person holding
  it could tell. ⚠️ iOS Low Power Mode holds every page to 30, so the line
  has to sit under that. Wants a sketch in ideas/ first
- finish ideas/planner.md's step 6. The small half: the plan card's synopsis,
  one no-tools call over the pieces' headlines when a plan of two or more
  finishes, as the card's head. The big half: sub-pieces when a piece outruns
  its budget, one level deep. Today a piece that hits a limit is marked done
  and the next builds on half a job (`runPieces`, `onLimit: 'stop'`); a
  *small ask*'s overrun is already re-sized as a plan of the rest
  (`planRest`), so this is the same for a piece, nested

- try the studio on a real phone and the older iPad: the checks a headless
  browser cannot make (ideas/device-checks.md)
- an announcements room: one studio-wide room whose every message notifies
  everybody (spec/ §6's notifications and web push are what it rides on)
- ask the builder for the one-game chores — fixes that belong to one game
  rather than to the studio (ideas/game-chores.md)
- let a person lock a game file: the builder gets its API note, not its
  bytes, and cannot write it (ideas/api-notes.md)
- the move-and-collect template, with a map editor over `config/world.js`
  where one fits (ideas/templates.md) — the *plan canvas* is its drag half
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
- networked multiplayer: a turn-based room relay on the games origin — see
  ideas/next-five.md. The boundary rules it needs (no cookie, its own rate
  limit, caps) are settled and tested by the scoreboard now
- the point-and-click control scheme: `Input.point()`, an answer about
  coordinate space, and a drawn controller cursor (ideas/control-schemes.md,
  "Deferred, and why")
- let a controller drive a null-controller game's own buttons — pad and arrow
  focus-cycling with a loud focus ring. ⚠️ It cannot live in `input.js` as it
  is: a page of buttons has no frame loop to call `Input.update()`, so it
  wants a heartbeat of its own (ideas/control-schemes.md, "The sixth")
- add, rename and remove a *verb* in Controls. ⚠️ Left out on purpose: `left`,
  `thrust` and `boost` are the game's own words and `Input.held("thrust")` is
  in its code, so a rename in a form is a silent code break. It wants either
  the builder doing both halves or a search of the tree first
- when the shape changes, the notes at the top of `config/controls.js` still
  describe the shape the game was seeded with. Either the panel swaps that
  block for the new shape's, or the presets are made shape-neutral and the
  prose lives only in the panel — the second is smaller and loses the
  vocabulary a hand-editor wants (ideas/control-schemes.md, "Picking one")
- the pixel editor's next steps (ideas/pixel-editor.md): pinch to zoom (1);
  selection and move, then mirror, flip, rotate and nudge (5–7); a grid above
  about 8× zoom (8); and replacing a colour everywhere in a picture (9)
- a fourth screens snippet: the choices list, from asteriskoids' upgrade
  cards — deferred from the snippets build as much bigger than board/rows,
  and it wants a real second game asking for it first
- finish the achievements helper (ideas/achievements.md): run it live against
  a real game once, the last step of the build, and the rest is built and
  green; then make it a *microhelper*, now that the story's fill and drawn
  stand-in have shown the shape works. It wants tools, which those two do
  not, so it is the first one that is not a single request
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
- give Knock it down levels and kinds of body it makes up, the way Roll a ball
  has them — ideas/knockdown-levels.md, three questions waiting
- decide how a free-form game reaches three.js and a 3D physics engine —
  ideas/open-engines.md, three questions waiting
