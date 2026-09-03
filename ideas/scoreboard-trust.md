# Scoreboard trust: from forgeable to witnessed

(Dann, 2026-08-31; brought up to date 2026-09-01, the day rungs 0 and 1
landed.) v0 accepted "forgeable by design": the client is the only witness,
and signing scores would need a secret inside LLM-written game code, which is
no secret (spec/ §3, ideas/next-five.md). Dann did not accept that as the
last word — weaken the constraints, with player accounts and maybe a small
payment, and for at least some games the board could be *true* rather than
merely bounded. This was the ladder from here to there.

## Where it landed

Rungs 0 and 1 are built, and this is as far as the ladder goes for now. What
they buy is accountability: every score on every board is a signed-in
account's, attributable, deletable per row, and the person behind it can be
taken out of the studio. Truth — rungs 2 to 4 — is not needed for a studio
whose players are a hand-approved list of family and friends, and each rung
above 1 is a real build for a problem nobody has had. They stay below as the
reasoning, not as a plan.

## The fact that survived the weakening

**Accounts buy accountability, not truth.** The game runs on the client, so
the client computes the score; an authenticated player still opens devtools
and posts `score: 999999`. Identity makes a forged score *attributable and
revocable*. Truth would need the server to witness it — by holding the logic,
or by re-checking a claim. Rungs 0–1 are accountability; rung 3 was truth.

## Rung 0 — hardening ✔

Built 2026-09-01: `server/util/text.js`, `clientIp`, `submitScore`.

- ⚠️ Names refuse the path validator's whole class — C0 and DEL, and the
  Unicode format characters: bidi overrides, zero-width spaces and joiners,
  soft hyphen, BOM — at every door that sets one (sign-up, `createUser`, the
  admin rename), and the board strips them from names stored before the doors
  did. One check, shared with paths, for the same spoofing reason.
- ! IPv6 is bucketed by its /64 wherever an address is a key: the login
  lockouts on both origins and the sign-up limiter. One change in `clientIp`
  closes the bypass and the map growth together; IPv4 stays whole, the
  `::ffff:` mapped form included.
- A post a full board already outranks is answered `rank: null` and never
  written; the personal best is still raised first.

## Rung 1 — player accounts ✔

Built 2026-09-01, the sign-in build (spec/ §3, §6, §7, §11). Three of the
four bullets landed in a different shape than sketched, and the shape is
better:

- **Players are the same table, not a new one.** A player is a `users` row
  with `studio_access = 0`, made by an admin approving a `signups` row. The
  blast-radius argument is carried by the bit: every studio door minds it.
- **The credential is an HttpOnly `player` cookie**, backed by
  `player_sessions`, ninety days, worth nothing on the studio origin — not a
  bearer token in `localStorage`. Stronger than sketched, because game code
  cannot read it at all. ⚠️ But *not scoped to a slug*, and the sketch's
  scoped token would not have been either: every game shares the origin, so
  game A can `POST /_scores/game-b` with the cookie attached, or could just as
  well have asked for a slug-B token itself. A rogue game can put its player
  on another game's board; the row then names the player, not the game's
  author. Accepted (spec/ §7) — the only real scoping is an origin per
  game, a deployment change, and moderation covers the rest.
- **Rate limits are per account** for score posts — every post has one
  behind it, and a household shares an address, so siblings on one wifi were
  sharing one ration of ten. The address limiter stays on sign-up and login,
  whose callers have no account yet, with the /64 fix.
- **Moderation follows the deluser pattern.** Per-row and per-board deletion
  in the rail's Scoreboard tab; `npm run deluser` takes the person out. Not
  yet: a removed player's rows stay on every board. `deluser --scores` is a
  TODO.md line.

## Rung 2 — plausibility, per session — not planned

A start handshake, an elapsed-time minimum and per-game declared bounds. The
bounds half is cheap — a `config/` value the server reads at HEAD, no
handshake, games without the file untouched — and would catch the devtools
paste. The time half needs a mint route, a token in every post, a change to
every game and a preamble lesson, and a script defeats it. Neither proves a
score. Hold both until a forged score actually turns up; the bounds half is
the one to reach for then.

## Rung 3 — server-witnessed scores — not planned

The "for at least some games we can do better". Feasible, and the reasoning
is worth keeping:

**3a. Template grading.** The server holds `config/questions.js` and the quiz
editor already parses that shape without executing it, so the quiz could be
served one question at a time and graded on the server. But it turns a
template that needs no helper into a game that talks to the server per
question, with play sessions and a verified-board surface — a real build for
a board nobody has doubted.

**3b. Replay verification.** Inputs plus an RNG seed recorded by the input
module, re-simulated on the server against the exact commit the wrapper
stamped. Needs a subprocess sandbox — Node's permission model, read-only on
one game tree, no network, a hard timeout and a memory cap; `node:vm` is not a
boundary — and games that are deterministic by construction. Achievements
would fall out of the same machinery. The flagship that was never needed.

The badge, if either is ever built: cyan, the studio speaking — never gold,
which stays a number.

## Rung 4 — payment — not planned

What payment buys is sybil cost. What it costs is a payment processor, refunds
and tax, and parents paying with COPPA-shaped weight attached. The cheaper
path to the same scarcity — **vouched accounts** — is exactly what shipped:
the waiting list, and an admin's `Let them in`. Payment earns its keep only if
boards go internet-public, which is not the plan.

## What the spec settled

- §3's tiering question — anonymous / players-only / verified — is answered
  by the one tier that exists: players only. There is no anonymous post; the
  route answers 401 without a player.
- §6/§12's games-listener invariant names the player cookie: still never the
  `session` cookie; `player` is the one credential that origin knows.
- Rate limits: per player for scores, per address (bucketed) for sign-up and
  login.
- The origin's writes are still two: the scoreboard and the waiting list.

## Answered

- Players sign in on the catalog, the games origin's front door; a sign-up is
  vouched — the waiting list, approved by an admin.
- One identity across all games: a `users` row, so a name is one name.
- The anonymous tier did not survive.

Still open, if rung 3 is ever wanted: the replay trace format and its caps,
and what to do when a game claims determinism and replays differently.
