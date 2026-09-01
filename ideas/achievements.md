# Achievements

(Dann, 2026-09-01.) A game can hold achievements; any signed-in player who
plays it can earn them; earned is forever, per player. Defining one should
need no code. Wiring the moment it is earned usually does, and that is a
helper's job — possibly a helper made for it.

## What the studio already has that this rides on

- **The scoreboard shape.** Rows in SQLite, never the working tree, because a
  tree write is a commit (spec.md §3). The games origin's write rules — the
  `player` cookie, a per-player rate limit, every field capped, a plain 404
  for anything that is not a game's — are settled and tested. An earned
  achievement is the same kind of thing as a personal best: one row per
  (game, person, thing), raised never lowered, `INSERT OR IGNORE`.
- **`config/` and its editors.** A plain-value file the studio reads without
  running it, and for a file in a known shape, an editor over the whole
  thing (`quiz-editor.js`, `story-editor.js`). Definitions belong here, not
  in a table: versioned, forked with the game, in front of every helper in
  the ambient block, and editable by a kid as a form.
- **The studio library.** A fifth library, `studio/achievements.js`, with the
  seed `config/achievements.js` the way input seeds `config/controls.js`. Its
  API note teaches every helper the calls with no orchestrator edit; the
  sweep gives every existing game the file and the empty seed.
- **A helper is a row.** Its `description` is its system prompt, layered
  under the studio preamble. A specialised achievements helper is data, not
  code — a description somebody pastes into `New helper`.

## The shape

### `config/achievements.js` — the definitions

```js
// What a player can earn in this game. Whoever earns one keeps it forever.
// The studio opens this file as the achievements editor, so keep the shape:
// id, name, how, and an optional icon and score.
const ACHIEVEMENTS = [
  {
    id: "first-flight",           // never changes: the players who have it are keyed by it
    name: "First flight",         // what it is called
    how: "Finish your first run", // how a player gets it, in their words
    icon: "🚀",                    // optional
  },
  {
    id: "high-flyer",
    name: "High flyer",
    how: "Score 1,000 in one run",
    icon: "⭐",
    score: 1000, // the studio gives this one out itself when a score this big is posted
  },
];
```

The id is slug-shaped (`[a-z0-9-]`, ≤ 40) and immutable, like a project's
slug: earned rows key on it, so renaming one orphans everybody's. The editor
derives it from the name once and never lets it be edited. `name` ≤ 60,
`how` ≤ 200, `icon` ≤ 32 bytes (the reaction cap), `score` a safe integer,
at most 50 entries. An entry outside the caps is skipped by the server and
flagged by the editor.

Two kinds, one field apart:

- **Game-given.** The game calls `Achievements.unlock("first-flight")` at the
  moment it happens. A helper wires that, told what by `how`.
- **Score-given** (`score: N`). The studio awards it itself when a signed-in
  score post reaches N — inside the `POST /_scores` handler, after
  `submitScore`. No code in the game at all. The score answer grows an
  `unlocked` list of the ids it just earned, so the game's own post code can
  hand them to `Achievements.show(unlocked)` for the pop-up. A game may also
  `unlock()` a score-given id directly; the server does not refuse it —
  the score is forgeable anyway, and one rule is simpler than two.

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

Permanent means permanent: no route deletes a row, no button, no per-row ✕
like the scoreboard has. Removing a definition from the file leaves the rows;
they are simply shown nowhere until the id comes back. `deluser --scores`
(TODO.md) should take these with it when it is built.

### Games origin — the third write

| method | path | effect |
|---|---|---|
| GET | `/_achievements/:slug` | `{achievements: [{id, name, how, icon, got}]}` in file order; `got` is the signed-in player's, false throughout when nobody is |
| POST | `/_achievements/:slug` | `{id}` → 401 signed out, 404 no such id in the file, else 201 `{new: true\|false}`; 20 a minute per player, body 1 KB |

The server reads `config/achievements.js` from the working tree per request
and parses it with `parseConfigFile` — the same reader the client uses, pure,
no eval, imported by tests from `public/` already. The first server import
from `public/`; a small file, on rate-limited routes. Chats and archived
games behave as they do for scores: a chat is a 404, an archived game keeps
taking unlocks.

### `studio/achievements.js` — the library

```js
Achievements.unlock("first-flight"); // posts it, once per page, and pops it up
Achievements.show(["high-flyer"]);   // pops up ones the score post just earned
Achievements.mine();                 // Promise of the GET above, for a trophy screen
```

DOM like Screens: a small toast at the top under the chips, icon, name and
`how`, in the look's highlight, gone after a few seconds, stable
`achievements-` classes. Signed out, the toast still shows with a line
saying to sign in on the front page to keep it, and nothing is stored. A
missing file, an unknown id or a dead network is one `console.warn`, never
an error. `unlock` remembers what it has sent this page, so a call every
frame costs one request.

### Studio side

- **The achievements editor**: `config/achievements.js` in shape opens as a
  list, one open in its own row — Name, How to get it, Icon, Given out at a
  score of — plus `+ Add an achievement` and a Remove that confirms. Shape
  lock like the other two: an unknown key drops to the config form with a
  reason. The structural read the others do: how many players hold each one
  (`GET /api/projects/:slug/achievements`, studio origin, counts by id), and
  a caps warning per row.
- **Preamble**: `config/achievements.js` joins the config batch list; the
  shape-locked paragraph says three editors, not two, and
  `orchestrator.test.js` asserts the name; the scoreboard paragraph gains
  one clause about `unlocked`. The API note carries the rest.
- **Not in this build**: who-has-what per player in the rail, a trophy count
  on the catalog card, the trophies on `Screens.title()`, an
  `achievements_on` switch (an empty file is the switch). Each a TODO line
  if wanted.

## The achievements helper

A row, made in `New helper`, file tools on, thinking `low`. The description:

> You design and wire achievements for the game you are in, and nothing
> else unless asked. Read the game before you say anything: SPEC.md, the
> config files, and the code where the game keeps score, ends a run or
> changes level. Propose four to six achievements that fit this game: one
> nearly everybody earns on their first play, two or three for playing well
> or playing differently, one that is hard. Each has a name of two or three
> words, a `how` line a ten-year-old can read that says exactly what to do,
> an icon, and an id that will never change. Where a score threshold is the
> natural test, set `score:` and let the studio hand it out; for everything
> else put `Achievements.unlock("id")` on the exact line where the thing
> happens, guarded so it fires once per run. Write the definitions into
> config/achievements.js and keep its shape exactly — id, name, how, icon,
> score — because the studio opens that file as the achievements editor.
> Never rename an id: the players who hold it are keyed by it. Make sure
> index.html loads config/achievements.js and studio/achievements.js before
> the game's own scripts. Say what you added as one short list, then stop.

The general helper knows the mechanics from the API note; what this one adds
is taste — the spread, the wording, the restraint. Worth one live run against
a real game before deciding whether it earns a place.

## Open

- `how` as the field name, or `hint`, or `getBy`?
- Should the pop-up play a sound when the game holds one under a fixed name
  (`assets/sounds/achievement.wav`), the way the reserved images work?
- The catalog card: a trophy count in cyan (the studio speaking; never gold,
  which stays a score) once somebody asks for it.
