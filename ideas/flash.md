# DeepSeek V4.1 Flash

DeepSeek shipped V4.1 Flash on 2026-09-10. Measured here on 2026-09-12
against the live API (`tmp/probe-v41.mjs`, `tmp/probe-v41-cache.mjs`,
`tmp/probe-v41-where.mjs`), because spec/ §14 is measured and every number
in it was taken on a model that no longer exists.

## What actually changed

**The model list is two again, and one of them is new.** `GET /v1/models`
returns exactly `deepseek-flash` and `deepseek-v4-pro`. `deepseek-v4-flash`
is gone from the list but still answers — the changelog calls it "temporarily
routed to V4.1 Flash", and the probe confirms it: the alias and the canonical
name return the same answer for the same prompt at the same token count. So
**the studio has been running V4.1 since 2026-09-10 without anybody changing
a line**, and it will keep doing so until DeepSeek drops the alias, which
they have not dated.

That is the whole urgency of stage 1. Nothing is broken; everything §14 says
about Flash is now a claim about a retired model, and the one thing §14 says
most confidently — *images are not supported* — is now false.

**Prices fell, and the two models no longer share a shape.** Per million
tokens, peak (off-peak is exactly half, in every column, as before):

| model | miss | hit | output | hit : miss | output : miss |
| --- | --- | --- | --- | --- | --- |
| `deepseek-v4-flash` (was, §14, 2026-09-06) | $0.44 | $0.014 | $1.32 | 1 : 31 | 3 : 1 |
| **`deepseek-flash`** | **$0.30** | **$0.006** | **$1.20** | **1 : 50** | **4 : 1** |
| `deepseek-v4-pro` | $1.32 | $0.044 | $3.96 | 1 : 30 | 3 : 1 |

⚠️ `tokensCharged` (`server/llm/deepseek.js`) weighs a hit at a thirtieth and
output at three **for both models**, which was right when both models had the
same ratios and is now right for Pro only. On Flash a cached token is half
what we charge it and an output token is three quarters — so the budget now
undercharges a Flash fire, and output is what dominates a fire.

Priced end to end on §14's own arm-B receipt (397 K hit, 20.2 K miss, 14.0 K
output, three pieces): **3.29¢ → 2.52¢** at peak, half that off-peak. A 23%
cut, mostly from the cache.

⚠️ And the gap between the models widened: Pro is now **4.4×** Flash on a
missed token and 3.3× on an output token, where it was 3× flat. The budget
counts tokens, not money, so a Pro fire still drains an allowance at the same
rate a Flash fire does. That was a 3× lie; it is a 4.4× lie now.

**Vision works, on Flash, and it is cheap.** `{type: 'image_url',
image_url: {url: 'data:image/png;base64,…'}}` is accepted — the exact shape
§14 recorded a 400 for. A 3.1 KB pixel-art background cost **~195 prompt
tokens**; a portrait the same; the documented ceiling is 1,024 tokens per
picture. At the new miss price a picture is $0.00006. A game's whole sprite
folder is small change, and it caches (below).

⚠️ **`deepseek-v4-pro` does not reject an image. It drops it and answers
anyway.** Same request, same picture: Flash reported 209 prompt tokens and
said "Green and brown" of a green-and-brown forest; Pro reported 22 prompt
tokens and said "White and blue." No error, no warning, a confident wrong
answer. This is the landmine in the whole feature and it decides the design:
whatever shows a helper a picture must be **absent** on a Pro agent, not
degraded.

**Where a picture may sit is decided for us.**

| placement | result |
| --- | --- |
| `system` message | 400 `Image in system message is unsupported` |
| `assistant` message | 400 `Image in assistant message is not supported` |
| `user` message | works |
| **`tool` result** | **works** — 268 prompt tokens, answered correctly |
| several in one message, each labelled by a text part before it | works, and it reads the labels back as names |

⚠️ The system-message refusal collides with spec/ §12's invariant that the
ambient file block lives in the system prompt. The block cannot carry
pictures where it lives. The tool result can — which is the design below, and
it keeps the invariant rather than bending it.

**A picture does not break the prefix cache.** Two findings, one run each on
a 9.5 K-token system prompt:

- The same picture sent twice hit **99%**. Image tokens ride the cache like
  any others.
- ⚠️ A picture on the **last** user message did **not** cost the ~6,000-token
  prefix that a ≥160-token text message costs (§14). The request extending it
  hit **98%**, against 98% for a short-message control — not the 48–50%
  signature of the loss. A ~195-token picture behaves like a short message.
  One run; worth a second before anything leans on it.

**Reasoning has a ladder now, or at least a gradient.** On `deepseek-flash`,
`Reply with the single word: ok`: `none` → no `reasoning_tokens` field at
all, `low` → 10, `max` → 43. `max` is accepted (the 2026-08-13 Pro entry
named low/high/max). That is a trivial prompt, which is exactly the case §14
warns produced noise last time — it says the parameter is alive, nothing
more.

**Limits, per the docs, unverified here.** Context 1M, unchanged. Max output
**384 K**, where §14 measured 65,536 on V4-Flash. `max_tokens: 200000` was
accepted and silently clamped, as before, so the ceiling still cannot be
probed by overshooting.

---

## Stage 1 — adopt the name and the prices

Small, mechanical, and it should land before anything else. Nothing here
changes behaviour; it stops the studio depending on an alias with no end date
and makes the budget tell the truth.

1. `server/llm/deepseek.js`: `MODEL_IDS = ['deepseek-flash', 'deepseek-v4-pro']`.
2. `HIT_DIVISOR` and `OUTPUT_WEIGHT` become per-model — `{'deepseek-flash':
   {hit: 50, output: 4}, 'deepseek-v4-pro': {hit: 30, output: 3}}` — and
   `tokensCharged(usage, model)` takes the model. Every caller has it.
3. `server/builder.js`: `BUILDER_MODEL = 'deepseek-flash'`.
4. `server/db.js`: the `agents.model` default, plus a one-time idempotent
   `UPDATE agents SET model = 'deepseek-flash' WHERE model = 'deepseek-v4-flash'`
   beside the existing migrations (~line 370–410). Live rows hold the old id
   and the picker would show them nothing that matches.
5. `server/routes/agents.js:88` and `public/dialogs.js:1610` — the default and
   the two options. The labels stay *Flash — quick* and *Pro — slower, better
   at hard things*; they are the interface's words and nothing about them
   changed. (They become false the moment vision lands — see stage 2's
   decision.)
6. `bin/smoke.js`, `test/deepseek.test.js:414`, `test/api-agents.test.js`,
   `test/db.test.js:147`.
7. spec/ §14: the models section, the price table, a dated note that the
   cliff, sizing and handoff measurements were all taken on V4-Flash and
   describe a retired model.

**`MAX_OUTPUT_TOKENS` stays at 65,536.** Raising it to 384 K walks straight
back into §14's cliff — *the trace expands to fill whatever it is given* —
and buys a nine-minute silence six times over. Revisit only after the cliff
is re-measured on V4.1.

## Stage 2 — a helper can look at a picture

One new tool, reachable only by a Flash agent.

- `server/agents/tools.js` gains a tool taking a `path`, returning the
  picture as an `image_url` content part in the `role: 'tool'` result.
  ⚠️ Through `server/files/paths.js` like every other file tool — it is the
  security boundary — and `studio/` stays readable, which costs nothing since
  the library holds no pictures.
- Accept only what DeepSeek accepts: PNG, JPEG, GIF, WebP. Anything else, and
  anything over the size cap, comes back as a reason the way a refused
  `read_file` does.
- `server/agents/orchestrator.js` must let a tool result's `content` be an
  array. It builds a string today.
- ⚠️ The tool is **omitted from the tools array, and its preamble line
  omitted, when the agent's model is `deepseek-v4-pro`** — because Pro drops
  the picture and answers anyway. Not offered beats silently blind.
- ⚠️ `orchestrator.test.js` asserts every capability the preamble names. A
  new tool needs its line and its assertion, and the conditional needs a test
  in both directions.
- The `[binary: path, size]` placeholders in the ambient block
  (`orchestrator.js:549`) stay — they are the index that tells a helper what
  there is to look at. The tool is how it looks.

What it costs: nothing until a helper asks, ~195 tokens when it does, cached
after. What it unblocks, already written down:

- ⚠️ TODO's point-and-click line says the spot picker is the editor **because
  a helper cannot see a picture**. That reason is gone. The line should be
  re-read before the template is built, not assumed still true
  (ideas/point-and-click.md).
- "Why does my hero look wrong", "make a sprite that goes with this one",
  "does this background suit the scene" — all of which arrive today as a kid
  describing a picture the helper is holding the bytes of.
- The *standard set* and the *big set* are searched by name and tags. A
  microhelper that looks at three candidates and picks one is now possible
  (ideas/summon.md's problem, from the other end).

No new upload surface is needed: a picture reaches the tree through the pixel
editor, Upload, or Add from the studio already.

## Stage 3 — a helper can see the game running

The prize, and the speculative one. Do not start it until stage 2 has been
used for a while.

The shape: the *wrapper* (`_studio.html`) is same-origin with the game, so it
can read the game's canvas. On request it captures a frame, posts it to the
studio tab the way the *reporter* posts errors and *moments*, and the studio
holds it for the next fire to attach through a second tool.

Three things to settle before it is worth costing:

- ⚠️ **The preview runs in a person's browser, not on the server.** A helper
  can only see the game if somebody has it open. A server-side headless
  capture would mean Chromium as a runtime dependency, which this studio does
  not have and should not take.
- ⚠️ A run commits nothing (spec/ §12). A screenshot is not a file and must
  not become one — it is transient, like a score.
- A tainted canvas returns nothing. Assets are same-origin so it should not
  bite, and a WebGL game without `preserveDrawingBuffer` would.

## What to re-measure, in order

Everything in §14's Flash tables describes V4-Flash. The two that change
decisions:

1. **The cliff** (`tmp/probe-do-more.mjs`, `tmp/probe-tools-effort.mjs`) —
   does V4.1 at the default effort still think through its whole allowance
   and write nothing? The *thinking level*, the *thinking cap*, and the whole
   reason a *piece* runs at `none` rest on this one table.
2. **The 6 K prefix rule** (`tmp/probe-extension-*.mjs`) — the builder's
   entire second chapter is shaped around it.

Then, less urgently: the sizing table, the piece-shape arms, and the output
ceiling. And the standing TODO line — probe Pro against tools at `none` —
is now also a question about whether Pro is worth keeping at 4.4× with no
eyes.
