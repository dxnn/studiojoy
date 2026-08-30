# Next five

Five asks, sorted by what each one forces rather than what it costs.

Four are built. The **input module** (controllers, touch and couch
multiplayer), the **sound editor**, and the **pixel editor** forced nothing:
the pane already opened a file as something other than text, and `PUT`
already took raw bytes and committed one file per request, so each was a
branch in the pane and a `PUT` at the end of it. See spec.md §6 and the
glossary.

**Scoreboards** was the cheap pilot for the games origin holding state, and
it did what it was for: the first write route on that origin now exists, with
the rules a public write needs — reads no cookie, has its own rate limit,
caps on name length, score range and rows per game. `POST /_scores/:slug`,
rows in the SQLite that was already open, spec.md §6. What it settled is what
the relay inherits.

⚠️ Still the true thing about it: scores are forged by anyone who opens
devtools, because the client is the only witness. For a family studio that is
fine. Pretending otherwise means signing scores, which means a secret in
LLM-written game code, which means no secret.

---

## networked multiplayer

Couch multiplayer is done — one device, two pads or a split keyboard, no
server, no state. It came with the input module and is probably most of what
was wanted.

Networked is a room relay on the games origin: SSE down, `POST` up, rooms keyed
by slug plus a short code, no persistence, no auth. `broker.js` is 46 lines and
already does exactly this fan-out keyed by tab; keyed by room it is maybe 70,
plus about 130 for rooms and caps.

Turn-based works well on that. Real-time action wants WebSocket, and Node ships
a *client* `WebSocket`, not a server — zero-dep means hand-rolling RFC 6455
framing, ~250 lines of the kind of code that is fine until it isn't.

The hard part is not the transport. The games are LLM-written, so a game that
opens a room per frame is a normal Tuesday rather than an attack. Every cap has
to be real: rooms per slug, members per room, bytes per message, messages per
second, and a sweeper for rooms nobody left.

## persistent worlds

Three tiers, and the first is already free:

1. **Per player, per device** — works today. `localStorage` on the games
   origin was deliberately preserved (spec.md §7 chose separate origins over
   `CSP: sandbox` partly for it), so a single-player game saves without any
   server. Worth a preamble line some day: a capability an agent is not told
   about may as well not exist.
2. **Per game, shared** — a bounded key-value document per slug: same SQLite,
   same caps-and-rate-limit rules. The scoreboard generalised from
   append-only to read-write.
3. **Shared and live** — a world several players mutate at once: tier 2's
   storage plus the relay's concurrency. Only makes sense after both exist.

⚠️ The risk tier 2 adds that scoreboards don't have: a forged score is funny;
a stranger wiping a world kids built is not. With no player accounts — by
design — the mitigation is shape, not auth: append-only or bounded structures
rather than arbitrary blobs, and the database backup as the recovery story.
That tradeoff needs its own decision before anyone builds it.

---

Order: the turn-based relay next — the boundary rules it needed are settled
and tested. WebSocket only if a real game demands it. Worlds after the relay,
tier by tier.
