# Achievements

(Dann, 2026-09-01; reworked the same day around moments.) A game can hold
achievements; any signed-in player who plays it can earn them; earned is
forever, per player. Defining one needs no code. The game *says its moments*
once — a level gained, a run over, an ending reached — and every achievement
after that is a rule over those moments, written in a form.

## What the studio already has that this rides on

- **The scoreboard shape.** Rows in SQLite, never the working tree, because a
  tree write is a commit (spec/ §3). The games origin's write rules — the
  `player` cookie, a per-player rate limit, every field capped, a plain 404
  for anything that is not a game's — are settled and tested. An earned
  achievement is the same kind of thing as a personal best: one row per
  (game, person, thing), `INSERT OR IGNORE`, never lowered.
- **`config/` and its editors.** A plain-value file the studio reads without
  running it, and for a file in a known shape, an editor over the whole
  thing (`quiz-editor.js`, `story-editor.js`). Definitions belong here, not
  in a table: versioned, forked with the game, in front of every helper in
  the ambient block, and editable by a kid as a form.
- **The studio library.** Two more libraries, `studio/moments.js` and
  `studio/achievements.js`, the second seeding `config/achievements.js` the
  way input seeds `config/controls.js`. Their API notes teach every helper
  the calls with no orchestrator edit; the sweep gives every existing game
  the files and the empty seed.
- **The reporter.** Already injected into the preview, already posting what
  happens inside the game to the studio page (spec/ §8). Moments ride the
  same channel, so the studio can watch a game say them while it is played.
- **A helper is a row.** Its `description` is its system prompt, layered
  under the studio preamble. A specialised achievements helper is data, not
  code — a description somebody pastes into `New helper`.

## The shape

### Moments — what the game says

```js
Moments.say("level", 3);        // a number
Moments.say("ending", "good");  // a word
Moments.say("run-over");        // just that it happened
Moments.on("level", (value) => { ... }); // listen, if a game wants to
```

`studio/moments.js`, small on purpose: validate, then dispatch a
`CustomEvent("moment", { detail: { name, value } })` on `window`. The DOM
event *is* the bus — the reporter, injected before any library loads, can
listen to it without knowing the library exists, and so can anything later
(a relay, a stats feed). `on` is sugar over `addEventListener` filtered by
name. Names are slug-shaped (`[a-z0-9-]`, ≤ 40); a value is a number, a
string ≤ 100 or nothing, which is `true`. Anything else is one
`console.warn` and dropped. Saying a moment every frame is fine.

Publishing is the game's own, and says nothing about achievements: a moment
is "this happened", not "award something". Templates say theirs out of the
box — the quiz `answered`, `finished` (the result key) and `score`; the
visual novel `scene`, `ending` (a scene with no exit) and `switch` — so an
achievement on a template game needs no helper at all.

### `config/achievements.js` — the definitions

```js
// What a player can earn in this game. Whoever earns one keeps it forever.
// The studio opens this file as the achievements editor, so keep the shape:
// id, name, how, when, and an optional icon.
const ACHIEVEMENTS = [
  {
    id: "first-run",             // never changes: the players who have it are keyed by it
    name: "First run",           // what it is called
    how: "Finish your first run", // how a player gets it, in their words
    icon: "🚀",                   // optional
    when: { moment: "run-over" }, // earned the first time the game says this
  },
  {
    id: "halfway",
    name: "Halfway there",
    how: "Reach level 5",
    icon: "🪜",
    when: { moment: "level", atLeast: 5 },
  },
  {
    id: "good-end",
    name: "Happily ever after",
    how: "Find the good ending",
    icon: "🌅",
    when: { moment: "ending", is: "good" },
  },
];
```

`when` names a moment and at most one test: `atLeast`, `atMost` or `is` on
the value, or `times` on how often it has been said this page. No test means
the moment happening at all. No `when` at all means only a direct
`Achievements.unlock("id")` grants it — the escape hatch for a moment nobody
wants to publish.

The id is slug-shaped and immutable, like a project's slug: earned rows key
on it, so renaming one orphans everybody's. The editor derives it from the
name once and never lets it be edited. `name` ≤ 60, `how` ≤ 200, `icon` ≤ 32
bytes (the reaction cap), at most 50 entries. An entry outside the caps is
skipped by the server and flagged by the editor.

### `studio/achievements.js` — the subscriber

On load: read `ACHIEVEMENTS`, fetch `/_achievements/<slug>` for what this
player already has, subscribe to every moment a rule names. On each moment:
evaluate the rules watching it; one newly met and not yet held or sent is
one `POST` and one toast. `Achievements.unlock(id)` does the same by hand;
`Achievements.mine()` is the GET, for a trophy screen.

The toast is DOM like Screens: at the top under the chips, icon, name and
`how`, in the look's highlight, gone after a few seconds, stable
`achievements-` classes. Signed out, it still shows, with a line saying to
sign in on the front page to keep it, and nothing is stored. A missing
file, an unknown id or a dead network is one `console.warn`, never an
error.

### `achievements` — the earned rows

```sql
CREATE TABLE achievements (
  project_id  INTEGER NOT NULL REFERENCES projects,
  user_id     INTEGER NOT NULL REFERENCES users,
  achievement TEXT    NOT NULL,   -- the id from config/achievements.js
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (project_id, user_id, achievement)
)
```

Permanent means permanent: no route deletes a row and no button does, not
even a whole-game clear like the scoreboard's. Removing a definition from the file leaves the rows;
they are simply shown nowhere until the id comes back. `deluser --scores`
(TODO.md) should take these with it when it is built.

### Games origin — the third write

| method | path | effect |
|---|---|---|
| GET | `/_achievements/:slug` | `{achievements: [{id, name, how, icon, got}]}` in file order; `got` is when the signed-in player earned it (`created_at`, ISO) or null — null throughout when nobody is signed in |
| POST | `/_achievements/:slug` | `{id}` → 401 signed out, 404 no such id in the file, else 201 `{new: true\|false}`; 20 a minute per player, body 1 KB |

The server reads `config/achievements.js` from the working tree per request
and parses it with `parseConfigFile` — the client's own reader, pure, no
eval, imported by tests from `public/` already. The first server import from
`public/`; a small file, on rate-limited routes. The server never sees a
moment — only the unlock a rule produced. Chats are a 404, archived games
keep taking unlocks, as with scores. ⚠️ Forgeable exactly as a score is: the
client is the only witness, and a rule evaluated in the browser is a rule
anyone can satisfy from devtools. Accepted for the same reason.

### Studio side

- **The reporter forwards moments.** It listens for the `moment` event and
  posts `{type: "moment", name, value}` to the studio page, throttled to the
  latest value per name a few times a second. ⚠️ Painted in place like the
  problems panel: a moment said at startup, drawn through `render()`, would
  rebuild the iframe, restart the game and say it again.
- **The achievements editor**: `config/achievements.js` in shape opens as a
  list, one open per row — Name, How to get it, Icon, and a "Happens when"
  row: the moment (a box offering the moments seen this session), a test
  (happens at all / is at least / is at most / is exactly / has happened N
  times) and a value. `+ Add an achievement`, Remove with a confirm, the
  shape lock the other editors have. Two structural reads: how many players
  hold each one (`GET /api/projects/:slug/achievements`, studio origin), and
  a rule naming a moment the game has not been seen to say.
- **Preamble**: `config/achievements.js` joins the config batch list; the
  shape-locked paragraph says three editors, not two, and
  `orchestrator.test.js` asserts the name; one line says to `Moments.say`
  where the game changes state — a level, a run's end, a pickup, a score —
  because that is what achievements are written over. The API notes carry
  the rest.
- **Not in this build**: who-has-what per player in the rail, a trophy count
  on the catalog card, trophies on `Screens.title()`, counts across sessions,
  an `achievements_on` switch (an empty file is the switch). Each a TODO
  line if wanted.

## Build order

1. `moments.js`, `achievements.js`, the seed, the two `index.json` entries;
   node tests for the rule evaluation and the moment validation.
2. The table, `server/achievements.js`, the games origin routes, the studio
   counts route; `test/achievements.test.js`.
3. The reporter forwards moments; the studio keeps a per-game list, painted
   in place.
4. The editor, with the moment picker fed by 3.
5. Preamble lines and their assertions; the templates load the tags and say
   their moments.
6. spec/ §3 §4 §6 §8 §10, GLOSSARY.md, CLAUDE.md; one live run of the
   helper below.

## The achievements helper

A row, made in `New helper`, file tools on, thinking `low`. The description:

> You add achievements to the game you are in, and nothing else unless
> asked. Read the game first: SPEC.md, the config files, and the code where
> the game keeps score, ends a run, changes level, or hands out anything.
> First make the game say its moments: put `Moments.say("name", value)` on
> the exact line where each of those happens — "level" with the number,
> "run-over" when a run ends, "score" with the final score, a word for an
> ending — using short slug-shaped names, and make sure index.html loads
> config/achievements.js, studio/moments.js and studio/achievements.js
> before the game's own scripts. Then write four to six achievements into
> config/achievements.js as rules over those moments: one nearly everybody
> earns on their first play, two or three for playing well or differently,
> one that is hard. Each has a name of two or three words, a `how` line a
> ten-year-old can read that says exactly what to do, an icon, and an id that
> will never change. Keep the file's shape exactly — id, name, how, icon,
> when — because the studio opens it as the achievements editor. Never
> rename an id: the players who hold it are keyed by it. Say what you added
> as one short list, then stop.

The general helper knows the mechanics from the API notes; what this one
adds is taste — which moments are worth saying, the spread, the wording.
Worth one live run against a real game. It is also the first candidate for
a *microhelper* (TODO.md): a fixed-purpose helper the studio ships rather
than one somebody makes as a row.

## Decided

(Dann, 2026-09-01 — every default taken.)

1. Moments are their own tiny library, `studio/moments.js`, not a method on
   Achievements. Publishing is the game's; subscribing is one consumer's.
2. No server-awarded `score:` rule. A score is a moment like any other,
   evaluated in the browser; one mechanism, the same forgeability.
3. The reporter forwards moments and the editor offers the ones it has seen,
   in this build — the editor is not no-code without it.
4. The quiz and visual-novel templates say their moments and load the tags,
   in this build.
5. Field names: `how` for the earning text, `when` for the rule; the tests
   `atLeast`, `atMost`, `is`, `times`.
6. Built in a fresh session, in the build order above. The screens v6 work
   that was in the tree when this was decided has landed since (`f2b66d9`),
   so the tree it starts from is clean.

## Where the editor lives

(Dann, 2026-09-02.) The editor is the rail's **Achievements** tab beside
Scoreboard, not how `config/achievements.js` opens under Files — every game
has the file after the sweep, and a tab is where a kid finds it. No set-up
button: the sweep gives a game the libraries and the seed; the `<script>`
tags in `index.html` and the game's own `Moments.say()` calls stay a helper's
or a person's job. Under Files the file is plain text, the story editor's
rule. Rail rather than centre for now — ideas/editors-in-the-centre.md may
move it later.

## For the build session

- Read CLAUDE.md, then spec/ §3 (`scores`, `personal_bests` — the shape to
  copy), §4 (the library and the compatibility law), §6 (the games origin
  table and the scoreboard's studio-side routes), §8 (the reporter feed and
  the preamble), then this file. `server/scores.js`, `server/games.js` and
  `test/scores.test.js` are the closest existing code.
- `git status` first. Nothing here starts until the tree is clean.
- New libraries take version 1 each; no existing library's version moves.
  The sweep then adds both files and the empty seed to every game — the tags
  in each game's `index.html` stay a helper's job, as the preamble says.
- Two traps, both already documented for their neighbours: moments arriving
  from the preview are painted in place, never through `render()` (the
  problems panel's reason, CLAUDE.md); and the server's `parseConfigFile`
  import is from `public/config-file.js`, the first of its kind — say so in
  a comment where it happens and in spec/ §16.
- Every button and file name the preamble gains is asserted in
  `orchestrator.test.js`, like the two editors before it.
- Docs are part of the build, not after it: spec/ §3 §4 §6 §8 §10 §12,
  GLOSSARY.md (*moment*, *moments library*, *achievement*, *achievements
  editor*, *achievements library*; widen *reporter*), CLAUDE.md's current
  state, and the TODO.md line deleted in the same commit as the last step.

## Still open

- Counts across sessions ("win ten times"): the server would have to keep a
  counter per (game, player, moment), which is the moments stream leaving
  the client. Not now; the case for it is real.
- Should the toast play a sound when the game holds one under a fixed name
  (`assets/sounds/achievement.wav`), the way the reserved images work?
- The catalog card: a trophy count in cyan (the studio speaking; never gold,
  which stays a score) once somebody asks for it.
- Trophies on the title screen: screens v6 grew `Screens.board()` and the
  `/_me` dance, which is where a trophy list would sit as a later snippet.
