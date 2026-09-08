# Doneness: an arc of stamps a game collects

(Dann, 2026-09-07: "I'd like some notion of the doneness of a game,
independent of its published status. Maybe a manual ratchet: core mechanic,
story, design, polish, tuning — some kind of arc to guide the kids through
making a game. This will depend somewhat on the template. Maybe all
templates come with a built-in guide, like the VN template, showing how to
build the game? But I want to incorporate well known game making principles,
in a fun way.")

## What it is

A game collects **stamps**, in an order its type sets, and the person making
it presses each one when they judge the game has earned it. Six or seven
stamps make the **arc** from "there is a thing on the screen" to "somebody
else has played it and it is out". Each stamp carries one principle real game
makers agree on, said in a kid's words, a handful of checks the studio can
tick on its own from the tree, and two or three things to *ask the builder
for* — pressed, they land in the composer as a request, so a kid learns what
to ask for by asking for it.

The stamp is the person's call. The checks are hints, never gates: a kid who
says "it feels good" with no sound in the game is making a decision, and the
studio's job is to have said what a sound would do, not to refuse. That is
the same posture as the builder's plan card — assumptions written down and
one click to accept, rather than an interview.

Independent of `published`: a game can be out at "It loops" and still be
collecting stamps, and a game can hold every stamp and stay private. The two
answer different questions — *is it shared* and *how far along is it*.

## Why this shape

- **The visual novel's guide is the precedent** (ideas/vn-builder.md §4):
  deterministic, reading what is missing off the model, asking one thing at a
  time, no state beyond what the author set aside. The arc is the same idea
  one level up — over the whole game rather than the story file — with one
  difference: what is "missing" from a game is partly a matter of taste, so
  the last word is a press, not a check.
- **A manual ratchet teaches; an automatic one nags.** A kid who has to say
  "it's fair now" has to have played it and thought about whether it is. The
  checks under it make the thought concrete without making it for them.
- **The card lives where the making happens: the top of Building.** The
  builder's room is where a kid asks for things, and the stamp card is a list
  of things to ask for. Share is the public face and already full; a seventh
  pill is one too many; the bar is a status line and stays one.
- **The builder knows the stage.** One line in the preamble — *this game is
  at "It moves"; the next stamp is "It loops": …* — so its answers fit where
  the kid is, and it can say "that belongs to a later stamp" rather than
  building a boss fight into a game with no score.

## The principles, in kid words

Each stamp is one thing every good game has, and one thing real game makers
say about it. Sources are the ones everybody cites; the words are ours.

| stamp | the principle | what makers say | checks the studio can tick |
|---|---|---|---|
| **It moves** | Make the toy before the game. One thing you do, and it feels good to do it with no score at all. | "Find the fun first" — if moving around is not fun for a minute, no score will save it. | a `js/` file exists; `config/controls.js` has a binding; the game has been played (`play_count > 0`) |
| **It loops** | Do → get → want more. A score, something to lose, and a reason to go again. | A game is a series of interesting decisions; a loop is what makes the second go different from the first. | `config/play.js` exists; `Moments.say` in the tree (a moment named); the scoreboard is on or an ending exists |
| **It looks like something** | A name, a look, a face. What is this, and who are you in it? | Theme is what a player remembers; mechanics are what they do. | `config/words.js` and `config/look.js` exist; an `icon.png` and a `hero.png`; a title screen (`Screens.title` in the tree) |
| **It feels good** | Every action answers back — a sound, a flash, a shake. | "Juice": the same game with feedback on every hit feels twice as good and plays the same. | a sound in `assets/sounds/`; a sprite or a picture the game draws; a sound played in `js/` |
| **It's fair** | Easy for the first thirty seconds, harder after. Play it five times and change one number. | Difficulty is a curve, not a wall; the first thirty seconds decide whether anyone stays. | `config/play.js` has been changed since "It loops" (a version touching it); at least three plays |
| **Someone else played it** | Watch a friend play and say nothing. Write down where they got stuck. | The only test that counts is somebody who is not you, and the rule is to shut up and watch. | plays by an account that is not an author; a message in Humans only from somebody who is not an author |
| **It's out** | Publish it, send the link, watch the board. | Finished beats perfect. | `published`; a score on the board |

The visual novel's arc puts story where the arcade puts the loop, and the
words check replaces tuning:

| stamp | the principle | checks |
|---|---|---|
| **Somebody, somewhere** | A main character and a place to start. | a cast member; a first scene with a picture |
| **It ends** | Every path reaches an ending. | the story editor's own check: no dangling way out |
| **Choices that matter** | A choice that changes what happens later, not only what is said next. | a `switch` set and needed |
| **It looks like something** | as above | `icon.png`, `hero.png`, a place picture per scene |
| **It sounds like something** | Music behind a scene, a noise on a moment. | a track in `assets/music/`; a sound step |
| **Read it aloud** | Read every line out loud. Cut anything you stumbled on. | every scene has been re-saved since the last stamp |
| **Someone else played it** / **It's out** | as above | as above |

The quiz's is the shortest: **Ten good questions**, **Every ending is
somebody**, **It looks like something**, **Someone else took it**, **It's
out**. A free-form game (no type) takes the arcade's arc with one stamp in
front: **What is it?** — one sentence in `SPEC.md`, or pick a template.

## What the card shows

At the top of Building, under the pills, one card in the studio's own voice
(cyan, never gold — a stamp is not a number):

```
┌────────────────────────────────────────────────────────────┐
│ ● It moves   ● It loops   ○ It looks like something  ○ ○ ○ │  the arc, stamps so far filled
│                                                            │
│ It looks like something                                    │  the next stamp, big
│ A name, a look, a face. What is this, and who are you in   │  the principle, two lines
│ it? Theme is what a player remembers.                      │
│                                                            │
│ ✓ config/words.js   ✓ config/look.js   ✗ icon.png          │  the checks, ticked from the tree
│ ✗ hero.png          ✗ a title screen                       │
│                                                            │
│ Ask the builder:  [Give it a title screen]  [Pick colours] │  each lands in the composer
│                                    [This one's earned  ✓]  │  the ratchet
└────────────────────────────────────────────────────────────┘
```

Folded to one row once pressed away (`prefs`, per game, like the preview's
fold), so it never crowds a room that is being used for talking. With every
stamp earned, the row alone: seven filled dots and *This game is done — well,
until somebody wants a level 11.*

`···` on the card: *Take the last stamp back* (the one way backwards, for a
press by mistake) and *Hide the arc*. Nobody but an editor sees the button;
the card itself everybody sees, since everybody can read the game.

## Data and plumbing

- `projects.stage INTEGER NOT NULL DEFAULT 0` — how many stamps the game
  holds. A column, never a file (spec/ §3): the stamps are the person's
  judgement and no `write_file` may move them. `addColumnIfMissing`, default
  0, so every game starts at the first stamp — an old game with everything in
  it collects them in a minute, which is its own small pleasure.
- `POST /api/projects/:slug/stage {stage}` — an editor's, `write: true`, and
  only ±1 from where it is: a ratchet, with one click back. Broadcasts
  `project.updated`, so `updated_at` moves (earning a stamp is a change to
  the game) and every tab's card follows.
- **The arcs are one shared module**, `public/arc.js`, pure data and two
  pure functions — `arcFor(type)` and `checks(stage, files, project)` — read
  by the client for the card and by the server for the preamble, the way
  `achievement-shape.js` is shared. Checks are over what both sides already
  have: the file list, `play_count`, `published`, `scores_on`, the
  achievements list, and for the visual novel the story editor's own
  checks. No new reads.
- **The preamble** gains one line, gated on a type having an arc: *This game
  holds N of M stamps; it is working towards "It feels good": every action
  answers back … Suggest what belongs to this stamp and say so when a request
  belongs to a later one.* In the system prompt (cached), changing only when
  a stamp is pressed.
- **The asks** are the stamp's, per type, as plain requests: *Give it a title
  screen with the name and one line about the game.* Pressed, the words land
  in the composer of the Building room with the caret at the end — the kid
  can change them or send them as they are. Nothing is sent for them.
- The front page and the sidebar say nothing about stamps to begin with.
  Doneness is for the maker; a card in the catalog can wear the dots later
  if it turns out to mean something to players.

## Deliberately out

- **Gates.** No stamp is refused for a failed check, and publishing never
  waits for a stamp. A kid who publishes at "It moves" has shipped a toy,
  which is a fine thing to have done.
- **Points, XP, streaks.** The stamps are the reward; a number beside them
  would be gold on something that is not a score.
- **A helper judging the game.** "It's fair" could be asked of the builder,
  and the answer would be confident and wrong. The only judge is the person,
  and the only test is somebody else playing.
- **An arc for a chat project.** It has no game.

## Build order

1. `public/arc.js`: the arcs, `arcFor`, `checks`. Tested without a screen
   over a fake file list, like the achievement shape.
2. The column, the route, `project.updated`. Tested.
3. The card at the top of Building, folded state in prefs, asks into the
   composer, the `···`. A browser check in `test/ui/`.
4. The preamble line, gated on the type, asserted in `orchestrator.test.js`.
5. spec/ §3 (the column), §6 (the card), §8 (the line); GLOSSARY: **stamp**,
   **arc**; the TODO line.

## Open

- **Words.** *Stamp* is proposed for what a game collects and *arc* for the
  order; the code says `stage` for the count. Neither is in the glossary
  yet, and nothing here is built until they are agreed.
- **Where it shows** is proposed as the top of Building. The other honest
  place is a section at the top of Share, beside published — the argument
  for it is that "how done is it" and "is it out" are read together; the
  argument against is that Share is the public face and the arc is the
  maker's.
- **The checks' reach.** Two checks above read *contents* (`Moments.say`,
  `Screens.title`, a sound played) and the client holds only names. Either
  those checks go, or the server answers them once per stamp press. Names
  only is the cheaper first version.
