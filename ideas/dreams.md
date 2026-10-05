# Dreams: eight thoughts, six talks

(Dann, 2026-10-04.) Eight bullets, grouped into six, walked through one a
turn: talk, iterate, then build. Each section says what was said, what the
studio already has that it rides on, the shape I would suggest, what it
pulls against, and what is open. A section's status line moves as we go.

> - a better guide, that prompts you to think through what you want, before
>   building anything — no LLM, just designing the spec
> - Maybe that's the standard path… just one path everyone follows, for all
>   game types?
> - And the templates are actually added after, once the spec is drafted.
>   There's a decision about whether this should be a template game or not,
>   and what engines to include, and what controls to include… could use Jev
>   for this, I have an account there.
> - Maybe build a bot that plays the game, so you can see it running?
> - How hard would it be to hot swap the state? so you can see the edits in
>   real time? At least for a debug mode…
> - Think of these as "mini games". The macro game is about building up
>   "points". You can imbue your game's achievements with points. Each author
>   gets a certain number of points per week. They only roll over for a month
>   or so? Or they don't roll over at all? And only new achievements count,
>   ones that no one has achieved yet… and you can only put them on published
>   games. Or they only count after you publish it? Maybe no limit on whether
>   people already have the achievements, just the publication limit.
> - You can use points to buy stuff to decorate your avatar. Each author can
>   create one new avatar item per week. All avatar items cost X points, where
>   X is like 10x your weekly point allowance.
> - Your avatar shows publicly? Our names are already there… maybe I should
>   redact the names online, just put initials? If you're not logged in you
>   only see initials? I dunno. A code name?

## The order, and why

1. **Who the public sees** — the last bullet. First because it is the only
   one that is live today: kids' names are on a public page right now. Small,
   and §6 (the avatar) hangs off it.
2. **One way in** — the first three bullets: design first, then decide how
   it is made.
3. **Live tweaks** — the hot swap.
4. **A bot that plays.**
5. **Points** — the macro game.
6. **Avatars**, and what points buy for them.

How they lean on each other: §1 → §6 (the avatar is the public face); §5 →
§6 (the price is in points); §4 never feeds §5 (a bot earns nothing); §3 and
§4 together are the *It's fair* stamp's loop — play it, change one number,
play it again — done in a minute instead of a sitting.

## 1. Who the public sees

**Status: built 2026-10-04.** spec/ §3 and §7 are the record now.

### Decided

- **Aliases**, not code names or initials. Every board shows the alias,
  public and studio alike; the games origin never says an account's name; the
  studio's chats keep the name. A studio scoreboard can be flipped to show
  real names.
- **Typed by the person**, defaulting to `Alias <n>` with `n` the account's
  id (never reused: `AUTOINCREMENT`, and accounts are never deleted). Admins
  set one in the panel like a name.
- **Changed only from the studio** — your own name in the sidebar's bottom
  row opens *Your settings* — never from the front page. A player asks an
  admin.
- **Unique**, ignoring case; **not your own name** or its first word.
- **The rows from before sign-in are deleted**: typed names, no account to
  give an alias. Only `bloop-s-quest` called the board before sign-in landed
  (2026-08-31, one day before), so at most a day of one game's rows.
- `robots.txt` disallows everything on the games origin.

What follows is the sketch as it stood before these answers.

### What is public today (checked 2026-10-04)

- `/:slug/_players` lists every personal best and every achievement holder
  by account name, to anybody, signed in or not (`server/games.js:239`,
  `:246`).
- `/_scores/<slug>` answers `{name, score}` to anybody, and every game's
  `Screens.board()` draws it.
- ⚠️ The name on a board row is a **copy** taken when the score was posted
  (`scores.name`, `server/scores.js:49`). Changing what boards say means
  rewriting rows, not only changing a read.
- The name is whatever was typed at sign-up, under *Your name is what the
  scoreboards will show*, or handed to `adduser`.
- Not public: authors (no catalog card names one), the crew list, messages.
- No `robots.txt` and no `noindex` on the games origin. A hostname with an
  HTTPS certificate is listed in Certificate Transparency logs, so an
  unlinked hostname is not a hidden one.

### Three ways

| | public sees | signed in sees | cost | weak spot |
|---|---|---|---|---|
| **Initials** | `D. F.` | the name | a read change and a row rewrite | siblings share a surname letter, so two `S. B.`s on one board; dull |
| **Code name** | `Brave Otter` | `Brave Otter` | a column, dealing, a row rewrite | everyone learns a second name for each other |
| **Both** | `Brave Otter` | `Brave Otter (Sam)` | the above plus two renderings | the JSON a game reads changes with who is looking |

### The shape I would suggest

- **A code name, and one rule at the boundary that already exists:** the
  games origin only ever says the code name; the studio origin only ever
  says the name. No cookie-dependent rendering, nothing for game code to
  leak, and nobody has to remember which page is which.
- **Dealt, not typed:** an adjective and an animal from a fixed list, with a
  re-roll. Safety is the list, not a filter — the *pull*'s rule. A kid cannot
  type their real name into it, nothing rude can be made of it, and the list
  can be built to keep every name unique (40 adjectives × 60 animals is
  2,400).
- **Every existing account dealt one at migration**, and every stored board
  row rewritten in the same migration, so the old names leave the public
  side in one step.
- **`robots.txt` that disallows everything** on the games origin, since the
  boards were never meant to be internet-public (ideas/scoreboard-trust.md,
  rung 4).
- Ties to §6: the dealt animal is the avatar's starting face — *Brave Otter*
  begins as the big set's otter.

### What it touches

`users.code_name` (unique); dealing in `createUser` and in approving a
sign-up; `submitScore`; the players page and `/_me` in `server/games.js`;
the sign-up line in `server/catalog.js`; a migration; spec/ §3, §6, §7, §11;
the glossary. ⚠️ A re-roll on the catalog is a **new write on the games
origin**, whose writes are a counted list (spec/ §7). Players re-rolling
from the admin panel instead keeps that list as it is.

### Open

- Initials, code name, or both?
- Dealt with a re-roll, or typed?
- Where a player re-rolls: the catalog (a new games-origin write) or nowhere
  but an admin's panel?
- Words: **code name** in the interface, `code_name` in the code — neither
  is in the glossary yet.

## 2. One way in: design first, then how it is made

**Status: built 2026-10-04**, without Jev; spec/ §6 *Game Design* is the
record. Decided: the cards live in the game; every card is asked, with *Skip
to making it* always there; the cards take the place of `Building` until the
game is made; Jev later; the pill says **Game Design**. A spec editor that
brings the cards back after Make it is a different thing, not built. What
sits below is how it was worked out.

### What exists

- New game asks a name, **Start from** (a blank page or seven templates) and,
  for a blank page only, **How is it played?** (`public/dialogs.js:190`,
  `:240`).
- The template is copied and `projects.type` set **at creation**, and never
  after. A column, so no `write_file` can change which editors somebody sees.
- Two templates carry a **guide** (the visual novel's, the adventure's):
  deterministic cards, the next question read off what the file is missing,
  no state but what was set aside. That is the precedent for this one.
- A blank game's **arc** opens with *What is it?* — one sentence in
  `SPEC.md`, or pick a template.
- **Build it** writes `SPEC.md` from a draft plan's words when the game has
  none.

### The shape I would suggest

- The game exists from the first moment, born **undecided**, and its first
  mode is a design guide: cards, one question each, each answer a section of
  `SPEC.md`. Persisted, so a kid can think about it over three days and
  somebody else can read it and help; in the history like everything else.
- The questions are a kid-sized one-page design: what you *do* (the verb),
  who you are, where, what you are trying to do, what gets in the way, how
  it ends, a game it is like, how you hold it, flat or 3D, does anybody talk.
- Then one **how it's made** card: a recommendation — a template or free
  form, which extras (physics, 3D), which control scheme — that the person
  confirms. Applied once, as one commit; the type set once, by a person,
  through a route.
- The template's own guide (the story's, the adventure's) becomes the second
  stage. The arc's *What is it?* becomes this guide's finish.

### Where Jev fits

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) is
"unstructured state in, typed probabilistic decisions out", 70–500 ms a call,
with calibrated confidence. The how-it's-made card is exactly that shape: a
kid's free-text answers in, a choice from a closed set out (eight starts, two
extras, six schemes), with a confidence that lets the card say *pretty sure:
Knock it down* or *could be either*. Without it, the questions become
multiple choice and the mapping a table — which is fine, and is what "no LLM"
literally asks for.

### Pulls against

- Templates ship their own `SPEC.md`, `BRIEF.md` and `index.html`. Applied
  after, the guide's spec and the template's have to merge.
- The quiz *needs no helper at all*; a design guide in front of it is three
  minutes before the first question. One path, or one path with a shortcut?
- Jev is a second provider: a key in `studio.env`, a budget beside
  DeepSeek's, and a kid's game idea leaving for a third party.

### Open

- Does the guide live in a game (persisted) or in the New game dialog
  (ephemeral, simpler, no "apply a template later")?
- Is Jev inside "no LLM", or is the table the point?
- A shortcut for somebody who knows they want a quiz?

### What the code forces (checked 2026-10-04)

- Today a game's template, its libraries and its type are all decided
  **before its row exists** (`POST /api/projects`, `server/routes/projects.js`
  :170–217): the repository, then the core libraries with the chosen
  scheme's `config/controls.js`, then the template's tree or the blank page,
  then the row with `type`. "Template after the spec" needs one new thing: a
  template applied to a game that already exists, **once**.
- A template brings its own `SPEC.md`, `BRIEF.md` and `index.html` (the quiz
  has all three); the racing one brings `config/controls.js` too. Applied
  over a guide-written `SPEC.md`, the two specs merge — the guide's on top as
  what this game is, the template's under it as how the template works — and
  the template's other files replace the blank page's, which were only ever
  placeholders.
- `projects.type` stays a column set by a person-pressed route, so no
  `write_file` can change which editors somebody sees.
- Every game is born with `Building` and the builder in it (CLAUDE.md). While
  a game is undecided, anything the builder writes into the blank page is
  overwritten when a template lands.
- [Jev](https://flaviocopes.com/jev-api-key/) is one call: `POST
  https://api.typesafe.ai/v1/systemone` with the answers as `state` text and
  named questions — `choice` (up to 255 options) and `noul` (yes/no, answered
  as a probability). $0.042 per million input tokens, output free. New
  sign-ups paused on 2026-09-22; Dann's account predates that.

### The proposal

**New game asks a name, and nothing else.** The game is born *undecided*:
`Humans only`, `Building`, the blank page, and one editor mode — the guide.

**The guide asks one card at a time,** the story guide's posture: the next
question is read off `SPEC.md`, each answer is a section of it, and *Not sure
yet* is always an answer, so it is never a wall.

1. **What do you do?** — Answer questions · Read a story and choose · Explore
   and click on things · Race around a track · Throw things to knock them down
   · Roll a ball through a maze · Dodge and shoot · Something else…
2. **Who are you?**
3. **Where are you?**
4. **What are you trying to do?** — Win · Get the most points · Reach the end
   · Find out what happens · Last as long as you can · Something else…
5. **What gets in your way?**
6. **How does it end?** — You win · You lose · A high score · One of several
   endings · It never ends
7. *Something else only:* **How do you play it?** — Tap or click things ·
   Arrows or a stick · One button · Swipes · Two sticks
8. *Something else only:* **Flat or 3D?** and **Do things fall and bounce?**

**Under the cards, the how-it's-made card,** filled in from card 1 onwards:

```
┌──────────────────────────────────────────────────────────┐
│ How it's made                                            │
│                                                          │
│ Knock it down                                            │
│ A sling, a pile, and targets. You build the pile by      │
│ dragging — no code needed.                               │
│ With: physics   Played by: dragging on the screen        │
│                                                          │
│ 4 of 6 answered                          [ Make it ✓ ]  │
└──────────────────────────────────────────────────────────┘
```

The recommendation is a **table** from card 1: each answer but the last names
its template (and so its scheme and extras). *Something else…* is free form,
its scheme from card 7 and its extras from card 8. No model anywhere.

**Make it** is one commit: the template's tree over the blank page, the specs
merged, the extras added, the scheme seeded, and `type` set once — then the
game opens where a template game opens today (Questions for a quiz, Write for
a story), whose own guide carries on.

**Jev, later and only for *Something else…*:** the kid's free text plus
cards 2–6 as `state`, a `choice` over the eight starts and two `noul`s, and
the card says *pretty sure: Knock it down* or *could be either*. Server-side,
its key in `studio.env` beside DeepSeek's.

### Still to decide

- In the game (above) or in the New game dialog?
- Every card before Make it (with *Not sure yet*), or Make it from card 1?
- The builder while a game is undecided: there and told it is design time,
  or not until Make it?
- Jev: later for *Something else…*, now, or never?
- The mode's name: **Idea**, **Dream** or **Design** — not *Plan*, which is
  the builder's.

## 3. Live tweaks

**Status, 2026-10-04: built** — the preview player (its clock, pause, step
and speed, never on a board), **State** (a yes from Dann; all seven templates
on it, physics 2 keeping its bodies in its saves), **Pin / Back**, **Try**
through the savepoint with `?scene=` and `?level=` gone from the games, and
the **tweaks** under the preview. **TODO lines:** the existing games moved by
hand; the rail made the preview player's alone; registered moments for
achievements. *Decided* and *State* are at the end of this
section; what sits between is how it was worked out.

### What exists

- Every write reloads the preview (`files.changed`); the game boots from its
  title. Tuning one number is save → reload → Start → play back to where you
  were. *It's fair* asks for that loop five times.
- ⚠️ Config files are `const` declarations in classic scripts: re-running one
  throws, and a plain `const SPEED = 4` cannot be reassigned. But the hearts
  are **objects** — `PLAY`, `TRACK`, `BODIES`, `LEVELS` — and an object can
  change in place. The arcade reads `PLAY.SHIP_SPEED` every frame
  (`public/game-templates/arcade/js/game.js:76`).
- `public/config-file.js` parses a config file without running it.
- The *reporter* is injected into the *wrapper* ahead of the game's scripts.

### Three rungs, cheapest first

1. **Skip the title on reload.** The preview's reload carries a flag and
   `Screens.title` starts at once. Every game on Screens gets it.
2. **Live numbers.** In a debug mode a config write does not reload: the
   studio parses the new values and posts them to the reporter, which writes
   them into the live object. Works where the game reads config each frame;
   a game that builds something once at boot (a track's geometry) needs a
   rebuild hook — a template can carry one, a free-form game falls back to a
   reload.
3. **Pause, step, slow motion.** The reporter runs first, so it can wrap
   `requestAnimationFrame` and the clock for any canvas game, with no game's
   help.

Not suggested: real code hot swap with the state kept. Every game would have
to serialise its own state, and a helper-written one will not.

### What Dann asked for (2026-10-04)

> A "debug" mode for every game, where I can "pin" a game state, tweak
> values, then jump back to that pinned state and try it.
>
> Debug only applies to the preview game, and is always on there and only
> there. High scores and achievements no longer apply to the preview. So the
> preview is a different kind of player.

So the preview stops being "the game, in a frame" and becomes **the preview
player**: always debugging, never on a board.

### What the code says (checked 2026-10-04)

- Every template keeps a run in **one top-level variable** — `let Run`
  (arcade, rollball, with `Here`), `let Race` (racing), `let Level`
  (knockdown) — loops on `requestAnimationFrame`, takes `dt` from its
  timestamp clamped to 0.05 s, and spawns with `Math.random`.
- A top-level `let` or `const` in a classic script is not a property of
  `window`, but script injected into the same page reaches it through an
  indirect `eval`, to read it and to put a value back. The games origin sends
  no CSP that refuses `eval`.
- The physics library keeps its world and bodies inside itself (`world`,
  `bodies` in `studio/physics.js`), so a pin of the game's variables alone
  would hold references to bodies that kept moving. It needs a save and a
  restore of its own — a new version adding two calls, inside the
  compatibility law.
- The reporter is already injected first into `_studio.html` and already
  talks to the studio by `postMessage`; the studio already parses config
  without running it.
- Today a preview run posts scores and earns achievements like any other,
  under whoever is signed in on the games origin.

### The proposal

1. **The preview player owns time.** The script injected into the wrapper
   hands the game a clock and a random-number stream of its own: the
   timestamps `requestAnimationFrame` passes, `performance.now()` and
   `Math.random()` all come from it. So **Pause**, **Step** one frame and
   **½×/¼×** work on every canvas game with no game's help — and the random
   stream can be put back, so the same meteors fall again.
2. **The preview player is not on any board.** Its posts to `/_scores` and
   `/_achievements` are answered inside the page and never sent — the game
   sees "did not make the board", an achievement still toasts every time it
   is met, so a maker can watch one fire twice — and asking what this player
   holds answers "nothing yet". `/_me` says the player is **Preview**.
   Moments still reach the studio.
3. **Tweaks land live.** A change to a `config/` file the preview can take
   does not reload it: the studio parses the new values and posts them in,
   and they are written into the live objects (`PLAY.GRAVITY = 600`). A file
   it cannot take — a plain `const SPEED = 4`, or anything outside
   `config/` — reloads as today.
4. **Pin and Back to pin.** A pin holds the game's top-level variables — the
   names declared at the top of its own `js/` files, which the studio can
   read; never `config/` (those are the tweaks) and never `studio/` — copied
   where they are plain data and kept by reference where they are not; each
   library's own state through its hook (the physics bodies); the clock; the
   random stream. **Back to pin** puts all of it back and keeps the tweaks.

```
┌ preview ───────────────────────────────────┐
│                  (the game)                │
├────────────────────────────────────────────┤
│ ⏸  ⏭  1× ▾          📌 Pin   ↩ Back to pin │
│ Pinned 0:14 in — the preview is not on     │
│ any board                                  │
└────────────────────────────────────────────┘
```

### Where it pulls

- A game that keeps its state inside a closure, a class or a module has no
  top-level names to pin. The templates pin as they are; for a helper-written
  game the game shape would ask for the run in top-level variables, and an
  explicit call is the way out for a game that cannot.
- The DOM games — the story, the quiz, the adventure — have no frame loop, so
  pause and step mean little there; they already jump with `?scene=`.
- A pin is the page's memory. A reload — a code change — loses it unless the
  pin is made of plain data the studio keeps, which references to live
  objects are not.
- A score posted from the preview today is a real one; after this, a maker
  testing the board sees it not move.

### Decided (Dann, 2026-10-04)

- **One State for every game** instead of `Run`, `Race`, `Level`: a studio
  library with a simple API. It makes pinning easy, gives a save file for
  free, and gives the builder one place to put state rather than closures.
  Pins find it **automatically** — no line per game beyond using State.
- **Tweaks are try-only until Save**, kept simple, and **kept across
  reloads**.
- **The rail is for tweaking and debugging, exclusively**: the game's config
  files under the preview.
- **One savepoint** — Pin again replaces it. The code says `savepoint`; the
  buttons say Pin, since `pinned` is already the code's word for a file a
  message points at.
- The DOM games and jumping to a stage: a TODO line, to look into.

### State (agreed and built 2026-10-04, with `loaded` the one call added)

Since built, two things learned: a savepoint leaves the **clock** alone —
every template's loop takes `dt` from the clock and only caps it from above,
so a clock put back would hand the game a negative frame — and a page drawn
from State, rather than every frame, needs telling after a load, which is
`State.loaded(fn)`.

A core library, `studio/state.js`, global `State` — the game's data *is* the
object, and its four calls are hidden from the data:

```js
State.reset({ score: 0, lives: 3, ship: { x: 480, y: 540 }, rocks: [] }); // a new run
State.score += 10;               // read and change it like any object
State.rocks.push({ x: 100, y: 0 });

const file = State.save();       // the whole run, as text: a save file
State.load(file);                // and back to it

// for a library with state of its own — the physics bodies
State.include("physics", save, load);
```

The rules the builder is given, as the game shape's line:

- Everything that changes while the game is played lives in `State` — never
  in a variable of the game's own, a closure or a class.
- Plain data only: numbers, words, true and false, lists and groups of
  those. No functions, pictures, canvases or library objects — a picture is
  drawn by name, and a physics body is the physics library's.
- Reach through it every time (`State.ship.x`): a load replaces the pieces,
  so a piece kept in a variable of your own is left behind.

A **savepoint** is `State.save()` with the preview player's clock and random
stream; **Back to pin** is `State.load()` and both rewound, the tweaks kept.
Text, so the studio can hold it through a reload. The four canvas templates
move onto it; existing games keep working, and one without State says so
under the preview, with an ask for the builder.

**Tweaks**, once State is in: the config files under the preview as fields;
a change goes into the running game and is kept in this browser for this
game — put back into every new page of the preview before the game's own code
runs — until **Save** writes the files or **Undo the tweaks** drops them.

## 4. A bot that plays

**Status: decided 2026-10-04; items 1–4 of the proposal being built.**

### Decided (Dann, 2026-10-04)

- Build items 1–4 below: the robot, a game teaching it, *just before it
  broke*, fast-forward. *Is it too hard?*, Jev and the catalog card later.
- The robot keeps a **rolling savepoint** of its own and never replaces the
  person's pin. "One savepoint" exists to keep things simple for the kids,
  not to stop the studio doing more behind them.
- The preview player owns `setTimeout`, `setInterval` and `Date.now()` too.
- It is **the robot** in the interface *and* the code: `js/robot.js`,
  `Robot.play`, never `bot`.
- Jev is parked.

### Four wants, four bots

- **Watch it run** while editing — the preview playing itself.
- **Find where it breaks** — random play, with any error coming back through
  the reporter for the builder to hear.
- **Is it too hard?** — a hundred runs and a number.
- **The catalog card playing itself.**

### What exists

- `Input` is the one funnel for every verb, so a bot is one more source of
  presses — a ghost thumb.
- The racing template's rivals already drive the track; the level editor
  already finds what is reachable; the story, adventure and quiz editors
  read the whole graph.
- *Moments* are structured facts about what is happening.

### Rungs

1. **A monkey:** random verbs through `Input`. Any game on `Input`. Catches
   crashes; looks like a toddler playing.
2. **Template bots:** one per template, from what its editor already knows.
3. **A Jev bot:** its Doom demo is structured state to a typed action. The
   legal actions are the game's own verbs from `config/controls.js`, a closed
   set; the state is its moments plus whatever the game publishes. 70–500 ms
   a decision is too slow for reflexes and fine for a few choices a second.

### Constraints

- A bot's run never posts a score, earns an achievement, or (§5) a point.
- Jev is called from the server, never from game code — a key in a game is
  no secret (ideas/scoreboard-trust.md).

### What talk 3 changed (checked 2026-10-04)

Written before the preview player and State existed. Both move this a long
way, because a bot needs exactly what they built: a way in for presses, a
clock it can lean on, and the game's situation as data.

- **The preview player owns time** (`server/preview-player.js`): every
  `requestAnimationFrame` callback runs from its `tick()`, with its own
  `now`. Running that queue several times in one real frame, a frame of
  1/60 s each, is **fast-forward** — the same loop as Step, repeated. And it
  can hold the clock still while something slow decides, so a game *waits*
  for its bot: 500 ms a decision stops being too slow for reflexes. The Jev
  constraint above was about a clock nobody owned.
- **Chance is seeded**, and the seed rides the savepoint. A bot whose own
  choices come from that stream, pressing on frame boundaries, makes a run
  that **plays back exactly**: a seed and a list of presses is the whole run.
- **State is the game's situation as plain data** — what talk 4 called
  "whatever the game publishes", for every game moved onto it
  (ideas/state-migration.md). A bot reads `State.ship.x`, not pixels.
- **A ghost thumb needs no library change.** `Input` fills its held set from
  `keydown`/`keyup` on the window; a synthetic `KeyboardEvent` dispatched by
  the injected script lands the same way. The verbs and their keys are
  `CONTROLS.player1` in `config/controls.js`, a global the page already has.
  A builder game with its own key listeners hears the same events. The one
  `SCHEME` this misses is `none` — the quiz, the story, the adventure — where
  the controls are the game's own buttons, and a bot clicks one.
- **The end of a run is visible**: `Screens` puts `screens-open` on the body
  while a title or game-over screen is up, `screens-over` on the game-over
  one, and a `studio:start` event on the window presses Start
  (`screens.js`, `input.js`).
- **A crash already reaches the builder**: the reporter files the preview's
  errors against the commit (`server/runtime.js`) and the next fire hands
  them over. A bot that breaks the game needs no new path to say so.
- **The preview is already off every board**, so the first constraint holds
  for free inside it.
- **The preview wrapper is the one place to load preview-only code**:
  `wrapHtml` in `server/reporter.js` already rewrites the game's page there.
- What the preview player does **not** own: `setTimeout`, `setInterval`,
  `Date.now()`. A builder game that spawns on a timer is not paused by Pause
  today, would not speed up under fast-forward, and would not play back.

### The proposal

1. **The robot**, in the preview player, for every game. A button under the
   preview starts it and the game plays itself. It presses the game's own
   verbs through synthetic keys — holds a few at a time, for a random spell
   each, drawn from the preview's seeded stream — and presses Start whenever
   a screen is up, so it plays run after run. On a `SCHEME: "none"` game it
   clicks one of the game's visible buttons. Any key or click of yours stops
   it: your hands take over. That is rung 1, and it already answers *watch
   it run* and *find where it breaks*.
2. **A game can teach it.** If the game has a `js/robot.js`, the wrapper
   loads it — in the preview only, so no player ever downloads it — and it
   hands the preview player a function of State that answers which verbs to
   hold this frame:

   ```js
   Robot.play((s) => (s.ship.x < s.target.x ? ["right", "fire"] : ["left", "fire"]));
   ```

   `Robot` is the preview player's, not a library, so nothing is swept. Each
   template ships one from what its editor knows — the racer steers for the
   middle of the road, Roll a ball walks the level editor's `reachable`
   squares to the next coin, the arcade turns toward the nearest rock and
   fires, the story and the adventure pick a choice. A builder game gets one
   when somebody asks the builder to *teach the robot*. That is rung 2.
3. **Where it breaks, and just before.** While it plays, the robot keeps a
   savepoint of its own from a few seconds back. When the game throws, it
   stops, and the preview says so with one button: *go to just before it
   broke* — which loads that moment and makes it the pin. The same seed means
   pressing play from there breaks it the same way, every time, for the
   person and for the builder reading the error.
4. **Fast.** Fast-forward joins ½× and ¼× — 4× and 16× — for watching and for
   rung 3. Sound is muted above 1×.
5. **Is it too hard?** — later, on top of 2 and 4: a hundred runs from the
   pin at 16×, hidden, each from its own seed, and a line in the rail: *37 of
   100 reached level 2 · median 48 s · best 1,240*. With the tweaks it is the
   *It's fair* stamp's loop: change one number, run the hundred again, same
   seeds, and the difference is the number's. Its facts come from moments
   and `Screens`, so a game says how far a run got the way it already does.
   Only worth having with a taught robot — a monkey's hundred runs measure
   the monkey.
6. **Jev** — later still: State and moments in, a verb out, from the server,
   the clock held while it thinks. Its price and its account decide when.
7. **The catalog card playing itself** — not this talk. Either a recorded
   clip (a canvas stream, captured while the robot plays) or a recorded run
   played back; both want the rest first.

### Where it pulls

- **One savepoint.** Talk 3 decided Pin again replaces it. The robot's
  rolling moment is a second one — kept out of sight, never replacing the
  pin unless *go to just before it broke* is pressed. That bends the rule a
  little; the alternative, the robot overwriting the pin every few seconds,
  breaks it.
- **Timers.** For the robot to replay a builder game that times things with
  `setTimeout`, the preview player has to own those too — run them from its
  clock. That also makes Pause pause them, which it should anyway; it is
  also the riskiest change to the preview here, since every game's timers
  start running on a clock that can stop.
- **A taught robot is game code.** `js/robot.js` sits in the tree, so the
  builder can write it and Versions shows it, and a broken one is reported
  like any other file. It never runs for a player.
- **Moments from the robot** reach the studio like any preview's. For the
  achievements editor that is a gift — the robot finds moments nobody has
  played to yet (TODO.md's registered moments) — but the preview's own
  "moments heard" list stops meaning *what a person did*.
- **The interface word.** Settled: *robot*, on the button and in the code.

## 5. Points

**Status: built 2026-10-04** (`server/joy.js`, spec/ §3). The editor offers
1, 5, 10 or 20 joy per achievement — Dann's limit, in the interface only, "we'll
change this later".

### Decided (Dann, 2026-10-04)

- **A bounty, not a pool.** An achievement gives its joy to *everyone* who
  earns it. Inflationary, and that is fine.
- **Two words.** Authors get **chips** — 10 a week — and put them on
  achievements; an achievement with 5 chips on it gives **joy** 5 to anyone
  who earns it. Joy is what you get, and later spend (§6).
- **The stash** holds a person's unspent chips, up to 50; past that, a week's
  chips are not added.
- **Chips put on an achievement stay there** — unpublishing a game or
  deleting the achievement sends nothing back.
- **The joy number is on the achievement**, in gold: the deliberate yes to
  doneness.md's rule, since it is a number a player earns.

The proposal below was the pool; the decisions above replace its steps 1–3
and 7, and its "where it shows" stands.

### How I read it

Two-sided: authors put points on their games' achievements, like a bounty;
players earn them by playing **other people's** games; points buy avatar
things (§6). The macro game is *get people to play your game*, which is what
a published game wants anyway.

### Pulls against

- ideas/doneness.md ruled points out for stamps: "a number beside them would
  be gold on something that is not a score". This puts them on achievements,
  not stamps, but it turns that spirit around and deserves a deliberate yes.
- ⚠️ An achievement unlock is a client's post: devtools can claim one. Worth
  nothing today; worth something once it buys things. Accountable, not true —
  the scoreboard's posture.

### The question everything else follows from

| | **bounty** — every earner gets N | **pool** — N is shared, then gone |
|---|---|---|
| total minted | N × earners, unbounded | exactly the allowances |
| an easy achievement | a points tap | gone by Tuesday |
| "only new achievements count" | — | first earner takes it |
| what 10 × allowance buys | depends on traffic | a fixed share of the studio |

### Rules that look needed whichever

- No points from a game you author, or anybody mints *Press Start: 10*.
- Only on published games, only earned while published.
- Points in SQLite, never in `config/achievements.js`: the allowance is the
  server's to enforce, and no `write_file` may mint — `projects.type`'s and
  `stage`'s reason.
- A ledger of rows (who, how many, why, when) rather than a balance column.
- A balance is a number worth looking at, so gold is right for it.

### What the code says (checked 2026-10-04)

- An earned achievement is one row, `achievements (project_id, user_id,
  achievement, created_at)`, written the first time a player meets the rule —
  posted by the game, through the achievements library, to the games origin.
  Once per person per achievement, forever: the primary key says so.
- Only an account earns: a *player account* or a studio one signed in on the
  games origin. The preview never does — the preview player answers the
  post itself (talk 3), so neither a person testing nor the robot (talk 4)
  can earn anything.
- `projects.published` is a column, so "only while published" is one test at
  the moment of earning. *Authors* are `project_authors`; an *open* game can
  be changed by anybody, but its authors are still a list.
- Achievement definitions live in the game's own `config/achievements.js`,
  which a helper writes. Points cannot live there — anything a `write_file`
  can set, anybody's helper can set.
- ⚠️ **The word.** *Allowance* is taken: it is a person's daily token budget
  for their helpers. And "points", "coins", "gems" and "stars" are already
  what the games themselves count — a kid's score is *points*, Roll a ball
  has coins, fun-slide has gems. The studio's own currency needs a word no
  game uses.
- The studio has about fifteen accounts; authors are the ones with studio
  access. Small enough that *accountable* is the right posture, as it is for
  the boards.

### The proposal

The pool, with a per-player price — because it keeps both promises: the
number of points in the studio is exactly what was handed out, and a player
looking at an achievement knows exactly what it will pay.

1. **Every author gets a weekly handful** to give away — say 50 — into a
   **purse**. Unspent, it rolls over for four weeks and no further: a purse
   holds at most a month's.
2. **An author puts points on an achievement** of a published game they
   author, from the purse: *5 each, for 6 players* takes 30 out at once. The
   achievements editor gets a row for it, showing what is left and the
   purse. Only that game's authors — not everybody an open game lets in.
3. **A player who earns it takes the 5** into their **wallet**, while any
   are left — the first six, which is the "only new achievements count"
   idea grown up: early players are rewarded, and the author decides how
   many. Never on a game you author, never while it is unpublished, and
   never for an achievement earned before the points were put on it.
4. **The wallet buys avatar things** (§6). Only earned points can be spent,
   and only purse points can be given — so nobody can pay themselves.
5. **Where it shows:** a toast on the unlock (*+5*); the achievement's price
   and what is left, on the players page and in the game's achievement list;
   on the catalog card, what *you* could still earn in that game — which is
   the macro game's whole pull; the wallet in the studio's name modal and on
   the games origin. All gold.
6. **One ledger** — who, how much, why (`purse`, `put`, `earned`,
   `returned`, `spent`), which game and achievement, when — and balances are
   sums over it. An admin undoing a forged earn is one more row, and the
   points go back where they came from.
7. **What is left on an achievement goes back to the purse** when the game
   is unpublished or the achievement deleted — subject to the four-week cap.

### Where it pulls

- doneness.md's rule against a number on a stamp: this is a number on an
  achievement, which a player *earns* — the gold that rule protects is
  exactly this kind of number. Worth the deliberate yes.
- ⚠️ A forged unlock now takes real points out of somebody's put. Accountable
  rather than prevented: every earn is a row with a name on it, and the
  undo is a row too.
- Two kids trading easy achievements on each other's games is possible and,
  at fifteen accounts, a conversation rather than a code problem.
- The weekly amount, the cap and avatar prices set the economy together;
  talk 6 picks the price, and an admin can change all three.

## 6. Avatars

**Status: proposed 2026-10-04, waiting on the questions in the reply.**

### What the code says (checked 2026-10-04)

- §1 settled on typed aliases, not dealt animals, so there is no animal to
  start a face from — but the big set holds **Kenney's animal pack**: ten
  CC0 heads (elephant, giraffe, hippo, monkey, panda, parrot, penguin, pig,
  rabbit, snake), each the same rounded square face, about 284 pixels, with
  ears, horns or a beak reaching past it. Aligned on that square, a hat drawn
  for one sits on all ten.
- The pixel editor (`public/drawing.js`) draws on a game's open file, with
  that game's palette, and saves by writing the file. It knows nothing of a
  picture that is not a file, so drawing gear wants a mode of its own:
  opened on a blank picture, with the face ghosted underneath, saving to a
  route.
- Pictures that live outside any game already have a pattern:
  `collection_art`, the **bytes in the row**, so `npm run backup` covers them
  (spec/ §3). Gear would be the same.
- ⚠️ "Thing" is taken: the interface says *thing* where the code says
  `sprite` (the big set's shelf). Gear needs its own word.
- Where a person shows today: the studio's `who` row draws a circle with the
  first letter of your name; the crew list and the chat say names; the games
  origin says your alias in the catalog's header, the players page and the
  boards.
- Joy is a `ledger` sum (§5), so buying is two more `why`s — and a row per
  sale makes "the maker gets paid" one more row, not a new mechanism.

### The proposal

1. **Your avatar is an animal and its gear.** The face is one of the ten
   animal heads — free, yours to change whenever. Over it, up to four pieces
   of **gear**, one in each slot: **back** (a cape, wings, a sky behind),
   **face** (glasses, a mask, a moustache), **head** (a hat, a crown, a bow)
   and **hand** (something held). Drawn in that order, back to front.
2. **Gear is drawn by the people here** — one new piece an author a week, the
   way chips are weekly. A 48 × 48 picture, drawn in the pixel editor's
   **gear** mode over a ghost of the face, so a hat lands on a head; given a
   name and a slot; and offered to the **shop**.
3. **The shop** has every piece anyone has made, all at one price — 100 joy,
   ten weeks of chips — and the maker owns their own for nothing. Buying
   pays the maker: joy moves rather than vanishing, so drawing good gear is
   another way to earn it. Bought is yours for good.
4. ⚠️ **A piece reaches the shop when an admin says yes.** Gear is worn on
   the games origin, which is the internet, and a kid's drawing can hold a
   name, a face or worse; the studio collection gets away without review
   because it never leaves the studio. One piece an author a week keeps the
   queue a handful.
5. **Where it shows**, first: the studio's `who` row in place of the
   letter, the crew list, and *Your settings* — which grows **Your avatar**:
   pick the animal, wear and take off, the shop, and making a piece. On the
   games origin: beside your alias in the catalog's header and on every row
   of a game's players page. Later: beside a chat message, and inside the
   games' own boards (a screens library change).
6. **Stored like the collection**: `gear` (slot, name, the PNG's bytes, who
   made it, who approved it and when), `gear_owned` (who owns which, since
   when), the face and what is worn on `users`, and the joy as `ledger` rows —
   `bought` out of the buyer, `sold` into the maker.

### Where it pulls

- A smooth vector face under chunky pixel gear is two styles at once. That
  is also what makes it read as *theirs*, and 48 × 48 keeps the pixels
  honest at avatar size.
- An admin's queue is a chore. The alternative — gear only inside the studio,
  the bare animal on the games origin — avoids it and loses half the point.
- 100 joy against an achievement that can give 20: a keen player buys a piece
  in an afternoon. Joy is inflationary on purpose (§5); the price is one
  constant.

### A first guess at the shape

- An avatar is a square of layered pixel art: a face (§1's dealt animal from
  the big set) and slots over it — something on the head, the face, in hand,
  behind.
- A thing is drawn in the pixel editor, belongs to one slot, and costs every
  buyer the same: 10 × the weekly allowance. One new thing per author a week.

### Open

- Does buying pay the maker (points move, the economy grows) or burn them
  (points leave, prices hold)?
- Does the maker get their own for free?
- ⚠️ Kid-drawn pictures on the public origin. The studio collection has no
  review because it never leaves the studio; avatars would.
- Where it shows: the catalog, the players page, boards, the crew list,
  beside a message.
