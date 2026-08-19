# Next five

Five asks, sorted by what each one forces rather than what it costs.

Three of them forced nothing and are built: the **input module** (controllers,
touch and couch multiplayer), the **sound maker**, and the **pixel editor**.
The pane already opened a file as something other than text, and `PUT` already
took raw bytes and committed one file per request, so each was a branch in the
pane and a `PUT` at the end of it. See spec.md §6 and the glossary.

The two left both need the games origin to remember something between
requests. It serves files, reads no cookie, and answers 405 to anything that is
not GET or HEAD (spec.md §6, §7). A score or a room is the first byte of state
out there and the first write route. That is the fork.

---

## scoreboards — the cheap pilot for the same decision

`POST /_scores/:slug` with `{name, score}`, `GET /_scores/:slug` for the top N,
rows in the SQLite that is already open. ~120 lines plus tests.

What it settles is worth more than what it does. It is the first write route on
the games origin, so it forces the rules multiplayer needs anyway: reads no
cookie, has its own rate limit (there is none outside login today), caps on
name length, score range and rows per slug.

⚠️ Say the true thing about it: scores are forged by anyone who opens devtools,
because the client is the only witness. For a family studio that is fine.
Pretending otherwise means signing scores, which means a secret in LLM-written
game code, which means no secret.

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

---

Order: scoreboards first, because it pays for the boundary rules the relay
needs. Then the turn-based relay. WebSocket only if a real game demands it.
