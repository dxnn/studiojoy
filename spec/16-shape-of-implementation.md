## 16. Shape of the implementation

Zero runtime dependencies: `node:http`, `node:sqlite`, `node:crypto`,
`node:child_process` for git. No build step, no framework; the deployed
studio installs nothing (`npm ci --omit=dev`).

One devDependency, since 2026-09-06: Playwright, reached only by
`npm run ui` (§17). It buys the checks a DOM stand-in cannot make — real
geometry, computed colour, a real pointer — and it is kept out of `npm test`
so the suite still runs on a fresh clone with nothing installed.

```
server/
  index.js        boot: env, db, two listeners
  app.js          createApp({db, broker, llm, gamesDir, ...}) -> handler
  games.js        createGamesApp({db, gamesDir}) -> handler
  catalog.js      the games origin's front door, server-rendered whole (§6)
  db.js           MIGRATIONS array + addColumnIfMissing + tx()
  auth.js         scrypt, studio sessions, requireAuth, remove/restore account
  players.js      the player cookie, player_sessions, the waiting list
  authors.js      who may change a game: canEdit, requireAuthor (§11)
  chats.js        a conversation inside a project; requireChat,
                  assertBotsAllowed, and the per-chat caps
  mentions.js     one rule resolves a helper's name and a person's (§8)
  builder.js      the builder: the studio's own agents row, its room in every
                  game, and the upgrade that gives existing games one
  plans.js        a plan's row: pieces, status, the pause on open
  broker.js       SSE fan-out to every tab
  budget.js       studio-wide daily counter
  http/
    router.js     method + :param/*wildcard matching
    body.js       JSON and raw body readers with caps
    static.js     extension mime table, traversal-safe serve
    respond.js    HttpError, and the JSON refusal the router turns it into
    origin.js     play and preview links derived per request from Host (§7)
  util/
    html.js       escaping shared by the catalog and the blank start page
    text.js       codepoint ranges rather than a regex, so no invisible bytes
    time.js       the next UTC midnight, for the budget's lazy rollover
  reporter.js     the injected script, and the wrapper it goes into (§8)
  runtime.js      what the running game reported, per project
  scores.js       the scoreboard: top, submit, the shared rate limiter
  achievements.js the earned rows, and the defs read from config/achievements.js
                  through public/config-file.js — ⚠️ the first server import from
                  public/. parseConfigFile is pure (no eval), and the shape it
                  reads with, public/achievement-shape.js, is the same module the
                  achievements editor uses, so the games origin and the form
                  cannot disagree about which entries are valid.
  story.js        the two small asks (§6): the fill's and the stand-in's tiny
                  prompts, the two walls around each, and the charge. Not a
                  fire — nothing here writes a row but user_tokens.
  collection.js   the studio collection: the caps, the PNG measurement, and
                  ⚠️ readsAsStrip, which is the sprites library's own rule kept
                  in one place so a contributed portrait cannot animate.
  files/
    paths.js      project-path validation (§4)
    tree.js       recursive listing, caps
    git.js        per-project repo: init, commit, log, show, diff, mv
    mutex.js      per-project serialization
    library.js    the studio library scaffolded into a tree, and the sweep (§4)
    templates.js  a game template's starter tree, copied in at creation (§4)
    schemes.js    the control scheme registry: validation, and which seed a
                  chosen scheme is (§4)
  llm/
    deepseek.js   SSE -> {delta|reasoning|tool_use|end} iterator, and
                  complete() for one whole answer with no stream at all
    tools.js      the four file tools
  agents/
    orchestrator.js  dirty bit, cooldown, tool loop, context builder, the
                     builder's sizing and pieces
    sizing.js        the sizing ask, its parser, and a piece's turn
  routes/         auth, admin, projects, agents, chats, messages, achievements,
                  errors, files, history, story, helpers, stream
public/
  index.html      shell
  main.js         the SPA's core: state, transport, URL, boot, and render()'s
                  own composition (§17)
  dom.js          h(), and the icon buttons
  stream.js       the SSE connection and streaming replies
  notify.js       telling somebody while they are away: the switch, and the
                  notification itself, shown through sw.js's registration
  telemetry.js    what a running game reports: problems and moments
  files.js        the file lifecycle: open, save, rename, duplicate, delete,
                  copy into another game or the studio collection
  drawing.js      the pixel editor and the game's own colour palette
  sound-editor.js reading and saving a sound's own numbers
  files-tab.js    Code: the file list and the open file's editor
  pics-hear.js    Pics and Hear
  history.js      Versions: load, diff, restore, rollback
  scoreboard.js   the Share page's scoreboard section
  chats.js        switching chats, mentions, attaching a helper
  people.js       the studio's roster and the admin panel's data
                  each a slice of a game's state, split out of main.js; import
                  the core from it and, where they need each other's, from one
                  another the same way
  sidebar.js  chat.js  versions.js  config-form.js  sound-form.js
  dialogs.js  upload.js  achievements-form.js  quiz-form.js  story-form.js
  story-guide.js  controls-form.js
                  one pane or feature each, importing the core from main.js
  game-types.js   which editors a game's type puts in the centre pane (§6)
  config-file.js  patch.js  pixel-editor.js  sound-maker.js  highlight.js
  achievements-editor.js  achievement-shape.js  quiz-editor.js  story-editor.js
  controls-editor.js
                  pure logic, shared with npm test (achievement-shape.js also
                  imported by the server, above)
  studio-lib/     the studio library's source: index.json, and a directory per
                  library — copied into a game, never served to one (§4)
  templates/      a library's seeds: config/controls.js per control scheme,
                  config/achievements.js — written once, never replaced (§4).
                  index.json is the scheme registry: what New game offers,
                  and which seed each scheme starts from
  game-templates/ a starter tree per template, plus the blank start page (§4)
  story-art/      the standard set the example story copies in (§4)
  big-set/        the big set: 1,775 CC0 pictures written by
                  `npm run pullart`, a source at a time, and committed.
                  Searched offline, so a word gets a picture with no
                  network and no third party
  css/            the stylesheet, one file per surface, linked in order from
                  index.html: base.css first (it sets the custom properties
                  the rest read), narrow.css last (its media queries override
                  rules of their own specificity). ⚠️ A file here that
                  index.html does not link is served and never loaded, which
                  is what test/style.test.js catches
bin/
  adduser.js  deluser.js  restoreuser.js  backup.js  sweep.js  smoke.js
  prompt.js  pullart.js  unzip.js  svgsilh.js
                                    ⚠️ pullart is the only build-time thing
                                    here that reaches the network. unzip is
                                    why reading an asset pack needs no
                                    dependency; svgsilh reads that site's
                                    search results, and neither touches the
                                    network, so both are tested
test/
```

Email and typing previews (both present in `new-y`) are absent permanently,
and a count of unread messages is deferred (§2, §15). The unread *marker* is
built: a dot on the game, the conversation and the pill, `@n` where a mention
says who (§3). So is telling somebody while the studio is running
(`notify.js`, §6); **web push** — reaching an app that is closed — is rung 2
of ideas/notifications.md and the one thing here `new-y` solves with a
dependency this studio will not take.

Tests use `node:test` against `:memory:` SQLite, a temp `GAMES_DIR`, a
scripted fake LLM client and — for the client's own rules — a hand-rolled DOM
stand-in (`test/dom-stand-in.js`, §17), so the suite needs no network, no API
key and no browser. Two things are kept out of `npm test` for that reason: a
manual smoke script, the one place a live key is required, and `npm run ui`,
the one place a browser is.
