## 10. Limits

**Two token walls.** The studio-wide daily budget is the outer one and stops a
runaway loop draining the API key, whoever set it off; a person's
`daily_tokens` is the inner one, so one person cannot spend everybody's day.
Both are set in the admin panel; the studio-wide one falls back to the built-in
5,000,000 when nothing has been set.

Within a tenth of your allowance, the line under the newest reply says so —
in the same grey line that already says what that reply cost, and in gold,
which is what a number worth looking at is coloured everywhere else. It is
drawn from `/api/me` alone, re-read after a reply that could have moved it, so
it is your own day and never anybody else's: no message carries an allowance,
and a thread cannot leak one.

A reply is billed to **whoever asked for it**: the newest human message in that
chat when the fire started. An agent has no owner to bill, and the person whose
turn it is is the one who wanted the answer — a continuation goes on the same
person's day, because it is the rest of their answer. Out of allowance, their
helpers answer with a `[studio]` note naming them and the studio carries on for
everybody else.

- Message body: 32 KB (utf-8 bytes).
- Reaction emoji: 32 bytes (utf-8), no codepoint validation — a ZWJ sequence
  and a `:shortcode:` string are both accepted, equality is bytewise. The
  client offers a fixed set of twenty and renders with `textContent`, so a
  forged string is inert and no worse than a message body.
- JSON request body: 64 KB. Raw file `PUT` body: 10 MB.
- Email: 254 chars. Display name: 100. Project name: 200. Slug: 40.
- Agent name: 100. Agent description: 8 KB.
- Project path: 200 chars, 8 segments.
- Files per project: 500. Bytes per project: 200 MB.
- Chats per game: 20. Agents attached per chat: 10 — a helper belongs to a
  chat, not to a game, so both caps are per conversation.
- Runtime errors: 20 per project, 20 per report, 500 chars of message and 200
  of location each; 20 distinct problems per page load in the reporter itself.
- Agent cooldown: 5 s per `(chat, agent)` — it lives on `chat_agents`.
- Agent fire: ≤ 24 assistant turns, ≤ 40 tool calls, ≤ 512 KB of messages
  appended by the tool loop, ≤ 3 continuations per human message (§8).
- Context sent per fire: ~700 KB of text before the tool loop and ~1.2 MB with
  it, all of it bounded (§8), against a 1,048,576-token model ceiling.
- Brief injected into the system prompt: 32 KB, cut with a note (§8).
- Output per request: `max_tokens = 65536`, which is the model ceiling — a
  lower cap rations the reasoning trace, not the files (§8, §14).
- Studio token budget: `DAILY_TOKEN_BUDGET`, default 5,000,000 per UTC day.
- Login lockout: per email 10 failures / 5 min → 5 min lock; per IP 20
  failures / 5 min → 10 min lock. In-memory, resets on restart. The games
  origin's `/_login` carries its own pair with the same numbers.
- Wherever an address is a key, an IPv6 address counts as its /64 (§6).
- Scoreboard: score a JS-safe integer, the name the account's squeezed to
  24 chars, best 100 rows kept per game, `?limit=` ≤ 100, body 1 KB; posts
  10 / min / player, in-memory like the lockouts; a post a full board
  already outranks is never written.
- Achievements: `config/achievements.js` read only up to 64 KB; per entry
  id ≤ 40 (slug), name ≤ 60, `how` ≤ 200, icon ≤ 32 bytes (the reaction cap),
  ≤ 50 entries; an entry outside the shape is skipped, not refused. Unlocks
  20 / min / player, body 1 KB, in-memory like the scoreboard's.
- The story's two small asks (§6): sentence and `about` ≤ 500 chars, a cast
  member's `about` ≤ 200 and their name ≤ 100, ≤ 20 of them, the last ≤ 40
  lines of the scene at ≤ 500 chars each, ≤ 4 colours each matching a plain
  colour pattern. Back: ≤ 12 lines at ≤ 500 chars, or ≤ 20 KB of SVG.
  `max_tokens` 1024 for a fill and 2048 for a picture. Everything sent is cut
  to its cap rather than refused; everything back past one is dropped. **No
  rate limit of their own** — the two token walls are the walls, and the
  button goes quiet while an ask is out.
- Studio collection: a picture ≤ 2 MB, PNG only; name ≤ 60, `who`/`mood`
  ≤ 40 each and dropped unless they tidy to an identifier; 100 per person and
  500 in all. The shelf is one sideways row, so it runs out of room long
  before those do (§6).
- Sign-up: 5 / 10 min / IP; name ≤ 100 chars and control-free, password
  6–200 chars, email ≤ 254; body 1 KB, as is `/_login`'s.
- Player sessions: 90 days, cookie `Max-Age` and row age both.
