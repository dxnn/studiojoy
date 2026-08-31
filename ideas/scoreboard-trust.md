# Scoreboard trust: from forgeable to witnessed

(Dann, 2026-08-31.) v0 accepted "forgeable by design": the client is the only
witness, and signing scores would need a secret inside LLM-written game code,
which is no secret (spec.md §3, ideas/next-five.md). Dann does not accept that
as the last word — weaken the constraints, with player accounts and maybe a
small payment, and for at least some games the board can be *true* rather than
merely bounded. This is the ladder from here to there. Rungs stack; each is
useful without the ones above it.

## The fact that survives the weakening

**Accounts and payment buy accountability, not truth.** The game runs on the
client, so the client computes the score; an authenticated, paying player
still opens devtools and posts `score: 999999`. Identity makes a forged score
*attributable and revocable*. Payment makes identities *costly*. Neither makes
a score true. Truth requires the server to witness it — by holding the logic,
or by re-checking a claim. Rungs 1–2 are accountability; rung 3 is truth.

## Rung 0 — hardening that stands regardless

Two gaps in the current route, worth closing whatever happens above:

- ⚠️ `hasControlChars` in `server/scores.js` stops at C0 + DEL. Names should
  also refuse Unicode format characters — bidi overrides, zero-width
  spaces/joiners, soft hyphen, BOM — the same class the path validator bans
  for the same spoofing reason (spec.md §4). A name is rendered UI shown to
  kids; a bidi override makes it render as something other than what it is.
- ! "Per IP" is per-client on IPv4 and per-2⁶⁴-addresses on IPv6: every
  residential IPv6 client holds at least a /64, so the limiter is trivially
  rotated around, and each fresh address is a fresh map entry. Bucket IPv6 by
  its /64 prefix — one change fixes the bypass and the map growth together.

Minor, same spirit: skip the INSERT when a full board already outranks the
post (a flood of losing scores currently costs a row write and a prune each).

## Rung 1 — player accounts

The biggest single win: anonymous grief becomes named, deletable, bannable
behaviour. For a family-and-friends audience this is most of the value of
"not forgeable".

- **Players are a new account class, not studio accounts.** Studio accounts
  can change games; players only post scores (and later, hold achievements).
  Different blast radius, different table.
- **The credential is never the studio cookie.** The games-listener invariant
  — never reads a cookie — exists so the studio session is unusable by game
  code (spec.md §7, §12). A bearer token in the games origin's `localStorage`
  (deliberately preserved by the separate-origins decision) keeps both the
  letter and the spirit. But game code is LLM-written and untrusted, and any
  game on that origin can read that storage — so tokens are **minted scoped
  to one slug**: a token exfiltrated by game A only ever posts to game A's
  board.
- **Rate limits move to per-account** for player posts — strictly better than
  per-IP. The IP limiter stays for whatever anonymous tier survives.
- **Moderation follows the deluser pattern.** Removing or banning a player is
  rare, is about a person, and is a terminal script paired with its undo —
  never a button in the panel (the same asymmetry as `npm run deluser` /
  `restoreuser`: create and edit in the UI, destroy in the terminal). A ban
  soft-deletes the player and can sweep their rows.

## Rung 2 — plausibility, per session

Cheap, universal, works with or without accounts. A handshake when the game
starts hands back a stamped token; the score post carries it; the server
checks elapsed time against a minimum and the score against per-game declared
bounds — a `config/` file the server reads at HEAD and caches (it holds the
tree; the read is free). Raises forgery from a one-line devtools paste to
deliberate scripting. It never proves a score and must not claim to.

## Rung 3 — server-witnessed scores, opt-in per game

The "for at least some games we can do better". Two shapes:

### 3a. Template grading

The quiz already has a server-known shape. Move the answers server-side,
serve questions one at a time, grade on the server — the score is then
computed by the server, full stop. Point-and-click can work the same way. The
server knows the truth because it holds the content. The cheapest true
verification in the building, and it proves the "verified board" surface
(badge, per-board setting, moderation view) before the harder shape needs it.

### 3b. Replay verification

The game records inputs plus an RNG seed; the score post includes the trace;
the server re-simulates and computes the score itself. The studio is
unusually well placed:

- The **input module** is already the single tap point for every input —
  recording is one library change, not a per-game ask.
- The **wrapper** already stamps the running commit, so a replay runs against
  the exact bytes the player played — the same pattern as the reporter
  dropping reports whose version is no longer HEAD.
- **Templates can be deterministic by construction**: fixed timestep, a
  seeded `Rand` the library provides, logic separated from rendering — the
  direction the orchestrator already pushes.

The hard part is running LLM-written JS on the server. It needs a subprocess
sandbox: Node ≥ 24's permission model for the filesystem (read-only, the one
game tree), no network, a hard timeout and a memory cap. `node:vm` is not a
security boundary and does not qualify. Cost is fine: a 3-minute game at
60 Hz is ~11k ticks replayed flat out — sub-second.

Games that adopt the deterministic shape get a **verified board**; everyone
else stays at rungs 1–2. **Achievements fall out of the same machinery**: an
achievement is an event the server observes during replay, witnessed the same
way — below rung 3 an achievement is just another client claim.

## Rung 4 — payment (deferred)

What payment buys is sybil cost: a ban that destroys something paid for is a
ban that bites. What it costs is everything non-engineering: a payment
processor (an API dependency even without an SDK, against a zero-dep studio),
refunds and tax, and — the players being kids — it is really parents paying,
with COPPA-shaped privacy weight attached.

The cheaper path to the same scarcity, at this studio's scale: **vouched
accounts** — an admin or a parent creates player accounts, which is exactly
the hand-controlled account list that is already the studio's trust boundary,
extended one class down. Payment earns its keep only if boards go
internet-public. Hold it until that is the actual plan.

## What the spec renegotiates

- §3's "forgeable — accepted cost" becomes a tiering: per board (alongside
  `scores_on`), **anonymous / players-only / verified**. Whether the
  anonymous tier survives at all once players exist is an open question.
- §6/§12's games-listener invariant is amended to name the player token
  explicitly: still no cookie read, ever; a scoped bearer token is the one
  credential that origin knows.
- The rate-limit story splits: per-account for players, the per-IP limiter
  (rung 0 fixes included) for anonymous posts.
- The games origin grows write routes beyond the one (handshake, replay
  post) — each with the same posture: every dimension capped, no cookie,
  bounded tables.

## Open questions

- Where do players sign in? A small page on the games origin, or the studio
  origin minting tokens — and what a player signup even is (vouched only?).
- One player identity across all games, or per-game? (Tokens are scoped per
  slug either way; this is about the table, the name, and achievements.)
- Replay trace format and size caps; and what the server does when a game
  claims determinism but replays differently — refuse the score, or file it
  like a runtime error so a helper can see the game is non-deterministic?
- The verified badge's colour: it is the studio speaking, so cyan — never
  gold, which stays a number.
- Does an anonymous tier survive at all, or do boards become players-only
  once accounts exist?

## Order

Rung 0 near-term (small, matches existing house rules). Rungs 1+2 together
as the base for every board. 3a for the quiz soon after — cheapest truth,
proves the surface. 3b as the flagship for one or two deterministic games.
Rung 4 deferred until "public" is real.
