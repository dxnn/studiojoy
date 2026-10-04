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

**Status: queued.**

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

## 4. A bot that plays

**Status: queued.**

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

## 5. Points

**Status: queued.**

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

## 6. Avatars

**Status: queued.** Waits on §1 and §5.

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
