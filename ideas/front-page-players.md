# The front page knows who you are: your scores, your achievements, everybody's

(Dann, 2026-09-01: "Show my achievements and scores on the front page. Let me
see other people's achievements and scores too.")

The catalog (`/` on the games origin, `server/catalog.js`) is the studio's
front door and today says one number per game: the board's best score, in
gold. Signed in, it knows who you are — the `player` cookie — and says nothing
with it beyond your name and a Sign out. Meanwhile three tables already hold
what a player would want to see: `scores` (the top 100 runs per game),
`personal_bests` (one row per person per game, displayed nowhere — a TODO
line since the sign-in build) and `achievements` (earned rows, per person per
game, shown only as a toast the moment they land). Nothing here needs a new
table or a new write. It is all reads.

## What "front page" has to mean

The games origin, not the studio. A player account never sees the studio, and
a kid checking whether they still hold the record does it where they play.
Everything below is server-rendered HTML in the catalog's own dress, the way
the catalog is — no framework, no fetch on load, one self-contained page —
and every name and slug goes through `escapeHtml` because the public reads it.

Two rungs, then a third that may never be wanted.

## Rung 1 — mine, on the cards

Signed in, each card grows two lines under the game's name:

- **your best 1,234** — `personal_bests` for (this game, me). Gold: it is a
  score. Absent when I have none.
- **★ 3 of 7** — earned `achievements` rows for (this game, me) over the
  count of definitions in the game's `config/achievements.js`
  (`definedAchievements(dir)` in `server/achievements.js`, already async and
  already the thing `/_achievements/:slug` reads). Absent when the game
  defines none. Not gold — a count is a number but not a score, the same rule
  `Screens.rows()` follows.

The catalog route becomes async (one file read per published game that has an
achievements file; a handful of games, a handful of reads, and `Cache-Control:
no-store` already says this page is built per request). Two extra queries
keyed on `user_id` and `project_id`, both indexed by their primary keys.

Signed out, the cards are as they are, and the note under the list already
says why to sign in. One more sentence there: *and see how you are doing.*

## Rung 2 — everybody's, one page per game

A card's top score is a number; the question behind "other people's" is *who*.
A page per game at **`/:slug/_players`** — an underscore path, reserved like
`_studio.html`, so no game file can shadow it and no slug can collide with it
(§6). Server-rendered, same dress, wordmark linking back to `/`:

1. **The board** — the top 100 as `/_scores/:slug?limit=100` already answers
   it, numbered, the signed-in player's own rows marked. 404 when the game's
   `scores_on` is off, like both `_scores` routes.
2. **Personal bests** — every player's best on this game, best first, from
   `personal_bests` joined to `users` for the name (`deleted = 0`, either kind
   of account: a player account is exactly who this page is for). This is the
   view the TODO line "show personal bests beside the Top 100" wanted, and a
   best that fell off the board is still here.
3. **Achievements** — the game's definitions in file order, each with its
   icon, name, `how`, and who has earned it: the names, or *nobody yet*. From
   `achievementCounts`'s query with the names joined in rather than counted.

The card on `/` links to it — the whole card still opens the game (that is
what a card does); a small **players** link at the card's foot goes here. What
lights up is what can be clicked, so the link is its own control, not a hover
reveal.

Headers: the page holds no form, so `frame-ancestors 'none'` and COOP are not
load-bearing here the way they are on `/` (§7) — but it costs nothing to send
them and keeps the two studio-authored pages in one posture. No cookie is
*required* to read it; the `player` cookie only marks your rows.

Caps: `personal_bests` is one row per person per game and the studio is a
handful of people; the achievements join is players × definitions, ≤ 50
definitions. Nothing here needs a limit, but the page states `LIMIT 500` on
the bests and names, because a public page with no ceiling is a habit worth
not starting.

## Rung 3 — a person's page (probably never)

`/_players/<id>`: one person across every game — their bests, their trophies.
Worth it only if rung 2 turns out to be what people open first and then ask
"and what else has she got?". Names are already public on boards; ids are
not, and a page per person is a page per child on a public origin. Parked
with that sentence attached.

## What it does not do

- No writes, no new tables, no new cookie. Everything is a read of rows the
  three existing write routes already make.
- No deletion or moderation from here — that stays in the studio's rail
  (Scoreboard tab) where an editor moderates their own game.
- Never the studio origin: the studio's own "my achievements" is the
  achievements editor's per-rule player count, which is a different question
  (how is my *game* doing) answered on the right side of the boundary.

## Tests

`test/players.test.js` already renders the catalog for a signed-in player and
asserts the top score on a card. Rung 1 adds: a best shows only for the
signed-in player, only on their own card; an achievement count shows only for
a game with definitions; nothing leaks between two players. Rung 2 adds a
`_players` page test in the same file: 404 for a chat and for a board that is
off, names escaped, the player's own row marked, a definition nobody has
earned says so.

## Order

Rung 1 first — it is where the asking started and it is an afternoon. Rung 2
next; it also retires the TODO line about personal bests. Rung 3 waits for a
reason.
